import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { loadSuite } from "../src/index";

/**
 * The run identity for `flow/connector-runs` is a CONSTANT, and these tests are
 * what keep it one.
 *
 * ## Why the literal and its derivation are both checked
 *
 * `input.runIdentity.value` is authoritative: for a fixed fixture graph the
 * identity cannot change, and a constant cannot be disagreed about the way a
 * derivation can. But a pinned string on its own proves nothing — a runner
 * could read it and never notice its own canonicaliser had drifted. So the
 * derivation is recomputed HERE, from the case, and must equal the literal.
 * If someone edits the graph without re-deriving, or edits a rule without
 * re-pinning, this goes red.
 *
 * ## The history this pins
 *
 * 0.21.0 wrote "canonical json" undefined. 0.21.1 defined four rules — and PHP
 * and Node, implementing those four faithfully, still disagreed:
 * `labe4b755a3` against `labd5f9ddb2`. The graph has `config: {}`; a JavaScript
 * parse keeps it an object, PHP's `json_decode(..., true)` makes it `[]`, and
 * nothing in the definition said which. The connector lab found it by comparing
 * the two byte for byte, then verified it in a third runtime.
 *
 * ## The two guards are the definition's own promises
 *
 * The case's `canonicalJson` says integers only and ASCII keys, "enforced by a
 * test". This is that test. Writing the rule into the fixture and leaving it
 * unchecked would have been the same defect this repository exists to catch:
 * prose adjacent to a rule is not the rule.
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function theCase() {
  const { cases } = loadSuite("flow/connector-runs");
  const c = cases.find((x) => x.id === "0001-stripe-customer-fake");

  assert.ok(c, "flow/connector-runs/0001-stripe-customer-fake was not found");

  return c;
}

/** Code-point comparison. NOT the default sort, which orders by UTF-16 code unit. */
function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];

  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }

  return x.length - y.length;
}

/** The canonical form, exactly as `input.runIdentity.canonicalJson` states it. */
function canonical(value: Json): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort(byCodePoint);

    // An empty object and an empty array are one value.
    if (keys.length === 0) return "[]";

    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k]!)}`).join(",")}}`;
  }

  // JSON.stringify escapes neither `/` nor non-ASCII, which is what the rule asks.
  return JSON.stringify(value);
}

function derive(schema: Json): string {
  return "lab" + createHash("sha256").update(canonical(schema), "utf8").digest("hex").slice(0, 8);
}

function walk(value: Json, visit: (v: Json, key: string | null) => void, key: string | null = null): void {
  visit(value, key);

  if (Array.isArray(value)) {
    value.forEach((v) => walk(v, visit));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walk(v, visit, k);
  }
}

test("the pinned run identity is what the definition derives", () => {
  const c = theCase();
  const identity = (c.input as { runIdentity: { value: string } }).runIdentity;
  const schema = (c.input as { schema: Json }).schema;

  assert.equal(
    derive(schema),
    identity.value,
    "the literal and the derivation disagree — the graph or a canonicalJson rule changed without re-pinning",
  );
});

test("the pinned value is the one three runtimes agreed on", () => {
  // Stated as a literal on purpose. If this ever changes, it must be because
  // the graph changed and every runner was re-derived — not because one
  // implementation quietly moved.
  const identity = (theCase().input as { runIdentity: { value: string } }).runIdentity;

  assert.equal(identity.value, "labd5f9ddb2");
});

test("an empty object would change the key — proving the `{}` rule matters", () => {
  // The discrimination half. Without the empty-object rule the same graph
  // derives the value the Node lane first produced, which no PHP runner of
  // this suite can reach. If this ever derives the same key, the rule has
  // stopped doing anything and the case no longer exercises it.
  const schema = (theCase().input as { schema: Json }).schema;

  const keepsEmptyObjects = (value: Json): string => {
    if (Array.isArray(value)) return `[${value.map(keepsEmptyObjects).join(",")}]`;
    if (value !== null && typeof value === "object") {
      const keys = Object.keys(value).sort(byCodePoint);
      return `{${keys.map((k) => `${JSON.stringify(k)}:${keepsEmptyObjects(value[k]!)}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };

  const without = "lab" + createHash("sha256").update(keepsEmptyObjects(schema), "utf8").digest("hex").slice(0, 8);

  assert.equal(without, "labe4b755a3");
  assert.notEqual(without, derive(schema));
});

test("the hashed input contains integers only", () => {
  // No runtime can recover how a number was written after a parse, and they
  // disagree on printing a float: Python `1.0`, JavaScript `1`, PHP either,
  // depending on a flag. An integer prints identically everywhere.
  const offenders: number[] = [];

  walk((theCase().input as { schema: Json }).schema, (v) => {
    if (typeof v === "number" && !Number.isInteger(v)) offenders.push(v);
  });

  assert.deepEqual(offenders, [], "a fractional number in the hashed input makes the identity runtime-dependent");
});

test("every object key in the hashed input is ASCII", () => {
  // With ASCII keys, code-point order and UTF-16 code-unit order coincide, so
  // the one ordering divergence between runtimes cannot be reached silently.
  const offenders: string[] = [];

  walk((theCase().input as { schema: Json }).schema, (_v, key) => {
    if (key !== null && !/^[\x00-\x7F]*$/.test(key)) offenders.push(key);
  });

  assert.deepEqual(offenders, [], "a non-ASCII key makes key order runtime-dependent — read canonicalJson before changing this");
});
