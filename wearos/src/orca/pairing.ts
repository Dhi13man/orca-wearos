const PAIRING_CODE_MAX_CHARACTERS = 128 * 1024
const PAIRING_INPUT_MAX_CHARACTERS = PAIRING_CODE_MAX_CHARACTERS + 1024
const PAIRING_ENDPOINT_MAX_CHARACTERS = 16 * 1024
const PAIRING_DEVICE_TOKEN_MAX_CHARACTERS = 64 * 1024
const PAIRING_PUBLIC_KEY_MAX_CHARACTERS = 4 * 1024

export type PairingOffer = {
  v: 2
  endpoint: string
  deviceToken: string
  publicKeyB64: string
  pairedDeviceId?: string
  scope: 'wear'
}

export function parsePairingCode(input: string): PairingOffer | null {
  if (input.length > PAIRING_INPUT_MAX_CHARACTERS) {
    return null
  }
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  try {
    const code = /^orca:\/\//i.test(trimmed) ? extractCode(trimmed) : trimmed
    if (!code || code.length > PAIRING_CODE_MAX_CHARACTERS) {
      return null
    }
    const base64 = padBase64(code.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
    return parsePairingOffer(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

export function pairingEndpointLabel(endpoint: string): string {
  try {
    const parsed = new URL(endpoint)
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
  } catch {
    return 'Orca runtime'
  }
}

function extractCode(input: string): string | null {
  const match = /^orca:\/\/([^/?#]*)([^?#]*)?/i.exec(input)
  if (!match || match[1]?.toLowerCase() !== 'pair') {
    return null
  }
  const pathname = match[2] ?? ''
  if (pathname !== '' && pathname !== '/') {
    return null
  }
  const rest = input.slice(match[0].length)
  const queryIndex = rest.indexOf('?')
  if (queryIndex !== -1) {
    const query = rest.slice(queryIndex + 1).split('#')[0] ?? ''
    const code = new URLSearchParams(query).get('code')
    if (code) {
      return code
    }
  }
  const hashIndex = rest.indexOf('#')
  return hashIndex === -1 ? null : rest.slice(hashIndex + 1) || null
}

function parsePairingOffer(value: unknown): PairingOffer | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const offer = value as Record<string, unknown>
  if (
    offer.v !== 2 ||
    !boundedString(offer.endpoint, PAIRING_ENDPOINT_MAX_CHARACTERS) ||
    !boundedString(offer.deviceToken, PAIRING_DEVICE_TOKEN_MAX_CHARACTERS) ||
    !boundedString(offer.publicKeyB64, PAIRING_PUBLIC_KEY_MAX_CHARACTERS) ||
    offer.scope !== 'wear' ||
    offer.relay !== undefined ||
    (offer.pairedDeviceId !== undefined && !boundedString(offer.pairedDeviceId, 128))
  ) {
    return null
  }
  const endpoint = offer.endpoint as string
  const deviceToken = offer.deviceToken as string
  const publicKeyB64 = offer.publicKeyB64 as string
  const pairedDeviceId = offer.pairedDeviceId as string | undefined
  if (!validWebSocketEndpoint(endpoint) || !validPublicKey(publicKeyB64)) {
    return null
  }
  return {
    v: 2,
    endpoint,
    deviceToken,
    publicKeyB64,
    ...(pairedDeviceId ? { pairedDeviceId } : {}),
    scope: 'wear'
  }
}

function validWebSocketEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint)
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:'
  } catch {
    return false
  }
}

function validPublicKey(value: string): boolean {
  try {
    return atob(value).length === 32
  } catch {
    return false
  }
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function padBase64(value: string): string {
  const remainder = value.length % 4
  return remainder === 0 ? value : `${value}${'='.repeat(4 - remainder)}`
}
