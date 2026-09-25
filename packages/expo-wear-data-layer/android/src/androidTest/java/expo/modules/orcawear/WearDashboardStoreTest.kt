package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class WearDashboardStoreTest {
    @Test fun persistsLatestSnapshotAndRejectsReplaysAcrossRestart() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val epoch = UUID.randomUUID().toString()
        val first = WearEnvelopeMetadata(binding, WearEnvelopeKind.DASHBOARD, epoch, 1, "dashboard", 1000)
        WearDashboardStore(context).use { store ->
            assertEquals(1L, store.reserveRevision(binding))
            assertEquals(2L, store.reserveRevision(binding))
            assertTrue(store.put(first, "first".toByteArray(), 0))
            assertFalse(store.put(first, "replay".toByteArray(), 0))
            assertTrue(store.put(first.copy(revision = 2), "second".toByteArray(), 0))
            assertFalse(store.put(first.copy(expiresAt = 2000), "old-revision".toByteArray(), 0))
            assertFalse(store.put(first.copy(publisherEpoch = UUID.randomUUID().toString(), revision = 2),
                "same-revision".toByteArray(), 0))
        }
        WearDashboardStore(context).use { reopened ->
            assertEquals(3L, reopened.reserveRevision(binding))
            assertEquals("second", String(reopened.get(binding, 0)!!.plaintext))
            assertTrue(reopened.put(first.copy(publisherEpoch = UUID.randomUUID().toString(),
                revision = 3, expiresAt = 900), "new-epoch".toByteArray(), 0))
            assertEquals("new-epoch", String(reopened.get(binding, 0)!!.plaintext))
            assertNull(reopened.get(binding, 900))
            assertFalse(reopened.put(first.copy(expiresAt = 2000), "expired-replay".toByteArray(), 900))
        }
    }

    @Test fun persistsPublisherEpochOfPublishedRevisionAcrossRestart() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val epoch = UUID.randomUUID().toString()
        val metadata = WearEnvelopeMetadata(binding, WearEnvelopeKind.DASHBOARD, epoch, 1, "dashboard", 2000)
        WearDashboardStore(context).use { store ->
            assertEquals(1L, store.reserveRevision(binding))
            assertNull(store.markPublished(metadata))
        }
        WearDashboardStore(context).use { reopened ->
            assertEquals(PublishedWearDashboard(epoch, 1, metadata.path, 2000),
                reopened.publishedDashboard(binding))
        }
    }

    @Test fun rejectsNonDashboardAndExpiredRows() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val metadata = WearEnvelopeMetadata(binding, WearEnvelopeKind.DASHBOARD,
            UUID.randomUUID().toString(), 0, "dashboard", 1000)
        WearDashboardStore(context).use { store ->
            assertThrows(IllegalArgumentException::class.java) {
                store.put(metadata.copy(kind = WearEnvelopeKind.ACTION), byteArrayOf(1), 0)
            }
            assertThrows(IllegalArgumentException::class.java) {
                store.put(metadata, byteArrayOf(1), 1000)
            }
            assertNull(store.get(binding, 0))
        }
    }

    @Test fun preservesUnknownPublicationIntentAcrossRestartAndBoundsAdmission() = withWearTestDatabase { context ->
        val ids = (1..9).map { UUID.randomUUID().toString() }
        WearDashboardStore(context).use { store ->
            ids.forEach { assertEquals(1L, store.reserveRevision(it)) }
            ids.take(8).forEach { id ->
                assertTrue(store.beginPublication(WearEnvelopeMetadata(id, WearEnvelopeKind.DASHBOARD,
                    UUID.randomUUID().toString(), 1, "dashboard", 1000)))
            }
            val ninth = WearEnvelopeMetadata(ids[8], WearEnvelopeKind.DASHBOARD,
                UUID.randomUUID().toString(), 1, "dashboard", 1000)
            assertFalse(store.beginPublication(ninth))
        }
        WearDashboardStore(context).use { reopened ->
            assertEquals(8, reopened.publicationIntents().size)
            val first = reopened.publicationIntents().first()
            reopened.markPublicationCleanup(first.bindingId, first.revision)
            assertEquals(first.path, reopened.cleanupPath(first.bindingId, first.revision))
            assertEquals(7, reopened.publicationIntents().size)
            assertTrue(reopened.beginPublication(WearEnvelopeMetadata(ids[8], WearEnvelopeKind.DASHBOARD,
                UUID.randomUUID().toString(), 1, "dashboard", 1000)))
        }
    }

    @Test fun supersededRevisionUsesDistinctPathAndCannotDeleteNewerPublication() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val epoch = UUID.randomUUID().toString()
        WearDashboardStore(context).use { store ->
            val first = WearEnvelopeMetadata(binding, WearEnvelopeKind.DASHBOARD, epoch,
                store.reserveRevision(binding), "dashboard", 1000)
            val second = first.copy(revision = store.reserveRevision(binding))
            assertNotEquals(first.path, second.path)
            assertTrue(store.beginPublication(first))
            assertTrue(store.beginPublication(second))
            assertNull(store.markPublished(first))
            assertEquals(first.path, store.markPublished(second))
            assertEquals(2L, store.publishedRevision(binding))
            assertEquals(first.path, store.cleanupPath(binding, 1))
            assertEquals(first.path, store.publicationIntent(binding, 1)!!.path)
            store.finishPublication(binding, 1)
            assertEquals(second.path, store.publicationIntent(binding, 2)!!.path)
            assertFalse(store.beginPublication(first))
            assertFalse(store.beginPublication(second))
        }
    }

    @Test fun abandonedWriteDoesNotConsumeLiveSlotsOrBecomeAdmissibleAgain() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val epoch = UUID.randomUUID().toString()
        val first = WearDashboardStore(context).use { store ->
            val metadata = WearEnvelopeMetadata(binding, WearEnvelopeKind.DASHBOARD, epoch,
                store.reserveRevision(binding), "dashboard", 1000)
            assertTrue(store.beginPublication(metadata))
            metadata
        }
        WearDashboardStore(context).use { recovered ->
            recovered.markPublicationCleanup(binding, first.revision)
            assertTrue(recovered.publicationIntents().isEmpty())
            assertEquals(first.path, recovered.cleanupPath(binding, first.revision))
            assertFalse(recovered.beginPublication(first))
            val next = first.copy(revision = recovered.reserveRevision(binding))
            assertTrue(recovered.beginPublication(next))
            assertNull(recovered.markPublished(next))
            assertEquals(next.path, recovered.publicationIntent(binding, next.revision)!!.path)
            assertEquals(first.path, recovered.cleanupPath(binding, first.revision))
            recovered.pruneExpiredCleanup(1000)
            assertNull(recovered.cleanupPath(binding, first.revision))
            assertFalse(recovered.beginPublication(first))
        }
    }

    @Test fun publishedExpiryAndSupersededCleanupSurviveRestart() = withWearTestDatabase { context ->
        val binding = UUID.randomUUID().toString()
        val epoch = UUID.randomUUID().toString()
        WearDashboardStore(context).use { store ->
            val first = WearEnvelopeMetadata(binding, WearEnvelopeKind.DASHBOARD, epoch,
                store.reserveRevision(binding), "dashboard", 1000)
            assertTrue(store.beginPublication(first))
            assertNull(store.markPublished(first))
            store.finishPublication(binding, first.revision)
            val second = first.copy(revision = store.reserveRevision(binding), expiresAt = 2000)
            assertTrue(store.beginPublication(second))
            assertEquals(first.path, store.markPublished(second))
        }
        WearDashboardStore(context).use { recovered ->
            assertEquals(2L, recovered.publishedDashboard(binding)!!.revision)
            assertEquals(2000L, recovered.publishedDashboard(binding)!!.expiresAt)
            assertEquals(2000L, recovered.nextPublishedExpiry(1000))
            assertNull(recovered.nextPublishedExpiry(2000))
            assertEquals(1000L, recovered.nextCleanupExpiry(0))
            assertEquals(1, recovered.cleanupPaths().size)
        }
    }
}
