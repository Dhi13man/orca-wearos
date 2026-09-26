import { describe, expect, it } from 'vitest'
import { decodeWearAgentPage, encodeWearAgentPage, type WearAgentPage } from './agent-page'

const now = 1_800_000_000_000
const key = 'a'.repeat(64)
const agent = {
  workspaceId: 'folder-a',
  workspaceKind: 'folder' as const,
  sessionTabId: 'tab-a',
  kind: 'structured' as const,
  title: 'Review agent',
  state: null,
  freshness: 'unavailable' as const,
  updatedAt: null,
  freshUntil: null,
  targetPublicationEpoch: 'snapshot-a',
  targetSnapshotVersion: 3
}
const page: WearAgentPage = {
  schemaVersion: 1,
  bindingId: 'binding-a',
  requestId: 'request-a',
  actionHash: key,
  publisherEpoch: 'epoch-a',
  revision: 4,
  hostId: 'host-a',
  inventoryKey: key,
  inventoryAuthority: 'authoritative',
  cursor: null,
  generatedAt: now,
  expiresAt: now + 120_000,
  total: 2,
  offset: 0,
  agents: [agent],
  nextCursor: `${key}:1`
}

describe('Wear agent PAGE', () => {
  it('accepts bounded peer clock skew without extending absolute expiry', () => {
    const encoded = encodeWearAgentPage(page)
    expect(decodeWearAgentPage(encoded, now - 30_000).ok).toBe(true)
    expect(decodeWearAgentPage(encoded, now - 30_001).ok).toBe(false)
    expect(decodeWearAgentPage(encoded, page.expiresAt).ok).toBe(false)
  })

  it('round trips an exact request-bound page and expires it', () => {
    expect(decodeWearAgentPage(encodeWearAgentPage(page), now)).toEqual({ ok: true, page })
    expect(decodeWearAgentPage(JSON.stringify(page), now + 120_000)).toEqual({
      ok: false,
      reason: 'expired'
    })
    const second = { ...page, cursor: `${key}:1`, offset: 1, total: 2, nextCursor: null }
    expect(decodeWearAgentPage(JSON.stringify(second), now).ok).toBe(true)
  })

  it('rejects credentials, duplicate agents, false cursor progress and false freshness', () => {
    expect(decodeWearAgentPage(JSON.stringify({ ...page, token: 'secret' }), now).ok).toBe(false)
    expect(
      decodeWearAgentPage(
        JSON.stringify({ ...page, agents: [agent, agent], total: 3, nextCursor: `${key}:2` }),
        now
      ).ok
    ).toBe(false)
    expect(decodeWearAgentPage(JSON.stringify({ ...page, nextCursor: 'other' }), now).ok).toBe(
      false
    )
    expect(
      decodeWearAgentPage(
        JSON.stringify({ ...page, agents: [{ ...agent, state: 'working' }] }),
        now
      ).ok
    ).toBe(false)
    expect(
      decodeWearAgentPage(
        JSON.stringify({
          ...page,
          agents: [
            {
              ...agent,
              freshness: 'fresh',
              state: 'working',
              updatedAt: now + 400_000,
              freshUntil: now + 500_000
            }
          ]
        }),
        now
      ).ok
    ).toBe(false)
    expect(
      decodeWearAgentPage(
        JSON.stringify({ ...page, agents: [{ ...agent, title: 'x'.repeat(32_768) }] }),
        now
      )
    ).toEqual({ ok: false, reason: 'too-large' })
  })
})
