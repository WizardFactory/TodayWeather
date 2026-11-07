package net.wizardfactory.todayweather.core.storage

import java.io.File

/**
 * Read-only reader for a LevelDB directory, enough to read the Cordova WebView's localStorage
 * (`app_webview/Default/Local Storage/leveldb`). It never opens the database through LevelDB, takes
 * no lock and writes nothing: it decodes the write-ahead logs (`*.log`) and the table files
 * (`*.ldb`, `*.sst`, uncompressed or Snappy) and keeps, for each key, the entry with the highest
 * sequence number. Corrupt log records (bad checksum) and unreadable tables are skipped.
 */
object LevelDbReader {
    private const val BLOCK_SIZE = 32768
    private const val TABLE_MAGIC = 0xdb4775248b80fb57uL

    /** Live key/value pairs of the database in [dir]; deleted keys are absent. */
    fun read(dir: File): Map<ByteKey, ByteArray> {
        val latest = HashMap<ByteKey, Pair<Long, ByteArray?>>()
        fun offer(key: ByteArray, seq: Long, value: ByteArray?) {
            val k = ByteKey(key)
            val old = latest[k]
            if (old == null || seq > old.first) latest[k] = seq to value
        }
        val files = dir.listFiles()?.sortedBy { it.name } ?: return emptyMap()
        for (f in files) {
            when {
                f.name.endsWith(".log") -> runCatching { readLog(f.readBytes(), ::offer) }
                f.name.endsWith(".ldb") || f.name.endsWith(".sst") -> runCatching { readTable(f.readBytes(), ::offer) }
            }
        }
        return latest.mapNotNull { (k, v) -> v.second?.let { k to it } }.toMap()
    }

    // ---------------------------------------------------------------- write-ahead log

    private fun readLog(data: ByteArray, offer: (ByteArray, Long, ByteArray?) -> Unit) {
        var pos = 0
        val record = java.io.ByteArrayOutputStream()
        while (pos + 7 <= data.size) {
            val blockLeft = BLOCK_SIZE - pos % BLOCK_SIZE
            if (blockLeft < 7) { pos += blockLeft; continue } // trailer padding
            val crc = u32(data, pos)
            val len = (data[pos + 4].toInt() and 0xff) or ((data[pos + 5].toInt() and 0xff) shl 8)
            val type = data[pos + 6].toInt() and 0xff
            if (type == 0 && len == 0) { pos += blockLeft; continue } // zero-filled preallocation
            if (pos + 7 + len > data.size) break
            val ok = Crc32c.unmask(crc) == Crc32c.value(data, pos + 6, 1 + len)
            val payload = data.copyOfRange(pos + 7, pos + 7 + len)
            pos += 7 + len
            if (!ok) { record.reset(); continue }
            when (type) {
                1 -> { record.reset(); applyBatch(payload, offer) } // FULL
                2 -> { record.reset(); record.write(payload) } // FIRST
                3 -> record.write(payload) // MIDDLE
                4 -> { record.write(payload); applyBatch(record.toByteArray(), offer); record.reset() } // LAST
            }
        }
    }

    /** WriteBatch: sequence (8), count (4), then put (1, key, value) / delete (0, key) records. */
    private fun applyBatch(b: ByteArray, offer: (ByteArray, Long, ByteArray?) -> Unit) {
        if (b.size < 12) return
        val seq = u64(b, 0)
        val count = u32(b, 8).toInt()
        val r = Cursor(b, 12)
        for (i in 0 until count) {
            when (b[r.pos++].toInt()) {
                1 -> { val k = r.slice(); val v = r.slice(); offer(k, seq + i, v) }
                0 -> { val k = r.slice(); offer(k, seq + i, null) }
                else -> return
            }
        }
    }

    // ---------------------------------------------------------------- table files

    private fun readTable(data: ByteArray, offer: (ByteArray, Long, ByteArray?) -> Unit) {
        if (data.size < 48 || u64(data, data.size - 8).toULong() != TABLE_MAGIC) return
        val footer = Cursor(data, data.size - 48)
        footer.varint(); footer.varint() // metaindex handle
        val indexOffset = footer.varint().toInt()
        val indexSize = footer.varint().toInt()
        val index = block(data, indexOffset, indexSize) ?: return
        for ((_, handle) in entries(index)) {
            val h = Cursor(handle, 0)
            val blockData = block(data, h.varint().toInt(), h.varint().toInt()) ?: continue
            for ((internalKey, value) in entries(blockData)) {
                if (internalKey.size < 8) continue
                val tag = u64(internalKey, internalKey.size - 8)
                val userKey = internalKey.copyOfRange(0, internalKey.size - 8)
                offer(userKey, tag ushr 8, if ((tag and 0xff) == 1L) value else null)
            }
        }
    }

    /** A block's contents after its trailer's compression byte; null for an unknown compression. */
    private fun block(data: ByteArray, offset: Int, size: Int): ByteArray? {
        if (offset < 0 || offset + size + 5 > data.size) return null
        val raw = data.copyOfRange(offset, offset + size)
        return when (data[offset + size].toInt()) {
            0 -> raw
            1 -> Snappy.decompress(raw)
            else -> null
        }
    }

    /** Key/value entries of a block, expanding shared key prefixes. */
    private fun entries(block: ByteArray): List<Pair<ByteArray, ByteArray>> {
        if (block.size < 4) return emptyList()
        val restarts = u32(block, block.size - 4).toInt()
        val end = block.size - 4 - 4 * restarts
        val out = ArrayList<Pair<ByteArray, ByteArray>>()
        var key = ByteArray(0)
        val c = Cursor(block, 0)
        while (c.pos < end) {
            val shared = c.varint().toInt()
            val nonShared = c.varint().toInt()
            val valueLen = c.varint().toInt()
            key = key.copyOfRange(0, shared) + block.copyOfRange(c.pos, c.pos + nonShared)
            c.pos += nonShared
            out += key to block.copyOfRange(c.pos, c.pos + valueLen)
            c.pos += valueLen
        }
        return out
    }

    // ---------------------------------------------------------------- helpers

    private class Cursor(val b: ByteArray, var pos: Int) {
        fun varint(): Long {
            var result = 0L
            var shift = 0
            while (true) {
                val x = b[pos++].toInt() and 0xff
                result = result or ((x and 0x7f).toLong() shl shift)
                if (x and 0x80 == 0) return result
                shift += 7
            }
        }
        fun slice(): ByteArray {
            val len = varint().toInt()
            return b.copyOfRange(pos, pos + len).also { pos += len }
        }
    }

    private fun u32(b: ByteArray, i: Int): Long =
        (b[i].toLong() and 0xff) or ((b[i + 1].toLong() and 0xff) shl 8) or
            ((b[i + 2].toLong() and 0xff) shl 16) or ((b[i + 3].toLong() and 0xff) shl 24)

    private fun u64(b: ByteArray, i: Int): Long = u32(b, i) or (u32(b, i + 4) shl 32)

    /** Byte-array key with value equality. */
    class ByteKey(val bytes: ByteArray) {
        override fun equals(other: Any?) = other is ByteKey && other.bytes.contentEquals(bytes)
        override fun hashCode() = bytes.contentHashCode()
    }
}

/** Snappy block decompression (the format LevelDB uses for compressed table blocks). */
object Snappy {
    fun decompress(src: ByteArray): ByteArray {
        var pos = 0
        var length = 0
        var shift = 0
        while (true) {
            val x = src[pos++].toInt() and 0xff
            length = length or ((x and 0x7f) shl shift)
            if (x and 0x80 == 0) break
            shift += 7
        }
        val out = ByteArray(length)
        var o = 0
        while (pos < src.size) {
            val tag = src[pos++].toInt() and 0xff
            when (tag and 3) {
                0 -> {
                    var len = tag ushr 2
                    if (len >= 60) {
                        val bytes = len - 59
                        len = 0
                        for (i in 0 until bytes) len = len or ((src[pos++].toInt() and 0xff) shl (8 * i))
                    }
                    len += 1
                    System.arraycopy(src, pos, out, o, len)
                    pos += len; o += len
                }
                1 -> {
                    val len = ((tag ushr 2) and 7) + 4
                    val offset = ((tag ushr 5) shl 8) or (src[pos++].toInt() and 0xff)
                    o = copy(out, o, offset, len)
                }
                2 -> {
                    val len = (tag ushr 2) + 1
                    val offset = (src[pos].toInt() and 0xff) or ((src[pos + 1].toInt() and 0xff) shl 8)
                    pos += 2
                    o = copy(out, o, offset, len)
                }
                else -> {
                    val len = (tag ushr 2) + 1
                    var offset = 0
                    for (i in 0 until 4) offset = offset or ((src[pos + i].toInt() and 0xff) shl (8 * i))
                    pos += 4
                    o = copy(out, o, offset, len)
                }
            }
        }
        require(o == length) { "snappy length mismatch" }
        return out
    }

    private fun copy(out: ByteArray, o: Int, offset: Int, len: Int): Int {
        require(offset in 1..o) { "bad snappy offset" }
        for (i in 0 until len) out[o + i] = out[o - offset + i] // may overlap
        return o + len
    }
}

/** CRC-32C (Castagnoli) with LevelDB's masking. */
object Crc32c {
    private val table = IntArray(256) { n ->
        var c = n
        repeat(8) { c = if (c and 1 != 0) (c ushr 1) xor 0x82f63b78.toInt() else c ushr 1 }
        c
    }

    fun value(b: ByteArray, off: Int, len: Int): Long {
        var c = -1
        for (i in off until off + len) c = table[(c xor b[i].toInt()) and 0xff] xor (c ushr 8)
        return (c.inv().toLong() and 0xffffffffL)
    }

    fun mask(crc: Long): Long = ((((crc ushr 15) or (crc shl 17)) and 0xffffffffL) + 0xa282ead8L) and 0xffffffffL

    fun unmask(masked: Long): Long {
        val rot = (masked - 0xa282ead8L) and 0xffffffffL
        return ((rot ushr 17) or (rot shl 15)) and 0xffffffffL
    }
}
