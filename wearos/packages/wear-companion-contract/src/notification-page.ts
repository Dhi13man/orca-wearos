import { utf8Length } from './utf8'
const WEAR_RECEIVER_CLOCK_SKEW_MS = 30_000

export type WearNotificationRow = {
  eventKey: string
  kind: 'agent-task-complete' | 'terminal-bell'
  notificationAt: number
}

export type WearNotificationPage = {
  schemaVersion: 1
  bindingId: string
  requestId: string
  actionHash: string
  publisherEpoch: string
  revision: number
  cursor: string | null
  generatedAt: number
  expiresAt: number
  hostId: string
  hostName: string
  hostIndex: number
  totalHosts: number
  hostState: 'ready' | 'unavailable' | 'unsupported'
  items: WearNotificationRow[]
  omitted: number
  nextCursor: string | null
}

const PAGE_KEYS = [
  'schemaVersion',
  'bindingId',
  'requestId',
  'actionHash',
  'publisherEpoch',
  'revision',
  'cursor',
  'generatedAt',
  'expiresAt',
  'hostId',
  'hostName',
  'hostIndex',
  'totalHosts',
  'hostState',
  'items',
  'omitted',
  'nextCursor'
]
const ROW_KEYS = ['eventKey', 'kind', 'notificationAt']
const CURSOR = /^[0-9a-f]{64}:[1-9][0-9]*$/

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

function valid(value: unknown): value is WearNotificationPage {
  if (!exact(value, PAGE_KEYS)) {
    return false
  }
  const page = value
  if (
    page.schemaVersion !== 1 ||
    !id(page.bindingId) ||
    !id(page.requestId) ||
    typeof page.actionHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(page.actionHash) ||
    !id(page.publisherEpoch) ||
    !integer(page.revision) ||
    !integer(page.generatedAt) ||
    !integer(page.expiresAt) ||
    page.expiresAt <= page.generatedAt ||
    page.expiresAt - page.generatedAt > 120_000 ||
    !id(page.hostId) ||
    typeof page.hostName !== 'string' ||
    utf8Length(page.hostName) > 128 ||
    !integer(page.hostIndex) ||
    !integer(page.totalHosts) ||
    page.totalHosts <= page.hostIndex ||
    !integer(page.omitted) ||
    !['ready', 'unavailable', 'unsupported'].includes(page.hostState as string) ||
    !Array.isArray(page.items) ||
    page.items.length > 12 ||
    (page.hostState !== 'ready' && (page.items.length > 0 || page.omitted !== 0)) ||
    (page.cursor !== null && (!id(page.cursor) || !CURSOR.test(page.cursor))) ||
    (page.nextCursor !== null && (!id(page.nextCursor) || !CURSOR.test(page.nextCursor))) ||
    (page.cursor === null) !== (page.hostIndex === 0) ||
    (page.cursor !== null && Number(page.cursor.slice(65)) !== page.hostIndex) ||
    (page.nextCursor !== null) !== page.hostIndex + 1 < page.totalHosts ||
    (page.nextCursor !== null && Number(page.nextCursor.slice(65)) !== page.hostIndex + 1) ||
    (page.cursor !== null &&
      page.nextCursor !== null &&
      page.cursor.slice(0, 64) !== page.nextCursor.slice(0, 64))
  ) {
    return false
  }
  const seen = new Set<string>()
  for (const item of page.items) {
    if (
      !exact(item, ROW_KEYS) ||
      !id(item.eventKey) ||
      !['agent-task-complete', 'terminal-bell'].includes(item.kind as string) ||
      !integer(item.notificationAt) ||
      seen.has(item.eventKey)
    ) {
      return false
    }
    seen.add(item.eventKey)
  }
  return true
}

export function decodeWearNotificationPage(
  serialized: string,
  now: number
):
  | { ok: true; page: WearNotificationPage }
  | { ok: false; reason: 'too-large' | 'invalid-page' | 'expired' } {
  if (utf8Length(serialized) > 32_768 - 512) {
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
  if (value.expiresAt <= now) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true, page: value }
}

export function encodeWearNotificationPage(page: WearNotificationPage): string {
  if (!valid(page)) {
    throw new Error('Invalid Wear notification page')
  }
  const serialized = JSON.stringify(page)
  if (utf8Length(serialized) > 32_768 - 512) {
    throw new Error('Wear notification page exceeds wire bound')
  }
  return serialized
}
