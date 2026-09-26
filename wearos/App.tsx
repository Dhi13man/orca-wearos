import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  Linking,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { AgentConversation } from './src/command-center/agent-conversation'
import { RuntimeDashboard } from './src/command-center/runtime-dashboard'
import { fetchRuntimeStatus } from './src/orca/direct-orca-client'
import { refreshFleet, type FleetHost } from './src/orca/fleet-dashboard'
import {
  invalidateDirectPairings,
  loadCachedFleet,
  syncDirectPairings
} from './src/orca/direct-dashboard-cache'
import { loadPairings, removePairing, savePairing } from './src/orca/pairing-store'
import { parsePairingCode, type PairingOffer } from './src/orca/pairing'
import { redeemWearManualCode } from './src/orca/manual-enrollment'
import { wearDataLayer } from '@orca/expo-wear-data-layer'
import type { WearAgentSession } from './src/orca/runtime-dashboard'
import { WearButton } from './src/wear-button'
import { wearColors } from './src/wear-theme'

export default function App() {
  const [pairings, setPairings] = useState<PairingOffer[]>([])
  const [showEnroll, setShowEnroll] = useState(false)
  const [pairingInput, setPairingInput] = useState('')
  const [manualEndpoint, setManualEndpoint] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [usePairingLink, setUsePairingLink] = useState(false)
  const [hosts, setHosts] = useState<FleetHost[]>([])
  const scrollRef = useRef<ScrollView>(null)
  const hostsRef = useRef<FleetHost[]>([])
  const refreshGeneration = useRef(0)
  const usageFollowups = useRef(0)
  const [selectedAgent, setSelectedAgent] = useState<{
    host: FleetHost
    agent: WearAgentSession
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }, [showEnroll, selectedAgent])

  const refresh = useCallback(async (offers: PairingOffer[]) => {
    const generation = ++refreshGeneration.current
    const prior = new Map(hostsRef.current.map((host) => [host.pairing.endpoint, host]))
    setHosts(
      offers.map((offer) => {
        const saved = prior.get(offer.endpoint)
        return saved?.pairing.publicKeyB64 === offer.publicKeyB64 &&
          saved.pairing.deviceToken === offer.deviceToken
          ? { ...saved, pairing: offer }
          : { pairing: offer, dashboard: null, observedAt: null, checkedAt: 0, error: null }
      })
    )
    setBusy(true)
    try {
      const updated = await refreshFleet(offers, hostsRef.current)
      if (generation === refreshGeneration.current) {
        hostsRef.current = updated
        setHosts(updated)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reach Orca')
    } finally {
      if (generation === refreshGeneration.current) {
        setBusy(false)
      }
    }
  }, [])

  const acceptOffer = useCallback(
    async (offer: PairingOffer) => {
      setBusy(true)
      setError('')
      try {
        await fetchRuntimeStatus(offer)
        invalidateDirectPairings()
        await savePairing(offer)
        const saved = await loadPairings()
        await syncDirectPairings(saved)
        setPairings(saved)
        usageFollowups.current = 0
        setShowEnroll(false)
        setPairingInput('')
        setManualCode('')
        void refresh(saved)
      } catch (caught) {
        let message = caught instanceof Error ? caught.message : 'Could not pair with Orca'
        try {
          await syncDirectPairings(await loadPairings())
        } catch {
          message = 'Saved runtimes are unavailable; restart the watch app'
        }
        setError(message)
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  const enroll = useCallback(
    async (input: string) => {
      const offer = parsePairingCode(input)
      if (!offer) {
        setError('Enter a Wear pairing link from Orca')
        return
      }
      await acceptOffer(offer)
    },
    [acceptOffer]
  )

  const enrollManual = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const offer = await redeemWearManualCode(manualEndpoint, manualCode)
      await acceptOffer(offer)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not pair with Orca')
    } finally {
      setBusy(false)
    }
  }, [acceptOffer, manualEndpoint, manualCode])

  const enterManualText = async (label: string, save: (value: string) => void) => {
    if (!wearDataLayer) {
      setError('Watch text input is unavailable')
      return
    }
    try {
      const value = await wearDataLayer.requestText(label)
      if (value !== null) {
        save(value.trim())
        setError('')
      }
    } catch {
      setError('Watch text input is unavailable')
    }
  }

  useEffect(() => {
    let active = true
    void Promise.all([loadPairings(), Linking.getInitialURL()])
      .then(async ([saved, url]) => {
        if (!active) {
          return
        }
        await syncDirectPairings(saved)
        const cached = await loadCachedFleet(saved)
        if (!active) {
          return
        }
        hostsRef.current = cached
        setHosts(cached)
        setPairings(saved)
        if (url && parsePairingCode(url)) {
          void enroll(url)
        } else if (saved.length) {
          void refresh(saved)
        } else {
          setShowEnroll(true)
        }
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Saved runtimes are unavailable')
      })
    const link = Linking.addEventListener('url', ({ url }) => {
      if (parsePairingCode(url)) {
        void enroll(url)
      }
    })
    return () => {
      active = false
      link.remove()
    }
  }, [enroll, refresh])

  useEffect(() => {
    if (!pairings.length) {
      return
    }
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        void refresh(pairings)
      }
    }, 60_000)
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh(pairings)
      }
    })
    return () => {
      clearInterval(timer)
      app.remove()
    }
  }, [pairings, refresh])

  useEffect(() => {
    if (!hosts.some((host) => host.dashboard?.usageRefreshPending) || usageFollowups.current >= 2) {
      return
    }
    const timer = setTimeout(() => {
      if (AppState.currentState === 'active') {
        usageFollowups.current += 1
        void refresh(pairings)
      }
    }, 10_000)
    return () => clearTimeout(timer)
  }, [hosts, pairings, refresh])

  const forget = async (host: FleetHost) => {
    try {
      invalidateDirectPairings()
      await removePairing(host.pairing)
      const remaining = await loadPairings()
      await syncDirectPairings(remaining)
      setPairings(remaining)
      usageFollowups.current = 0
      setShowEnroll(remaining.length === 0)
      setSelectedAgent(null)
      setError('')
      void refresh(remaining)
    } catch (caught) {
      let message = caught instanceof Error ? caught.message : 'Could not remove this runtime'
      try {
        const saved = await loadPairings()
        await syncDirectPairings(saved)
        setPairings(saved)
        void refresh(saved)
      } catch {
        message = 'Saved runtimes are unavailable; restart the watch app'
      }
      setError(message)
    }
  }

  const selectedHost = selectedAgent
    ? hosts.find((host) => host.pairing.endpoint === selectedAgent.host.pairing.endpoint)
    : undefined

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {pairings.length > 0 && !showEnroll ? (
          selectedAgent ? (
            <AgentConversation
              agent={selectedAgent.agent}
              available={Boolean(selectedHost?.dashboard && !selectedHost.error)}
              pairedDeviceId={
                selectedHost?.dashboard?.status.pairedDeviceId ??
                selectedAgent.host.pairing.pairedDeviceId
              }
              pairing={selectedAgent.host.pairing}
              runtimeId={selectedHost?.dashboard?.status.runtimeId ?? ''}
              onBack={() => setSelectedAgent(null)}
            />
          ) : (
            <>
              <RuntimeDashboard
                hosts={hosts}
                refreshing={busy}
                onForget={(host) => void forget(host)}
                onOpenAgent={(host, agent) => setSelectedAgent({ host, agent })}
                onRefresh={() => void refresh(pairings)}
              />
              <WearButton label="Add Orca host" quiet onPress={() => setShowEnroll(true)} />
            </>
          )
        ) : (
          <>
            <Text style={styles.eyebrow}>ORCA</Text>
            <Text accessibilityRole="header" style={styles.title}>
              Pair this watch
            </Text>
            <Text style={styles.description}>
              {usePairingLink
                ? 'Open a Wear pairing link on this watch, or paste it below.'
                : 'Run orca serve --wear-pairing on your computer. Enter the endpoint and 5-minute watch code shown there.'}
            </Text>
            {usePairingLink ? (
              <TextInput
                accessibilityLabel="Wear pairing link"
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                onChangeText={setPairingInput}
                placeholder="orca://pair?code=…"
                placeholderTextColor={wearColors.muted}
                style={styles.input}
                value={pairingInput}
              />
            ) : (
              <>
                <WearButton
                  label="Enter Orca endpoint"
                  onPress={() => void enterManualText('Orca endpoint', setManualEndpoint)}
                />
                <Text style={styles.description} accessibilityLabel="Orca endpoint value">
                  {manualEndpoint || 'e.g. 192.168.1.2:6768'}
                </Text>
                <WearButton
                  label="Enter watch code"
                  onPress={() => void enterManualText('Watch pairing code', setManualCode)}
                />
                {manualCode ? <Text style={styles.description}>Code entered</Text> : null}
              </>
            )}
            {error ? (
              <Text accessibilityLiveRegion="assertive" style={styles.error}>
                {error}
              </Text>
            ) : null}
            {busy ? <ActivityIndicator color={wearColors.text} /> : null}
            <WearButton
              disabled={
                busy ||
                (usePairingLink
                  ? !pairingInput.trim()
                  : !manualEndpoint.trim() || !manualCode.trim())
              }
              label="Connect"
              onPress={() => void (usePairingLink ? enroll(pairingInput) : enrollManual())}
            />
            <WearButton
              label={usePairingLink ? 'Use short code' : 'Use pairing link'}
              quiet
              onPress={() => {
                setError('')
                setUsePairingLink(!usePairingLink)
              }}
            />
            {pairings.length ? (
              <WearButton label="Back" quiet onPress={() => setShowEnroll(false)} />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: wearColors.background },
  content: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48 },
  eyebrow: { color: wearColors.muted, fontSize: 10, fontWeight: '600', letterSpacing: 1.4 },
  title: {
    marginTop: 4,
    color: wearColors.text,
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center'
  },
  description: {
    marginTop: 12,
    color: wearColors.secondary,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center'
  },
  input: {
    width: '100%',
    minHeight: 68,
    marginTop: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: wearColors.inputBorder,
    borderRadius: 14,
    color: wearColors.text,
    backgroundColor: wearColors.raised,
    fontSize: 12
  },
  error: { marginTop: 10, color: wearColors.danger, fontSize: 12, textAlign: 'center' }
})
