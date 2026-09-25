import * as SecureStore from 'expo-secure-store'

export type WearHandoffRecord = {
  bindingId: string
  requestId: string
  actionHash: string
  targetKey: string
}

const KEY = 'orca.wear.handoff.v1'
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
}
let current: Promise<WearHandoffRecord | null> | null = null

export function loadWearHandoffRecord(): Promise<WearHandoffRecord | null> {
  current ??= SecureStore.getItemAsync(KEY, OPTIONS).then((stored) => {
    if (!stored) {
      return null
    }
    const value: unknown = JSON.parse(stored)
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 4 ||
      !('bindingId' in value) ||
      typeof value.bindingId !== 'string' ||
      !('requestId' in value) ||
      typeof value.requestId !== 'string' ||
      !('actionHash' in value) ||
      typeof value.actionHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.actionHash) ||
      !('targetKey' in value) ||
      typeof value.targetKey !== 'string'
    ) {
      throw new Error('Invalid saved Wear phone handoff')
    }
    return value as WearHandoffRecord
  })
  return current
}

export async function reserveWearHandoffRecord(record: WearHandoffRecord): Promise<boolean> {
  const loaded = loadWearHandoffRecord()
  if ((await loaded) || current !== loaded) {
    return false
  }
  current = Promise.resolve(record)
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(record), OPTIONS)
    return true
  } catch (error) {
    current = null
    throw error
  }
}

export async function clearWearHandoffRecord(record: WearHandoffRecord): Promise<void> {
  const saved = await loadWearHandoffRecord()
  if (
    saved?.bindingId !== record.bindingId ||
    saved.requestId !== record.requestId ||
    saved.actionHash !== record.actionHash
  ) {
    return
  }
  await SecureStore.deleteItemAsync(KEY, OPTIONS)
  current = Promise.resolve(null)
}
