import { StyleSheet, Text, View } from 'react-native'
import type { DashboardPage } from './dashboard-pages'
import { WearButton } from './wear-button'
import { wearColors } from './wear-theme'

type Page = DashboardPage | 'Inbox'
const pages: readonly Page[] = ['Attention', 'Agents', 'Usage', 'Inbox']

export function WearPageNavigation({
  page,
  onSelect
}: {
  page: Page
  onSelect: (page: Page) => void
}) {
  const index = pages.indexOf(page)
  return (
    <View style={styles.navigation}>
      <WearButton
        accessibilityLabel="Previous page"
        compact
        label="‹"
        quiet
        onPress={() => onSelect(pages[(index + pages.length - 1) % pages.length])}
      />
      <Text accessibilityRole="header" style={styles.title}>
        {page}
      </Text>
      <WearButton
        accessibilityLabel="Next page"
        compact
        label="›"
        quiet
        onPress={() => onSelect(pages[(index + 1) % pages.length])}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  navigation: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8
  },
  title: { color: wearColors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' }
})
