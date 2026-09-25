package expo.modules.orcawear

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal object WearKeyStore {
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val wrappingAlias = "orca.wear.v1.binding-wrap"

    @Synchronized fun createEnrollmentKey(attemptId: String): ByteArray {
        check(Build.VERSION.SDK_INT >= 31) { "wear_android_api_31_required" }
        val alias = enrollmentAlias(attemptId)
        check(!store.containsAlias(alias)) { "wear_enrollment_already_exists" }
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        generator.initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_AGREE_KEY)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).build())
        return generator.generateKeyPair().public.encoded
    }

    fun deriveBootstrap(attemptId: String, peerPublicKey: ByteArray, transcript: ByteArray): SecretKey {
        check(Build.VERSION.SDK_INT >= 31) { "wear_android_api_31_required" }
        require(peerPublicKey.size in 64..256)
        val peer = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(peerPublicKey)) as ECPublicKey
        val parameters = AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }
            .getParameterSpec(ECParameterSpec::class.java)
        require(peer.params.curve == parameters.curve && peer.params.generator == parameters.generator &&
            peer.params.order == parameters.order && peer.params.cofactor == parameters.cofactor)
        val privateKey = store.getKey(enrollmentAlias(attemptId), null) as? PrivateKey
            ?: error("wear_enrollment_missing")
        val agreement = KeyAgreement.getInstance("ECDH", "AndroidKeyStore")
        agreement.init(privateKey)
        agreement.doPhase(peer, true)
        val secret = agreement.generateSecret()
        return try { WearBootstrapCrypto.deriveKey(secret, transcript) } finally { secret.fill(0) }
    }

    fun deleteEnrollmentKey(attemptId: String) {
        store.deleteEntry(enrollmentAlias(attemptId))
    }

    fun deleteOrphanEnrollmentKeys() {
        val aliases = store.aliases().toList().filter { it.startsWith("orca.wear.v1.enrollment.") }
        aliases.forEach { store.deleteEntry(it) }
    }

    @Synchronized fun wrapBindingKey(bindingId: String, key: ByteArray): ByteArray {
        require(key.size == 32)
        val aad = bindingContext(bindingId)
        if (!store.containsAlias(wrappingAlias)) {
            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            generator.init(KeyGenParameterSpec.Builder(wrappingAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            generator.generateKey()
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, requireWrappingKey())
        cipher.updateAAD(aad)
        check(cipher.iv.size == 12)
        return cipher.iv + cipher.doFinal(key)
    }

    fun unwrapBindingKey(bindingId: String, wrapped: ByteArray): ByteArray {
        require(wrapped.size == 60)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, requireWrappingKey(), GCMParameterSpec(128, wrapped.copyOfRange(0, 12)))
        cipher.updateAAD(bindingContext(bindingId))
        return cipher.doFinal(wrapped, 12, wrapped.size - 12)
    }

    private fun requireWrappingKey(): SecretKey =
        store.getKey(wrappingAlias, null) as? SecretKey ?: error("wear_binding_key_missing")

    private fun bindingContext(bindingId: String): ByteArray {
        require(UUID.fromString(bindingId).toString() == bindingId)
        return "orca-wear-binding-at-rest-v1:$bindingId".toByteArray(Charsets.UTF_8)
    }

    private fun enrollmentAlias(attemptId: String): String {
        require(UUID.fromString(attemptId).toString() == attemptId)
        return "orca.wear.v1.enrollment.$attemptId"
    }
}
