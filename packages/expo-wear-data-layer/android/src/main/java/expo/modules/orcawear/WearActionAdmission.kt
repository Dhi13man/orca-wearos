package expo.modules.orcawear

import dev.orca.wear.contract.ActionAdmission
import dev.orca.wear.contract.WearActionDecoder
import java.security.MessageDigest

internal data class AdmittedWearAction(val hash: String, val expiresAt: Long, val name: String)

internal fun admitWearAction(metadata: WearEnvelopeMetadata, plaintext: ByteArray,
    published: PublishedWearDashboard?, now: Long): AdmittedWearAction? {
    if (metadata.kind != WearEnvelopeKind.ACTION || published == null ||
        published.revision != metadata.revision ||
        published.publisherEpoch != metadata.publisherEpoch || published.expiresAt <= now) return null
    return decodeAuthenticatedWearAction(metadata, plaintext, now)
}

internal fun decodeAuthenticatedWearAction(metadata: WearEnvelopeMetadata, plaintext: ByteArray,
    now: Long): AdmittedWearAction? {
    if (metadata.kind != WearEnvelopeKind.ACTION) return null
    val decoded = WearActionDecoder.decode(plaintext, now) as? ActionAdmission.Accepted ?: return null
    val action = decoded.envelope
    if (action.getString("bindingId") != metadata.bindingId ||
        action.getString("requestId") != metadata.requestId ||
        action.getString("publisherEpoch") != metadata.publisherEpoch ||
        action.getLong("expectedRevision") != metadata.revision ||
        action.getLong("expiresAt") != metadata.expiresAt) return null
    val hash = MessageDigest.getInstance("SHA-256").digest(plaintext).joinToString("") {
        "%02x".format(it.toInt() and 0xff)
    }
    return AdmittedWearAction(hash, metadata.expiresAt, action.getString("action"))
}
