import * as ExpoCrypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { wearDataLayer } from '@orca/expo-wear-data-layer'
import type { FleetHost } from './fleet-dashboard'
import type { PairingOffer } from './pairing'
import type { OrcaDashboard, WearAgentSession } from './runtime-dashboard'

const KEYS = ['orca.wear.dashboard.a.v1', 'orca.wear.dashboard.b.v1'] as const
const MAX_BYTES = 48 * 1024
export const CACHED_HOST_LIMIT = 32
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
}

type CachedHost = {
  index: number
  dashboard: OrcaDashboard | null
  observedAt: number | null
  checkedAt: number
  error: string | null
  agentsOmitted: number
}
type Snapshot = { version: 1; identity: string; hosts: CachedHost[] }

export async function pairingIdentity(pairings: PairingOffer[]): Promise<string> {
  return ExpoCrypto.digestStringAsync(
    ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(
      pairings.map(({ endpoint, publicKeyB64, deviceToken, pairedDeviceId }) => [
        endpoint,
        publicKeyB64,
        deviceToken,
        pairedDeviceId ?? ''
      ])
    )
  )
}

export async function syncDirectPairings(pairings: PairingOffer[]): Promise<string> {
  const identity = pairings.length ? await pairingIdentity(pairings) : ''
  wearDataLayer?.setDirectPairingIdentity(identity)
  return identity
}

export function invalidateDirectPairings(): void {
  wearDataLayer?.setDirectPairingIdentity('')
}

export async function loadCachedFleet(pairings: PairingOffer[]): Promise<FleetHost[]> {
  const identity = await pairingIdentity(pairings)
  const pointer = wearDataLayer?.getDirectSnapshotSlot()
  if (!pointer || pointer.identity !== identity || pointer.slot < 0 || pointer.slot > 1) {
    return []
  }
  const raw = await SecureStore.getItemAsync(KEYS[pointer.slot], OPTIONS)
  if (!raw || new TextEncoder().encode(raw).length > MAX_BYTES) {
    return []
  }
  let snapshot: Snapshot
  try {
    snapshot = JSON.parse(raw) as Snapshot
  } catch {
    return []
  }
  if (snapshot.version !== 1 || snapshot.identity !== identity || !Array.isArray(snapshot.hosts)) {
    return []
  }
  return snapshot.hosts.flatMap((entry) => {
    const pairing = pairings[entry.index]
    if (!pairing || !Number.isSafeInteger(entry.index) || entry.index < 0) {
      return []
    }
    return [
      {
        pairing,
        dashboard: entry.dashboard,
        observedAt: entry.observedAt,
        checkedAt: entry.checkedAt,
        error: entry.error,
        cached: true,
        agentsOmitted: entry.agentsOmitted
      }
    ]
  })
}

export async function publishCachedFleet(
  runId: number,
  pairings: PairingOffer[],
  hosts: FleetHost[]
): Promise<boolean> {
  if (!wearDataLayer?.isBackgroundRefreshActive(runId)) {
    return false
  }
  const identity = await pairingIdentity(pairings)
  const pointer = wearDataLayer.getDirectSnapshotSlot()
  if (pointer?.identity !== identity) {
    return false
  }
  const slot = pointer.slot === 0 ? 1 : 0
  const snapshot: Snapshot = { version: 1, identity, hosts: [] }
  for (let index = 0; index < Math.min(hosts.length, CACHED_HOST_LIMIT); index++) {
    const host = hosts[index]
    const entry: CachedHost = {
      index,
      dashboard: host.dashboard ? compactDashboard(host.dashboard) : null,
      observedAt: host.observedAt,
      checkedAt: host.checkedAt,
      error: host.error?.slice(0, 160) ?? null,
      agentsOmitted: host.cached
        ? (host.agentsOmitted ?? 0)
        : Math.max(0, (host.dashboard?.agents.length ?? 0) - 12)
    }
    snapshot.hosts.push(entry)
    if (new TextEncoder().encode(JSON.stringify(snapshot)).length > MAX_BYTES) {
      snapshot.hosts.pop()
      break
    }
  }
  if (!wearDataLayer.isBackgroundRefreshActive(runId)) {
    return false
  }
  await SecureStore.setItemAsync(KEYS[slot], JSON.stringify(snapshot), OPTIONS)
  return wearDataLayer.publishDirectSnapshotSlot(runId, identity, slot)
}

function compactDashboard(dashboard: OrcaDashboard): OrcaDashboard {
  return {
    status: {
      runtimeId: dashboard.status.runtimeId.slice(0, 128),
      ...(dashboard.status.pairedDeviceId
        ? { pairedDeviceId: dashboard.status.pairedDeviceId.slice(0, 128) }
        : {})
    },
    usage: dashboard.usage.slice(0, 8).map((usage) => ({
      ...usage,
      provider: usage.provider.slice(0, 40),
      label: usage.label.slice(0, 60),
      status: usage.status.slice(0, 40),
      session: usage.session && {
        ...usage.session,
        resetDescription: usage.session.resetDescription?.slice(0, 80) ?? null
      },
      weekly: usage.weekly && {
        ...usage.weekly,
        resetDescription: usage.weekly.resetDescription?.slice(0, 80) ?? null
      }
    })),
    usageRefreshPending: dashboard.usageRefreshPending,
    agents: dashboard.agents.slice(0, 12).map(compactAgent),
    events: dashboard.events
      .slice(0, 12)
      .map((event) => ({ ...event, key: event.key.slice(0, 120) })),
    eventsOmitted: dashboard.eventsOmitted,
    warnings: dashboard.warnings.slice(0, 4).map((warning) => warning.slice(0, 120))
  }
}

function compactAgent(agent: WearAgentSession): WearAgentSession {
  return {
    ...agent,
    id: agent.id.slice(0, 160),
    sessionTabId: agent.sessionTabId.slice(0, 120),
    worktree: agent.worktree.slice(0, 160),
    worktreeLabel: agent.worktreeLabel.slice(0, 80),
    title: agent.title.slice(0, 120),
    agent: agent.agent.slice(0, 60),
    prompt: '',
    lastAssistantMessage: '',
    transcriptPath: null,
    terminal: null
  }
}
