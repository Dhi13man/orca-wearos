import { describe, expect, it } from 'vitest'
import {
  decodeWearNotificationPage,
  encodeWearNotificationPage,
  type WearNotificationPage
} from './notification-page'

const now = 1_800_000_000_000
const page: WearNotificationPage = {
  schemaVersion: 1,
  bindingId: 'binding',
  requestId: 'request',
  actionHash: 'a'.repeat(64),
  publisherEpoch: 'epoch',
  revision: 2,
  cursor: null,
  generatedAt: now,
  expiresAt: now + 60_000,
  hostId: 'host',
  hostName: 'Machine',
  hostIndex: 0,
  totalHosts: 1,
  hostState: 'ready',
  items: [{ eventKey: '1', kind: 'terminal-bell', notificationAt: now - 100 }],
  omitted: 0,
  nextCursor: null
}

describe('Wear notification PAGE contract', () => {
  it('accepts bounded peer clock skew without extending absolute expiry', () => {
    const fullLifetime = { ...page, expiresAt: now + 120_000 }
    const encoded = encodeWearNotificationPage(fullLifetime)
    expect(decodeWearNotificationPage(encoded, now - 30_000).ok).toBe(true)
    expect(decodeWearNotificationPage(encoded, now - 30_001).ok).toBe(false)
    expect(decodeWearNotificationPage(encoded, fullLifetime.expiresAt).ok).toBe(false)
  })

  it('accepts a bounded transient page and rejects undisclosed fields', () => {
    expect(decodeWearNotificationPage(encodeWearNotificationPage(page), now)).toEqual({
      ok: true,
      page
    })
    expect(decodeWearNotificationPage(JSON.stringify({ ...page, body: 'secret' }), now).ok).toBe(
      false
    )
    expect(
      decodeWearNotificationPage(
        JSON.stringify({ ...page, items: [{ ...page.items[0], title: 'secret' }] }),
        now
      ).ok
    ).toBe(false)
    expect(decodeWearNotificationPage(JSON.stringify({ ...page, hostIndex: 1 }), now).ok).toBe(
      false
    )
    expect(decodeWearNotificationPage(JSON.stringify(page), page.expiresAt).ok).toBe(false)
  })
})
