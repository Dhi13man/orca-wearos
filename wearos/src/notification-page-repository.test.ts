import { describe, expect, it } from 'vitest'
import {
  acceptNotificationPage,
  type NotificationPageRequest
} from './notification-page-repository'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import type { WearNotificationPage } from '../packages/wear-companion-contract/src/notification-page'

const now = 1_800_000_000_000
const request: NotificationPageRequest = {
  bindingId: 'binding',
  requestId: 'request',
  actionHash: 'a'.repeat(64),
  cursor: null,
  index: 0
}
const dashboard: WearDashboard = {
  schemaVersion: 1,
  bindingId: 'binding',
  publisherEpoch: 'epoch',
  revision: 7,
  generatedAt: now,
  expiresAt: now + 60_000,
  companionState: 'connected',
  hostPage: { total: 1, included: 1, truncated: false, nextCursor: null },
  usagePage: { total: 0, included: 0, truncated: false, nextCursor: null },
  usageGroups: [],
  hosts: []
}
const page: WearNotificationPage = {
  schemaVersion: 1,
  bindingId: 'binding',
  requestId: 'request',
  actionHash: request.actionHash,
  publisherEpoch: 'epoch',
  revision: 7,
  cursor: null,
  generatedAt: now,
  expiresAt: now + 30_000,
  hostId: 'host',
  hostName: 'Machine',
  hostIndex: 0,
  totalHosts: 1,
  hostState: 'ready',
  items: [],
  omitted: 0,
  nextCursor: null
}
const native = {
  bindingId: 'binding',
  requestId: 'request',
  actionHash: request.actionHash,
  publisherEpoch: 'epoch',
  revision: 7,
  expiresAt: page.expiresAt,
  serialized: JSON.stringify(page)
}

describe('notification PAGE correlation', () => {
  it('accepts only the pending action under the current unexpired dashboard', () => {
    expect(acceptNotificationPage(native, request, dashboard, now)).toEqual(page)
    expect(
      acceptNotificationPage(native, { ...request, actionHash: 'b'.repeat(64) }, dashboard, now)
    ).toBeNull()
    expect(acceptNotificationPage(native, { ...request, index: 1 }, dashboard, now)).toBeNull()
    expect(acceptNotificationPage(native, request, { ...dashboard, revision: 8 }, now)).toBeNull()
    expect(acceptNotificationPage(native, request, dashboard, dashboard.expiresAt)).toBeNull()
    expect(
      acceptNotificationPage({ ...native, expiresAt: page.expiresAt + 1 }, request, dashboard, now)
    ).toBeNull()
    expect(
      acceptNotificationPage(
        { ...native, serialized: JSON.stringify({ ...page, body: 'secret' }) },
        request,
        dashboard,
        now
      )
    ).toBeNull()
  })
})
