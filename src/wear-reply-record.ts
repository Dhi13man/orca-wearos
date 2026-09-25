import * as SecureStore from 'expo-secure-store'

export type WearReplyRecord = {
  bindingId: string
  requestId: string
  actionHash: string
  targetKey: string
  agentTitle: string
  machineName: string
}

const KEY = 'orca.wear.reply.v1'
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
}
let current: Promise<WearReplyRecord | null> | null = null

export function describeWearReplyTarget(record: WearReplyRecord): string {
  const target: unknown = JSON.parse(record.targetKey)
  if (
    !Array.isArray(target) ||
    target.length !== 7 ||
    typeof target[1] !== 'string' ||
    typeof target[2] !== 'string' ||
    typeof target[4] !== 'string'
  ) {
    throw new Error('Invalid saved Wear reply target')
  }
  return `${record.agentTitle} on ${record.machineName} (${target[1]}); workspace ${target[2]}, tab ${target[4]}`
}

export function loadWearReplyRecord(): Promise<WearReplyRecord | null> {
  current ??= SecureStore.getItemAsync(KEY, OPTIONS).then((stored) => {
    if (!stored) {
      return null
    }
    const value: unknown = JSON.parse(stored)
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 6 ||
      !('bindingId' in value) ||
      typeof value.bindingId !== 'string' ||
      !('requestId' in value) ||
      typeof value.requestId !== 'string' ||
      !('actionHash' in value) ||
      typeof value.actionHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.actionHash) ||
      !('targetKey' in value) ||
      typeof value.targetKey !== 'string' ||
      !('agentTitle' in value) ||
      typeof value.agentTitle !== 'string' ||
      !('machineName' in value) ||
      typeof value.machineName !== 'string'
    ) {
      throw new Error('Invalid saved Wear reply')
    }
    return value as WearReplyRecord
  })
  return current
}

export async function reserveWearReplyRecord(record: WearReplyRecord): Promise<boolean> {
  const loaded = loadWearReplyRecord()
  if ((await loaded) || current !== loaded) {
    return false
  }
  current = Promise.resolve(record)
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(record), OPTIONS)
    return true
  } catch (error) {
    current = Promise.reject(error)
    void current.catch(() => undefined)
    throw error
  }
}

export async function clearWearReplyRecord(record: WearReplyRecord): Promise<void> {
  const saved = await loadWearReplyRecord()
  if (saved?.requestId !== record.requestId || saved.bindingId !== record.bindingId) {
    return
  }
  await SecureStore.deleteItemAsync(KEY, OPTIONS)
  current = Promise.resolve(null)
}
