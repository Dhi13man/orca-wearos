import type { RuntimeStatus } from './direct-orca-client'

export type WearUsageWindow = {
  usedPercent: number
  resetDescription: string | null
  resetsAt: number | null
}

export type WearProviderUsage = {
  provider: string
  label: string
  session: WearUsageWindow | null
  weekly: WearUsageWindow | null
  updatedAt: number
  status: string
}

export type WearAgentSession = {
  id: string
  sessionTabId: string
  worktree: string
  worktreeLabel: string
  title: string
  terminal: string | null
  agent: string
  model: string | null
  state: 'working' | 'blocked' | 'waiting' | 'done' | 'unverifiable'
  prompt: string
  lastAssistantMessage: string
  updatedAt: number | null
  execution: 'local' | 'remote' | 'unverifiable'
  sessionId: string | null
  transcriptPath: string | null
  kind: 'terminal' | 'structured'
  workspaceKind: 'worktree' | 'folder'
  publicationEpoch: string
  snapshotVersion: number
}

export function canReadAgentConversation(
  agent: Pick<WearAgentSession, 'execution' | 'sessionId'>,
  available: boolean
): boolean {
  return Boolean(available && agent.sessionId && agent.execution === 'local')
}

export type WearConversationMessage = {
  id: string
  role: string
  text: string
  timestamp: number | null
}

export type WearAttentionEvent = {
  key: string
  kind: 'agent-task-complete' | 'terminal-bell'
  at: number
}

export type OrcaDashboard = {
  status: RuntimeStatus
  usage: WearProviderUsage[]
  usageRefreshPending: boolean
  agents: WearAgentSession[]
  events: WearAttentionEvent[]
  eventsOmitted: number
  warnings: string[]
}

export function parseAttentionEvents(value: unknown): {
  events: WearAttentionEvent[]
  omitted: number
} {
  const snapshot = asRecord(value)
  const raw = Array.isArray(snapshot?.events) ? snapshot.events : []
  const events = raw.slice(0, 12).flatMap((item): WearAttentionEvent[] => {
    const event = asRecord(item)
    return event &&
      typeof event.key === 'string' &&
      (event.kind === 'agent-task-complete' || event.kind === 'terminal-bell') &&
      finiteNumber(event.at) !== null
      ? [{ key: event.key, kind: event.kind, at: event.at as number }]
      : []
  })
  return {
    events,
    omitted:
      typeof snapshot?.eventsOmitted === 'number' &&
      Number.isSafeInteger(snapshot.eventsOmitted) &&
      snapshot.eventsOmitted >= 0
        ? snapshot.eventsOmitted
        : 0
  }
}

export function parseProviderUsage(value: unknown): WearProviderUsage[] {
  const snapshot = asRecord(value)
  const rateLimits = asRecord(snapshot?.rateLimits)
  if (!rateLimits) {
    return []
  }
  return (
    [
      ['claude', 'Claude'],
      ['codex', 'Codex'],
      ['gemini', 'Gemini'],
      ['opencodeGo', 'OpenCode Go'],
      ['kimi', 'Kimi'],
      ['antigravity', 'Antigravity'],
      ['minimax', 'MiniMax'],
      ['grok', 'Grok']
    ] as const
  )
    .map(([provider, label]) => parseUsage(provider, label, rateLimits[provider]))
    .filter((usage): usage is WearProviderUsage => usage !== null)
}

export function parseAgentInventory(value: unknown): WearAgentSession[] {
  const inventory = asRecord(value)
  if (!Array.isArray(inventory?.snapshots)) {
    return []
  }
  const agents: WearAgentSession[] = []
  for (const rawSnapshot of inventory.snapshots) {
    const snapshot = asRecord(rawSnapshot)
    if (
      typeof snapshot?.worktree !== 'string' ||
      typeof snapshot.publicationEpoch !== 'string' ||
      !Number.isSafeInteger(snapshot.snapshotVersion) ||
      !Array.isArray(snapshot.tabs)
    ) {
      continue
    }
    for (const rawTab of snapshot.tabs) {
      const tab = asRecord(rawTab)
      if (
        (tab?.type !== 'terminal' && tab?.type !== 'agent-session') ||
        typeof tab.id !== 'string'
      ) {
        continue
      }
      const agentStatus = asRecord(tab.agentStatus)
      const agent =
        tab.type === 'agent-session'
          ? stringValue(tab.agent)
          : (stringValue(agentStatus?.agentType) ?? stringValue(tab.launchAgent))
      if (!agent) {
        continue
      }
      const providerSession = asRecord(agentStatus?.providerSession)
      const connectionIdPresent = agentStatus ? Object.hasOwn(agentStatus, 'connectionId') : false
      const connectionId = connectionIdPresent ? agentStatus?.connectionId : undefined
      const execution =
        tab.type === 'agent-session'
          ? 'local'
          : connectionId === null ||
              (typeof connectionId === 'string' && connectionId.startsWith('wsl:'))
            ? 'local'
            : typeof connectionId === 'string'
              ? 'remote'
              : 'unverifiable'
      const publishedState = stringValue(agentStatus?.state)
      const state = isAgentState(publishedState) ? publishedState : 'unverifiable'
      agents.push({
        id: `${snapshot.worktree}:${tab.id}`,
        sessionTabId: tab.id,
        worktree: snapshot.worktree,
        worktreeLabel: pathLabel(snapshot.worktree),
        title: stringValue(tab.title) ?? `${agent} session`,
        terminal: tab.status === 'ready' && typeof tab.terminal === 'string' ? tab.terminal : null,
        agent,
        model: stringValue(agentStatus?.model),
        state,
        prompt: stringValue(agentStatus?.prompt) ?? '',
        lastAssistantMessage:
          stringValue(agentStatus?.lastCompletedAssistantMessage) ??
          stringValue(agentStatus?.lastAssistantMessage) ??
          '',
        updatedAt: finiteNumber(agentStatus?.updatedAt),
        execution,
        sessionId:
          tab.type === 'agent-session'
            ? stringValue(tab.sessionId)
            : stringValue(providerSession?.id),
        transcriptPath: stringValue(providerSession?.transcriptPath),
        kind: tab.type === 'agent-session' ? 'structured' : 'terminal',
        workspaceKind: snapshot.worktree.startsWith('folder:') ? 'folder' : 'worktree',
        publicationEpoch: snapshot.publicationEpoch,
        snapshotVersion: snapshot.snapshotVersion as number
      })
    }
  }
  return agents.sort((left, right) => {
    const priority = statePriority(left.state) - statePriority(right.state)
    return priority || (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
  })
}

export function parseNativeChatMessages(value: unknown): WearConversationMessage[] {
  const result = asRecord(value)
  if (typeof result?.error === 'string') {
    throw new Error(result.error.slice(0, 240))
  }
  if (!Array.isArray(result?.messages)) {
    throw new Error('Orca returned an invalid conversation')
  }
  return result.messages.flatMap((rawMessage) => {
    const message = asRecord(rawMessage)
    if (!message || typeof message.id !== 'string' || typeof message.role !== 'string') {
      return []
    }
    const blocks = Array.isArray(message.blocks) ? message.blocks : []
    const fullText = blocks.map(conversationBlockText).filter(Boolean).join('\n')
    const text = fullText.length > 240 ? `${fullText.slice(0, 239)}…` : fullText
    if (!text) {
      return []
    }
    return [
      {
        id: message.id,
        role: message.role,
        text,
        timestamp: finiteNumber(message.timestamp)
      }
    ]
  })
}

function parseUsage(provider: string, label: string, value: unknown): WearProviderUsage | null {
  const usage = asRecord(value)
  const updatedAt = finiteNumber(usage?.updatedAt)
  if (!usage || updatedAt === null) {
    return null
  }
  return {
    provider,
    label,
    session: parseUsageWindow(usage.session),
    weekly: parseUsageWindow(usage.weekly),
    updatedAt,
    status: stringValue(usage.status) ?? 'unavailable'
  }
}

function parseUsageWindow(value: unknown): WearUsageWindow | null {
  const window = asRecord(value)
  const usedPercent = finiteNumber(window?.usedPercent)
  if (!window || usedPercent === null) {
    return null
  }
  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetDescription: stringValue(window.resetDescription),
    resetsAt: finiteNumber(window.resetsAt)
  }
}

function conversationBlockText(value: unknown): string {
  const block = asRecord(value)
  if (!block) {
    return ''
  }
  if (block.type === 'text') {
    return stringValue(block.text) ?? ''
  }
  if (block.type === 'tool-call') {
    return `Tool: ${stringValue(block.name) ?? 'unknown'}`
  }
  if (block.type === 'tool-result') {
    const output = stringValue(block.output)
    return output ? `Result: ${output}` : 'Tool result'
  }
  if (block.type === 'image-ref') {
    return stringValue(block.alt) ?? 'Image'
  }
  return ''
}

function pathLabel(path: string): string {
  const pieces = path.split(/[\\/]/).filter(Boolean)
  return pieces.at(-1) ?? path
}

function statePriority(state: WearAgentSession['state']): number {
  return { blocked: 0, waiting: 1, working: 2, done: 3, unverifiable: 4 }[state]
}

function isAgentState(value: string | null): value is WearAgentSession['state'] {
  return value === 'working' || value === 'blocked' || value === 'waiting' || value === 'done'
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
