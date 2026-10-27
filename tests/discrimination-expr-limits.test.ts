import assert from "node:assert/strict";
import { test } from "node:test";

import { type ConformanceCase, runTable } from "../src/index";

/**
 * Does `expr/limits` actually CATCH a wrong bound?
 *
 * A limits table is unusually easy to satisfy vacuously: "refuse anything long
 * or nested" passes every out-of-limit row. So the control below must pass the
 * at-the-limit rows too, and each mutant is a mistake a competent port author
 * would plausibly make, asserting the EXACT set of ids it breaks.
 *
 * The evaluator is a compact, deliberately mutable reading of GRAMMAR.md's
 * "Limits" section covering only what these rows exercise. It is not exported
 * and is not the reference; the shipped implementations live in fancy-expr.
 */

const MAX_BYTES = 8192;
const MAX_DEPTH = 64;

type Mutations = {
  /** No length check at all. */
  noLengthLimit?: boolean;
  /** Length in the runtime's native units (UTF-16 here), not UTF-8 bytes. */
  nativeLength?: boolean;
  /** Tokenize first, then check length. */
  tokenizeFirst?: boolean;
  /** `>=` where the spec says `>`. */
  lengthOffByOne?: boolean;
  /** A parenthesised group leaves no node, so it is not counted. */
  noGroupDepth?: boolean;
  /** Unary operators are not counted. */
  noUnaryDepth?: boolean;
  /** Only the recursion guard on the way down; no finished-node check. */
  guardOnly?: boolean;
  /** Only the finished-node check; no guard on the way down. */
  treeOnly?: boolean;
  /** Every dot-segment counts as a level. */
  segmentsCount?: boolean;
  /** Every array item counts as a level. */
  widthCounts?: boolean;
  /** Failures carry no code (fancy-expr 0.1.1). */
  noCodes?: boolean;
};

class Fail extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type Tok = { kind: "num" | "str" | "id" | "punct" | "eof"; v: unknown };
const PUNCT = ["===", "!==", "==", "!=", "&&", "||", "<=", ">=", "?", ":", ".", ",", "(", ")", "[", "]", "{", "}", "+", "-", "*", "/", "<", ">", "!"];

function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (" \t\r\n".includes(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      let s = "";
      i++;
      while (i < src.length && src[i] !== c) s += src[i++];
      if (i >= src.length) throw new Fail("EXPR_SYNTAX");
      i++;
      out.push({ kind: "str", v: s });
      continue;
    }
    if (/[0-9]/.test(c)) {
      let s = "";
      while (i < src.length && /[0-9]/.test(src[i]!)) s += src[i++];
      out.push({ kind: "num", v: Number(s) });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let s = "";
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i]!)) s += src[i++];
      out.push({ kind: "id", v: s });
      continue;
    }
    const p = PUNCT.find((x) => src.startsWith(x, i));
    if (!p) throw new Fail("EXPR_SYNTAX");
    out.push({ kind: "punct", v: p });
    i += p.length;
  }
  out.push({ kind: "eof", v: null });
  return out;
}

type Node = Record<string, any>;

function probe(m: Mutations) {
  function parse(src: string): Node {
    const tooLong = () => {
      const n = m.nativeLength ? src.length : utf8Bytes(src);
      return m.lengthOffByOne ? n >= MAX_BYTES : n > MAX_BYTES;
    };
    if (!m.noLengthLimit && !m.tokenizeFirst && tooLong()) throw new Fail("EXPR_TOO_LONG");
    const t = lex(src);
    if (!m.noLengthLimit && m.tokenizeFirst && tooLong()) throw new Fail("EXPR_TOO_LONG");

    let i = 0;
    let nest = 0;
    let d = 0;
    const peek = () => t[i]!;
    const isP = (...vs: string[]) => peek().kind === "punct" && vs.includes(peek().v as string);
    const eat = (v: string) => { if (!isP(v)) throw new Fail("EXPR_SYNTAX"); i++; };
    const finish = (depth: number) => {
      d = depth;
      if (!m.guardOnly && d > MAX_DEPTH) throw new Fail("EXPR_TOO_DEEP");
    };
    const child = <T>(fn: () => T, counts = true): T => {
      if (!counts) return fn();
      // `nest` counts the constructs enclosing the child about to be parsed,
      // including its own parent. The child is at least one level itself, so
      // once `nest` reaches the limit the finished tree must exceed it.
      nest++;
      try {
        if (!m.treeOnly && nest >= MAX_DEPTH) throw new Fail("EXPR_TOO_DEEP");
        return fn();
      } finally { nest--; }
    };

    function ternary(): Node {
      const test = or();
      const dt = d;
      if (!isP("?")) return test;
      i++;
      const then = child(ternary);
      const dthen = d;
      eat(":");
      const other = child(ternary);
      finish(1 + Math.max(dt, dthen, d));
      return { k: "ternary", test, then, other };
    }
    const chain = (next: () => Node, ops: string[]) => (): Node => {
      let l = next();
      while (isP(...ops)) {
        const op = t[i++]!.v as string;
        const dl = d;
        const r = next();
        finish(1 + Math.max(dl, d));
        l = { k: "bin", op, l, r };
      }
      return l;
    };
    const un = (): Node => {
      if (isP("!", "-")) {
        const op = t[i++]!.v as string;
        const x = child(un, !m.noUnaryDepth);
        finish(m.noUnaryDepth ? d : 1 + d);
        return { k: "un", op, x };
      }
      return prim();
    };
    const mul = chain(un, ["*", "/"]);
    const add = chain(mul, ["+", "-"]);
    const cmp = chain(add, ["<", "<=", ">", ">="]);
    const eq = chain(cmp, ["==", "===", "!=", "!=="]);
    const and = chain(eq, ["&&"]);
    const or = chain(and, ["||"]);

    function prim(): Node {
      const tok = peek();
      if (tok.kind === "num" || tok.kind === "str") { i++; finish(1); return { k: "lit", v: tok.v }; }
      if (tok.kind === "id") {
        const n = tok.v as string;
        if (n === "true" || n === "false" || n === "null") {
          i++;
          finish(1);
          return { k: "lit", v: n === "null" ? null : n === "true" };
        }
        return path();
      }
      if (isP("(")) {
        i++;
        const n = child(ternary, !m.noGroupDepth);
        eat(")");
        finish(m.noGroupDepth ? d : 1 + d);
        return n;
      }
      if (isP("[")) {
        i++;
        const items: Node[] = [];
        let deepest = 0;
        let width = 0;
        if (!isP("]")) {
          for (;;) {
            items.push(child(ternary));
            deepest = Math.max(deepest, d);
            width++;
            if (!isP(",")) break;
            i++;
          }
        }
        eat("]");
        finish(1 + deepest + (m.widthCounts ? width : 0));
        return { k: "arr", items };
      }
      if (isP("{")) {
        i++;
        const entries: Array<[string, Node]> = [];
        let deepest = 0;
        if (!isP("}")) {
          for (;;) {
            const kt = peek();
            if (kt.kind !== "id" && kt.kind !== "str") throw new Fail("EXPR_SYNTAX");
            i++;
            eat(":");
            entries.push([String(kt.v), child(ternary)]);
            deepest = Math.max(deepest, d);
            if (!isP(",")) break;
            i++;
          }
        }
        eat("}");
        finish(1 + deepest);
        return { k: "obj", entries };
      }
      throw new Fail("EXPR_SYNTAX");
    }
    function path(): Node {
      const segs: Node[] = [{ name: t[i++]!.v as string }];
      let deepest = 0;
      let named = 0;
      for (;;) {
        if (isP(".")) {
          i++;
          if (peek().kind !== "id") throw new Fail("EXPR_SYNTAX");
          segs.push({ name: t[i++]!.v as string });
          named++;
          continue;
        }
        if (isP("[")) {
          i++;
          const e = child(ternary);
          deepest = Math.max(deepest, d);
          eat("]");
          segs.push({ expr: e });
          continue;
        }
        if (isP("(")) throw new Fail("EXPR_SYNTAX");
        finish(1 + deepest + (m.segmentsCount ? named : 0));
        return { k: "path", segs };
      }
    }

    if (peek().kind === "eof") throw new Fail("EXPR_SYNTAX");
    const n = ternary();
    if (peek().kind !== "eof") throw new Fail("EXPR_SYNTAX");
    return n;
  }

  const truthy = (v: unknown) => !(v === null || v === false || v === 0 || v === "");

  function ev(n: Node, ctx: any): unknown {
    switch (n.k) {
      case "lit": return n.v;
      case "arr": return n.items.map((x: Node) => ev(x, ctx));
      case "obj": return Object.fromEntries(n.entries.map(([k, v]: [string, Node]) => [k, ev(v, ctx)]));
      case "ternary": return truthy(ev(n.test, ctx)) ? ev(n.then, ctx) : ev(n.other, ctx);
      case "un": { const x = ev(n.x, ctx); return n.op === "!" ? !truthy(x) : typeof x === "number" ? -x : null; }
      case "bin": {
        const l = ev(n.l, ctx);
        const r = ev(n.r, ctx);
        if (n.op === "+" && typeof l === "number" && typeof r === "number") return l + r;
        throw new Error(`probe does not model ${n.op}`);
      }
      case "path": {
        let cur: any = ctx;
        for (const s of n.segs) {
          if (cur === null || cur === undefined) return null;
          const key = "name" in s ? s.name : String(ev(s.expr, ctx));
          if (Array.isArray(cur)) { const k = Number(key); cur = Number.isInteger(k) && k >= 0 && k < cur.length ? cur[k] : null; continue; }
          if (typeof cur === "object" && Object.prototype.hasOwnProperty.call(cur, key)) { cur = cur[key]; continue; }
          return null;
        }
        return cur ?? null;
      }
    }
    throw new Error("unknown node");
  }

  return (c: ConformanceCase) => {
    const input = c.input as { expression: string; context: Record<string, unknown> };
    try {
      return { ok: true, value: ev(parse(input.expression), input.context ?? {}) };
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      return m.noCodes ? { ok: false } : { ok: false, code: e.code };
    }
  };
}

function idsFailedBy(m: Mutations): string[] {
  return runTable("expr/limits", probe(m), { language: "node" })
    .results.filter((r) => r.status === "fail")
    .map((r) => r.id)
    .sort();
}

test("the limits table is satisfiable -- a faithful probe passes every row", () => {
  // The CONTROL. Without it, every mutant below would also "fail rows" against
  // a table whose expectations were simply unreachable.
  const summary = runTable("expr/limits", probe({}), { language: "node" });
  assert.equal(summary.failed, 0, JSON.stringify(summary.results.filter((r) => r.status === "fail")));
  assert.ok(summary.passed >= 27);
});

const MUTANTS: Array<[string, Mutations, string[]]> = [
  ["no length limit", { noLengthLimit: true }, [
    "0002-one-byte-over-is-too-long", "0004-length-is-utf8-bytes-not-characters", "0005-length-is-checked-before-anything-else",
  ]],
  ["native string length instead of UTF-8 bytes", { nativeLength: true }, ["0004-length-is-utf8-bytes-not-characters"]],
  ["tokenize before checking length", { tokenizeFirst: true }, ["0005-length-is-checked-before-anything-else"]],
  ["length limit off by one", { lengthOffByOne: true }, ["0001-at-the-length-limit-evaluates", "0003-length-is-utf8-bytes-at-limit"]],
  ["groups not counted", { noGroupDepth: true }, [
    "0102-64-parentheses-is-too-deep", "0103-the-stack-overflow-shape-is-refused",
    "0104-unclosed-deep-input-is-too-deep-not-syntax", "0804-groups-and-unary-together-over",
  ]],
  ["unary not counted", { noUnaryDepth: true }, ["0202-64-unary-operators-is-too-deep", "0804-groups-and-unary-together-over"]],
  ["recursion guard only, no finished-node check", { guardOnly: true }, [
    "0302-a-65-term-sum-is-too-deep", "0303-a-4000-term-sum-is-too-deep",
  ]],
  ["finished-node check only, no recursion guard", { treeOnly: true }, [
    "0103-the-stack-overflow-shape-is-refused", "0104-unclosed-deep-input-is-too-deep-not-syntax",
  ]],
  ["dot-segments counted as depth", { segmentsCount: true }, ["0801-a-long-dot-path-is-not-deep"]],
  ["array width counted as depth", { widthCounts: true }, [
    "0401-64-nested-arrays-is-depth-64", "0802-a-wide-array-is-not-deep",
  ]],
];

for (const [name, mutation, expected] of MUTANTS) {
  test(`mutant: ${name} -- fails exactly ${expected.length} row(s)`, () => {
    assert.deepEqual(idsFailedBy(mutation), [...expected].sort());
  });
}

test("mutant: failures without a code (fancy-expr 0.1.1) -- fails every out-of-limit row and 0901", () => {
  const failed = idsFailedBy({ noCodes: true });
  const allFailureRows = runTable("expr/limits", () => null, { language: "node" })
    .results.map((r) => r.id)
    .filter((id) => !["0001", "0003", "0101", "0201", "0301", "0401", "0501", "0601", "0701", "0801", "0802", "0803"].includes(id.slice(0, 4)))
    .sort();
  assert.deepEqual(failed, allFailureRows);
  assert.equal(failed.length, 15);
});
