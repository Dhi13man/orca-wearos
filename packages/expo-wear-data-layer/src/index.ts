import { requireOptionalNativeModule } from 'expo-modules-core'
import type { WearReceiptReason } from '@orca/wear-companion-contract/receipt'

export type WearCompanionState = {
  role: 'phone' | 'watch'
  phase:
    | 'starting'
    | 'unsupported'
    | 'unbound'
    | 'waitingForPeer'
    | 'confirmFingerprint'
    | 'pendingRecovery'
    | 'bound'
    | 'cancelled'
  bindings?: { bindingId: string; nodeId: string }[]
  nodeId?: string
  fingerprint?: string
  bindingId?: string
  error?:
    | 'transportUnavailable'
    | 'timeout'
    | 'unknown'
    | 'busy'
    | 'pendingRecovery'
    | 'unavailable'
}

export type WearPeer = { id: string; displayName: string; nearby: boolean }
export type WearNativeDashboard = {
  bindingId: string
  publisherEpoch: string
  revision: number
  expiresAt: number
  serialized: string
}
export type WearNativeHostPage = WearNativeDashboard & {
  requestId: string
  actionHash: string
}
export type WearClaimedAction = {
  bindingId: string
  requestId: string
  actionHash: string
  claimToken: string
  expiresAt: number
  canonical: string
}
export type WearJournalRecord = {
  bindingId: string
  requestId: string
  actionHash: string
  actionName: string
  state: 'recorded' | 'effect_started' | 'accepted' | 'rejected' | 'unknown'
  expiresAt: number
  reason: WearReceiptReason | null
}
export type WearJournalHandoff = 'recorded' | 'already_recorded' | 'conflict' | 'missing' | 'full'
export type WearWatchActionRecord = {
  bindingId: string
  requestId: string
  actionHash: string
  status: 'pending' | 'accepted' | 'rejected' | 'unknown'
  reason: WearReceiptReason | null
  expiresAt: number
}

type WearDataLayerModule = {
  addListener(
    eventName: 'onState',
    listener: (state: WearCompanionState) => void
  ): { remove(): void }
  addListener(
    eventName: 'onDashboardChanged',
    listener: (event: { bindingId: string }) => void
  ): { remove(): void }
  addListener(
    eventName: 'onActionChanged',
    listener: (event: { bindingId: string; requestId: string }) => void
  ): { remove(): void }
  addListener(
    eventName: 'onPageChanged',
    listener: (event: { bindingId: string; requestId: string }) => void
  ): { remove(): void }
  getState(): WearCompanionState
  getPushToken(): Promise<string | null>
  requestText(label: string): Promise<string | null>
  isBackgroundRefreshActive(runId: number): boolean
  completeBackgroundRefresh(runId: number): void
  setDirectPairingIdentity(identity: string): void
  getDirectSnapshotSlot(): { slot: number; identity: string } | null
  publishDirectSnapshotSlot(runId: number, identity: string, slot: number): boolean
  discoverPeers(): Promise<WearPeer[]>
  beginEnrollment(nodeId: string): Promise<void>
  confirmEnrollment(fingerprint: string): Promise<void>
  retryEnrollment(): Promise<void>
  cancelEnrollment(nodeId: string): Promise<void>
  reserveDashboardRevision(bindingId: string): Promise<number>
  publishDashboard(
    bindingId: string,
    publisherEpoch: string,
    revision: number,
    expiresAt: number,
    serialized: string
  ): Promise<void>
  isDashboardPublished(
    bindingId: string,
    publisherEpoch: string,
    revision: number
  ): Promise<boolean>
  readDashboard(bindingId: string): Promise<WearNativeDashboard | null>
  sendHostPage(bindingId: string, requestId: string, serialized: string): Promise<void>
  sendUsagePage(bindingId: string, requestId: string, serialized: string): Promise<void>
  sendAgentPage(bindingId: string, requestId: string, serialized: string): Promise<void>
  sendConversationPage(bindingId: string, requestId: string, serialized: string): Promise<void>
  sendNotificationsPage(bindingId: string, requestId: string, serialized: string): Promise<void>
  readHostPage(bindingId: string, requestId: string): Promise<WearNativeHostPage | null>
  readUsagePage(bindingId: string, requestId: string): Promise<WearNativeHostPage | null>
  readAgentPage(bindingId: string, requestId: string): Promise<WearNativeHostPage | null>
  readConversationPage(bindingId: string, requestId: string): Promise<WearNativeHostPage | null>
  readNotificationsPage(bindingId: string, requestId: string): Promise<WearNativeHostPage | null>
  claimAction(): Promise<WearClaimedAction | null>
  commitActionHandoff(
    bindingId: string,
    requestId: string,
    actionHash: string,
    claimToken: string,
    canonical: string
  ): Promise<WearJournalHandoff>
  journalAction(bindingId: string, requestId: string): Promise<WearJournalRecord | null>
  startActionEffect(bindingId: string, requestId: string, actionHash: string): Promise<boolean>
  finishActionEffect(
    bindingId: string,
    requestId: string,
    actionHash: string,
    outcome: 'accepted' | 'rejected' | 'unknown',
    reason: WearReceiptReason | null
  ): Promise<boolean>
  sendJournalReceipt(bindingId: string, requestId: string): Promise<void>
  pendingJournalReceipts(): Promise<{ bindingId: string; requestId: string }[]>
  pendingJournalReconciliation(): Promise<
    {
      bindingId: string
      requestId: string
      actionHash: string
      hostId: string
      state: 'effect_started' | 'unknown'
    }[]
  >
  sendAction(
    canonical: string
  ): Promise<'transmitted' | 'unknown' | 'duplicate' | 'conflict' | 'full'>
  readAction(bindingId: string, requestId: string): Promise<WearWatchActionRecord | null>
}

export const wearDataLayer = requireOptionalNativeModule<WearDataLayerModule>('ExpoWearDataLayer')
