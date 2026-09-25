package expo.modules.orcawear

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

internal data class EnrollmentHello(val installId: String, val publicKey: ByteArray, val nonce: ByteArray) {
    init {
        require(UUID.fromString(installId).toString() == installId)
        require(publicKey.size in 64..256 && nonce.size == 32)
    }
}

internal object WearBootstrapCrypto {
    fun transcript(phone: EnrollmentHello, watch: EnrollmentHello): ByteArray {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { output ->
            for (field in listOf(
                "orca-wear-binding-v1".toByteArray(Charsets.UTF_8),
                phone.installId.toByteArray(Charsets.UTF_8), phone.publicKey, phone.nonce,
                watch.installId.toByteArray(Charsets.UTF_8), watch.publicKey, watch.nonce
            )) {
                output.writeInt(field.size)
                output.write(field)
            }
        }
        return bytes.toByteArray()
    }

    fun fingerprint(transcript: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(transcript).take(8)
            .joinToString("") { "%02X".format(it) }.chunked(4).joinToString("-")

    fun deriveKey(sharedSecret: ByteArray, transcript: ByteArray): SecretKey {
        val salt = MessageDigest.getInstance("SHA-256").digest(transcript)
        val bytes = hkdf32(sharedSecret, salt, "orca-wear-bootstrap-aes256-v1".toByteArray(Charsets.UTF_8))
        return try { SecretKeySpec(bytes, "AES") } finally { bytes.fill(0) }
    }

    internal fun hkdf32(input: ByteArray, salt: ByteArray, info: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(salt, "HmacSHA256"))
        val extracted = mac.doFinal(input)
        return try {
            mac.init(SecretKeySpec(extracted, "HmacSHA256"))
            mac.update(info)
            mac.doFinal(byteArrayOf(1))
        } finally { extracted.fill(0) }
    }
}
