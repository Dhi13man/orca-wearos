package dev.orca.wear.contract

import org.json.JSONException
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

sealed class ActionAdmission {
    data class Accepted(val envelope: JSONObject, val canonical: String) : ActionAdmission()
    data class Rejected(val reason: String) : ActionAdmission()
}

object WearActionDecoder {
    fun decode(bytes: ByteArray, now: Long): ActionAdmission {
        if (bytes.size > ActionManifest.actionBytes) return reject("too-large")
        val serialized = try {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
        } catch (_: CharacterCodingException) { return reject("invalid-action") }
        return decode(serialized, now)
    }

    fun decode(serialized: String, now: Long): ActionAdmission {
        if (utf8Length(serialized) > ActionManifest.actionBytes) return reject("too-large")
        if (!boundedNesting(serialized)) return reject("invalid-action")
        val value = try { JSONObject(serialized) } catch (_: JSONException) { return reject("invalid-action") }
        val action = value.opt("action") as? String ?: return reject("invalid-action")
        val schema = ActionManifest.actions[action] ?: return reject("invalid-action")
        if (!exactKeys(value, ActionManifest.envelopeOrder) ||
            !revision(value.opt("schemaVersion")) || number(value, "schemaVersion") != ActionManifest.schemaVersion.toLong() ||
            !id(value.opt("bindingId")) || !id(value.opt("requestId")) || !id(value.opt("publisherEpoch")) ||
            !revision(value.opt("expectedRevision")) || !revision(value.opt("expiresAt"))) return reject("invalid-action")
        val target = value.opt("target") as? JSONObject ?: return reject("invalid-action")
        val payload = value.opt("payload") as? JSONObject ?: return reject("invalid-action")
        if (!fields(target, schema.target) || !fields(payload, schema.payload)) return reject("invalid-action")
        if (utf8Length(ordered(payload, schema.payload.keys)) > ActionManifest.payloadBytes) return reject("invalid-action")
        if (schema.sessionFenced) {
            if (!id(value.opt("targetPublicationEpoch")) || !revision(value.opt("targetSnapshotVersion"))) return reject("invalid-action")
        } else if (value.opt("targetPublicationEpoch") !== JSONObject.NULL || value.opt("targetSnapshotVersion") !== JSONObject.NULL) {
            return reject("invalid-action")
        }
        val canonical = ActionManifest.envelopeOrder.joinToString(",", "{", "}") { key ->
            val encoded = when (key) {
                "target" -> ordered(target, schema.target.keys)
                "payload" -> ordered(payload, schema.payload.keys)
                else -> encode(value.get(key))
            }
            quote(key) + ":" + encoded
        }
        if (canonical != serialized) return reject("noncanonical")
        if (number(value, "expiresAt") <= now) return reject("expired")
        return ActionAdmission.Accepted(value, canonical)
    }

    private fun reject(reason: String) = ActionAdmission.Rejected(reason)
    internal fun boundedNesting(value: String): Boolean {
        var depth = 0
        var quoted = false
        var escaped = false
        for (c in value) {
            if (quoted) {
                if (escaped) escaped = false
                else if (c == '\\') escaped = true
                else if (c == '"') quoted = false
            } else {
                when (c) {
                    '"' -> quoted = true
                    '[' -> return false
                    '{' -> { depth++; if (depth > 2) return false }
                    '}' -> { depth--; if (depth < 0) return false }
                    ':', ',', ' ', '\t', '\r', '\n', '-', '+', '.', 'e', 'E', 'n', 'u', 'l' -> {}
                    in '0'..'9' -> {}
                    else -> return false
                }
            }
        }
        return !quoted && depth == 0
    }
    private fun number(value: JSONObject, key: String) = (value.get(key) as Number).toLong()
    private fun revision(value: Any?): Boolean {
        if (value !is Number) return false
        val number = value.toDouble()
        return number.isFinite() && number >= 0 && number <= 9007199254740991.0 && number == number.toLong().toDouble()
    }
    private fun id(value: Any?) = value is String && value.isNotEmpty() && utf8Length(value) <= ActionManifest.idBytes
    private fun exactKeys(value: JSONObject, keys: Collection<String>) =
        value.length() == keys.size && keys.all { value.has(it) }

    private fun fields(value: JSONObject, schema: Map<String, List<String>>): Boolean {
        if (!exactKeys(value, schema.keys)) return false
        return schema.all { (key, rule) ->
            val field = value.get(key)
            when (rule.first()) {
                "id" -> id(field)
                "nullableId" -> field === JSONObject.NULL || id(field)
                "message" -> field is String && field.any { !jsWhitespace(it) } && utf8Length(field) <= ActionManifest.messageBytes
                else -> field is String && rule.contains(field)
            }
        }
    }

    private fun jsWhitespace(c: Char): Boolean = c in '\u0009'..'\u000d' || c == ' ' || c == '\u00a0' ||
        c == '\u1680' || c in '\u2000'..'\u200a' || c == '\u2028' || c == '\u2029' ||
        c == '\u202f' || c == '\u205f' || c == '\u3000' || c == '\ufeff'

    private fun ordered(value: JSONObject, keys: Collection<String>) =
        keys.joinToString(",", "{", "}") { quote(it) + ":" + encode(value.get(it)) }

    private fun encode(value: Any): String = when (value) {
        JSONObject.NULL -> "null"
        is String -> quote(value)
        is Number -> value.toLong().toString()
        else -> error("Validated action contains an unsupported value")
    }

    private fun quote(value: String): String = buildString {
        append('"')
        for (c in value) {
            when (c) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000c' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (c < ' ') append("\\u" + c.code.toString(16).padStart(4, '0')) else append(c)
            }
        }
        append('"')
    }

    private fun utf8Length(value: String): Int {
        var bytes = 0
        var index = 0
        while (index < value.length) {
            val code = value[index++].code
            bytes += when {
                code < 0x80 -> 1
                code < 0x800 -> 2
                code in 0xd800..0xdbff -> {
                    if (index >= value.length || value[index++].code !in 0xdc00..0xdfff) return Int.MAX_VALUE
                    4
                }
                code in 0xdc00..0xdfff -> return Int.MAX_VALUE
                else -> 3
            }
        }
        return bytes
    }
}
