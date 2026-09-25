import { StyleSheet, Text, View } from 'react-native'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type {
  WearDashboard,
  WearProviderUsage
} from '../packages/wear-companion-contract/src/dashboard'
import type { PhoneDashboardView } from './use-phone-dashboard'
import { WearButton } from './wear-button'
import { useUsagePages } from './use-wear-pages'
import { wearColors } from './wear-theme'

export type DashboardPage = 'Attention' | 'Agents' | 'Usage'

function snapshotLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

const USAGE_STALE_AFTER_MS = 10 * 60_000

function usageLabel(usage: WearProviderUsage, sourceConnected: boolean, now: number): string {
  const session = usage.session
  const weekly = usage.weekly
  const current =
    sourceConnected && usage.updatedAt > 0 && now - usage.updatedAt <= USAGE_STALE_AFTER_MS
  if (!session && !weekly) {
    return !current
      ? 'Usage not recently verified'
      : usage.status === 'fetching'
        ? 'Updating'
        : usage.status === 'idle'
          ? 'Waiting for usage'
          : usage.status === 'ok'
            ? 'No usage window reported'
            : 'Usage unavailable'
  }
  const percent = (value: number) => `${Math.round(value * 10) / 10}%`
  const reading = [
    session ? `${percent(session.usedPercent)} session` : null,
    weekly ? `${percent(weekly.usedPercent)} weekly` : null
  ]
    .filter(Boolean)
    .join(' · ')
  return usage.status === 'ok' && current ? reading : `Last known · ${reading}`
}

function usageWindowDetails(window: NonNullable<WearProviderUsage['session']>): string {
  const minutes = window.windowMinutes
  const duration =
    minutes % 10_080 === 0
      ? `${minutes / 10_080}w`
      : minutes % 1_440 === 0
        ? `${minutes / 1_440}d`
        : minutes % 60 === 0
          ? `${minutes / 60}h`
          : `${minutes}m`
  return `${duration} window${window.resetsAt === null ? '' : ` · reset time ${snapshotLabel(window.resetsAt)}`}`
}

function PageNotice({ children }: { children: ReactNode }) {
  return <Text style={styles.notice}>{children}</Text>
}

function AttentionPage({ dashboard }: { dashboard: WearDashboard }) {
  const current = dashboard.hosts.filter((host) => host.inventoryAuthority === 'authoritative')
  const needsAttention = current.reduce((count, host) => count + host.agentCounts.needsAttention, 0)
  const incomplete = dashboard.hosts.filter(
    (host) => host.inventoryAuthority !== 'authoritative'
  ).length
  return (
    <View style={styles.section}>
      <View style={styles.card}>
        <Text style={styles.largeNumber}>
          {current.length > 0 || dashboard.hostPage.total === 0 ? needsAttention : '—'}
        </Text>
        <Text style={styles.cardTitle}>agents needed attention in this snapshot</Text>
        <Text style={styles.secondary}>
          {incomplete > 0
            ? `${incomplete} host ${incomplete === 1 ? 'inventory is' : 'inventories are'} incomplete`
            : 'From inventories at snapshot time'}
        </Text>
      </View>
      {dashboard.hostPage.truncated ? (
        <PageNotice>
          Showing {dashboard.hostPage.included} of {dashboard.hostPage.total} paired hosts.
        </PageNotice>
      ) : null}
      <PageNotice>Agent names and recent events need a live phone detail response.</PageNotice>
    </View>
  )
}

export function connectionLabel(state: WearDashboard['hosts'][number]['connectionState']) {
  switch (state) {
    case 'connected':
      return 'Connected'
    case 'auth-failed':
      return 'Authentication unavailable'
    case 'incompatible':
      return 'Incompatible'
    case 'disconnected':
    case 'unverifiable':
      return 'Connection unverifiable'
  }
}
function AgentsPage({
  dashboard,
  onAllMachines
}: {
  dashboard: WearDashboard
  onAllMachines: () => void
}) {
  return (
    <View style={styles.section}>
      {dashboard.hosts.length === 0 ? <PageNotice>No paired machines reported.</PageNotice> : null}
      {dashboard.hosts.map((host) => (
        <View key={host.hostId} style={styles.card} accessible accessibilityRole="summary">
          <Text style={styles.cardTitle}>{host.displayName}</Text>
          <Text style={styles.secondary}>
            {connectionLabel(host.connectionState)} ·{' '}
            {host.inventoryAuthority === 'authoritative'
              ? `${host.agentCounts.total} agents`
              : `${host.agentCounts.total} cached agents`}
          </Text>
          {host.inventoryAuthority === 'authoritative' ? (
            <Text style={styles.detail}>
              At snapshot: {host.agentCounts.working} working · {host.agentCounts.needsAttention}{' '}
              needed attention
            </Text>
          ) : (
            <Text style={styles.detail}>Inventory {host.inventoryAuthority} at snapshot</Text>
          )}
        </View>
      ))}
      {dashboard.hostPage.truncated ? (
        <PageNotice>
          Showing {dashboard.hostPage.included} of {dashboard.hostPage.total} paired hosts.
        </PageNotice>
      ) : null}
      <WearButton label="All machines" quiet onPress={onAllMachines} />
    </View>
  )
}

function UsagePage({ dashboard }: { dashboard: WearDashboard }) {
  const { state, load } = useUsagePages(dashboard)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const next = state.groups
      .map((group) => group.providerUsage.updatedAt + USAGE_STALE_AFTER_MS + 1)
      .filter((deadline) => deadline > now)
      .sort((a, b) => a - b)[0]
    if (next === undefined) {
      return
    }
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()))
    return () => clearTimeout(timer)
  }, [now, state.groups])
  return (
    <View style={styles.section}>
      {state.groups.length === 0 ? (
        <PageNotice>
          {dashboard.usagePage.total > 0
            ? 'Usage groups were omitted from this snapshot.'
            : 'No active Claude or Codex usage reported.'}
        </PageNotice>
      ) : null}
      {state.groups.map((group) => {
        const readingHost = dashboard.hosts.find((host) => host.hostId === group.readingHostId)
        return (
          <View key={group.groupKey} style={styles.card} accessible accessibilityRole="summary">
            <Text style={styles.cardTitle}>
              {group.provider === 'claude' ? 'Claude' : 'Codex'} ·{' '}
              {group.identityConfidence === 'verified' ? 'Verified account' : 'Unverified account'}
            </Text>
            <Text style={styles.detail}>
              {usageLabel(group.providerUsage, readingHost?.connectionState === 'connected', now)}
            </Text>
            {group.providerUsage.session ? (
              <Text style={styles.secondary}>
                Session: {usageWindowDetails(group.providerUsage.session)}
              </Text>
            ) : null}
            {group.providerUsage.weekly ? (
              <Text style={styles.secondary}>
                Weekly: {usageWindowDetails(group.providerUsage.weekly)}
              </Text>
            ) : null}
            <Text style={styles.secondary}>
              {group.providerUsage.updatedAt > 0
                ? `Last reported ${snapshotLabel(group.providerUsage.updatedAt)} · `
                : ''}
              {group.sourceHostIds.length}{' '}
              {group.sourceHostIds.length === 1 ? 'machine' : 'machines'}
            </Text>
            <Text style={styles.secondary}>
              Reading from {readingHost?.displayName ?? group.readingHostId}
            </Text>
          </View>
        )
      })}
      {state.nextCursor ? (
        <PageNotice>
          Showing {state.groups.length} of {state.total} account groups.
        </PageNotice>
      ) : null}
      {state.nextCursor && state.status !== 'unavailable' ? (
        <WearButton
          label={state.status === 'loading' ? 'Loading…' : 'More accounts'}
          disabled={state.status === 'loading'}
          quiet
          onPress={() => void load(state.nextCursor)}
        />
      ) : null}
      {state.status === 'unavailable' ? (
        <PageNotice>More account groups are unavailable. Refresh from phone to retry.</PageNotice>
      ) : null}
      <PageNotice>Only active Claude and Codex accounts are included.</PageNotice>
    </View>
  )
}

export function DashboardPages({
  page,
  view,
  onAllMachines,
  refresh
}: {
  page: DashboardPage
  view: PhoneDashboardView
  onAllMachines: () => void
  refresh: {
    status: 'idle' | 'pending' | 'accepted' | 'rejected' | 'unknown'
    refresh: () => Promise<void>
  }
}) {
  if (view.state !== 'ready') {
    return (
      <PageNotice>
        {view.state === 'missing'
          ? 'Waiting for a dashboard from your phone.'
          : view.state === 'unavailable'
            ? 'Phone dashboard is unavailable. Try again when connected.'
            : view.reason === 'expired'
              ? 'Phone snapshot expired. Reconnect to refresh.'
              : 'Phone snapshot could not be read safely.'}
      </PageNotice>
    )
  }
  const { dashboard } = view
  return (
    <View style={styles.section}>
      {page === 'Attention' ? <AttentionPage dashboard={dashboard} /> : null}
      {page === 'Agents' ? (
        <AgentsPage dashboard={dashboard} onAllMachines={onAllMachines} />
      ) : null}
      {page === 'Usage' ? <UsagePage dashboard={dashboard} /> : null}
      <Text style={styles.secondary}>
        Phone snapshot sent {snapshotLabel(dashboard.generatedAt)}
      </Text>
      <WearButton
        label={refresh.status === 'pending' ? 'Refreshing…' : 'Refresh from phone'}
        disabled={refresh.status === 'pending'}
        quiet
        onPress={() => void refresh.refresh()}
      />
      {refresh.status === 'unknown' ? (
        <PageNotice>
          Phone refresh is uncertain. Check the snapshot time before retrying.
        </PageNotice>
      ) : null}
      {refresh.status === 'rejected' ? (
        <PageNotice>Phone refresh was rejected. Reconnect and try again.</PageNotice>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { width: '100%', alignItems: 'center', gap: 10 },
  card: {
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: wearColors.raised,
    borderWidth: 1,
    borderColor: wearColors.border
  },
  largeNumber: { color: wearColors.text, fontSize: 32, fontWeight: '700', textAlign: 'center' },
  cardTitle: { color: wearColors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  detail: { color: wearColors.text, fontSize: 12, textAlign: 'center', marginTop: 6 },
  secondary: { color: wearColors.secondary, fontSize: 12, textAlign: 'center', marginTop: 6 },
  notice: { color: wearColors.secondary, fontSize: 12, textAlign: 'center', marginVertical: 6 }
})
