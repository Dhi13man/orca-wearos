import { StyleSheet, Text, View } from 'react-native'
import type { WearDashboardHost } from '../packages/wear-companion-contract/src/dashboard'
import { WearButton } from './wear-button'
import { wearColors } from './wear-theme'

export function HostPagesView({
  status,
  hosts,
  total,
  nextCursor,
  onBack,
  onLoad,
  onSelectHost
}: {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  hosts: WearDashboardHost[]
  total: number
  nextCursor: string | null
  onBack: () => void
  onLoad: (cursor: string | null) => void
  onSelectHost: (hostId: string) => void
}) {
  return (
    <View style={styles.section}>
      <WearButton label="Back to agents" quiet onPress={onBack} />
      <Text accessibilityRole="header" style={styles.heading}>
        All machines
      </Text>
      {(status === 'unavailable' ? [] : hosts).map((host) => (
        <View key={host.hostId} style={styles.card}>
          <Text style={styles.title}>{host.displayName}</Text>
          <Text style={styles.detail}>
            {host.connectionState === 'connected'
              ? 'Connected'
              : host.connectionState === 'auth-failed'
                ? 'Authentication needed'
                : host.connectionState === 'incompatible'
                  ? 'Update needed'
                  : 'Connection unverified'}
          </Text>
          <WearButton label="Open agents" quiet onPress={() => onSelectHost(host.hostId)} />
        </View>
      ))}
      {status === 'ready' ? (
        <Text style={styles.detail}>
          Showing {hosts.length} of {total} paired machines.
        </Text>
      ) : null}
      {status === 'loading' ? <Text style={styles.detail}>Loading from phone…</Text> : null}
      {status === 'unavailable' ? (
        <Text accessibilityRole="alert" style={styles.detail}>
          Phone response unavailable. The paired-machine list may have changed.
        </Text>
      ) : null}
      {status !== 'loading' &&
      (status === 'idle' || status === 'unavailable' || (status === 'ready' && nextCursor)) ? (
        <WearButton
          label={
            status === 'idle'
              ? 'Load machines'
              : status === 'unavailable'
                ? 'Refresh machines'
                : 'More machines'
          }
          onPress={() => onLoad(status === 'ready' ? nextCursor : null)}
        />
      ) : null}
      {hosts.length > 0 && status === 'ready' ? (
        <WearButton label="Refresh machines" quiet onPress={() => onLoad(null)} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { width: '100%', alignItems: 'center', gap: 10 },
  heading: { color: wearColors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  card: {
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: wearColors.raised,
    borderWidth: 1,
    borderColor: wearColors.border
  },
  title: { color: wearColors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  detail: { color: wearColors.secondary, fontSize: 12, textAlign: 'center', marginTop: 6 }
})
