import { AppState, StyleSheet, Text, View } from 'react-native'
import { useEffect, useState } from 'react'
import type { WearAgentRow } from '../packages/wear-companion-contract/src/agent-page'
import { WearButton } from './wear-button'
import { wearColors } from './wear-theme'

function agentState(agent: WearAgentRow, available: boolean, now: number): string {
  if (!available) {
    return 'Status unverified'
  }
  if (
    agent.freshness === 'fresh' &&
    agent.state &&
    agent.freshUntil !== null &&
    agent.freshUntil > now
  ) {
    return agent.state === 'working'
      ? 'Working'
      : agent.state === 'blocked'
        ? 'Blocked'
        : agent.state === 'waiting'
          ? 'Waiting'
          : 'Done'
  }
  return agent.freshness === 'unavailable' ? 'Status unavailable' : 'Status stale'
}

export function AgentPagesView({
  hostName,
  backLabel,
  status,
  agents,
  total,
  nextCursor,
  inventoryAuthority,
  onBack,
  onLoad,
  onSelectAgent
}: {
  hostName: string
  backLabel: string
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  agents: WearAgentRow[]
  total: number
  nextCursor: string | null
  inventoryAuthority: 'authoritative' | 'incomplete' | 'unavailable' | null
  onBack: () => void
  onLoad: (cursor: string | null) => void
  onSelectAgent: (agent: WearAgentRow) => void
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const next = agents.reduce<number | null>(
      (earliest, agent) =>
        agent.freshUntil !== null && agent.freshUntil > now
          ? Math.min(earliest ?? agent.freshUntil, agent.freshUntil)
          : earliest,
      null
    )
    if (next === null) {
      return
    }
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, next - Date.now()))
    return () => clearTimeout(timer)
  }, [agents, now])
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setNow(Date.now())
      }
    })
    return () => listener.remove()
  }, [])
  return (
    <View style={styles.section}>
      <WearButton label={backLabel} quiet onPress={onBack} />
      <Text accessibilityRole="header" style={styles.heading}>
        {hostName} agents
      </Text>
      {agents.map((agent) => (
        <View key={`${agent.workspaceId}\0${agent.sessionTabId}`} style={styles.card}>
          <Text style={styles.title}>{agent.title}</Text>
          <Text style={styles.detail}>
            {agent.kind === 'structured' ? 'Structured' : 'Terminal'} ·{' '}
            {agentState(agent, status !== 'unavailable', now)}
          </Text>
          {status === 'ready' && agent.workspaceKind !== null ? (
            <WearButton label="Open conversation" quiet onPress={() => onSelectAgent(agent)} />
          ) : null}
          <Text style={styles.detail}>
            {agent.workspaceKind === null
              ? 'Workspace kind unverified'
              : agent.workspaceKind === 'folder'
                ? 'Folder workspace'
                : 'Git worktree'}
          </Text>
        </View>
      ))}
      {status === 'ready' ? (
        <Text style={styles.detail}>
          Showing {agents.length} of {total} agents.
          {inventoryAuthority !== 'authoritative' ? ' Inventory incomplete.' : ''}
        </Text>
      ) : null}
      {status === 'loading' ? <Text style={styles.detail}>Loading from phone…</Text> : null}
      {status === 'unavailable' ? (
        <Text accessibilityRole="alert" style={styles.detail}>
          Agent inventory changed or phone response is unavailable. Refresh to try again.
        </Text>
      ) : null}
      {status === 'ready' && nextCursor ? (
        <WearButton label="More agents" onPress={() => onLoad(nextCursor)} />
      ) : null}
      {status !== 'loading' && status !== 'idle' ? (
        <WearButton label="Refresh agents" quiet onPress={() => onLoad(null)} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { width: '100%', alignItems: 'center', gap: 10 },
  heading: { color: wearColors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  card: {
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: wearColors.raised,
    borderWidth: 1,
    borderColor: wearColors.border
  },
  title: { color: wearColors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  detail: { color: wearColors.secondary, fontSize: 12, textAlign: 'center', marginTop: 6 }
})
