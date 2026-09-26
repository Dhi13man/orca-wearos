import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  active: true,
  identity: 'identity-a',
  pairings: [
    { v: 2, endpoint: 'ws://host', deviceToken: 'grant-a', publicKeyB64: 'key', scope: 'wear' }
  ],
  releases: [] as (() => void)[],
  signals: [] as AbortSignal[],
  published: 0,
  completed: 0,
  fetched: 0
}))
vi.mock('@orca/expo-wear-data-layer', () => ({
  wearDataLayer: {
    isBackgroundRefreshActive: () => state.active,
    getDirectSnapshotSlot: () => ({ identity: state.identity, slot: -1 }),
    completeBackgroundRefresh: () => {
      state.completed++
    }
  }
}))
vi.mock('./pairing-store', () => ({ loadPairings: async () => state.pairings }))
vi.mock('./direct-dashboard-cache', () => ({
  CACHED_HOST_LIMIT: 32,
  pairingIdentity: async (pairings: typeof state.pairings) =>
    pairings[0]?.deviceToken === 'grant-a' ? 'identity-a' : 'identity-b',
  loadCachedFleet: async () => [],
  publishCachedFleet: async () => {
    state.published++
    return true
  }
}))
vi.mock('./direct-orca-client', () => ({
  fetchRuntimeDashboard: async (_offer: unknown, options: { signal?: AbortSignal }) => {
    state.fetched++
    if (options.signal) {
      state.signals.push(options.signal)
    }
    await new Promise<void>((resolve) => {
      state.releases.push(resolve)
    })
    return {
      status: { runtimeId: 'runtime-a' },
      usage: [],
      agents: [],
      events: [],
      eventsOmitted: 0,
      warnings: [],
      usageRefreshPending: false
    }
  }
}))

import { runBackgroundRefresh } from './background-refresh'

beforeEach(() => {
  state.active = true
  state.identity = 'identity-a'
  state.pairings = [
    { v: 2, endpoint: 'ws://host', deviceToken: 'grant-a', publicKeyB64: 'key', scope: 'wear' }
  ]
  state.releases = []
  state.signals = []
  state.published = 0
  state.completed = 0
  state.fetched = 0
})

describe('background refresh job', () => {
  it('does not publish a late response after Android stops the job', async () => {
    const pending = runBackgroundRefresh({ runId: 1 })
    await vi.waitFor(() => expect(state.releases).toHaveLength(1))
    state.active = false
    state.releases[0]()
    await pending
    expect(state.published).toBe(0)
    expect(state.completed).toBe(1)
  })

  it('rejects a result from a replaced or revoked pairing', async () => {
    const pending = runBackgroundRefresh({ runId: 1 })
    await vi.waitFor(() => expect(state.releases).toHaveLength(1))
    state.pairings = [{ ...state.pairings[0], deviceToken: 'grant-b' }]
    state.releases[0]()
    await pending
    expect(state.published).toBe(0)
    expect(state.completed).toBe(1)
  })

  it('aborts every in-flight host when one result arrives after stop', async () => {
    state.pairings = Array.from({ length: 3 }, (_, index) => ({
      v: 2,
      endpoint: `ws://host-${index}`,
      deviceToken: 'grant-a',
      publicKeyB64: 'key',
      scope: 'wear'
    }))
    const pending = runBackgroundRefresh({ runId: 1 })
    await vi.waitFor(() => expect(state.releases).toHaveLength(3))
    state.active = false
    state.releases[0]()
    await pending
    expect(state.signals).toHaveLength(3)
    expect(state.signals.every((signal) => signal.aborted)).toBe(true)
    expect(state.published).toBe(0)
    state.releases.slice(1).forEach((release) => release())
  })
})
