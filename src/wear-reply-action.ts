import { encodeWearAction } from '../packages/wear-companion-contract/src/action'
import type { WearAgentRow } from '../packages/wear-companion-contract/src/agent-page'
import type { WearConversationPage } from '../packages/wear-companion-contract/src/conversation-page'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'

export function encodeWearReplyAction(input: {
  dashboard: WearDashboard
  hostId: string
  agent: WearAgentRow
  page: WearConversationPage
  requestId: string
  text: string
  now: number
}): string {
  const { dashboard, hostId, agent, page, now } = input
  if (
    agent.kind !== page.kind ||
    !agent.workspaceKind ||
    dashboard.expiresAt <= now ||
    page.expiresAt <= now ||
    page.bindingId !== dashboard.bindingId ||
    page.publisherEpoch !== dashboard.publisherEpoch ||
    page.revision !== dashboard.revision ||
    page.hostId !== hostId ||
    page.workspaceId !== agent.workspaceId ||
    page.workspaceKind !== agent.workspaceKind ||
    page.sessionTabId !== agent.sessionTabId ||
    page.targetPublicationEpoch !== agent.targetPublicationEpoch ||
    page.targetSnapshotVersion !== agent.targetSnapshotVersion
  ) {
    throw new Error('Wear reply target is stale or unsupported')
  }
  return encodeWearAction({
    schemaVersion: 1,
    bindingId: dashboard.bindingId,
    requestId: input.requestId,
    expiresAt: Math.min(now + 60_000, dashboard.expiresAt, page.expiresAt),
    action: 'sendAgentMessage',
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
    payload: { text: input.text }
  })
}
