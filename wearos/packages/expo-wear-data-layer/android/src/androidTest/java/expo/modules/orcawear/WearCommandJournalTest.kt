package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class WearCommandJournalTest {
    private val wire = ByteArray(32) { 7 }

    @Test fun restartRetiresHandoffWithoutEffectToUnknownReceipt() =
        withWearTestDatabase { context ->
            val binding = UUID.randomUUID().toString()
            val canonical = action(binding, "lost-start", 120_000)
            val hash = hash(canonical)
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, "lost-start", "readHostPage", hash,
                        120_000, wire, 0))
                val claim = inbox.claim(0)!!
                assertEquals(WearJournalHandoff.RECORDED,
                    inbox.commitHandoff(binding, "lost-start", hash,
                        claim.claimToken, canonical, 0))
                val second = action(binding, "lost-finish", 120_000)
                val secondHash = hash(second)
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, "lost-finish", "readHostPage", secondHash,
                        120_000, wire, 0))
                val secondClaim = inbox.claim(0)!!
                assertEquals(WearJournalHandoff.RECORDED,
                    inbox.commitHandoff(binding, "lost-finish", secondHash,
                        secondClaim.claimToken, second, 0))
                assertTrue(inbox.startEffect(binding, "lost-finish", secondHash, 0))
                assertTrue(inbox.hasPendingReconciliation())
            }
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { reopened ->
                assertTrue(reopened.pendingReconciliation(1).isEmpty())
                assertEquals("unknown", reopened.journalRecord(binding, "lost-start")!!.state)
                assertEquals("unknown", reopened.journalRecord(binding, "lost-finish")!!.state)
                assertEquals(setOf(binding to "lost-start", binding to "lost-finish"),
                    reopened.pendingReceipts().toSet())
                assertFalse(reopened.startEffect(binding, "lost-start", hash, 1))
                assertFalse(reopened.hasPendingReconciliation())
            }
        }

    @Test fun recoveryListsOnlyStartedTerminalSendsWithoutMessageText() =
        withWearTestDatabase { context ->
            val binding = UUID.randomUUID().toString()
            val canonical = sendAction(binding, "one", 120_000)
            val hash = hash(canonical)
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, "one", "sendAgentMessage", hash, 120_000, wire, 0))
                val claim = inbox.claim(0)!!
                assertEquals(WearJournalHandoff.RECORDED,
                    inbox.commitHandoff(binding, "one", hash, claim.claimToken, canonical, 0))
                assertTrue(inbox.hasPendingReconciliation())
                assertTrue(inbox.startEffect(binding, "one", hash, 1))
            }
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { reopened ->
                assertEquals(listOf(WearJournalRecovery(binding, "one", hash,
                    "host-a", "effect_started")), reopened.pendingReconciliation(2))
                assertTrue(reopened.finishEffect(binding, "one", hash, "unknown", 2))
                assertEquals("unknown", reopened.pendingReconciliation(2).single().state)
                assertTrue(reopened.finishEffect(binding, "one", hash, "accepted", 3))
                assertTrue(reopened.pendingReconciliation(3).isEmpty())
            }
        }

    @Test fun unavailableReconciliationRotatesBehindUntriedRows() =
        withWearTestDatabase { context ->
            val bindings = List(3) { UUID.randomUUID().toString() }
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
                bindings.forEachIndexed { index, binding ->
                    val now = index * 2_000L
                    val request = "request-$index"
                    val canonical = sendAction(binding, request, now + 120_000)
                    val hash = hash(canonical)
                    assertEquals(WearActionInsertResult.INSERTED,
                        inbox.insert(binding, request, "sendAgentMessage", hash,
                            now + 120_000, wire, now))
                    val claim = inbox.claim(now)!!
                    assertEquals(WearJournalHandoff.RECORDED,
                        inbox.commitHandoff(binding, request, hash, claim.claimToken, canonical, now))
                    assertTrue(inbox.startEffect(binding, request, hash, now))
                }
                assertEquals(bindings[0], inbox.pendingReconciliation(6_000).single().bindingId)
                assertEquals(bindings[1], inbox.pendingReconciliation(6_000).single().bindingId)
                assertEquals(bindings[2], inbox.pendingReconciliation(6_000).single().bindingId)
            }
        }

    @Test fun atomicallyHandsOffCiphertextAndReplaysLostBridgeResponseAcrossRestart() =
        withWearTestDatabase { context ->
            val binding = UUID.randomUUID().toString()
            val canonical = action(binding, "one", 120_000)
            val hash = hash(canonical)
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, "one", "readHostPage", hash, 120_000, wire, 0))
                val claim = inbox.claim(0)!!
                assertEquals(WearJournalHandoff.CONFLICT,
                    inbox.commitHandoff(binding, "one", hash, claim.claimToken, byteArrayOf(1), 0))
                assertEquals(WearJournalHandoff.RECORDED,
                    inbox.commitHandoff(binding, "one", hash, claim.claimToken, canonical, 0))
                assertNull(inbox.claim(0))
                val storedTarget = inbox.readableDatabase.rawQuery(
                    "SELECT target_json FROM command_journal WHERE binding_id=? AND request_id=?",
                    arrayOf(binding, "one")
                ).use { it.moveToFirst(); it.getString(0) }
                assertEquals("{}", storedTarget)
            }
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { reopened ->
                assertEquals(WearJournalHandoff.ALREADY_RECORDED,
                    reopened.commitHandoff(binding, "one", hash, "lost-token", canonical, 1))
                assertEquals(WearJournalHandoff.CONFLICT,
                    reopened.commitHandoff(binding, "one", "b".repeat(64), "lost-token", canonical, 1))
                assertEquals(WearActionInsertResult.DUPLICATE,
                    reopened.insert(binding, "one", "readHostPage", hash, 120_000, wire, 61_000))
                assertEquals(WearActionInsertResult.CONFLICT,
                    reopened.insert(binding, "one", "readHostPage", "b".repeat(64), 120_000, wire, 61_000))
                assertTrue(reopened.startEffect(binding, "one", hash, 1))
                assertFalse(reopened.startEffect(binding, "one", hash, 1))
                assertTrue(reopened.finishEffect(binding, "one", hash, "accepted", 2))
                assertFalse(reopened.finishEffect(binding, "one", hash, "rejected", 3, "conflict"))
                assertEquals("accepted", reopened.journalRecord(binding, "one")!!.state)
                assertNull(reopened.journalRecord(binding, "one")!!.reason)
                val receipt = reopened.journalRecord(binding, "one")!!
                assertEquals(listOf(binding to "one"), reopened.pendingReceipts())
                assertTrue(reopened.noteReceiptAttempt(receipt))
                assertTrue(reopened.markReceiptTransmitted(receipt))
                assertTrue(reopened.pendingReceipts().isEmpty())
            }
        }

    @Test fun fullUnresolvedJournalKeepsSeventeenthCiphertextClaim() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            repeat(17) { index ->
                val now = index * 2_000L
                val request = "request-$index"
                val expiresAt = now + 120_000
                val canonical = action(binding, request, expiresAt)
                val hash = hash(canonical)
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, request, "readHostPage", hash, expiresAt, wire, now))
                val claim = inbox.claim(now)!!
                assertEquals(request, claim.requestId)
                assertEquals(if (index < 16) WearJournalHandoff.RECORDED else WearJournalHandoff.FULL,
                    inbox.commitHandoff(binding, request, hash, claim.claimToken, canonical, now))
            }
            assertEquals("request-16", inbox.claim(47_000)!!.requestId)
            assertNull(inbox.journalRecord(binding, "request-16"))
        }
    }

    @Test fun persistsExactRejectionReasonAndRejectsInvalidOutcomeCombination() =
        withWearTestDatabase { context ->
            val binding = UUID.randomUUID().toString()
            val canonical = action(binding, "one", 120_000)
            val hash = hash(canonical)
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, "one", "readHostPage", hash, 120_000, wire, 0))
                val claim = inbox.claim(0)!!
                assertEquals(WearJournalHandoff.RECORDED,
                    inbox.commitHandoff(binding, "one", hash, claim.claimToken, canonical, 0))
                assertTrue(inbox.startEffect(binding, "one", hash, 0))
                assertThrows(IllegalArgumentException::class.java) {
                    inbox.finishEffect(binding, "one", hash, "accepted", 1, "unavailable")
                }
                assertTrue(inbox.finishEffect(binding, "one", hash, "rejected", 1, "target-changed"))
            }
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { reopened ->
                assertEquals("rejected", reopened.journalRecord(binding, "one")!!.state)
                assertEquals("target-changed", reopened.journalRecord(binding, "one")!!.reason)
                assertFalse(reopened.finishEffect(binding, "one", hash, "accepted", 2))
            }
        }

    @Test fun laterAuthoritativeOutcomeReopensReceiptTransport() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val canonical = action(binding, "one", 120_000)
        val hash = hash(canonical)
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "one", "readHostPage", hash, 120_000, wire, 0))
            val claim = inbox.claim(0)!!
            assertEquals(WearJournalHandoff.RECORDED,
                inbox.commitHandoff(binding, "one", hash, claim.claimToken, canonical, 0))
            assertTrue(inbox.startEffect(binding, "one", hash, 0))
            assertTrue(inbox.finishEffect(binding, "one", hash, "unknown", 1))
            val unknown = inbox.journalRecord(binding, "one")!!
            assertTrue(inbox.noteReceiptAttempt(unknown))
            assertTrue(inbox.markReceiptTransmitted(unknown))
            assertTrue(inbox.pendingReceipts().isEmpty())
            assertTrue(inbox.finishEffect(binding, "one", hash, "accepted", 2))
            assertEquals(listOf(binding to "one"), inbox.pendingReceipts())
            assertFalse(inbox.markReceiptTransmitted(unknown))
        }
    }

    @Test fun failedReceiptPreparationsRotateBehindLaterTerminalRows() =
        withWearTestDatabase { context ->
            val binding = UUID.randomUUID().toString()
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
                repeat(3) { index ->
                    val now = index * 2_000L
                    val request = "request-$index"
                    val canonical = action(binding, request, now + 120_000)
                    val hash = hash(canonical)
                    assertEquals(WearActionInsertResult.INSERTED,
                        inbox.insert(binding, request, "readHostPage", hash,
                            now + 120_000, wire, now))
                    val claim = inbox.claim(now)!!
                    assertEquals(WearJournalHandoff.RECORDED,
                        inbox.commitHandoff(binding, request, hash, claim.claimToken, canonical, now))
                    assertTrue(inbox.startEffect(binding, request, hash, now))
                    assertTrue(inbox.finishEffect(binding, request, hash, "rejected", now, "unavailable"))
                }
                assertEquals("request-0", inbox.pendingReceipts().first().second)
                assertTrue(inbox.noteReceiptAttempt(inbox.journalRecord(binding, "request-0")!!))
                assertTrue(inbox.noteReceiptAttempt(inbox.journalRecord(binding, "request-1")!!))
                assertEquals("request-2", inbox.pendingReceipts().first().second)
            }
        }

    @Test fun expiredUnstartedCommandBecomesUnknownWithoutAnEffect() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val canonical = action(binding, "one", 120_000)
        val hash = hash(canonical)
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "one", "readHostPage", hash, 120_000, wire, 0))
            val claim = inbox.claim(0)!!
            assertEquals(WearJournalHandoff.RECORDED,
                inbox.commitHandoff(binding, "one", hash, claim.claimToken, canonical, 0))
            assertEquals(0, inbox.prune(120_000))
            assertEquals("unknown", inbox.journalRecord(binding, "one")!!.state)
            assertFalse(inbox.startEffect(binding, "one", hash, 120_000))
            assertFalse(inbox.finishEffect(binding, "one", hash, "accepted", 120_001))
        }
    }

    @Test fun wallClockJumpCannotEraseTerminalDeduplication() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val canonical = action(binding, "one", 120_000)
        val hash = hash(canonical)
        var time = WearAdmissionTime(1_000, 1)
        WearActionInbox(context) { time }.use { inbox ->
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "one", "readHostPage", hash, 120_000, wire, 0))
            val claim = inbox.claim(0)!!
            assertEquals(WearJournalHandoff.RECORDED,
                inbox.commitHandoff(binding, "one", hash, claim.claimToken, canonical, 0))
            assertTrue(inbox.startEffect(binding, "one", hash, 0))
            assertTrue(inbox.finishEffect(binding, "one", hash, "accepted", 0))
            time = WearAdmissionTime(2_000, 1)
            val jumpedWall = 31L * 86_400_000
            inbox.prune(jumpedWall)
            assertEquals("accepted", inbox.journalRecord(binding, "one")!!.state)
            assertEquals(WearActionInsertResult.DUPLICATE,
                inbox.insert(binding, "one", "readHostPage", hash, jumpedWall + 120_000,
                    wire, jumpedWall))
            assertEquals(WearActionInsertResult.CONFLICT,
                inbox.insert(binding, "one", "readHostPage", "b".repeat(64), 120_000,
                    wire, 1))
        }
    }

    @Test fun oneBindingCannotStartTwoEffectsAcrossDatabaseConnections() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        var time = WearAdmissionTime(1_000, 1)
        WearActionInbox(context) { time }.use { first ->
            WearActionInbox(context) { time }.use { second ->
                for (request in listOf("one", "two")) {
                    val canonical = action(binding, request, 120_000)
                    val hash = hash(canonical)
                    assertEquals(WearActionInsertResult.INSERTED,
                        first.insert(binding, request, "readHostPage", hash, 120_000, wire, 0))
                    val claim = first.claim(0)!!
                    assertEquals(WearJournalHandoff.RECORDED,
                        first.commitHandoff(binding, request, hash, claim.claimToken, canonical, 0))
                }
                val firstHash = hash(action(binding, "one", 120_000))
                val secondHash = hash(action(binding, "two", 120_000))
                assertTrue(first.startEffect(binding, "one", firstHash, 0))
                assertFalse(second.startEffect(binding, "two", secondHash, 0))
                assertTrue(first.finishEffect(binding, "one", firstHash, "accepted", 0))
                assertTrue(second.startEffect(binding, "two", secondHash, 0))
                val jumpedWall = 2L * 86_400_000
                time = WearAdmissionTime(2_000, 1)
                assertEquals(0, second.prune(jumpedWall))
                assertEquals("effect_started", second.journalRecord(binding, "two")!!.state)
            }
        }
    }

    @Test fun concurrentEffectStartsAcrossConnectionsAdmitExactlyOne() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { first ->
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { second ->
                for (request in listOf("one", "two")) {
                    val canonical = action(binding, request, 120_000)
                    val hash = hash(canonical)
                    assertEquals(WearActionInsertResult.INSERTED,
                        first.insert(binding, request, "readHostPage", hash, 120_000, wire, 0))
                    val claim = first.claim(0)!!
                    assertEquals(WearJournalHandoff.RECORDED,
                        first.commitHandoff(binding, request, hash, claim.claimToken, canonical, 0))
                }
                val ready = CountDownLatch(2)
                val go = CountDownLatch(1)
                val pool = Executors.newFixedThreadPool(2)
                try {
                    val attempts = listOf("one" to first, "two" to second).map { (request, inbox) ->
                        pool.submit<Boolean> {
                            ready.countDown()
                            check(go.await(5, TimeUnit.SECONDS))
                            inbox.startEffect(binding, request, hash(action(binding, request, 120_000)), 0)
                        }
                    }
                    assertTrue(ready.await(5, TimeUnit.SECONDS))
                    go.countDown()
                    assertEquals(1, attempts.count { it.get(10, TimeUnit.SECONDS) })
                } finally { pool.shutdownNow() }
            }
        }
    }

    @Test fun elapsedExpiryReleasesOpenCapacityDespiteBackwardWallClock() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        var time = WearAdmissionTime(0, 1)
        WearActionInbox(context) { time }.use { inbox ->
            repeat(16) { index ->
                val now = index * 2_000L
                time = WearAdmissionTime(now, 1)
                val request = "old-$index"
                val canonical = action(binding, request, now + 120_000)
                val hash = hash(canonical)
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, request, "readHostPage", hash, now + 120_000, wire, now))
                val claim = inbox.claim(now)!!
                assertEquals(WearJournalHandoff.RECORDED,
                    inbox.commitHandoff(binding, request, hash, claim.claimToken, canonical, now))
            }
            time = WearAdmissionTime(151_000, 1)
            inbox.prune(0)
            assertEquals("unknown", inbox.journalRecord(binding, "old-0")!!.state)
            assertFalse(inbox.startEffect(binding, "old-0", hash(action(binding, "old-0", 120_000)), 0))
            val canonical = action(binding, "new", 120_000)
            val hash = hash(canonical)
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "new", "readHostPage", hash, 120_000, wire, 0))
            val claim = inbox.claim(0)!!
            assertEquals(WearJournalHandoff.RECORDED,
                inbox.commitHandoff(binding, "new", hash, claim.claimToken, canonical, 0))
        }
    }

    @Test fun changedBootRetiresUnstartedCommandBeforeItCanExecute() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        var time = WearAdmissionTime(1_000, 1)
        WearActionInbox(context) { time }.use { inbox ->
            val canonical = action(binding, "one", 120_000)
            val hash = hash(canonical)
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "one", "readHostPage", hash, 120_000, wire, 0))
            val claim = inbox.claim(0)!!
            assertEquals(WearJournalHandoff.RECORDED,
                inbox.commitHandoff(binding, "one", hash, claim.claimToken, canonical, 0))
            time = WearAdmissionTime(2_000, 2)
            inbox.prune(0)
            assertEquals("unknown", inbox.journalRecord(binding, "one")!!.state)
            assertFalse(inbox.startEffect(binding, "one", hash, 0))
        }
    }

    private fun action(binding: String, request: String, expiresAt: Long): ByteArray =
        """{"schemaVersion":1,"bindingId":"$binding","requestId":"$request","expiresAt":$expiresAt,"action":"readHostPage","target":{},"publisherEpoch":"publisher","expectedRevision":1,"targetPublicationEpoch":null,"targetSnapshotVersion":null,"payload":{"cursor":null}}"""
            .toByteArray(Charsets.UTF_8)

    private fun sendAction(binding: String, request: String, expiresAt: Long): ByteArray =
        """{"schemaVersion":1,"bindingId":"$binding","requestId":"$request","expiresAt":$expiresAt,"action":"sendAgentMessage","target":{"hostId":"host-a","workspaceId":"workspace-a","workspaceKind":"worktree","sessionTabId":"tab-a"},"publisherEpoch":"publisher","expectedRevision":1,"targetPublicationEpoch":"runtime-epoch","targetSnapshotVersion":7,"payload":{"text":"private prompt"}}"""
            .toByteArray(Charsets.UTF_8)

    private fun hash(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xff) }
}
