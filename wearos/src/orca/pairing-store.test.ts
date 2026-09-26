import { beforeEach, expect, it, vi } from 'vitest'

const saved = vi.hoisted(() => new Map<string, string>())
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: async (key: string) => saved.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    saved.set(key, value)
  },
  deleteItemAsync: async (key: string) => {
    saved.delete(key)
  }
}))

import { loadPairings, removePairing, savePairing } from './pairing-store'
import type { PairingOffer } from './pairing'

const publicKeyB64 = btoa(String.fromCharCode(...Array(32).fill(1)))
const offer = (endpoint: string, deviceToken: string): PairingOffer => ({
  v: 2,
  endpoint,
  deviceToken,
  publicKeyB64,
  scope: 'wear'
})

beforeEach(() => saved.clear())

it('retains multiple hosts and replaces only a rotated host grant', async () => {
  const first = offer('ws://host-a:6768', 'a')
  const second = offer('ws://host-b:6768', 'b')
  await savePairing(first)
  await savePairing(second)
  expect(await loadPairings()).toEqual([first, second])
  const rotated = offer(first.endpoint, 'new-a')
  await savePairing(rotated)
  expect(await loadPairings()).toEqual([second, rotated])
  await removePairing(second)
  expect(await loadPairings()).toEqual([rotated])
})

it('keeps an existing single-host pairing while adding a second host', async () => {
  const first = offer('ws://host-a:6768', 'a')
  saved.set('orca.wear.pairing.v1', btoa(JSON.stringify(first)))
  const second = offer('ws://host-b:6768', 'b')
  await savePairing(second)
  expect(await loadPairings()).toEqual([first, second])
  await removePairing(first)
  expect(await loadPairings()).toEqual([second])
})
