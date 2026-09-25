package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.UUID

class WearActionInboxTest {
    private val hash = "a".repeat(64)
    private val wire = ByteArray(32) { 7 }

    @Test fun persistsPendingCiphertextAndRequiresExactClaimForHandoff() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val canonical = actionBytes(binding, "one", "readHostPage", 120_000)
        val actionHash = hashOf(canonical)
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            assertEquals(WearActionInsertResult.INSERTED, inbox.insert(binding, "one", "readHostPage", actionHash, 120_000, wire, 0))
            assertEquals(WearActionInsertResult.DUPLICATE, inbox.insert(binding, "one", "readHostPage", actionHash, 120_000, wire, 0))
            assertEquals(WearActionInsertResult.CONFLICT,
                inbox.insert(binding, "one", "readHostPage", "b".repeat(64), 120_000, wire, 0))
        }
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { reopened ->
            val claim = reopened.claim(1)!!
            assertEquals(binding, claim.bindingId)
            assertEquals("one", claim.requestId)
            assertArrayEquals(wire, claim.wire)
            assertNull(reopened.claim(2))
            assertEquals(WearJournalHandoff.MISSING, reopened.commitHandoff(binding, "one", actionHash,
                UUID.randomUUID().toString(), canonical, 2))
            assertEquals(WearJournalHandoff.CONFLICT, reopened.commitHandoff(binding, "one",
                "b".repeat(64), claim.claimToken, canonical, 2))
            assertEquals(WearJournalHandoff.RECORDED, reopened.commitHandoff(binding, "one",
                actionHash, claim.claimToken, canonical, 2))
            assertEquals("recorded", reopened.journalRecord(binding, "one")!!.state)
            assertNull(reopened.claim(2))
        }
    }

    @Test fun expiredClaimsRequeueWithNewTokenAndExpiredActionsAreDeleted() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val canonical = actionBytes(binding, "one", "readHostPage", 30_000)
        val actionHash = hashOf(canonical)
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            assertEquals(WearActionInsertResult.INSERTED, inbox.insert(binding, "one", "readHostPage", actionHash, 30_000, wire, 0))
            val first = inbox.claim(0)!!
            assertNull(inbox.claim(14_999))
            val second = inbox.claim(15_000)!!
            assertNotEquals(first.claimToken, second.claimToken)
            assertEquals(WearJournalHandoff.MISSING, inbox.commitHandoff(binding, "one", actionHash,
                first.claimToken, canonical, 15_000))
            assertEquals(1, inbox.prune(30_000))
            assertNull(inbox.claim(30_000))
        }
    }

    @Test fun boundsPerBindingAndGlobalCapacityAndRemovesOneBinding() = withWearTestDatabase { context ->
        val bindings = (1..9).map { UUID.randomUUID().toString() }
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            bindings.take(8).forEach { binding ->
                (1..8).forEach { index ->
                    assertEquals(WearActionInsertResult.INSERTED,
                        inbox.insert(binding, "request-$index", "sendAgentMessage", hash, 120_000, wire,
                            index * 2_000L))
                }
                assertEquals(WearActionInsertResult.BUSY,
                    inbox.insert(binding, "ninth", "sendAgentMessage", hash, 120_000, wire, 18_000))
            }
            assertEquals(WearActionInsertResult.BUSY,
                inbox.insert(bindings[8], "one", "sendAgentMessage", hash, 120_000, wire, 18_000))
            assertEquals(8, inbox.removeBinding(bindings[0]))
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(bindings[8], "one", "sendAgentMessage", hash, 120_000, wire, 18_000))
            assertEquals(0, inbox.removeBinding(bindings[0]))
        }
    }

    @Test fun admitsOnlyEncryptedActionWireWithinEightKiB() = withWearTestDatabase { context ->
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            val binding = UUID.randomUUID().toString()
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "max", "readHostPage", hash, 120_000, ByteArray(8192), 0))
            assertThrows(IllegalArgumentException::class.java) {
                inbox.insert(binding, "oversized", "readHostPage", hash, 120_000, ByteArray(8193), 0)
            }
        }
    }

    @Test fun persistsReadBurstAndRollingMinuteLimitsAcrossRestart() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            repeat(4) { index -> acceptAndConfirm(inbox, binding, "read-$index", "readHostPage", 0) }
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                inbox.insert(binding, "burst", "readHostAgents", hash, 120_000, wire, 0))
        }
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { reopened ->
            repeat(26) { index ->
                acceptAndConfirm(reopened, binding, "later-$index", "renewConversation", 2_000L * (index + 1))
            }
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                reopened.insert(binding, "minute", "readHostPage", hash, 120_000, wire, 59_000))
            acceptAndConfirm(reopened, binding, "next-minute", "readHostPage", 60_000)
        }
    }

    @Test fun sendRefreshAndHandoffBudgetsRejectWithoutSpendingOnDuplicate() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            acceptAndConfirm(inbox, binding, "send-0", "sendAgentMessage", 0)
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                inbox.insert(binding, "too-soon", "sendAgentMessage", hash, 120_000, wire, 1_999))
            repeat(9) { index ->
                acceptAndConfirm(inbox, binding, "send-${index + 1}", "sendAgentMessage", 2_000L * (index + 1))
            }
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                inbox.insert(binding, "send-eleven", "sendAgentMessage", hash, 120_000, wire, 20_000))
            acceptAndConfirm(inbox, binding, "send-new-window", "sendAgentMessage", 60_000)
            val refreshBytes = actionBytes(binding, "refresh", "refresh", 120_000)
            val refreshHash = hashOf(refreshBytes)
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "refresh", "refresh", refreshHash, 120_000, wire, 60_000))
            assertEquals(WearActionInsertResult.DUPLICATE,
                inbox.insert(binding, "refresh", "refresh", refreshHash, 120_000, wire, 60_000))
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                inbox.insert(binding, "refresh-early", "refresh", hash, 120_000, wire, 69_999))
            val refreshClaim = inbox.claim(60_000)!!
            assertEquals("refresh", refreshClaim.requestId)
            assertEquals(WearJournalHandoff.RECORDED, inbox.commitHandoff(binding, "refresh",
                refreshHash, refreshClaim.claimToken, refreshBytes, 60_000))
            acceptAndConfirm(inbox, binding, "handoff", "requestPhoneHandoff", 60_000)
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                inbox.insert(binding, "handoff-early", "requestPhoneHandoff", hash, 120_000, wire, 64_999))
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "handoff-later", "requestPhoneHandoff", hash, 120_000, wire, 65_000))
        }
    }

    private fun acceptAndConfirm(inbox: WearActionInbox, binding: String, request: String,
        action: String, now: Long) {
        val expiresAt = now + 120_000
        val canonical = actionBytes(binding, request, action, expiresAt)
        val actionHash = hashOf(canonical)
        assertEquals(WearActionInsertResult.INSERTED,
            inbox.insert(binding, request, action, actionHash, expiresAt, wire, now))
        val claim = inbox.claim(now)!!
        assertEquals(request, claim.requestId)
        assertEquals(WearJournalHandoff.RECORDED, inbox.commitHandoff(binding, request,
            actionHash, claim.claimToken, canonical, now))
        assertTrue(inbox.startEffect(binding, request, actionHash, now))
        assertTrue(inbox.finishEffect(binding, request, actionHash, "accepted", now))
    }

    @Test fun recentHandoffReplayReturnsDuplicateOrConflictWithoutASecondAdmission() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
            acceptAndConfirm(inbox, binding, "one", "sendAgentMessage", 0)
        }
        WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { reopened ->
            val actionHash = hashOf(actionBytes(binding, "one", "sendAgentMessage", 120_000))
            assertEquals(WearActionInsertResult.DUPLICATE,
                reopened.insert(binding, "one", "sendAgentMessage", actionHash, 120_000, wire, 1))
            assertEquals(WearActionInsertResult.CONFLICT,
                reopened.insert(binding, "one", "sendAgentMessage", "b".repeat(64), 120_000, wire, 1))
            assertNull(reopened.claim(1))
        }
    }

    private fun hashOf(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun actionBytes(binding: String, request: String, action: String, expiresAt: Long): ByteArray {
        val session = action in setOf("renewConversation", "sendAgentMessage", "requestPhoneHandoff")
        val target = if (session)
            """{"hostId":"host","workspaceId":"workspace","workspaceKind":"folder","sessionTabId":"session"}"""
        else "{}"
        val payload = when (action) {
            "readHostPage" -> """{"cursor":null}"""
            "renewConversation" -> """{"leaseId":"lease"}"""
            "sendAgentMessage" -> """{"text":"test"}"""
            else -> "{}"
        }
        val targetEpoch = if (session) "\"runtime\"" else "null"
        val targetVersion = if (session) "1" else "null"
        return """{"schemaVersion":1,"bindingId":"$binding","requestId":"$request","expiresAt":$expiresAt,"action":"$action","target":$target,"publisherEpoch":"publisher","expectedRevision":1,"targetPublicationEpoch":$targetEpoch,"targetSnapshotVersion":$targetVersion,"payload":$payload}"""
            .toByteArray(Charsets.UTF_8)
    }

    @Test fun wallClockJumpsDoNotResetReadBurstOrSendAndRefreshGaps() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        var time = WearAdmissionTime(1_000, 1)
        WearActionInbox(context) { time }.use { inbox ->
            repeat(4) { index ->
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, "read-$index", "readHostPage", hash, 121_000, wire, 1_000))
            }
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "send", "sendAgentMessage", hash, 121_000, wire, 1_000))
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "refresh", "refresh", hash, 121_000, wire, 1_000))
            time = WearAdmissionTime(1_001, 1)
            for (wall in listOf(1_000_000L, 500L)) {
                assertEquals(WearActionInsertResult.RATE_LIMITED,
                    inbox.insert(binding, "read-jump", "readHostAgents", hash, wall + 120_000, wire, wall))
                assertEquals(WearActionInsertResult.RATE_LIMITED,
                    inbox.insert(binding, "send-jump", "sendAgentMessage", hash, wall + 120_000, wire, wall))
                assertEquals(WearActionInsertResult.RATE_LIMITED,
                    inbox.insert(binding, "refresh-jump", "refresh", hash, wall + 120_000, wire, wall))
            }
        }
    }

    @Test fun rebootKeepsPriorBudgetClosedUntilSixtySecondsOfNewBoot() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        var time = WearAdmissionTime(10_000, 1)
        WearActionInbox(context) { time }.use { inbox ->
            assertEquals(WearActionInsertResult.INSERTED,
                inbox.insert(binding, "old", "requestPhoneHandoff", hash, 120_000, wire, 0))
        }
        WearActionInbox(context) { time }.use { reopened ->
            time = WearAdmissionTime(30_000, 2)
            assertEquals(WearActionInsertResult.DUPLICATE,
                reopened.insert(binding, "old", "requestPhoneHandoff", hash, 120_000, wire, 1))
            assertEquals(WearActionInsertResult.CONFLICT,
                reopened.insert(binding, "old", "requestPhoneHandoff", "b".repeat(64), 120_000, wire, 1))
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                reopened.insert(binding, "new", "requestPhoneHandoff", hash, 120_000, wire, 1))
            time = WearAdmissionTime(60_000, 2)
            assertEquals(WearActionInsertResult.INSERTED,
                reopened.insert(binding, "new", "requestPhoneHandoff", hash, 120_000, wire, 1))
            time = WearAdmissionTime(60_001, -1)
            assertEquals(WearActionInsertResult.RATE_LIMITED,
                reopened.insert(binding, "unknown-boot", "refresh", hash, 120_000, wire, 1))
        }
    }

    @Test fun durableAdmissionRejectionPreservesExistingRequestsAcrossRestart() =
        withWearTestDatabase { context ->
            val binding = UUID.randomUUID().toString()
            val epoch = UUID.randomUUID().toString()
            fun metadata(request: String) = WearEnvelopeMetadata(binding, WearEnvelopeKind.ACTION,
                epoch, 1, request, 120_000)
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, "accepted", "refresh", hash, 120_000, wire, 0,
                        metadata("accepted")))
                assertEquals(WearActionInsertResult.DUPLICATE,
                    inbox.insert(binding, "accepted", "refresh", hash, 120_000, wire, 1,
                        metadata("accepted"), stale = true))
                assertEquals(WearActionInsertResult.REJECTED,
                    inbox.insert(binding, "stale", "refresh", hash, 120_000, wire, 1,
                        metadata("stale"), stale = true))
                assertEquals(WearActionInsertResult.REJECTED,
                    inbox.insert(binding, "rate", "refresh", hash, 120_000, wire, 1,
                        metadata("rate")))
                assertEquals(WearActionInsertResult.CONFLICT,
                    inbox.insert(binding, "rate", "refresh", "b".repeat(64), 120_000, wire, 1,
                        metadata("rate")))
                assertEquals("stale", inbox.journalRecord(binding, "stale")!!.reason)
                assertEquals("rate-limited", inbox.journalRecord(binding, "rate")!!.reason)
                assertEquals("rejected", inbox.journalRecord(binding, "rate")!!.state)
                assertEquals(setOf(binding to "stale", binding to "rate"), inbox.pendingReceipts().toSet())
                assertEquals("accepted", inbox.claim(1)!!.requestId)
            }
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { reopened ->
                assertEquals(WearActionInsertResult.DUPLICATE,
                    reopened.insert(binding, "rate", "refresh", hash, 120_000, wire, 2,
                        metadata("rate")))
                assertEquals("rejected", reopened.journalRecord(binding, "stale")!!.state)
                assertFalse(reopened.hasPendingReconciliation())
                assertEquals(setOf(binding to "stale", binding to "rate"), reopened.pendingReceipts().toSet())
            }
        }

    @Test fun fullInboxRecordsBusyWithoutReplacingAcceptedRequests() =
        withWearTestDatabase { context ->
            val binding = UUID.randomUUID().toString()
            val epoch = UUID.randomUUID().toString()
            fun metadata(request: String) = WearEnvelopeMetadata(binding, WearEnvelopeKind.ACTION,
                epoch, 1, request, 120_000)
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
                repeat(8) { index ->
                    val request = "accepted-$index"
                    assertEquals(WearActionInsertResult.INSERTED,
                        inbox.insert(binding, request, "sendAgentMessage", hash, 120_000, wire,
                            index * 2_000L, metadata(request)))
                }
                assertEquals(WearActionInsertResult.REJECTED,
                    inbox.insert(binding, "busy", "sendAgentMessage", hash, 120_000, wire,
                        16_000, metadata("busy")))
                assertEquals("busy", inbox.journalRecord(binding, "busy")!!.reason)
                assertEquals(WearActionInsertResult.DUPLICATE,
                    inbox.insert(binding, "accepted-0", "sendAgentMessage", hash, 120_000,
                        wire, 16_000, metadata("accepted-0"), stale = true))
                assertEquals("accepted-0", inbox.claim(16_000)!!.requestId)
            }
        }

    @Test fun admissionRejectionCapReservesJournalSpaceForCommands() =
        withWearTestDatabase { context ->
            val binding = UUID.randomUUID().toString()
            val epoch = UUID.randomUUID().toString()
            WearActionInbox(context) { WearAdmissionTime(it, 1) }.use { inbox ->
                repeat(32) { index ->
                    val request = "stale-$index"
                    val metadata = WearEnvelopeMetadata(binding, WearEnvelopeKind.ACTION,
                        epoch, 1, request, 120_000)
                    assertEquals(WearActionInsertResult.REJECTED,
                        inbox.insert(binding, request, "readHostPage", hash, 120_000,
                            wire, 0, metadata, stale = true))
                }
                val overflow = WearEnvelopeMetadata(binding, WearEnvelopeKind.ACTION,
                    epoch, 1, "overflow", 120_000)
                assertEquals(WearActionInsertResult.STALE,
                    inbox.insert(binding, "overflow", "readHostPage", hash, 120_000,
                        wire, 0, overflow, stale = true))
                assertNull(inbox.journalRecord(binding, "overflow"))
                val canonical = actionBytes(binding, "command", "readHostPage", 120_000)
                val actionHash = hashOf(canonical)
                assertEquals(WearActionInsertResult.INSERTED,
                    inbox.insert(binding, "command", "readHostPage", actionHash,
                        120_000, wire, 0))
                val claim = inbox.claim(0)!!
                assertEquals(WearJournalHandoff.RECORDED,
                    inbox.commitHandoff(binding, "command", actionHash,
                        claim.claimToken, canonical, 0))
            }
        }
}
