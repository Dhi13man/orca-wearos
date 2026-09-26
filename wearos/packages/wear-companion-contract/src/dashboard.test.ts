import { describe, expect, it } from 'vitest'
import {
  decodeWearDashboard,
  encodeWearDashboard,
  WEAR_DASHBOARD_MAX_PLAINTEXT_BYTES,
  type WearDashboard
} from './dashboard'

const now = 1_800_000_000_000
const groupKey = 'c4c67006-8492-4f45-93fb-6501e4c34891'

function dashboard(): WearDashboard {
  return {
    schemaVersion: 1,
    bindingId: 'binding-1',
    publisherEpoch: 'phone-epoch-1',
    revision: 3,
    generatedAt: now,
    expiresAt: now + 86_400_000,
    companionState: 'connected',
    hostPage: { total: 1, included: 1, truncated: false, nextCursor: null },
    usagePage: { total: 1, included: 1, truncated: false, nextCursor: null },
    usageGroups: [
      {
        groupKey,
        provider: 'claude',
        identityConfidence: 'unverified',
        sourceHostIds: ['host-1'],
        readingHostId: 'host-1',
        providerUsage: {
          status: 'ok',
          session: { usedPercent: 18.5, windowMinutes: 300, resetsAt: now + 300_000 },
          weekly: null,
          updatedAt: now
        }
      }
    ],
    hosts: [
      {
        hostId: 'host-1',
        displayName: 'Desktop',
        connectionState: 'connected',
        inventoryAuthority: 'authoritative',
        usageGroupKeys: { claude: groupKey, codex: null },
        agentCounts: { total: 2, working: 1, needsAttention: 1 },
        lastActivityAt: now
      }
    ]
  }
}

describe('Wear dashboard admission', () => {
  it('reserves the native authenticated-envelope overhead inside the wire cap', () => {
    expect(WEAR_DASHBOARD_MAX_PLAINTEXT_BYTES + 133).toBe(32_768)
    expect(decodeWearDashboard(' '.repeat(WEAR_DASHBOARD_MAX_PLAINTEXT_BYTES + 1), now)).toEqual({
      ok: false,
      reason: 'too-large'
    })
  })

  it('round-trips the bounded active-provider dashboard and expires at the exact deadline', () => {
    const encoded = encodeWearDashboard(dashboard())
    expect(decodeWearDashboard(encoded, now)).toEqual({ ok: true, dashboard: dashboard() })
    expect(decodeWearDashboard(encoded, now + 86_400_000)).toEqual({ ok: false, reason: 'expired' })
  })

  it.each([
    [
      'account email',
      (value: WearDashboard) => {
        Object.assign(value.usageGroups[0], { email: 'private@example.com' })
      }
    ],
    [
      'organization identifier',
      (value: WearDashboard) => {
        Object.assign(value.usageGroups[0].providerUsage, { organizationId: 'org-1' })
      }
    ],
    [
      'inactive account',
      (value: WearDashboard) => {
        Object.assign(value.usageGroups[0], { inactiveAccounts: [] })
      }
    ],
    [
      'reset description',
      (value: WearDashboard) => {
        Object.assign(value.usageGroups[0].providerUsage.session, { resetDescription: 'private' })
      }
    ],
    [
      'runtime target',
      (value: WearDashboard) => {
        Object.assign(value.usageGroups[0].providerUsage, { target: 'wsl' })
      }
    ],
    [
      'workspace name',
      (value: WearDashboard) => {
        Object.assign(value.hosts[0], { workspaceName: 'secret path' })
      }
    ],
    [
      'notification body',
      (value: WearDashboard) => {
        Object.assign(value.hosts[0], { notificationBody: 'secret' })
      }
    ],
    [
      'raw account ID as group key',
      (value: WearDashboard) => {
        value.usageGroups[0].groupKey = 'account-1'
        value.hosts[0].usageGroupKeys.claude = 'account-1'
      }
    ],
    [
      'unverified merge',
      (value: WearDashboard) => {
        value.usageGroups[0].sourceHostIds.push('host-2')
      }
    ],
    [
      'wrong provider reference',
      (value: WearDashboard) => {
        value.hosts[0].usageGroupKeys.codex = groupKey
      }
    ],
    [
      'wrong source host reference',
      (value: WearDashboard) => {
        value.usageGroups[0].sourceHostIds = ['host-2']
      }
    ],
    [
      'reading outside group',
      (value: WearDashboard) => {
        value.usageGroups[0].readingHostId = 'host-2'
      }
    ],
    [
      'duplicate account group',
      (value: WearDashboard) => {
        value.usageGroups.push({
          ...value.usageGroups[0],
          groupKey: '3d17375f-fd95-4812-b0e7-766a9a29b2d1'
        })
      }
    ],
    [
      'invalid percentage',
      (value: WearDashboard) => {
        value.usageGroups[0].providerUsage.session!.usedPercent = 101
      }
    ],
    [
      'oversized lifetime',
      (value: WearDashboard) => {
        value.expiresAt++
      }
    ],
    [
      'incomplete page without cursor',
      (value: WearDashboard) => {
        value.hostPage.total = 2
        value.hostPage.truncated = true
      }
    ]
  ])('rejects %s', (_name, mutate) => {
    const value = dashboard()
    mutate(value)
    expect(decodeWearDashboard(JSON.stringify(value), now)).toEqual({
      ok: false,
      reason: 'invalid-dashboard'
    })
  })

  it('rejects noncanonical duplicate fields, oversized bytes, and malformed Unicode', () => {
    const value = dashboard()
    const duplicate = encodeWearDashboard(value).replace(
      '"schemaVersion":1,',
      '"schemaVersion":1,"schemaVersion":1,'
    )
    expect(decodeWearDashboard(duplicate, now)).toEqual({ ok: false, reason: 'invalid-dashboard' })
    expect(decodeWearDashboard(' '.repeat(32_769), now)).toEqual({ ok: false, reason: 'too-large' })
    value.hosts[0].displayName = '\ud800'
    expect(() => encodeWearDashboard(value)).toThrow('Invalid Wear dashboard')
  })

  it('rejects a future-dated dashboard instead of extending its lifetime', () => {
    const value = dashboard()
    value.generatedAt += 86_400_000
    value.expiresAt += 86_400_000
    expect(decodeWearDashboard(JSON.stringify(value), now)).toEqual({
      ok: false,
      reason: 'invalid-dashboard'
    })
  })
})
