import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { FleetHost } from '../orca/fleet-dashboard'
import { CACHED_HOST_LIMIT } from '../orca/direct-dashboard-cache'
import { pairingEndpointLabel } from '../orca/pairing'
import type {
  WearAgentSession,
  WearProviderUsage,
  WearUsageWindow
} from '../orca/runtime-dashboard'
import { WearButton } from '../wear-button'
import { wearColors } from '../wear-theme'

export function RuntimeDashboard({
  hosts,
  refreshing,
  onForget,
  onOpenAgent,
  onRefresh
}: {
  hosts: FleetHost[]
  refreshing: boolean
  onForget: (host: FleetHost) => void
  onOpenAgent: (host: FleetHost, agent: WearAgentSession) => void
  onRefresh: () => void
}) {
  const agents = hosts.flatMap((host) =>
    (host.dashboard?.agents ?? []).map((agent) => ({ host, agent }))
  )
  agents.sort(
    (left, right) =>
      Number(left.agent.state !== 'blocked' && left.agent.state !== 'waiting') -
        Number(right.agent.state !== 'blocked' && right.agent.state !== 'waiting') ||
      (right.agent.updatedAt ?? 0) - (left.agent.updatedAt ?? 0)
  )
  const unavailableHosts = hosts.filter((host) => host.error || !host.dashboard).length
  const cachedHosts = hosts.filter((host) => host.cached && !host.error).length
  const allHostsUnverified = hosts.every((host) => host.error || !host.dashboard || host.cached)
  const currentAgents = agents.filter(({ host }) => !host.error && !host.cached)
  const needsAttention = currentAgents.filter(
    ({ agent }) => agent.state === 'blocked' || agent.state === 'waiting'
  ).length
  const working = currentAgents.filter(({ agent }) => agent.state === 'working').length
  const unverified = currentAgents.filter(({ agent }) => agent.state === 'unverifiable').length
  const recentEvents = hosts
    .flatMap((host) => (host.dashboard?.events ?? []).map((event) => ({ host, event })))
    .sort((left, right) => right.event.at - left.event.at)
  return (
    <>
      <View style={styles.header}>
        <Text accessible={false} importantForAccessibility="no" style={styles.eyebrow}>
          ORCA
        </Text>
        <Text accessibilityRole="header" style={styles.title}>
          Attention
        </Text>
      </View>
      <View style={styles.summary}>
        <Text
          accessibilityLabel={
            allHostsUnverified
              ? 'Agent count unavailable'
              : `${needsAttention} agents need attention`
          }
          style={styles.summaryNumber}
        >
          {allHostsUnverified ? '—' : needsAttention}
        </Text>
        <View style={styles.summaryCopy}>
          <Text numberOfLines={1} style={styles.summaryLabel}>
            Need attention
          </Text>
          <Text numberOfLines={1} style={styles.summaryMeta}>
            {!hosts.length
              ? 'Checking hosts…'
              : unavailableHosts
                ? `${unavailableHosts} ${unavailableHosts === 1 ? 'host' : 'hosts'} unavailable`
                : cachedHosts
                  ? `${cachedHosts} ${cachedHosts === 1 ? 'host' : 'hosts'} refreshing`
                  : unverified
                    ? `${unverified} unverified`
                    : `${working} working`}
          </Text>
        </View>
      </View>
      {hosts.length > CACHED_HOST_LIMIT ? (
        <Text style={styles.empty}>
          Background cache covers {CACHED_HOST_LIMIT} hosts; refresh for the full fleet.
        </Text>
      ) : null}
      <SectionTitle label="Agents" />
      {agents.length ? (
        agents.map(({ host, agent }) => (
          <AgentCard
            agent={agent}
            host={host}
            key={`${host.pairing.endpoint}:${agent.id}`}
            onPress={() => onOpenAgent(host, agent)}
            showHost={hosts.length > 1}
          />
        ))
      ) : (
        <Text style={styles.empty}>
          {unavailableHosts ? 'Agent inventory is unavailable.' : 'No agents published yet.'}
        </Text>
      )}
      {recentEvents.length ? <SectionTitle label="Recent events" /> : null}
      {recentEvents.map(({ host, event }) => (
        <View key={`${host.pairing.endpoint}:${event.key}`} style={styles.event}>
          <Text style={styles.cardTitle}>
            {event.kind === 'agent-task-complete' ? 'Agent task complete' : 'Terminal bell'}
          </Text>
          <Text style={styles.status}>
            {pairingEndpointLabel(host.pairing.endpoint)} · {formatAge(event.at)}
            {host.error || host.cached ? ' · stale' : ''}
          </Text>
        </View>
      ))}
      {hosts.reduce((total, host) => total + (host.dashboard?.eventsOmitted ?? 0), 0) > 0 ? (
        <Text style={styles.empty}>Older host events are omitted.</Text>
      ) : null}
      <SectionTitle label="Hosts" />
      {hosts.map((host) => (
        <HostStatus host={host} key={host.pairing.endpoint} />
      ))}
      <SectionTitle label="Usage" />
      {hosts.map((host) => (
        <View key={host.pairing.endpoint} style={styles.group}>
          {hosts.length > 1 ? (
            <Text style={styles.hostLabel}>{pairingEndpointLabel(host.pairing.endpoint)}</Text>
          ) : null}
          {host.dashboard?.usage.length ? (
            host.dashboard.usage.map((usage) => (
              <UsageCard
                key={usage.provider}
                stale={Boolean(host.error || host.cached || host.dashboard?.usageRefreshPending)}
                usage={usage}
              />
            ))
          ) : (
            <Text style={styles.empty}>
              {host.error
                ? 'Usage unavailable'
                : host.dashboard?.usageRefreshPending
                  ? 'Usage is refreshing…'
                  : 'No usage data published'}
            </Text>
          )}
        </View>
      ))}
      <WearButton
        disabled={refreshing}
        label={refreshing ? 'Refreshing…' : 'Refresh all hosts'}
        quiet
        onPress={onRefresh}
      />
      <SectionTitle label="Connections" />
      {hosts.map((host) => (
        <WearButton
          key={host.pairing.endpoint}
          label={`Forget ${pairingEndpointLabel(host.pairing.endpoint)}`}
          quiet
          onPress={() => onForget(host)}
        />
      ))}
    </>
  )
}

function HostStatus({ host }: { host: FleetHost }) {
  const label = pairingEndpointLabel(host.pairing.endpoint)
  return (
    <View style={styles.hostStatus}>
      <Text style={styles.hostLabel}>{label}</Text>
      <Text accessibilityLiveRegion="polite" style={[styles.status, host.error && styles.error]}>
        {host.error
          ? `Unavailable · ${host.error} · checked ${formatAge(host.checkedAt)}`
          : host.dashboard
            ? `${host.cached ? 'Cached read' : 'Last read'} ${formatAge(host.observedAt!)}`
            : 'Checking…'}
      </Text>
      {host.error && host.observedAt ? (
        <Text style={styles.status}>Last successful read {formatAge(host.observedAt)}</Text>
      ) : null}
      {host.dashboard?.warnings.map((warning) => (
        <Text key={warning} style={styles.status}>
          {warning}
        </Text>
      ))}
      {host.agentsOmitted ? (
        <Text style={styles.status}>{host.agentsOmitted} older agents omitted from cache</Text>
      ) : null}
    </View>
  )
}

function SectionTitle({ label }: { label: string }) {
  return (
    <Text accessibilityRole="header" style={styles.sectionTitle}>
      {label}
    </Text>
  )
}

function UsageCard({ usage, stale }: { usage: WearProviderUsage; stale: boolean }) {
  const freshness =
    stale || usage.status === 'error'
      ? 'Stale'
      : usage.status === 'fetching'
        ? 'Refreshing'
        : usage.status === 'unavailable'
          ? 'Unavailable'
          : null
  return (
    <View
      accessibilityLabel={`${usage.label} usage${freshness ? `, ${freshness.toLowerCase()}` : ''}`}
      style={styles.card}
    >
      <View style={styles.usageHeader}>
        <Text style={styles.cardTitle}>{usage.label}</Text>
        <Text style={styles.meta}>
          {freshness ? `${freshness} · ` : ''}
          {formatAge(usage.updatedAt)}
        </Text>
      </View>
      <UsageLine label="Session" window={usage.session} />
      <UsageLine label="Weekly" window={usage.weekly} />
    </View>
  )
}

function UsageLine({ label, window }: { label: string; window: WearUsageWindow | null }) {
  return (
    <Text style={styles.cardText}>
      {label} {window ? `${Math.round(window.usedPercent)}% used` : 'unavailable'}
      {window?.resetDescription ? ` · ${window.resetDescription}` : ''}
    </Text>
  )
}

function AgentCard({
  agent,
  host,
  onPress,
  showHost
}: {
  agent: WearAgentSession
  host: FleetHost
  onPress: () => void
  showHost: boolean
}) {
  const source = pairingEndpointLabel(host.pairing.endpoint)
  const state =
    host.error || host.cached
      ? 'Stale'
      : agent.state === 'unverifiable'
        ? 'Unverified'
        : agent.state
  return (
    <Pressable
      accessibilityHint={
        host.cached || host.error
          ? 'Refresh host before opening conversation'
          : 'Opens the exact host and agent conversation'
      }
      accessibilityLabel={`${agent.title}, ${agent.agent}, ${agent.state}, ${source}${host.error || host.cached ? ', stale' : ''}`}
      accessibilityRole="button"
      disabled={Boolean(host.cached || host.error)}
      onPress={onPress}
      style={({ pressed }) => [styles.agentCard, pressed && styles.pressed]}
    >
      <Text numberOfLines={1} style={styles.agentTitle}>
        {agent.worktreeLabel}
      </Text>
      <Text
        numberOfLines={1}
        style={[styles.agentDetail, agent.state === 'blocked' && styles.error]}
      >
        {agent.agent} · {state}
      </Text>
      {showHost ? (
        <Text numberOfLines={1} style={styles.agentHost}>
          {source}
        </Text>
      ) : null}
    </Pressable>
  )
}

function formatAge(timestamp: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
}

const styles = StyleSheet.create({
  header: { width: '100%', alignItems: 'center', marginBottom: 12 },
  eyebrow: { color: wearColors.muted, fontSize: 10, fontWeight: '600', letterSpacing: 1.4 },
  title: { marginTop: 2, color: wearColors.text, fontSize: 22, fontWeight: '600' },
  summary: {
    width: '100%',
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: wearColors.raised
  },
  summaryNumber: {
    width: 32,
    flexShrink: 0,
    color: wearColors.text,
    fontSize: 30,
    fontWeight: '600'
  },
  summaryCopy: { flex: 1, minWidth: 0, paddingLeft: 6 },
  summaryLabel: { color: wearColors.text, fontSize: 12, fontWeight: '600' },
  summaryMeta: { marginTop: 4, color: wearColors.secondary, fontSize: 10 },
  hostStatus: {
    width: '100%',
    marginTop: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: wearColors.raised
  },
  hostLabel: { color: wearColors.text, fontSize: 11, fontWeight: '600' },
  status: { marginTop: 4, color: wearColors.secondary, fontSize: 10, lineHeight: 14 },
  error: { color: wearColors.danger },
  sectionTitle: {
    width: '100%',
    marginBottom: 4,
    marginTop: 22,
    color: wearColors.secondary,
    fontSize: 11,
    fontWeight: '600'
  },
  group: { width: '100%', marginTop: 8 },
  card: {
    width: '100%',
    marginTop: 6,
    padding: 12,
    borderRadius: 14,
    backgroundColor: wearColors.raised
  },
  event: {
    width: '100%',
    marginTop: 6,
    padding: 12,
    borderRadius: 14,
    backgroundColor: wearColors.raised
  },
  agentCard: {
    width: '100%',
    minHeight: 72,
    marginTop: 8,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: wearColors.raised
  },
  pressed: { opacity: 0.82 },
  cardTitle: { color: wearColors.text, fontSize: 13, fontWeight: '600' },
  cardText: { marginTop: 5, color: wearColors.secondary, fontSize: 11, lineHeight: 15 },
  usageHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  agentTitle: { color: wearColors.text, fontSize: 14, fontWeight: '600' },
  agentDetail: { marginTop: 6, color: wearColors.muted, fontSize: 11 },
  agentHost: { marginTop: 3, color: wearColors.muted, fontSize: 10 },
  meta: { marginTop: 4, color: wearColors.muted, fontSize: 10 },
  empty: { width: '100%', marginTop: 6, color: wearColors.muted, fontSize: 12, textAlign: 'left' }
})
