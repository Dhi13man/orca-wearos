import type { PairingOffer } from './pairing'
import {
  parseAttentionEvents,
  parseAgentInventory,
  parseProviderUsage,
  type OrcaDashboard,
  type WearAgentSession,
  type WearConversationMessage
} from './runtime-dashboard'
import {
  requestRuntime,
  RuntimeTransportError,
  type ClientDependencies,
  type RuntimeReply
} from './runtime-rpc-transport'

export { RuntimeTransportError, type OrcaSocket } from './runtime-rpc-transport'

const SEND_TIMEOUT_MS = 15_000

export type RuntimeStatus = {
  runtimeId: string
  pairedDeviceId?: string
  appVersion?: string
  graphStatus?: string
  hostPlatform?: string
  liveTabCount?: number
  liveLeafCount?: number
}

export async function fetchRuntimeStatus(
  offer: PairingOffer,
  dependencyOverrides: Partial<ClientDependencies> = {}
): Promise<RuntimeStatus> {
  const replies = await requestRuntime(
    offer,
    { status: { method: 'status.get' } },
    dependencyOverrides
  )
  return requireRuntimeStatus(replies.status)
}

export async function fetchRuntimeDashboard(
  offer: PairingOffer,
  dependencyOverrides: Partial<ClientDependencies> = {}
): Promise<OrcaDashboard> {
  const replies = await requestRuntime(
    offer,
    {
      status: { method: 'status.get' },
      dashboard: { method: 'wear.dashboard.get' }
    },
    dependencyOverrides
  )
  const status = requireRuntimeStatus(replies.status)
  const warnings: string[] = []
  const usageRefreshPending =
    replies.dashboard?.ok && asRecord(replies.dashboard.result)?.usageRefreshPending === true
  const usage = replies.dashboard?.ok ? parseProviderUsage(replies.dashboard.result) : []
  const agents = replies.dashboard?.ok ? parseAgentInventory(replies.dashboard.result) : []
  const { events, omitted: eventsOmitted } = parseAttentionEvents(
    replies.dashboard?.ok ? replies.dashboard.result : null
  )
  if (!replies.dashboard?.ok) {
    warnings.push(replies.dashboard?.error ?? 'Dashboard is unavailable')
  } else if (asRecord(replies.dashboard.result)?.usageAvailable === false) {
    warnings.push('Account usage is unavailable')
  }
  if (usageRefreshPending) {
    warnings.push('Usage is refreshing; shown values may be stale')
  }
  return { status, usage, usageRefreshPending, agents, events, eventsOmitted, warnings }
}

export async function fetchAgentConversation(
  offer: PairingOffer,
  agent: WearAgentSession,
  dependencyOverrides: Partial<ClientDependencies> = {}
): Promise<WearConversationMessage[]> {
  const replies = await requestRuntime(
    offer,
    {
      conversation: {
        method: 'wear.conversation.read',
        params: {
          workspaceId: agent.worktree,
          workspaceKind: agent.workspaceKind,
          sessionTabId: agent.sessionTabId,
          targetPublicationEpoch: agent.publicationEpoch,
          targetSnapshotVersion: agent.snapshotVersion
        }
      }
    },
    dependencyOverrides
  )
  const reply = replies.conversation
  if (!reply?.ok) {
    throw new Error(reply?.error ?? 'Conversation is unavailable')
  }
  const result = asRecord(reply.result)
  if (result?.state !== 'ready' || !Array.isArray(result.messages)) {
    throw new Error(
      result?.state === 'target-changed'
        ? 'Agent target changed; refresh the dashboard'
        : 'Conversation is unavailable'
    )
  }
  return result.messages.flatMap((raw) => {
    const message = asRecord(raw)
    return message &&
      typeof message.id === 'string' &&
      typeof message.role === 'string' &&
      typeof message.text === 'string'
      ? [
          {
            id: message.id,
            role: message.role,
            text: message.text,
            timestamp: typeof message.observedAt === 'number' ? message.observedAt : null
          }
        ]
      : []
  })
}

export type AgentSendOutcome = 'accepted' | 'rejected' | 'unknown'

export async function fetchCommandReceipt(
  offer: PairingOffer,
  bindingId: string,
  requestId: string,
  dependencyOverrides: Partial<ClientDependencies> = {}
): Promise<AgentSendOutcome | null> {
  const replies = await requestRuntime(
    offer,
    { receipt: { method: 'wear.command.receipt', params: { bindingId, requestId } } },
    dependencyOverrides
  )
  const reply = replies.receipt
  if (!reply?.ok) {
    throw new Error(reply?.error ?? 'Receipt is unavailable')
  }
  if (reply.result === null) {
    return null
  }
  const result = asRecord(reply.result)
  return result?.outcome === 'accepted' || result?.outcome === 'rejected'
    ? result.outcome
    : 'unknown'
}

export async function sendAgentMessage(
  offer: PairingOffer,
  agent: WearAgentSession,
  pairedDeviceId: string,
  runtimeId: string,
  requestId: string,
  expiresAt: number,
  text: string,
  dependencyOverrides: Partial<ClientDependencies> = {}
): Promise<AgentSendOutcome> {
  if (!pairedDeviceId || !runtimeId || !requestId || !text.trim()) {
    return 'rejected'
  }
  try {
    const replies = await requestRuntime(
      offer,
      {
        send: {
          method: agent.kind === 'structured' ? 'wear.agent.send' : 'wear.terminal.send',
          params: {
            schemaVersion: 1,
            bindingId: pairedDeviceId,
            requestId,
            expiresAt,
            action: 'sendAgentMessage',
            target: {
              hostId: runtimeId,
              workspaceId: agent.worktree,
              workspaceKind: agent.workspaceKind,
              sessionTabId: agent.sessionTabId
            },
            publisherEpoch: runtimeId,
            expectedRevision: 0,
            targetPublicationEpoch: agent.publicationEpoch,
            targetSnapshotVersion: agent.snapshotVersion,
            payload: { text: text.trim() }
          }
        }
      },
      { ...dependencyOverrides, timeoutMs: dependencyOverrides.timeoutMs ?? SEND_TIMEOUT_MS }
    )
    const reply = replies.send
    if (!reply?.ok) {
      return 'rejected'
    }
    const result = asRecord(reply.result)
    return result?.outcome === 'accepted' || result?.outcome === 'unknown'
      ? result.outcome
      : 'rejected'
  } catch (error) {
    return error instanceof RuntimeTransportError && error.delivery === 'unknown'
      ? 'unknown'
      : 'rejected'
  }
}

function requireRuntimeStatus(reply: RuntimeReply | undefined): RuntimeStatus {
  if (!reply?.ok) {
    throw new Error(reply?.error ?? 'Orca rejected the status request')
  }
  const status = asRecord(reply.result)
  if (!status || typeof status.runtimeId !== 'string' || status.runtimeId.length === 0) {
    throw new Error('Orca returned an invalid status response')
  }
  return {
    runtimeId: status.runtimeId,
    ...(typeof status.pairedDeviceId === 'string' ? { pairedDeviceId: status.pairedDeviceId } : {}),
    ...(typeof status.appVersion === 'string' ? { appVersion: status.appVersion } : {}),
    ...(typeof status.graphStatus === 'string' ? { graphStatus: status.graphStatus } : {}),
    ...(typeof status.hostPlatform === 'string' ? { hostPlatform: status.hostPlatform } : {}),
    ...(typeof status.liveTabCount === 'number' ? { liveTabCount: status.liveTabCount } : {}),
    ...(typeof status.liveLeafCount === 'number' ? { liveLeafCount: status.liveLeafCount } : {})
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
