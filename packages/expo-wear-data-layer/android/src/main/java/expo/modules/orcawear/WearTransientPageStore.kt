package expo.modules.orcawear

import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

internal fun decodeWearPageText(bytes: ByteArray): String = Charsets.UTF_8.newDecoder()
    .onMalformedInput(CodingErrorAction.REPORT)
    .onUnmappableCharacter(CodingErrorAction.REPORT)
    .decode(ByteBuffer.wrap(bytes)).toString()

internal data class WearTransientPage(val bindingId: String, val requestId: String,
    val actionHash: String, val publisherEpoch: String, val revision: Long,
    val expiresAt: Long, val serialized: String)

internal class WearTransientPageStore {
    private val pages = LinkedHashMap<Pair<String, String>, WearTransientPage>()

    @Synchronized fun put(metadata: WearEnvelopeMetadata, serialized: String,
        pendingAction: StoredWearWatchAction?, now: Long): Boolean {
        require(metadata.kind == WearEnvelopeKind.PAGE)
        require(pendingAction != null && pendingAction.bindingId == metadata.bindingId &&
            pendingAction.requestId == metadata.requestId &&
            pendingAction.status != "rejected") { "wear_page_unrequested" }
        val page = JSONObject(serialized)
        require((page.length() == 13 || page.length() == 16 || page.length() == 17 || page.length() == 18) &&
            page.getInt("schemaVersion") == 1 &&
            page.getString("bindingId") == metadata.bindingId &&
            page.getString("requestId") == metadata.requestId &&
            page.getString("actionHash") == pendingAction.actionHash &&
            page.getString("publisherEpoch") == metadata.publisherEpoch &&
            page.getLong("revision") == metadata.revision &&
            page.getLong("expiresAt") == metadata.expiresAt &&
            page.getLong("expiresAt") > now) { "wear_page_header_changed" }
        pages.entries.removeAll { it.value.expiresAt <= now }
        val key = metadata.bindingId to metadata.requestId
        val prior = pages[key]
        if (prior != null) return prior.serialized == serialized
        if (pages.size >= 8) pages.remove(pages.keys.first())
        pages[key] = WearTransientPage(metadata.bindingId, metadata.requestId,
            pendingAction.actionHash, metadata.publisherEpoch, metadata.revision,
            metadata.expiresAt, serialized)
        return true
    }

    @Synchronized fun read(bindingId: String, requestId: String, now: Long): WearTransientPage? {
        pages.entries.removeAll { it.value.expiresAt <= now }
        return pages[bindingId to requestId]
    }

    @Synchronized fun removeBinding(bindingId: String) {
        pages.keys.removeAll { it.first == bindingId }
    }
}
