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
vi.mock('expo-secure-store', () => ({
  ...secure,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1
}))

describe('durable watch reply reservation', () => {
  beforeEach(() => {
    vi.resetModules()
    secure.value = null
    vi.clearAllMocks()
  })

  it('allows only one concurrent request and recovers it after module reload', async () => {
    const record = {
      bindingId: 'binding',
      requestId: 'first',
      actionHash: 'a'.repeat(64),
      targetKey: JSON.stringify(['binding', 'host', 'workspace', 'folder', 'tab', 'epoch', 7]),
      agentTitle: 'Agent',
      machineName: 'Machine'
    }
    const first = await import('./wear-reply-record')
    expect(
      await Promise.all([
        first.reserveWearReplyRecord(record),
        first.reserveWearReplyRecord({ ...record, requestId: 'second' })
      ])
    ).toEqual([true, false])
    vi.resetModules()
    const reopened = await import('./wear-reply-record')
    expect(await reopened.loadWearReplyRecord()).toEqual(record)
    expect(reopened.describeWearReplyTarget(record)).toContain('workspace workspace, tab tab')
    expect(await reopened.reserveWearReplyRecord({ ...record, requestId: 'third' })).toBe(false)
    await reopened.clearWearReplyRecord(record)
    expect(await reopened.loadWearReplyRecord()).toBeNull()
  })
})
