import type { WearNativeHostPage } from '@orca/expo-wear-data-layer'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'

type PageEnvelope = {
  bindingId: string
  requestId: string
  actionHash: string
  publisherEpoch: string
  revision: number
  expiresAt: number
  cursor: string | null
  offset: number
}

type PendingPage = Pick<
  PageEnvelope,
  'bindingId' | 'requestId' | 'actionHash' | 'cursor' | 'offset'
>

export function matchesWearPageEnvelope(
  native: WearNativeHostPage,
  page: PageEnvelope,
  request: PendingPage,
  dashboard: WearDashboard,
  now: number
): boolean {
  return (
    native.bindingId === request.bindingId &&
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
    page.cursor === request.cursor &&
    page.offset === request.offset &&
    dashboard.bindingId === request.bindingId &&
    dashboard.expiresAt > now
  )
}
