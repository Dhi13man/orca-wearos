import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { wearDataLayer } from '@orca/expo-wear-data-layer'
import { readPhoneDashboard, type PhoneDashboardRead } from './phone-dashboard-repository'

export type PhoneDashboardView = PhoneDashboardRead | { state: 'unavailable' }

export function usePhoneDashboard(bindingId: string | null): PhoneDashboardView {
  const [loaded, setLoaded] = useState<{
    bindingId: string | null
    view: PhoneDashboardView
  }>({ bindingId: null, view: { state: 'missing' } })

  useEffect(() => {
    if (!bindingId || !wearDataLayer) {
      setLoaded({ bindingId, view: { state: 'missing' } })
      return
    }
    let live = true
    let request = 0
    setLoaded({ bindingId, view: { state: 'missing' } })
    const refresh = async () => {
      const current = ++request
      try {
        const result = await readPhoneDashboard(bindingId)
        if (live && current === request) {
          setLoaded({ bindingId, view: result })
        }
      } catch {
        if (live && current === request) {
          setLoaded({ bindingId, view: { state: 'unavailable' } })
        }
      }
    }
    const dashboardListener = wearDataLayer.addListener('onDashboardChanged', (event) => {
      if (event.bindingId === bindingId) {
        void refresh()
      }
    })
    const appStateListener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh()
      }
    })
    void refresh()
    return () => {
      live = false
      dashboardListener.remove()
      appStateListener.remove()
    }
  }, [bindingId])

  useEffect(() => {
    if (loaded.bindingId !== bindingId) {
      return
    }
    const { view } = loaded
    if (view.state !== 'ready') {
      return
    }
    const dashboard = view.dashboard
    const delay = Math.max(0, dashboard.expiresAt - Date.now())
    const timer = setTimeout(() => {
      setLoaded((current) =>
        current.bindingId === bindingId &&
        current.view.state === 'ready' &&
        current.view.dashboard.publisherEpoch === dashboard.publisherEpoch &&
        current.view.dashboard.revision === dashboard.revision
          ? { bindingId, view: { state: 'rejected', reason: 'expired' } }
          : current
      )
    }, delay)
    return () => clearTimeout(timer)
  }, [bindingId, loaded])

  return loaded.bindingId === bindingId ? loaded.view : { state: 'missing' }
}
