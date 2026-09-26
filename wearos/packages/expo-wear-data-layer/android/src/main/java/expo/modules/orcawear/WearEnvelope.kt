package expo.modules.orcawear

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

internal const val WEAR_RECEIVER_CLOCK_SKEW_MS = 30_000L

internal enum class WearEnvelopeKind(val segment: String, val sender: CompanionRole?) {
    ACTION("action", CompanionRole.WATCH),
    DASHBOARD("dashboard", CompanionRole.PHONE),
    PAGE("page", CompanionRole.PHONE),
    RECEIPT("receipt", CompanionRole.PHONE),
    TOMBSTONE("tombstone", CompanionRole.PHONE),
    ACKNOWLEDGEMENT("acknowledgement", null)
}

internal data class WearEnvelopeMetadata(
    val bindingId: String,
    val kind: WearEnvelopeKind,
    val publisherEpoch: String,
    val revision: Long,
    val requestId: String,
    val expiresAt: Long
) {
    val path: String get() = "/orca/wear/v1/" + bindingId + "/" + kind.segment +
        if (kind == WearEnvelopeKind.DASHBOARD) "/$revision" else ""
}

internal data class OpenWearEnvelope(val metadata: WearEnvelopeMetadata, val plaintext: ByteArray)

internal class WearEnvelope(
    private val bindings: WearBindingStore,
    private val elapsedRealtime: () -> Long = { android.os.SystemClock.elapsedRealtime() }
) {
    fun seal(metadata: WearEnvelopeMetadata, plaintext: ByteArray, now: Long): ByteArray {
        val started = elapsedRealtime()
        validate(metadata, now)
        require(plaintext.size <= if (metadata.kind == WearEnvelopeKind.ACTION) 8192 else 32768)
        val nonce = bindings.reserveNonce(metadata.bindingId)
        val header = encodeHeader(metadata, nonce)
        require(header.size + plaintext.size + 16 <=
            if (metadata.kind == WearEnvelopeKind.ACTION) 8192 else 32768)
        return withKey(metadata.bindingId, { authorize(it, metadata.kind, it.role, false) }) { key ->
            val ciphertext = cipher(Cipher.ENCRYPT_MODE, key, nonce, header).doFinal(plaintext)
            validate(metadata, Math.addExact(now, elapsedRealtime() - started))
            header + ciphertext
        }
    }

    fun open(path: String, peerNodeId: String, wire: ByteArray, now: Long): OpenWearEnvelope {
        val started = elapsedRealtime()
        require(wire.size in 16..32768)
        val stream = ByteArrayInputStream(wire)
        val input = DataInputStream(stream)
        require(input.readUnsignedByte() == 1)
        val kind = WearEnvelopeKind.entries.getOrNull(input.readUnsignedByte())
            ?: error("wear_envelope_kind_unknown")
        val metadata = WearEnvelopeMetadata(readText(input), kind, readText(input),
            input.readLong(), readText(input), input.readLong())
        if (kind == WearEnvelopeKind.ACTION) require(wire.size <= 8192)
        validate(metadata, now, WEAR_RECEIVER_CLOCK_SKEW_MS)
        require(metadata.path == path) { "wear_envelope_wrong_path" }
        val nonce = ByteArray(12).also { input.readFully(it) }
        val headerSize = wire.size - stream.available()
        require(stream.available() >= 16)
        return withKey(metadata.bindingId, { binding ->
            check(binding.peerNodeId == peerNodeId) { "wear_binding_wrong_node" }
            val sender = if (binding.role == CompanionRole.PHONE) CompanionRole.WATCH else CompanionRole.PHONE
            authorize(binding, kind, sender, true)
            require(ByteBuffer.wrap(nonce).int == sender.ordinal + 1 && ByteBuffer.wrap(nonce).getLong(4) >= 0)
        }) { key ->
            val plaintext = cipher(Cipher.DECRYPT_MODE, key, nonce, wire.copyOfRange(0, headerSize))
                .doFinal(wire, headerSize, wire.size - headerSize)
            if (kind == WearEnvelopeKind.ACTION && plaintext.size > 8192) {
                plaintext.fill(0)
                error("wear_action_too_large")
            }
            try { validate(metadata, Math.addExact(now, elapsedRealtime() - started), WEAR_RECEIVER_CLOCK_SKEW_MS) }
            catch (error: Exception) {
                plaintext.fill(0)
                throw error
            }
            OpenWearEnvelope(metadata, plaintext)
        }
    }

    private fun <T> withKey(id: String, admit: (StoredWearBinding) -> Unit, operation: (ByteArray) -> T): T {
        val snapshot = bindings.find(id) ?: error("wear_binding_missing")
        admit(snapshot)
        // Keystore may stall; never hold the lifecycle transaction while unwrapping.
        val key = WearKeyStore.unwrapBindingKey(id, snapshot.wrappedKey)
        return try {
            bindings.withBinding(id) { current ->
                check(current.role == snapshot.role && current.peerInstallId == snapshot.peerInstallId &&
                    current.peerNodeId == snapshot.peerNodeId && current.wrappedKey.contentEquals(snapshot.wrappedKey)) {
                    "wear_binding_changed"
                }
                admit(current)
                operation(key)
            }
        } finally { key.fill(0) }
    }

    private fun authorize(binding: StoredWearBinding, kind: WearEnvelopeKind, sender: CompanionRole, incoming: Boolean) {
        check(kind.sender == null || kind.sender == sender) { "wear_envelope_wrong_direction" }
        check(when (binding.state) {
            "active" -> incoming || kind != WearEnvelopeKind.TOMBSTONE
            "pending" -> kind == WearEnvelopeKind.ACKNOWLEDGEMENT
            "revoked" -> kind == WearEnvelopeKind.TOMBSTONE || kind == WearEnvelopeKind.ACKNOWLEDGEMENT
            else -> false
        }) { "wear_binding_not_active" }
    }

    private fun validate(metadata: WearEnvelopeMetadata, now: Long, clockSkew: Long = 0) {
        require(UUID.fromString(metadata.bindingId).toString() == metadata.bindingId)
        require(UUID.fromString(metadata.publisherEpoch).toString() == metadata.publisherEpoch)
        require(metadata.revision in 0..9_007_199_254_740_991L)
        require(metadata.requestId.isNotBlank())
        require(strictUtf8(metadata.requestId).size <= 256)
        val lifetime = if (metadata.kind == WearEnvelopeKind.DASHBOARD || metadata.kind == WearEnvelopeKind.TOMBSTONE)
            86_400_000 else 120_000
        require(now in 0..9_007_199_254_740_991L)
        require(metadata.expiresAt in 0..9_007_199_254_740_991L &&
            metadata.expiresAt > now && metadata.expiresAt - now <= lifetime + clockSkew) { "wear_envelope_expired" }
    }

    private fun encodeHeader(metadata: WearEnvelopeMetadata, nonce: ByteArray): ByteArray {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use {
            it.writeByte(1)
            it.writeByte(metadata.kind.ordinal)
            writeText(it, metadata.bindingId)
            writeText(it, metadata.publisherEpoch)
            it.writeLong(metadata.revision)
            writeText(it, metadata.requestId)
            it.writeLong(metadata.expiresAt)
            it.write(nonce)
        }
        return bytes.toByteArray()
    }

    private fun writeText(output: DataOutputStream, value: String) {
        val bytes = strictUtf8(value)
        require(bytes.size <= 256)
        output.writeShort(bytes.size)
        output.write(bytes)
    }

    private fun readText(input: DataInputStream): String {
        val size = input.readUnsignedShort()
        require(size <= 256)
        val bytes = ByteArray(size).also { input.readFully(it) }
        return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    }

    private fun strictUtf8(value: String): ByteArray {
        val encoded = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(value))
        return ByteArray(encoded.remaining()).also { encoded.get(it) }
    }

    private fun cipher(mode: Int, key: ByteArray, nonce: ByteArray, aad: ByteArray): Cipher =
        Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            updateAAD(aad)
        }
}
