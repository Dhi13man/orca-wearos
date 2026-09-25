import * as ExpoCrypto from 'expo-crypto'
import { useCallback, useEffect, useState } from 'react'
import { wearDataLayer } from '@orca/expo-wear-data-layer'
import type { WearAgentRow } from '../packages/wear-companion-contract/src/agent-page'
import type { WearConversationPage } from '../packages/wear-companion-contract/src/conversation-page'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import { encodeWearReplyAction } from './wear-reply-action'
import {
  clearWearReplyRecord,
  describeWearReplyTarget,
  loadWearReplyRecord,
  reserveWearReplyRecord,
  type WearReplyRecord
} from './wear-reply-record'
import { mergeReplyStatus, type ReplyStatus } from './wear-reply-status'

type ReplyState = { key: string | null; status: ReplyStatus; reason: string | null }

export function useWearReply(
  dashboard: WearDashboard | null,
  hostId: string | null,
  agent: WearAgentRow | null,
  page: WearConversationPage | null,
  machineName: string | null
): {
  status: ReplyStatus
  reason: string | null
  recoveryTarget: string | null
  send: (text: string) => Promise<void>
  clear: (verified?: boolean) => Promise<void>
} {
  const [state, setState] = useState<ReplyState>({ key: null, status: 'recovering', reason: null })
  const [recoveryTarget, setRecoveryTarget] = useState<string | null>(null)
  const [recoveryRequestId, setRecoveryRequestId] = useState<string | null>(null)
  const targetKey =
    dashboard && hostId && agent
      ? JSON.stringify([
          dashboard.bindingId,
          hostId,
          agent.workspaceId,
          agent.workspaceKind,
          agent.sessionTabId,
          agent.targetPublicationEpoch,
          agent.targetSnapshotVersion
        ])
      : null
  const key = targetKey && page ? JSON.stringify([targetKey, page.requestId]) : null

  useEffect(() => {
    if (!key || !dashboard || !wearDataLayer) {
      return
    }
    let active = true
    const native = wearDataLayer
    const accept = (status: ReplyStatus, reason: string | null) => {
      if (!active) {
        return
      }
      setState((current) => {
        if (current.key !== key) {
          return { key, status, reason }
        }
        const merged = mergeReplyStatus(current.status, status)
        return { key, status: merged, reason: merged === status ? reason : current.reason }
      })
    }
    const read = async (record: WearReplyRecord) => {
      const stillReserved = async () => {
        const saved = await loadWearReplyRecord()
        return (
          saved?.bindingId === record.bindingId &&
          saved.requestId === record.requestId &&
          saved.actionHash === record.actionHash
        )
      }
      try {
        const receipt = await native.readAction(record.bindingId, record.requestId)
        if (active && receipt?.actionHash === record.actionHash && (await stillReserved())) {
          accept(receipt.status, receipt.reason)
        }
      } catch {
        try {
          if (active && (await stillReserved())) {
            accept('unknown', null)
          }
        } catch {
          accept('unknown', 'recovery')
        }
      }
    }
    const listener = native.addListener('onActionChanged', (event) => {
      void loadWearReplyRecord()
        .then((record) => {
          if (
            record &&
            record.bindingId === event.bindingId &&
            record.requestId === event.requestId
          ) {
            void read(record)
          }
        })
        .catch(() => accept('unknown', 'recovery'))
    })
    void loadWearReplyRecord()
      .then((record) => {
        if (!active) {
          return
        }
        if (!record) {
          setRecoveryTarget(null)
          setRecoveryRequestId(null)
          accept('idle', null)
        } else if (record.targetKey === targetKey) {
          setRecoveryTarget(describeWearReplyTarget(record))
          setRecoveryRequestId(record.requestId)
          accept('pending', null)
          void read(record)
        } else {
          setRecoveryTarget(describeWearReplyTarget(record))
          setRecoveryRequestId(record.requestId)
          accept('unknown', 'other-reply')
        }
      })
      .catch(() => accept('unknown', 'recovery'))
    return () => {
      active = false
      listener.remove()
    }
  }, [key, targetKey, dashboard])

  const send = useCallback(
    async (text: string) => {
      if (
        !key ||
        !targetKey ||
        !dashboard ||
        !hostId ||
        !agent ||
        !page ||
        !wearDataLayer ||
        state.key !== key ||
        state.status !== 'idle'
      ) {
        return
      }
      const requestId = ExpoCrypto.randomUUID()
      let canonical: string
      let record: WearReplyRecord | null = null
      try {
        canonical = encodeWearReplyAction({
          dashboard,
          hostId,
          agent,
          page,
          requestId,
          text,
          now: Date.now()
        })
      } catch {
        setState({ key, status: 'rejected', reason: 'invalid-draft-or-target' })
        return
      }
      try {
        const actionHash = await ExpoCrypto.digestStringAsync(
          ExpoCrypto.CryptoDigestAlgorithm.SHA256,
          canonical
        )
        record = {
          bindingId: dashboard.bindingId,
          requestId,
          actionHash,
          targetKey,
          agentTitle: agent.title,
          machineName: machineName ?? hostId
        }
        if (!(await reserveWearReplyRecord(record))) {
          const saved = await loadWearReplyRecord()
          if (saved) {
            setRecoveryTarget(describeWearReplyTarget(saved))
            setRecoveryRequestId(saved.requestId)
          }
          setState({ key, status: 'unknown', reason: 'other-reply' })
          return
        }
        setRecoveryTarget(describeWearReplyTarget(record))
        setRecoveryRequestId(record.requestId)
        setState({ key, status: 'pending', reason: null })
        const result = await wearDataLayer.sendAction(canonical)
        if (result === 'conflict' || result === 'full') {
          setState({ key, status: 'rejected', reason: result })
          return
        }
        const receipt = await wearDataLayer.readAction(record.bindingId, record.requestId)
        const saved = await loadWearReplyRecord()
        if (
          saved?.requestId === record.requestId &&
          saved.actionHash === record.actionHash &&
          receipt?.actionHash === record.actionHash
        ) {
          setState((current) => {
            if (current.key !== key) {
              return current
            }
            const status = mergeReplyStatus(current.status, receipt.status)
            return {
              key,
              status,
              reason: status === receipt.status ? receipt.reason : current.reason
            }
          })
        }
      } catch {
        try {
          const saved = await loadWearReplyRecord()
          if (
            !record ||
            (saved?.requestId === record.requestId && saved.actionHash === record.actionHash)
          ) {
            setState((current) =>
              current.key === key
                ? { key, status: mergeReplyStatus(current.status, 'unknown'), reason: null }
                : current
            )
          }
        } catch {
          setState({ key, status: 'unknown', reason: 'recovery' })
        }
      }
    },
    [key, targetKey, dashboard, hostId, agent, page, machineName, state.key, state.status]
  )

  const clear = useCallback(
    async (verified = false) => {
      if (
        state.key !== key ||
        !(
          ['accepted', 'rejected'].includes(state.status) ||
          (verified && state.status === 'unknown')
        )
      ) {
        return
      }
      const record = await loadWearReplyRecord()
      if (record && record.requestId !== recoveryRequestId) {
        return
      }
      if (record && record.targetKey !== targetKey && !verified) {
        return
      }
      if (record) {
        await clearWearReplyRecord(record)
      }
      setRecoveryTarget(null)
      setRecoveryRequestId(null)
      setState({ key, status: 'idle', reason: null })
    },
    [key, targetKey, recoveryRequestId, state.key, state.status]
  )

  useEffect(() => {
    if (state.key !== key || state.status !== 'pending') {
      return
    }
    const timer = setTimeout(() => {
      setState((current) =>
        current.key === key && current.status === 'pending'
          ? { key, status: 'unknown', reason: null }
          : current
      )
    }, 60_000)
    return () => clearTimeout(timer)
  }, [key, state.key, state.status])

  return state.key === key
    ? { status: state.status, reason: state.reason, recoveryTarget, send, clear }
    : { status: 'recovering', reason: null, recoveryTarget: null, send, clear }
}
