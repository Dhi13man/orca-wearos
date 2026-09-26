import { useCallback, useEffect, useRef, useState } from 'react'
import { randomUUID } from 'expo-crypto'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  fetchAgentConversation,
  fetchCommandReceipt,
  sendAgentMessage,
  type AgentSendOutcome
} from '../orca/direct-orca-client'
import type { PairingOffer } from '../orca/pairing'
import {
  canReadAgentConversation,
  type WearAgentSession,
  type WearConversationMessage
} from '../orca/runtime-dashboard'
import {
  absentReplyCanExpire,
  clearPendingReply,
  loadPendingReply,
  savePendingReply,
  type PendingWearReply
} from '../orca/reply-receipt-store'
import { WearButton } from '../wear-button'
import { wearColors } from '../wear-theme'

export function AgentConversation({
  agent,
  available,
  pairedDeviceId,
  runtimeId,
  pairing,
  onBack
}: {
  agent: WearAgentSession
  available: boolean
  pairedDeviceId: string | undefined
  runtimeId: string
  pairing: PairingOffer
  onBack: () => void
}) {
  const [messages, setMessages] = useState<WearConversationMessage[]>([])
  const [messageInput, setMessageInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<AgentSendOutcome | null>(null)
  const [pending, setPending] = useState<PendingWearReply | null | undefined>(undefined)
  const commandLock = useRef(false)
  const canRead = canReadAgentConversation(agent, available)
  const canSend = Boolean(
    agent.sessionId &&
    available &&
    pairedDeviceId &&
    runtimeId &&
    agent.execution === 'local' &&
    pending === null
  )

  useEffect(() => {
    if (!pairedDeviceId) {
      setPending(null)
      return
    }
    void loadPendingReply(pairedDeviceId)
      .then(setPending)
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Saved reply is unavailable')
      })
  }, [pairedDeviceId])

  const checkReceipt = useCallback(async () => {
    if (!pairedDeviceId || !pending || commandLock.current) {
      return
    }
    commandLock.current = true
    setSending(true)
    try {
      const receipt = await fetchCommandReceipt(pairing, pairedDeviceId, pending.requestId)
      if (receipt === 'accepted' || receipt === 'rejected') {
        await clearPendingReply(pairedDeviceId)
        setPending(null)
        setOutcome(receipt)
      } else if (receipt === null && absentReplyCanExpire(pending, Date.now())) {
        await clearPendingReply(pairedDeviceId)
        setPending(null)
        setOutcome('rejected')
      } else {
        setOutcome('unknown')
      }
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not check reply')
    } finally {
      commandLock.current = false
      setSending(false)
    }
  }, [pairedDeviceId, pairing, pending])

  const refresh = useCallback(async () => {
    if (!canRead) {
      return
    }
    setLoading(true)
    setError('')
    try {
      setMessages(await fetchAgentConversation(pairing, agent))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Conversation is unavailable')
    } finally {
      setLoading(false)
    }
  }, [agent, canRead, pairing])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const send = useCallback(async () => {
    if (!canSend || !pairedDeviceId || !messageInput.trim() || commandLock.current) {
      return
    }
    commandLock.current = true
    setSending(true)
    setError('')
    setOutcome(null)
    const reply: PendingWearReply = {
      bindingId: pairedDeviceId,
      runtimeId,
      requestId: randomUUID(),
      agentId: agent.id,
      expiresAt: Date.now() + 120_000
    }
    try {
      await savePendingReply(reply)
      setPending(reply)
      const result = await sendAgentMessage(
        pairing,
        agent,
        pairedDeviceId,
        runtimeId,
        reply.requestId,
        reply.expiresAt,
        messageInput
      )
      setOutcome(result)
      if (result === 'accepted' || result === 'rejected') {
        await clearPendingReply(pairedDeviceId)
        setPending(null)
      }
      if (result === 'accepted') {
        setMessageInput('')
        void refresh()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save reply receipt')
    } finally {
      commandLock.current = false
      setSending(false)
    }
  }, [agent, canSend, messageInput, pairedDeviceId, pairing, refresh, runtimeId])

  return (
    <>
      <View style={styles.header}>
        <WearButton accessibilityLabel="Back to agents" compact label="←" quiet onPress={onBack} />
        <View style={styles.headerCopy}>
          <Text
            accessibilityLabel={`${agent.agent} conversation in ${agent.worktreeLabel}`}
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.title}
          >
            {agent.agent}
          </Text>
          <Text numberOfLines={1} style={styles.meta}>
            {agent.worktreeLabel}
          </Text>
        </View>
      </View>
      {!available ? (
        <Text style={styles.notice}>Host unavailable. Chat paused.</Text>
      ) : agent.execution !== 'local' ? (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {agent.execution === 'remote'
            ? 'Remote chat unavailable.'
            : 'Session unverified. Chat paused.'}
        </Text>
      ) : !agent.sessionId ? (
        <Text style={styles.notice}>Waiting for this agent to publish a conversation.</Text>
      ) : null}
      {loading ? (
        <View accessibilityLabel="Loading conversation" accessibilityRole="progressbar">
          <ActivityIndicator color={wearColors.text} />
        </View>
      ) : null}
      {error ? (
        <Text accessibilityLiveRegion="assertive" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {canRead && !loading && messages.length === 0 && !error ? (
        <Text style={styles.notice}>No recent messages</Text>
      ) : null}
      {messages.slice(-6).map((message) => (
        <View key={message.id} style={styles.message}>
          <Text style={styles.role}>
            {message.role === 'user'
              ? 'You'
              : message.role === 'assistant'
                ? agent.agent
                : message.role}
          </Text>
          <Text style={styles.messageText}>{message.text}</Text>
        </View>
      ))}
      {canRead ? (
        <WearButton
          disabled={loading}
          label="Refresh conversation"
          quiet
          onPress={() => void refresh()}
        />
      ) : null}
      {canSend ? (
        <>
          <TextInput
            accessibilityLabel="Message agent"
            autoCapitalize="sentences"
            maxLength={500}
            multiline
            onChangeText={setMessageInput}
            placeholder="Type or dictate a message"
            placeholderTextColor={wearColors.muted}
            style={styles.input}
            value={messageInput}
          />
          <WearButton
            disabled={sending || !messageInput.trim()}
            label={sending ? 'Sending…' : 'Send message'}
            onPress={() => void send()}
          />
        </>
      ) : null}
      {pending ? (
        <>
          <Text style={styles.notice}>
            {pending.agentId === agent.id
              ? 'A reply is awaiting a durable receipt. Sending again is disabled.'
              : 'Another reply on this host awaits a durable receipt.'}
          </Text>
          <WearButton
            disabled={sending}
            label="Check delivery"
            quiet
            onPress={() => void checkReceipt()}
          />
        </>
      ) : null}
      {outcome ? <SendOutcome outcome={outcome} /> : null}
    </>
  )
}

function SendOutcome({ outcome }: { outcome: AgentSendOutcome }) {
  const label =
    outcome === 'accepted'
      ? 'Message accepted by the runtime.'
      : outcome === 'unknown'
        ? 'Delivery unknown. Do not resend automatically.'
        : 'Message rejected; nothing was submitted.'
  return (
    <Text
      accessibilityLiveRegion="assertive"
      style={[styles.notice, outcome === 'rejected' && styles.error]}
    >
      {label}
    </Text>
  )
}

const styles = StyleSheet.create({
  header: { width: '100%', flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  headerCopy: { flex: 1, marginLeft: 10 },
  title: {
    color: wearColors.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'left'
  },
  meta: { marginTop: 4, color: wearColors.muted, fontSize: 10, lineHeight: 13 },
  notice: {
    width: '100%',
    marginTop: 12,
    color: wearColors.secondary,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'left'
  },
  error: { color: wearColors.danger },
  message: {
    width: '100%',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: wearColors.raised
  },
  role: { color: wearColors.muted, fontSize: 10, textTransform: 'uppercase' },
  messageText: { marginTop: 4, color: wearColors.text, fontSize: 12, lineHeight: 17 },
  input: {
    width: '100%',
    minHeight: 56,
    maxHeight: 108,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: wearColors.inputBorder,
    borderRadius: 14,
    backgroundColor: wearColors.raised,
    color: wearColors.text,
    fontSize: 12
  }
})
