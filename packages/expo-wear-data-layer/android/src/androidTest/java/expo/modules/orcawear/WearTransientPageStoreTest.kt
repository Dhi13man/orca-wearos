package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class WearTransientPageStoreTest {
    private val binding = UUID.randomUUID().toString()
    private val epoch = UUID.randomUUID().toString()
    private val hash = "a".repeat(64)
    private val metadata = WearEnvelopeMetadata(binding, WearEnvelopeKind.PAGE,
        epoch, 4, "request", 120_000)
    private val action = StoredWearWatchAction(binding, "request", hash,
        "pending", null, 120_000)

    private fun page(actionHash: String = hash, requestId: String = "request") =
        """{"schemaVersion":1,"bindingId":"$binding","requestId":"$requestId","actionHash":"$actionHash","publisherEpoch":"$epoch","revision":4,"cursor":null,"generatedAt":0,"expiresAt":120000,"total":0,"offset":0,"hosts":[],"nextCursor":null}"""

    @Test fun keepsOnlyAnAuthenticatedOutstandingPageInVolatileMemory() {
        val store = WearTransientPageStore()
        assertTrue(store.put(metadata, page(), action, 1))
        assertEquals(page(), store.read(binding, "request", 1)?.serialized)
        assertTrue(store.put(metadata, page(), action, 1))
        assertThrows(IllegalArgumentException::class.java) {
            store.put(metadata, page("b".repeat(64)), action, 1)
        }
        assertThrows(IllegalArgumentException::class.java) {
            store.put(metadata, page(), action.copy(status = "rejected"), 1)
        }
        assertNull(store.read(binding, "request", 120_000))
    }

    @Test fun rejectsHeaderAndRequestSubstitution() {
        val store = WearTransientPageStore()
        assertThrows(IllegalArgumentException::class.java) {
            store.put(metadata, page(requestId = "other"), action, 1)
        }
        assertThrows(IllegalArgumentException::class.java) {
            store.put(metadata.copy(requestId = "other"), page(), action, 1)
        }
    }

    @Test fun malformedUtf8CannotBecomeAReplacementCharacterPage() {
        val malformed = page().toByteArray(Charsets.UTF_8)
        val name = malformed.indexOf('r'.code.toByte())
        malformed[name] = 0xc3.toByte()
        assertThrows(java.nio.charset.CharacterCodingException::class.java) {
            decodeWearPageText(malformed)
        }
    }

    @Test fun acceptsAgentPageShapeOnlyForTheExactOutstandingActionHash() {
        val serialized = """{"schemaVersion":1,"bindingId":"$binding","requestId":"request","actionHash":"$hash","publisherEpoch":"$epoch","revision":4,"hostId":"host-a","inventoryKey":"${"b".repeat(64)}","inventoryAuthority":"authoritative","cursor":null,"generatedAt":0,"expiresAt":120000,"total":0,"offset":0,"agents":[],"nextCursor":null}"""
        val store = WearTransientPageStore()
        assertTrue(store.put(metadata, serialized, action, 1))
        assertEquals(serialized, store.read(binding, "request", 1)?.serialized)
        assertThrows(IllegalArgumentException::class.java) {
            store.put(metadata, serialized.replace(hash, "c".repeat(64)), action, 1)
        }
    }

    @Test fun acceptsConversationPageShapeOnlyForTheExactOutstandingActionHash() {
        val serialized = """{"schemaVersion":1,"bindingId":"$binding","requestId":"request","actionHash":"$hash","publisherEpoch":"$epoch","revision":4,"hostId":"host-a","workspaceId":"workspace-a","workspaceKind":"folder","sessionTabId":"tab-a","targetPublicationEpoch":"publication-a","targetSnapshotVersion":7,"generatedAt":0,"expiresAt":120000,"kind":"structured","contentScope":"text-only","messages":[],"hasOlder":false}"""
        val store = WearTransientPageStore()
        assertTrue(store.put(metadata, serialized, action, 1))
        assertEquals(serialized, store.read(binding, "request", 1)?.serialized)
        assertThrows(IllegalArgumentException::class.java) {
            store.put(metadata, serialized.replace(hash, "c".repeat(64)), action, 1)
        }
    }

    @Test fun acceptsNotificationPageShapeOnlyForTheExactOutstandingActionHash() {
        val serialized = """{"schemaVersion":1,"bindingId":"$binding","requestId":"request","actionHash":"$hash","publisherEpoch":"$epoch","revision":4,"cursor":null,"generatedAt":0,"expiresAt":120000,"hostId":"host-a","hostName":"Machine","hostIndex":0,"totalHosts":1,"hostState":"ready","items":[],"omitted":0,"nextCursor":null}"""
        val store = WearTransientPageStore()
        assertTrue(store.put(metadata, serialized, action, 1))
        assertEquals(serialized, store.read(binding, "request", 1)?.serialized)
        assertThrows(IllegalArgumentException::class.java) {
            store.put(metadata, serialized.replace(hash, "c".repeat(64)), action, 1)
        }
    }
}
