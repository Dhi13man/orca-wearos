import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeWearAction } from './action'

const vectors: { name: string; serialized: string; now: number; accepted: boolean }[] = JSON.parse(
  readFileSync(new URL('../conformance/action-vectors.json', import.meta.url), 'utf8')
)
describe('shared TypeScript/Kotlin action vectors', () => {
  it.each(vectors)('$name', ({ serialized, now, accepted }) => {
    const result = decodeWearAction(serialized, now)
    expect(result.ok).toBe(accepted)
    if (result.ok) {
      expect(result.canonical).toBe(serialized)
    }
  })
})
