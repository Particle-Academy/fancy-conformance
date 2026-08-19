import assert from "node:assert/strict";
import { test } from "node:test";

import { type ConformanceCase, loadSuite, runTable } from "../src/index";

/**
 * Does the fixture table actually CATCH a wrong implementation?
 *
 * A golden table that every plausible implementation passes is decoration. The
 * suite's own claim — "a shared table asserted per-language is what stops
 * drift" — is only true if the table discriminates, so this file asserts that
 * it does, by running deliberately wrong implementations and requiring each to
 * fail the specific cases that exist to catch it.
 *
 * ## These probes are NOT reference implementations
 *
 * Nothing here is exported and nothing here is correct. They are mutants: each
 * one is a mistake a real implementation is likely to make, written out just
 * far enough to be run. The correct behaviour lives in the `expected` column of
 * the fixtures, and the shipped implementations live in their own repos.
 *
 * Requiring the EXACT set of failing ids, rather than "at least one failure",
 * is deliberate. A mutant that fails everything proves nothing about which case
 * did the catching, and would keep passing this test after the case that
 * matters was deleted.
 */

function idsFailedBy(suite: string, impl: (c: ConformanceCase) => unknown): string[] {
  return runTable(suite, impl, { language: "node" })
    .results.filter((r) => r.status === "fail")
    .map((r) => r.id)
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// shared/satisfies-range
// ─────────────────────────────────────────────────────────────────────────────

type Triple = [number, number, number];

function parse(v: string): Triple | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

function cmp(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return 0;
}

/** The shape all the range probes share; `tweak` is where each mutant differs. */
function rangeProbe(opts: {
  majorPattern?: string;
  rejectPrerelease?: boolean;
  caretZeroZeroPinsExactly?: boolean;
  caretIsMajorOnly?: boolean;
  unparseablePasses?: boolean;
}) {
  return (version: string, range: string): boolean => {
    const trimmed = range.trim();
    if (trimmed === "*" || trimmed === "") return true;

    const v = parse(version);
    if (!v) return false;

    if (opts.rejectPrerelease && /-/.test(version) && !/-/.test(trimmed)) return false;

    const digits = opts.majorPattern ?? "\\d+";

    for (const clause of trimmed.split("||").map((c) => c.trim())) {
      const re = new RegExp(`^(\\^|~|>=|>|<=|<|=)?\\s*v?(${digits})(?:\\.(\\d+))?(?:\\.(\\d+))?$`);
      const m = re.exec(clause);
      if (!m) {
        if (opts.unparseablePasses) return true;
        continue;
      }

      const op = m[1] ?? "=";
      const t: Triple = [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)];
      const c = cmp(v, t);
      const hasMinor = m[3] !== undefined;
      const hasPatch = m[4] !== undefined;

      let ok = false;
      switch (op) {
        case ">=": ok = c >= 0; break;
        case ">": ok = c > 0; break;
        case "<=": ok = c <= 0; break;
        case "<": ok = c < 0; break;
        case "=": ok = c === 0; break;
        case "~": ok = c >= 0 && v[0] === t[0] && v[1] === t[1]; break;
        case "^":
          if (opts.caretIsMajorOnly) {
            ok = c >= 0 && v[0] === t[0];
          } else if (t[0] === 0 && t[1] === 0 && hasPatch && opts.caretZeroZeroPinsExactly) {
            ok = c === 0;
          } else if (t[0] === 0) {
            ok = c >= 0 && v[0] === 0 && v[1] === t[1];
          } else {
            ok = c >= 0 && v[0] === t[0];
          }
          break;
      }
      void hasMinor;
      if (ok) return true;
    }

    return false;
  };
}

const runRange = (fn: (v: string, r: string) => boolean) => (c: ConformanceCase) =>
  fn(c.input.version as string, c.input.range as string);

test("the range table is satisfiable — a faithful probe passes every row", () => {
  // The control. Without it, every assertion below would also pass against a
  // table whose expectations are simply unreachable.
  const faithful = rangeProbe({});
  assert.deepEqual(idsFailedBy("shared/satisfies-range", runRange(faithful)), []);
});

test("the range table catches a standard-semver implementation", () => {
  // "Just use the semver crate" is the obvious way to write the Rust one, and
  // it disagrees on exactly two rows. This is THE case for pinning them: both
  // failures are silent in production — a node published as compatible that
  // then refuses to load, or one that loads when it should not.
  const standard = rangeProbe({ rejectPrerelease: true, caretZeroZeroPinsExactly: true });

  assert.deepEqual(idsFailedBy("shared/satisfies-range", runRange(standard)), [
    "0011-prerelease-included",
    "0012-caret-zero-zero",
  ]);
});

test("the range table catches a single-digit major regex", () => {
  const singleDigit = rangeProbe({ majorPattern: "\\d" });
  assert.deepEqual(idsFailedBy("shared/satisfies-range", runRange(singleDigit)), [
    "0016-two-digit-major-union",
  ]);
});

test("the range table catches a range parser that fails open", () => {
  // Treating anything unrecognised as permissive turns a typo in a manifest
  // into a node that loads on hosts it was never checked against.
  const failOpen = rangeProbe({ unparseablePasses: true });
  assert.deepEqual(idsFailedBy("shared/satisfies-range", runRange(failOpen)), [
    "0017-unparseable-fails-closed",
  ]);
});

test("the range table catches a caret that ignores the pre-1.0 rule", () => {
  const majorOnly = rangeProbe({ caretIsMajorOnly: true });
  assert.deepEqual(idsFailedBy("shared/satisfies-range", runRange(majorOnly)), [
    "0002-caret-pre-1.0-minor",
  ]);
});

// ─────────────────────────────────────────────────────────────────────────────
// shared/decimal
// ─────────────────────────────────────────────────────────────────────────────

/** The reference behaviour, ported from PHP, used as the control below. */
function formatFloatFaithful(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const s = v.toFixed(14);
  if (s.includes("e") || s.includes("E")) return expand(v);
  const trimmed = s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  return trimmed === "-0" ? "0" : trimmed;
}

/**
 * Plain-decimal expansion of a magnitude beyond toFixed's exponential cutoff.
 *
 * `BigInt(v)` on an integral double is EXACT, which is what this needs. The
 * obvious `v.toExponential(20)` is not: it gives 21 significant digits and then
 * pads with zeros, so 1e300 comes out as a round number — and the golden is not
 * a round number, because the nearest double to 1e300 is not 10^300. That
 * mistake produced the first red run of this file.
 */
function expand(v: number): string {
  return BigInt(v).toString();
}

function coerceFaithful(s: string): number {
  return Number(s);
}

function roundFaithful(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

const runDecimal =
  (fns: { format: (v: number) => string; coerce: (s: string) => number; round: (v: number) => number }) =>
  (c: ConformanceCase): unknown => {
    const value = c.input.value as never;
    switch (c.fn) {
      case "formatFloat":
        return fns.format(value);
      case "numericStringToNumber":
        return fns.coerce(value);
      case "roundMoney":
        return fns.round(value);
      default:
        throw new Error(`unknown fn ${String(c.fn)}`);
    }
  };

const FAITHFUL_DECIMAL = {
  format: formatFloatFaithful,
  coerce: coerceFaithful,
  round: roundFaithful,
};

test("the decimal table is satisfiable — a faithful probe passes every row", () => {
  assert.deepEqual(idsFailedBy("shared/decimal", runDecimal(FAITHFUL_DECIMAL)), []);
});

test("the decimal table catches JS Math.round on money", () => {
  // The live one. PHP round() is half-away-from-zero; Math.round() is
  // half-toward-positive-infinity. They agree on every positive value, which
  // is why fancy-mlm-js shipped as a documented "mirror" that is not one.
  const failed = idsFailedBy(
    "shared/decimal",
    runDecimal({ ...FAITHFUL_DECIMAL, round: (v) => Math.round(v) }),
  );

  assert.deepEqual(failed, [
    "0014-round-negative-half",
    "0015-round-negative-half-small",
    "0016-round-symmetry",
  ]);
});

test("the decimal table catches a floor-based rounding", () => {
  const failed = idsFailedBy(
    "shared/decimal",
    runDecimal({ ...FAITHFUL_DECIMAL, round: (v) => Math.floor(v + 0.5) }),
  );

  // Must catch the negative halves AND the below-half row, or a naive
  // "round half up" would slip through on the rows that happen to agree.
  assert.ok(failed.includes("0014-round-negative-half"));
  assert.ok(failed.includes("0015-round-negative-half-small"));
});

test("the decimal table catches toFixed with a blanket trailing-zero strip", () => {
  // The bug that wrote 1e300 into spreadsheets as 1e3.
  const failed = idsFailedBy(
    "shared/decimal",
    runDecimal({
      ...FAITHFUL_DECIMAL,
      format: (v) => (Number.isFinite(v) ? v.toFixed(14).replace(/0+$/, "").replace(/\.$/, "") : "0"),
    }),
  );

  assert.ok(failed.includes("0003-format-1e300"), "must catch the 1e300 exponent collapse");
  assert.ok(failed.includes("0004-format-1e21-boundary"), "must catch the 1e21 boundary");
});

test("the decimal table catches parseInt-style numeric-string coercion", () => {
  const failed = idsFailedBy(
    "shared/decimal",
    runDecimal({ ...FAITHFUL_DECIMAL, coerce: (s) => parseInt(s, 10) }),
  );

  assert.ok(failed.includes("0008-coerce-exponent"), "parseInt stops at the 'e'");
  assert.ok(failed.includes("0012-coerce-leading-dot"), "parseInt cannot read '.5'");
});

test("the decimal table catches an integer-max clamp", () => {
  // PHP's (int) and Rust/Go's i64 all clamp or wrap here.
  const failed = idsFailedBy(
    "shared/decimal",
    runDecimal({
      ...FAITHFUL_DECIMAL,
      coerce: (s) => Math.min(Number(s), 9223372036854775807),
    }),
  );

  assert.deepEqual(failed, ["0010-coerce-int-overflow"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// shared/strings
// ─────────────────────────────────────────────────────────────────────────────

interface Run {
  text: string;
  b: boolean;
  i: boolean;
  code: boolean;
}

function tokenizeProbe(text: string, opts: { nonAsciiBreaksRun?: boolean } = {}): Run[] {
  const runs: Run[] = [];
  let i = 0;
  let buf = "";
  let b = false;
  let it = false;
  const code = false;
  const isWord = (ch: string): boolean => /[a-zA-Z0-9_]/.test(ch);

  const flush = (): void => {
    if (buf !== "") {
      runs.push({ text: buf, b, i: it, code });
      buf = "";
    }
  };

  while (i < text.length) {
    const c = text[i]!;
    const next2 = text.slice(i, i + 2);

    if (c === "`") {
      flush();
      const end = text.indexOf("`", i + 1);
      if (end === -1) {
        buf += text.slice(i);
        i = text.length;
        continue;
      }
      runs.push({ text: text.slice(i + 1, end), b, i: it, code: true });
      i = end + 1;
      continue;
    }

    if (next2 === "**" || next2 === "__") {
      flush();
      b = !b;
      i += 2;
      continue;
    }

    if (c === "*" || c === "_") {
      const prev = i > 0 ? text[i - 1]! : " ";
      if ((it && isWord(prev)) || !it) {
        if (!it) {
          if (!isWord(prev) || prev === " ") {
            flush();
            it = true;
            i++;
            continue;
          }
        } else {
          flush();
          it = false;
          i++;
          continue;
        }
      }
    }

    // The mutant: a run boundary at every non-ASCII character. This is what an
    // implementation does when it segments on "is this a word character?" using
    // a byte-oriented or ASCII-only classifier.
    if (opts.nonAsciiBreaksRun && c.charCodeAt(0) > 127) {
      flush();
      runs.push({ text: c, b, i: it, code });
      i++;
      continue;
    }

    buf += c;
    i++;
  }

  flush();
  if (runs.length === 0) runs.push({ text: "", b: false, i: false, code: false });
  return runs;
}

const runStrings =
  (opts: { nonAsciiBreaksRun?: boolean }) =>
  (c: ConformanceCase): unknown =>
    tokenizeProbe(c.input.text as string, opts);

test("the strings table is satisfiable — a faithful probe passes every row", () => {
  assert.deepEqual(idsFailedBy("shared/strings", runStrings({})), []);
});

test("the strings table catches an ASCII-only run classifier", () => {
  // The forward-looking hazard, made concrete. PHP-by-byte and TS-by-UTF-16
  // agree today by accident; anything that treats non-ASCII as structurally
  // special immediately disagrees, and the CJK/emoji/accent rows say so.
  const failed = idsFailedBy("shared/strings", runStrings({ nonAsciiBreaksRun: true }));

  assert.ok(failed.includes("0002-cjk-heading-text"));
  assert.ok(failed.includes("0004-emoji-surrogate"));
  assert.ok(failed.includes("0006-marker-adjacent-cjk"));
  assert.ok(
    !failed.includes("0001-ascii-baseline"),
    "the ASCII control must still pass, or the mutant proves nothing about Unicode",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// shared/image-header
// ─────────────────────────────────────────────────────────────────────────────

interface SniffOpts {
  /** The live @particle-academy/last-word defect: advance 2 past a 0xFF fill byte. */
  fillByteAdvancesTwo?: boolean;
  /** The live particle-academy/last-word defect: keep walking past start-of-scan. */
  noSosStop?: boolean;
  /** Read the IHDR dimensions as uint16 instead of uint32. */
  dimsAsUint16?: boolean;
  /** Trust the PNG signature and read offsets 16/20 without checking the chunk name. */
  skipChunkNameCheck?: boolean;
  /** Accept a zero width or height as a size. */
  allowZeroDimensions?: boolean;
  /** Match only SOF0, missing every progressive JPEG. */
  onlySof0?: boolean;
}

/**
 * The shape all the image-header probes share; the flags are where each mutant
 * differs. With no flags this is the behaviour the goldens were taken from.
 */
function sniffProbe(opts: SniffOpts = {}) {
  return (c: ConformanceCase): unknown => {
    const bytes = new Uint8Array(Buffer.from(String((c.input as { base64: string }).base64), "base64"));

    const size = (w: number, h: number): unknown =>
      !opts.allowZeroDimensions && (w < 1 || h < 1) ? null : { width: w, height: h };

    // PNG
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length >= 24 && sig.every((b, i) => bytes[i] === b)) {
      const isIhdr =
        bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
      if (isIhdr || opts.skipChunkNameCheck) {
        const be32 = (o: number) =>
          ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;
        const be16 = (o: number) => (bytes[o + 2]! << 8) | bytes[o + 3]!;
        const read = opts.dimsAsUint16 ? be16 : be32;
        return size(read(16), read(20));
      }
      return null;
    }

    // JPEG
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let i = 2;
    while (i + 4 <= bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1]!;
      if (marker === 0xff) {
        // A fill byte. Advancing by 2 steps over the byte that IS the marker.
        i += opts.fillByteAdvancesTwo ? 2 : 1;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      if (marker === 0xd9) return null; // EOI
      if (marker === 0xda && !opts.noSosStop) return null; // SOS: what follows is entropy-coded

      const segLen = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      if (segLen < 2) return null;

      const isSof = opts.onlySof0
        ? marker === 0xc0
        : marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        if (i + 9 > bytes.length) return null;
        return size((bytes[i + 7]! << 8) | bytes[i + 8]!, (bytes[i + 5]! << 8) | bytes[i + 6]!);
      }
      i += 2 + segLen;
    }
    return null;
  };
}

/**
 * Run the probes as a language with no `skip` entries.
 *
 * Two cases here are skipped for `node` and `php` respectively, because those
 * are the two live divergences the suite records. Running the mutants as either
 * of those languages would silently drop the case that catches them, which is
 * the exact failure this file exists to rule out.
 */
function imageIdsFailedBy(impl: (c: ConformanceCase) => unknown): string[] {
  return runTable("shared/image-header", impl, { language: "rust" })
    .results.filter((r) => r.status === "fail")
    .map((r) => r.id)
    .sort();
}

test("the image-header table is passed by a faithful sniffer (the control)", () => {
  // Without this, every mutant below proves nothing: a table no implementation
  // can pass fails everything and would look maximally discriminating.
  assert.deepEqual(imageIdsFailedBy(sniffProbe()), []);
});

test("the image-header table catches a sniffer that advances 2 on a JPEG fill byte", () => {
  // The live defect in @particle-academy/last-word. Fill bytes before a marker
  // are legal (ITU T.81 B.1.1.2) and real encoders emit them.
  assert.deepEqual(imageIdsFailedBy(sniffProbe({ fillByteAdvancesTwo: true })), [
    "0011-jpeg-fill-bytes",
  ]);
});

test("the image-header table catches a sniffer that walks past start-of-scan", () => {
  // The live defect in particle-academy/last-word, and the worse of the two: a
  // null sniff falls back to a default size, a WRONG sniff is believed.
  assert.deepEqual(imageIdsFailedBy(sniffProbe({ noSosStop: true })), [
    "0012-jpeg-sos-before-sof",
  ]);
});

test("the image-header table catches uint16 PNG dimensions", () => {
  assert.deepEqual(imageIdsFailedBy(sniffProbe({ dimsAsUint16: true })), ["0003-png-large"]);
});

test("the image-header table catches a sniffer that does not check the IHDR chunk name", () => {
  // Reading offsets 16/20 off a PNG signature alone is reading whatever is at
  // that offset, not reading a header.
  assert.deepEqual(imageIdsFailedBy(sniffProbe({ skipChunkNameCheck: true })), [
    "0005-png-not-ihdr",
  ]);
});

test("the image-header table catches a sniffer that accepts a zero dimension", () => {
  assert.deepEqual(imageIdsFailedBy(sniffProbe({ allowZeroDimensions: true })), [
    "0006-png-zero-width",
  ]);
});

test("the image-header table catches a sniffer that only matches SOF0", () => {
  // Most photographs on the web are progressive JPEGs (SOF2).
  assert.deepEqual(imageIdsFailedBy(sniffProbe({ onlySof0: true })), ["0009-jpeg-progressive"]);
});

test("every suite has at least one case tagged as a known hazard", () => {
  // Cheap structural guard: a suite of only happy paths is a suite that will
  // pass forever. Each of these tables exists because something already broke.
  for (const id of [
    "shared/satisfies-range",
    "shared/decimal",
    "shared/strings",
    "shared/image-header",
  ]) {
    const tagged = loadSuite(id).cases.filter(
      (c) => c.tags?.some((t) => ["hazard", "non-standard", "edge", "live-divergence"].includes(t)),
    );
    assert.ok(tagged.length > 0, `${id} has no hazard-tagged case`);
  }
});
