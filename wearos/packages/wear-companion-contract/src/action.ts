import { actionManifest } from './action-manifest'
import { utf8Length } from './utf8'

type Actions = typeof actionManifest.actions
export type WearActionName = keyof Actions
type FieldValue<T> = T extends readonly string[]
  ? T[number]
  : T extends 'nullableId'
    ? string | null
    : string
type Fields<T> = { [K in keyof T]: FieldValue<T[K]> }
type ActionEnvelope = {
  schemaVersion: 1
  bindingId: string
  requestId: string
  expiresAt: number
  publisherEpoch: string
  expectedRevision: number
}
export type WearAction = {
  [K in WearActionName]: ActionEnvelope & {
    action: K
    target: Fields<Actions[K]['target']>
    payload: Fields<Actions[K]['payload']>
  } & (Actions[K]['sessionFenced'] extends true
      ? { targetPublicationEpoch: string; targetSnapshotVersion: number }
      : { targetPublicationEpoch: null; targetSnapshotVersion: null })
}[WearActionName]

export type ActionDecodeResult =
  | { ok: true; action: WearAction; canonical: string }
  | { ok: false; reason: 'too-large' | 'invalid-action' | 'noncanonical' | 'expired' }

type Descriptor = 'id' | 'nullableId' | 'message' | readonly string[]
type FieldSchema = Readonly<Record<string, Descriptor>>
const limits = actionManifest.limits

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && utf8Length(value) <= limits.idBytes
}

function revision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function fields(value: unknown, schema: FieldSchema): value is Record<string, unknown> {
  if (!record(value) || !exactKeys(value, Object.keys(schema))) {
    return false
  }
  return Object.entries(schema).every(([key, descriptor]) => {
    const field = value[key]
    if (Array.isArray(descriptor)) {
      return descriptor.includes(field as string)
    }
    if (descriptor === 'nullableId' && field === null) {
      return true
    }
    if (descriptor === 'message') {
      return (
        typeof field === 'string' &&
        field.trim().length > 0 &&
        utf8Length(field) <= limits.messageBytes
      )
    }
    return id(field)
  })
}

function orderedFields(
  value: Record<string, unknown>,
  schema: FieldSchema
): Record<string, unknown> {
  return Object.fromEntries(Object.keys(schema).map((key) => [key, value[key]]))
}

function canonicalAction(action: WearAction): string {
  const schema = actionManifest.actions[action.action]
  return JSON.stringify(
    Object.fromEntries(
      actionManifest.envelopeOrder.map((key) => [
        key,
        key === 'target'
          ? orderedFields(action.target, schema.target)
          : key === 'payload'
            ? orderedFields(action.payload, schema.payload)
            : action[key]
      ])
    )
  )
}

export function decodeWearAction(serialized: string, now: number): ActionDecodeResult {
  if (utf8Length(serialized) > limits.actionBytes) {
    return { ok: false, reason: 'too-large' }
  }
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return { ok: false, reason: 'invalid-action' }
  }
  if (
    !record(value) ||
    !exactKeys(value, actionManifest.envelopeOrder) ||
    value.schemaVersion !== actionManifest.schemaVersion ||
    typeof value.action !== 'string' ||
    !Object.hasOwn(actionManifest.actions, value.action) ||
    !id(value.bindingId) ||
    !id(value.requestId) ||
    !id(value.publisherEpoch) ||
    !revision(value.expectedRevision) ||
    !revision(value.expiresAt)
  ) {
    return { ok: false, reason: 'invalid-action' }
  }
  const schema = actionManifest.actions[value.action as WearActionName]
  if (
    !fields(value.target, schema.target) ||
    !fields(value.payload, schema.payload) ||
    utf8Length(JSON.stringify(value.payload)) > limits.payloadBytes ||
    (schema.sessionFenced
      ? !id(value.targetPublicationEpoch) || !revision(value.targetSnapshotVersion)
      : value.targetPublicationEpoch !== null || value.targetSnapshotVersion !== null)
  ) {
    return { ok: false, reason: 'invalid-action' }
  }
  const action = value as WearAction
  const canonical = canonicalAction(action)
  // Require one wire representation before hashing or executing an action.
  if (canonical !== serialized) {
    return { ok: false, reason: 'noncanonical' }
  }
  if (action.expiresAt <= now) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true, action, canonical }
}

export function encodeWearAction(action: WearAction): string {
  const serialized = canonicalAction(action)
  const decoded = decodeWearAction(serialized, -1)
  if (!decoded.ok) {
    throw new Error(`Invalid Wear action: ${decoded.reason}`)
  }
  return serialized
}
