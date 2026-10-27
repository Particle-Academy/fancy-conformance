import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { deflateSync, inflateSync } from "node:zlib";

import { fixtureBytes, loadSuite, type FileRef } from "../src/index";

/*
 * canon() (suites/fine-print/SPEC.md section 3), written HERE from the spec,
 * independently of the PHP exporter that produced the goldens, and checked
 * against every writer-bytes row:
 *
 * - a raw-tier row's artifact is PHP's PDF: its sha256 and length are the
 *   golden, and canon() of it must give the golden canonSha256;
 * - a canon-tier row's artifact is canon(PHP's PDF). Its compressed original
 *   is not stored (PHP's deflate differs between zlib builds), so this test
 *   REBUILDS one: every FlateDecode stream deflated by NODE's zlib, a fresh
 *   xref, a fresh md5 ID. canon() of that must give back the artifact
 *   exactly. That is the claim the tier exists to make -- a different
 *   deflater, the same canonical bytes -- proven rather than asserted.
 *
 * Then one mutant per hazard, each with the EXACT set of rows it fails. A
 * mutant whose set goes empty is a hazard no row catches any more: add a row,
 * never delete the mutant.
 */

const SUITE = "fine-print/writer-bytes";
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const bytes = (s: string) => Buffer.from(s, "latin1");
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

interface Options {
  blankId: boolean;
  rewriteLength: boolean;
  inflate: boolean;
}

const FAITHFUL: Options = { blankId: true, rewriteLength: true, inflate: true };

/** canon(), from SPEC section 3. Throws on anything that is not writer output. */
function canon(pdf: Uint8Array, o: Options = FAITHFUL): Uint8Array {
  const s = latin1(pdf);
  let at = s.indexOf("1 0 obj\n");
  if (at < 0 || !s.startsWith("%PDF-")) throw new Error("canon: no header");
  const out: string[] = [s.slice(0, at)];
  const head = /^(\d+) 0 obj\n/;
  for (;;) {
    const m = head.exec(s.slice(at, at + 24));
    if (!m) break;
    at += m[0].length;
    const eol = s.indexOf("\n", at);
    if (eol < 0) throw new Error("canon: unterminated object");
    let line = s.slice(at, eol);
    out.push(m[0]);
    const len = /\/Length (\d+) >>$/.exec(line);
    if (len && s.slice(eol + 1, eol + 8) === "stream\n") {
      const n = Number(len[1]);
      let data = s.slice(eol + 8, eol + 8 + n);
      const after = eol + 8 + n;
      if (data.length !== n || s.slice(after, after + 18) !== "\nendstream\nendobj\n") {
        throw new Error("canon: stream length does not hold");
      }
      if (line.includes("/Filter /FlateDecode")) {
        if (o.inflate) data = latin1(inflateSync(bytes(data)));
        if (o.rewriteLength) line = `${line.slice(0, -len[0].length)}/Length ${data.length} >>`;
      }
      out.push(`${line}\nstream\n${data}\nendstream\nendobj\n`);
      at = after + 18;
      continue;
    }
    const end = s.indexOf("\nendobj\n", at);
    if (end < 0) throw new Error("canon: unterminated object");
    out.push(s.slice(at, end + 8));
    at = end + 8;
  }
  if (s.slice(at, at + 5) !== "xref\n") throw new Error("canon: no xref");
  const trailer = s.indexOf("trailer\n", at);
  const startxref = trailer < 0 ? -1 : s.indexOf("\nstartxref\n", trailer);
  if (startxref < 0 || !/^\nstartxref\n\d+\n%%EOF\n$/.test(s.slice(startxref))) throw new Error("canon: no trailer");
  let dict = s.slice(trailer + 8, startxref);
  if (o.blankId) dict = dict.replace(/\/ID \[<[0-9a-f]{32}> <[0-9a-f]{32}>\]/, "/ID [<> <>]");
  out.push(`trailer\n${dict}\n%%EOF\n`);
  return bytes(out.join(""));
}

/**
 * A writer-grammar PDF rebuilt from a canon artifact: FlateDecode streams
 * deflated by Node's zlib, offsets and the md5 ID recomputed the way
 * Writer/Pdf/PdfFile.php does.
 */
function uncanon(artifact: Uint8Array, level = 6): Uint8Array {
  const s = latin1(artifact);
  let at = s.indexOf("1 0 obj\n");
  let body = s.slice(0, at);
  const offsets: number[] = [];
  const head = /^(\d+) 0 obj\n/;
  for (;;) {
    const m = head.exec(s.slice(at, at + 24));
    if (!m) break;
    offsets.push(body.length);
    at += m[0].length;
    const eol = s.indexOf("\n", at);
    let line = s.slice(at, eol);
    const len = /\/Length (\d+) >>$/.exec(line);
    if (len && s.slice(eol + 1, eol + 8) === "stream\n") {
      const n = Number(len[1]);
      let data = s.slice(eol + 8, eol + 8 + n);
      if (line.includes("/Filter /FlateDecode")) {
        data = latin1(deflateSync(bytes(data), { level }));
        line = `${line.slice(0, -len[0].length)}/Length ${data.length} >>`;
      }
      body += `${m[0]}${line}\nstream\n${data}\nendstream\nendobj\n`;
      at = eol + 8 + n + 18;
      continue;
    }
    const end = s.indexOf("\nendobj\n", at);
    body += m[0] + s.slice(at, end + 8);
    at = end + 8;
  }
  const trailer = s.slice(at + "trailer\n".length, s.length - "\n%%EOF\n".length);
  const id = createHash("md5").update(bytes(body)).digest("hex");
  const xref = body.length;
  let out = `${body}xref\n0 ${offsets.length + 1}\n0000000000 65535 f\r\n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n\r\n`;
  out += `trailer\n${trailer.replace("/ID [<> <>]", `/ID [<${id}> <${id}>]`)}\nstartxref\n${xref}\n%%EOF\n`;
  return bytes(out);
}

interface Row {
  id: string;
  input: { tier: "raw" | "canon" };
  expected: { tier: string; sha256?: string; length?: number; canonSha256: string; canonLength?: number };
  artifacts: { pdf: FileRef };
}

const rows = () => loadSuite(SUITE).cases as unknown as Row[];

/** The ids a canon() variant gets WRONG. */
function failing(o: Options): string[] {
  const bad: string[] = [];
  for (const row of rows()) {
    const artifact = fixtureBytes(SUITE, row.artifacts.pdf);
    try {
      if (row.input.tier === "raw") {
        if (sha256(canon(artifact, o)) !== row.expected.canonSha256) bad.push(row.id);
      } else {
        const got = canon(uncanon(artifact), o);
        if (sha256(got) !== row.expected.canonSha256 || got.length !== row.expected.canonLength) bad.push(row.id);
      }
    } catch {
      bad.push(row.id);
    }
  }
  return bad;
}

test("the fine-print suites load with their exact row counts", () => {
  // A row QUIETLY LOST between the exporter and a loader is what this catches.
  // Move these numbers with a re-export, never to make a failure go away.
  const expected: Record<string, number> = {
    "fine-print/php-semantics": 90,
    "fine-print/writer-model": 57,
    "fine-print/writer-bytes": 51,
  };
  for (const [suite, n] of Object.entries(expected)) {
    const { manifest, cases } = loadSuite(suite);
    assert.equal(cases.length, n, suite);
    const fns = Object.keys(manifest.contract.functions ?? {});
    for (const c of cases) assert.ok(c.fn && fns.includes(c.fn), `${suite}/${c.id} names no declared function`);
  }
});

test("every raw-tier artifact is the golden PDF, and has no deflate at all", () => {
  let raw = 0;
  for (const row of rows()) {
    if (row.input.tier !== "raw") continue;
    const pdf = fixtureBytes(SUITE, row.artifacts.pdf);
    assert.equal(sha256(pdf), row.expected.sha256, row.id);
    assert.equal(pdf.length, row.expected.length, row.id);
    assert.ok(!latin1(pdf).includes("/FlateDecode"), `${row.id} is raw tier but deflates`);
    raw++;
  }
  assert.ok(raw >= 30, `only ${raw} raw-tier rows`);
});

test("every canon-tier artifact is canon() output with the golden digest", () => {
  let canonRows = 0;
  for (const row of rows()) {
    if (row.input.tier !== "canon") continue;
    const artifact = fixtureBytes(SUITE, row.artifacts.pdf);
    assert.equal(sha256(artifact), row.expected.canonSha256, row.id);
    assert.equal(artifact.length, row.expected.canonLength, row.id);
    assert.ok(latin1(artifact).includes("/ID [<> <>]"), row.id);
    canonRows++;
  }
  assert.ok(canonRows >= 10, `only ${canonRows} canon-tier rows`);
});

test("canon() written from the spec agrees with PHP's on every row, across a different deflater", () => {
  // The control. Without it the mutants below prove nothing.
  assert.deepEqual(failing(FAITHFUL), []);
});

test("two different deflates of one document differ raw and agree after canon()", () => {
  // The tier's whole claim, on the largest canon row: the compressed bytes are
  // not the contract. Without this, the control above could pass because the
  // rebuild happened to reproduce one particular deflater's output.
  const row = rows().find((r) => r.id.endsWith("-canonical-compressed"));
  assert.ok(row);
  const artifact = fixtureBytes(SUITE, row.artifacts.pdf);
  const fast = uncanon(artifact, 1);
  const best = uncanon(artifact, 9);
  assert.notEqual(sha256(fast), sha256(best), "levels 1 and 9 wrote the same bytes; the test proves nothing");
  assert.equal(sha256(canon(fast)), row.expected.canonSha256);
  assert.equal(sha256(canon(best)), row.expected.canonSha256);
});

test("mutant: the file ID is kept -- every row fails", () => {
  assert.deepEqual(failing({ ...FAITHFUL, blankId: false }), rows().map((r) => r.id));
});

test("mutant: /Length is not rewritten after inflating -- exactly the canon-tier rows fail", () => {
  const canonIds = rows().filter((r) => r.input.tier === "canon").map((r) => r.id);
  assert.deepEqual(failing({ ...FAITHFUL, rewriteLength: false }), canonIds);
});

test("mutant: streams are not inflated -- exactly the canon-tier rows fail", () => {
  const canonIds = rows().filter((r) => r.input.tier === "canon").map((r) => r.id);
  assert.deepEqual(failing({ ...FAITHFUL, inflate: false }), canonIds);
});
