package expo.modules.orcawear

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.SystemClock
import android.provider.Settings
import java.io.File

internal enum class WearWatchActionInsert { INSERTED, DUPLICATE, CONFLICT, FULL }
internal data class StoredWearWatchAction(val bindingId: String, val requestId: String,
    val actionHash: String, val status: String, val reason: String?, val expiresAt: Long)

internal class WearWatchActionStore(context: Context, private val admissionTime: () -> WearAdmissionTime = {
    WearAdmissionTime(SystemClock.elapsedRealtime(),
        Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1))
}) : SQLiteOpenHelper(
    context, File(context.noBackupFilesDir, "orca-wear-watch-actions.db").absolutePath, null, 1
) {
    override fun onConfigure(db: SQLiteDatabase) { db.execSQL("PRAGMA synchronous=FULL") }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE watch_actions (
            binding_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            action_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            recorded_boot_count INTEGER NOT NULL,
            recorded_elapsed_at INTEGER NOT NULL,
            recorded_lifetime INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','unknown')),
            reason TEXT,
            terminal_boot_count INTEGER,
            terminal_elapsed_at INTEGER,
            PRIMARY KEY(binding_id,request_id)
        )""")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) =
        error("wear_watch_action_schema_unsupported")

    fun record(bindingId: String, requestId: String, actionHash: String,
        expiresAt: Long, now: Long): WearWatchActionInsert = transaction { db ->
        require(expiresAt > now && expiresAt - now <= 120_000)
        require(actionHash.matches(Regex("[0-9a-f]{64}")))
        val time = admissionTime()
        require(time.bootCount >= 0 && time.elapsedMillis >= 0)
        reconcile(db, time)
        val old = read(db, bindingId, requestId)
        if (old != null) return@transaction if (old.actionHash == actionHash)
            WearWatchActionInsert.DUPLICATE else WearWatchActionInsert.CONFLICT
        val counts = db.rawQuery("""SELECT COUNT(*),SUM(CASE WHEN binding_id=? AND status='pending' THEN 1 ELSE 0 END)
            FROM watch_actions""", arrayOf(bindingId)).use {
            it.moveToFirst(); it.getInt(0) to it.getInt(1)
        }
        if (counts.first >= 2000 || counts.second >= 8) return@transaction WearWatchActionInsert.FULL
        db.insertOrThrow("watch_actions", null, ContentValues().apply {
            put("binding_id", bindingId)
            put("request_id", requestId)
            put("action_hash", actionHash)
            put("expires_at", expiresAt)
            put("recorded_boot_count", time.bootCount)
            put("recorded_elapsed_at", time.elapsedMillis)
            put("recorded_lifetime", expiresAt - now)
            put("status", "pending")
        })
        WearWatchActionInsert.INSERTED
    }

    fun apply(receipt: WearReceipt, now: Long): Boolean = transaction { db ->
        val time = admissionTime()
        require(time.bootCount >= 0 && time.elapsedMillis >= 0)
        reconcile(db, time)
        val old = read(db, receipt.bindingId, receipt.requestId) ?: return@transaction false
        if (old.actionHash != receipt.actionHash || receipt.expiresAt <= now) return@transaction false
        if (old.status in setOf("accepted", "rejected")) return@transaction false
        if (old.status == "unknown" && receipt.status == "unknown") return@transaction false
        db.update("watch_actions", ContentValues().apply {
            put("status", receipt.status)
            if (receipt.reason == null) putNull("reason") else put("reason", receipt.reason)
            put("terminal_boot_count", time.bootCount)
            put("terminal_elapsed_at", time.elapsedMillis)
        }, "binding_id=? AND request_id=? AND action_hash=?",
            arrayOf(receipt.bindingId, receipt.requestId, receipt.actionHash)) == 1
    }

    fun markUnknown(bindingId: String, requestId: String): Boolean {
        val time = admissionTime()
        require(time.bootCount >= 0 && time.elapsedMillis >= 0)
        return writableDatabase.update("watch_actions", ContentValues().apply {
            put("status", "unknown")
            put("terminal_boot_count", time.bootCount)
            put("terminal_elapsed_at", time.elapsedMillis)
        },
            "binding_id=? AND request_id=? AND status='pending'",
            arrayOf(bindingId, requestId)) == 1
    }

    fun read(bindingId: String, requestId: String): StoredWearWatchAction? = transaction { db ->
        val time = admissionTime()
        require(time.bootCount >= 0 && time.elapsedMillis >= 0)
        reconcile(db, time)
        read(db, bindingId, requestId)
    }

    fun removeBinding(bindingId: String) {
        writableDatabase.delete("watch_actions", "binding_id=?", arrayOf(bindingId))
    }

    private fun reconcile(db: SQLiteDatabase, time: WearAdmissionTime) {
        db.execSQL("""UPDATE watch_actions SET status='unknown',terminal_boot_count=?,terminal_elapsed_at=?
            WHERE status='pending' AND (recorded_boot_count!=? OR recorded_elapsed_at>? OR
                (recorded_elapsed_at<=? AND ?-recorded_elapsed_at>=recorded_lifetime))""",
            arrayOf(time.bootCount, time.elapsedMillis, time.bootCount,
                time.elapsedMillis, time.elapsedMillis, time.elapsedMillis))
        if (time.elapsedMillis >= 30L * 86_400_000) {
            db.delete("watch_actions", """status!='pending' AND terminal_boot_count>=0 AND
                terminal_elapsed_at>=0 AND (terminal_boot_count!=? OR terminal_elapsed_at<=?)""",
                arrayOf(time.bootCount.toString(),
                    (time.elapsedMillis - 30L * 86_400_000).toString()))
        }
    }

    private fun read(db: SQLiteDatabase, bindingId: String, requestId: String): StoredWearWatchAction? =
        db.rawQuery("""SELECT action_hash,status,reason,expires_at FROM watch_actions
            WHERE binding_id=? AND request_id=?""", arrayOf(bindingId, requestId)).use {
            if (!it.moveToFirst()) null else StoredWearWatchAction(bindingId, requestId,
                it.getString(0), it.getString(1), if (it.isNull(2)) null else it.getString(2), it.getLong(3))
        }

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
