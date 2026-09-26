import * as ExpoCrypto from 'expo-crypto'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { wearDataLayer } from '@orca/expo-wear-data-layer'
import { encodeWearAction } from '../packages/wear-companion-contract/src/action'
import type { WearNotificationPage } from '../packages/wear-companion-contract/src/notification-page'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import {
  acceptNotificationPage,
  type NotificationPageRequest
} from './notification-page-repository'

type Status = 'idle' | 'loading' | 'ready' | 'unavailable'
type State = { status: Status; pages: WearNotificationPage[]; nextCursor: string | null }
type Request = NotificationPageRequest
const empty: State = { status: 'idle', pages: [], nextCursor: null }

export function useNotificationPages(dashboard: WearDashboard | null): {
  state: State
  load: (cursor: string | null) => Promise<void>
} {
  const [state, setState] = useState<State>(empty)
  const [stateKey, setStateKey] = useState<string | null>(null)
  const snapshot = useRef(empty)
  const pending = useRef<Request | null>(null)
  const generation = useRef(0)
  const pageCycle = useRef(0)
  const key = dashboard
    ? `${dashboard.bindingId}:${dashboard.publisherEpoch}:${dashboard.revision}`
    : null

  useEffect(() => {
    generation.current++
    pageCycle.current++
    pending.current = null
    snapshot.current = empty
    setState(empty)
    setStateKey(key)
  }, [key])

  const receive = useCallback(
    async (request: Request) => {
      if (!dashboard || !wearDataLayer) {
        return
      }
      let native
      try {
        native = await wearDataLayer.readNotificationsPage(request.bindingId, request.requestId)
      } catch {
        return
      }
      if (!native || pending.current !== request || !request.actionHash) {
        return
      }
      const page = acceptNotificationPage(native, request, dashboard, Date.now())
      if (
        !page ||
        (request.index > 0 && page.totalHosts !== snapshot.current.pages[0]?.totalHosts) ||
        snapshot.current.pages.some((prior) => prior.hostId === page.hostId)
      ) {
        return
      }
      const next: State = {
        status: 'ready',
        pages: [...snapshot.current.pages, page],
        nextCursor: page.nextCursor
      }
      pending.current = null
      snapshot.current = next
      setState(next)
      const currentGeneration = generation.current
      const currentCycle = pageCycle.current
      setTimeout(
        () => {
          if (
            generation.current !== currentGeneration ||
            pageCycle.current !== currentCycle ||
            snapshot.current.status === 'idle'
          ) {
            return
          }
          pending.current = null
          snapshot.current = { ...empty, status: 'unavailable' }
          setState(snapshot.current)
        },
        Math.max(0, page.expiresAt - Date.now())
      )
    },
    [dashboard]
  )

  useEffect(() => {
    if (!wearDataLayer) {
      return
    }
    const listener = wearDataLayer.addListener('onPageChanged', ({ bindingId, requestId }) => {
      const request = pending.current
      if (request?.bindingId === bindingId && request.requestId === requestId) {
        void receive(request)
      }
    })
    return () => listener.remove()
  }, [receive])

  const load = useCallback(
    async (cursor: string | null) => {
      if (!dashboard || !wearDataLayer || pending.current || dashboard.expiresAt <= Date.now()) {
        return
      }
      if (
        cursor !== null &&
        (snapshot.current.status !== 'ready' || snapshot.current.nextCursor !== cursor)
      ) {
        return
      }
      const activeGeneration = generation.current
      if (cursor === null) {
        pageCycle.current++
      }
      const request: Request = {
        bindingId: dashboard.bindingId,
        requestId: ExpoCrypto.randomUUID(),
        actionHash: '',
        cursor,
        index: cursor === null ? 0 : snapshot.current.pages.length
      }
      pending.current = request
      const loading: State =
        cursor === null
          ? { ...empty, status: 'loading' }
          : { ...snapshot.current, status: 'loading' }
      snapshot.current = loading
      setState(loading)
      try {
        const canonical = encodeWearAction({
          schemaVersion: 1,
          bindingId: request.bindingId,
          requestId: request.requestId,
          expiresAt: Math.min(Date.now() + 60_000, dashboard.expiresAt),
          action: 'readNotificationsPage',
          target: {},
          payload: { cursor },
          publisherEpoch: dashboard.publisherEpoch,
          expectedRevision: dashboard.revision,
          targetPublicationEpoch: null,
          targetSnapshotVersion: null
        })
        const result = await wearDataLayer.sendAction(canonical)
        if (pending.current !== request || generation.current !== activeGeneration) {
          return
        }
        if (result === 'conflict' || result === 'full') {
          throw new Error('Wear inbox unavailable')
        }
        const receipt = await wearDataLayer.readAction(request.bindingId, request.requestId)
        if (pending.current !== request || generation.current !== activeGeneration) {
          return
        }
        if (!receipt || receipt.status === 'rejected') {
          throw new Error('Wear inbox rejected')
        }
        request.actionHash = receipt.actionHash
        await receive(request)
        setTimeout(() => {
          if (pending.current !== request || generation.current !== activeGeneration) {
            return
          }
          pending.current = null
          snapshot.current = { ...snapshot.current, status: 'unavailable' }
          setState(snapshot.current)
        }, 60_000)
      } catch {
        if (pending.current !== request || generation.current !== activeGeneration) {
          return
        }
        pending.current = null
        snapshot.current = { ...snapshot.current, status: 'unavailable' }
        setState(snapshot.current)
      }
    },
    [dashboard, receive]
  )

  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => {
      if (
        next === 'active' &&
        snapshot.current.pages.some((page) => page.expiresAt <= Date.now())
      ) {
        pending.current = null
        snapshot.current = { ...empty, status: 'unavailable' }
        setState(snapshot.current)
      }
    })
    return () => listener.remove()
  }, [])

  return { state: stateKey === key ? state : empty, load }
}
