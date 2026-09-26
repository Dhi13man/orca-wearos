import * as SecureStore from 'expo-secure-store'

export type PendingWearReply = {
  bindingId: string
  runtimeId: string
  requestId: string
  agentId: string
  expiresAt: number
}

export function absentReplyCanExpire(reply: PendingWearReply, now: number): boolean {
  return now > reply.expiresAt + 60_000 && now < reply.expiresAt + 24 * 60 * 60 * 1_000
}

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
}

function key(bindingId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(bindingId)) {
    throw new Error('Invalid watch binding')
  }
  return `orca.wear.reply.${bindingId}`
}

export async function loadPendingReply(bindingId: string): Promise<PendingWearReply | null> {
  const raw = await SecureStore.getItemAsync(key(bindingId), options)
  if (!raw) {
    return null
  }
  const value: unknown = JSON.parse(raw)
  if (
    !value ||
    typeof value !== 'object' ||
    !('bindingId' in value) ||
    value.bindingId !== bindingId ||
    !('runtimeId' in value) ||
    typeof value.runtimeId !== 'string' ||
    !('requestId' in value) ||
    typeof value.requestId !== 'string' ||
    !('agentId' in value) ||
    typeof value.agentId !== 'string' ||
    !('expiresAt' in value) ||
    typeof value.expiresAt !== 'number'
  ) {
    throw new Error('Invalid saved reply receipt')
  }
  return value as PendingWearReply
}

export async function savePendingReply(reply: PendingWearReply): Promise<void> {
  await SecureStore.setItemAsync(key(reply.bindingId), JSON.stringify(reply), options)
}

export async function clearPendingReply(bindingId: string): Promise<void> {
  await SecureStore.deleteItemAsync(key(bindingId), options)
}
