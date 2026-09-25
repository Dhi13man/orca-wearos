import { describe, expect, it } from 'vitest'
import type {
  WearDashboard,
  WearUsageGroup
} from '../packages/wear-companion-contract/src/dashboard'
import type { WearUsagePage } from '../packages/wear-companion-contract/src/usage-page'
import { acceptUsagePage } from './usage-page-repository'

const now = 1_800_000_000_000
const group: WearUsageGroup = {
  groupKey: 'c4c67006-8492-4f45-93fb-6501e4c34891',
  provider: 'claude',
  identityConfidence: 'unverified',
  sourceHostIds: ['host-1'],
  readingHostId: 'host-1',
  providerUsage: { status: 'ok', session: null, weekly: null, updatedAt: now }
}
const dashboard: WearDashboard = {
  schemaVersion: 1,
  bindingId: 'binding',
  publisherEpoch: 'phone',
  revision: 7,
  generatedAt: now,
  expiresAt: now + 60_000,
  companionState: 'connected',
  hostPage: { total: 0, included: 0, truncated: false, nextCursor: null },
  usagePage: { total: 1, included: 0, truncated: true, nextCursor: 'start' },
  usageGroups: [],
  hosts: []
}
const page: WearUsagePage = {
  schemaVersion: 1,
  bindingId: 'binding',
  requestId: 'request',
  actionHash: 'a'.repeat(64),
  publisherEpoch: 'phone',
  revision: 7,
  cursor: 'start',
  generatedAt: now,
  expiresAt: now + 30_000,
  total: 1,
  offset: 0,
  groups: [group],
  nextCursor: null
}
const native = {
  bindingId: 'binding',
  requestId: 'request',
  actionHash: 'a'.repeat(64),
  publisherEpoch: 'phone',
  revision: 7,
  expiresAt: page.expiresAt,
  serialized: JSON.stringify(page)
}
const request = {
  bindingId: 'binding',
  requestId: 'request',
  actionHash: 'a'.repeat(64),
  cursor: 'start',
  offset: 0
}

describe('Wear usage PAGE correlation', () => {
  it('accepts only the current request, snapshot revision, and total', () => {
    expect(acceptUsagePage(native, request, dashboard, now)).toEqual(page)
    expect(
      acceptUsagePage(native, { ...request, actionHash: 'b'.repeat(64) }, dashboard, now)
    ).toBeNull()
    expect(acceptUsagePage(native, request, { ...dashboard, revision: 8 }, now)).toBeNull()
    expect(
      acceptUsagePage(
        native,
        request,
        { ...dashboard, usagePage: { ...dashboard.usagePage, total: 2 } },
        now
      )
    ).toBeNull()
    expect(acceptUsagePage(native, request, dashboard, page.expiresAt)).toBeNull()
    expect(
      acceptUsagePage(
        { ...native, serialized: JSON.stringify({ ...page, credential: 'secret' }) },
        request,
        dashboard,
        now
      )
    ).toBeNull()
  })
})
