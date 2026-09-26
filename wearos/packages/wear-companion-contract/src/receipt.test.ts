import { describe, expect, it } from 'vitest'
import { decodeWearReceipt, encodeWearReceipt, type WearReceipt } from './receipt'

const receipt: WearReceipt = {
  schemaVersion: 1,
  bindingId: 'binding',
  requestId: 'request',
  actionHash: 'a'.repeat(64),
  status: 'rejected',
  reason: 'rate-limited',
  expiresAt: 120_000
}

describe('Wear receipt contract', () => {
  it('accepts bounded receiver skew while keeping sender and expiry strict', () => {
    const wire = encodeWearReceipt(receipt, 0)
    expect(decodeWearReceipt(wire, -30_000).ok).toBe(true)
    expect(decodeWearReceipt(wire, -30_001).ok).toBe(false)
    expect(decodeWearReceipt(wire, receipt.expiresAt).ok).toBe(false)
    expect(() => encodeWearReceipt(receipt, -1)).toThrow()
  })

  it('round-trips bounded accepted, rejected, and unknown outcomes', () => {
    for (const value of [
      receipt,
      { ...receipt, status: 'accepted', reason: null } as const,
      { ...receipt, status: 'unknown', reason: null } as const
    ]) {
      const wire = encodeWearReceipt(value, 0)
      expect(decodeWearReceipt(wire, 0)).toEqual({ ok: true, receipt: value })
      expect(decodeWearReceipt(wire, 120_000)).toEqual({ ok: false, reason: 'expired' })
    }
  })

  it('rejects extra fields, malformed hash/status/reason, and oversized wire', () => {
    for (const value of [
      { ...receipt, message: 'secret' },
      { ...receipt, actionHash: 'A'.repeat(64) },
      { ...receipt, status: 'accepted' },
      { ...receipt, status: 'rejected', reason: null },
      { ...receipt, requestId: 'x'.repeat(257) }
    ]) {
      expect(decodeWearReceipt(JSON.stringify(value), 0)).toEqual({
        ok: false,
        reason: 'invalid-receipt'
      })
    }
    expect(decodeWearReceipt('x'.repeat(1025), 0)).toEqual({ ok: false, reason: 'too-large' })
    expect(decodeWearReceipt('{', 0)).toEqual({ ok: false, reason: 'invalid-receipt' })
  })
})
