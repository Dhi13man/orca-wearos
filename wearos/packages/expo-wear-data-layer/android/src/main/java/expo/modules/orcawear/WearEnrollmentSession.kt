package expo.modules.orcawear

import android.os.SystemClock
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal enum class CompanionRole { PHONE, WATCH }
internal data class NativeBindingMaterial(val bindingId: String, val key: ByteArray)

internal class WearEnrollmentSession(
    val role: CompanionRole,
    installId: String,
    val peerNodeId: String,
    private val now: () -> Long = { SystemClock.elapsedRealtime() }
) : AutoCloseable {
    init {
        require(UUID.fromString(installId).toString() == installId)
        require(peerNodeId.isNotBlank() && peerNodeId.toByteArray(Charsets.UTF_8).size <= 256)
    }
    private val attemptId = UUID.randomUUID().toString()
    private val expiresAt = now() + 120_000
    private val localHello = EnrollmentHello(installId, WearKeyStore.createEnrollmentKey(attemptId), randomBytes(32))
    val hello: EnrollmentHello get() = localHello.copy(publicKey = localHello.publicKey.copyOf(), nonce = localHello.nonce.copyOf())
    private var peer: EnrollmentHello? = null
    private var transcript: ByteArray? = null
    private var bootstrap: SecretKey? = null
    private var fingerprint: String? = null
    private var confirmed = false
    private var peerConfirmed = false
    private var closed = false
    private var confirmation: ByteArray? = null
    private var wrappedBinding: ByteArray? = null
    private var bindingMaterial: NativeBindingMaterial? = null
    private var persisted = false
    private var persistenceAttempted = false

    @Synchronized fun receiveHello(nodeId: String, value: EnrollmentHello): String {
        checkLive(nodeId)
        val previous = peer
        if (previous != null) {
            check(previous.installId == value.installId && previous.publicKey.contentEquals(value.publicKey) &&
                previous.nonce.contentEquals(value.nonce)) { "wear_enrollment_peer_changed" }
            return requireNotNull(fingerprint)
        }
        val snapshot = value.copy(publicKey = value.publicKey.copyOf(), nonce = value.nonce.copyOf())
        val bytes = if (role == CompanionRole.PHONE) WearBootstrapCrypto.transcript(hello, snapshot)
            else WearBootstrapCrypto.transcript(snapshot, hello)
        val derived = WearKeyStore.deriveBootstrap(attemptId, snapshot.publicKey, bytes)
        checkLive(nodeId)
        peer = snapshot
        transcript = bytes
        bootstrap = derived
        fingerprint = WearBootstrapCrypto.fingerprint(bytes)
        return requireNotNull(fingerprint)
    }

    @Synchronized fun confirm(expectedFingerprint: String): ByteArray {
        checkLive(peerNodeId)
        check(fingerprint != null && fingerprint == expectedFingerprint) { "wear_enrollment_fingerprint_mismatch" }
        confirmation?.let { return it.copyOf() }
        val sealed = seal(role, 1, "confirmed".toByteArray(Charsets.UTF_8))
        confirmation = sealed
        confirmed = true
        return sealed.copyOf()
    }

    @Synchronized fun receiveConfirmation(nodeId: String, sealed: ByteArray) {
        checkLive(nodeId)
        require(sealed.size == 25)
        val message = open(otherRole(), 1, sealed)
        check(message.contentEquals("confirmed".toByteArray(Charsets.UTF_8))) { "wear_enrollment_confirmation_invalid" }
        peerConfirmed = true
    }

    @Synchronized fun createBinding(): ByteArray {
        checkLive(peerNodeId)
        check(role == CompanionRole.PHONE && confirmed && peerConfirmed) { "wear_enrollment_not_confirmed" }
        wrappedBinding?.let { return it.copyOf() }
        val material = NativeBindingMaterial(UUID.randomUUID().toString(), randomBytes(32))
        val plaintext = material.bindingId.toByteArray(Charsets.US_ASCII) + material.key
        val sealed = try { seal(CompanionRole.PHONE, 2, plaintext) } finally { plaintext.fill(0) }
        bindingMaterial = material
        wrappedBinding = sealed
        return sealed.copyOf()
    }

    @Synchronized fun receiveBinding(nodeId: String, sealed: ByteArray) {
        checkLive(nodeId)
        check(role == CompanionRole.WATCH && confirmed && peerConfirmed) { "wear_enrollment_not_confirmed" }
        require(sealed.size == 84)
        wrappedBinding?.let {
            check(it.contentEquals(sealed)) { "wear_enrollment_binding_changed" }
            return
        }
        val plaintext = open(CompanionRole.PHONE, 2, sealed)
        try {
            val bindingId = String(plaintext, 0, 36, Charsets.US_ASCII)
            require(UUID.fromString(bindingId).toString() == bindingId)
            bindingMaterial = NativeBindingMaterial(bindingId, plaintext.copyOfRange(36, 68))
            wrappedBinding = sealed.copyOf()
        } finally { plaintext.fill(0) }
    }

    @Synchronized fun persistBinding(persist: (bindingId: String, peerInstallId: String, wrappedKey: ByteArray) -> Unit) {
        checkLive(peerNodeId)
        check(confirmed && peerConfirmed) { "wear_enrollment_not_confirmed" }
        if (persisted) return
        check(!persistenceAttempted) { "wear_enrollment_persistence_unknown" }
        val material = bindingMaterial ?: error("wear_enrollment_binding_missing")
        val wrapped = WearKeyStore.wrapBindingKey(material.bindingId, material.key)
        checkLive(peerNodeId)
        persistenceAttempted = true
        try {
            persist(material.bindingId, requireNotNull(peer).installId, wrapped)
        } catch (error: Exception) {
            throw IllegalStateException("wear_enrollment_persistence_unknown", error)
        }
        persisted = true
    }

    @Synchronized override fun close() {
        if (closed) return
        closed = true
        bindingMaterial?.key?.fill(0)
        bindingMaterial = null
        bootstrap = null
        WearKeyStore.deleteEnrollmentKey(attemptId)
    }

    private fun checkLive(nodeId: String) {
        check(!closed) { "wear_enrollment_closed" }
        if (now() >= expiresAt) {
            close()
            error("wear_enrollment_expired")
        }
        check(nodeId == peerNodeId) { "wear_enrollment_wrong_node" }
    }

    private fun otherRole() = if (role == CompanionRole.PHONE) CompanionRole.WATCH else CompanionRole.PHONE

    private fun nonce(sender: CompanionRole, purpose: Int): ByteArray =
        ByteArray(12).also { it[0] = sender.ordinal.toByte(); it[1] = purpose.toByte() }

    private fun seal(sender: CompanionRole, purpose: Int, plaintext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, requireNotNull(bootstrap), GCMParameterSpec(128, nonce(sender, purpose)))
        cipher.updateAAD(requireNotNull(transcript))
        return cipher.doFinal(plaintext)
    }

    private fun open(sender: CompanionRole, purpose: Int, ciphertext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, requireNotNull(bootstrap), GCMParameterSpec(128, nonce(sender, purpose)))
        cipher.updateAAD(requireNotNull(transcript))
        return cipher.doFinal(ciphertext)
    }

    private fun randomBytes(size: Int) = ByteArray(size).also { SecureRandom().nextBytes(it) }
}
