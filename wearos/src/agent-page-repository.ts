import {
  decodeWearAgentPage,
  type WearAgentPage
} from '../packages/wear-companion-contract/src/agent-page'
import type { WearDashboard } from '../packages/wear-companion-contract/src/dashboard'
import type { WearNativeHostPage } from '@orca/expo-wear-data-layer'
import { matchesWearPageEnvelope } from './wear-page-correlation'

export type AgentPageRequest = {
  bindingId: string
  requestId: string
  actionHash: string
  hostId: string
  cursor: string | null
  offset: number
}

export function acceptAgentPage(
  native: WearNativeHostPage,
  request: AgentPageRequest,
  dashboard: WearDashboard,
  now: number
): WearAgentPage | null {
  const decoded = decodeWearAgentPage(native.serialized, now)
  if (!decoded.ok) {
    return null
  }
  const page = decoded.page
  if (
    !matchesWearPageEnvelope(native, page, request, dashboard, now) ||
    page.hostId !== request.hostId
  ) {
    return null
  }
  return page
}
