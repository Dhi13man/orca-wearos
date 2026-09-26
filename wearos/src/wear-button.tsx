import { Pressable, StyleSheet, Text } from 'react-native'
import { wearColors } from './wear-theme'

export function WearButton({
  accessibilityLabel,
  compact = false,
  disabled = false,
  label,
  quiet = false,
  onPress
}: {
  accessibilityLabel?: string
  compact?: boolean
  disabled?: boolean
  label: string
  quiet?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        quiet && styles.quietButton,
        compact && styles.compactButton,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text style={[styles.text, quiet && styles.quietText, compact && styles.compactText]}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    paddingHorizontal: 20,
    borderRadius: 24,
    backgroundColor: wearColors.primary
  },
  quietButton: { marginTop: 8, backgroundColor: wearColors.raised },
  compactButton: {
    width: 48,
    minWidth: 48,
    alignSelf: 'flex-start',
    marginTop: 0,
    paddingHorizontal: 0
  },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.5 },
  text: { color: wearColors.primaryText, fontSize: 14, fontWeight: '600' },
  quietText: { color: wearColors.text },
  compactText: { fontSize: 24, lineHeight: 28 }
})
