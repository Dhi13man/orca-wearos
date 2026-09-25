package dev.orca.wear.contract

import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class ActionByteAdmissionTest {
    @Test fun rejectsMalformedUtf8BeforeParsing() {
        for (bytes in listOf(byteArrayOf(0xc3.toByte()), byteArrayOf(0xc0.toByte(), 0xaf.toByte()),
            byteArrayOf(0xed.toByte(), 0xa0.toByte(), 0x80.toByte()))) {
            assertTrue(WearActionDecoder.decode(bytes, 0) is ActionAdmission.Rejected)
        }
    }

    @Test fun rejectsParserResourceExhaustionBeforeRecursiveJsonParsing() {
        assertTrue(WearActionDecoder.decode(ByteArray(8193), 0) is ActionAdmission.Rejected)
        val nested = "{\"a\":".repeat(1000) + "0" + "}".repeat(1000)
        assertTrue(WearActionDecoder.decode(nested, 0) is ActionAdmission.Rejected)
    }

    @Test fun rejectsAndroidCommentSyntaxBeforeItCanHideNesting() {
        for (prefix in listOf("/* \" */", "// \"\n", "# \"\n", "'")) {
            val attack = prefix + "{a:".repeat(1000) + "0" + "}".repeat(1000) + prefix
            assertFalse(WearActionDecoder.boundedNesting(attack))
            assertTrue(WearActionDecoder.decode(attack, 0) is ActionAdmission.Rejected)
        }
    }
}
