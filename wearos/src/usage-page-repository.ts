import {
  decodeWearUsagePage,
  type WearUsagePage
} from '../packages/wear-companion-contract/src/usage-page'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import type { WearNativeHostPage } from '@orca/expo-wear-data-layer'
import { matchesWearPageEnvelope } from './wear-page-correlation'
import type { HostPageRequest } from './host-page-repository'

export function acceptUsagePage(
  native: WearNativeHostPage,
  request: HostPageRequest,
  dashboard: WearDashboard,
  now: number
): WearUsagePage | null {
  const decoded = decodeWearUsagePage(native.serialized, now)
  if (
    !decoded.ok ||
    !matchesWearPageEnvelope(native, decoded.page, request, dashboard, now) ||
    decoded.page.total !== dashboard.usagePage.total
  ) {
    return null
  }
  return decoded.page
}
