import {
  decodeWearDashboard,
  type WearDashboard
} from '../packages/wear-companion-contract/src/dashboard'
import { wearDataLayer } from '@orca/expo-wear-data-layer'

export type PhoneDashboardRead =
  | { state: 'missing' }
  | { state: 'rejected'; reason: 'too-large' | 'invalid-dashboard' | 'expired' }
  | { state: 'ready'; dashboard: WearDashboard }

export async function readPhoneDashboard(bindingId: string): Promise<PhoneDashboardRead> {
  if (!wearDataLayer) {
    throw new Error('Wear Data Layer is unavailable')
  }
  const native = await wearDataLayer.readDashboard(bindingId)
  if (!native) {
    return { state: 'missing' }
  }
  const decoded = decodeWearDashboard(native.serialized, Date.now())
  if (!decoded.ok) {
    return { state: 'rejected', reason: decoded.reason }
  }
  const dashboard = decoded.dashboard
  if (
    native.bindingId !== bindingId ||
    dashboard.bindingId !== native.bindingId ||
    dashboard.publisherEpoch !== native.publisherEpoch ||
    dashboard.revision !== native.revision ||
    dashboard.expiresAt !== native.expiresAt
  ) {
    return { state: 'rejected', reason: 'invalid-dashboard' }
  }
  return { state: 'ready', dashboard }
}
