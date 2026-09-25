import { beforeEach, describe, expect, it, vi } from 'vitest'

const secure = vi.hoisted(() => ({
  value: null as string | null,
  getItemAsync: vi.fn(async () => secure.value),
  setItemAsync: vi.fn(async (_key: string, value: string) => {
    secure.value = value
  }),
  deleteItemAsync: vi.fn(async () => {
    secure.value = null
  })
}))
vi.mock('expo-secure-store', () => ({ ...secure, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1 }))

describe('durable watch phone handoff reservation', () => {
  beforeEach(() => {
    vi.resetModules()
    secure.value = null
    vi.clearAllMocks()
  })

  it('reserves once across concurrent calls and recovers after restart', async () => {
    const record = {
      bindingId: 'binding',
      requestId: 'first',
      actionHash: 'a'.repeat(64),
      targetKey: '["binding","host","workspace"]'
    }
    const first = await import('./wear-handoff-record')
    expect(
      await Promise.all([
        first.reserveWearHandoffRecord(record),
        first.reserveWearHandoffRecord({ ...record, requestId: 'second' })
      ])
    ).toEqual([true, false])
    vi.resetModules()
    const reopened = await import('./wear-handoff-record')
    expect(await reopened.loadWearHandoffRecord()).toEqual(record)
    expect(await reopened.reserveWearHandoffRecord({ ...record, requestId: 'third' })).toBe(false)
    await reopened.clearWearHandoffRecord({ ...record, actionHash: 'b'.repeat(64) })
    expect(await reopened.loadWearHandoffRecord()).toEqual(record)
    await reopened.clearWearHandoffRecord(record)
    expect(await reopened.loadWearHandoffRecord()).toBeNull()
  })
})
