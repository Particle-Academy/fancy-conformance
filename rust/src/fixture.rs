//! File references: `{"file": "fixtures/<name>", "sha256": "<hex>"}`.
//!
//! Bytes too large or too binary for a JSON cell live beside the suite, and a
//! case names them. The peer loaders lean on their platform for gunzip and
//! SHA-256; Rust's standard library has neither, and this crate takes no
//! third-party code (its only dependency is first-party `fancy-json`). So both
//! are here, written to RFC 1951 / 1952 and FIPS 180-4, and the shared trees in
//! `testdata/file-refs/` exercise every DEFLATE block type against digests
//! computed by the other three loaders' platforms.

use std::path::Path;

use fancy_json::{Map, Value};

use crate::Error;

/// Is this a file reference (well formed or not)?
///
/// An object whose `file` member is a STRING starting `fixtures/`. Any other
/// `file` member is ordinary data: a hostile document model carries
/// `{"type": "launch", "file": "calc.exe"}` for a writer to ignore, and a
/// loader that read it as a reference would refuse the row -- or hand an
/// implementation bytes where the model was.
#[must_use]
pub fn is_file_ref(value: &Value) -> bool {
    value
        .get("file")
        .and_then(Value::as_str)
        .is_some_and(|file| file.starts_with("fixtures/"))
        && value.as_object().is_some()
}

fn name_ok(file: &str) -> bool {
    let Some(name) = file.strip_prefix("fixtures/") else {
        return false;
    };
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    let allowed = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-';
    allowed(first) && chars.all(|c| allowed(c) || c == '.')
}

fn sha_ok(digest: &str) -> bool {
    digest.len() == 64
        && digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Why a reference is malformed, or `None`. The four loaders return these
/// exact sentences; `testdata/file-refs` pins them.
fn problem(object: &Map) -> Option<&'static str> {
    let mut keys: Vec<&str> = object.keys().collect();
    keys.sort_unstable();
    if keys != ["file", "sha256"] {
        return Some("it must have exactly the members file and sha256");
    }
    if !object
        .get("file")
        .and_then(Value::as_str)
        .is_some_and(name_ok)
    {
        return Some(
            "file must be fixtures/<name>, the name made of A-Z a-z 0-9 . _ - and not starting \
             with a dot",
        );
    }
    if !object
        .get("sha256")
        .and_then(Value::as_str)
        .is_some_and(sha_ok)
    {
        return Some("sha256 must be 64 lowercase hex digits");
    }
    None
}

/// Every reference in every row is well formed and its file exists, at LOAD
/// time, in input, expected and artifacts alike.
pub(crate) fn assert_file_refs(folder: &Path, suite: &str, rows: &[Value]) -> Result<(), Error> {
    fn walk(
        value: &Value,
        pointer: &str,
        folder: &Path,
        suite: &str,
        id: &str,
    ) -> Result<(), Error> {
        if let Some(object) = value.as_object().filter(|_| is_file_ref(value)) {
            if let Some(why) = problem(object) {
                return Err(Error::InvalidCases(format!(
                    "case \"{suite}/{id}\" has a malformed file reference at {pointer}: {why}."
                )));
            }
            let file = object.get("file").and_then(Value::as_str).unwrap_or("");
            if !folder.join(file).is_file() {
                return Err(Error::InvalidCases(format!(
                    "case \"{suite}/{id}\" references {file}, which does not exist in the suite \
                     directory."
                )));
            }
            return Ok(());
        }
        if let Some(items) = value.as_array() {
            for (index, item) in items.iter().enumerate() {
                walk(item, &format!("{pointer}/{index}"), folder, suite, id)?;
            }
        } else if let Some(object) = value.as_object() {
            for (key, item) in object.iter() {
                let escaped = key.replace('~', "~0").replace('/', "~1");
                walk(item, &format!("{pointer}/{escaped}"), folder, suite, id)?;
            }
        }
        Ok(())
    }

    for row in rows {
        let id = row.get("id").and_then(Value::as_str).unwrap_or("");
        for member in ["input", "expected", "artifacts"] {
            if let Some(value) = row.get(member) {
                walk(value, &format!("/{member}"), folder, suite, id)?;
            }
        }
    }
    Ok(())
}

/// The bytes a file reference names: read from the suite directory, gunzipped
/// when the name ends in `.gz`, and checked against the reference's sha256.
///
/// # Errors
///
/// [`Error::Fixture`] for a malformed reference, a `.gz` that is not a single
/// valid gzip member, or bytes that do not match the sha256. A fixture that is
/// not the bytes its row names must never be asserted against as if it were.
pub fn fixture_bytes(
    suite: &str,
    reference: &Value,
    root: Option<&Path>,
) -> Result<Vec<u8>, Error> {
    let Some(object) = reference.as_object() else {
        return Err(Error::Fixture(
            "malformed file reference: it must have exactly the members file and sha256."
                .to_string(),
        ));
    };
    if let Some(why) = problem(object) {
        return Err(Error::Fixture(format!("malformed file reference: {why}.")));
    }
    let file = object.get("file").and_then(Value::as_str).unwrap_or("");
    let want = object.get("sha256").and_then(Value::as_str).unwrap_or("");
    let path = crate::suite_path(suite, root)?.join(file);
    let mut bytes = std::fs::read(&path).map_err(|e| Error::Io(path.clone(), e))?;
    if file.ends_with(".gz") {
        bytes = gunzip(&bytes).map_err(|_| {
            Error::Fixture(format!(
                "suite \"{suite}\" fixture {file} is not a gzip file."
            ))
        })?;
    }
    let got = sha256_hex(&bytes);
    if got != want {
        return Err(Error::Fixture(format!(
            "suite \"{suite}\" fixture {file} does not match its sha256 (expected {want}, got \
             {got})."
        )));
    }
    Ok(bytes)
}

// ---------------------------------------------------------------- gzip (RFC 1952)

/// One gzip member, with its CRC-32 and length checked. Trailing data is an
/// error: a fixture is exactly one member.
///
/// # Errors
///
/// A short description of the first defect found.
pub fn gunzip(data: &[u8]) -> Result<Vec<u8>, &'static str> {
    if data.len() < 18 || data[0] != 0x1f || data[1] != 0x8b || data[2] != 8 {
        return Err("no gzip header");
    }
    let flags = data[3];
    if flags & 0xE0 != 0 {
        return Err("reserved flag set");
    }
    let mut at = 10;
    if flags & 0x04 != 0 {
        let extra = usize::from(*data.get(at).ok_or("truncated")?)
            | (usize::from(*data.get(at + 1).ok_or("truncated")?) << 8);
        at += 2 + extra;
    }
    for flag in [0x08, 0x10] {
        if flags & flag != 0 {
            let end = data
                .get(at..)
                .ok_or("truncated")?
                .iter()
                .position(|&b| b == 0)
                .ok_or("truncated")?;
            at += end + 1;
        }
    }
    if flags & 0x02 != 0 {
        at += 2;
    }
    let body = data.get(at..).ok_or("truncated")?;
    let (out, used) = inflate(body)?;
    let trailer = body.get(used..).ok_or("truncated")?;
    if trailer.len() != 8 {
        return Err("not exactly one member");
    }
    let crc = u32::from_le_bytes([trailer[0], trailer[1], trailer[2], trailer[3]]);
    let size = u32::from_le_bytes([trailer[4], trailer[5], trailer[6], trailer[7]]);
    // ISIZE is the length modulo 2^32, by definition.
    #[allow(clippy::cast_possible_truncation)]
    let length = out.len() as u32;
    if crc != crc32(&out) || size != length {
        return Err("checksum mismatch");
    }
    Ok(out)
}

fn crc32(data: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (n, slot) in (0u32..).zip(table.iter_mut()) {
        let mut c = n;
        for _ in 0..8 {
            c = if c & 1 == 1 {
                0xEDB8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
        }
        *slot = c;
    }
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc = table[((crc ^ u32::from(b)) & 0xFF) as usize] ^ (crc >> 8);
    }
    !crc
}

// ------------------------------------------------------------- DEFLATE (RFC 1951)

struct Bits<'a> {
    data: &'a [u8],
    pos: usize,
    buf: u32,
    count: u32,
}

impl Bits<'_> {
    fn take(&mut self, need: u32) -> Result<u32, &'static str> {
        let mut value = self.buf;
        while self.count < need {
            let byte = *self.data.get(self.pos).ok_or("truncated")?;
            self.pos += 1;
            value |= u32::from(byte) << self.count;
            self.count += 8;
        }
        self.buf = value >> need;
        self.count -= need;
        Ok(value & ((1u32 << need) - 1))
    }
}

struct Huffman {
    count: [u16; 16],
    symbol: Vec<u16>,
}

impl Huffman {
    fn new(lengths: &[u8]) -> Result<Self, &'static str> {
        let mut count = [0u16; 16];
        for &length in lengths {
            count[usize::from(length)] += 1;
        }
        let mut left: i32 = 1;
        for &n in &count[1..] {
            left = (left << 1) - i32::from(n);
            if left < 0 {
                return Err("over-subscribed code");
            }
        }
        let mut offset = [0u16; 16];
        for length in 1..15 {
            offset[length + 1] = offset[length] + count[length];
        }
        let mut symbol = vec![0u16; lengths.len()];
        for (s, &length) in (0u16..).zip(lengths) {
            if length != 0 {
                let slot = &mut offset[usize::from(length)];
                symbol[usize::from(*slot)] = s;
                *slot += 1;
            }
        }
        Ok(Self { count, symbol })
    }

    fn decode(&self, bits: &mut Bits<'_>) -> Result<u16, &'static str> {
        let (mut code, mut first, mut index) = (0i32, 0i32, 0i32);
        for &n in &self.count[1..] {
            #[allow(clippy::cast_possible_wrap)]
            let bit = bits.take(1)? as i32;
            code |= bit;
            let n = i32::from(n);
            if code - n < first {
                #[allow(clippy::cast_sign_loss)]
                return self
                    .symbol
                    .get((index + code - first) as usize)
                    .copied()
                    .ok_or("bad code");
            }
            index += n;
            first = (first + n) << 1;
            code <<= 1;
        }
        Err("bad code")
    }
}

const LENGTH_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258,
];
const LENGTH_EXTRA: [u8; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
];
const CODE_ORDER: [usize; 19] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/// A raw DEFLATE stream: the output, and how many input bytes it used (the
/// last partial byte counted, as the gzip trailer starts at the next byte).
///
/// # Errors
///
/// A short description of the first defect found.
pub fn inflate(data: &[u8]) -> Result<(Vec<u8>, usize), &'static str> {
    let mut bits = Bits {
        data,
        pos: 0,
        buf: 0,
        count: 0,
    };
    let mut out = Vec::new();
    loop {
        let last = bits.take(1)? == 1;
        match bits.take(2)? {
            0 => {
                bits.buf = 0;
                bits.count = 0;
                let header = data.get(bits.pos..bits.pos + 4).ok_or("truncated")?;
                let len = usize::from(u16::from_le_bytes([header[0], header[1]]));
                let nlen = usize::from(u16::from_le_bytes([header[2], header[3]]));
                if len != (!nlen & 0xFFFF) {
                    return Err("stored length mismatch");
                }
                bits.pos += 4;
                let block = data.get(bits.pos..bits.pos + len).ok_or("truncated")?;
                out.extend_from_slice(block);
                bits.pos += len;
            }
            1 => {
                let mut lengths = [0u8; 288];
                lengths[..144].fill(8);
                lengths[144..256].fill(9);
                lengths[256..280].fill(7);
                lengths[280..].fill(8);
                let literal = Huffman::new(&lengths)?;
                let distance = Huffman::new(&[5u8; 30])?;
                codes(&mut bits, &mut out, &literal, &distance)?;
            }
            2 => {
                let nlen = bits.take(5)? as usize + 257;
                let ndist = bits.take(5)? as usize + 1;
                let ncode = bits.take(4)? as usize + 4;
                if nlen > 286 || ndist > 30 {
                    return Err("bad counts");
                }
                let mut code_lengths = [0u8; 19];
                for &slot in &CODE_ORDER[..ncode] {
                    #[allow(clippy::cast_possible_truncation)]
                    let length = bits.take(3)? as u8;
                    code_lengths[slot] = length;
                }
                let code = Huffman::new(&code_lengths)?;
                let mut lengths = vec![0u8; nlen + ndist];
                let mut index = 0;
                while index < nlen + ndist {
                    let symbol = code.decode(&mut bits)?;
                    let (value, repeat) = match symbol {
                        0..=15 => {
                            #[allow(clippy::cast_possible_truncation)]
                            let length = symbol as u8;
                            (length, 1)
                        }
                        16 => {
                            let previous = *lengths
                                .get(index.wrapping_sub(1))
                                .filter(|_| index > 0)
                                .ok_or("repeat with no previous length")?;
                            (previous, 3 + bits.take(2)? as usize)
                        }
                        17 => (0, 3 + bits.take(3)? as usize),
                        _ => (0, 11 + bits.take(7)? as usize),
                    };
                    if index + repeat > nlen + ndist {
                        return Err("too many lengths");
                    }
                    lengths[index..index + repeat].fill(value);
                    index += repeat;
                }
                if lengths[256] == 0 {
                    return Err("no end-of-block code");
                }
                let literal = Huffman::new(&lengths[..nlen])?;
                let distance = Huffman::new(&lengths[nlen..])?;
                codes(&mut bits, &mut out, &literal, &distance)?;
            }
            _ => return Err("reserved block type"),
        }
        if last {
            return Ok((out, bits.pos));
        }
    }
}

fn codes(
    bits: &mut Bits<'_>,
    out: &mut Vec<u8>,
    literal: &Huffman,
    distance: &Huffman,
) -> Result<(), &'static str> {
    loop {
        let symbol = literal.decode(bits)?;
        if symbol < 256 {
            #[allow(clippy::cast_possible_truncation)]
            out.push(symbol as u8);
            continue;
        }
        if symbol == 256 {
            return Ok(());
        }
        let at = usize::from(symbol - 257);
        let length = usize::from(*LENGTH_BASE.get(at).ok_or("bad length symbol")?)
            + bits.take(u32::from(LENGTH_EXTRA[at]))? as usize;
        let at = usize::from(distance.decode(bits)?);
        let back = usize::from(*DIST_BASE.get(at).ok_or("bad distance symbol")?)
            + bits.take(u32::from(DIST_EXTRA[at]))? as usize;
        if back > out.len() {
            return Err("distance too far back");
        }
        let start = out.len() - back;
        for i in 0..length {
            out.push(out[start + i]);
        }
    }
}

// ---------------------------------------------------------- SHA-256 (FIPS 180-4)

const K: [u32; 64] = [
    0x428a_2f98,
    0x7137_4491,
    0xb5c0_fbcf,
    0xe9b5_dba5,
    0x3956_c25b,
    0x59f1_11f1,
    0x923f_82a4,
    0xab1c_5ed5,
    0xd807_aa98,
    0x1283_5b01,
    0x2431_85be,
    0x550c_7dc3,
    0x72be_5d74,
    0x80de_b1fe,
    0x9bdc_06a7,
    0xc19b_f174,
    0xe49b_69c1,
    0xefbe_4786,
    0x0fc1_9dc6,
    0x240c_a1cc,
    0x2de9_2c6f,
    0x4a74_84aa,
    0x5cb0_a9dc,
    0x76f9_88da,
    0x983e_5152,
    0xa831_c66d,
    0xb003_27c8,
    0xbf59_7fc7,
    0xc6e0_0bf3,
    0xd5a7_9147,
    0x06ca_6351,
    0x1429_2967,
    0x27b7_0a85,
    0x2e1b_2138,
    0x4d2c_6dfc,
    0x5338_0d13,
    0x650a_7354,
    0x766a_0abb,
    0x81c2_c92e,
    0x9272_2c85,
    0xa2bf_e8a1,
    0xa81a_664b,
    0xc24b_8b70,
    0xc76c_51a3,
    0xd192_e819,
    0xd699_0624,
    0xf40e_3585,
    0x106a_a070,
    0x19a4_c116,
    0x1e37_6c08,
    0x2748_774c,
    0x34b0_bcb5,
    0x391c_0cb3,
    0x4ed8_aa4a,
    0x5b9c_ca4f,
    0x682e_6ff3,
    0x748f_82ee,
    0x78a5_636f,
    0x84c8_7814,
    0x8cc7_0208,
    0x90be_fffa,
    0xa450_6ceb,
    0xbef9_a3f7,
    0xc671_78f2,
];

/// Lowercase hex SHA-256 of `data`.
#[must_use]
pub fn sha256_hex(data: &[u8]) -> String {
    let mut h: [u32; 8] = [
        0x6a09_e667,
        0xbb67_ae85,
        0x3c6e_f372,
        0xa54f_f53a,
        0x510e_527f,
        0x9b05_688c,
        0x1f83_d9ab,
        0x5be0_cd19,
    ];
    let mut message = data.to_vec();
    let bit_length = (data.len() as u64).wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_length.to_be_bytes());

    for chunk in message.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, word) in chunk.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choice = (e & f) ^ (!e & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(choice)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(majority);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (slot, value) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *slot = slot.wrapping_add(value);
        }
    }
    h.iter().map(|word| format!("{word:08x}")).collect()
}
