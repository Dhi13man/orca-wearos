package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class WearEnrollmentSessionTest {
    @Test fun requiresBothConfirmationsAndPersistsTheSameBindingWithoutExportingItsKey() {
        WearEnrollmentSession(CompanionRole.PHONE, UUID.randomUUID().toString(), "watch").use { phone ->
            WearEnrollmentSession(CompanionRole.WATCH, UUID.randomUUID().toString(), "phone").use { watch ->
                val code = phone.receiveHello("watch", watch.hello)
                assertEquals(code, watch.receiveHello("phone", phone.hello))
                assertThrows(IllegalStateException::class.java) { phone.createBinding() }
                assertThrows(IllegalStateException::class.java) { phone.confirm("wrong-code") }
                val confirmation = phone.confirm(code)
                assertArrayEquals(confirmation, phone.confirm(code))
                assertThrows(javax.crypto.AEADBadTagException::class.java) {
                    phone.receiveConfirmation("watch", confirmation)
                }
                assertThrows(IllegalStateException::class.java) { phone.createBinding() }
                watch.receiveConfirmation("phone", confirmation)
                phone.receiveConfirmation("watch", watch.confirm(code))
                val binding = phone.createBinding()
                assertArrayEquals(binding, phone.createBinding())
                watch.receiveBinding("phone", binding)
                watch.receiveBinding("phone", binding)
                val stored = mutableListOf<Pair<String, ByteArray>>()
                val persist: (String, String, ByteArray) -> Unit = { id, _, wrapped ->
                    stored.add(id to WearKeyStore.unwrapBindingKey(id, wrapped))
                }
                phone.persistBinding(persist)
                phone.persistBinding(persist)
                watch.persistBinding(persist)
                assertEquals(2, stored.size)
                assertEquals(stored[0].first, stored[1].first)
                assertArrayEquals(stored[0].second, stored[1].second)
                stored.forEach { it.second.fill(0) }
            }
        }
    }

    @Test fun neverRetriesAnAmbiguousPersistenceCallback() {
        WearEnrollmentSession(CompanionRole.PHONE, UUID.randomUUID().toString(), "watch").use { phone ->
            WearEnrollmentSession(CompanionRole.WATCH, UUID.randomUUID().toString(), "phone").use { watch ->
                val code = phone.receiveHello("watch", watch.hello)
                watch.receiveHello("phone", phone.hello)
                watch.receiveConfirmation("phone", phone.confirm(code))
                phone.receiveConfirmation("watch", watch.confirm(code))
                phone.createBinding()
                var writes = 0
                val first = assertThrows(IllegalStateException::class.java) {
                    phone.persistBinding { _, _, _ -> writes++; error("failure after commit") }
                }
                assertEquals("wear_enrollment_persistence_unknown", first.message)
                assertThrows(IllegalStateException::class.java) {
                    phone.persistBinding { _, _, _ -> writes++ }
                }
                assertEquals(1, writes)
            }
        }
    }

    @Test fun fencesNodePeerChangesExpiryAndCancellation() {
        var time = 0L
        WearEnrollmentSession(CompanionRole.PHONE, UUID.randomUUID().toString(), "watch") { time }.use { phone ->
            WearEnrollmentSession(CompanionRole.WATCH, UUID.randomUUID().toString(), "phone").use { watch ->
                assertThrows(IllegalStateException::class.java) { phone.receiveHello("other", watch.hello) }
                val code = phone.receiveHello("watch", watch.hello)
                assertEquals(code, phone.receiveHello("watch", watch.hello))
                assertThrows(IllegalStateException::class.java) {
                    phone.receiveHello("watch", watch.hello.copy(nonce = ByteArray(32)))
                }
                time = 120_000
                assertThrows(IllegalStateException::class.java) { phone.confirm(code) }
                assertThrows(IllegalStateException::class.java) { phone.receiveHello("watch", watch.hello) }
            }
        }
        val cancelled = WearEnrollmentSession(CompanionRole.WATCH, UUID.randomUUID().toString(), "phone")
        cancelled.close()
        assertThrows(IllegalStateException::class.java) { cancelled.confirm("code") }
    }
}
