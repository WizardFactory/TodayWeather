package net.wizardfactory.todayweather.core.storage

import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The reader against LevelDB files written by a minimal test writer that follows the on-disk format
 * (log records with masked CRC-32C, write batches, tables with prefix-compressed blocks, Snappy).
 */
class LevelDbReaderTest {
    private val origin = "_https://localhost".toByteArray() + 0
    private fun key(name: String) = origin + 1 + name.toByteArray(Charsets.ISO_8859_1)
    private fun utf16(s: String) = byteArrayOf(0) + s.toByteArray(Charsets.UTF_16LE)
    private fun latin1(s: String) = byteArrayOf(1) + s.toByteArray(Charsets.ISO_8859_1)

    @Test
    fun logRecordsDeletesAndFragmentsAcrossBlocks() {
        val dir = createTempDirectory().toFile()
        val big = "x".repeat(40_000) // spans two 32 KiB blocks: FIRST + LAST fragments
        File(dir, "000003.log").writeBytes(
            log(batch(1, put(key("cities"), utf16("[\"서울\"]")), put(key("units"), latin1("{}")))) +
                log(batch(3, put(key("cities"), utf16("[\"서울\",\"London\"]")), put(key("big"), latin1(big)))) +
                log(batch(5, delete(key("units")))),
        )
        val items = WebViewLocalStorage.read(dir)
        assertEquals("[\"서울\",\"London\"]", items["cities"])
        assertEquals(big, items["big"])
        assertNull(items["units"])
    }

    @Test
    fun corruptRecordIsSkipped() {
        val dir = createTempDirectory().toFile()
        val good = log(batch(1, put(key("a"), latin1("1"))))
        val bad = log(batch(2, put(key("a"), latin1("2")))).also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() }
        File(dir, "000005.log").writeBytes(good + bad)
        assertEquals("1", WebViewLocalStorage.read(dir)["a"])
    }

    @Test
    fun tablesUncompressedAndSnappyWithNewerLogOverride() {
        val dir = createTempDirectory().toFile()
        val entries = listOf("cityIndex" to "2", "cities" to "[\"명동\"]", "settingsInfo" to "{\"theme\":\"dark\"}")
            .sortedBy { it.first }.map { (k, v) -> key(k) to (if (v.any { it.code > 255 }) utf16(v) else latin1(v)) }
        File(dir, "000007.ldb").writeBytes(table(entries, seq = 10, snappy = false))
        File(dir, "000008.ldb").writeBytes(table(listOf(key("units") to latin1("{\"airUnit\":\"airkorea\"}".repeat(3))), seq = 11, snappy = true))
        File(dir, "000009.log").writeBytes(log(batch(20, put(key("cityIndex"), latin1("1")))))
        val items = WebViewLocalStorage.read(dir)
        assertEquals("1", items["cityIndex"])
        assertEquals("[\"명동\"]", items["cities"])
        assertEquals("{\"theme\":\"dark\"}", items["settingsInfo"])
        assertEquals("{\"airUnit\":\"airkorea\"}".repeat(3), items["units"])
    }

    @Test
    fun otherOriginsAndMissingDirectoryAreIgnored() {
        val dir = createTempDirectory().toFile()
        val fileOrigin = "_file://".toByteArray() + 0 + 1 + "cities".toByteArray()
        File(dir, "000003.log").writeBytes(log(batch(1, put(fileOrigin, latin1("old")))))
        assertEquals(emptyMap(), WebViewLocalStorage.read(dir))
        assertEquals(emptyMap(), WebViewLocalStorage.read(File(dir, "absent")))
    }

    @Test
    fun snappyCopyOperations() {
        // literal "abcd", then copy-1 (len 4, offset 4) and copy-2 (len 8, offset 8): "abcdabcdabcdabcd"
        val compressed = byteArrayOf(16, (3 shl 2).toByte()) + "abcd".toByteArray() +
            byteArrayOf(((0 shl 5) or (0 shl 2) or 1).toByte(), 4) + byteArrayOf(((7 shl 2) or 2).toByte(), 8, 0)
        assertEquals("abcdabcdabcdabcd", String(Snappy.decompress(compressed)))
    }

    // ---------------------------------------------------------------- minimal writer

    private sealed interface Op
    private class Put(val k: ByteArray, val v: ByteArray) : Op
    private class Del(val k: ByteArray) : Op
    private fun put(k: ByteArray, v: ByteArray): Op = Put(k, v)
    private fun delete(k: ByteArray): Op = Del(k)

    private fun varint(out: ByteArrayOutputStream, v: Long) {
        var x = v
        while (x >= 0x80) { out.write(((x and 0x7f) or 0x80).toInt()); x = x ushr 7 }
        out.write(x.toInt())
    }
    private fun fixed(out: ByteArrayOutputStream, v: Long, n: Int) { for (i in 0 until n) out.write(((v ushr (8 * i)) and 0xff).toInt()) }

    private fun batch(seq: Long, vararg ops: Op): ByteArray {
        val out = ByteArrayOutputStream()
        fixed(out, seq, 8); fixed(out, ops.size.toLong(), 4)
        for (op in ops) when (op) {
            is Put -> { out.write(1); varint(out, op.k.size.toLong()); out.write(op.k); varint(out, op.v.size.toLong()); out.write(op.v) }
            is Del -> { out.write(0); varint(out, op.k.size.toLong()); out.write(op.k) }
        }
        return out.toByteArray()
    }

    private var logPos = 0
    /** Log records for one batch, continuing the block position of the file being written. */
    private fun log(payload: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        var p = 0
        var first = true
        while (true) {
            val left = 32768 - logPos % 32768
            if (left < 7) { repeat(left) { out.write(0) }; logPos += left; continue }
            val n = minOf(payload.size - p, left - 7)
            val last = p + n == payload.size
            val type = when { first && last -> 1; first -> 2; last -> 4; else -> 3 }
            val header = byteArrayOf(type.toByte()) + payload.copyOfRange(p, p + n)
            fixed(out, Crc32c.mask(Crc32c.value(header, 0, header.size)), 4)
            fixed(out, n.toLong(), 2)
            out.write(header)
            logPos += 7 + n; p += n; first = false
            if (last) break
        }
        return out.toByteArray()
    }

    private fun blockOf(entries: List<Pair<ByteArray, ByteArray>>): ByteArray {
        val out = ByteArrayOutputStream()
        var prev = ByteArray(0)
        for ((k, v) in entries) {
            val shared = prev.indices.takeWhile { it < k.size && prev[it] == k[it] }.count()
            varint(out, shared.toLong()); varint(out, (k.size - shared).toLong()); varint(out, v.size.toLong())
            out.write(k, shared, k.size - shared); out.write(v)
            prev = k
        }
        fixed(out, 0, 4); fixed(out, 1, 4) // one restart point at 0
        return out.toByteArray()
    }

    /** A table with one data block and its index; Snappy blocks are written as literals. */
    private fun table(entries: List<Pair<ByteArray, ByteArray>>, seq: Long, snappy: Boolean): ByteArray {
        val out = ByteArrayOutputStream()
        fun writeBlock(raw: ByteArray): Pair<Long, Long> {
            val body = if (snappy) {
                val b = ByteArrayOutputStream(); varint(b, raw.size.toLong())
                var p = 0
                while (p < raw.size) { val n = minOf(60, raw.size - p); b.write((n - 1) shl 2); b.write(raw, p, n); p += n }
                b.toByteArray()
            } else raw
            val offset = out.size().toLong()
            out.write(body); out.write(if (snappy) 1 else 0); fixed(out, 0, 4)
            return offset to body.size.toLong()
        }
        val data = blockOf(entries.mapIndexed { i, (k, v) -> (k + tag(seq + i)) to v })
        val (dOff, dSize) = writeBlock(data)
        val handle = ByteArrayOutputStream().also { varint(it, dOff); varint(it, dSize) }.toByteArray()
        val (iOff, iSize) = writeBlock(blockOf(listOf((entries.last().first + tag(seq + entries.size)) to handle)))
        val footer = ByteArrayOutputStream()
        varint(footer, 0); varint(footer, 0); varint(footer, iOff); varint(footer, iSize)
        while (footer.size() < 40) footer.write(0)
        fixed(footer, 0xdb4775248b80fb57uL.toLong(), 8)
        out.write(footer.toByteArray())
        return out.toByteArray()
    }

    private fun tag(seq: Long) = ByteArrayOutputStream().also { fixed(it, (seq shl 8) or 1, 8) }.toByteArray()
}
