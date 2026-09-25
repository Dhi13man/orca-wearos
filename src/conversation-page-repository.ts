import type { WearNativeHostPage } from '@orca/expo-wear-data-layer'
import {
  decodeWearConversationPage,
  type WearConversationPage
} from '../packages/wear-companion-contract/src/conversation-page'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'

export type ConversationPageRequest = {
  bindingId: string
  requestId: string
  actionHash: string
  hostId: string
  workspaceId: string
  workspaceKind: 'worktree' | 'folder'
  sessionTabId: string
  targetPublicationEpoch: string
  targetSnapshotVersion: number
}

export function acceptConversationPage(
  native: WearNativeHostPage,
  request: ConversationPageRequest,
  dashboard: WearDashboard,
  now: number
): WearConversationPage | null {
  const decoded = decodeWearConversationPage(native.serialized, now)
  if (!decoded.ok) {
    return null
  }
  const page = decoded.page
  return native.bindingId === request.bindingId &&
    native.requestId === request.requestId &&
    native.actionHash === request.actionHash &&
    native.publisherEpoch === dashboard.publisherEpoch &&
    native.revision === dashboard.revision &&
    native.expiresAt === page.expiresAt &&
    page.bindingId === request.bindingId &&
    page.requestId === request.requestId &&
    page.actionHash === request.actionHash &&
    page.publisherEpoch === dashboard.publisherEpoch &&
    page.revision === dashboard.revision &&
    page.hostId === request.hostId &&
    page.workspaceId === request.workspaceId &&
    page.workspaceKind === request.workspaceKind &&
    page.sessionTabId === request.sessionTabId &&
    page.targetPublicationEpoch === request.targetPublicationEpoch &&
    page.targetSnapshotVersion === request.targetSnapshotVersion &&
    dashboard.bindingId === request.bindingId &&
    dashboard.expiresAt > now
    ? page
    : null
}
