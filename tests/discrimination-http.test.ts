import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { deepEquals, fixtureBytes, loadSuite } from "../src/index";
import { type Mutations, run } from "./http-probe";

/**
 * Do the http/* rows CATCH a wrong implementation?
 *
 * The rows were authored from suites/http/SPEC.md before any implementation
 * existed (CC-fancy-0031). tests/http-probe.ts is a compact, mutable reading of
 * that spec:
 *
 *   - the CONTROL passes every row it can run (all but the `workbook` rows,
 *     which need holy-sheet); without it a mutant failing rows proves nothing;
 *   - each MUTANT is a mistake a port would plausibly make, and must fail
 *     EXACTLY the ids listed. A mutant whose set goes empty is a hazard no row
 *     catches any more: add a row, never delete the mutant.
 *
 * Ids are written as "<suite short>:<4-digit prefix>".
 */

const SUITES = ["http/error-envelope", "http/request-guards"] as const;
const short = (s: string) => (s === "http/error-envelope" ? "env" : "req");

function failed(m: Mutations): string[] {
  const out: string[] = [];
  for (const suite of SUITES) {
    for (const c of loadSuite(suite).cases) {
      if (c.fn === "workbook") continue;
      const resolve = (ref: unknown) => fixtureBytes(suite, ref as Parameters<typeof fixtureBytes>[1]);
      let actual: unknown;
      try {
        actual = run(c.fn!, c.input, resolve, m);
      } catch (e) {
        actual = { threw: String(e) };
      }
      if (!deepEquals(actual, c.expected)) out.push(`${short(suite)}:${c.id.slice(0, 4)}`);
    }
  }
  return out.sort();
}

test("control: the faithful probe passes every row it can run", () => {
  assert.deepEqual(failed({}), []);
});

test("the probe skips only the workbook rows, and there are six", () => {
  const wb = loadSuite("http/request-guards").cases.filter((c) => c.fn === "workbook");
  assert.equal(wb.length, 6);
});

const MUTANTS: Record<string, string[]> = JSON.parse(
  readFileSync(new URL("./discrimination-http.expected.json", import.meta.url), "utf8"),
);

for (const [name, ids] of Object.entries(MUTANTS)) {
  test(`mutant ${name} fails exactly its rows`, () => {
    const got = failed({ [name]: true });
    assert.ok(got.length > 0, `${name} fails nothing: a hazard no row catches`);
    assert.deepEqual(got, ids);
  });
}

test("every mutation the probe knows is pinned", () => {
  const known = [
    "assignsFields",
    "halfEven",
    "retryRoundsDown",
    "utf16Cap",
    "echo5xx",
    "trustInboundId",
    "depthOffByOne",
    "arraysOnly",
    "missesNaNToken",
    "missesOverflow",
    "trustContentLength",
    "readsBeforeRefusing",
    "scansOnlyDeclaredJson",
    "rewrites409",
    "echoCrash",
    "echoHttp5xx",
    "noPartFloor",
  ];
  assert.deepEqual(Object.keys(MUTANTS).sort(), [...known].sort());
});

test("every envelope a row expects satisfies envelope.schema.json", async () => {
  const { validate } = await import("./schema-subset");
  const schema = JSON.parse(
    readFileSync(new URL("../suites/http/error-envelope/envelope.schema.json", import.meta.url), "utf8"),
  );
  let checked = 0;
  for (const c of loadSuite("http/request-guards").cases) {
    const e = c.expected as { body?: unknown };
    if (!e || typeof e !== "object" || !("body" in e)) continue;
    const body = JSON.parse(JSON.stringify(e.body).split("$generated").join("4f8c2a9e-1b7d-4c3e-9a5f-2d6b8e0c1a73"));
    const problems = validate(schema, body);
    assert.deepEqual(problems, [], `${c.id}: ${problems.join("; ")}`);
    checked++;
  }
  assert.ok(checked >= 60, `only ${checked} envelopes checked`);
});

test("the validator itself refuses what the schema forbids", async () => {
  const { validate } = await import("./schema-subset");
  const schema = JSON.parse(
    readFileSync(new URL("../suites/http/error-envelope/envelope.schema.json", import.meta.url), "utf8"),
  );
  const ok = { error: "gone", message: "Gone.", requestId: "r-1" };
  assert.deepEqual(validate(schema, ok), []);
  assert.ok(validate(schema, { ...ok, trace: [] }).length > 0, "an extra member (a stack trace) must be refused");
  assert.ok(validate(schema, { ...ok, error: "Bad Code" }).length > 0);
  assert.ok(validate(schema, { error: "gone", message: "Gone." }).length > 0, "requestId is required");
  assert.ok(validate(schema, { ...ok, retryAfter: -1 }).length > 0);
  assert.ok(validate(schema, { ...ok, retryAfter: 1.5 }).length > 0);
  assert.ok(validate(schema, { ...ok, errors: [] }).length > 0);
  assert.ok(validate(schema, { ...ok, limit: { name: "maxRows" } }).length > 0);
  assert.ok(validate(schema, { ...ok, message: "x".repeat(301) }).length > 0);
});
