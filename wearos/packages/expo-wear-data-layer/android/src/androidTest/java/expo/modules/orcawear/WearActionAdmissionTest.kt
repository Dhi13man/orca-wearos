package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.UUID

class WearActionAdmissionTest {
    private val bindingId = UUID.randomUUID().toString()
    private val publisherEpoch = UUID.randomUUID().toString()
    private val metadata = WearEnvelopeMetadata(bindingId, WearEnvelopeKind.ACTION,
        publisherEpoch, 4, "request", 1000)
    private val published = PublishedWearDashboard(publisherEpoch, 4, "/dashboard", 2000)
    private val canonical = """{"schemaVersion":1,"bindingId":"$bindingId","requestId":"request","expiresAt":1000,"action":"refresh","target":{},"publisherEpoch":"$publisherEpoch","expectedRevision":4,"targetPublicationEpoch":null,"targetSnapshotVersion":null,"payload":{}}"""

    @Test fun admitsCanonicalActionBoundToPublishedRevisionAndAllAuthenticatedFields() {
        val plaintext = canonical.toByteArray(Charsets.UTF_8)
        val expectedHash = MessageDigest.getInstance("SHA-256").digest(plaintext).joinToString("") {
            "%02x".format(it.toInt() and 0xff)
        }
        assertEquals(AdmittedWearAction(expectedHash, 1000, "refresh"),
            admitWearAction(metadata, plaintext, published, 0))
        assertEquals(AdmittedWearAction(expectedHash, 1000, "refresh"),
            decodeAuthenticatedWearAction(metadata, plaintext, 0))
    }

    @Test fun rejectsStalePublicationAndHeaderPayloadMismatchBeforeInboxInsertion() {
        val plaintext = canonical.toByteArray(Charsets.UTF_8)
        assertNull(admitWearAction(metadata, plaintext, null, 0))
        assertNull(admitWearAction(metadata, plaintext, published.copy(revision = 5), 0))
        assertNull(admitWearAction(metadata, plaintext,
            published.copy(publisherEpoch = UUID.randomUUID().toString()), 0))
        assertNull(admitWearAction(metadata, plaintext, published.copy(expiresAt = 0), 0))
        assertNull(admitWearAction(metadata, plaintext, published, 1000))
        assertNull(admitWearAction(metadata.copy(bindingId = UUID.randomUUID().toString()), plaintext, published, 0))
        assertNull(admitWearAction(metadata.copy(requestId = "other"), plaintext, published, 0))
        assertNull(admitWearAction(metadata.copy(publisherEpoch = UUID.randomUUID().toString()), plaintext, published, 0))
        assertNull(admitWearAction(metadata.copy(revision = 5), plaintext, published.copy(revision = 5), 0))
        assertNull(admitWearAction(metadata.copy(expiresAt = 1100), plaintext, published, 0))
        assertNull(decodeAuthenticatedWearAction(metadata.copy(expiresAt = 1100), plaintext, 0))
        assertNull(admitWearAction(metadata.copy(kind = WearEnvelopeKind.PAGE), plaintext, published, 0))
        assertNull(admitWearAction(metadata, (canonical + " ").toByteArray(), published, 0))
    }
}
