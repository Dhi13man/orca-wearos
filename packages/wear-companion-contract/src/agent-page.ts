import { utf8Length } from './utf8'

export type WearAgentRow = {
  workspaceId: string
  workspaceKind: 'worktree' | 'folder' | null
  sessionTabId: string
  kind: 'terminal' | 'structured'
  title: string
  state: 'working' | 'blocked' | 'waiting' | 'done' | null
  freshness: 'fresh' | 'stale' | 'unavailable'
  updatedAt: number | null
  freshUntil: number | null
  targetPublicationEpoch: string
  targetSnapshotVersion: number
}

export type WearAgentPage = {
  schemaVersion: 1
  bindingId: string
  requestId: string
  actionHash: string
  publisherEpoch: string
  revision: number
  hostId: string
  inventoryKey: string
  inventoryAuthority: 'authoritative' | 'incomplete' | 'unavailable'
  cursor: string | null
  generatedAt: number
  expiresAt: number
  total: number
  offset: number
  agents: WearAgentRow[]
  nextCursor: string | null
}

export type AgentPageDecodeResult =
  | { ok: true; page: WearAgentPage }
  | { ok: false; reason: 'too-large' | 'invalid-page' | 'expired' }

const MAX_BYTES = 32_768 - 512
const MAX_AGE_MS = 120_000
const WEAR_RECEIVER_CLOCK_SKEW_MS = 30_000
const MAX_PAGE_AGENTS = 12
const HASH = /^[0-9a-f]{64}$/
const pageKeys = [
  'schemaVersion',
  'bindingId',
  'requestId',
  'actionHash',
  'publisherEpoch',
  'revision',
  'hostId',
  'inventoryKey',
  'inventoryAuthority',
  'cursor',
  'generatedAt',
  'expiresAt',
  'total',
  'offset',
  'agents',
  'nextCursor'
]
const rowKeys = [
  'workspaceId',
  'workspaceKind',
  'sessionTabId',
  'kind',
  'title',
  'state',
  'freshness',
  'updatedAt',
  'freshUntil',
  'targetPublicationEpoch',
  'targetSnapshotVersion'
]

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}

function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && utf8Length(value) <= 256
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function row(value: unknown): value is WearAgentRow {
  if (!exact(value, rowKeys)) {
    return false
  }
  return (
    id(value.workspaceId) &&
    (value.workspaceKind === null ||
      value.workspaceKind === 'worktree' ||
      value.workspaceKind === 'folder') &&
    id(value.sessionTabId) &&
    (value.kind === 'terminal' || value.kind === 'structured') &&
    id(value.title) &&
    (value.state === null ||
      ['working', 'blocked', 'waiting', 'done'].includes(value.state as string)) &&
    ['fresh', 'stale', 'unavailable'].includes(value.freshness as string) &&
    (value.updatedAt === null || integer(value.updatedAt)) &&
    (value.freshUntil === null || integer(value.freshUntil)) &&
    id(value.targetPublicationEpoch) &&
    integer(value.targetSnapshotVersion) &&
    (value.freshness !== 'fresh' ||
      (value.state !== null &&
        value.updatedAt !== null &&
        typeof value.freshUntil === 'number' &&
        value.freshUntil > (value.updatedAt as number))) &&
    (value.freshness !== 'unavailable' ||
      (value.state === null && value.updatedAt === null && value.freshUntil === null)) &&
    (value.freshness !== 'stale' ||
      (value.state === null && value.updatedAt !== null && value.freshUntil === null))
  )
}

function valid(value: unknown): value is WearAgentPage {
  if (!exact(value, pageKeys)) {
    return false
  }
  const cursor = (offset: number) => `${value.inventoryKey}:${offset}`
  return (
    value.schemaVersion === 1 &&
    id(value.bindingId) &&
    id(value.requestId) &&
    typeof value.actionHash === 'string' &&
    HASH.test(value.actionHash) &&
    id(value.publisherEpoch) &&
    integer(value.revision) &&
    id(value.hostId) &&
    typeof value.inventoryKey === 'string' &&
    HASH.test(value.inventoryKey) &&
    ['authoritative', 'incomplete', 'unavailable'].includes(value.inventoryAuthority as string) &&
    integer(value.generatedAt) &&
    integer(value.expiresAt) &&
    value.expiresAt > value.generatedAt &&
    value.expiresAt - value.generatedAt <= MAX_AGE_MS &&
    integer(value.total) &&
    integer(value.offset) &&
    (value.cursor === null ? value.offset === 0 : value.cursor === cursor(value.offset)) &&
    Array.isArray(value.agents) &&
    value.agents.length <= MAX_PAGE_AGENTS &&
    value.agents.every(row) &&
    value.agents.every(
      (agent: WearAgentRow) =>
        agent.updatedAt === null || agent.updatedAt <= (value.generatedAt as number) + 300_000
    ) &&
    value.agents.every(
      (agent: WearAgentRow) =>
        agent.freshUntil === null || agent.freshUntil <= (value.generatedAt as number) + 3_600_000
    ) &&
    value.offset + value.agents.length <= value.total &&
    new Set(
      value.agents.map((agent: WearAgentRow) => `${agent.workspaceId}\0${agent.sessionTabId}`)
    ).size === value.agents.length &&
    (value.nextCursor === null
      ? value.offset + value.agents.length === value.total
      : value.agents.length > 0 &&
        value.nextCursor === cursor(value.offset + value.agents.length) &&
        value.offset + value.agents.length < value.total)
  )
}

export function decodeWearAgentPage(serialized: string, now: number): AgentPageDecodeResult {
  if (utf8Length(serialized) > MAX_BYTES) {
    return { ok: false, reason: 'too-large' }
  }
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return { ok: false, reason: 'invalid-page' }
  }
  if (!valid(value) || value.expiresAt - now > MAX_AGE_MS + WEAR_RECEIVER_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'invalid-page' }
  }
  return value.expiresAt <= now ? { ok: false, reason: 'expired' } : { ok: true, page: value }
}

export function encodeWearAgentPage(page: WearAgentPage): string {
  if (!valid(page)) {
    throw new Error('Invalid Wear agent page')
  }
  const serialized = JSON.stringify(page)
  if (utf8Length(serialized) > MAX_BYTES) {
    throw new Error('Wear agent page exceeds wire bound')
  }
  return serialized
}
