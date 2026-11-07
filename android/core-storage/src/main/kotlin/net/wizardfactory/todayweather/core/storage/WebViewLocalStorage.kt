package net.wizardfactory.todayweather.core.storage

import android.database.sqlite.SQLiteDatabase
import java.io.File

/**
 * The Cordova WebView's `localStorage`, read from Chromium's LevelDB without opening it.
 *
 * Chromium stores each item under `_<origin>\u0000` followed by the encoded key, and each string with a
 * one-byte prefix: 0 for UTF-16LE, 1 for Latin-1. cordova-android 10+ serves the app from
 * `https://localhost`. The Cordova app writes localStorage first and mirrors it to the native suite
 * asynchronously, so localStorage holds the newest values; the suite can miss a write (observed on an
 * emulator: the second of two quick `cities` writes was lost).
 */
object WebViewLocalStorage {
    const val ORIGIN = "https://localhost"
    const val RELATIVE_DIR = "app_webview/Default/Local Storage/leveldb"

    /** WebView before Chromium 61 (still found on API 24–25 without WebView updates): one SQLite file per origin. */
    const val LEGACY_FILE = "app_webview/Local Storage/https_localhost_0.localstorage"

    /** The app's localStorage items from whichever store the installed WebView used; empty if none. */
    fun readAppData(dataDir: File): Map<String, String> {
        val leveldb = File(dataDir, RELATIVE_DIR)
        if (leveldb.isDirectory) return read(leveldb)
        val sqlite = File(dataDir, LEGACY_FILE)
        return if (sqlite.isFile) readSqlite(sqlite) else emptyMap()
    }

    /** `ItemTable(key TEXT, value BLOB)`, values in UTF-16LE; opened read-only. */
    fun readSqlite(file: File): Map<String, String> = runCatching {
        SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
            db.rawQuery("SELECT key, value FROM ItemTable", null).use { c ->
                buildMap { while (c.moveToNext()) put(c.getString(0), String(c.getBlob(1), Charsets.UTF_16LE)) }
            }
        }
    }.getOrDefault(emptyMap())

    fun read(dir: File, origin: String = ORIGIN): Map<String, String> {
        if (!dir.isDirectory) return emptyMap()
        val prefix = ("_" + origin).toByteArray(Charsets.ISO_8859_1) + 0
        return LevelDbReader.read(dir).mapNotNull { (key, value) ->
            val k = key.bytes
            if (k.size <= prefix.size || !k.copyOfRange(0, prefix.size).contentEquals(prefix)) return@mapNotNull null
            val name = decode(k.copyOfRange(prefix.size, k.size)) ?: return@mapNotNull null
            val text = decode(value) ?: return@mapNotNull null
            name to text
        }.toMap()
    }

    /** A Chromium localStorage string: prefix 0 = UTF-16LE, 1 = Latin-1. */
    fun decode(b: ByteArray): String? = when {
        b.isEmpty() -> null
        b[0].toInt() == 0 -> String(b, 1, b.size - 1, Charsets.UTF_16LE)
        b[0].toInt() == 1 -> String(b, 1, b.size - 1, Charsets.ISO_8859_1)
        else -> null
    }
}
