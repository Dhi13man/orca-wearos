import { wearDataLayer } from '@orca/expo-wear-data-layer'
import {
  CACHED_HOST_LIMIT,
  loadCachedFleet,
  pairingIdentity,
  publishCachedFleet
} from './direct-dashboard-cache'
import { fetchRuntimeDashboard } from './direct-orca-client'
import { refreshFleet } from './fleet-dashboard'
import { loadPairings } from './pairing-store'

const BACKGROUND_HOST_TIMEOUT_MS = 5_000

export async function runBackgroundRefresh({ runId }: { runId: number }): Promise<void> {
  const native = wearDataLayer
  if (!native?.isBackgroundRefreshActive(runId)) {
    return
  }
  const abort = new AbortController()
  const timer = setInterval(() => {
    if (!native.isBackgroundRefreshActive(runId)) {
      abort.abort()
    }
  }, 100)
  try {
    const pairings = await loadPairings()
    if (!pairings.length || abort.signal.aborted) {
      return
    }
    const identity = await pairingIdentity(pairings)
    if (native.getDirectSnapshotSlot()?.identity !== identity) {
      return
    }
    const previous = await loadCachedFleet(pairings)
    const hosts = await refreshFleet(
      pairings.slice(0, CACHED_HOST_LIMIT),
      previous,
      (offer, overrides) =>
        fetchRuntimeDashboard(offer, { ...overrides, timeoutMs: BACKGROUND_HOST_TIMEOUT_MS }),
      Date.now,
      abort.signal,
      () => native.isBackgroundRefreshActive(runId)
    )
    if (abort.signal.aborted || !native.isBackgroundRefreshActive(runId)) {
      return
    }
    const current = await loadPairings()
    if ((await pairingIdentity(current)) !== identity) {
      return
    }
    await publishCachedFleet(runId, pairings, hosts)
  } catch (error) {
    if (!native.isBackgroundRefreshActive(runId) || abort.signal.aborted) {
      return
    }
    throw error
  } finally {
    abort.abort()
    clearInterval(timer)
    native.completeBackgroundRefresh(runId)
  }
}
