import assert from "node:assert/strict";
import { test } from "node:test";

import { type ConformanceCase, runTable } from "../src/index";

/**
 * Do the `expr/*` tables actually CATCH a wrong evaluator?
 *
 * The `expr/evaluate` manifest has said since 0.14.0 that this suite "needs
 * DISCRIMINATION PROBES before it can claim more than drift-guarding", and
 * named the three it wanted. It was recorded rather than written, so that the
 * green tick would not be read as the stronger claim. This is that file.
 *
 * It matters more here than in most suites. `fancy-expr` exists because three
 * real libraries — `symfony/expression-language`, `expr-eval`, `simpleeval` —
 * disagree with each other on precisely these semantics. A table that all three
 * would pass would be evidence of nothing, and the whole argument for writing
 * the grammar ourselves would collapse.
 *
 * ## These are mutants, not implementations
 *
 * The evaluator below is a compact, deliberately mutable reading of
 * `GRAMMAR.md`. Nothing here is exported and nothing here is the reference —
 * the shipped implementations live in `fancy-expr`, one per language, and the
 * correct answers live in the `expected` column of the fixtures.
 *
 * Each mutation is a mistake a competent author would genuinely make, and each
 * asserts the EXACT set of ids it breaks. "At least one failure" would prove
 * nothing about which row did the catching, and would keep passing after that
 * row was deleted.
 */

type Mutations = {
  /** PHP's `(bool) []` and Python's `bool({})`: empty containers are falsy. */
  nativeTruthy?: boolean;
  /** PHP's `==`: `'3' == 3` is true. */
  coercingEquality?: boolean;
  /** `&&` / `||` yield a boolean instead of the operand. */
  booleanLogic?: boolean;
  /** A malformed expression returns null instead of throwing — THE defect. */
  nullOnMalformed?: boolean;
  /** `.length` on an object returns its key count. */
  objectHasLength?: boolean;
  /** `references()` reuses the evaluator's short-circuit. */
  shortCircuitReferences?: boolean;
  /** `references()` collects object-literal keys as if they were read. */
  keysAreReferences?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// A compact evaluator, parameterised by the mistake being made
// ─────────────────────────────────────────────────────────────────────────────

type Tok = { kind: "num" | "str" | "id" | "punct" | "eof"; v: unknown };

const PUNCT = [
  "===", "!==", "==", "!=", "&&", "||", "<=", ">=",
  "?", ":", ".", ",", "(", ")", "[", "]", "{", "}",
  "+", "-", "*", "/", "<", ">", "!",
];

class Bad extends Error {}

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
      if (i >= src.length) throw new Bad("unterminated string");
      i++;
      out.push({ kind: "str", v: s });
      continue;
    }

    if (/[0-9]/.test(c)) {
      let s = "";
      while (i < src.length && /[0-9.]/.test(src[i]!)) s += src[i++];
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
    if (!p) throw new Bad(`unexpected ${c}`);
    out.push({ kind: "punct", v: p });
    i += p.length;
  }
  out.push({ kind: "eof", v: null });
  return out;
}

type Node = Record<string, any>;

function makeParser(src: string) {
  const t = lex(src);
  let i = 0;

  const peek = () => t[i]!;
  const isP = (...vs: string[]) => peek().kind === "punct" && vs.includes(peek().v as string);
  const eat = (v: string) => { if (!isP(v)) throw new Bad(`expected ${v}`); i++; };

  function ternary(): Node {
    const test = or();
    if (!isP("?")) return test;
    i++;
    const then = expr();
    eat(":");
    return { k: "ternary", test, then, other: expr() };
  }
  function or(): Node {
    let l = and();
    while (isP("||")) { i++; l = { k: "logical", op: "||", l, r: and() }; }
    return l;
  }
  function and(): Node {
    let l = eq();
    while (isP("&&")) { i++; l = { k: "logical", op: "&&", l, r: eq() }; }
    return l;
  }
  function eq(): Node {
    let l = cmp();
    while (isP("==", "===", "!=", "!==")) {
      const raw = t[i++]!.v as string;
      l = { k: "bin", op: raw.startsWith("!") ? "!==" : "===", loose: raw.length === 2, l, r: cmp() };
    }
    return l;
  }
  function cmp(): Node {
    let l = add();
    while (isP("<", "<=", ">", ">=")) { const op = t[i++]!.v as string; l = { k: "bin", op, l, r: add() }; }
    return l;
  }
  function add(): Node {
    let l = mul();
    while (isP("+", "-")) { const op = t[i++]!.v as string; l = { k: "bin", op, l, r: mul() }; }
    return l;
  }
  function mul(): Node {
    let l = un();
    while (isP("*", "/")) { const op = t[i++]!.v as string; l = { k: "bin", op, l, r: un() }; }
    return l;
  }
  function un(): Node {
    if (isP("!", "-")) { const op = t[i++]!.v as string; return { k: "un", op, x: un() }; }
    return prim();
  }
  function prim(): Node {
    const tok = peek();
    if (tok.kind === "num" || tok.kind === "str") { i++; return { k: "lit", v: tok.v }; }
    if (tok.kind === "id") {
      const n = tok.v as string;
      if (n === "true" || n === "false" || n === "null") {
        i++;
        return { k: "lit", v: n === "null" ? null : n === "true" };
      }
      return path();
    }
    if (isP("(")) { i++; const n = expr(); eat(")"); return n; }
    if (isP("[")) {
      i++;
      const items: Node[] = [];
      if (!isP("]")) { items.push(expr()); while (isP(",")) { i++; items.push(expr()); } }
      eat("]");
      return { k: "arr", items };
    }
    if (isP("{")) {
      i++;
      const entries: Array<[string, Node]> = [];
      const entry = (): [string, Node] => {
        const kt = peek();
        if (kt.kind !== "id" && kt.kind !== "str") throw new Bad("bad key");
        i++;
        eat(":");
        return [String(kt.v), expr()];
      };
      if (!isP("}")) { entries.push(entry()); while (isP(",")) { i++; entries.push(entry()); } }
      eat("}");
      return { k: "obj", entries };
    }
    throw new Bad("expected an expression");
  }
  function path(): Node {
    const segs: Node[] = [{ name: t[i++]!.v as string }];
    for (;;) {
      if (isP(".")) {
        i++;
        if (peek().kind !== "id") throw new Bad("bad property");
        segs.push({ name: t[i++]!.v as string });
        continue;
      }
      if (isP("[")) { i++; const e = expr(); eat("]"); segs.push({ expr: e }); continue; }
      if (isP("(")) throw new Bad("no calls");
      return { k: "path", segs };
    }
  }
  function expr(): Node { return ternary(); }

  if (peek().kind === "eof") throw new Bad("empty");
  const n = expr();
  if (peek().kind !== "eof") throw new Bad("trailing input");
  return n;
}

function probe(m: Mutations) {
  const truthy = (v: unknown): boolean => {
    if (v === null || v === undefined) return false;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") return v !== "";
    // THE mutation: PHP and Python both call an empty container false.
    if (m.nativeTruthy) {
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === "object") return Object.keys(v).length > 0;
    }
    return true;
  };

  const eq = (l: unknown, r: unknown, loose: boolean): boolean => {
    // THE mutation: PHP's `==` coerces, so `'3' == 3` is true.
    if (m.coercingEquality && loose) return l == (r as never);
    if (l === r) return true;
    if (l === null || r === null || typeof l !== "object" || typeof r !== "object") return false;
    if (Array.isArray(l) !== Array.isArray(r)) return false;
    if (Array.isArray(l)) {
      const b = r as unknown[];
      return l.length === b.length && l.every((x, k) => eq(x, b[k], false));
    }
    const a = l as Record<string, unknown>;
    const b = r as Record<string, unknown>;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && eq(a[k], b[k], false));
  };

  const str = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v) ?? "";
  };

  const num = (v: unknown) => typeof v === "number";

  function ev(n: Node, ctx: Record<string, unknown>): unknown {
    switch (n.k) {
      case "lit": return n.v;
      case "arr": return n.items.map((x: Node) => ev(x, ctx));
      case "obj": return Object.fromEntries(n.entries.map(([k, v]: [string, Node]) => [k, ev(v, ctx)]));
      case "ternary": return truthy(ev(n.test, ctx)) ? ev(n.then, ctx) : ev(n.other, ctx);
      case "logical": {
        const l = ev(n.l, ctx);
        // THE mutation: returning a boolean destroys the fallback shape, which
        // is the single most useful thing in the grammar.
        if (m.booleanLogic) {
          return n.op === "||" ? truthy(l) || truthy(ev(n.r, ctx)) : truthy(l) && truthy(ev(n.r, ctx));
        }
        if (n.op === "||") return truthy(l) ? l : ev(n.r, ctx);
        return truthy(l) ? ev(n.r, ctx) : l;
      }
      case "un": {
        const x = ev(n.x, ctx);
        return n.op === "!" ? !truthy(x) : num(x) ? -(x as number) : null;
      }
      case "bin": {
        const l = ev(n.l, ctx);
        const r = ev(n.r, ctx);
        switch (n.op) {
          case "===": return eq(l, r, n.loose);
          case "!==": return !eq(l, r, n.loose);
          case "+":
            if (num(l) && num(r)) return (l as number) + (r as number);
            if (typeof l === "string" || typeof r === "string") return str(l) + str(r);
            return null;
          case "-": return num(l) && num(r) ? (l as number) - (r as number) : null;
          case "*": return num(l) && num(r) ? (l as number) * (r as number) : null;
          case "/": return num(l) && num(r) && r !== 0 ? (l as number) / (r as number) : null;
          default: {
            const ok = (num(l) && num(r)) || (typeof l === "string" && typeof r === "string");
            if (!ok) return false;
            if (n.op === "<") return (l as never) < (r as never);
            if (n.op === "<=") return (l as never) <= (r as never);
            if (n.op === ">") return (l as never) > (r as never);
            return (l as never) >= (r as never);
          }
        }
      }
      case "path": {
        let cur: unknown = ctx;
        for (const s of n.segs) {
          if (cur === null || cur === undefined) return null;
          const key = "name" in s ? s.name : str(ev(s.expr, ctx));
          if (key === "length" && (typeof cur === "string" || Array.isArray(cur))) {
            cur = cur.length;
            continue;
          }
          // THE mutation: giving objects a `.length` invents a count that no
          // two of the three languages could agree on.
          if (m.objectHasLength && key === "length" && cur && typeof cur === "object") {
            cur = Object.keys(cur).length;
            continue;
          }
          if (Array.isArray(cur)) {
            const idx = Number(key);
            cur = Number.isInteger(idx) && idx >= 0 && idx < cur.length ? cur[idx] : null;
            continue;
          }
          if (typeof cur === "object" && Object.prototype.hasOwnProperty.call(cur, key)) {
            cur = (cur as Record<string, unknown>)[key];
            continue;
          }
          return null;
        }
        return cur === undefined ? null : cur;
      }
      default: throw new Bad("unknown node");
    }
  }

  function refs(n: Node, out: Set<string>): void {
    switch (n.k) {
      case "lit": return;
      case "path": {
        const [head, ...rest] = n.segs;
        if (head && "name" in head) out.add(head.name);
        for (const s of rest) if ("expr" in s) refs(s.expr, out);
        return;
      }
      case "arr": for (const x of n.items) refs(x, out); return;
      case "obj":
        for (const [k, v] of n.entries as Array<[string, Node]>) {
          // THE mutation: a key is written, not read. Collecting it makes a
          // host reject a valid expression.
          if (m.keysAreReferences) out.add(k);
          refs(v, out);
        }
        return;
      case "ternary":
        refs(n.test, out);
        // THE mutation: a static question has no run to take a branch in.
        if (!m.shortCircuitReferences) { refs(n.then, out); refs(n.other, out); }
        return;
      case "logical":
        refs(n.l, out);
        if (!m.shortCircuitReferences) refs(n.r, out);
        return;
      case "bin": refs(n.l, out); refs(n.r, out); return;
      case "un": refs(n.x, out); return;
    }
  }

  return {
    evaluate(c: ConformanceCase) {
      try {
        const node = makeParser(c.input.expression as string);
        return { ok: true, value: ev(node, (c.input.context as Record<string, unknown>) ?? {}) };
      } catch (e) {
        if (!(e instanceof Bad)) throw e;
        // THE defect the package exists to remove: a parse failure that is
        // indistinguishable from an absent path.
        return m.nullOnMalformed ? { ok: true, value: null } : { ok: false };
      }
    },
    references(c: ConformanceCase) {
      try {
        const out = new Set<string>();
        refs(makeParser(c.input.expression as string), out);
        return { ok: true, value: [...out].sort() };
      } catch (e) {
        if (!(e instanceof Bad)) throw e;
        return m.nullOnMalformed ? { ok: true, value: [] } : { ok: false };
      }
    },
  };
}

function idsFailedBy(suite: string, impl: (c: ConformanceCase) => unknown): string[] {
  return runTable(suite, impl, { language: "node" })
    .results.filter((r) => r.status === "fail")
    .map((r) => r.id)
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// expr/evaluate
// ─────────────────────────────────────────────────────────────────────────────

test("the evaluate table is satisfiable — a faithful probe passes every row", () => {
  // The CONTROL, and it is not a formality. Without it every assertion below
  // would also hold against a table whose expectations are simply unreachable,
  // and the mutants would be "caught" by a suite that catches everything.
  assert.deepEqual(idsFailedBy("expr/evaluate", probe({}).evaluate), []);
});

test("the evaluate table catches native truthiness — PHP's and Python's instinct", () => {
  // `(bool) []` is false in PHP; `bool({})` is False in Python. Both look
  // completely idiomatic and both silently turn "did we get results?" into
  // "did the call succeed?".
  assert.deepEqual(idsFailedBy("expr/evaluate", probe({ nativeTruthy: true }).evaluate), [
    "0301-empty-array-is-truthy",
    "0302-empty-object-is-truthy",
  ]);
});

test("the evaluate table catches a coercing `==`", () => {
  // A PHP author reaching for `==` gets loose comparison, and `'3' == 3` is
  // true. Both spellings must arrive as the same strict operator or one runtime
  // answers differently from the other two.
  //
  // THIS TEST FAILED WHEN FIRST WRITTEN, and the table was wrong, not the
  // mutant. 0503 pinned no-coercion using the STRICT spelling and 0502 compared
  // two values that were equal anyway, so a coercing `==` passed EVERY row --
  // while the suite manifest asserted in prose that such a probe "must fail
  // 0503". It failed nothing. 1101 is the row that makes the claim true.
  assert.deepEqual(idsFailedBy("expr/evaluate", probe({ coercingEquality: true }).evaluate), [
    "1101-loose-spelling-does-not-coerce",
  ]);
});

test("the evaluate table catches `&&`/`||` returning a boolean", () => {
  // The mutation that passes any test which only checks truthiness — and
  // destroys the fallback, which is the shape the original field report was
  // written in. It reaches the composed rows too, which is the point of having
  // them: `1001` is four fallbacks at once.
  assert.deepEqual(idsFailedBy("expr/evaluate", probe({ booleanLogic: true }).evaluate), [
    "0401-or-returns-the-operand",
    "0402-or-short-circuits",
    "0403-and-returns-the-operand",
    "0404-and-short-circuits",
    "1001-the-normalisation-an-agent-writes",
    "1002-the-branch-condition-that-took-the-wrong-road",
    "1003-empty-string-fallback-survives-the-chain",
  ]);
});

test("the evaluate table catches null-on-malformed — the original defect itself", () => {
  // This is the exact resolver behaviour that cost a consumer a production
  // workflow: a condition the engine could not evaluate returned null, null
  // read as false, and the graph took the wrong road on every run while
  // reporting success. If this mutant ever stops failing, the package has
  // regressed to the thing it was built to replace.
  assert.deepEqual(idsFailedBy("expr/evaluate", probe({ nullOnMalformed: true }).evaluate), [
    "0801-unclosed-string",
    "0802-dangling-operator",
    "0803-unclosed-paren",
    "0804-empty-expression",
    "0805-no-function-calls",
  ]);
});

test("the evaluate table catches an object that answers `.length`", () => {
  // Inventing a count for objects is the tempting fix for 0904 — and it is the
  // one PHP cannot implement, which is why 0904 is skipped there and 0906
  // exists. A runtime that answered would disagree with the other two.
  assert.deepEqual(idsFailedBy("expr/evaluate", probe({ objectHasLength: true }).evaluate), [
    "0904-object-has-no-length",
    "0906-non-empty-object-has-no-length",
  ]);
});

// ─────────────────────────────────────────────────────────────────────────────
// expr/references
// ─────────────────────────────────────────────────────────────────────────────

test("the references table is satisfiable — a faithful probe passes every row", () => {
  assert.deepEqual(idsFailedBy("expr/references", probe({}).references), []);
});

test("the references table catches an implementation that short-circuits", () => {
  // Reusing the evaluator's walk is the OBVIOUS implementation — the tree is
  // right there — and it reports only what one run would touch. A host would
  // then approve an expression that fails on the other road.
  assert.deepEqual(idsFailedBy("expr/references", probe({ shortCircuitReferences: true }).references), [
    "0104-mixed-dollar-and-plain",
    "0108-both-sides-of-a-branch",
  ]);
});

test("the references table catches an implementation that collects object keys", () => {
  // The damaging direction. A host would reject `{ transcript: in.content }`
  // as reading something that does not exist, and the author has no way to
  // comply — a false rejection at save time is worse than a missed one.
  assert.deepEqual(idsFailedBy("expr/references", probe({ keysAreReferences: true }).references), [
    "0106-object-keys-are-not-references",
    "0109-the-field-report-normalisation",
  ]);
});

test("the references table catches returning [] instead of failing", () => {
  // `[]` tells a host "this expression needs nothing", so it saves a node that
  // can never run — the same collapse as null-on-malformed, one layer along.
  assert.deepEqual(idsFailedBy("expr/references", probe({ nullOnMalformed: true }).references), [
    "0201-malformed-does-not-parse",
    "0202-a-call-does-not-parse",
  ]);
});

test("every expr mutant is caught by a DIFFERENT set of ids", () => {
  // The guard on the guards. If two mutations failed the same rows, one of
  // those rows would be doing all the work and the other could be deleted
  // without any test noticing — which is how a suite quietly shrinks to a
  // fraction of what its name claims.
  const sets = [
    probe({ nativeTruthy: true }).evaluate,
    probe({ coercingEquality: true }).evaluate,
    probe({ booleanLogic: true }).evaluate,
    probe({ nullOnMalformed: true }).evaluate,
    probe({ objectHasLength: true }).evaluate,
  ].map((impl) => idsFailedBy("expr/evaluate", impl).join("|"));

  assert.equal(new Set(sets).size, sets.length, "two mutants fail the same rows");
  assert.ok(sets.every((s) => s.length > 0), "a mutant that fails nothing is not a mutant");
});
