import * as ExpoCrypto from 'expo-crypto'
import { useCallback, useEffect, useRef, useState } from 'react'
import { wearDataLayer } from '@orca/expo-wear-data-layer'
import { encodeWearAction } from '../packages/wear-companion-contract/src/action'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'

type RefreshStatus = 'idle' | 'pending' | 'accepted' | 'rejected' | 'unknown'
type RefreshState = { key: string | null; status: RefreshStatus }

export function useDashboardRefresh(dashboard: WearDashboard | null): {
  status: RefreshStatus
  refresh: () => Promise<void>
} {
  const [state, setState] = useState<RefreshState>({ key: null, status: 'idle' })
  const request = useRef<{ id: string; hash: string } | null>(null)
  const key = dashboard
    ? JSON.stringify([dashboard.bindingId, dashboard.publisherEpoch, dashboard.revision])
    : null

  useEffect(() => {
    request.current = null
    setState({ key, status: 'idle' })
    if (!key || !dashboard || !wearDataLayer) {
      return
    }
    let active = true
    const native = wearDataLayer
    const read = async () => {
      const pending = request.current
      if (!pending) {
        return
      }
      try {
        const receipt = await native.readAction(dashboard.bindingId, pending.id)
        if (!active || request.current !== pending || receipt?.actionHash !== pending.hash) {
          return
        }
        setState((current) => {
          if (
            current.key !== key ||
            current.status === 'accepted' ||
            current.status === 'rejected'
          ) {
            return current
          }
          return { key, status: receipt.status }
        })
      } catch {
        if (active && request.current === pending) {
          setState((current) =>
            current.key === key && current.status === 'pending'
              ? { key, status: 'unknown' }
              : current
          )
        }
      }
    }
    const listener = native.addListener('onActionChanged', (event) => {
      if (event.bindingId === dashboard.bindingId && event.requestId === request.current?.id) {
        void read()
      }
    })
    return () => {
      active = false
      listener.remove()
    }
  }, [key, dashboard])

  const refresh = useCallback(async () => {
    if (!key || !dashboard || !wearDataLayer || state.status === 'pending') {
      return
    }
    const now = Date.now()
    if (dashboard.expiresAt <= now) {
      setState({ key, status: 'rejected' })
      return
    }
    const id = ExpoCrypto.randomUUID()
    const canonical = encodeWearAction({
      schemaVersion: 1,
      bindingId: dashboard.bindingId,
      requestId: id,
      expiresAt: Math.min(now + 60_000, dashboard.expiresAt),
      action: 'refresh',
      target: {},
      payload: {},
      publisherEpoch: dashboard.publisherEpoch,
      expectedRevision: dashboard.revision,
      targetPublicationEpoch: null,
      targetSnapshotVersion: null
    })
    const pending = {
      id,
      hash: await ExpoCrypto.digestStringAsync(ExpoCrypto.CryptoDigestAlgorithm.SHA256, canonical)
    }
    request.current = pending
    setState({ key, status: 'pending' })
    try {
      const result = await wearDataLayer.sendAction(canonical)
      if (request.current !== pending) {
        return
      }
      if (result === 'conflict' || result === 'full') {
        setState({ key, status: 'rejected' })
        return
      }
      const receipt = await wearDataLayer.readAction(dashboard.bindingId, id)
      if (request.current === pending && receipt?.actionHash === pending.hash) {
        setState((current) =>
          current.key === key && current.status !== 'accepted' && current.status !== 'rejected'
            ? { key, status: receipt.status }
            : current
        )
      }
    } catch {
      if (request.current === pending) {
        setState((current) =>
          current.key === key && current.status === 'pending' ? { key, status: 'unknown' } : current
        )
      }
    }
  }, [key, dashboard, state.status])

  useEffect(() => {
    if (state.key !== key || state.status !== 'pending') {
      return
    }
    const timer = setTimeout(() => {
      setState((current) =>
        current.key === key && current.status === 'pending' ? { key, status: 'unknown' } : current
      )
    }, 60_000)
    return () => clearTimeout(timer)
  }, [key, state.key, state.status])

  return { status: state.key === key ? state.status : 'idle', refresh }
}
