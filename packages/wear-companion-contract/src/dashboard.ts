import { utf8Length } from './utf8'

export type WearUsageWindow = {
  usedPercent: number
  windowMinutes: number
  resetsAt: number | null
}

export type WearProviderUsage = {
  status: 'idle' | 'fetching' | 'ok' | 'error' | 'unavailable'
  session: WearUsageWindow | null
  weekly: WearUsageWindow | null
  updatedAt: number
}

export type WearUsageGroup = {
  groupKey: string
  provider: 'claude' | 'codex'
  identityConfidence: 'verified' | 'unverified'
  sourceHostIds: string[]
  readingHostId: string
  providerUsage: WearProviderUsage
}

export type WearDashboardHost = {
  hostId: string
  displayName: string
  connectionState: 'connected' | 'disconnected' | 'auth-failed' | 'unverifiable' | 'incompatible'
  inventoryAuthority: 'authoritative' | 'incomplete' | 'unavailable'
  usageGroupKeys: { claude: string | null; codex: string | null }
  agentCounts: { total: number; working: number; needsAttention: number }
  lastActivityAt: number | null
}

export type WearDashboard = {
  schemaVersion: 1
  bindingId: string
  publisherEpoch: string
  revision: number
  generatedAt: number
  expiresAt: number
  companionState: 'connected' | 'offline' | 'incompatible' | 'revoked' | 'unavailable'
  hostPage: { total: number; included: number; truncated: boolean; nextCursor: string | null }
  usagePage: { total: number; included: number; truncated: boolean; nextCursor: string | null }
  usageGroups: WearUsageGroup[]
  hosts: WearDashboardHost[]
}

export type DashboardDecodeResult =
  | { ok: true; dashboard: WearDashboard }
  | { ok: false; reason: 'too-large' | 'invalid-dashboard' | 'expired' }

// Dashboard envelope: 133 bytes of v1 header, nonce, and GCM tag surround the plaintext.
export const WEAR_DASHBOARD_MAX_PLAINTEXT_BYTES = 32_768 - 133
const MAX_BYTES = WEAR_DASHBOARD_MAX_PLAINTEXT_BYTES
const MAX_ID_BYTES = 256
const MAX_LABEL_BYTES = 256
const MAX_AGE_MS = 86_400_000
const MAX_CLOCK_SKEW_MS = 300_000
const GROUP_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exact(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name))
  )
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && utf8Length(value) <= MAX_ID_BYTES
}

function groupKey(value: unknown): value is string {
  return typeof value === 'string' && GROUP_KEY.test(value)
}

function usageWindow(value: unknown): value is WearUsageWindow {
  return (
    exact(value, ['usedPercent', 'windowMinutes', 'resetsAt']) &&
    typeof value.usedPercent === 'number' &&
    Number.isFinite(value.usedPercent) &&
    value.usedPercent >= 0 &&
    value.usedPercent <= 100 &&
    timestamp(value.windowMinutes) &&
    value.windowMinutes > 0 &&
    (value.resetsAt === null || timestamp(value.resetsAt))
  )
}

function providerUsage(value: unknown): value is WearProviderUsage {
  return (
    exact(value, ['status', 'session', 'weekly', 'updatedAt']) &&
    ['idle', 'fetching', 'ok', 'error', 'unavailable'].includes(value.status as string) &&
    (value.session === null || usageWindow(value.session)) &&
    (value.weekly === null || usageWindow(value.weekly)) &&
    timestamp(value.updatedAt)
  )
}

export function isWearUsageGroup(value: unknown): value is WearUsageGroup {
  return (
    exact(value, [
      'groupKey',
      'provider',
      'identityConfidence',
      'sourceHostIds',
      'readingHostId',
      'providerUsage'
    ]) &&
    groupKey(value.groupKey) &&
    ['claude', 'codex'].includes(value.provider as string) &&
    ['verified', 'unverified'].includes(value.identityConfidence as string) &&
    Array.isArray(value.sourceHostIds) &&
    value.sourceHostIds.length > 0 &&
    value.sourceHostIds.every(id) &&
    new Set(value.sourceHostIds).size === value.sourceHostIds.length &&
    id(value.readingHostId) &&
    value.sourceHostIds.includes(value.readingHostId) &&
    (value.identityConfidence === 'verified' || value.sourceHostIds.length === 1) &&
    providerUsage(value.providerUsage)
  )
}

export function isWearDashboardHost(value: unknown): value is WearDashboardHost {
  return (
    exact(value, [
      'hostId',
      'displayName',
      'connectionState',
      'inventoryAuthority',
      'usageGroupKeys',
      'agentCounts',
      'lastActivityAt'
    ]) &&
    id(value.hostId) &&
    typeof value.displayName === 'string' &&
    value.displayName.trim().length > 0 &&
    utf8Length(value.displayName) <= MAX_LABEL_BYTES &&
    ['connected', 'disconnected', 'auth-failed', 'unverifiable', 'incompatible'].includes(
      value.connectionState as string
    ) &&
    ['authoritative', 'incomplete', 'unavailable'].includes(value.inventoryAuthority as string) &&
    exact(value.usageGroupKeys, ['claude', 'codex']) &&
    (value.usageGroupKeys.claude === null || groupKey(value.usageGroupKeys.claude)) &&
    (value.usageGroupKeys.codex === null || groupKey(value.usageGroupKeys.codex)) &&
    exact(value.agentCounts, ['total', 'working', 'needsAttention']) &&
    timestamp(value.agentCounts.total) &&
    timestamp(value.agentCounts.working) &&
    timestamp(value.agentCounts.needsAttention) &&
    value.agentCounts.working <= value.agentCounts.total &&
    value.agentCounts.needsAttention <= value.agentCounts.total &&
    (value.lastActivityAt === null || timestamp(value.lastActivityAt))
  )
}

function validDashboard(value: unknown): value is WearDashboard {
  if (
    !exact(value, [
      'schemaVersion',
      'bindingId',
      'publisherEpoch',
      'revision',
      'generatedAt',
      'expiresAt',
      'companionState',
      'hostPage',
      'usagePage',
      'usageGroups',
      'hosts'
    ]) ||
    value.schemaVersion !== 1 ||
    !id(value.bindingId) ||
    !id(value.publisherEpoch) ||
    !timestamp(value.revision) ||
    !timestamp(value.generatedAt) ||
    !timestamp(value.expiresAt) ||
    value.expiresAt <= value.generatedAt ||
    value.expiresAt - value.generatedAt > MAX_AGE_MS ||
    !['connected', 'offline', 'incompatible', 'revoked', 'unavailable'].includes(
      value.companionState as string
    ) ||
    !exact(value.hostPage, ['total', 'included', 'truncated', 'nextCursor']) ||
    !timestamp(value.hostPage.total) ||
    !timestamp(value.hostPage.included) ||
    typeof value.hostPage.truncated !== 'boolean' ||
    (value.hostPage.nextCursor !== null && !id(value.hostPage.nextCursor)) ||
    !Array.isArray(value.usageGroups) ||
    !value.usageGroups.every(isWearUsageGroup) ||
    !Array.isArray(value.hosts) ||
    !value.hosts.every(isWearDashboardHost) ||
    value.hostPage.included !== value.hosts.length ||
    value.hostPage.total < value.hosts.length ||
    value.hostPage.truncated !== value.hostPage.total > value.hosts.length ||
    value.hostPage.truncated !== (value.hostPage.nextCursor !== null) ||
    !exact(value.usagePage, ['total', 'included', 'truncated', 'nextCursor']) ||
    !timestamp(value.usagePage.total) ||
    !timestamp(value.usagePage.included) ||
    typeof value.usagePage.truncated !== 'boolean' ||
    (value.usagePage.nextCursor !== null && !id(value.usagePage.nextCursor)) ||
    value.usagePage.included !== value.usageGroups.length ||
    value.usagePage.total < value.usageGroups.length ||
    value.usagePage.truncated !== value.usagePage.total > value.usageGroups.length ||
    value.usagePage.truncated !== (value.usagePage.nextCursor !== null)
  ) {
    return false
  }

  const groups = new Map(value.usageGroups.map((group) => [group.groupKey, group]))
  if (
    groups.size !== value.usageGroups.length ||
    new Set(value.hosts.map((host) => host.hostId)).size !== value.hosts.length
  ) {
    return false
  }
  const visibleHosts = new Map(value.hosts.map((host) => [host.hostId, host]))
  const sources = { claude: new Set<string>(), codex: new Set<string>() }
  for (const group of value.usageGroups) {
    for (const hostId of group.sourceHostIds) {
      if (sources[group.provider].has(hostId)) {
        return false
      }
      sources[group.provider].add(hostId)
      const visible = visibleHosts.get(hostId)
      if (visible && visible.usageGroupKeys[group.provider] !== group.groupKey) {
        return false
      }
    }
  }
  return value.hosts.every((host) =>
    (['claude', 'codex'] as const).every((provider) => {
      const key = host.usageGroupKeys[provider]
      if (key === null) {
        return true
      }
      const group = groups.get(key)
      return group?.provider === provider && group.sourceHostIds.includes(host.hostId)
    })
  )
}

export function decodeWearDashboard(serialized: string, now: number): DashboardDecodeResult {
  if (utf8Length(serialized) > MAX_BYTES) {
    return { ok: false, reason: 'too-large' }
  }
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return { ok: false, reason: 'invalid-dashboard' }
  }
  if (!validDashboard(value) || JSON.stringify(value) !== serialized) {
    return { ok: false, reason: 'invalid-dashboard' }
  }
  if (
    value.generatedAt > now + MAX_CLOCK_SKEW_MS ||
    value.expiresAt > now + MAX_AGE_MS + MAX_CLOCK_SKEW_MS
  ) {
    return { ok: false, reason: 'invalid-dashboard' }
  }
  if (value.expiresAt <= now) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true, dashboard: value }
}

export function encodeWearDashboard(dashboard: WearDashboard): string {
  const serialized = JSON.stringify(dashboard)
  const decoded = decodeWearDashboard(serialized, dashboard.generatedAt)
  if (!decoded.ok) {
    throw new Error(`Invalid Wear dashboard: ${decoded.reason}`)
  }
  return serialized
}
