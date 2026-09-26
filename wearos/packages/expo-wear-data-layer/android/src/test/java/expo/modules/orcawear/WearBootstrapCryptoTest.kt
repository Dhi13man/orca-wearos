package expo.modules.orcawear

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class WearBootstrapCryptoTest {
    private val phone = EnrollmentHello("00000000-0000-4000-8000-000000000001", ByteArray(91) { 1 }, ByteArray(32) { 2 })
    private val watch = EnrollmentHello("00000000-0000-4000-8000-000000000002", ByteArray(91) { 3 }, ByteArray(32) { 4 })

    @Test fun matchesRfc5869CaseOneFirst32Bytes() {
        // RFC 5869 Appendix A.1, truncated to the fixed AES-256 output length.
        val derived = WearBootstrapCrypto.hkdf32(ByteArray(22) { 0x0b }, ByteArray(13) { it.toByte() }, ByteArray(10) { (0xf0 + it).toByte() })
        val expected = "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf"
        assertArrayEquals(expected.chunked(2).map { it.toInt(16).toByte() }.toByteArray(), derived)
    }

    @Test fun bindsRoleInstallKeyAndNonceIntoFingerprintAndBootstrapKey() {
        val baseline = WearBootstrapCrypto.transcript(phone, watch)
        val secret = ByteArray(32) { 7 }
        for (changed in listOf(
            WearBootstrapCrypto.transcript(watch, phone),
            WearBootstrapCrypto.transcript(phone.copy(installId = watch.installId), watch),
            WearBootstrapCrypto.transcript(phone.copy(publicKey = ByteArray(91) { 8 }), watch),
            WearBootstrapCrypto.transcript(phone.copy(nonce = ByteArray(32) { 9 }), watch)
        )) {
            assertNotEquals(WearBootstrapCrypto.fingerprint(baseline), WearBootstrapCrypto.fingerprint(changed))
            assertNotEquals(WearBootstrapCrypto.deriveKey(secret, baseline), WearBootstrapCrypto.deriveKey(secret, changed))
        }
        assertArrayEquals(WearBootstrapCrypto.deriveKey(secret, baseline).encoded, WearBootstrapCrypto.deriveKey(secret, baseline).encoded)
    }
}
