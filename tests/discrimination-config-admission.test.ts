import assert from "node:assert/strict";
import { test } from "node:test";

import { type ConformanceCase, runTable } from "../src/index";

/**
 * Does `flow/config-admission` catch a wrong validator?
 *
 * The probe is a reading of the reference's `validateConfig`, restricted to the
 * field types `transform` declares (a select, a repeater of text/expression, an
 * expression). Each mutant is one way a port gets admission wrong, and must fail
 * EXACTLY the rows that exist to catch it. Nothing here is exported or run by
 * anyone else; the reference lives in @particle-academy/fancy-flow.
 */

type Config = Record<string, unknown>;
type Mutation = {
  refuseBlankRows?: boolean;
  blankMeansKeyBlank?: boolean;
  ignoreSelectOptions?: boolean;
  noListCheck?: boolean;
  noRowObjectCheck?: boolean;
  noStringCheck?: boolean;
  onlyTheActiveMode?: boolean;
};

const blank = (v: unknown) => v === undefined || v === null || v === "";
const isObject = (v: unknown): v is Config => typeof v === "object" && v !== null && !Array.isArray(v);

function admit(config: Config, m: Mutation = {}): { issueKeys: string[] } {
  const keys: string[] = [];
  const mode = config.mode;
  const str = (v: unknown) => m.noStringCheck || typeof v === "string";

  if (mode !== undefined && mode !== null && !m.ignoreSelectOptions && !["fields", "expression"].includes(String(mode))) {
    keys.push("mode");
  }

  const fields = config.fields;
  const checkFields = !(m.onlyTheActiveMode && mode === "expression");
  if (checkFields && fields !== undefined && fields !== null) {
    const issue = (() => {
      if (!Array.isArray(fields)) return !m.noListCheck;
      for (const row of fields) {
        if (!isObject(row)) {
          if (m.noRowObjectCheck) continue;
          return true;
        }
        const isBlank = m.blankMeansKeyBlank ? blank(row.key) : blank(row.key) && blank(row.value);
        if (!m.refuseBlankRows && isBlank) continue;
        if (blank(row.key) || blank(row.value)) return true;
        if (!str(row.key) || !str(row.value)) return true;
      }
      return false;
    })();
    if (issue) keys.push("fields");
  }

  const expression = config.expression;
  if (!(m.onlyTheActiveMode && mode === "fields") && expression !== undefined && expression !== null && !str(expression)) {
    keys.push("expression");
  }
  return { issueKeys: keys };
}

function idsFailedBy(m?: Mutation): string[] {
  return runTable("flow/config-admission", (c: ConformanceCase) => admit((c.input as { config: Config }).config, m), {
    language: "node",
  })
    .results.filter((r) => r.status === "fail")
    .map((r) => r.id)
    .sort();
}

test("flow/config-admission: the faithful probe passes every row (the control)", () => {
  assert.deepEqual(idsFailedBy(), []);
});

test("flow/config-admission: refusing a blank row refuses the editor's own defaults", () => {
  assert.deepEqual(idsFailedBy({ refuseBlankRows: true }), [
    "0001-transform-editor-defaults-are-admitted",
    "0002-transform-expression-mode-with-a-stale-blank-row-is-admitted",
    "0003-transform-fields-mode-with-real-rows-is-admitted",
    "0004-transform-a-row-object-with-no-keys-is-blank",
  ]);
});

test("flow/config-admission: 'blank' meaning only a blank key admits a value that would be lost", () => {
  assert.deepEqual(idsFailedBy({ blankMeansKeyBlank: true }), ["0006-transform-a-value-without-a-key-is-refused"]);
});

test("flow/config-admission: ignoring the select's options admits an unknown mode", () => {
  assert.deepEqual(idsFailedBy({ ignoreSelectOptions: true }), ["0005-transform-unknown-mode-is-refused"]);
});

test("flow/config-admission: no list check admits a string for fields", () => {
  assert.deepEqual(idsFailedBy({ noListCheck: true }), ["0007-transform-fields-not-a-list-is-refused"]);
});

test("flow/config-admission: no row-object check admits a bare string row", () => {
  assert.deepEqual(idsFailedBy({ noRowObjectCheck: true }), ["0008-transform-a-row-that-is-not-an-object-is-refused"]);
});

test("flow/config-admission: no type check admits a number for expression", () => {
  assert.deepEqual(idsFailedBy({ noStringCheck: true }), [
    "0009-transform-an-expression-that-is-not-a-string-is-refused",
  ]);
});

test("flow/config-admission: validating only the active mode's keys misses a bad stale key", () => {
  assert.deepEqual(idsFailedBy({ onlyTheActiveMode: true }), [
    "0009-transform-an-expression-that-is-not-a-string-is-refused",
  ]);
});
