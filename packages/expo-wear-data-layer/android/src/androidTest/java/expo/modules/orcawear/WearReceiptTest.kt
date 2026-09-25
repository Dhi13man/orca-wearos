package expo.modules.orcawear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class WearReceiptTest {
    private val receipt = WearReceipt("binding", "request", "a".repeat(64),
        "rejected", "rate-limited", 120_000)

    @Test fun acceptsBoundedReceiverClockSkewOnly() {
        val wire = WearReceiptCodec.encode(receipt, 0)
        assertEquals(receipt, WearReceiptCodec.decode(wire, -30_000))
        assertThrows(IllegalArgumentException::class.java) { WearReceiptCodec.decode(wire, -30_001) }
        assertThrows(IllegalArgumentException::class.java) { WearReceiptCodec.decode(wire, 120_000) }
        assertThrows(IllegalArgumentException::class.java) { WearReceiptCodec.encode(receipt, -1) }
    }

    @Test fun roundTripsClosedOutcomesAndExpiry() {
        for (value in listOf(receipt, receipt.copy(status = "accepted", reason = null),
            receipt.copy(status = "unknown", reason = null))) {
            val wire = WearReceiptCodec.encode(value, 0)
            assertEquals(value, WearReceiptCodec.decode(wire, 0))
            assertThrows(IllegalArgumentException::class.java) {
                WearReceiptCodec.decode(wire, 120_000)
            }
        }
    }

    @Test fun rejectsSensitiveExtraFieldAndInvalidStatusReason() {
        val wire = WearReceiptCodec.encode(receipt, 0).toString(Charsets.UTF_8)
        assertThrows(IllegalArgumentException::class.java) {
            WearReceiptCodec.decode(wire.replace("\"status\"", "\"message\":\"secret\",\"status\"")
                .toByteArray(), 0)
        }
        assertThrows(IllegalArgumentException::class.java) {
            WearReceiptCodec.encode(receipt.copy(status = "accepted"), 0)
        }
        assertThrows(IllegalArgumentException::class.java) {
            WearReceiptCodec.decode(ByteArray(1025), 0)
        }
    }

    @Test fun matchesActionContractForNonemptyWhitespaceRequestId() {
        val value = receipt.copy(requestId = " ")
        assertEquals(value, WearReceiptCodec.decode(WearReceiptCodec.encode(value, 0), 0))
    }
}
