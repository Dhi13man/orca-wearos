import { describe, expect, it, vi } from 'vitest'
import type { PhoneDashboardView } from './use-phone-dashboard'

const loaded = vi.hoisted(() => ({
  current: {
    bindingId: 'old-binding',
    view: { state: 'ready', dashboard: { bindingId: 'old-binding' } }
  }
}))

vi.mock('react', () => ({
  useState: () => [loaded.current, vi.fn()],
  useEffect: vi.fn()
}))
vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn() } }))
vi.mock('@orca/expo-wear-data-layer', () => ({ wearDataLayer: null }))

import { usePhoneDashboard } from './use-phone-dashboard'

describe('watch dashboard binding switch', () => {
  it('never returns a previous phone binding during the first render for a new binding', () => {
    expect(usePhoneDashboard('new-binding')).toEqual({ state: 'missing' })
    expect(usePhoneDashboard('old-binding')).toBe(loaded.current.view as PhoneDashboardView)
    expect(usePhoneDashboard(null)).toEqual({ state: 'missing' })
  })
})
