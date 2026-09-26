import { describe, expect, it } from 'vitest'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import type { WearAgentPage } from '../packages/wear-companion-contract/src/agent-page'
import { acceptAgentPage, type AgentPageRequest } from './agent-page-repository'

const now = 1_800_000_000_000
const hash = 'a'.repeat(64)
const request: AgentPageRequest = {
  bindingId: 'binding-a',
  requestId: 'request-a',
  actionHash: hash,
  hostId: 'host-a',
  cursor: null,
  offset: 0
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
const page: WearAgentPage = {
  schemaVersion: 1,
  bindingId: 'binding-a',
  requestId: 'request-a',
  actionHash: hash,
  publisherEpoch: 'epoch-a',
  revision: 4,
  hostId: 'host-a',
  inventoryKey: hash,
  inventoryAuthority: 'authoritative',
  cursor: null,
  generatedAt: now,
  expiresAt: now + 30_000,
  total: 0,
  offset: 0,
  agents: [],
  nextCursor: null
}
const native = {
  bindingId: 'binding-a',
  requestId: 'request-a',
  actionHash: hash,
  publisherEpoch: 'epoch-a',
  revision: 4,
  expiresAt: page.expiresAt,
  serialized: JSON.stringify(page)
}

describe('watch agent PAGE correlation', () => {
  it('accepts only the current selected host and exact pending action', () => {
    expect(acceptAgentPage(native, request, dashboard, now)).toEqual(page)
    expect(acceptAgentPage(native, { ...request, hostId: 'host-b' }, dashboard, now)).toBeNull()
    expect(
      acceptAgentPage(native, { ...request, actionHash: 'b'.repeat(64) }, dashboard, now)
    ).toBeNull()
    expect(acceptAgentPage(native, { ...request, offset: 1 }, dashboard, now)).toBeNull()
    expect(acceptAgentPage(native, request, { ...dashboard, revision: 5 }, now)).toBeNull()
    expect(acceptAgentPage(native, request, dashboard, dashboard.expiresAt)).toBeNull()
  })

  it('rejects wrong native header and sensitive extra fields', () => {
    expect(
      acceptAgentPage({ ...native, publisherEpoch: 'other' }, request, dashboard, now)
    ).toBeNull()
    expect(
      acceptAgentPage(
        { ...native, serialized: JSON.stringify({ ...page, deviceToken: 'secret' }) },
        request,
        dashboard,
        now
      )
    ).toBeNull()
  })
})
