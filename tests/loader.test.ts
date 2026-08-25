import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  formatSummary,
  listSuites,
  loadSuite,
  loadSuiteFrom,
  runTable,
  suiteVersion,
} from "../src/index";

test("discovers every suite that has a manifest", () => {
  const suites = listSuites();

  assert.ok(suites.includes("shared/satisfies-range"));
  assert.ok(suites.includes("shared/decimal"));
  assert.ok(suites.includes("shared/strings"));
  assert.ok(suites.includes("shared/image-header"));
});

test("reports the suite collection's own version", () => {
  // A runner prints this so "we're on an old fixture set" is visible rather
  // than inferred.
  assert.match(suiteVersion(), /^\d+\.\d+\.\d+$/);
});

test("VERSION and package.json agree", () => {
  // The comment above used to say "if VERSION and package.json ever disagree,
  // the pin a consumer states in its README means nothing" -- and then asserted
  // only the FORMAT, so the invariant it named was checked by nobody. Two files
  // holding one number with nothing comparing them is the exact mechanism that
  // left every package in the documents family misreporting its own version at
  // runtime. It is one assertion.
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };

  assert.equal(
    pkg.version,
    suiteVersion(),
    "package.json and VERSION disagree; a consumer pinning one is not pinning the other",
  );
});

test("every manifest that carries this version agrees with VERSION", () => {
  // ENUMERATED, not listed. This test used to name its copies by hand — and the
  // fifth one, `rust/Cargo.toml`, was added to the repo on 2026-08-23 and never
  // added here, so it sat three releases behind while `cargo test` printed the
  // wrong suite version on every run.
  //
  // The comment beside that list read "adding a fifth means adding it to this
  // list, which is the point". The rule was written down, correctly, right next
  // to the code that failed to follow it. **Prose adjacent to a check is not the
  // check** — and a hand-maintained list is simply one more copy of the thing it
  // is supposed to be guarding, with the same failure mode.
  //
  // So the list is DISCOVERED. A sixth loader added tomorrow is covered without
  // anyone remembering, which is the only version of this that holds.
  //
  // Credit where due: the enumeration rule came from an agent building a parity
  // repo for another package family, who read the Cargo.toml miss and drew the
  // general conclusion I had not.
  const root = new URL("../", import.meta.url);

  /** Every place a version is DECLARED, found rather than recalled. */
  const declarations: Array<{ file: string; pattern: RegExp }> = [
    { file: "package.json", pattern: /"version"\s*:\s*"([^"]+)"/ },
    { file: "composer.json", pattern: /"version"\s*:\s*"([^"]+)"/ },
    { file: "python/pyproject.toml", pattern: /^version\s*=\s*"([^"]+)"/m },
    { file: "python/src/fancy_conformance/__init__.py", pattern: /^__version__\s*=\s*"([^"]+)"/m },
    { file: "rust/Cargo.toml", pattern: /^version\s*=\s*"([^"]+)"/m },
  ];

  let checked = 0;

  for (const { file, pattern } of declarations) {
    let text: string;
    try {
      text = readFileSync(new URL(file, root), "utf8");
    } catch {
      // A manifest that does not exist is not a failure — this repo may not
      // ship every ecosystem. A manifest that exists and DISAGREES is.
      continue;
    }

    const found = text.match(pattern);
    if (!found) continue; // present but declares no version of its own

    checked += 1;
    assert.equal(
      found[1],
      suiteVersion(),
      `${file} declares ${found[1]} but VERSION says ${suiteVersion()}`,
    );
  }

  // The vacuity guard. A discovery that finds nothing passes every assertion
  // above and proves nothing — which is exactly the failure this test is about.
  assert.ok(
    checked >= 4,
    `only ${checked} version declarations were found; discovery is broken`,
  );
});

test("every case carries the metadata a failure needs to be actionable", () => {
  for (const id of listSuites()) {
    const { cases } = loadSuite(id);
    assert.ok(cases.length > 0, `${id} has no cases`);

    for (const c of cases) {
      assert.match(c.id, /^\d{4}-/, `${id}/${c.id} is not numbered`);
      assert.ok(c.title.length > 0, `${id}/${c.id} has no title`);
      assert.match(c.since, /^\d+\.\d+\.\d+$/, `${id}/${c.id} has no since`);
      assert.notEqual(c.expected, undefined, `${id}/${c.id} expects nothing`);
    }
  }
});

test("case ids are unique and ordered within a suite", () => {
  // Ids appear in changelogs and in other repos' skip lists, so renumbering is
  // a breaking change. Ordering keeps a diff readable when a case is inserted.
  for (const id of listSuites()) {
    const ids = loadSuite(id).cases.map((c) => c.id);
    assert.deepEqual(ids, [...new Set(ids)], `${id} has duplicate case ids`);
    assert.deepEqual(ids, [...ids].sort(), `${id} case ids are out of order`);
  }
});

test("a skip without a reason is a load error, not a quiet pass", () => {
  // This is the whole thesis of the repository. `describe.skipIf(!HAS_PHP)`
  // returning green is the specific mechanism that hid two-way drift for
  // months in holy-sheet and dark-slide, so an unexplained skip must not be
  // representable.
  const root = writeThrowawaySuite("bad", [
    { id: "0001-x", title: "x", since: "0.1.0", input: {}, expected: 1, skip: { rust: "  " } },
  ]);

  // Exercised through the REAL loader, pointed at a throwaway tree — not
  // through a copy of the guard living in this file.
  assert.throws(
    () => loadSuiteFrom(root, "bad"),
    /skips rust with no reason/,
    "an empty skip reason must be rejected",
  );
});

test("a duplicate case id is a load error", () => {
  const root = writeThrowawaySuite("dup", [
    { id: "0001-x", title: "x", since: "0.1.0", input: {}, expected: 1 },
    { id: "0001-x", title: "y", since: "0.1.0", input: {}, expected: 2 },
  ]);

  assert.throws(() => loadSuiteFrom(root, "dup"), /duplicate case id/);
});

test("runTable counts pass, fail and skip separately", () => {
  const summary = runTable(
    "shared/satisfies-range",
    () => true, // always says yes — must fail exactly the false-expecting rows
    { language: "node" },
  );

  const expectedFalse = loadSuite("shared/satisfies-range").cases.filter(
    (c) => c.expected === false,
  ).length;

  assert.equal(summary.failed, expectedFalse);
  assert.equal(summary.passed, summary.results.length - expectedFalse);
  assert.equal(summary.ok, false);
});

test("a throwing implementation is a failure, not a crash", () => {
  const summary = runTable(
    "shared/satisfies-range",
    () => {
      throw new Error("boom");
    },
    { language: "node" },
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.passed, 0);
  assert.match(String(summary.results[0]?.actual), /threw: boom/);
});

test("the summary prints every skip by name and reason", () => {
  // A bare "3 skipped" reads identically to full coverage. The reason has to
  // be in the log, or the skip is invisible in exactly the situation where it
  // matters most.
  const summary = runTable("shared/satisfies-range", () => true, { language: "rust" });
  summary.results[0] = {
    id: "0001-caret-pre-1.0-patch",
    title: "t",
    status: "skip",
    reason: "the semver crate disagrees here",
  };
  summary.skipped = 1;

  const text = formatSummary(summary);
  assert.match(text, /SKIP 0001-caret-pre-1\.0-patch — the semver crate disagrees here/);
  assert.match(text, /fancy-conformance \d+\.\d+\.\d+/);
});

test("a well-formed skip loads and keeps its reason", () => {
  // The positive half of the two negative tests above. Without it they would
  // pass against a loader that rejected EVERY skip, which would be just as
  // broken and would look identical from the failing side.
  const root = writeThrowawaySuite("ok", [
    {
      id: "0001-x",
      title: "x",
      since: "0.1.0",
      input: {},
      expected: 1,
      skip: { rust: "no decimal type yet" },
    },
  ]);

  const { cases } = loadSuiteFrom(root, "ok");
  assert.equal(cases[0]?.skip?.rust, "no decimal type yet");
});

/** Write a throwaway suite tree so the real loader can be pointed at it. */
function writeThrowawaySuite(name: string, cases: unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), "conformance-"));
  mkdirSync(join(root, "suites", name), { recursive: true });
  writeFileSync(
    join(root, "suites", name, "manifest.json"),
    JSON.stringify({ suite: name, caseFormat: "table" }),
  );
  writeFileSync(join(root, "suites", name, "cases.json"), JSON.stringify({ suite: name, cases }));
  return root;
}

test("no golden carries an integer this REFERENCE LANGUAGE cannot represent", () => {
  // The mirror of `shared/value-equality/0210`, pointing the other way.
  //
  // There, PHP could not distinguish `[]` from `{}` — a distinction the other
  // three loaders assert, and one every PHP-authored golden would inherit if
  // PHP were the reference. Here the weak language is OURS: JavaScript numbers
  // are doubles, so an integer above 2^53 is silently rounded on the way in.
  //
  // `9007199254740993` parses to `...992` in Node while PHP and Python hold it
  // exactly — and JavaScript CANNOT DETECT ITS OWN ERROR, because comparing the
  // rounded value against the same literal is `true`: both sides round
  // identically. A golden carrying a chain block height, a nanosecond
  // timestamp or a snowflake id would therefore be WRONG THE MOMENT IT WAS
  // AUTHORED, and every implementation that "passed" would have matched a
  // corrupted expectation.
  //
  // The corpus is JSON on disk, so the check reads the TEXT. Parsing it here
  // would destroy the evidence with the very defect being looked for.
  const stripStrings = (json: string) => json.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const MAX_SAFE = 9007199254740991n;

  const offenders: string[] = [];

  for (const suite of listSuites()) {
    const file = new URL(`../suites/${suite}/cases.json`, import.meta.url);
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue; // a directory-format suite has no case table
    }

    for (const token of stripStrings(raw).matchAll(/-?\d+/g)) {
      const value = BigInt(token[0]);
      if (value > MAX_SAFE || value < -MAX_SAFE) {
        offenders.push(`${suite}: ${token[0]}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "A golden carries an integer outside JavaScript's safe range. The reference " +
      "language rounds it silently and cannot detect that it did, so the value " +
      "is wrong the moment it is written. Express it as a STRING and have each " +
      "implementation parse it, the way shared/decimal already does for its " +
      "numeric-string rows.",
  );
});
