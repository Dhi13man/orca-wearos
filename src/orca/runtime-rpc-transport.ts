import * as ExpoCrypto from 'expo-crypto'
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  generateKeyPair,
  publicKeyFromBase64,
  publicKeyToBase64
} from './e2ee'
import type { PairingOffer } from './pairing'

const REQUEST_TIMEOUT_MS = 25_000
const WEAR_CAPABILITIES = [
  'agent-session.structured.v1',
  'wear.action-target.v1',
  'wear.terminal-send.v1',
  'wear.structured-send.v1',
  'wear.conversation-read.v1'
] as const

type SocketEvent = { data: unknown }
type SocketCloseEvent = { code?: number }

export type OrcaSocket = {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: SocketEvent) => void) | null
  onclose: ((event: SocketCloseEvent) => void) | null
  onerror: (() => void) | null
  send(data: string): void
  close(): void
}

export type ClientDependencies = {
  createSocket: (endpoint: string) => OrcaSocket
  createRequestId: () => string
  timeoutMs: number
  signal?: AbortSignal
}

type RuntimeRequest = { method: string; params?: unknown }
export type RuntimeReply = { ok: true; result: unknown } | { ok: false; error: string }

export class RuntimeTransportError extends Error {
  constructor(
    message: string,
    readonly delivery: 'not-sent' | 'unknown'
  ) {
    super(message)
    this.name = 'RuntimeTransportError'
  }
}

const defaultDependencies: ClientDependencies = {
  createSocket: (endpoint) => new WebSocket(endpoint) as unknown as OrcaSocket,
  createRequestId: () =>
    Array.from(ExpoCrypto.getRandomBytes(12), (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    ),
  timeoutMs: REQUEST_TIMEOUT_MS
}

export function requestRuntime(
  offer: PairingOffer,
  requests: Record<string, RuntimeRequest>,
  dependencyOverrides: Partial<ClientDependencies>
): Promise<Record<string, RuntimeReply>> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }
  return new Promise((resolve, reject) => {
    if (dependencies.signal?.aborted) {
      reject(new RuntimeTransportError('Orca request cancelled', 'not-sent'))
      return
    }
    const socket = dependencies.createSocket(offer.endpoint)
    const serverPublicKey = publicKeyFromBase64(offer.publicKeyB64)
    const ephemeral = generateKeyPair()
    const sharedKey = deriveSharedKey(ephemeral.secretKey, serverPublicKey)
    const requestById = new Map<string, string>()
    const replies: Record<string, RuntimeReply> = {}
    let authenticated = false
    let requestFramesSent = false
    let settled = false

    for (const key of Object.keys(requests)) {
      requestById.set(dependencies.createRequestId(), key)
    }

    const settle = (result: { replies: Record<string, RuntimeReply> } | { error: Error }): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      dependencies.signal?.removeEventListener('abort', abort)
      socket.close()
      if ('replies' in result) {
        resolve(result.replies)
      } else {
        reject(result.error)
      }
    }
    const failTransport = (message: string): void => {
      settle({
        error: new RuntimeTransportError(message, requestFramesSent ? 'unknown' : 'not-sent')
      })
    }
    const abort = (): void => failTransport('Orca request cancelled')
    dependencies.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(
      () => failTransport('Orca connection timed out'),
      dependencies.timeoutMs
    )
    if (dependencies.signal?.aborted) {
      abort()
      return
    }

    socket.onopen = () => {
      if (settled || dependencies.signal?.aborted) {
        return
      }
      try {
        socket.send(
          JSON.stringify({
            type: 'e2ee_hello',
            publicKeyB64: publicKeyToBase64(ephemeral.publicKey)
          })
        )
      } catch {
        failTransport('Could not reach the Orca runtime')
      }
    }
    socket.onmessage = (event) => {
      if (settled || dependencies.signal?.aborted) {
        return
      }
      if (typeof event.data !== 'string') {
        return
      }
      if (!authenticated) {
        handleHandshake(event.data)
        return
      }
      handleResponse(event.data)
    }
    socket.onerror = () => failTransport('Could not reach the Orca runtime')
    socket.onclose = (event) => {
      if (!settled) {
        failTransport(`Orca connection closed${event.code ? ` (${event.code})` : ''}`)
      }
    }

    const handleHandshake = (data: string): void => {
      const plaintextMessage = parseJson(data)
      if (plaintextMessage?.type === 'e2ee_ready') {
        if (settled || dependencies.signal?.aborted) {
          return
        }
        socket.send(
          encrypt(
            JSON.stringify({
              type: 'e2ee_auth',
              deviceToken: offer.deviceToken,
              clientCapabilities: WEAR_CAPABILITIES
            }),
            sharedKey
          )
        )
        return
      }
      const handshake = parseEncryptedJson(data, sharedKey)
      if (handshake?.type === 'e2ee_authenticated') {
        authenticated = true
        for (const [id, key] of requestById) {
          if (settled || dependencies.signal?.aborted) {
            return
          }
          const request = requests[key]
          if (!request) {
            continue
          }
          socket.send(
            encrypt(
              JSON.stringify({
                id,
                deviceToken: offer.deviceToken,
                method: request.method,
                ...(request.params === undefined ? {} : { params: request.params })
              }),
              sharedKey
            )
          )
          requestFramesSent = true
        }
      } else if (handshake?.type === 'e2ee_error' || handshake?.ok === false) {
        settle({ error: new Error('Orca rejected this pairing') })
      }
    }

    const handleResponse = (data: string): void => {
      const response = parseEncryptedJson(data, sharedKey)
      if (!response || typeof response.id !== 'string') {
        return
      }
      const key = requestById.get(response.id)
      if (!key || replies[key]) {
        return
      }
      replies[key] =
        response.ok === true
          ? { ok: true, result: response.result }
          : { ok: false, error: rpcErrorMessage(response) }
      if (Object.keys(replies).length === requestById.size) {
        settle({ replies })
      }
    }
  })
}

function parseEncryptedJson(
  ciphertext: string,
  sharedKey: Uint8Array
): Record<string, unknown> | null {
  const plaintext = decrypt(ciphertext, sharedKey)
  return plaintext === null ? null : parseJson(plaintext)
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function rpcErrorMessage(response: Record<string, unknown>): string {
  const error = asRecord(response.error)
  return typeof error?.message === 'string'
    ? error.message.slice(0, 240)
    : 'Orca rejected the request'
}
