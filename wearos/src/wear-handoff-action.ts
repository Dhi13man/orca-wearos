import { encodeWearAction } from '../packages/wear-companion-contract/src/action'
import type { WearAgentRow } from '../packages/wear-companion-contract/src/agent-page'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'

export function encodeWearHandoffAction(input: {
  dashboard: WearDashboard
  hostId: string
  agent: WearAgentRow
  requestId: string
  now: number
}): string {
  const { dashboard, hostId, agent, now } = input
  if (!agent.workspaceKind || dashboard.expiresAt <= now) {
    throw new Error('Wear phone handoff target is stale or unsupported')
  }
  return encodeWearAction({
    schemaVersion: 1,
    bindingId: dashboard.bindingId,
    requestId: input.requestId,
    expiresAt: Math.min(now + 60_000, dashboard.expiresAt),
    action: 'requestPhoneHandoff',
    target: {
      hostId,
      workspaceId: agent.workspaceId,
      workspaceKind: agent.workspaceKind,
      sessionTabId: agent.sessionTabId
    },
    publisherEpoch: dashboard.publisherEpoch,
    expectedRevision: dashboard.revision,
    targetPublicationEpoch: agent.targetPublicationEpoch,
    targetSnapshotVersion: agent.targetSnapshotVersion,
    payload: {}
  })
}
