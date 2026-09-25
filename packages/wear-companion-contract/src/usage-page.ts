import { isWearUsageGroup, type WearUsageGroup } from './dashboard'
import { utf8Length } from './utf8'

export type WearUsagePage = {
  schemaVersion: 1
  bindingId: string
  requestId: string
  actionHash: string
  publisherEpoch: string
  revision: number
  cursor: string | null
  generatedAt: number
  expiresAt: number
  total: number
  offset: number
  groups: WearUsageGroup[]
  nextCursor: string | null
}

const MAX_BYTES = 32_768 - 512
const MAX_AGE_MS = 120_000
const GROUP_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const keys = [
  'schemaVersion',
  'bindingId',
  'requestId',
  'actionHash',
  'publisherEpoch',
  'revision',
  'cursor',
  'generatedAt',
  'expiresAt',
  'total',
  'offset',
  'groups',
  'nextCursor'
] as const

function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && utf8Length(value) <= 256
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function valid(value: unknown): value is WearUsagePage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const page = value as Record<string, unknown>
  return (
    Object.keys(page).length === keys.length &&
    keys.every((key) => Object.hasOwn(page, key)) &&
    page.schemaVersion === 1 &&
    id(page.bindingId) &&
    id(page.requestId) &&
    typeof page.actionHash === 'string' &&
    /^[0-9a-f]{64}$/.test(page.actionHash) &&
    id(page.publisherEpoch) &&
    integer(page.revision) &&
    (page.cursor === null ||
      page.cursor === 'start' ||
      (typeof page.cursor === 'string' && GROUP_KEY.test(page.cursor))) &&
    integer(page.generatedAt) &&
    integer(page.expiresAt) &&
    page.expiresAt > page.generatedAt &&
    page.expiresAt - page.generatedAt <= MAX_AGE_MS &&
    integer(page.total) &&
    integer(page.offset) &&
    Array.isArray(page.groups) &&
    page.groups.length <= 16 &&
    page.offset + page.groups.length <= page.total &&
    page.groups.every(isWearUsageGroup) &&
    new Set(page.groups.map((group: WearUsageGroup) => group.groupKey)).size ===
      page.groups.length &&
    (page.nextCursor === null ||
      (typeof page.nextCursor === 'string' && GROUP_KEY.test(page.nextCursor))) &&
    (page.nextCursor === null) === (page.offset + page.groups.length === page.total) &&
    (page.nextCursor === null || page.nextCursor === page.groups.at(-1)?.groupKey) &&
    (page.cursor === null ||
      page.groups.every((group: WearUsageGroup) => group.groupKey !== page.cursor)) &&
    (page.groups.length > 0 || page.nextCursor === null)
  )
}

export function decodeWearUsagePage(
  serialized: string,
  now: number
):
  | { ok: true; page: WearUsagePage }
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
  if (!valid(value) || value.expiresAt - now > MAX_AGE_MS + 30_000) {
    return { ok: false, reason: 'invalid-page' }
  }
  return value.expiresAt <= now ? { ok: false, reason: 'expired' } : { ok: true, page: value }
}

export function encodeWearUsagePage(page: WearUsagePage): string {
  if (!valid(page)) {
    throw new Error('Invalid Wear usage page')
  }
  const serialized = JSON.stringify(page)
  if (utf8Length(serialized) > MAX_BYTES) {
    throw new Error('Wear usage page exceeds wire bound')
  }
  return serialized
}
