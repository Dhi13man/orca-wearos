import nacl from 'tweetnacl'
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  generateKeyPair,
  publicKeyFromBase64,
  publicKeyToBase64
} from './e2ee'
import type { PairingOffer } from './pairing'
import type { OrcaSocket } from './runtime-rpc-transport'

const PROOF_CONTEXT = new TextEncoder().encode('orca-wear-enrollment-v1\0')
const TIMEOUT_MS = 15_000

export function normalizeManualCode(value: string): string | null {
  const code = value.replace(/[ -]/g, '').toUpperCase()
  return /^[0-9A-F]{20}$/.test(code) ? code : null
}

export function normalizeManualEndpoint(value: string): string | null {
  try {
    const url = new URL(/^wss?:\/\//i.test(value.trim()) ? value.trim() : `ws://${value.trim()}`)
    if (
      (url.protocol !== 'ws:' && url.protocol !== 'wss:') ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url.pathname === '/' ? url.origin : url.href
  } catch {
    return null
  }
}

export async function redeemWearManualCode(
  endpointInput: string,
  codeInput: string,
  createSocket: (endpoint: string) => OrcaSocket = (endpoint) =>
    new WebSocket(endpoint) as unknown as OrcaSocket
): Promise<PairingOffer> {
  const endpoint = normalizeManualEndpoint(endpointInput)
  const code = normalizeManualCode(codeInput)
  if (!endpoint || !code) {
    throw new Error('Enter the Orca endpoint and 20-character watch code')
  }
  const keypair = generateKeyPair()
  return new Promise((resolve, reject) => {
    const socket = createSocket(endpoint)
    let settled = false
    let sharedKey: Uint8Array | null = null
    let serverPublicKeyB64: string | null = null
    const finish = (offer: PairingOffer | null, error: string) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      socket.close()
      if (offer) {
        resolve(offer)
      } else {
        reject(new Error(error))
      }
    }
    const timer = setTimeout(() => finish(null, 'Watch pairing timed out'), TIMEOUT_MS)
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          type: 'e2ee_hello',
          publicKeyB64: publicKeyToBase64(keypair.publicKey),
          wearEnrollment: true
        })
      )
    socket.onerror = () => finish(null, 'Could not reach this Orca host')
    socket.onclose = () => finish(null, 'Orca closed watch pairing')
    socket.onmessage = ({ data }) => {
      if (typeof data !== 'string') {
        return
      }
      if (!sharedKey) {
        let ready: Record<string, unknown>
        try {
          ready = JSON.parse(data) as Record<string, unknown>
        } catch {
          finish(null, 'Invalid watch pairing response')
          return
        }
        if (
          ready.type !== 'e2ee_ready' ||
          typeof ready.serverPublicKeyB64 !== 'string' ||
          typeof ready.proofB64 !== 'string'
        ) {
          finish(null, 'This Orca host does not offer manual watch pairing')
          return
        }
        try {
          const serverPublicKey = publicKeyFromBase64(ready.serverPublicKeyB64)
          if (!verifyProof(code, keypair.publicKey, serverPublicKey, ready.proofB64)) {
            finish(null, 'Watch code does not match this Orca host')
            return
          }
          serverPublicKeyB64 = ready.serverPublicKeyB64
          sharedKey = deriveSharedKey(keypair.secretKey, serverPublicKey)
          socket.send(
            encrypt(
              JSON.stringify({
                type: 'e2ee_auth',
                deviceToken: `wear-code:${code}`
              }),
              sharedKey
            )
          )
        } catch {
          finish(null, 'Invalid watch pairing proof')
        }
        return
      }
      const message = decrypt(data, sharedKey)
      if (!message) {
        finish(null, 'Invalid watch pairing confirmation')
        return
      }
      try {
        const result = JSON.parse(message) as Record<string, unknown>
        if (result.type === 'e2ee_error') {
          finish(null, 'Watch code expired, already used, or rejected by Orca')
          return
        }
        if (
          result.type !== 'e2ee_authenticated' ||
          result.scope !== 'wear' ||
          typeof result.deviceToken !== 'string' ||
          result.deviceToken.length === 0 ||
          typeof result.pairedDeviceId !== 'string'
        ) {
          finish(null, 'Orca rejected this watch code')
          return
        }
        resolveOffer(result.deviceToken, result.pairedDeviceId)
      } catch {
        finish(null, 'Invalid watch pairing confirmation')
      }
    }
    const resolveOffer = (deviceToken: string, pairedDeviceId: string) => {
      const offer: PairingOffer = {
        v: 2,
        endpoint,
        deviceToken,
        pairedDeviceId,
        publicKeyB64: serverPublicKeyB64!,
        scope: 'wear'
      }
      finish(offer, '')
    }
  })
}

function verifyProof(
  code: string,
  clientPublicKey: Uint8Array,
  serverPublicKey: Uint8Array,
  proofB64: string
): boolean {
  const key = Uint8Array.from(code.match(/../g)!, (pair) => Number.parseInt(pair, 16))
  const block = new Uint8Array(128)
  block.set(key)
  const inner = block.map((byte) => byte ^ 0x36)
  const outer = block.map((byte) => byte ^ 0x5c)
  const payload = concat(PROOF_CONTEXT, clientPublicKey, serverPublicKey)
  const expected = nacl.hash(concat(outer, nacl.hash(concat(inner, payload))))
  try {
    const actual = Uint8Array.from(atob(proofB64), (character) => character.charCodeAt(0))
    return actual.length === expected.length && nacl.verify(actual, expected)
  } catch {
    return false
  }
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}
