import { utf8Length } from './utf8'
const WEAR_RECEIVER_CLOCK_SKEW_MS = 30_000

export type WearConversationMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  truncated: boolean
  observedAt: number | null
}

export type WearConversationPage = {
  schemaVersion: 1
  bindingId: string
  requestId: string
  actionHash: string
  publisherEpoch: string
  revision: number
  hostId: string
  workspaceId: string
  workspaceKind: 'worktree' | 'folder'
  sessionTabId: string
  targetPublicationEpoch: string
  targetSnapshotVersion: number
  generatedAt: number
  expiresAt: number
  kind: 'terminal' | 'structured'
  contentScope: 'text-only'
  messages: WearConversationMessage[]
  hasOlder: boolean
}

const PAGE_KEYS = [
  'schemaVersion',
  'bindingId',
  'requestId',
  'actionHash',
  'publisherEpoch',
  'revision',
  'hostId',
  'workspaceId',
  'workspaceKind',
  'sessionTabId',
  'targetPublicationEpoch',
  'targetSnapshotVersion',
  'generatedAt',
  'expiresAt',
  'kind',
  'contentScope',
  'messages',
  'hasOlder'
] as const
const MESSAGE_KEYS = ['id', 'role', 'text', 'truncated', 'observedAt'] as const
const HASH = /^[0-9a-f]{64}$/
const MAX_BYTES = 32_768 - 512

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
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

function message(value: unknown): value is WearConversationMessage {
  return (
    exact(value, MESSAGE_KEYS) &&
    id(value.id) &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.text === 'string' &&
    value.text.length > 0 &&
    utf8Length(value.text) <= 2_048 &&
    typeof value.truncated === 'boolean' &&
    (value.observedAt === null || integer(value.observedAt))
  )
}

function valid(value: unknown): value is WearConversationPage {
  return (
    exact(value, PAGE_KEYS) &&
    value.schemaVersion === 1 &&
    id(value.bindingId) &&
    id(value.requestId) &&
    typeof value.actionHash === 'string' &&
    HASH.test(value.actionHash) &&
    id(value.publisherEpoch) &&
    integer(value.revision) &&
    id(value.hostId) &&
    id(value.workspaceId) &&
    (value.workspaceKind === 'worktree' || value.workspaceKind === 'folder') &&
    id(value.sessionTabId) &&
    id(value.targetPublicationEpoch) &&
    integer(value.targetSnapshotVersion) &&
    integer(value.generatedAt) &&
    integer(value.expiresAt) &&
    value.expiresAt > value.generatedAt &&
    value.expiresAt - value.generatedAt <= 120_000 &&
    (value.kind === 'terminal' || value.kind === 'structured') &&
    value.contentScope === 'text-only' &&
    Array.isArray(value.messages) &&
    value.messages.length <= 20 &&
    value.messages.every(message) &&
    new Set(value.messages.map((item: WearConversationMessage) => item.id)).size ===
      value.messages.length &&
    value.messages.every(
      (item: WearConversationMessage) =>
        item.observedAt === null || item.observedAt <= (value.generatedAt as number) + 300_000
    ) &&
    typeof value.hasOlder === 'boolean'
  )
}

export function decodeWearConversationPage(
  serialized: string,
  now: number
):
  | { ok: true; page: WearConversationPage }
  | { ok: false; reason: 'too-large' | 'invalid-page' | 'expired' } {
  if (utf8Length(serialized) > MAX_BYTES) {
    return { ok: false, reason: 'too-large' }
  }
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return { ok: false, reason: 'invalid-page' }
  }
  if (!valid(value) || value.expiresAt - now > 120_000 + WEAR_RECEIVER_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'invalid-page' }
  }
  return value.expiresAt <= now ? { ok: false, reason: 'expired' } : { ok: true, page: value }
}

export function encodeWearConversationPage(page: WearConversationPage): string {
  if (!valid(page)) {
    throw new Error('Invalid Wear conversation page')
  }
  const serialized = JSON.stringify(page)
  if (utf8Length(serialized) > MAX_BYTES) {
    throw new Error('Wear conversation page exceeds wire bound')
  }
  return serialized
}
