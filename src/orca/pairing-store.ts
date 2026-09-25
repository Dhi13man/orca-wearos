import * as SecureStore from 'expo-secure-store'
import { parsePairingCode, type PairingOffer } from './pairing'

const PAIRING_KEY = 'orca.wear.pairing.v1'
const PAIRINGS_KEY = 'orca.wear.pairings.v1'
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
}

export async function loadPairing(): Promise<PairingOffer | null> {
  const stored = await SecureStore.getItemAsync(PAIRING_KEY, OPTIONS)
  if (!stored) {
    return null
  }
  const parsed = parsePairingCode(stored)
  if (!parsed) {
    await clearPairing()
  }
  return parsed
}

export async function savePairing(offer: PairingOffer): Promise<void> {
  const current = await loadPairings()
  const next = current.filter((item) => item.endpoint !== offer.endpoint)
  next.push(offer)
  await SecureStore.setItemAsync(PAIRINGS_KEY, JSON.stringify(next.map(encodeOffer)), OPTIONS)
}

export async function loadPairings(): Promise<PairingOffer[]> {
  const stored = await SecureStore.getItemAsync(PAIRINGS_KEY, OPTIONS)
  const legacy = await loadPairing()
  if (!stored) {
    return legacy ? [legacy] : []
  }
  const encoded: unknown = JSON.parse(stored)
  if (!Array.isArray(encoded) || encoded.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid saved Orca runtimes')
  }
  const offers = encoded.map((item) => parsePairingCode(item as string))
  if (offers.some((offer) => !offer)) {
    throw new Error('Invalid saved Orca runtime pairing')
  }
  const valid = offers as PairingOffer[]
  return legacy && !valid.some((offer) => offer.endpoint === legacy.endpoint)
    ? [legacy, ...valid]
    : valid
}

export async function removePairing(removed: PairingOffer): Promise<void> {
  const remaining = (await loadPairings()).filter((offer) => offer.endpoint !== removed.endpoint)
  await SecureStore.setItemAsync(PAIRINGS_KEY, JSON.stringify(remaining.map(encodeOffer)), OPTIONS)
  const legacy = await loadPairing()
  if (legacy?.endpoint === removed.endpoint) {
    await clearPairing()
  }
}

function encodeOffer(offer: PairingOffer): string {
  const bytes = new TextEncoder().encode(JSON.stringify(offer))
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return encoded
}

export async function clearPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(PAIRING_KEY, OPTIONS)
}
