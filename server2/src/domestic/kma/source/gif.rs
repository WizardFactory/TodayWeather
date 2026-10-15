//! S15b-3c: GIF frames as legacy reads them.
//!
//! Legacy `get-pixels` 3.3.2 (`node-pixels.js` `handleGIF`) gives every frame its own zeroed
//! RGBA buffer of the logical screen and blits the frame into it with omggif 1.0.9
//! `GifReader.decodeAndBlitFrameRGBA` (`omggif.js` L366-L660, LZW L662-L804): no compositing with
//! earlier frames and no disposal; a transparent index leaves the pixel zero; a frame rectangle is
//! placed at its offset; interlaced rows follow omggif's pass arithmetic; a short stream leaves
//! index 0; writes outside the frame's buffer are dropped (a typed-array store) and a palette
//! read past the file is 0 (`undefined` stored in a `Uint8Array`); index stores past a frame's
//! index buffer are dropped too. This module is a direct port, except that a malformed stream
//! whose code chain cycles (omggif never returns on it) is an error.
//!
//! Decoding bounds (server2 only; legacy has none and a hostile image would exhaust its memory):
//! the frame descriptors are checked before any buffer exists. A GIF beyond them is an error, so
//! nothing is stored for it, as for any image legacy could not decode. The AirKorea forecast GIFs
//! of 2026-10-15 have 48-54 frames of 673×795 pixels (at most about 29 million in all).

/// At most this many frames.
pub const MAX_FRAMES: usize = 240;
/// At most this many pixels in one frame rectangle (its index buffer).
pub const MAX_FRAME_PIXELS: usize = 4 * 1024 * 1024;
/// At most this many frame pixels in all (the LZW work of a whole decode).
pub const MAX_TOTAL_PIXELS: usize = 64 * 1024 * 1024;

/// One frame descriptor (`frames[]` of the reader).
#[derive(Debug, Clone)]
struct Frame {
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    palette_offset: Option<usize>,
    data_offset: usize,
    transparent: Option<u8>,
    interlaced: bool,
}
/// A parsed GIF (`new GifReader(buf)`).
#[derive(Debug, Clone)]
pub struct GifReader<'a> {
    buf: &'a [u8],
    pub width: usize,
    pub height: usize,
    frames: Vec<Frame>,
}
fn at(buf: &[u8], p: usize) -> Result<u8, String> {
    buf.get(p)
        .copied()
        .ok_or_else(|| "truncated GIF".to_owned())
}
impl<'a> GifReader<'a> {
    pub fn new(buf: &'a [u8]) -> Result<Self, String> {
        let mut p = 0usize;
        let b = |p: usize| at(buf, p);
        if b(0)? != 0x47
            || b(1)? != 0x49
            || b(2)? != 0x46
            || b(3)? != 0x38
            || (b(4)?.wrapping_add(1) & 0xfd) != 0x38
            || b(5)? != 0x61
        {
            return Err("Invalid GIF 87a/89a header.".into());
        }
        p += 6;
        let width = usize::from(b(p)?) | usize::from(b(p + 1)?) << 8;
        let height = usize::from(b(p + 2)?) | usize::from(b(p + 3)?) << 8;
        let pf0 = b(p + 4)?;
        p += 7;
        let mut global_palette = None;
        if pf0 >> 7 == 1 {
            global_palette = Some(p);
            p += (1usize << ((pf0 & 7) + 1)) * 3;
        }
        let mut frames = Vec::new();
        let mut total_pixels = 0usize;
        let mut transparent: Option<u8> = None;
        loop {
            // `while (no_eof && p < buf.length)`.
            if p >= buf.len() {
                break;
            }
            let block = b(p)?;
            p += 1;
            match block {
                0x21 => {
                    let label = b(p)?;
                    p += 1;
                    match label {
                        0xff => {
                            let netscape = b(p)? == 0x0b
                                && b"NETSCAPE2.0"
                                    .iter()
                                    .enumerate()
                                    .all(|(i, c)| buf.get(p + 1 + i) == Some(c))
                                && buf.get(p + 12) == Some(&0x03)
                                && buf.get(p + 13) == Some(&0x01)
                                && buf.get(p + 16) == Some(&0);
                            // omggif's condition reads `!== 0x0b || NETSCAPE…`: a block whose size
                            // byte is not 11 takes the loop-counter branch too.
                            if b(p)? != 0x0b || netscape {
                                p += 14 + 2 + 1;
                            } else {
                                p += 12;
                                loop {
                                    let size = b(p)?;
                                    p += 1;
                                    if size == 0 {
                                        break;
                                    }
                                    p += usize::from(size);
                                }
                            }
                        }
                        0xf9 => {
                            if b(p)? != 0x4 || b(p + 5)? != 0 {
                                return Err("Invalid graphics extension block.".into());
                            }
                            let pf1 = b(p + 1)?;
                            transparent = (pf1 & 1 == 1).then_some(b(p + 4)?);
                            p += 6;
                        }
                        0xfe => loop {
                            let size = b(p)?;
                            p += 1;
                            if size == 0 {
                                break;
                            }
                            p += usize::from(size);
                        },
                        other => {
                            return Err(format!("Unknown graphic control label: 0x{other:x}"));
                        }
                    }
                }
                0x2c => {
                    let w16 = |i: usize| -> Result<usize, String> {
                        Ok(usize::from(b(p + i)?) | usize::from(b(p + i + 1)?) << 8)
                    };
                    let (x, y, w, h) = (w16(0)?, w16(2)?, w16(4)?, w16(6)?);
                    total_pixels += w * h;
                    if frames.len() >= MAX_FRAMES
                        || w * h > MAX_FRAME_PIXELS
                        || total_pixels > MAX_TOTAL_PIXELS
                    {
                        return Err("GIF beyond the decoding bounds".into());
                    }
                    let pf2 = b(p + 8)?;
                    p += 9;
                    let mut palette = global_palette;
                    if pf2 >> 7 == 1 {
                        palette = Some(p);
                        p += (1usize << ((pf2 & 7) + 1)) * 3;
                    }
                    let data_offset = p;
                    p += 1;
                    loop {
                        let size = b(p)?;
                        p += 1;
                        if size == 0 {
                            break;
                        }
                        p += usize::from(size);
                    }
                    frames.push(Frame {
                        x,
                        y,
                        width: w,
                        height: h,
                        palette_offset: palette,
                        data_offset,
                        transparent,
                        interlaced: pf2 >> 6 & 1 == 1,
                    });
                }
                0x3b => break,
                other => return Err(format!("Unknown gif block: 0x{other:x}")),
            }
        }
        Ok(Self {
            buf,
            width,
            height,
            frames,
        })
    }
    pub fn num_frames(&self) -> usize {
        self.frames.len()
    }
    /// `decodeAndBlitFrameRGBA(frame, pixels)` into `pixels` (the frame's own RGBA buffer of the
    /// logical screen; the caller zeroes it as get-pixels allocates it).
    pub fn decode_and_blit_rgba(&self, frame_num: usize, pixels: &mut [u8]) -> Result<(), String> {
        let frame = self
            .frames
            .get(frame_num)
            .ok_or("Frame index out of range.")?;
        let num_pixels = frame.width * frame.height;
        let mut index_stream = vec![0u8; num_pixels];
        lzw_output_index_stream(self.buf, frame.data_offset, &mut index_stream)?;
        let width = self.width;
        let trans: u16 = frame.transparent.map_or(256, u16::from);
        let framewidth = frame.width;
        let framestride = width as isize - framewidth as isize;
        let mut xleft = framewidth;
        let opbeg = ((frame.y * width + frame.x) * 4) as isize;
        let opend = (((frame.y + frame.height) * width + frame.x) * 4) as isize;
        let mut op = opbeg;
        let mut scanstride = framestride * 4;
        if frame.interlaced {
            scanstride += width as isize * 4 * 7;
        }
        let mut interlaceskip: isize = 8;
        // `buf[palette_offset + index * 3]`: a frame without any palette has a null offset, which
        // JavaScript adds as 0 (the bytes from the file start); a read past the file is 0.
        let palette = frame.palette_offset.unwrap_or(0);
        let mut rgba = [[0u8; 4]; 256];
        for (i, slot) in rgba.iter_mut().enumerate() {
            let byte = |k: usize| self.buf.get(palette + i * 3 + k).copied().unwrap_or(0);
            *slot = [byte(0), byte(1), byte(2), 255];
        }
        let len = pixels.len() as isize;
        for &index in &index_stream {
            if xleft == 0 {
                op += scanstride;
                xleft = framewidth;
                if op >= opend {
                    scanstride = framestride * 4 + width as isize * 4 * (interlaceskip - 1);
                    op = opbeg + (framewidth as isize + framestride) * (interlaceskip << 1);
                    interlaceskip >>= 1;
                }
            }
            if u16::from(index) != trans {
                let color = &rgba[usize::from(index)];
                if op >= 0 && op + 4 <= len {
                    let at = op as usize;
                    pixels[at..at + 4].copy_from_slice(color);
                } else {
                    // A typed-array store outside the frame's buffer is dropped.
                    for (k, v) in color.iter().enumerate() {
                        let o = op + k as isize;
                        if o >= 0 && o < len {
                            pixels[o as usize] = *v;
                        }
                    }
                }
            }
            op += 4;
            xleft -= 1;
        }
        Ok(())
    }
}
/// `GifReaderLZWOutputIndexStream(code_stream, p, output, output_length)`.
fn lzw_output_index_stream(stream: &[u8], mut p: usize, output: &mut [u8]) -> Result<(), String> {
    // A read past the end is `undefined` in omggif; `undefined << n` is 0 and a block size of
    // `undefined` ends the reads (`subblock_size === 0` is false, then `--undefined` is NaN).
    let get = |p: usize| stream.get(p).copied();
    let min_code_size = u32::from(get(p).ok_or("truncated GIF")?);
    p += 1;
    let clear_code: i32 = 1 << min_code_size;
    let eoi_code = clear_code + 1;
    let mut next_code = eoi_code + 1;
    let mut cur_code_size = min_code_size + 1;
    let mut code_mask: i32 = (1 << cur_code_size) - 1;
    let mut cur_shift: u32 = 0;
    let mut cur: i64 = 0;
    let mut op = 0usize;
    // `subblock_size`: Some(n) or the NaN of a read past the end (which never equals 0 or 1).
    let mut subblock: Option<u8> = get(p);
    p += 1;
    let mut nan_subblock = subblock.is_none();
    let mut code_table = vec![0i32; 4096];
    let mut prev_code: Option<i32> = None;
    let output_length = output.len();
    loop {
        while cur_shift < 16 {
            if !nan_subblock && subblock == Some(0) {
                break;
            }
            let byte = get(p).map_or(0, i64::from);
            p += 1;
            cur |= byte << cur_shift;
            cur_shift += 8;
            if !nan_subblock && subblock == Some(1) {
                subblock = get(p);
                p += 1;
                nan_subblock = subblock.is_none();
            } else if let Some(n) = subblock.as_mut() {
                *n -= 1;
            }
        }
        if cur_shift < cur_code_size {
            break;
        }
        let code = (cur & i64::from(code_mask)) as i32;
        cur >>= cur_code_size;
        cur_shift -= cur_code_size;
        if code == clear_code {
            next_code = eoi_code + 1;
            cur_code_size = min_code_size + 1;
            code_mask = (1 << cur_code_size) - 1;
            prev_code = None;
            continue;
        } else if code == eoi_code {
            break;
        }
        let chase_code = if code < next_code {
            Some(code)
        } else {
            prev_code
        };
        // `chase > clear_code` with a null prev_code: `null > n` is false.
        let mut chase_length = 0usize;
        let mut chase = chase_code;
        while let Some(c) = chase {
            if c <= clear_code {
                break;
            }
            chase = Some(code_table[(c & 4095) as usize] >> 8);
            chase_length += 1;
            // A code string is at most the table size long; a longer chain is a cycle of a
            // malformed stream, on which omggif never returns (review S15b3c-R6).
            if chase_length > 4096 {
                return Err("GIF LZW code cycle".into());
            }
        }
        // `k = chase`: a null chase stores 0 into the Uint8Array.
        let k = chase.map_or(0, |c| (c & 0xff) as u8);
        let emit_extra = chase_code != Some(code);
        let op_end = op + chase_length + usize::from(emit_extra);
        if op_end > output_length {
            return Ok(());
        }
        // Typed-array stores: a store past the index buffer is dropped (the length check above
        // admits `op_end == output_length`, so the first store can fall one past the end).
        if let Some(slot) = output.get_mut(op) {
            *slot = k;
        }
        op += 1;
        op += chase_length;
        let mut b = op;
        if emit_extra {
            if let Some(slot) = output.get_mut(op) {
                *slot = k;
            }
            op += 1;
        }
        let mut chase = chase_code;
        for _ in 0..chase_length {
            let entry = code_table[(chase.unwrap_or(0) & 4095) as usize];
            b -= 1;
            if let Some(slot) = output.get_mut(b) {
                *slot = (entry & 0xff) as u8;
            }
            chase = Some(entry >> 8);
        }
        if let Some(prev) = prev_code
            && next_code < 4096
        {
            code_table[next_code as usize] = prev << 8 | i32::from(k);
            next_code += 1;
            if next_code > code_mask && cur_code_size < 12 {
                cur_code_size += 1;
                code_mask = code_mask << 1 | 1;
            }
        }
        prev_code = Some(code);
    }
    Ok(())
}
