import { describe, expect, it } from 'vitest'
import { pairingEndpointLabel, parsePairingCode } from './pairing'

const offer = {
  v: 2,
  endpoint: 'ws://100.64.1.20:6768',
  deviceToken: 'device-token',
  publicKeyB64: btoa(String.fromCharCode(...new Uint8Array(32))),
  scope: 'wear'
} as const

function encodedOffer(value: unknown = offer): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('parsePairingCode', () => {
  it('accepts the current Orca query pairing URL', () => {
    expect(parsePairingCode(`orca://pair?code=${encodedOffer()}`)).toEqual(offer)
  })

  it('accepts the legacy fragment and bare payload forms', () => {
    expect(parsePairingCode(`ORCA://pair#${encodedOffer()}`)).toEqual(offer)
    expect(parsePairingCode(encodedOffer())).toEqual(offer)
  })

  it('rejects adjacent routes, non-WebSocket endpoints, and malformed keys', () => {
    expect(parsePairingCode(`orca://pairing?code=${encodedOffer()}`)).toBeNull()
    expect(parsePairingCode(encodedOffer({ ...offer, endpoint: 'https://example.com' }))).toBeNull()
    expect(parsePairingCode(encodedOffer({ ...offer, publicKeyB64: 'short' }))).toBeNull()
    expect(parsePairingCode(encodedOffer({ ...offer, scope: 'mobile' }))).toBeNull()
  })
})

describe('pairingEndpointLabel', () => {
  it('shows only the endpoint authority', () => {
    expect(pairingEndpointLabel('ws://100.64.1.20:6768/private?token=secret')).toBe(
      '100.64.1.20:6768'
    )
  })
})
