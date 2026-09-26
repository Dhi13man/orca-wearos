import { beforeEach, describe, expect, it, vi } from 'vitest'

const saved = vi.hoisted(() => new Map<string, string>())
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: async (key: string) => saved.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    saved.set(key, value)
  },
  deleteItemAsync: async (key: string) => {
    saved.delete(key)
  }
}))

import {
  absentReplyCanExpire,
  clearPendingReply,
  loadPendingReply,
  savePendingReply
} from './reply-receipt-store'

const bindingId = 'c70727fb-5b45-4d73-a5ec-c97e041915da'

describe('durable Wear reply receipt', () => {
  beforeEach(() => saved.clear())

  it('survives a new reader and clears only after an outcome', async () => {
    const reply = {
      bindingId,
      runtimeId: 'runtime-1',
      requestId: 'request-1',
      agentId: 'agent-1',
      expiresAt: 120_000
    }
    await savePendingReply(reply)
    expect(await loadPendingReply(bindingId)).toEqual(reply)
    await clearPendingReply(bindingId)
    expect(await loadPendingReply(bindingId)).toBeNull()
  })

  it('rejects a corrupt saved receipt instead of enabling another send', async () => {
    saved.set(`orca.wear.reply.${bindingId}`, '{"bindingId":"wrong"}')
    await expect(loadPendingReply(bindingId)).rejects.toThrow('Invalid saved reply receipt')
  })

  it('releases a crash-before-send reply only while an absent host receipt is authoritative', () => {
    const reply = {
      bindingId,
      runtimeId: 'runtime-1',
      requestId: 'request-1',
      agentId: 'agent-1',
      expiresAt: 120_000
    }
    expect(absentReplyCanExpire(reply, 180_000)).toBe(false)
    expect(absentReplyCanExpire(reply, 180_001)).toBe(true)
    expect(absentReplyCanExpire(reply, 120_000 + 24 * 60 * 60 * 1_000)).toBe(false)
  })
})
