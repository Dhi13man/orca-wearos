import { describe, expect, it } from 'vitest'
import { decodeWearAction } from '../packages/wear-companion-contract/src/action'
import type { WearAgentRow } from '../packages/wear-companion-contract/src/agent-page'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import { encodeWearHandoffAction } from './wear-handoff-action'

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
  title: 'Existing agent',
  state: 'waiting',
  freshness: 'fresh',
  updatedAt: now,
  freshUntil: now + 45_000,
  targetPublicationEpoch: 'target',
  targetSnapshotVersion: 7
}
const input = { dashboard, hostId: 'host', agent, requestId: 'handoff', now }

describe('watch phone handoff action', () => {
  it('encodes the current terminal target with its exact publication fence', () => {
    const decoded = decodeWearAction(encodeWearHandoffAction(input), now)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.action).toMatchObject({
        action: 'requestPhoneHandoff',
        requestId: 'handoff',
        payload: {},
        target: {
          hostId: 'host',
          workspaceId: 'workspace',
          workspaceKind: 'folder',
          sessionTabId: 'tab'
        },
        targetPublicationEpoch: 'target',
        targetSnapshotVersion: 7,
        publisherEpoch: 'epoch',
        expectedRevision: 4
      })
    }
  })

  it('encodes an exact structured target for phone handoff', () => {
    const decoded = decodeWearAction(
      encodeWearHandoffAction({ ...input, agent: { ...agent, kind: 'structured' } }),
      now
    )
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.action.target.sessionTabId).toBe('tab')
    }
  })

  it('rejects an expired dashboard or missing workspace kind before sending', () => {
    expect(() => encodeWearHandoffAction({ ...input, now: dashboard.expiresAt })).toThrow()
    expect(() =>
      encodeWearHandoffAction({ ...input, agent: { ...agent, workspaceKind: null } })
    ).toThrow()
  })
})
