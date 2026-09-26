import { utf8Length } from './utf8'
const WEAR_RECEIVER_CLOCK_SKEW_MS = 30_000

export const wearReceiptReasons = [
  'invalid-action',
  'expired',
  'stale',
  'rate-limited',
  'busy',
  'conflict',
  'unsupported',
  'unavailable',
  'target-changed'
] as const

export type WearReceiptReason = (typeof wearReceiptReasons)[number]
export type WearReceipt = {
  schemaVersion: 1
  bindingId: string
  requestId: string
  actionHash: string
  status: 'accepted' | 'rejected' | 'unknown'
  reason: WearReceiptReason | null
  expiresAt: number
}

export type ReceiptDecodeResult =
  | { ok: true; receipt: WearReceipt }
  | { ok: false; reason: 'invalid-receipt' | 'too-large' | 'expired' }

const receiptKeys = [
  'schemaVersion',
  'bindingId',
  'requestId',
  'actionHash',
  'status',
  'reason',
  'expiresAt'
] as const

export function decodeWearReceipt(serialized: string, now: number): ReceiptDecodeResult {
  if (utf8Length(serialized) > 1024) {
    return { ok: false, reason: 'too-large' }
  }
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return { ok: false, reason: 'invalid-receipt' }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'invalid-receipt' }
  }
  const row = value as Record<string, unknown>
  if (
    Object.keys(row).length !== receiptKeys.length ||
    !receiptKeys.every((key) => Object.hasOwn(row, key)) ||
    row.schemaVersion !== 1 ||
    typeof row.bindingId !== 'string' ||
    row.bindingId.length === 0 ||
    utf8Length(row.bindingId) > 256 ||
    typeof row.requestId !== 'string' ||
    row.requestId.length === 0 ||
    utf8Length(row.requestId) > 256 ||
    typeof row.actionHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(row.actionHash) ||
    !Number.isSafeInteger(row.expiresAt) ||
    (row.expiresAt as number) < 0 ||
    !['accepted', 'rejected', 'unknown'].includes(row.status as string) ||
    (row.status === 'rejected'
      ? !wearReceiptReasons.includes(row.reason as WearReceiptReason)
      : row.reason !== null)
  ) {
    return { ok: false, reason: 'invalid-receipt' }
  }
  if (
    (row.expiresAt as number) <= now ||
    (row.expiresAt as number) - now > 120_000 + WEAR_RECEIVER_CLOCK_SKEW_MS
  ) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true, receipt: row as WearReceipt }
}

export function encodeWearReceipt(receipt: WearReceipt, now: number): string {
  if (receipt.expiresAt - now > 120_000) {
    throw new Error('Invalid Wear receipt: expired')
  }
  const serialized = JSON.stringify(
    Object.fromEntries(receiptKeys.map((key) => [key, receipt[key]]))
  )
  const decoded = decodeWearReceipt(serialized, now)
  if (!decoded.ok) {
    throw new Error(`Invalid Wear receipt: ${decoded.reason}`)
  }
  return serialized
}
