package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.util.ArrayDeque

class WearEnrollmentControllerTest {
    private data class Message(val from: CompanionRole, val path: String, val bytes: ByteArray)

    @Test fun confirmsBothScreensAndRecoversLostAcknowledgementAfterWatchRestart() = lostAcknowledgement(false)

    @Test fun cancellationSurvivesRestartAndRejectsThePendingAcknowledgement() = lostAcknowledgement(true)

    private fun lostAcknowledgement(cancelPhone: Boolean) {
        withWearTestDatabase { phoneContext -> withWearTestDatabase { watchContext ->
            WearBindingStore(phoneContext).use { phoneStore -> WearBindingStore(watchContext).use { watchStore ->
                val messages = ArrayDeque<Message>()
                val phoneStatus = mutableListOf<Map<String, String>>()
                val watchStatus = mutableListOf<Map<String, String>>()
                fun makePhone() = WearEnrollmentController(CompanionRole.PHONE, phoneStore,
                    { node, path, bytes -> assertEquals("watch", node); messages.add(Message(CompanionRole.PHONE, path, bytes)) },
                    { phoneStatus.add(it) })
                var phone = makePhone()
                fun makeWatch() = WearEnrollmentController(CompanionRole.WATCH, watchStore,
                    { node, path, bytes -> assertEquals("phone", node); messages.add(Message(CompanionRole.WATCH, path, bytes)) },
                    { watchStatus.add(it) })
                var watch = makeWatch()
                fun drain(dropWatchAck: Boolean = false) {
                    var count = 0
                    while (messages.isNotEmpty()) {
                        check(count++ < 30) { "Enrollment message loop" }
                        val message = messages.removeFirst()
                        if (dropWatchAck && message.from == CompanionRole.WATCH && message.path.endsWith("/acknowledgement")) continue
                        val receiver = if (message.from == CompanionRole.PHONE) watch else phone
                        val node = if (message.from == CompanionRole.PHONE) "phone" else "watch"
                        if (message.path == WearEnrollmentWire.PATH) receiver.receive(node, message.bytes, WearWorkTicket())
                        else receiver.receiveAcknowledgement(node, message.path, message.bytes, WearWorkTicket())
                    }
                }
                try {
                    phone.begin("watch", WearWorkTicket())
                    watch.begin("phone", WearWorkTicket())
                    drain()
                    val code = requireNotNull(phoneStatus.last()["fingerprint"])
                    assertEquals(code, watchStatus.last()["fingerprint"])
                    phone.confirm(code, WearWorkTicket())
                    drain()
                    assertEquals("confirmFingerprint", watchStatus.last()["phase"])
                    watch.confirm(code, WearWorkTicket())
                    drain(dropWatchAck = true)
                    val pending = watchStore.pendingForPeer("phone", System.currentTimeMillis()).single()
                    assertEquals("pending", phoneStore.find(pending.id)!!.state)
                    if (cancelPhone) {
                        phone.closeCancelled()
                        phone = makePhone()
                        phone.recoverPending("watch", WearWorkTicket())
                        phone.cancel("watch")
                        phone.closeCancelled()
                        phone = makePhone()
                        watch.recoverPending("phone", WearWorkTicket())
                        val replay = messages.removeFirst()
                        assertThrows(IllegalStateException::class.java) {
                            phone.receiveAcknowledgement("watch", replay.path, replay.bytes, WearWorkTicket())
                        }
                        assertNull(phoneStore.find(pending.id))
                    } else {
                        watch.closeCancelled()
                        watch = makeWatch()
                        watch.recoverPending("phone", WearWorkTicket())
                        drain()
                        assertEquals("active", phoneStore.find(pending.id)!!.state)
                        assertEquals("active", watchStore.find(pending.id)!!.state)
                        assertEquals("bound", phoneStatus.last()["phase"])
                        assertEquals("bound", watchStatus.last()["phase"])
                    }
                } finally { phone.closeCancelled(); watch.closeCancelled() }
            } }
        } }
    }

    @Test fun cancellationFencesQueuedRetriesAndConfirmation() = withWearTestDatabase { context ->
        WearBindingStore(context).use { store ->
            var sends = 0
            val controller = WearEnrollmentController(CompanionRole.PHONE, store, { _, _, _ -> sends++ }, {})
            try {
                controller.begin("watch", WearWorkTicket())
                controller.cancel("watch")
                assertThrows(IllegalStateException::class.java) { controller.retry(WearWorkTicket()) }
                assertThrows(IllegalStateException::class.java) { controller.confirm("code", WearWorkTicket()) }
                assertEquals(1, sends)
            } finally { controller.closeCancelled() }
        }
    }

    @Test fun queuedBeginCannotOutliveCancellationOrCloseANewSession() = withWearTestDatabase { context ->
        WearBindingStore(context).use { store ->
            var sends = 0
            val controller = WearEnrollmentController(CompanionRole.PHONE, store, { _, _, _ -> sends++ }, {})
            try {
                val queuedGeneration = controller.generation()
                val cancelledGeneration = controller.cancel("watch")
                assertThrows(IllegalStateException::class.java) {
                    controller.begin("watch", WearWorkTicket(), queuedGeneration)
                }
                controller.begin("watch", WearWorkTicket(), controller.generation())
                controller.closeCancelled(cancelledGeneration)
                controller.retry(WearWorkTicket())
                assertEquals(2, sends)
            } finally { controller.closeCancelled() }
        }
    }
}
