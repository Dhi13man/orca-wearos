import { StyleSheet, Text, View } from 'react-native'
import type { WearNotificationPage } from '../packages/wear-companion-contract/src/notification-page'
import { WearButton } from './wear-button'
import { wearColors } from './wear-theme'

export function NotificationInboxView({
  status,
  pages,
  nextCursor,
  onLoad,
  onOpenHost
}: {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  pages: WearNotificationPage[]
  nextCursor: string | null
  onLoad: (cursor: string | null) => void
  onOpenHost: (hostId: string, hostName: string) => void
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.detail}>Recent retained dispatches from reachable paired machines.</Text>
      {status === 'loading' ? <Text style={styles.detail}>Loading from phone…</Text> : null}
      {status === 'unavailable' ? (
        <Text accessibilityRole="alert" style={styles.detail}>
          Phone response unavailable or this feed expired. Refresh to check again.
        </Text>
      ) : null}
      {status !== 'unavailable' &&
        pages.map((page) => (
          <View key={page.hostId} style={styles.card}>
            <Text style={styles.host}>{page.hostName}</Text>
            <Text style={styles.detail}>Checked {new Date(page.generatedAt).toLocaleString()}</Text>
            {page.hostState !== 'ready' ? (
              <Text style={styles.detail}>
                {page.hostState === 'unsupported'
                  ? 'This machine needs a newer Orca host.'
                  : 'This machine is unavailable.'}
              </Text>
            ) : null}
            {page.hostState === 'ready' && page.items.length === 0 ? (
              <Text style={styles.detail}>
                No retained events since this watch first checked this machine.
              </Text>
            ) : null}
            {page.items.map((item) => (
              <Text key={item.eventKey} style={styles.row}>
                {item.kind === 'terminal-bell'
                  ? 'Terminal needs attention'
                  : 'Agent task completed'}
                {' · Host time '}
                {new Date(item.notificationAt).toLocaleString()}
              </Text>
            ))}
            {page.hostState === 'ready' && page.items.length > 0 ? (
              <WearButton
                accessibilityLabel={`Open agents on ${page.hostName}`}
                label="Open agents"
                quiet
                onPress={() => onOpenHost(page.hostId, page.hostName)}
              />
            ) : null}
            {page.omitted > 0 ? (
              <Text style={styles.detail}>{page.omitted} older events omitted.</Text>
            ) : null}
          </View>
        ))}
      {status !== 'loading' && (status === 'idle' || status === 'unavailable') ? (
        <WearButton label="Load recent events" onPress={() => onLoad(null)} />
      ) : null}
      {status === 'ready' && nextCursor ? (
        <WearButton label="Next machine" quiet onPress={() => onLoad(nextCursor)} />
      ) : null}
      {status === 'ready' && pages.length > 0 ? (
        <WearButton label="Refresh events" quiet onPress={() => onLoad(null)} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { width: '100%', alignItems: 'center', gap: 10 },
  card: {
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: wearColors.raised,
    borderWidth: 1,
    borderColor: wearColors.border
  },
  host: { color: wearColors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  row: { color: wearColors.text, fontSize: 12, textAlign: 'center', marginTop: 8 },
  detail: { color: wearColors.secondary, fontSize: 12, textAlign: 'center', marginTop: 6 }
})
