import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))
import { normalizeManualEndpoint } from './manual-enrollment'

describe('normalizeManualEndpoint', () => {
  it('accepts advertised WebSocket paths without dropping them', () => {
    expect(normalizeManualEndpoint('wss://orca.example.test:6768/runtime')).toBe(
      'wss://orca.example.test:6768/runtime'
    )
    expect(normalizeManualEndpoint('192.168.1.2:6768')).toBe('ws://192.168.1.2:6768')
    expect(normalizeManualEndpoint('wss://orca.example.test/runtime')).toBe(
      'wss://orca.example.test/runtime'
    )
    expect(normalizeManualEndpoint('wss://user:pass@orca.example.test:6768/runtime')).toBeNull()
  })
})
