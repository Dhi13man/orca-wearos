import { describe, expect, it } from 'vitest'
import { decodeWearAction } from '../packages/wear-companion-contract/src/action'
import type { WearAgentRow } from '../packages/wear-companion-contract/src/agent-page'
import type { WearConversationPage } from '../packages/wear-companion-contract/src/conversation-page'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import { encodeWearReplyAction } from './wear-reply-action'

const now = 1_800_000_000_000
const dashboard: WearDashboard = {
  schemaVersion: 1,
  bindingId: 'binding',
  publisherEpoch: 'epoch',
  revision: 4,
  generatedAt: now,
  expiresAt: now + 45_000,
  companionState: 'connected',
  hostPage: { total: 0, included: 0, truncated: false, nextCursor: null },
  usagePage: { total: 0, included: 0, truncated: false, nextCursor: null },
  usageGroups: [],
  hosts: []
}
const agent: WearAgentRow = {
  workspaceId: 'workspace',
  workspaceKind: 'folder',
  sessionTabId: 'tab',
  kind: 'terminal',
  title: 'Disposable agent',
  state: 'waiting',
  freshness: 'fresh',
  updatedAt: now,
  freshUntil: now + 45_000,
  targetPublicationEpoch: 'target',
  targetSnapshotVersion: 7
}
const page: WearConversationPage = {
  schemaVersion: 1,
  bindingId: 'binding',
  requestId: 'read',
  actionHash: 'a'.repeat(64),
  publisherEpoch: 'epoch',
  revision: 4,
  hostId: 'host',
  workspaceId: 'workspace',
  workspaceKind: 'folder',
  sessionTabId: 'tab',
  targetPublicationEpoch: 'target',
  targetSnapshotVersion: 7,
  generatedAt: now,
  expiresAt: now + 30_000,
  kind: 'terminal',
  contentScope: 'text-only',
  messages: [],
  hasOlder: false
}
const input = { dashboard, hostId: 'host', agent, page, requestId: 'reply', text: 'hello', now }

describe('watch reply target fence', () => {
  it('encodes a bounded exact-target terminal action', () => {
    const result = decodeWearAction(encodeWearReplyAction(input), now)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.action).toMatchObject({
      bindingId: 'binding',
      requestId: 'reply',
      action: 'sendAgentMessage',
      expiresAt: now + 30_000,
      target: {
        hostId: 'host',
        workspaceId: 'workspace',
        workspaceKind: 'folder',
        sessionTabId: 'tab'
      },
      targetPublicationEpoch: 'target',
      targetSnapshotVersion: 7,
      payload: { text: 'hello' }
    })
  })

  it('encodes the same exact-target action for a matching structured conversation', () => {
    const result = decodeWearAction(
      encodeWearReplyAction({
        ...input,
        agent: { ...agent, kind: 'structured' },
        page: { ...page, kind: 'structured' }
      }),
      now
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.action.target.sessionTabId).toBe('tab')
      expect(result.action.payload.text).toBe('hello')
    }
  })

  it('rejects stale or changed read authority', () => {
    expect(() =>
      encodeWearReplyAction({ ...input, page: { ...page, targetSnapshotVersion: 8 } })
    ).toThrow()
    expect(() =>
      encodeWearReplyAction({ ...input, dashboard: { ...dashboard, revision: 5 } })
    ).toThrow()
    expect(() => encodeWearReplyAction({ ...input, now: page.expiresAt })).toThrow()
    expect(() => encodeWearReplyAction({ ...input, hostId: 'other' })).toThrow()
  })

  it('rejects a conversation kind mismatch or over-limit text', () => {
    expect(() =>
      encodeWearReplyAction({ ...input, agent: { ...agent, kind: 'structured' } })
    ).toThrow()
    expect(() =>
      encodeWearReplyAction({ ...input, agent: { ...agent, workspaceKind: null } })
    ).toThrow()
    expect(() => encodeWearReplyAction({ ...input, text: '😀'.repeat(600) })).toThrow()
  })
})
