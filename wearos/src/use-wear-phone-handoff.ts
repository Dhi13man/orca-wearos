import * as ExpoCrypto from 'expo-crypto'
import { useCallback, useEffect, useState } from 'react'
import { wearDataLayer } from '@orca/expo-wear-data-layer'
import type { WearAgentRow } from '../packages/wear-companion-contract/src/agent-page'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import { encodeWearHandoffAction } from './wear-handoff-action'
import {
  clearWearHandoffRecord,
  loadWearHandoffRecord,
  reserveWearHandoffRecord,
  type WearHandoffRecord
} from './wear-handoff-record'
import { mergeReplyStatus, type ReplyStatus } from './wear-reply-status'

type HandoffState = { key: string | null; status: ReplyStatus; reason: string | null }

export function useWearPhoneHandoff(
  dashboard: WearDashboard | null,
  hostId: string | null,
  agent: WearAgentRow | null
): {
  status: ReplyStatus
  reason: string | null
  request: () => Promise<void>
  clear: (verified?: boolean) => Promise<void>
} {
  const [state, setState] = useState<HandoffState>({
    key: null,
    status: 'recovering',
    reason: null
  })
  const key =
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
    const read = async (record: WearHandoffRecord) => {
      try {
        const receipt = await native.readAction(record.bindingId, record.requestId)
        const saved = await loadWearHandoffRecord()
        if (
          active &&
          saved?.requestId === record.requestId &&
          saved.actionHash === record.actionHash &&
          receipt?.actionHash === record.actionHash
        ) {
          accept(receipt.status, receipt.reason)
        }
      } catch {
        accept('unknown', null)
      }
    }
    const listener = native.addListener('onActionChanged', (event) => {
      void loadWearHandoffRecord()
        .then((record) => {
          if (record?.bindingId === event.bindingId && record.requestId === event.requestId) {
            void read(record)
          }
        })
        .catch(() => accept('unknown', 'recovery'))
    })
    void loadWearHandoffRecord()
      .then((record) => {
        if (!active) {
          return
        }
        if (!record) {
          accept('idle', null)
        } else if (record.targetKey === key) {
          accept('pending', null)
          void read(record)
        } else {
          accept('unknown', 'other-handoff')
        }
      })
      .catch(() => accept('unknown', 'recovery'))
    return () => {
      active = false
      listener.remove()
    }
  }, [key, dashboard])

  const request = useCallback(async () => {
    if (
      !key ||
      !dashboard ||
      !hostId ||
      !agent ||
      !wearDataLayer ||
      state.key !== key ||
      state.status !== 'idle'
    ) {
      return
    }
    const requestId = ExpoCrypto.randomUUID()
    let canonical: string
    try {
      canonical = encodeWearHandoffAction({
        dashboard,
        hostId,
        agent,
        requestId,
        now: Date.now()
      })
    } catch {
      setState({ key, status: 'rejected', reason: 'target-changed' })
      return
    }
    let record: WearHandoffRecord | null = null
    try {
      record = {
        bindingId: dashboard.bindingId,
        requestId,
        actionHash: await ExpoCrypto.digestStringAsync(
          ExpoCrypto.CryptoDigestAlgorithm.SHA256,
          canonical
        ),
        targetKey: key
      }
      if (!(await reserveWearHandoffRecord(record))) {
        setState({ key, status: 'unknown', reason: 'other-handoff' })
        return
      }
      setState({ key, status: 'pending', reason: null })
      const result = await wearDataLayer.sendAction(canonical)
      if (result === 'conflict' || result === 'full') {
        setState({ key, status: 'rejected', reason: result })
        return
      }
      const receipt = await wearDataLayer.readAction(record.bindingId, record.requestId)
      const saved = await loadWearHandoffRecord()
      if (
        saved?.requestId === record.requestId &&
        saved.actionHash === record.actionHash &&
        receipt?.actionHash === record.actionHash
      ) {
        setState((current) =>
          current.key === key
            ? {
                key,
                status: mergeReplyStatus(current.status, receipt.status),
                reason: receipt.reason
              }
            : current
        )
      }
    } catch {
      setState((current) =>
        current.key === key
          ? { key, status: mergeReplyStatus(current.status, 'unknown'), reason: null }
          : current
      )
    }
  }, [key, dashboard, hostId, agent, state.key, state.status])

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
      const record = await loadWearHandoffRecord()
      if (record && record.targetKey !== key && !verified) {
        return
      }
      if (record) {
        await clearWearHandoffRecord(record)
      }
      setState({ key, status: 'idle', reason: null })
    },
    [key, state.key, state.status]
  )

  useEffect(() => {
    if (state.key !== key || state.status !== 'pending') {
      return
    }
    const timer = setTimeout(
      () =>
        setState((current) =>
          current.key === key && current.status === 'pending'
            ? { key, status: 'unknown', reason: null }
            : current
        ),
      60_000
    )
    return () => clearTimeout(timer)
  }, [key, state.key, state.status])

  return state.key === key
    ? { status: state.status, reason: state.reason, request, clear }
    : { status: 'recovering', reason: null, request, clear }
}
