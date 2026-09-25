import { isWearDashboardHost, type WearDashboardHost } from './dashboard'
import { utf8Length } from './utf8'

export type WearHostPage = {
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
  hosts: WearDashboardHost[]
  nextCursor: string | null
}

export type HostPageDecodeResult =
  | { ok: true; page: WearHostPage }
  | { ok: false; reason: 'too-large' | 'invalid-page' | 'expired' }

const MAX_BYTES = 32_768 - 512
const MAX_PAGE_HOSTS = 16
const MAX_AGE_MS = 120_000
const WEAR_RECEIVER_CLOCK_SKEW_MS = 30_000
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
  'hosts',
  'nextCursor'
] as const

function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && utf8Length(value) <= 256
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function valid(value: unknown): value is WearHostPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const page = value as Record<string, unknown>
  if (
    Object.keys(page).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(page, key)) ||
    page.schemaVersion !== 1 ||
    !id(page.bindingId) ||
    !id(page.requestId) ||
    typeof page.actionHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(page.actionHash) ||
    !id(page.publisherEpoch) ||
    !timestamp(page.revision) ||
    (page.cursor !== null && !id(page.cursor)) ||
    !timestamp(page.generatedAt) ||
    !timestamp(page.expiresAt) ||
    page.expiresAt <= page.generatedAt ||
    page.expiresAt - page.generatedAt > MAX_AGE_MS ||
    !timestamp(page.total) ||
    !timestamp(page.offset) ||
    !Array.isArray(page.hosts) ||
    page.hosts.length > MAX_PAGE_HOSTS ||
    page.offset + page.hosts.length > page.total ||
    !page.hosts.every(isWearDashboardHost) ||
    new Set(page.hosts.map((host: WearDashboardHost) => host.hostId)).size !== page.hosts.length ||
    (page.nextCursor !== null && !id(page.nextCursor)) ||
    (page.nextCursor !== null && page.nextCursor === page.cursor) ||
    (page.nextCursor !== null && !/^[0-9a-f]{64}:[1-9][0-9]*$/.test(page.nextCursor)) ||
    (page.cursor !== null && !/^[0-9a-f]{64}:[1-9][0-9]*$/.test(page.cursor)) ||
    (page.cursor === null && page.offset !== 0) ||
    (page.cursor !== null && Number(page.cursor.slice(65)) !== page.offset) ||
    (page.nextCursor !== null &&
      Number(page.nextCursor.slice(65)) !== page.offset + page.hosts.length) ||
    (page.cursor !== null &&
      page.nextCursor !== null &&
      page.cursor.slice(0, 64) !== page.nextCursor.slice(0, 64)) ||
    (page.nextCursor !== null) !== page.offset + page.hosts.length < page.total
  ) {
    return false
  }
  return true
}

export function decodeWearHostPage(serialized: string, now: number): HostPageDecodeResult {
  if (utf8Length(serialized) > MAX_BYTES) {
    return { ok: false, reason: 'too-large' }
  }
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return { ok: false, reason: 'invalid-page' }
  }
  if (!valid(value)) {
    return { ok: false, reason: 'invalid-page' }
  }
  if (value.expiresAt - now > MAX_AGE_MS + WEAR_RECEIVER_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'invalid-page' }
  }
  if (value.expiresAt <= now) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true, page: value }
}

export function encodeWearHostPage(page: WearHostPage): string {
  if (!valid(page)) {
    throw new Error('Invalid Wear host page')
  }
  const serialized = JSON.stringify(page)
  if (utf8Length(serialized) > MAX_BYTES) {
    throw new Error('Wear host page exceeds wire bound')
  }
  return serialized
}
