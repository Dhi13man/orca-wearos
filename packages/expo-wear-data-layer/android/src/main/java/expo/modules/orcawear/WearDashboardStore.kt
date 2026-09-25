package expo.modules.orcawear

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.File

internal data class StoredWearDashboard(val metadata: WearEnvelopeMetadata, val plaintext: ByteArray)
internal data class WearPublicationIntent(val bindingId: String, val revision: Long,
    val path: String, val expiresAt: Long, val state: String)
internal data class PublishedWearDashboard(val publisherEpoch: String, val revision: Long,
    val path: String, val expiresAt: Long)

internal class WearDashboardStore(context: Context) : SQLiteOpenHelper(
    context, File(context.noBackupFilesDir, "orca-wear-dashboard.db").absolutePath, null, 1
) {
    override fun onConfigure(db: SQLiteDatabase) { db.execSQL("PRAGMA synchronous=FULL") }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE dashboard (
            binding_id TEXT PRIMARY KEY NOT NULL,
            publisher_epoch TEXT NOT NULL,
            revision INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            plaintext BLOB NOT NULL CHECK(length(plaintext)<=32768)
        )""")
        db.execSQL("""CREATE TABLE revisions (
            binding_id TEXT PRIMARY KEY NOT NULL,
            next_revision INTEGER NOT NULL,
            last_started_revision INTEGER NOT NULL DEFAULT 0
        )""")
        db.execSQL("""CREATE TABLE publication_intents (
            binding_id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            path TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('pending','cleanup')),
            PRIMARY KEY(binding_id,revision)
        )""")
        db.execSQL("""CREATE TABLE published_dashboard (
            binding_id TEXT PRIMARY KEY NOT NULL,
            publisher_epoch TEXT NOT NULL,
            revision INTEGER NOT NULL,
            path TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        )""")
        db.execSQL("""CREATE TABLE cleanup_paths (
            binding_id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            path TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY(binding_id,revision)
        )""")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) =
        error("wear_dashboard_schema_unsupported")

    fun put(metadata: WearEnvelopeMetadata, plaintext: ByteArray, now: Long): Boolean {
        require(metadata.kind == WearEnvelopeKind.DASHBOARD && metadata.expiresAt > now)
        require(plaintext.size <= 32768)
        val db = writableDatabase
        db.beginTransaction()
        return try {
            val previous = readRow(db, metadata.bindingId)
            val newer = previous == null || metadata.revision > previous.metadata.revision
            if (newer) {
                db.insertWithOnConflict("dashboard", null, ContentValues().apply {
                    put("binding_id", metadata.bindingId)
                    put("publisher_epoch", metadata.publisherEpoch)
                    put("revision", metadata.revision)
                    put("expires_at", metadata.expiresAt)
                    put("plaintext", plaintext)
                }, SQLiteDatabase.CONFLICT_REPLACE)
            }
            db.setTransactionSuccessful()
            newer
        } finally { db.endTransaction() }
    }

    fun get(bindingId: String, now: Long): StoredWearDashboard? {
        val row = readRow(readableDatabase, bindingId) ?: return null
        if (row.metadata.expiresAt > now && row.plaintext.isNotEmpty()) return row
        writableDatabase.update("dashboard", ContentValues().apply { put("plaintext", ByteArray(0)) },
            "binding_id=? AND expires_at<=?", arrayOf(bindingId, now.toString()))
        return null
    }

    fun reserveRevision(bindingId: String): Long {
        val db = writableDatabase
        db.beginTransaction()
        return try {
            val prior = db.rawQuery("SELECT next_revision,last_started_revision FROM revisions WHERE binding_id=?",
                arrayOf(bindingId)).use {
                if (it.moveToFirst()) it.getLong(0) to it.getLong(1) else 0L to 0L
            }
            check(prior.first < 9_007_199_254_740_991L) { "wear_dashboard_revision_exhausted" }
            val next = prior.first + 1
            db.insertWithOnConflict("revisions", null, ContentValues().apply {
                put("binding_id", bindingId)
                put("next_revision", next)
                put("last_started_revision", prior.second)
            }, SQLiteDatabase.CONFLICT_REPLACE)
            db.setTransactionSuccessful()
            next
        } finally { db.endTransaction() }
    }

    fun isReserved(bindingId: String, revision: Long): Boolean = revision > 0 &&
        readableDatabase.rawQuery("SELECT next_revision FROM revisions WHERE binding_id=?", arrayOf(bindingId)).use {
            it.moveToFirst() && revision <= it.getLong(0)
        }

    fun publishedDashboard(bindingId: String): PublishedWearDashboard? = readableDatabase.rawQuery(
        "SELECT publisher_epoch,revision,path,expires_at FROM published_dashboard WHERE binding_id=?", arrayOf(bindingId)
    ).use { if (it.moveToFirst()) PublishedWearDashboard(it.getString(0), it.getLong(1),
        it.getString(2), it.getLong(3)) else null }

    fun publishedRevision(bindingId: String): Long = publishedDashboard(bindingId)?.revision ?: 0L

    fun nextPublishedExpiry(now: Long): Long? = readableDatabase.rawQuery(
        "SELECT min(expires_at) FROM published_dashboard WHERE expires_at>?", arrayOf(now.toString())
    ).use { if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null }

    fun markPublished(metadata: WearEnvelopeMetadata): String? {
        val db = writableDatabase
        db.beginTransaction()
        return try {
            val previous = db.rawQuery(
                "SELECT publisher_epoch,revision,path,expires_at FROM published_dashboard WHERE binding_id=?",
                arrayOf(metadata.bindingId)
            ).use { if (it.moveToFirst()) PublishedWearDashboard(it.getString(0), it.getLong(1),
                it.getString(2), it.getLong(3)) else null }
            val oldPath = if (previous != null && previous.revision < metadata.revision) previous.path else null
            if (previous == null || previous.revision < metadata.revision) {
                if (oldPath != null) {
                    check(addCleanupPath(db, metadata.bindingId, previous!!.revision, oldPath, previous.expiresAt)) {
                        "wear_cleanup_full"
                    }
                }
                db.insertWithOnConflict("published_dashboard", null, ContentValues().apply {
                    put("binding_id", metadata.bindingId)
                    put("publisher_epoch", metadata.publisherEpoch)
                    put("revision", metadata.revision)
                    put("path", metadata.path)
                    put("expires_at", metadata.expiresAt)
                }, SQLiteDatabase.CONFLICT_REPLACE)
            }
            db.setTransactionSuccessful()
            oldPath
        } finally { db.endTransaction() }
    }

    fun beginPublication(metadata: WearEnvelopeMetadata): Boolean {
        require(metadata.kind == WearEnvelopeKind.DASHBOARD && isReserved(metadata.bindingId, metadata.revision))
        val db = writableDatabase
        db.beginTransaction()
        return try {
            val count = db.rawQuery("SELECT count(*) FROM publication_intents", null).use {
                it.moveToFirst()
                it.getInt(0)
            }
            val started = db.rawQuery("SELECT last_started_revision FROM revisions WHERE binding_id=?",
                arrayOf(metadata.bindingId)).use { it.moveToFirst(); it.getLong(0) }
            val cleanupCount = db.rawQuery("SELECT count(*) FROM cleanup_paths", null).use {
                it.moveToFirst(); it.getInt(0)
            }
            val admitted = count < 8 && cleanupCount + count < 64 && metadata.revision > started &&
                metadata.revision > publishedRevision(metadata.bindingId) &&
                db.insertWithOnConflict("publication_intents", null,
                ContentValues().apply {
                    put("binding_id", metadata.bindingId)
                    put("revision", metadata.revision)
                    put("path", metadata.path)
                    put("expires_at", metadata.expiresAt)
                    put("state", "pending")
                }, SQLiteDatabase.CONFLICT_IGNORE) != -1L
            if (admitted) db.execSQL("UPDATE revisions SET last_started_revision=? WHERE binding_id=?",
                arrayOf<Any>(metadata.revision, metadata.bindingId))
            db.setTransactionSuccessful()
            admitted
        } finally { db.endTransaction() }
    }

    fun markPublicationCleanup(bindingId: String, revision: Long) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val intent = publicationIntent(bindingId, revision)
            if (intent != null) {
                check(addCleanupPath(db, bindingId, revision, intent.path, intent.expiresAt)) {
                    "wear_cleanup_full"
                }
                db.delete("publication_intents", "binding_id=? AND revision=?",
                    arrayOf(bindingId, revision.toString()))
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    fun cleanupPath(bindingId: String, revision: Long): String? = readableDatabase.rawQuery(
        "SELECT path FROM cleanup_paths WHERE binding_id=? AND revision=?",
        arrayOf(bindingId, revision.toString())
    ).use { if (it.moveToFirst()) it.getString(0) else null }

    fun finishCleanup(bindingId: String, revision: Long) {
        writableDatabase.delete("cleanup_paths", "binding_id=? AND revision=?",
            arrayOf(bindingId, revision.toString()))
    }

    fun cleanupPaths(): List<WearPublicationIntent> = readableDatabase.rawQuery(
        "SELECT binding_id,revision,path,expires_at FROM cleanup_paths ORDER BY binding_id,revision", null
    ).use { cursor -> buildList {
        while (cursor.moveToNext()) add(WearPublicationIntent(cursor.getString(0), cursor.getLong(1),
            cursor.getString(2), cursor.getLong(3), "cleanup"))
    } }

    fun pruneExpiredCleanup(now: Long) {
        writableDatabase.delete("cleanup_paths", "expires_at<=?", arrayOf(now.toString()))
    }

    fun nextCleanupExpiry(now: Long): Long? = readableDatabase.rawQuery(
        "SELECT min(expires_at) FROM cleanup_paths WHERE expires_at>?", arrayOf(now.toString())
    ).use { if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null }

    private fun addCleanupPath(db: SQLiteDatabase, bindingId: String, revision: Long,
        path: String, expiresAt: Long): Boolean {
        if (cleanupPath(bindingId, revision) != null) return true
        val count = db.rawQuery("SELECT count(*) FROM cleanup_paths", null).use {
            it.moveToFirst(); it.getInt(0)
        }
        if (count >= 64) return false
        return db.insertWithOnConflict("cleanup_paths", null, ContentValues().apply {
            put("binding_id", bindingId)
            put("revision", revision)
            put("path", path)
            put("expires_at", expiresAt)
        }, SQLiteDatabase.CONFLICT_IGNORE) != -1L
    }

    fun finishPublication(bindingId: String, revision: Long) {
        writableDatabase.delete("publication_intents", "binding_id=? AND revision=?",
            arrayOf(bindingId, revision.toString()))
    }

    fun publicationIntents(): List<WearPublicationIntent> = readableDatabase.rawQuery(
        "SELECT binding_id,revision,path,expires_at,state FROM publication_intents ORDER BY binding_id", null
    ).use { cursor ->
        buildList {
            while (cursor.moveToNext()) add(WearPublicationIntent(cursor.getString(0), cursor.getLong(1),
                cursor.getString(2), cursor.getLong(3), cursor.getString(4)))
        }
    }

    fun publicationIntent(bindingId: String, revision: Long): WearPublicationIntent? =
        readableDatabase.rawQuery(
            "SELECT path,expires_at,state FROM publication_intents WHERE binding_id=? AND revision=?",
            arrayOf(bindingId, revision.toString())
        ).use { cursor ->
            if (!cursor.moveToFirst()) null else WearPublicationIntent(bindingId, revision,
                cursor.getString(0), cursor.getLong(1), cursor.getString(2))
        }

    fun remove(bindingId: String) {
        writableDatabase.delete("dashboard", "binding_id=?", arrayOf(bindingId))
        writableDatabase.delete("revisions", "binding_id=?", arrayOf(bindingId))
        writableDatabase.delete("published_dashboard", "binding_id=?", arrayOf(bindingId))
    }

    private fun readRow(db: SQLiteDatabase, bindingId: String): StoredWearDashboard? =
        db.rawQuery("SELECT publisher_epoch,revision,expires_at,plaintext FROM dashboard WHERE binding_id=?",
            arrayOf(bindingId)).use { cursor ->
            if (!cursor.moveToFirst()) null else StoredWearDashboard(
                WearEnvelopeMetadata(bindingId, WearEnvelopeKind.DASHBOARD, cursor.getString(0),
                    cursor.getLong(1), "dashboard", cursor.getLong(2)), cursor.getBlob(3)
            )
        }
}
