package expo.modules.orcawear

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import org.json.JSONObject

internal data class WearReceipt(
    val bindingId: String,
    val requestId: String,
    val actionHash: String,
    val status: String,
    val reason: String?,
    val expiresAt: Long
)

internal object WearReceiptCodec {
    private val keys = setOf("schemaVersion", "bindingId", "requestId", "actionHash",
        "status", "reason", "expiresAt")
    private val reasons = setOf("invalid-action", "expired", "stale", "rate-limited",
        "busy", "conflict", "unsupported", "unavailable", "target-changed")
    private val hashPattern = Regex("[0-9a-f]{64}")

    fun validOutcome(status: String, reason: String?): Boolean =
        status in setOf("accepted", "rejected", "unknown") &&
            (if (status == "rejected") reason in reasons else reason == null)

    fun encode(receipt: WearReceipt, now: Long): ByteArray {
        validate(receipt, now)
        val json = JSONObject().apply {
            put("schemaVersion", 1)
            put("bindingId", receipt.bindingId)
            put("requestId", receipt.requestId)
            put("actionHash", receipt.actionHash)
            put("status", receipt.status)
            put("reason", receipt.reason ?: JSONObject.NULL)
            put("expiresAt", receipt.expiresAt)
        }
        return json.toString().toByteArray(Charsets.UTF_8).also { require(it.size <= 1024) }
    }

    fun decode(bytes: ByteArray, now: Long): WearReceipt {
        require(bytes.size <= 1024)
        val value = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
        val json = JSONObject(value)
        require(json.keys().asSequence().toSet() == keys && json.get("schemaVersion") == 1)
        require(json.get("bindingId") is String && json.get("requestId") is String &&
            json.get("actionHash") is String && json.get("status") is String)
        val expiration = json.get("expiresAt")
        require(expiration is Number && expiration.toDouble().isFinite() &&
            expiration.toDouble() <= 9_007_199_254_740_991.0 &&
            expiration.toDouble() == expiration.toLong().toDouble())
        val reason = json.get("reason")
        require(reason == JSONObject.NULL || reason is String)
        return WearReceipt(json.getString("bindingId"), json.getString("requestId"),
            json.getString("actionHash"), json.getString("status"),
            if (reason == JSONObject.NULL) null else reason as String, expiration.toLong())
            .also { validate(it, now, WEAR_RECEIVER_CLOCK_SKEW_MS) }
    }

    private fun validate(receipt: WearReceipt, now: Long, clockSkew: Long = 0) {
        require(receipt.bindingId.isNotEmpty() && receipt.bindingId.toByteArray(Charsets.UTF_8).size <= 256)
        require(receipt.requestId.isNotEmpty() && receipt.requestId.toByteArray(Charsets.UTF_8).size <= 256)
        require(hashPattern.matches(receipt.actionHash))
        require(validOutcome(receipt.status, receipt.reason))
        require(receipt.expiresAt > now && receipt.expiresAt - now <= 120_000 + clockSkew)
    }
}
