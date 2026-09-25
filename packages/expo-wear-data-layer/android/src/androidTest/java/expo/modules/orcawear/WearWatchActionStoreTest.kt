package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class WearWatchActionStoreTest {
    private val binding = UUID.randomUUID().toString()
    private val hash = "a".repeat(64)

    @Test fun correlatesOnlyExactPendingHashAcrossRestartAndNeverDowngradesAcceptance() =
        withWearTestDatabase { context ->
            val clock = { WearAdmissionTime(0, 1) }
            WearWatchActionStore(context, clock).use { store ->
                assertEquals(WearWatchActionInsert.INSERTED,
                    store.record(binding, "one", hash, 120_000, 0))
                assertEquals(WearWatchActionInsert.DUPLICATE,
                    store.record(binding, "one", hash, 120_000, 0))
                assertEquals(WearWatchActionInsert.CONFLICT,
                    store.record(binding, "one", "b".repeat(64), 120_000, 0))
                assertFalse(store.apply(receipt("missing", hash, "accepted"), 0))
                assertFalse(store.apply(receipt("one", "b".repeat(64), "accepted"), 0))
                assertTrue(store.apply(receipt("one", hash, "unknown"), 0))
            }
            WearWatchActionStore(context, clock).use { reopened ->
                assertEquals("unknown", reopened.read(binding, "one")!!.status)
                assertTrue(reopened.apply(receipt("one", hash, "accepted"), 1))
                assertFalse(reopened.apply(receipt("one", hash, "unknown"), 1))
                assertFalse(reopened.apply(receipt("one", hash, "rejected", "conflict"), 1))
                assertEquals("accepted", reopened.read(binding, "one")!!.status)
                assertNull(reopened.read(binding, "one")!!.reason)
            }
        }

    @Test fun persistsRejectionAndReleasesExpiredPendingCapacity() = withWearTestDatabase { context ->
        var time = WearAdmissionTime(0, 1)
        WearWatchActionStore(context) { time }.use { store ->
            repeat(8) { index ->
                assertEquals(WearWatchActionInsert.INSERTED,
                    store.record(binding, "r$index", hash, 120_000, 0))
            }
            assertEquals(WearWatchActionInsert.FULL,
                store.record(binding, "ninth", hash, 120_000, 0))
            time = WearAdmissionTime(120_001, 1)
            assertEquals(WearWatchActionInsert.INSERTED,
                store.record(binding, "later", hash, 240_000, 120_001))
            assertEquals("unknown", store.read(binding, "r0")!!.status)
            assertTrue(store.apply(receipt("later", hash, "rejected", "target-changed",
                240_000), 120_001))
        }
        WearWatchActionStore(context) { time }.use { reopened ->
            assertEquals("target-changed", reopened.read(binding, "later")!!.reason)
            reopened.removeBinding(binding)
            assertNull(reopened.read(binding, "later"))
        }
    }

    @Test fun wallClockRollbackAndRebootCannotStrandPendingSlots() = withWearTestDatabase { context ->
        var time = WearAdmissionTime(0, 1)
        WearWatchActionStore(context) { time }.use { store ->
            repeat(8) { index ->
                assertEquals(WearWatchActionInsert.INSERTED,
                    store.record(binding, "old-$index", hash, 120_000, 0))
            }
            time = WearAdmissionTime(120_001, 1)
            assertEquals(WearWatchActionInsert.INSERTED,
                store.record(binding, "after-rollback", hash, 120_000, 0))
            assertEquals("unknown", store.read(binding, "old-0")!!.status)
        }
        time = WearAdmissionTime(0, 2)
        WearWatchActionStore(context) { time }.use { reopened ->
            assertEquals("unknown", reopened.read(binding, "after-rollback")!!.status)
            assertEquals(WearWatchActionInsert.INSERTED,
                reopened.record(binding, "after-reboot", hash, 120_000, 0))
        }
    }

    @Test fun wallClockJumpCannotEraseTerminalDeduplication() = withWearTestDatabase { context ->
        var time = WearAdmissionTime(0, 1)
        WearWatchActionStore(context) { time }.use { store ->
            assertEquals(WearWatchActionInsert.INSERTED,
                store.record(binding, "one", hash, 120_000, 0))
            assertTrue(store.apply(receipt("one", hash, "accepted"), 0))
            time = WearAdmissionTime(1_000, 1)
            val jumpedWall = 31L * 86_400_000
            assertEquals(WearWatchActionInsert.INSERTED,
                store.record(binding, "two", hash, jumpedWall + 120_000, jumpedWall))
            assertEquals(WearWatchActionInsert.DUPLICATE,
                store.record(binding, "one", hash, 120_000, 0))
        }
    }

    private fun receipt(requestId: String, actionHash: String, status: String,
        reason: String? = null, expiresAt: Long = 120_000) =
        WearReceipt(binding, requestId, actionHash, status, reason, expiresAt)
}
