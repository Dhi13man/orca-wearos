import * as ExpoCrypto from 'expo-crypto'
import nacl from 'tweetnacl'

nacl.setPRNG((target: Uint8Array, length: number) => {
  target.set(ExpoCrypto.getRandomBytes(length))
})

function bytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value)
}

export function generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  const pair = nacl.box.keyPair()
  return { publicKey: bytes(pair.publicKey), secretKey: bytes(pair.secretKey) }
}

export function deriveSharedKey(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return bytes(nacl.box.before(bytes(publicKey), bytes(secretKey)))
}

export function publicKeyFromBase64(value: string): Uint8Array {
  const key = base64ToBytes(value)
  if (key.length !== 32) {
    throw new Error('Invalid Orca public key')
  }
  return key
}

export function publicKeyToBase64(value: Uint8Array): string {
  return bytesToBase64(value)
}

export function encrypt(plaintext: string, sharedKey: Uint8Array): string {
  const nonce = bytes(nacl.randomBytes(nacl.box.nonceLength))
  const ciphertext = nacl.box.after(
    bytes(new TextEncoder().encode(plaintext)),
    nonce,
    bytes(sharedKey)
  )
  const bundle = new Uint8Array(nonce.length + ciphertext.length)
  bundle.set(nonce)
  bundle.set(ciphertext, nonce.length)
  return bytesToBase64(bundle)
}

export function decrypt(ciphertext: string, sharedKey: Uint8Array): string | null {
  const bundle = base64ToBytes(ciphertext)
  if (bundle.length < nacl.box.nonceLength + nacl.box.overheadLength) {
    return null
  }
  const nonce = bytes(bundle.subarray(0, nacl.box.nonceLength))
  const message = nacl.box.open.after(
    bytes(bundle.subarray(nacl.box.nonceLength)),
    nonce,
    bytes(sharedKey)
  )
  return message ? new TextDecoder().decode(bytes(message)) : null
}

function bytesToBase64(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
