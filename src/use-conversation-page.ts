import * as ExpoCrypto from 'expo-crypto'
import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { wearDataLayer } from '@orca/expo-wear-data-layer'
import { encodeWearAction } from '../packages/wear-companion-contract/src/action'
import type { WearAgentRow } from '../packages/wear-companion-contract/src/agent-page'
import type { WearConversationPage } from '../packages/wear-companion-contract/src/conversation-page'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import {
  acceptConversationPage,
  type ConversationPageRequest
} from './conversation-page-repository'

type ConversationState = {
  key: string | null
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  page: WearConversationPage | null
  reason: 'rejected' | 'timeout' | 'unavailable' | null
}
const initial: ConversationState = { key: null, status: 'idle', page: null, reason: null }

export function useConversationPage(
  dashboard: WearDashboard | null,
  hostId: string | null,
  agent: WearAgentRow | null
): Omit<ConversationState, 'key'> & { retry: () => void } {
  const [state, setState] = useState(initial)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const key =
    dashboard && hostId && agent && agent.workspaceKind
      ? `${dashboard.bindingId}:${dashboard.publisherEpoch}:${dashboard.revision}:${dashboard.expiresAt}:${hostId}:${agent.workspaceId}:${agent.workspaceKind}:${agent.sessionTabId}:${agent.targetPublicationEpoch}:${agent.targetSnapshotVersion}:${attempt}`
      : null

  useEffect(() => {
    if (!key || !dashboard || !hostId || !agent || !agent.workspaceKind || !wearDataLayer) {
      setState(initial)
      return
    }
    const native = wearDataLayer
    let active = true
    let terminal = false
    let accepted: WearConversationPage | null = null
    let deadline: ReturnType<typeof setTimeout> | null = null
    let pageExpiry: ReturnType<typeof setTimeout> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let retryDelay = 500
    const request: ConversationPageRequest = {
      bindingId: dashboard.bindingId,
      requestId: ExpoCrypto.randomUUID(),
      actionHash: '',
      hostId,
      workspaceId: agent.workspaceId,
      workspaceKind: agent.workspaceKind,
      sessionTabId: agent.sessionTabId,
      targetPublicationEpoch: agent.targetPublicationEpoch,
      targetSnapshotVersion: agent.targetSnapshotVersion
    }
    const unavailable = (reason: ConversationState['reason']) => {
      if (active && !terminal) {
        terminal = true
        accepted = null
        if (deadline) {
          clearTimeout(deadline)
        }
        if (retryTimer) {
          clearTimeout(retryTimer)
          retryTimer = null
        }
        if (pageExpiry) {
          clearTimeout(pageExpiry)
        }
        setState({ key, status: 'unavailable', page: null, reason })
      }
    }
    const receive = async () => {
      if (!active || terminal || !request.actionHash) {
        return
      }
      try {
        const page = native.readConversationPage(request.bindingId, request.requestId)
        const read = await page
        if (!active || terminal) {
          return
        }
        if (!read) {
          queueRetry()
          return
        }
        const result = acceptConversationPage(read, request, dashboard, Date.now())
        if (!result || terminal) {
          queueRetry()
          return
        }
        accepted = result
        if (deadline) {
          clearTimeout(deadline)
        }
        if (retryTimer) {
          clearTimeout(retryTimer)
          retryTimer = null
        }
        if (pageExpiry) {
          clearTimeout(pageExpiry)
        }
        pageExpiry = setTimeout(
          () => unavailable('timeout'),
          Math.max(0, result.expiresAt - Date.now())
        )
        setState({ key, status: 'ready', page: result, reason: null })
      } catch {
        queueRetry()
      }
    }
    function queueRetry(): void {
      if (!active || terminal || retryTimer) {
        return
      }
      retryTimer = setTimeout(() => {
        retryTimer = null
        void readPendingAction()
      }, retryDelay)
      retryDelay = Math.min(retryDelay * 2, 8_000)
    }
    async function readPendingAction(): Promise<void> {
      if (accepted || terminal) {
        return
      }
      try {
        const action = await native.readAction(request.bindingId, request.requestId)
        if (!active || accepted || terminal) {
          return
        }
        if (!action) {
          queueRetry()
          return
        }
        if (retryTimer) {
          clearTimeout(retryTimer)
          retryTimer = null
        }
        request.actionHash = action.actionHash
        if (action.status === 'rejected') {
          unavailable('rejected')
          return
        }
        await receive()
      } catch {
        queueRetry()
      }
    }
    const pageListener = native.addListener('onPageChanged', (event) => {
      if (event.bindingId === request.bindingId && event.requestId === request.requestId) {
        void readPendingAction()
      }
    })
    const actionListener = native.addListener('onActionChanged', (event) => {
      if (event.bindingId === request.bindingId && event.requestId === request.requestId) {
        void readPendingAction()
      }
    })
    const appListener = AppState.addEventListener('change', (appState) => {
      if (appState === 'active' && accepted && accepted.expiresAt <= Date.now()) {
        unavailable('timeout')
      }
    })
    setState({ key, status: 'loading', page: null, reason: null })
    deadline = setTimeout(() => unavailable('timeout'), 60_000)
    void (async () => {
      try {
        const canonical = encodeWearAction({
          schemaVersion: 1,
          bindingId: request.bindingId,
          requestId: request.requestId,
          expiresAt: Date.now() + 60_000,
          action: 'openConversation',
          target: {
            hostId,
            workspaceId: agent.workspaceId,
            workspaceKind: agent.workspaceKind!,
            sessionTabId: agent.sessionTabId
          },
          publisherEpoch: dashboard.publisherEpoch,
          expectedRevision: dashboard.revision,
          targetPublicationEpoch: agent.targetPublicationEpoch,
          targetSnapshotVersion: agent.targetSnapshotVersion,
          payload: {}
        })
        const sent = await native.sendAction(canonical)
        if (!active) {
          return
        }
        if (sent === 'conflict' || sent === 'full') {
          unavailable('rejected')
          return
        }
        await readPendingAction()
      } catch {
        void readPendingAction()
      }
    })()
    return () => {
      active = false
      if (deadline) {
        clearTimeout(deadline)
      }
      if (pageExpiry) {
        clearTimeout(pageExpiry)
      }
      if (retryTimer) {
        clearTimeout(retryTimer)
      }
      pageListener.remove()
      actionListener.remove()
      appListener.remove()
    }
  }, [key, dashboard, hostId, agent])

  return state.key === key
    ? { status: state.status, page: state.page, reason: state.reason, retry }
    : { status: initial.status, page: null, reason: null, retry }
}
