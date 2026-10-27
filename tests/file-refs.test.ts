import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  fixtureBytes,
  isFileRef,
  listSuites,
  loadSuite,
  loadSuiteFrom,
  type FileRef,
} from "../src/index";

/*
 * File references: `{"file": "fixtures/<name>", "sha256": "<hex>"}` anywhere in
 * a case's input, expected or artifacts.
 *
 * The trees under testdata/file-refs/ are SHARED with the PHP, Python and Rust
 * loader tests, and expected.json is the one statement of what each must do.
 * Written once by scripts/build-file-ref-testdata.py, so four loaders cannot
 * each test a private, slightly different idea of "malformed".
 */
const TESTDATA = fileURLToPath(new URL("../testdata/file-refs/", import.meta.url));
const EXPECTED = JSON.parse(readFileSync(`${TESTDATA}expected.json`, "utf8")) as Record<
  string,
  "ok" | "data" | { load?: string; bytes?: string }
>;

/** Every file reference in a row, depth first, document order. */
function refsIn(value: unknown, out: FileRef[] = []): FileRef[] {
  if (isFileRef(value)) {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) refsIn(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) refsIn(v, out);
  }
  return out;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("the shared file-reference trees: every loader verdict, from one table", () => {
  assert.ok(Object.keys(EXPECTED).length >= 19, "expected.json lost its rows");

  for (const [suite, want] of Object.entries(EXPECTED)) {
    if (want === "data") {
      const { cases } = loadSuiteFrom(TESTDATA, suite);
      assert.deepEqual(refsIn(cases.map((c) => [c.input, c.expected, c.artifacts])), [], `${suite} is data, not a reference`);
      continue;
    }
    if (want === "ok") {
      const { cases } = loadSuiteFrom(TESTDATA, suite);
      let resolved = 0;
      for (const c of cases) {
        for (const ref of refsIn([c.input, c.expected, c.artifacts])) {
          const bytes = fixtureBytes(suite, ref, TESTDATA);
          assert.equal(sha256(bytes), ref.sha256, `${suite}/${c.id} ${ref.file}`);
          resolved++;
        }
      }
      assert.equal(resolved, 8, "the ok suite holds eight references");
      continue;
    }

    if (want.load !== undefined) {
      assert.throws(() => loadSuiteFrom(TESTDATA, suite), (e: Error) => e.message.includes(want.load!), suite);
      continue;
    }

    const { cases } = loadSuiteFrom(TESTDATA, suite);
    const [ref] = refsIn(cases[0]?.input);
    assert.ok(ref, `${suite} carries no reference`);
    assert.throws(() => fixtureBytes(suite, ref, TESTDATA), (e: Error) => e.message.includes(want.bytes!), suite);
  }
});

test("the raw fixture survived checkout byte for byte (no CRLF rewrite)", () => {
  // Every byte value, then CR LF and LF. A checkout with core.autocrlf and no
  // .gitattributes rewrites the lone LF, and this is how that shows up.
  const bytes = readFileSync(`${TESTDATA}suites/ok/fixtures/raw.bin`);
  assert.equal(bytes.length, 259);
  assert.deepEqual([...bytes.subarray(256)], [13, 10, 10]);
});

test("a malformed reference names the case and the JSON pointer", () => {
  assert.throws(
    () => loadSuiteFrom(TESTDATA, "bad-in-expected"),
    /case "bad-in-expected\/0001-x" has a malformed file reference at \/expected\/0: /,
  );
  assert.throws(
    () => loadSuiteFrom(TESTDATA, "bad-in-artifacts"),
    /case "bad-in-artifacts\/0001-x" references fixtures\/absent\.bin, which does not exist/,
  );
});

test("fixtureBytes refuses a malformed reference handed to it directly", () => {
  assert.throws(
    () => fixtureBytes("ok", { file: "fixtures/../manifest.json", sha256: "0".repeat(64) }, TESTDATA),
    /malformed file reference/,
  );
});

test("every reference in the real suites resolves and matches its sha256", () => {
  // The loader already checks existence at load time; this reads the bytes, so
  // a fixture that drifted from the row naming it fails here and not in a
  // consumer's CI.
  let refs = 0;
  for (const suite of listSuites()) {
    for (const c of loadSuite(suite).cases) {
      for (const ref of refsIn([c.input, c.expected, c.artifacts])) {
        assert.equal(sha256(fixtureBytes(suite, ref)), ref.sha256, `${suite}/${c.id}`);
        refs++;
      }
    }
  }
  assert.ok(refs > 0, "no suite carries a file reference; the fine-print suites should");
});
