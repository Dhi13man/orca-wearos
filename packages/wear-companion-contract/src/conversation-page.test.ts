import { describe, expect, it } from 'vitest'
import {
  decodeWearConversationPage,
  encodeWearConversationPage,
  type WearConversationPage
} from './conversation-page'

const now = 1_800_000_000_000
function page(): WearConversationPage {
  return {
    schemaVersion: 1,
    bindingId: 'binding-a',
    requestId: 'request-a',
    actionHash: 'a'.repeat(64),
    publisherEpoch: 'epoch-a',
    revision: 4,
    hostId: 'host-a',
    workspaceId: 'workspace-a',
    workspaceKind: 'folder',
    sessionTabId: 'tab-a',
    targetPublicationEpoch: 'publication-a',
    targetSnapshotVersion: 7,
    generatedAt: now,
    expiresAt: now + 120_000,
    kind: 'structured',
    contentScope: 'text-only',
    messages: [
      { id: 'message-a', role: 'assistant', text: 'Hello', truncated: false, observedAt: now }
    ],
    hasOlder: true
  }
}

describe('Wear conversation page', () => {
  it('accepts bounded peer clock skew without extending absolute expiry', () => {
    const encoded = encodeWearConversationPage(page())
    expect(decodeWearConversationPage(encoded, now - 30_000).ok).toBe(true)
    expect(decodeWearConversationPage(encoded, now - 30_001).ok).toBe(false)
    expect(decodeWearConversationPage(encoded, now + 120_000).ok).toBe(false)
  })

  it('round trips an exact target-bound text tail and expires it', () => {
    const encoded = encodeWearConversationPage(page())
    expect(decodeWearConversationPage(encoded, now)).toEqual({ ok: true, page: page() })
    expect(decodeWearConversationPage(encoded, now + 120_000)).toEqual({
      ok: false,
      reason: 'expired'
    })
  })

  it('rejects unknown fields, unbounded content and ambiguous message identity', () => {
    const valid = page()
    expect(
      decodeWearConversationPage(JSON.stringify({ ...valid, rpcMethod: 'terminal.send' }), now).ok
    ).toBe(false)
    expect(
      decodeWearConversationPage(
        JSON.stringify({ ...valid, messages: [valid.messages[0], valid.messages[0]] }),
        now
      ).ok
    ).toBe(false)
    expect(
      decodeWearConversationPage(
        JSON.stringify({ ...valid, messages: [{ ...valid.messages[0], text: '🙂'.repeat(513) }] }),
        now
      ).ok
    ).toBe(false)
    expect(
      decodeWearConversationPage(
        JSON.stringify({ ...valid, messages: [{ ...valid.messages[0], path: 'secret' }] }),
        now
      ).ok
    ).toBe(false)
    expect(
      decodeWearConversationPage(
        JSON.stringify({
          ...valid,
          messages: [{ ...valid.messages[0], text: 'x'.repeat(32_768) }]
        }),
        now
      )
    ).toEqual({ ok: false, reason: 'too-large' })
  })
})
