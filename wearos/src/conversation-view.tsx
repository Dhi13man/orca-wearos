import { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import type { WearConversationPage } from '../packages/wear-companion-contract/src/conversation-page'
import { WearButton } from './wear-button'
import { wearColors } from './wear-theme'

export function ConversationView({
  title,
  status,
  page,
  reason,
  draft,
  onDraftChange,
  onBack,
  onRetry,
  reply,
  phoneHandoff
}: {
  title: string
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  page: WearConversationPage | null
  reason: 'rejected' | 'timeout' | 'unavailable' | null
  draft: string
  onDraftChange: (text: string) => void
  onBack: () => void
  onRetry: () => void
  reply: {
    status: 'recovering' | 'idle' | 'pending' | 'accepted' | 'rejected' | 'unknown'
    reason: string | null
    recoveryTarget: string | null
    send: (text: string) => Promise<void>
    clear: (verified?: boolean) => Promise<void>
  }
  phoneHandoff: {
    status: 'recovering' | 'idle' | 'pending' | 'accepted' | 'rejected' | 'unknown'
    reason: string | null
    request: () => Promise<void>
    clear: (verified?: boolean) => Promise<void>
  }
}) {
  const [confirmRecovery, setConfirmRecovery] = useState(false)
  const [confirmHandoffRecovery, setConfirmHandoffRecovery] = useState(false)
  useEffect(() => {
    if (reply.status === 'accepted' && draft) {
      onDraftChange('')
    }
  }, [reply.status, draft, onDraftChange])
  useEffect(() => setConfirmRecovery(false), [page?.requestId, reply.status])
  useEffect(() => setConfirmHandoffRecovery(false), [page?.requestId, phoneHandoff.status])
  return (
    <View style={styles.section}>
      <WearButton label="Back to agents" quiet onPress={onBack} />
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      <WearButton
        disabled={phoneHandoff.status !== 'idle'}
        label={phoneHandoff.status === 'pending' ? 'Opening on phone…' : 'Open on phone'}
        quiet
        onPress={() => void phoneHandoff.request()}
      />
      {phoneHandoff.status === 'accepted' ? (
        <>
          <Text style={styles.detail}>Phone notification ready. Tap it to open this agent.</Text>
          <WearButton label="Done" quiet onPress={() => void phoneHandoff.clear()} />
        </>
      ) : null}
      {phoneHandoff.status === 'rejected' ? (
        <>
          <Text accessibilityRole="alert" style={styles.detail}>
            {phoneHandoff.reason === 'unsupported'
              ? 'This agent cannot open on the phone yet.'
              : 'Phone handoff was rejected. Refresh the agent and try again.'}
          </Text>
          <WearButton label="Dismiss" quiet onPress={() => void phoneHandoff.clear()} />
        </>
      ) : null}
      {phoneHandoff.status === 'unknown' ? (
        <>
          <Text accessibilityRole="alert" style={styles.detail}>
            Phone handoff is uncertain. Check phone notifications before requesting another.
          </Text>
          <WearButton
            label={confirmHandoffRecovery ? 'I checked the phone' : 'Check phone first'}
            quiet
            onPress={() => {
              if (confirmHandoffRecovery) {
                void phoneHandoff.clear(true)
                setConfirmHandoffRecovery(false)
              } else {
                setConfirmHandoffRecovery(true)
              }
            }}
          />
        </>
      ) : null}
      {status === 'loading' || status === 'idle' ? (
        <Text style={styles.detail}>Reading conversation from phone…</Text>
      ) : null}
      {status === 'unavailable' ? (
        <>
          <Text accessibilityRole="alert" style={styles.detail}>
            {reason === 'rejected'
              ? 'The selected agent changed or this conversation is unavailable.'
              : 'Phone conversation response unavailable.'}
          </Text>
          <WearButton label="Try again" onPress={onRetry} />
        </>
      ) : null}
      {status === 'ready' && page ? (
        <>
          <Text style={styles.detail}>
            Recent text preview · {page.kind === 'structured' ? 'Structured' : 'Terminal'}
          </Text>
          {page.messages.length === 0 ? (
            <Text style={styles.detail}>No recent text messages.</Text>
          ) : null}
          {page.messages.map((message) => (
            <View key={message.id} style={styles.card}>
              <Text style={styles.role}>{message.role === 'user' ? 'User' : 'Agent'}</Text>
              <Text style={styles.message}>{message.text}</Text>
              {message.truncated ? (
                <Text style={styles.detail}>Message shortened for watch.</Text>
              ) : null}
            </View>
          ))}
          {page.hasOlder ? (
            <Text style={styles.detail}>Earlier messages are outside this preview.</Text>
          ) : null}
          <WearButton label="Refresh messages" quiet onPress={onRetry} />
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="Reply to agent"
              multiline
              maxLength={2048}
              onChangeText={onDraftChange}
              placeholder="Reply to agent"
              placeholderTextColor={wearColors.secondary}
              style={styles.input}
              value={draft}
            />
            <WearButton
              disabled={!draft.trim() || reply.status !== 'idle'}
              label={reply.status === 'pending' ? 'Sending…' : 'Send reply'}
              onPress={() => {
                void reply.send(draft)
              }}
            />
            {reply.status === 'accepted' ? (
              <>
                <Text style={styles.detail}>Phone host accepted the reply.</Text>
                <WearButton label="Write another reply" quiet onPress={() => void reply.clear()} />
              </>
            ) : null}
            {reply.status === 'rejected' ? (
              <>
                <Text accessibilityRole="alert" style={styles.detail}>
                  {reply.reason === 'invalid-draft-or-target'
                    ? 'Reply is too long or this agent changed. Edit or refresh before trying again.'
                    : 'Reply rejected. Check the agent before trying again.'}
                </Text>
                <WearButton label="Edit reply" quiet onPress={() => void reply.clear()} />
              </>
            ) : null}
            {reply.status === 'unknown' ? (
              <>
                <Text accessibilityRole="alert" style={styles.detail}>
                  Delivery is uncertain. Check the last reply to{' '}
                  {reply.recoveryTarget ?? 'this agent'} on your phone before sending again.
                </Text>
                <WearButton
                  label={confirmRecovery ? 'I checked the last reply' : 'Check reply on phone'}
                  quiet
                  onPress={() => {
                    if (confirmRecovery) {
                      void reply.clear(true)
                      setConfirmRecovery(false)
                    } else {
                      setConfirmRecovery(true)
                    }
                  }}
                />
              </>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { width: '100%', alignItems: 'center', gap: 10 },
  heading: { color: wearColors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  detail: { color: wearColors.secondary, fontSize: 12, textAlign: 'center', marginTop: 6 },
  card: {
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: wearColors.raised,
    borderWidth: 1,
    borderColor: wearColors.border
  },
  role: { color: wearColors.secondary, fontSize: 12, fontWeight: '600' },
  message: { color: wearColors.text, fontSize: 14, marginTop: 6 },
  composer: { width: '100%', alignItems: 'center', gap: 8, marginTop: 8 },
  input: {
    width: '100%',
    minHeight: 64,
    color: wearColors.text,
    backgroundColor: wearColors.raised,
    borderColor: wearColors.inputBorder,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14
  }
})
