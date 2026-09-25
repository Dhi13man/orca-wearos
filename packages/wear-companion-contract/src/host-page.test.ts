import { describe, expect, it } from 'vitest'
import { decodeWearHostPage, encodeWearHostPage, type WearHostPage } from './host-page'

const now = 1_800_000_000_000
const host = {
  hostId: 'host-a',
  displayName: 'Office',
  connectionState: 'connected' as const,
  inventoryAuthority: 'authoritative' as const,
  usageGroupKeys: { claude: null, codex: null },
  agentCounts: { total: 2, working: 1, needsAttention: 1 },
  lastActivityAt: now
}

function page(): WearHostPage {
  return {
    schemaVersion: 1,
    bindingId: 'binding-a',
    requestId: 'request-a',
    actionHash: 'a'.repeat(64),
    publisherEpoch: 'epoch-a',
    revision: 4,
    cursor: `${'b'.repeat(64)}:3`,
    generatedAt: now,
    expiresAt: now + 120_000,
    total: 20,
    offset: 3,
    hosts: [host],
    nextCursor: `${'b'.repeat(64)}:4`
  }
}

describe('Wear host page', () => {
  it('accepts bounded peer clock skew without extending absolute expiry', () => {
    const encoded = encodeWearHostPage(page())
    expect(decodeWearHostPage(encoded, now - 30_000).ok).toBe(true)
    expect(decodeWearHostPage(encoded, now - 30_001).ok).toBe(false)
    expect(decodeWearHostPage(encoded, now + 120_000).ok).toBe(false)
  })

  it('round trips a request-correlated page and expires it', () => {
    const encoded = encodeWearHostPage(page())
    expect(decodeWearHostPage(encoded, now)).toEqual({ ok: true, page: page() })
    expect(decodeWearHostPage(encoded, now + 120_000)).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects unknown fields, duplicate hosts, false cursors, and oversized pages', () => {
    const valid = page()
    expect(
      decodeWearHostPage(JSON.stringify({ ...valid, rpcMethod: 'terminal.send' }), now).ok
    ).toBe(false)
    expect(decodeWearHostPage(JSON.stringify({ ...valid, hosts: [host, host] }), now).ok).toBe(
      false
    )
    expect(decodeWearHostPage(JSON.stringify({ ...valid, nextCursor: 'other' }), now).ok).toBe(
      false
    )
    expect(decodeWearHostPage(JSON.stringify({ ...valid, nextCursor: valid.cursor }), now).ok).toBe(
      false
    )
    expect(decodeWearHostPage(JSON.stringify({ ...valid, offset: 19 }), now).ok).toBe(false)
    expect(
      decodeWearHostPage(
        JSON.stringify({ ...valid, generatedAt: now + 30_001, expiresAt: now + 150_001 }),
        now
      ).ok
    ).toBe(false)
    expect(
      decodeWearHostPage(
        JSON.stringify({
          ...valid,
          hosts: Array.from({ length: 17 }, (_, index) => ({ ...host, hostId: `host-${index}` }))
        }),
        now
      ).ok
    ).toBe(false)
    expect(
      decodeWearHostPage(
        JSON.stringify({ ...valid, hosts: [{ ...host, displayName: 'x'.repeat(32_768) }] }),
        now
      )
    ).toEqual({ ok: false, reason: 'too-large' })
  })
})
