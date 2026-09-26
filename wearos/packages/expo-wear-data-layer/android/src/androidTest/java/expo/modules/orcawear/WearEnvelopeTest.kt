package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID
import javax.crypto.AEADBadTagException

class WearEnvelopeTest {
    @Test fun actionEnvelopeFitsExactEightKiBWireLimit() = withPeers { phone, watch, id ->
        val metadata = WearEnvelopeMetadata(id, WearEnvelopeKind.ACTION,
            UUID.randomUUID().toString(), 1, "request", 1000)
        val overhead = WearEnvelope(watch).seal(metadata, byteArrayOf(1), 0).size - 1
        val plaintext = ByteArray(8192 - overhead) { 2 }
        val wire = WearEnvelope(watch).seal(metadata, plaintext, 0)
        assertEquals(8192, wire.size)
        assertArrayEquals(plaintext, WearEnvelope(phone).open(metadata.path, "watch", wire, 0).plaintext)
        assertThrows(IllegalArgumentException::class.java) {
            WearEnvelope(watch).seal(metadata, ByteArray(plaintext.size + 1), 0)
        }
        assertThrows(IllegalArgumentException::class.java) {
            WearEnvelope(phone).open(metadata.path, "watch", wire + byteArrayOf(0), 0)
        }
    }

    @Test fun dashboardPlaintextBudgetFitsExactAuthenticatedWireLimit() = withPeers { phone, watch, id ->
        val metadata = WearEnvelopeMetadata(id, WearEnvelopeKind.DASHBOARD,
            UUID.randomUUID().toString(), 1, "dashboard", 1000)
        val bytes = ByteArray(32768 - 133) { 1 }
        val wire = WearEnvelope(phone).seal(metadata, bytes, 0)
        assertEquals(32768, wire.size)
        assertArrayEquals(bytes, WearEnvelope(watch).open(metadata.path, "phone", wire, 0).plaintext)
        assertThrows(IllegalArgumentException::class.java) {
            WearEnvelope(phone).seal(metadata, ByteArray(bytes.size + 1), 0)
        }
    }

    @Test fun rejectsAnEnvelopeThatExpiresWhileCryptoIsRunning() = withPeers { phone, watch, id ->
        val metadata = WearEnvelopeMetadata(id, WearEnvelopeKind.DASHBOARD, UUID.randomUUID().toString(), 0, "snapshot", 1000)
        val wire = WearEnvelope(phone).seal(metadata, byteArrayOf(1), 0)
        var reads = 0
        val slowReader = WearEnvelope(watch) { if (reads++ == 0) 0 else 1000 }
        assertThrows(IllegalArgumentException::class.java) { slowReader.open(metadata.path, "phone", wire, 0) }
        reads = 0
        val slowWriter = WearEnvelope(phone) { if (reads++ == 0) 0 else 1000 }
        assertThrows(IllegalArgumentException::class.java) { slowWriter.seal(metadata, byteArrayOf(1), 0) }
    }

    @Test fun acceptsBoundedPeerClockSkewWithoutExtendingExpiry() = withPeers { phone, watch, id ->
        val metadata = WearEnvelopeMetadata(id, WearEnvelopeKind.ACTION,
            UUID.randomUUID().toString(), 1, "request", 160_000)
        val wire = WearEnvelope(watch).seal(metadata, byteArrayOf(1), 40_000)
        assertArrayEquals(byteArrayOf(1), WearEnvelope(phone).open(metadata.path, "watch", wire, 10_000).plaintext)
        assertThrows(IllegalArgumentException::class.java) {
            WearEnvelope(phone).open(metadata.path, "watch", wire, 9_999)
        }
        assertThrows(IllegalArgumentException::class.java) {
            WearEnvelope(phone).open(metadata.path, "watch", wire, 160_000)
        }
        assertThrows(IllegalArgumentException::class.java) {
            WearEnvelope(watch).seal(metadata, byteArrayOf(1), 10_000)
        }
    }

    @Test fun pendingBindingAcknowledgementAcceptsPeerClockSkew() {
        withWearTestDatabase { phoneContext -> withWearTestDatabase { watchContext ->
            WearBindingStore(phoneContext).use { phone -> WearBindingStore(watchContext).use { watch ->
                val id = UUID.randomUUID().toString()
                val wrapped = WearKeyStore.wrapBindingKey(id, ByteArray(32) { it.toByte() })
                phone.insertPending(id, CompanionRole.PHONE, watch.installId(), "watch", wrapped)
                watch.insertPending(id, CompanionRole.WATCH, phone.installId(), "phone", wrapped)
                val metadata = WearEnvelopeMetadata(id, WearEnvelopeKind.ACKNOWLEDGEMENT,
                    UUID.randomUUID().toString(), 0, "enrollment", 160_000)
                val wire = WearEnvelope(watch).seal(metadata, "bound".toByteArray(), 40_000)
                assertArrayEquals("bound".toByteArray(),
                    WearEnvelope(phone).open(metadata.path, "watch", wire, 10_000).plaintext)
            } }
        } }
    }

    @Test fun authenticatesMetadataPathDirectionNodeCiphertextAndExpiry() = withPeers { phone, watch, id ->
        val phoneWire = WearEnvelope(phone)
        val watchWire = WearEnvelope(watch)
        val metadata = WearEnvelopeMetadata(id, WearEnvelopeKind.DASHBOARD, UUID.randomUUID().toString(), 7, "snapshot", 1000)
        val bytes = "dashboard".toByteArray()
        val wire = phoneWire.seal(metadata, bytes, 0)
        val opened = watchWire.open(metadata.path, "phone", wire, 0)
        assertEquals(metadata, opened.metadata)
        assertArrayEquals(bytes, opened.plaintext)
        assertFalse(wire.contentEquals(phoneWire.seal(metadata, bytes, 0)))
        assertThrows(IllegalArgumentException::class.java) { watchWire.open(metadata.path + "x", "phone", wire, 0) }
        assertThrows(IllegalStateException::class.java) { watchWire.open(metadata.path, "other-phone", wire, 0) }
        assertThrows(IllegalStateException::class.java) { phoneWire.open(metadata.path, "watch", wire, 0) }
        assertThrows(IllegalArgumentException::class.java) { watchWire.open(metadata.path, "phone", wire, 1000) }
        val tampered = wire.copyOf().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
        assertThrows(AEADBadTagException::class.java) { watchWire.open(metadata.path, "phone", tampered, 0) }
        val changedEpoch = wire.copyOf().also { it[42] = if (it[42] == 'a'.code.toByte()) 'b'.code.toByte() else 'a'.code.toByte() }
        assertThrows(AEADBadTagException::class.java) { watchWire.open(metadata.path, "phone", changedEpoch, 0) }
        assertThrows(IllegalArgumentException::class.java) { phoneWire.seal(metadata, ByteArray(32768), 0) }
        assertThrows(java.io.EOFException::class.java) { watchWire.open(metadata.path, "phone", wire.copyOf(20), 0) }
    }

    @Test fun fencesPendingAndRevokedBindingsButAllowsAuthenticatedRemoval() = withPeers { phone, watch, id ->
        val phoneWire = WearEnvelope(phone)
        val watchWire = WearEnvelope(watch)
        val action = WearEnvelopeMetadata(id, WearEnvelopeKind.ACTION, UUID.randomUUID().toString(), 0, "request", 1000)
        val wire = watchWire.seal(action, "{}".toByteArray(), 0)
        assertArrayEquals("{}".toByteArray(), phoneWire.open(action.path, "watch", wire, 0).plaintext)
        phone.revoke(id, 0)
        assertThrows(IllegalStateException::class.java) { phoneWire.open(action.path, "watch", wire, 0) }
        val removal = action.copy(kind = WearEnvelopeKind.TOMBSTONE)
        val tombstone = phoneWire.seal(removal, "{}".toByteArray(), 0)
        assertEquals(removal, watchWire.open(removal.path, "phone", tombstone, 0).metadata)
        watch.revoke(id, 0)
        val ack = action.copy(kind = WearEnvelopeKind.ACKNOWLEDGEMENT)
        assertEquals(ack, phoneWire.open(ack.path, "watch", watchWire.seal(ack, "{}".toByteArray(), 0), 0).metadata)
        assertThrows(IllegalStateException::class.java) { watchWire.seal(action, "{}".toByteArray(), 0) }
    }

    private fun withPeers(test: (WearBindingStore, WearBindingStore, String) -> Unit) {
        withWearTestDatabase { phoneContext -> withWearTestDatabase { watchContext ->
            WearBindingStore(phoneContext).use { phone -> WearBindingStore(watchContext).use { watch ->
                val id = UUID.randomUUID().toString()
                val wrapped = WearKeyStore.wrapBindingKey(id, ByteArray(32) { it.toByte() })
                phone.insertPending(id, CompanionRole.PHONE, watch.installId(), "watch", wrapped)
                watch.insertPending(id, CompanionRole.WATCH, phone.installId(), "phone", wrapped)
                val metadata = WearEnvelopeMetadata(id, WearEnvelopeKind.ACTION, UUID.randomUUID().toString(), 0, "request", 1000)
                assertThrows(IllegalStateException::class.java) { WearEnvelope(watch).seal(metadata, byteArrayOf(), 0) }
                phone.activate(id, "watch")
                watch.activate(id, "phone")
                test(phone, watch, id)
            } }
        } }
    }
}
