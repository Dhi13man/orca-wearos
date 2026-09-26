package expo.modules.orcawear

import androidx.test.platform.app.InstrumentationRegistry
import dev.orca.wear.contract.ActionAdmission
import dev.orca.wear.contract.WearActionDecoder
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.security.KeyStore
import java.util.UUID
import javax.crypto.AEADBadTagException

class WearNativeAcceptanceTest {
    @Test fun repeatedEnrollmentReleasesBackendOperations() {
        val phoneId = UUID.randomUUID().toString()
        val watchId = UUID.randomUUID().toString()
        try {
            val phoneKey = WearKeyStore.createEnrollmentKey(phoneId)
            val watchKey = WearKeyStore.createEnrollmentKey(watchId)
            val transcript = WearBootstrapCrypto.transcript(
                EnrollmentHello(phoneId, phoneKey, ByteArray(32) { 3 }),
                EnrollmentHello(watchId, watchKey, ByteArray(32) { 4 }))
            repeat(20) {
                val phone = WearKeyStore.deriveBootstrap(phoneId, watchKey, transcript)
                val watch = WearKeyStore.deriveBootstrap(watchId, phoneKey, transcript)
                assertArrayEquals(phone.encoded, watch.encoded)
            }
        } finally {
            WearKeyStore.deleteEnrollmentKey(phoneId)
            WearKeyStore.deleteEnrollmentKey(watchId)
        }
    }

    @Test fun androidJsonParserMatchesAllSharedWireVectors() {
        val context = InstrumentationRegistry.getInstrumentation().context
        val vectors = JSONArray(context.assets.open("action-vectors.json").bufferedReader().use { it.readText() })
        for (index in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(index)
            val wire = vector.getString("serialized")
            val result = WearActionDecoder.decode(wire.toByteArray(Charsets.UTF_8), vector.getLong("now"))
            assertEquals(vector.getString("name"), vector.getBoolean("accepted"), result is ActionAdmission.Accepted)
            if (result is ActionAdmission.Accepted) assertEquals(wire, result.canonical)
        }
        val attack = "/* \" */" + "{a:".repeat(1000) + "0" + "}".repeat(1000) + "/* \" */"
        assertTrue(WearActionDecoder.decode(attack, 0) is ActionAdmission.Rejected)
    }

    @Test fun androidKeystoreEnrollmentAgreesWithoutExportablePrivateKeys() {
        val phoneId = UUID.randomUUID().toString()
        val watchId = UUID.randomUUID().toString()
        try {
            val phoneKey = WearKeyStore.createEnrollmentKey(phoneId)
            val watchKey = WearKeyStore.createEnrollmentKey(watchId)
            val transcript = WearBootstrapCrypto.transcript(
                EnrollmentHello(phoneId, phoneKey, ByteArray(32) { 1 }),
                EnrollmentHello(watchId, watchKey, ByteArray(32) { 2 }))
            val phone = WearKeyStore.deriveBootstrap(phoneId, watchKey, transcript)
            val watch = WearKeyStore.deriveBootstrap(watchId, phoneKey, transcript)
            assertArrayEquals(phone.encoded, watch.encoded)
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            assertNull(store.getKey("orca.wear.v1.enrollment.$phoneId", null).encoded)
            assertNull(store.getKey("orca.wear.v1.enrollment.$watchId", null).encoded)
        } finally {
            WearKeyStore.deleteEnrollmentKey(phoneId)
            WearKeyStore.deleteEnrollmentKey(watchId)
        }
    }

    @Test fun bindingKeyWrappingRejectsAnotherBindingAndTampering() {
        val binding = UUID.randomUUID().toString()
        val secret = ByteArray(32) { it.toByte() }
        val wrapped = WearKeyStore.wrapBindingKey(binding, secret)
        assertArrayEquals(secret, WearKeyStore.unwrapBindingKey(binding, wrapped))
        assertThrows(AEADBadTagException::class.java) {
            WearKeyStore.unwrapBindingKey(UUID.randomUUID().toString(), wrapped)
        }
        val changed = wrapped.copyOf().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
        assertThrows(AEADBadTagException::class.java) { WearKeyStore.unwrapBindingKey(binding, changed) }
        assertFalse(wrapped.contentEquals(WearKeyStore.wrapBindingKey(binding, secret)))
    }
}
