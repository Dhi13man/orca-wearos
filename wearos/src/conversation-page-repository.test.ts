import { describe, expect, it } from 'vitest'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import type { WearConversationPage } from '../packages/wear-companion-contract/src/conversation-page'
import {
  acceptConversationPage,
  type ConversationPageRequest
} from './conversation-page-repository'

const now = 1_800_000_000_000
const hash = 'a'.repeat(64)
const request: ConversationPageRequest = {
  bindingId: 'binding-a',
  requestId: 'request-a',
  actionHash: hash,
  hostId: 'host-a',
  workspaceId: 'workspace-a',
  workspaceKind: 'worktree',
  sessionTabId: 'tab-a',
  targetPublicationEpoch: 'publication-a',
  targetSnapshotVersion: 7
}
const dashboard: WearDashboard = {
  schemaVersion: 1,
  bindingId: 'binding-a',
  publisherEpoch: 'epoch-a',
  revision: 4,
  generatedAt: now,
  expiresAt: now + 60_000,
  companionState: 'connected',
  hostPage: { total: 0, included: 0, truncated: false, nextCursor: null },
  usagePage: { total: 0, included: 0, truncated: false, nextCursor: null },
  usageGroups: [],
  hosts: []
}
const page: WearConversationPage = {
  schemaVersion: 1,
  bindingId: 'binding-a',
  requestId: 'request-a',
  actionHash: hash,
  publisherEpoch: 'epoch-a',
  revision: 4,
  hostId: 'host-a',
  workspaceId: 'workspace-a',
  workspaceKind: 'worktree',
  sessionTabId: 'tab-a',
  targetPublicationEpoch: 'publication-a',
  targetSnapshotVersion: 7,
  generatedAt: now,
  expiresAt: now + 30_000,
  kind: 'terminal',
  contentScope: 'text-only',
  messages: [
    { id: 'message-a', role: 'assistant', text: 'Hello', truncated: false, observedAt: now }
  ],
  hasOlder: false
}
const native = {
  ...dashboard,
  requestId: request.requestId,
  actionHash: hash,
  expiresAt: page.expiresAt,
  serialized: JSON.stringify(page)
}

describe('watch conversation PAGE correlation', () => {
  it('accepts the exact pending action and session fence only', () => {
    expect(acceptConversationPage(native, request, dashboard, now)).toEqual(page)
    expect(
      acceptConversationPage(native, { ...request, sessionTabId: 'other' }, dashboard, now)
    ).toBeNull()
    expect(
      acceptConversationPage(native, { ...request, targetSnapshotVersion: 8 }, dashboard, now)
    ).toBeNull()
    expect(
      acceptConversationPage(native, { ...request, actionHash: 'b'.repeat(64) }, dashboard, now)
    ).toBeNull()
    expect(acceptConversationPage(native, request, { ...dashboard, revision: 5 }, now)).toBeNull()
  })

  it('rejects changed native headers, extra payload fields and expiry', () => {
    expect(
      acceptConversationPage({ ...native, publisherEpoch: 'other' }, request, dashboard, now)
    ).toBeNull()
    expect(
      acceptConversationPage(
        { ...native, serialized: JSON.stringify({ ...page, credential: 'secret' }) },
        request,
        dashboard,
        now
      )
    ).toBeNull()
    expect(acceptConversationPage(native, request, dashboard, page.expiresAt)).toBeNull()
  })
})
