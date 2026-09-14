import assert from "node:assert/strict";
import { test } from "node:test";

import { type ConformanceCase, runTable } from "../src/index";

/**
 * Does `shared/expr` CATCH the whole-string corner?
 *
 * Until 0.23.0 it could not. Every runtime decided a template was ONE
 * expression by asking whether the trimmed string starts with `{{` and ends
 * with `}}`, so `{{ in.text }} --- {{ user.transcript }}` became a single path
 * that never resolves and the template returned null (fancy-flow-php#16). All
 * four runtimes documented that as deliberate and reproduced it, and a table
 * that compares runtimes with each other reads unanimous agreement on a bug as
 * parity. Rows 0021-0026 pin the rule instead: the inner text may contain
 * neither `}}` nor `{{`.
 *
 * ## The control comes first
 *
 * A faithful evaluator that passes EVERY row, truthiness included. Without it,
 * a table that rejected everything would "catch" each mutant below.
 *
 * ## These are mutants, not implementations
 *
 * Nothing here is exported and nothing here is the reference. The shipped
 * evaluators live in fancy-flow-php, fancy-flow, fancy-flow-py and
 * fancy-flow-rs; the correct answers live in the `expected` column. Each mutant
 * asserts the EXACT set of ids it breaks, so a row that stops doing the
 * catching cannot be deleted unnoticed.
 */

type Mutations = {
  /** The shipped corner: starts with `{{` and ends with `}}` is one expression. */
  startsAndEndsIsWhole?: boolean;
  /** Half the fix: only an inner `}}` disqualifies the whole-string branch. */
  onlyInnerClosingBrace?: boolean;
  /** The over-correction: no typed branch at all, everything interpolates. */
  alwaysInterpolate?: boolean;
};

type Resolution = { resolved: boolean; value: unknown };

function resolve(path: string, context: Record<string, unknown>): Resolution {
  const segments = path.trim().split(".");
  if (segments[0] === "") return { resolved: false, value: null };

  let cursor: unknown = context;
  if (segments[0] === "$json" || segments[0] === "$input") {
    cursor = "in" in context ? context.in : context;
    segments.shift();
  }
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== "object" || !(segment in cursor)) {
      return { resolved: false, value: null };
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return { resolved: true, value: cursor };
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function evaluator(m: Mutations) {
  return (template: unknown, context: Record<string, unknown>): unknown => {
    if (typeof template !== "string") return template;

    const trimmed = template.trim();
    if (!m.alwaysInterpolate && trimmed.length >= 4 && trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
      const inner = trimmed.slice(2, -2);
      const single =
        m.startsAndEndsIsWhole ? true
        : m.onlyInnerClosingBrace ? !inner.includes("}}")
        : !inner.includes("}}") && !inner.includes("{{");
      if (single) {
        const r = resolve(inner, context);
        return r.resolved ? r.value : null;
      }
    }

    let out = "";
    let i = 0;
    for (;;) {
      const open = template.indexOf("{{", i);
      const close = open === -1 ? -1 : template.indexOf("}}", open + 2);
      if (close === -1) return out + template.slice(i);
      const r = resolve(template.slice(open + 2, close), context);
      out += template.slice(i, open) + (r.resolved ? stringify(r.value) : "");
      i = close + 2;
    }
  };
}

const FALSY_STRINGS = new Set(["", "0", "false", "no", "off", "null"]);

function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return !FALSY_STRINGS.has(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return value !== 0;
  return Boolean(value);
}

function idsFailedBy(m: Mutations): string[] {
  const evaluate = evaluator(m);
  const impl = (c: ConformanceCase) => {
    const input = c.input as { template?: unknown; context?: Record<string, unknown>; value?: unknown };
    return c.fn === "truthy" ? truthy(input.value) : evaluate(input.template, input.context ?? {});
  };
  return runTable("shared/expr", impl, { language: "node" })
    .results.filter((r) => r.status === "fail")
    .map((r) => r.id)
    .sort();
}

test("the shared/expr table is satisfiable: a faithful evaluator passes every row", () => {
  // The control. Every assertion below is meaningless if this one fails.
  assert.deepEqual(idsFailedBy({}), []);
});

test("the table catches the shipped corner: starts with {{ and ends with }} is one expression", () => {
  // What all four runtimes did until fancy-flow-php 0.52.2. Each of these rows
  // returned null. 0024 is NOT here, and must not be: a padded single
  // expression was always right.
  assert.deepEqual(idsFailedBy({ startsAndEndsIsWhole: true }), [
    "0021-several-references-interpolate-each",
    "0022-several-references-across-newlines",
    "0023-adjacent-references-are-two-references",
    "0025-one-unresolved-reference-of-several-interpolates-empty",
    "0026-an-inner-opening-brace-is-not-one-expression",
  ]);
});

test("the table catches half the fix: only an inner }} disqualifies the whole-string branch", () => {
  // Every row that shipped the bug holds an inner `}}`, so this passes them
  // all. 0026 exists for exactly this port.
  assert.deepEqual(idsFailedBy({ onlyInnerClosingBrace: true }), [
    "0026-an-inner-opening-brace-is-not-one-expression",
  ]);
});

test("the table catches the over-correction: no typed branch at all", () => {
  // The easy way to "fix" #16, and it breaks the reason the branch exists: a
  // config field carrying a number would carry the string "3".
  assert.deepEqual(idsFailedBy({ alwaysInterpolate: true }), [
    "0001-whole-string-keeps-type",
    "0007-missing-path-is-null",
    "0024-padded-single-expression-keeps-type",
  ]);
});
