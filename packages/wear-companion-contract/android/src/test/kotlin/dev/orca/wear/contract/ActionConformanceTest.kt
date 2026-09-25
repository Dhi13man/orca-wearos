package dev.orca.wear.contract

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

@RunWith(Parameterized::class)
class ActionConformanceTest(
    private val name: String,
    private val serialized: String,
    private val now: Long,
    private val accepted: Boolean
) {
    @Test fun admitsExactlyTheSharedWireContract() {
        val result = WearActionDecoder.decode(serialized, now)
        assertEquals(name, accepted, result is ActionAdmission.Accepted)
        assertEquals(name, accepted, WearActionDecoder.decode(serialized.toByteArray(Charsets.UTF_8), now) is ActionAdmission.Accepted)
        if (result is ActionAdmission.Accepted) assertEquals(serialized, result.canonical)
    }

    companion object {
        @JvmStatic @Parameterized.Parameters(name = "{0}")
        fun vectors(): List<Array<Any>> {
            val stream = ActionConformanceTest::class.java.getResourceAsStream("/action-vectors.json")!!
            val values = JSONArray(stream.bufferedReader(Charsets.UTF_8).use { it.readText() })
            return (0 until values.length()).map { index ->
                val vector = values.getJSONObject(index)
                arrayOf(vector.getString("name"), vector.getString("serialized"), vector.getLong("now"), vector.getBoolean("accepted"))
            }
        }
    }
}
