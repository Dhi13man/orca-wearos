import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(7)
}))
import { refreshFleet } from './fleet-dashboard'
import type { PairingOffer } from './pairing'
import type { OrcaDashboard } from './runtime-dashboard'

const pairings = Array.from({ length: 5 }, (_, index): PairingOffer => ({
  v: 2,
  endpoint: `ws://host-${index}:6768`,
  deviceToken: `token-${index}`,
  publicKeyB64: 'key',
  scope: 'wear'
}))

function dashboard(id: string): OrcaDashboard {
  return {
    status: { runtimeId: id },
    usage: [],
    usageRefreshPending: false,
    agents: [],
    events: [],
    eventsOmitted: 0,
    warnings: []
  }
}

describe('fleet dashboard refresh', () => {
  it('reads every host with at most three concurrent requests and preserves pairing order', async () => {
    const release: (() => void)[] = []
    let active = 0
    let peak = 0
    const pending = refreshFleet(
      pairings,
      [],
      async (offer) => {
        active++
        peak = Math.max(peak, active)
        await new Promise<void>((resolve) => release.push(resolve))
        active--
        return dashboard(offer.endpoint)
      },
      () => 100
    )
    await Promise.resolve()
    expect(peak).toBe(3)
    for (let index = 0; index < pairings.length; index++) {
      release[index]()
      await Promise.resolve()
    }
    const hosts = await pending
    expect(peak).toBe(3)
    expect(hosts.map((host) => host.pairing.endpoint)).toEqual(pairings.map((p) => p.endpoint))
    expect(hosts.every((host) => host.observedAt === 100 && host.error === null)).toBe(true)
  })

  it('keeps failed hosts visible with their last observation and an explicit error', async () => {
    const previous = [
      {
        pairing: pairings[0],
        dashboard: dashboard('runtime-0'),
        observedAt: 10,
        checkedAt: 10,
        error: null
      }
    ]
    const hosts = await refreshFleet(
      pairings.slice(0, 2),
      previous,
      async (offer) => {
        if (offer.endpoint === pairings[0].endpoint) {
          throw new Error('Connection refused')
        }
        return dashboard('runtime-1')
      },
      () => 50
    )
    expect(hosts[0]).toMatchObject({
      dashboard: dashboard('runtime-0'),
      observedAt: 10,
      checkedAt: 50,
      error: 'Connection refused'
    })
    expect(hosts[1]).toMatchObject({ observedAt: 50, error: null })
  })

  it('does not attribute a reused endpoint to a different runtime identity', async () => {
    const previous = [
      {
        pairing: pairings[0],
        dashboard: dashboard('old-runtime'),
        observedAt: 10,
        checkedAt: 10,
        error: null
      }
    ]
    const replacement = { ...pairings[0], publicKeyB64: 'different-key' }
    const [host] = await refreshFleet(
      [replacement],
      previous,
      async () => {
        throw new Error('Connection refused')
      },
      () => 50
    )
    expect(host).toMatchObject({ dashboard: null, observedAt: null, error: 'Connection refused' })
  })

  it('drops stale data when the same runtime rotates its watch grant', async () => {
    const previous = [
      {
        pairing: pairings[0],
        dashboard: dashboard('runtime-0'),
        observedAt: 10,
        checkedAt: 10,
        error: null
      }
    ]
    const rotated = { ...pairings[0], deviceToken: 'rotated-grant' }
    const [host] = await refreshFleet(
      [rotated],
      previous,
      async () => {
        throw new Error('Connection refused')
      },
      () => 50
    )
    expect(host).toMatchObject({ dashboard: null, observedAt: null, error: 'Connection refused' })
  })

  it('stops queued hosts and rejects late results after cancellation', async () => {
    const abort = new AbortController()
    const release: (() => void)[] = []
    const fetched: string[] = []
    const pending = refreshFleet(
      pairings,
      [],
      async (offer) => {
        fetched.push(offer.endpoint)
        await new Promise<void>((resolve) => release.push(resolve))
        return dashboard(offer.endpoint)
      },
      () => 100,
      abort.signal
    )
    await Promise.resolve()
    expect(fetched).toHaveLength(3)
    abort.abort()
    release.forEach((done) => done())
    await expect(pending).rejects.toThrow('cancelled')
    expect(fetched).toHaveLength(3)
  })
})
