package expo.modules.orcawear

import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

internal class WearEnrollmentController(
    private val role: CompanionRole,
    private val bindings: WearBindingStore,
    private val send: (String, String, ByteArray) -> Unit,
    private val status: (Map<String, String>) -> Unit,
    private val elapsed: () -> Long = { android.os.SystemClock.elapsedRealtime() },
    private val wallTime: () -> Long = { System.currentTimeMillis() }
) {
    private val generation = AtomicLong()
    private var sessionEpoch = 0L
    private var selectedNode: String? = null
    private val publisherEpoch = UUID.randomUUID().toString()
    private var session: WearEnrollmentSession? = null
    private var fingerprint: String? = null
    private var localConfirmed = false
    private var peerConfirmed = false
    private var bindingId: String? = null
    private var bindingPacket: ByteArray? = null
    private var confirmationPacket: ByteArray? = null

    fun generation(): Long = generation.get()

    fun begin(peerNodeId: String, ticket: WearWorkTicket, expectedGeneration: Long = generation() ) {
        val epoch = synchronized(generation) {
            check(generation.get() == expectedGeneration) { "wear_enrollment_cancelled" }
            generation.incrementAndGet().also {
                sessionEpoch = it
                selectedNode = peerNodeId
            }
        }
        session?.close()
        session = null
        fingerprint = null
        localConfirmed = false
        peerConfirmed = false
        bindingId = null
        bindingPacket = null
        confirmationPacket = null
        check(bindings.pendingForPeer(peerNodeId, wallTime()).isEmpty()) { "wear_enrollment_pending_recovery" }
        val created = WearEnrollmentSession(role, bindings.installId(), peerNodeId) {
            if (generation.get() == epoch) elapsed() else Long.MAX_VALUE
        }
        try {
            ticket.checkLive()
            check(generation.get() == epoch) { "wear_enrollment_cancelled" }
            session = created
            transmit(EnrollmentPacket.Hello(role, created.hello), created, ticket)
            effect(ticket) { status(mapOf("phase" to "waitingForPeer", "nodeId" to peerNodeId)) }
        } catch (error: Exception) {
            created.close()
            session = null
            throw error
        }
    }

    fun cancel(peerNodeId: String): Long = synchronized(generation) {
            check(selectedNode == null || selectedNode == peerNodeId) { "wear_enrollment_wrong_node" }
            val cancelledGeneration = generation.incrementAndGet()
            bindings.discardPendingForPeer(peerNodeId)
            status(mapOf("phase" to "cancelled"))
            cancelledGeneration
    }

    fun closeCancelled(cancelledGeneration: Long = Long.MAX_VALUE) {
        if (sessionEpoch < cancelledGeneration) {
            session?.close()
            session = null
        }
    }

    fun confirm(expectedFingerprint: String, ticket: WearWorkTicket) {
        val current = requireNotNull(session) { "wear_enrollment_missing" }
        val proof = current.confirm(expectedFingerprint)
        ticket.checkLive()
        localConfirmed = true
        confirmationPacket = proof
        transmit(EnrollmentPacket.Confirmation(role, proof), current, ticket)
        completePhoneConfirmation(current, ticket)
    }

    fun receive(peerNodeId: String, bytes: ByteArray, ticket: WearWorkTicket) {
        val current = requireNotNull(session) { "wear_enrollment_missing" }
        check(current.peerNodeId == peerNodeId) { "wear_enrollment_wrong_node" }
        val packet = WearEnrollmentWire.decode(bytes)
        check(packet.role != role) { "wear_enrollment_wrong_role" }
        when (packet) {
            is EnrollmentPacket.Hello -> {
                val first = fingerprint == null
                val code = current.receiveHello(peerNodeId, packet.hello)
                ticket.checkLive()
                fingerprint = code
                if (first) {
                    transmit(EnrollmentPacket.Hello(role, current.hello), current, ticket)
                    effect(ticket) {
                        status(mapOf("phase" to "confirmFingerprint", "nodeId" to peerNodeId, "fingerprint" to code))
                    }
                }
            }
            is EnrollmentPacket.Confirmation -> {
                current.receiveConfirmation(peerNodeId, packet.ciphertext)
                ticket.checkLive()
                peerConfirmed = true
                completePhoneConfirmation(current, ticket)
            }
            is EnrollmentPacket.Binding -> {
                current.receiveBinding(peerNodeId, packet.ciphertext)
                persist(current, ticket)
                sendAcknowledgement(requireNotNull(bindingId), peerNodeId, ticket)
            }
        }
    }

    fun receiveAcknowledgement(peerNodeId: String, path: String, bytes: ByteArray, ticket: WearWorkTicket) {
        val opened = WearEnvelope(bindings).open(path, peerNodeId, bytes, wallTime())
        try {
            require(opened.metadata.kind == WearEnvelopeKind.ACKNOWLEDGEMENT &&
                opened.plaintext.contentEquals("bound".toByteArray(Charsets.US_ASCII)))
            effect(ticket) {
                check(session == null || bindingId == opened.metadata.bindingId) { "wear_enrollment_binding_changed" }
                bindings.activate(opened.metadata.bindingId, peerNodeId, wallTime())
            }
            if (role == CompanionRole.PHONE) sendAcknowledgement(opened.metadata.bindingId, peerNodeId, ticket)
            val finished = session
            effect(ticket) {
                session = null
                status(mapOf("phase" to "bound", "nodeId" to peerNodeId, "bindingId" to opened.metadata.bindingId))
            }
            finished?.close()
        } finally { opened.plaintext.fill(0) }
    }

    fun retry(ticket: WearWorkTicket) {
        val current = requireNotNull(session) { "wear_enrollment_missing" }
        transmit(EnrollmentPacket.Hello(role, current.hello), current, ticket)
        confirmationPacket?.let { transmit(EnrollmentPacket.Confirmation(role, it), current, ticket) }
        bindingPacket?.let { transmit(EnrollmentPacket.Binding(it), current, ticket) }
        if (role == CompanionRole.WATCH) bindingId?.let { sendAcknowledgement(it, current.peerNodeId, ticket) }
    }

    fun recoverPending(peerNodeId: String, ticket: WearWorkTicket) {
        val pending = bindings.pendingForPeer(peerNodeId, wallTime())
        if (pending.isNotEmpty()) effect(ticket) {
            status(mapOf("phase" to "pendingRecovery", "nodeId" to peerNodeId))
        }
        if (role == CompanionRole.WATCH) {
            pending.forEach { sendAcknowledgement(it.id, peerNodeId, ticket) }
        }
    }

    private fun completePhoneConfirmation(current: WearEnrollmentSession, ticket: WearWorkTicket) {
        if (role != CompanionRole.PHONE || !localConfirmed || !peerConfirmed) return
        val packet = current.createBinding()
        persist(current, ticket)
        bindingPacket = packet
        transmit(EnrollmentPacket.Binding(packet), current, ticket)
    }

    private fun persist(current: WearEnrollmentSession, ticket: WearWorkTicket) {
        current.persistBinding { id, peerInstallId, wrapped ->
            effect(ticket) {
                bindingId = id
                bindings.insertPending(id, role, peerInstallId, current.peerNodeId, wrapped, wallTime())
            }
        }
    }

    private fun sendAcknowledgement(id: String, nodeId: String, ticket: WearWorkTicket) {
        val metadata = WearEnvelopeMetadata(id, WearEnvelopeKind.ACKNOWLEDGEMENT,
            publisherEpoch, 0, "enrollment", wallTime() + 120_000)
        val bytes = WearEnvelope(bindings).seal(metadata, "bound".toByteArray(Charsets.US_ASCII), wallTime())
        effect(ticket) { send(nodeId, metadata.path, bytes) }
    }

    private fun transmit(packet: EnrollmentPacket, current: WearEnrollmentSession, ticket: WearWorkTicket) {
        effect(ticket) { send(current.peerNodeId, WearEnrollmentWire.PATH, WearEnrollmentWire.encode(packet)) }
    }

    private fun effect(ticket: WearWorkTicket, operation: () -> Unit) {
        synchronized(generation) {
            check(generation.get() == sessionEpoch) { "wear_enrollment_cancelled" }
            ticket.effect(operation)
        }
    }
}
