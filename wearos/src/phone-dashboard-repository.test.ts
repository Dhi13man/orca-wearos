import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readPhoneDashboard } from './phone-dashboard-repository'

const readNative = vi.hoisted(() => vi.fn())
vi.mock('@orca/expo-wear-data-layer', () => ({
  wearDataLayer: { readDashboard: readNative }
}))

const bindingId = '42c9a78b-6988-4d3c-99b7-bbe6495460f3'
const publisherEpoch = 'da30a553-af4f-42ab-9e67-fdfe4433af28'
const now = 1_800_000_000_000
const dashboard = {
  schemaVersion: 1,
  bindingId,
  publisherEpoch,
  revision: 1,
  generatedAt: now,
  expiresAt: now + 60_000,
  companionState: 'connected',
  hostPage: { total: 0, included: 0, truncated: false, nextCursor: null },
  usagePage: { total: 0, included: 0, truncated: false, nextCursor: null },
  usageGroups: [],
  hosts: []
} as const

beforeEach(() => {
  readNative.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

describe('bound phone dashboard read', () => {
  it('accepts a strictly decoded snapshot only when all native envelope fences match', async () => {
    readNative.mockResolvedValue({
      bindingId,
      publisherEpoch,
      revision: 1,
      expiresAt: dashboard.expiresAt,
      serialized: JSON.stringify(dashboard)
    })
    expect(await readPhoneDashboard(bindingId)).toEqual({ state: 'ready', dashboard })
    expect(readNative).toHaveBeenCalledWith(bindingId)

    readNative.mockResolvedValueOnce({
      bindingId,
      publisherEpoch,
      revision: 2,
      expiresAt: dashboard.expiresAt,
      serialized: JSON.stringify(dashboard)
    })
    expect(await readPhoneDashboard(bindingId)).toEqual({
      state: 'rejected',
      reason: 'invalid-dashboard'
    })
  })

  it('rejects stale data and never renders unknown dashboard fields', async () => {
    readNative.mockResolvedValue({
      bindingId,
      publisherEpoch,
      revision: 1,
      expiresAt: dashboard.expiresAt,
      serialized: JSON.stringify(dashboard)
    })
    vi.setSystemTime(dashboard.expiresAt)
    expect(await readPhoneDashboard(bindingId)).toEqual({
      state: 'rejected',
      reason: 'expired'
    })
    readNative.mockResolvedValueOnce({
      bindingId,
      publisherEpoch,
      revision: 1,
      expiresAt: dashboard.expiresAt,
      serialized: JSON.stringify({ ...dashboard, deviceToken: 'secret' })
    })
    vi.setSystemTime(now)
    expect(await readPhoneDashboard(bindingId)).toEqual({
      state: 'rejected',
      reason: 'invalid-dashboard'
    })
  })

  it('expires a native read that settles after the deadline', async () => {
    let resolveRead: (value: unknown) => void = () => {}
    readNative.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve
      })
    )
    const pending = readPhoneDashboard(bindingId)
    vi.setSystemTime(dashboard.expiresAt)
    resolveRead({
      bindingId,
      publisherEpoch,
      revision: 1,
      expiresAt: dashboard.expiresAt,
      serialized: JSON.stringify(dashboard)
    })
    expect(await pending).toEqual({ state: 'rejected', reason: 'expired' })
  })
})
