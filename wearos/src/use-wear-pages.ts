import * as ExpoCrypto from 'expo-crypto'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { wearDataLayer } from '@orca/expo-wear-data-layer'
import { encodeWearAction } from '../packages/wear-companion-contract/src/action'
import type {
  WearDashboard,
  WearDashboardHost,
  WearUsageGroup
} from '../packages/wear-companion-contract/src/dashboard'
import type { WearAgentRow } from '../packages/wear-companion-contract/src/agent-page'
import { acceptHostPage, type HostPageRequest } from './host-page-repository'
import { acceptAgentPage } from './agent-page-repository'
import { acceptUsagePage } from './usage-page-repository'

type PageItem = WearDashboardHost | WearAgentRow | WearUsageGroup
type PagesState = {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  items: PageItem[]
  total: number
  nextCursor: string | null
  inventoryAuthority: 'authoritative' | 'incomplete' | 'unavailable' | null
}

const initial: PagesState = {
  status: 'idle',
  items: [],
  total: 0,
  nextCursor: null,
  inventoryAuthority: null
}

function itemId(item: PageItem): string {
  return 'hostId' in item
    ? item.hostId
    : 'groupKey' in item
      ? item.groupKey
      : `${item.workspaceId}\0${item.sessionTabId}`
}

function useWearPages(dashboard: WearDashboard | null, hostId: string | null, usage = false) {
  const [state, setState] = useState<PagesState>(initial)
  const [stateKey, setStateKey] = useState<string | null>(null)
  const snapshot = useRef(initial)
  const pending = useRef<HostPageRequest | null>(null)
  const sequence = useRef(0)
  const pageCycle = useRef(0)
  const pageExpiresAt = useRef<number | null>(null)
  const seed: PagesState = useMemo(
    () =>
      usage && dashboard
        ? {
            status: 'ready',
            items: dashboard.usageGroups,
            total: dashboard.usagePage.total,
            nextCursor: dashboard.usagePage.nextCursor,
            inventoryAuthority: null
          }
        : initial,
    [dashboard, usage]
  )
  const key = dashboard
    ? `${dashboard.bindingId}:${dashboard.publisherEpoch}:${dashboard.revision}:${usage ? 'usage' : hostId === null ? 'catalog' : `agents:${hostId}`}`
    : null

  useEffect(() => {
    sequence.current += 1
    pageCycle.current += 1
    pageExpiresAt.current = null
    pending.current = null
    snapshot.current = seed
    setState(seed)
    setStateKey(key)
  }, [key, seed])

  const receive = useCallback(
    async (request: HostPageRequest) => {
      if (!dashboard || !wearDataLayer) {
        return
      }
      let native
      try {
        native = await (usage
          ? wearDataLayer.readUsagePage(request.bindingId, request.requestId)
          : hostId === null
            ? wearDataLayer.readHostPage(request.bindingId, request.requestId)
            : wearDataLayer.readAgentPage(request.bindingId, request.requestId))
      } catch {
        if (pending.current === request) {
          pending.current = null
          const unavailable = { ...snapshot.current, status: 'unavailable' as const }
          snapshot.current = unavailable
          setState(unavailable)
        }
        return
      }
      if (!native || pending.current !== request) {
        return
      }
      const page = usage
        ? acceptUsagePage(native, request, dashboard, Date.now())
        : hostId === null
          ? acceptHostPage(native, request, dashboard, Date.now())
          : acceptAgentPage(native, { ...request, hostId }, dashboard, Date.now())
      if (!page) {
        return
      }
      const items: PageItem[] =
        'hosts' in page ? page.hosts : 'agents' in page ? page.agents : page.groups
      if (
        request.offset > 0 &&
        (page.total !== snapshot.current.total ||
          items.some((item) =>
            snapshot.current.items.some((prior) => itemId(prior) === itemId(item))
          ))
      ) {
        pending.current = null
        const unavailable = { ...snapshot.current, status: 'unavailable' as const }
        snapshot.current = unavailable
        setState(unavailable)
        return
      }
      const next: PagesState = {
        status: 'ready',
        items: [...snapshot.current.items, ...items],
        total: page.total,
        nextCursor: page.nextCursor,
        inventoryAuthority: 'inventoryAuthority' in page ? page.inventoryAuthority : null
      }
      pending.current = null
      snapshot.current = next
      setState(next)
      pageExpiresAt.current = Math.min(pageExpiresAt.current ?? page.expiresAt, page.expiresAt)
      const cycle = pageCycle.current
      setTimeout(
        () => {
          if (pageCycle.current !== cycle || snapshot.current.status === 'idle') {
            return
          }
          pending.current = null
          const unavailable = { ...snapshot.current, status: 'unavailable' as const }
          snapshot.current = unavailable
          setState(unavailable)
        },
        Math.max(0, page.expiresAt - Date.now())
      )
    },
    [dashboard, hostId, usage]
  )

  useEffect(() => {
    if (!wearDataLayer) {
      return
    }
    const listener = wearDataLayer.addListener('onPageChanged', ({ bindingId, requestId }) => {
      const request = pending.current
      if (
        request?.bindingId === bindingId &&
        request.requestId === requestId &&
        request.actionHash
      ) {
        void receive(request)
      }
    })
    return () => listener.remove()
  }, [receive])

  const load = useCallback(
    async (cursor: string | null = null) => {
      if (!dashboard || !wearDataLayer || pending.current) {
        return
      }
      if (
        cursor !== null &&
        (snapshot.current.status !== 'ready' || snapshot.current.nextCursor !== cursor)
      ) {
        return
      }
      const generation = sequence.current
      if (cursor === null) {
        pageCycle.current += 1
        pageExpiresAt.current = null
      }
      const requestId = ExpoCrypto.randomUUID()
      const request: HostPageRequest = {
        bindingId: dashboard.bindingId,
        requestId,
        actionHash: '',
        cursor,
        offset: cursor === null ? 0 : snapshot.current.items.length
      }
      pending.current = request
      const loading: PagesState =
        cursor === null
          ? { ...initial, status: 'loading' }
          : { ...snapshot.current, status: 'loading' }
      snapshot.current = loading
      setState(loading)
      try {
        const envelope = {
          schemaVersion: 1,
          bindingId: dashboard.bindingId,
          requestId,
          expiresAt: Date.now() + 60_000,
          publisherEpoch: dashboard.publisherEpoch,
          expectedRevision: dashboard.revision,
          targetPublicationEpoch: null,
          targetSnapshotVersion: null
        } as const
        const canonical = usage
          ? encodeWearAction({
              ...envelope,
              action: 'readUsagePage',
              target: {},
              payload: { cursor }
            })
          : hostId === null
            ? encodeWearAction({
                ...envelope,
                action: 'readHostPage',
                target: {},
                payload: { cursor }
              })
            : encodeWearAction({
                ...envelope,
                action: 'readHostAgents',
                target: { hostId },
                payload: { cursor }
              })
        const result = await wearDataLayer.sendAction(canonical)
        if (pending.current !== request || sequence.current !== generation) {
          return
        }
        if (result === 'conflict' || result === 'full') {
          throw new Error('Wear action unavailable')
        }
        const action = await wearDataLayer.readAction(request.bindingId, request.requestId)
        if (pending.current !== request || sequence.current !== generation) {
          return
        }
        if (!action || action.status === 'rejected') {
          throw new Error('Wear action rejected')
        }
        request.actionHash = action.actionHash
        await receive(request)
        setTimeout(() => {
          if (pending.current !== request || sequence.current !== generation) {
            return
          }
          pending.current = null
          const unavailable = { ...snapshot.current, status: 'unavailable' as const }
          snapshot.current = unavailable
          setState(unavailable)
        }, 60_000)
      } catch {
        if (pending.current !== request || sequence.current !== generation) {
          return
        }
        pending.current = null
        const unavailable = { ...snapshot.current, status: 'unavailable' as const }
        snapshot.current = unavailable
        setState(unavailable)
      }
    },
    [dashboard, hostId, receive, usage]
  )

  useEffect(() => {
    const listener = AppState.addEventListener('change', (appState) => {
      if (
        appState === 'active' &&
        pageExpiresAt.current !== null &&
        pageExpiresAt.current <= Date.now()
      ) {
        pending.current = null
        const unavailable = { ...snapshot.current, status: 'unavailable' as const }
        snapshot.current = unavailable
        setState(unavailable)
      }
    })
    return () => listener.remove()
  }, [])

  return { state: stateKey === key ? state : seed, load }
}

export function useHostPages(dashboard: WearDashboard | null) {
  const { state, load } = useWearPages(dashboard, null)
  return { state: { ...state, hosts: state.items as WearDashboardHost[] }, load }
}

export function useAgentPages(dashboard: WearDashboard | null, hostId: string | null) {
  const { state, load } = useWearPages(hostId ? dashboard : null, hostId)
  useEffect(() => {
    if (hostId && dashboard && state.status === 'idle') {
      void load(null)
    }
  }, [dashboard, hostId, state.status, load])
  return { state: { ...state, agents: state.items as WearAgentRow[] }, load }
}

export function useUsagePages(dashboard: WearDashboard | null) {
  const { state, load } = useWearPages(dashboard, null, true)
  return { state: { ...state, groups: state.items as WearUsageGroup[] }, load }
}
