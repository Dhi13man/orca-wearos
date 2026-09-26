package expo.modules.orcawear

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.SystemClock
import android.provider.Settings
import java.io.File
import java.util.UUID

internal enum class WearActionInsertResult { INSERTED, DUPLICATE, CONFLICT, BUSY, RATE_LIMITED, STALE, REJECTED }
internal data class WearAdmissionTime(val elapsedMillis: Long, val bootCount: Int)

internal data class ClaimedWearAction(
    val bindingId: String,
    val requestId: String,
    val actionHash: String,
    val claimToken: String,
    val expiresAt: Long,
    val wire: ByteArray
)

internal class WearActionInbox(context: Context, private val admissionTime: (Long) -> WearAdmissionTime = {
    WearAdmissionTime(SystemClock.elapsedRealtime(),
        Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1))
}) : SQLiteOpenHelper(
    context, File(context.noBackupFilesDir, "orca-wear-actions.db").absolutePath, null, 2
) {
    override fun onConfigure(db: SQLiteDatabase) {
        db.execSQL("PRAGMA synchronous=FULL")
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE actions (
            binding_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            action_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            wire BLOB NOT NULL,
            claim_token TEXT,
            claim_until INTEGER,
            PRIMARY KEY(binding_id,request_id)
        )""")
        db.execSQL("CREATE INDEX actions_expiry ON actions(expires_at)")
        db.execSQL("""CREATE TABLE admission_events (
            binding_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            action_hash TEXT NOT NULL,
            action_class TEXT NOT NULL,
            boot_count INTEGER NOT NULL,
            elapsed_at INTEGER NOT NULL,
            PRIMARY KEY(binding_id,request_id)
        )""")
        db.execSQL("CREATE INDEX admission_window ON admission_events(binding_id,action_class,elapsed_at)")
        WearCommandJournal.onCreate(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) db.execSQL("""ALTER TABLE command_journal
            ADD COLUMN reconciliation_attempts INTEGER NOT NULL DEFAULT 0""")
    }

    fun insert(bindingId: String, requestId: String, actionName: String, actionHash: String,
        expiresAt: Long, wire: ByteArray, now: Long,
        metadata: WearEnvelopeMetadata? = null, stale: Boolean = false): WearActionInsertResult = transaction { db ->
        require(UUID.fromString(bindingId).toString() == bindingId)
        require(requestId.isNotBlank() && requestId.toByteArray(Charsets.UTF_8).size <= 256)
        require(actionHash.matches(Regex("[0-9a-f]{64}")))
        require(expiresAt > now && expiresAt - now <= 120_000)
        require(wire.size in 16..8192)
        require(!stale || metadata != null)
        if (metadata != null) require(metadata.bindingId == bindingId &&
            metadata.requestId == requestId && metadata.expiresAt == expiresAt &&
            metadata.kind == WearEnvelopeKind.ACTION)
        gc(db, now)
        val sampledTime = admissionTime(now)
        WearCommandJournal.prune(db, now, sampledTime)
        val existing = db.rawQuery(
            "SELECT action_hash FROM actions WHERE binding_id=? AND request_id=?",
            arrayOf(bindingId, requestId)
        ).use { if (it.moveToFirst()) it.getString(0) else null }
        if (existing != null) {
            return@transaction if (existing == actionHash) WearActionInsertResult.DUPLICATE
                else WearActionInsertResult.CONFLICT
        }
        val journaled = WearCommandJournal.read(db, bindingId, requestId)
        if (journaled != null) {
            return@transaction if (journaled.actionHash == actionHash) WearActionInsertResult.DUPLICATE
                else WearActionInsertResult.CONFLICT
        }
        val admittedHash = db.rawQuery(
            "SELECT action_hash FROM admission_events WHERE binding_id=? AND request_id=?",
            arrayOf(bindingId, requestId)
        ).use { if (it.moveToFirst()) it.getString(0) else null }
        if (admittedHash != null) {
            return@transaction if (admittedHash == actionHash) WearActionInsertResult.DUPLICATE
                else WearActionInsertResult.CONFLICT
        }
        fun rejected(reason: String, fallback: WearActionInsertResult): WearActionInsertResult =
            if (metadata != null && WearCommandJournal.rejectAdmission(db, metadata,
                actionName, actionHash, reason, now, sampledTime)) WearActionInsertResult.REJECTED
            else fallback
        if (stale) return@transaction rejected("stale", WearActionInsertResult.STALE)
        if (!pruneAdmissionEvents(db, sampledTime))
            return@transaction rejected("rate-limited", WearActionInsertResult.RATE_LIMITED)
        val total = count(db, null)
        val perBinding = count(db, bindingId)
        if (total >= 64 || perBinding >= 8)
            return@transaction rejected("busy", WearActionInsertResult.BUSY)
        val actionClass = actionClass(actionName)
        if (!rateAdmitted(db, bindingId, actionClass, sampledTime.elapsedMillis))
            return@transaction rejected("rate-limited", WearActionInsertResult.RATE_LIMITED)
        db.insertOrThrow("actions", null, ContentValues().apply {
            put("binding_id", bindingId)
            put("request_id", requestId)
            put("action_hash", actionHash)
            put("expires_at", expiresAt)
            put("wire", wire)
        })
        db.insertOrThrow("admission_events", null, ContentValues().apply {
            put("binding_id", bindingId)
            put("request_id", requestId)
            put("action_hash", actionHash)
            put("action_class", actionClass)
            put("boot_count", sampledTime.bootCount)
            put("elapsed_at", sampledTime.elapsedMillis)
        })
        WearActionInsertResult.INSERTED
    }

    fun claim(now: Long): ClaimedWearAction? = transaction { db ->
        gc(db, now)
        val record = db.rawQuery("""SELECT binding_id,request_id,action_hash,expires_at,wire
            FROM actions WHERE claim_until IS NULL OR claim_until<=?
            ORDER BY expires_at,binding_id,request_id LIMIT 1""", arrayOf(now.toString())).use {
            if (!it.moveToFirst()) null else ClaimedWearAction(
                it.getString(0), it.getString(1), it.getString(2), "", it.getLong(3), it.getBlob(4)
            )
        } ?: return@transaction null
        val token = UUID.randomUUID().toString()
        db.update("actions", ContentValues().apply {
            put("claim_token", token)
            put("claim_until", minOf(now + 15_000, record.expiresAt))
        }, "binding_id=? AND request_id=?", arrayOf(record.bindingId, record.requestId))
        record.copy(claimToken = token)
    }

    fun commitHandoff(bindingId: String, requestId: String, actionHash: String,
        claimToken: String, canonical: ByteArray, now: Long): WearJournalHandoff = transaction { db ->
        WearCommandJournal.handoff(db, bindingId, requestId, actionHash, claimToken,
            canonical, now, admissionTime(now))
    }

    fun journalRecord(bindingId: String, requestId: String): WearJournalRecord? =
        WearCommandJournal.read(readableDatabase, bindingId, requestId)

    fun pendingReceipts(): List<Pair<String, String>> =
        WearCommandJournal.pendingReceipts(readableDatabase)

    fun pendingReconciliation(now: Long): List<WearJournalRecovery> = transaction { db ->
        WearCommandJournal.claimReconciliation(db, now, admissionTime(now))
    }

    fun hasPendingReconciliation(): Boolean =
        WearCommandJournal.hasPendingReconciliation(readableDatabase)

    fun noteReceiptAttempt(record: WearJournalRecord): Boolean = transaction { db ->
        WearCommandJournal.noteReceiptAttempt(db, record)
    }

    fun markReceiptTransmitted(record: WearJournalRecord): Boolean = transaction { db ->
        WearCommandJournal.markReceiptTransmitted(db, record)
    }

    fun startEffect(bindingId: String, requestId: String, actionHash: String, now: Long): Boolean =
        transaction { db -> WearCommandJournal.startEffect(db, bindingId, requestId, actionHash,
            now, admissionTime(now)) }

    fun finishEffect(bindingId: String, requestId: String, actionHash: String,
        outcome: String, now: Long, reason: String? = null): Boolean = transaction { db ->
        WearCommandJournal.finish(db, bindingId, requestId, actionHash, outcome, reason,
            now, admissionTime(now))
    }

    fun removeBinding(bindingId: String): Int = transaction { db ->
        val removed = db.delete("actions", "binding_id=?", arrayOf(bindingId))
        db.delete("admission_events", "binding_id=?", arrayOf(bindingId))
        WearCommandJournal.removeBinding(db, bindingId)
        removed
    }

    fun prune(now: Long): Int = transaction { db ->
        WearCommandJournal.prune(db, now, admissionTime(now))
        gc(db, now)
    }

    private fun gc(db: SQLiteDatabase, now: Long): Int =
        db.delete("actions", "expires_at<=?", arrayOf(now.toString()))

    private fun pruneAdmissionEvents(db: SQLiteDatabase, time: WearAdmissionTime): Boolean {
        if (time.bootCount < 0 || time.elapsedMillis < 0) return false
        val priorBoot = db.rawQuery("SELECT boot_count FROM admission_events LIMIT 1", null).use {
            if (it.moveToFirst()) it.getInt(0) else null
        }
        if (priorBoot != null && priorBoot != time.bootCount) {
            if (time.elapsedMillis < 60_000) return false
            db.delete("admission_events", "boot_count!=?", arrayOf(time.bootCount.toString()))
        }
        db.delete("admission_events", "boot_count=? AND elapsed_at<=?",
            arrayOf(time.bootCount.toString(), (time.elapsedMillis - 60_000).toString()))
        return true
    }

    private fun actionClass(name: String): String = when (name) {
        "readHostPage", "readUsagePage", "readHostAgents", "readNotificationsPage", "openConversation",
        "renewConversation", "closeConversation" -> "read"
        "sendAgentMessage" -> "send"
        "refresh" -> "refresh"
        "requestPhoneHandoff" -> "handoff"
        else -> error("wear_action_unknown")
    }

    private fun rateAdmitted(db: SQLiteDatabase, bindingId: String, actionClass: String, elapsedNow: Long): Boolean {
        val events = db.rawQuery("""SELECT COUNT(*),MAX(elapsed_at),
            SUM(CASE WHEN elapsed_at>? THEN 1 ELSE 0 END)
            FROM admission_events WHERE binding_id=? AND action_class=?""",
            arrayOf((elapsedNow - 2_000).toString(), bindingId, actionClass)).use {
            it.moveToFirst()
            Triple(it.getLong(0), if (it.isNull(1)) null else it.getLong(1), it.getLong(2))
        }
        val global = db.rawQuery("SELECT COUNT(*) FROM admission_events", null).use {
            it.moveToFirst(); it.getLong(0)
        }
        if (global >= 4096) return false
        val latest = events.second
        return when (actionClass) {
            "read" -> events.first < 30 && events.third < 4
            "send" -> events.first < 10 && (latest == null || elapsedNow - latest >= 2_000)
            "refresh" -> latest == null || elapsedNow - latest >= 10_000
            "handoff" -> latest == null || elapsedNow - latest >= 5_000
            else -> error("wear_action_unknown")
        }
    }

    private fun count(db: SQLiteDatabase, bindingId: String?): Long = db.rawQuery(
        if (bindingId == null) "SELECT COUNT(*) FROM actions"
        else "SELECT COUNT(*) FROM actions WHERE binding_id=?",
        if (bindingId == null) null else arrayOf(bindingId)
    ).use { it.moveToFirst(); it.getLong(0) }

    private fun <T> transaction(operation: (SQLiteDatabase) -> T): T {
        val db = writableDatabase
        db.beginTransaction()
        return try {
            val result = operation(db)
            db.setTransactionSuccessful()
            result
        } finally { db.endTransaction() }
    }
}
