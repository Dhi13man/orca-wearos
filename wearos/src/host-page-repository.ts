import {
  decodeWearHostPage,
  type WearHostPage
} from '../packages/wear-companion-contract/src/host-page'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import type { WearNativeHostPage } from '@orca/expo-wear-data-layer'
import { matchesWearPageEnvelope } from './wear-page-correlation'

export type HostPageRequest = {
  bindingId: string
  requestId: string
  actionHash: string
  cursor: string | null
  offset: number
}

export function acceptHostPage(
  native: WearNativeHostPage,
  request: HostPageRequest,
  dashboard: WearDashboard,
  now: number
): WearHostPage | null {
  const decoded = decodeWearHostPage(native.serialized, now)
  if (!decoded.ok) {
    return null
  }
  const page = decoded.page
  if (!matchesWearPageEnvelope(native, page, request, dashboard, now)) {
    return null
  }
  return page
}
