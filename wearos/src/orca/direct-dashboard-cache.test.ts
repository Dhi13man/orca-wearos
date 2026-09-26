import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  values: new Map<string, string>(),
  active: true,
  identity: '',
  slot: -1,
  stoppedAtWrite: false
}))

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    `digest:${Array.from(value).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0)}`
}))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'unlocked',
  getItemAsync: async (key: string) => state.values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    state.values.set(key, value)
    if (state.stoppedAtWrite) {
      state.active = false
    }
  }
}))
vi.mock('@orca/expo-wear-data-layer', () => ({
  wearDataLayer: {
    setDirectPairingIdentity: (identity: string) => {
      if (state.identity !== identity) {
        state.slot = -1
      }
      state.identity = identity
    },
    getDirectSnapshotSlot: () => ({ identity: state.identity, slot: state.slot }),
    isBackgroundRefreshActive: () => state.active,
    publishDirectSnapshotSlot: (_runId: number, identity: string, slot: number) => {
      if (!state.active || state.identity !== identity) {
        return false
      }
      state.slot = slot
      return true
    }
  }
}))

import { loadCachedFleet, publishCachedFleet, syncDirectPairings } from './direct-dashboard-cache'
import type { FleetHost } from './fleet-dashboard'
import type { PairingOffer } from './pairing'

const pairing: PairingOffer = {
  v: 2,
  endpoint: 'ws://host:6768',
  deviceToken: 'secret-grant',
  publicKeyB64: 'public-key',
  scope: 'wear'
}
const host: FleetHost = {
  pairing,
  dashboard: {
    status: { runtimeId: 'runtime-1' },
    usage: [],
    usageRefreshPending: false,
    agents: [],
    events: [{ key: 'event-1', kind: 'terminal-bell', at: 50 }],
    eventsOmitted: 0,
    warnings: []
  },
  observedAt: 50,
  checkedAt: 50,
  error: null
}

beforeEach(() => {
  state.values.clear()
  state.active = true
  state.identity = ''
  state.slot = -1
  state.stoppedAtWrite = false
})

describe('direct dashboard cache', () => {
  it('hydrates Attention state across process restart without persisting the bearer', async () => {
    await syncDirectPairings([pairing])
    expect(await publishCachedFleet(1, [pairing], [host])).toBe(true)
    expect((await loadCachedFleet([pairing]))[0]).toMatchObject({
      cached: true,
      observedAt: 50,
      dashboard: { events: [{ key: 'event-1' }] }
    })
    expect([...state.values.values()].join(' ')).not.toContain(pairing.deviceToken)
  })

  it('never publishes a slot written after Android stops the job', async () => {
    await syncDirectPairings([pairing])
    state.stoppedAtWrite = true
    expect(await publishCachedFleet(1, [pairing], [host])).toBe(false)
    expect(await loadCachedFleet([pairing])).toEqual([])
  })

  it('discards cached data when a grant is revoked or replaced', async () => {
    await syncDirectPairings([pairing])
    await publishCachedFleet(1, [pairing], [host])
    const replacement = { ...pairing, deviceToken: 'replacement-grant' }
    expect(await loadCachedFleet([replacement])).toEqual([])
    await syncDirectPairings([replacement])
    expect(await loadCachedFleet([replacement])).toEqual([])
    expect(await loadCachedFleet([])).toEqual([])
  })

  it('keeps the omitted-agent count when a stale cached host is republished', async () => {
    await syncDirectPairings([pairing])
    await publishCachedFleet(
      1,
      [pairing],
      [{ ...host, cached: true, agentsOmitted: 5, error: 'Connection refused' }]
    )
    expect((await loadCachedFleet([pairing]))[0]).toMatchObject({
      agentsOmitted: 5,
      error: 'Connection refused'
    })
  })
})
