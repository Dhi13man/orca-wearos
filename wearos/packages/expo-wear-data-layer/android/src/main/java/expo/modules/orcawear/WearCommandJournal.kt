package expo.modules.orcawear

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import dev.orca.wear.contract.ActionAdmission
import dev.orca.wear.contract.WearActionDecoder
import java.security.MessageDigest
import org.json.JSONObject

internal enum class WearJournalHandoff { RECORDED, ALREADY_RECORDED, CONFLICT, MISSING, FULL }

internal data class WearJournalRecord(val bindingId: String, val requestId: String,
    val actionHash: String, val actionName: String, val state: String, val expiresAt: Long,
    val reason: String?)

internal data class WearJournalRecovery(val bindingId: String, val requestId: String,
    val actionHash: String, val hostId: String, val state: String)

internal object WearCommandJournal {
    fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE command_journal (
            binding_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            action_hash TEXT NOT NULL,
            action_name TEXT NOT NULL,
            publisher_epoch TEXT NOT NULL,
            expected_revision INTEGER NOT NULL,
            target_publication_epoch TEXT,
            target_snapshot_version INTEGER,
            target_json TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('recorded','effect_started','accepted','rejected','unknown')),
            result_reason TEXT,
            reconciliation_attempts INTEGER NOT NULL DEFAULT 0,
            receipt_attempts INTEGER NOT NULL DEFAULT 0,
            receipt_transmitted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            recorded_boot_count INTEGER NOT NULL,
            recorded_elapsed_at INTEGER NOT NULL,
            effect_boot_count INTEGER,
            effect_elapsed_at INTEGER,
            terminal_boot_count INTEGER,
            terminal_elapsed_at INTEGER,
            PRIMARY KEY(binding_id,request_id)
        )""")
        db.execSQL("CREATE INDEX command_journal_state ON command_journal(binding_id,state)")
        db.execSQL("CREATE INDEX command_journal_age ON command_journal(updated_at)")
    }

    fun handoff(db: SQLiteDatabase, bindingId: String, requestId: String, actionHash: String,
        claimToken: String, canonical: ByteArray,
        now: Long, time: WearAdmissionTime): WearJournalHandoff {
        prune(db, now, time)
        val old = read(db, bindingId, requestId)
        if (old != null) return if (old.actionHash == actionHash) WearJournalHandoff.ALREADY_RECORDED
            else WearJournalHandoff.CONFLICT
        val pending = db.rawQuery("""SELECT action_hash,claim_token,expires_at FROM actions
            WHERE binding_id=? AND request_id=?""", arrayOf(bindingId, requestId)).use {
            if (it.moveToFirst()) Triple(it.getString(0), it.getString(1), it.getLong(2)) else null
        } ?: return WearJournalHandoff.MISSING
        if (pending.first != actionHash) return WearJournalHandoff.CONFLICT
        if (pending.second != claimToken || pending.third <= now) return WearJournalHandoff.MISSING
        val hash = MessageDigest.getInstance("SHA-256").digest(canonical).joinToString("") {
            "%02x".format(it.toInt() and 0xff)
        }
        if (hash != actionHash) return WearJournalHandoff.CONFLICT
        val admitted = WearActionDecoder.decode(canonical, now) as? ActionAdmission.Accepted
            ?: return WearJournalHandoff.CONFLICT
        val action = admitted.envelope
        if (action.getString("bindingId") != bindingId ||
            action.getString("requestId") != requestId ||
            action.getLong("expiresAt") != pending.third) return WearJournalHandoff.CONFLICT
        val total = db.rawQuery("SELECT COUNT(*) FROM command_journal", null).use {
            it.moveToFirst(); it.getLong(0)
        }
        val open = db.rawQuery("""SELECT COUNT(*) FROM command_journal
            WHERE binding_id=? AND state IN ('recorded','effect_started')""", arrayOf(bindingId)).use {
            it.moveToFirst(); it.getLong(0)
        }
        if (total >= 2000 || open >= 16) return WearJournalHandoff.FULL
        db.insertOrThrow("command_journal", null, ContentValues().apply {
            put("binding_id", bindingId)
            put("request_id", requestId)
            put("action_hash", actionHash)
            put("action_name", action.getString("action"))
            put("publisher_epoch", action.getString("publisherEpoch"))
            put("expected_revision", action.getLong("expectedRevision"))
            val targetEpoch = action.opt("targetPublicationEpoch")
            if (targetEpoch is String) put("target_publication_epoch", targetEpoch)
            val targetVersion = action.opt("targetSnapshotVersion")
            if (targetVersion is Number) put("target_snapshot_version", targetVersion.toLong())
            put("target_json", action.getJSONObject("target").toString())
            put("expires_at", pending.third)
            put("state", "recorded")
            put("created_at", now)
            put("updated_at", now)
            put("recorded_boot_count", time.bootCount)
            put("recorded_elapsed_at", time.elapsedMillis)
        })
        check(db.delete("actions", "binding_id=? AND request_id=? AND action_hash=? AND claim_token=?",
            arrayOf(bindingId, requestId, actionHash, claimToken)) == 1)
        return WearJournalHandoff.RECORDED
    }

    fun rejectAdmission(db: SQLiteDatabase, metadata: WearEnvelopeMetadata, actionName: String,
        actionHash: String, reason: String, now: Long, time: WearAdmissionTime): Boolean {
        require(WearReceiptCodec.validOutcome("rejected", reason))
        if (time.bootCount < 0 || time.elapsedMillis < 0) return false
        val total = db.rawQuery("SELECT COUNT(*) FROM command_journal", null).use {
            it.moveToFirst(); it.getLong(0)
        }
        if (total >= 2000) return false
        val rejected = db.rawQuery("""SELECT COUNT(*),
            SUM(CASE WHEN binding_id=? THEN 1 ELSE 0 END) FROM command_journal
            WHERE state='rejected' AND effect_boot_count IS NULL""",
            arrayOf(metadata.bindingId)).use {
            it.moveToFirst(); it.getLong(0) to it.getLong(1)
        }
        if (rejected.first >= 128 || rejected.second >= 32) return false
        db.insertOrThrow("command_journal", null, ContentValues().apply {
            put("binding_id", metadata.bindingId)
            put("request_id", metadata.requestId)
            put("action_hash", actionHash)
            put("action_name", actionName)
            put("publisher_epoch", metadata.publisherEpoch)
            put("expected_revision", metadata.revision)
            put("target_json", "{}")
            put("expires_at", metadata.expiresAt)
            put("state", "rejected")
            put("result_reason", reason)
            put("created_at", now)
            put("updated_at", now)
            put("recorded_boot_count", time.bootCount)
            put("recorded_elapsed_at", time.elapsedMillis)
            put("terminal_boot_count", time.bootCount)
            put("terminal_elapsed_at", time.elapsedMillis)
        })
        return true
    }

    fun read(db: SQLiteDatabase, bindingId: String, requestId: String): WearJournalRecord? = db.rawQuery(
        """SELECT action_hash,action_name,state,expires_at,result_reason FROM command_journal
            WHERE binding_id=? AND request_id=?""", arrayOf(bindingId, requestId)
    ).use { if (!it.moveToFirst()) null else WearJournalRecord(bindingId, requestId,
        it.getString(0), it.getString(1), it.getString(2), it.getLong(3),
        if (it.isNull(4)) null else it.getString(4)) }

    fun pendingReceipts(db: SQLiteDatabase): List<Pair<String, String>> = db.rawQuery(
        """SELECT binding_id,request_id FROM command_journal
            WHERE state IN ('accepted','rejected','unknown') AND receipt_transmitted=0
            ORDER BY receipt_attempts,updated_at,binding_id,request_id LIMIT 64""", null
    ).use { cursor -> buildList {
        while (cursor.moveToNext()) add(cursor.getString(0) to cursor.getString(1))
    } }

    fun pendingReconciliation(db: SQLiteDatabase): List<WearJournalRecovery> = db.rawQuery(
        """SELECT binding_id,request_id,action_hash,target_json,state FROM command_journal
            WHERE action_name='sendAgentMessage' AND
                (state='effect_started' OR (state='unknown' AND effect_boot_count IS NOT NULL))
            ORDER BY reconciliation_attempts,updated_at,binding_id,request_id LIMIT 1""", null
    ).use { cursor -> buildList {
        while (cursor.moveToNext()) add(WearJournalRecovery(
            cursor.getString(0), cursor.getString(1), cursor.getString(2),
            JSONObject(cursor.getString(3)).getString("hostId"), cursor.getString(4)
        ))
    } }

    fun claimReconciliation(db: SQLiteDatabase, now: Long, time: WearAdmissionTime): List<WearJournalRecovery> {
        db.execSQL("""UPDATE command_journal SET state='unknown',updated_at=?,
            terminal_boot_count=?,terminal_elapsed_at=? WHERE state='recorded' OR
                (state='effect_started' AND action_name!='sendAgentMessage')""",
            arrayOf(now, time.bootCount, time.elapsedMillis))
        val records = pendingReconciliation(db)
        for (record in records) db.execSQL("""UPDATE command_journal
            SET reconciliation_attempts=reconciliation_attempts+1
            WHERE binding_id=? AND request_id=?""", arrayOf(record.bindingId, record.requestId))
        return records
    }

    fun hasPendingReconciliation(db: SQLiteDatabase): Boolean = db.rawQuery(
        """SELECT 1 FROM command_journal WHERE state='recorded' OR
            (state='effect_started' AND action_name!='sendAgentMessage') OR
            (action_name='sendAgentMessage' AND
                (state='effect_started' OR
                    (state='unknown' AND effect_boot_count IS NOT NULL)))
            LIMIT 1""", null
    ).use { it.moveToFirst() }

    fun noteReceiptAttempt(db: SQLiteDatabase, record: WearJournalRecord): Boolean =
        db.compileStatement("""UPDATE command_journal SET receipt_attempts=receipt_attempts+1
            WHERE binding_id=? AND request_id=? AND action_hash=? AND state=?""").use {
            it.bindString(1, record.bindingId)
            it.bindString(2, record.requestId)
            it.bindString(3, record.actionHash)
            it.bindString(4, record.state)
            it.executeUpdateDelete() == 1
        }

    fun markReceiptTransmitted(db: SQLiteDatabase, record: WearJournalRecord): Boolean =
        db.update("command_journal", ContentValues().apply {
            put("receipt_transmitted", 1)
        }, "binding_id=? AND request_id=? AND action_hash=? AND state=? AND " +
            (if (record.reason == null) "result_reason IS NULL" else "result_reason=?"),
            if (record.reason == null) arrayOf(record.bindingId, record.requestId,
                record.actionHash, record.state) else arrayOf(record.bindingId, record.requestId,
                record.actionHash, record.state, record.reason)) == 1

    fun startEffect(db: SQLiteDatabase, bindingId: String, requestId: String,
        actionHash: String, now: Long, time: WearAdmissionTime): Boolean {
        prune(db, now, time)
        if (time.bootCount < 0 || time.elapsedMillis < 0) return false
        val recorded = db.rawQuery("""SELECT recorded_boot_count,recorded_elapsed_at,created_at,expires_at
            FROM command_journal WHERE binding_id=? AND request_id=? AND action_hash=? AND state='recorded'""",
            arrayOf(bindingId, requestId, actionHash)).use {
            if (it.moveToFirst()) listOf(it.getLong(0), it.getLong(1), it.getLong(2), it.getLong(3)) else null
        } ?: return false
        if (recorded[0] != time.bootCount.toLong() || time.elapsedMillis < recorded[1] ||
            time.elapsedMillis - recorded[1] >= recorded[3] - recorded[2]) return false
        val active = db.rawQuery("""SELECT COUNT(*) FROM command_journal
            WHERE binding_id=? AND state='effect_started'""", arrayOf(bindingId)).use {
            it.moveToFirst(); it.getLong(0)
        }
        if (active != 0L) return false
        return db.update("command_journal", ContentValues().apply {
            put("state", "effect_started")
            put("updated_at", now)
            put("effect_boot_count", time.bootCount)
            put("effect_elapsed_at", time.elapsedMillis)
        }, "binding_id=? AND request_id=? AND action_hash=? AND state='recorded' AND expires_at>?",
            arrayOf(bindingId, requestId, actionHash, now.toString())) == 1
    }

    fun finish(db: SQLiteDatabase, bindingId: String, requestId: String,
        actionHash: String, outcome: String, reason: String?, now: Long,
        time: WearAdmissionTime): Boolean {
        require(WearReceiptCodec.validOutcome(outcome, reason))
        val allowedState = if (outcome == "unknown") "state='effect_started'"
            else "(state='effect_started' OR (state='unknown' AND effect_boot_count IS NOT NULL))"
        return db.update("command_journal", ContentValues().apply {
            put("state", outcome)
            if (reason == null) putNull("result_reason") else put("result_reason", reason)
            put("receipt_attempts", 0)
            put("receipt_transmitted", 0)
            put("updated_at", now)
            put("terminal_boot_count", time.bootCount)
            put("terminal_elapsed_at", time.elapsedMillis)
        }, "binding_id=? AND request_id=? AND action_hash=? AND $allowedState",
            arrayOf(bindingId, requestId, actionHash)) == 1
    }

    fun removeBinding(db: SQLiteDatabase, bindingId: String): Int =
        db.delete("command_journal", "binding_id=?", arrayOf(bindingId))

    fun prune(db: SQLiteDatabase, now: Long, time: WearAdmissionTime) {
        db.execSQL("""UPDATE command_journal SET state='unknown',updated_at=?,
            terminal_boot_count=?,terminal_elapsed_at=?
            WHERE state='recorded' AND (expires_at<=? OR ?<0 OR recorded_boot_count!=? OR
                (? >= recorded_elapsed_at AND ? - recorded_elapsed_at >= expires_at - created_at))""",
            arrayOf(now, time.bootCount, time.elapsedMillis, now, time.bootCount,
                time.bootCount, time.elapsedMillis, time.elapsedMillis))
        if (time.bootCount >= 0 && time.elapsedMillis >= 86_400_000) {
            db.execSQL("""UPDATE command_journal SET state='unknown',updated_at=?,
                terminal_boot_count=?,terminal_elapsed_at=?
                WHERE state='effect_started' AND effect_boot_count>=0 AND effect_elapsed_at>=0 AND
                ((effect_boot_count=? AND effect_elapsed_at<=?) OR effect_boot_count!=?)""",
                arrayOf(now, time.bootCount, time.elapsedMillis, time.bootCount,
                    time.elapsedMillis - 86_400_000, time.bootCount))
        }
        if (time.bootCount >= 0 && time.elapsedMillis >= 30L * 86_400_000) {
            db.delete("command_journal", """state IN ('accepted','rejected','unknown') AND
                terminal_boot_count>=0 AND terminal_elapsed_at>=0 AND
                ((terminal_boot_count=? AND terminal_elapsed_at<=?) OR terminal_boot_count!=?)""",
                arrayOf(time.bootCount.toString(), (time.elapsedMillis - 30L * 86_400_000).toString(),
                    time.bootCount.toString()))
        }
    }
}
