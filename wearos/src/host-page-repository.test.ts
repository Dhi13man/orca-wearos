import { describe, expect, it } from 'vitest'
import { acceptHostPage, type HostPageRequest } from './host-page-repository'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import type { WearHostPage } from '../packages/wear-companion-contract/src/host-page'

const now = 1_800_000_000_000
const bindingId = 'binding'
const publisherEpoch = 'epoch'
const request: HostPageRequest = {
  bindingId,
  requestId: 'request',
  actionHash: 'a'.repeat(64),
  cursor: null,
  offset: 0
}
const dashboard: WearDashboard = {
  schemaVersion: 1,
  bindingId,
  publisherEpoch,
  revision: 7,
  generatedAt: now,
  expiresAt: now + 60_000,
  companionState: 'connected',
  hostPage: { total: 0, included: 0, truncated: false, nextCursor: null },
  usagePage: { total: 0, included: 0, truncated: false, nextCursor: null },
  usageGroups: [],
  hosts: []
}
const page: WearHostPage = {
  schemaVersion: 1,
  bindingId,
  requestId: request.requestId,
  actionHash: request.actionHash,
  publisherEpoch,
  revision: 7,
  cursor: null,
  generatedAt: now,
  expiresAt: now + 30_000,
  total: 0,
  offset: 0,
  hosts: [],
  nextCursor: null
}
const native = {
  bindingId,
  requestId: request.requestId,
  actionHash: request.actionHash,
  publisherEpoch,
  revision: 7,
  expiresAt: page.expiresAt,
  serialized: JSON.stringify(page)
}

describe('host PAGE request correlation', () => {
  it('accepts only the exact pending action under the current dashboard', () => {
    expect(acceptHostPage(native, request, dashboard, now)).toEqual(page)
    expect(
      acceptHostPage(native, { ...request, actionHash: 'b'.repeat(64) }, dashboard, now)
    ).toBeNull()
    expect(acceptHostPage(native, { ...request, cursor: 'previous' }, dashboard, now)).toBeNull()
    expect(acceptHostPage(native, { ...request, offset: 1 }, dashboard, now)).toBeNull()
    expect(acceptHostPage(native, request, { ...dashboard, revision: 8 }, now)).toBeNull()
    expect(acceptHostPage(native, request, dashboard, dashboard.expiresAt)).toBeNull()
  })

  it('rejects native metadata changes and unexpected fields in page contents', () => {
    expect(
      acceptHostPage({ ...native, expiresAt: page.expiresAt + 1 }, request, dashboard, now)
    ).toBeNull()
    expect(
      acceptHostPage(
        { ...native, serialized: JSON.stringify({ ...page, token: 'secret' }) },
        request,
        dashboard,
        now
      )
    ).toBeNull()
  })
})
