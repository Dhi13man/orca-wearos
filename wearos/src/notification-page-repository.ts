import type { WearNativeHostPage } from '@orca/expo-wear-data-layer'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import {
  decodeWearNotificationPage,
  type WearNotificationPage
} from '../packages/wear-companion-contract/src/notification-page'

export type NotificationPageRequest = {
  bindingId: string
  requestId: string
  actionHash: string
  cursor: string | null
  index: number
}

export function acceptNotificationPage(
  native: WearNativeHostPage,
  request: NotificationPageRequest,
  dashboard: WearDashboard,
  now: number
): WearNotificationPage | null {
  const decoded = decodeWearNotificationPage(native.serialized, now)
  if (!decoded.ok) {
    return null
  }
  const page = decoded.page
  if (
    native.bindingId !== request.bindingId ||
    native.requestId !== request.requestId ||
    native.actionHash !== request.actionHash ||
    native.publisherEpoch !== dashboard.publisherEpoch ||
    native.revision !== dashboard.revision ||
    native.expiresAt !== page.expiresAt ||
    page.bindingId !== request.bindingId ||
    page.requestId !== request.requestId ||
    page.actionHash !== request.actionHash ||
    page.publisherEpoch !== dashboard.publisherEpoch ||
    page.revision !== dashboard.revision ||
    page.cursor !== request.cursor ||
    page.hostIndex !== request.index ||
    dashboard.bindingId !== request.bindingId ||
    dashboard.expiresAt <= now
  ) {
    return null
  }
  return page
}
