package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class WearPageSendAdmissionTest {
    private val binding = UUID.randomUUID().toString()
    private val epoch = UUID.randomUUID().toString()
    private val metadata = WearEnvelopeMetadata(binding, WearEnvelopeKind.PAGE,
        epoch, 4, "request", 120_000)
    private val published = PublishedWearDashboard(epoch, 4, "path", 120_000)
    private val action = WearJournalRecord(binding, "request", "a".repeat(64),
        "readHostPage", "effect_started", 120_000, null)

    @Test fun admitsOnlyCurrentPublishedActionAtFinalSendBoundary() {
        assertTrue(admitsPageSend(metadata, published, action, "readHostPage", 1))
        assertTrue(admitsPageSend(metadata, published,
            action.copy(actionName = "readHostAgents"), "readHostAgents", 1))
        assertTrue(admitsPageSend(metadata, published,
            action.copy(actionName = "openConversation"), "openConversation", 1))
        assertFalse(admitsPageSend(metadata, published.copy(revision = 5), action, "readHostPage", 1))
        assertFalse(admitsPageSend(metadata, published.copy(publisherEpoch =
            UUID.randomUUID().toString()), action, "readHostPage", 1))
        assertFalse(admitsPageSend(metadata, published, action, "readHostPage", 120_000))
        assertFalse(admitsPageSend(metadata, published.copy(expiresAt = 1), action,
            "readHostPage", 1))
        assertFalse(admitsPageSend(metadata.copy(expiresAt = 1), published, action,
            "readHostPage", 1))
        assertFalse(admitsPageSend(metadata, published, action.copy(state = "unknown"),
            "readHostPage", 1))
        assertFalse(admitsPageSend(metadata, published,
            action.copy(actionName = "sendAgentMessage"), "readHostPage", 1))
        assertFalse(admitsPageSend(metadata, published, action,
            "readHostAgents", 1))
    }
}
