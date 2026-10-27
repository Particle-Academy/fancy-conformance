"""Generate `suites/expr/limits/cases.json`.

A generator rather than a hand-edited file because every row here is a boundary
measured in bytes or nesting levels, and an expression of 8,192 bytes or 64
nested brackets is exactly the kind of thing that goes wrong silently when typed.
Each row is built from the limit it pins, so moving a limit is one constant.

The "ok" goldens are the values those expressions evaluate to under the grammar.
They were checked by running the expressions through fancy-expr 0.1.1 (Node),
which evaluates every within-limit row correctly today -- the rows exist to make
the OUT-of-limit side say so, not to change what valid input means.

    python scripts/build-expr-limits-cases.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

OUT = Path(__file__).resolve().parent.parent / "suites" / "expr" / "limits"

SINCE = "0.35.0"
MAX_BYTES = 8192
MAX_DEPTH = 64

TOO_LONG = {"ok": False, "code": "EXPR_TOO_LONG"}
TOO_DEEP = {"ok": False, "code": "EXPR_TOO_DEEP"}
SYNTAX = {"ok": False, "code": "EXPR_SYNTAX"}


def ok(value: Any) -> dict[str, Any]:
    return {"ok": True, "value": value}


def nested_array(levels: int) -> Any:
    value: Any = []
    for _ in range(levels - 1):
        value = [value]
    return value


def nested_object(levels: int) -> Any:
    value: Any = 1
    for _ in range(levels):
        value = {"a": value}
    return value


def row(
    id_: str,
    title: str,
    expression: str,
    expected: dict[str, Any],
    notes: str,
    context: dict[str, Any] | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": id_,
        "title": title,
        "since": SINCE,
        "tags": tags or ["expr", "limits"],
        "input": {"expression": expression, "context": context or {}},
        "expected": expected,
        "notes": notes,
    }


def cases() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    # -- length ---------------------------------------------------------------
    at = "1" + " " * (MAX_BYTES - 1)
    assert len(at.encode("utf-8")) == MAX_BYTES
    out.append(row(
        "0001-at-the-length-limit-evaluates",
        "An expression of exactly 8192 bytes evaluates",
        at, ok(1),
        "The limit is INCLUSIVE. Whitespace padding keeps the row about length alone: the expression is `1` plus 8191 spaces.",
    ))
    out.append(row(
        "0002-one-byte-over-is-too-long",
        "8193 bytes is EXPR_TOO_LONG",
        at + " ", TOO_LONG,
        "The off-by-one partner of 0001. An implementation using `>=` where the spec says `>` fails 0001; one with no limit fails this row.",
    ))

    accented_ok = "'" + "é" * ((MAX_BYTES - 2) // 2) + "'"
    assert len(accented_ok.encode("utf-8")) == MAX_BYTES
    out.append(row(
        "0003-length-is-utf8-bytes-at-limit",
        "A two-byte character counts twice: 4095 x U+00E9 in quotes is exactly 8192 bytes and evaluates",
        accented_ok, ok("é" * ((MAX_BYTES - 2) // 2)),
        "4097 characters, 8192 UTF-8 bytes. Within the limit however it is counted.",
    ))
    accented_over = "'" + "é" * ((MAX_BYTES - 2) // 2 + 1) + "'"
    assert len(accented_over.encode("utf-8")) == MAX_BYTES + 2
    assert len(accented_over) < MAX_BYTES
    out.append(row(
        "0004-length-is-utf8-bytes-not-characters",
        "4096 x U+00E9 in quotes is 8194 bytes but only 4098 characters: EXPR_TOO_LONG",
        accented_over, TOO_LONG,
        "THE CROSS-LANGUAGE ROW. JavaScript's `.length` counts UTF-16 units, Python's `len` counts code points and PHP's `strlen` counts bytes -- three runtimes, three different numbers for one string. The limit is UTF-8 BYTES in every runtime, and an implementation that used its native length passes this row's string as 4098 and accepts it.",
    ))
    out.append(row(
        "0005-length-is-checked-before-anything-else",
        "8193 bytes of characters the tokenizer would reject is EXPR_TOO_LONG, not EXPR_SYNTAX",
        "@" * (MAX_BYTES + 1), TOO_LONG,
        "Pins the ORDER: the length check runs before tokenizing, so an oversized input costs O(1) work to refuse rather than a scan. An implementation that tokenized first reports EXPR_SYNTAX at offset 0.",
    ))

    # -- depth: parentheses ----------------------------------------------------
    out.append(row(
        "0101-63-parentheses-is-depth-64",
        "63 nested parentheses around a literal is depth 64 and evaluates",
        "(" * 63 + "1" + ")" * 63, ok(1),
        "A parenthesised group counts as one level even though it produces no node of its own: the parser recurses through it, and recursion is what the limit bounds.",
    ))
    out.append(row(
        "0102-64-parentheses-is-too-deep",
        "64 nested parentheses is depth 65: EXPR_TOO_DEEP",
        "(" * 64 + "1" + ")" * 64, TOO_DEEP,
        "The off-by-one partner of 0101. An implementation that does not count groups (because they leave no node in the tree) accepts this.",
    ))
    out.append(row(
        "0103-the-stack-overflow-shape-is-refused",
        "4000 nested parentheses (8001 bytes, under the length limit) is EXPR_TOO_DEEP",
        "(" * 4000 + "1" + ")" * 4000, TOO_DEEP,
        "THE DEFECT. fancy-expr 0.1.1 parsed this by plain recursion -- roughly nine stack frames per parenthesis. Measured on 2026-10-27: Node threw RangeError (maximum call stack size exceeded) and Python RecursionError; PHP's larger stack happened to hold at 4000 and returned 1. Neither crash is the package's own error type, so a host catching syntax errors to reject bad input at save time crashed instead. The length limit alone does not prevent it: 4000 levels fit in 8001 bytes.",
    ))
    out.append(row(
        "0104-unclosed-deep-input-is-too-deep-not-syntax",
        "8000 opening parentheses and nothing else is EXPR_TOO_DEEP",
        "(" * 8000, TOO_DEEP,
        "Pins that depth is enforced DURING descent, before the missing `)` is reached. An implementation that only measured the finished tree would have to finish parsing first -- which is the recursion that overflows -- and, if it survived, would report EXPR_SYNTAX.",
    ))

    # -- depth: unary -----------------------------------------------------------
    out.append(row(
        "0201-63-unary-operators-is-depth-64",
        "63 chained `!` on a literal is depth 64 and evaluates",
        "!" * 63 + "true", ok(False),
        "An odd number of negations of true.",
    ))
    out.append(row(
        "0202-64-unary-operators-is-too-deep",
        "64 chained `!` is depth 65: EXPR_TOO_DEEP",
        "!" * 64 + "true", TOO_DEEP,
        "Unary operators recurse in the parser and in the evaluator. An implementation that counted only brackets accepts this.",
    ))

    # -- depth: binary chains ---------------------------------------------------
    out.append(row(
        "0301-a-64-term-sum-is-depth-64",
        "1+1+...+1 with 64 terms is 63 left-nested additions, depth 64, and evaluates",
        "+".join(["1"] * 64), ok(64),
        "A binary chain is parsed by a LOOP, not by recursion, so it never threatens the parser's stack -- but it builds a left-deep tree, and every evaluator here walks the tree recursively.",
    ))
    out.append(row(
        "0302-a-65-term-sum-is-too-deep",
        "65 terms is 64 additions, depth 65: EXPR_TOO_DEEP",
        "+".join(["1"] * 65), TOO_DEEP,
        "An implementation that guarded only its own recursion (brackets, unary, ternary) accepts this, and 0303 is what that costs.",
    ))
    out.append(row(
        "0303-a-4000-term-sum-is-too-deep",
        "1+1+...+1 with 4000 terms (7999 bytes) is EXPR_TOO_DEEP",
        "+".join(["1"] * 4000), TOO_DEEP,
        "Parses fine with no limit at all -- the chain is a loop -- then overflows while EVALUATING the left-deep tree. Measured on fancy-expr 0.1.1: RangeError in Node, RecursionError in Python, 4000 in PHP. A depth limit that counted only parser recursion would let this through to the evaluator.",
    ))

    # -- depth: literals and indices ------------------------------------------------
    out.append(row(
        "0401-64-nested-arrays-is-depth-64",
        "64 nested array literals is depth 64 and evaluates",
        "[" * 64 + "]" * 64, ok(nested_array(64)),
        "An empty array literal is depth 1; each enclosing literal adds one.",
    ))
    out.append(row(
        "0402-65-nested-arrays-is-too-deep",
        "65 nested array literals: EXPR_TOO_DEEP",
        "[" * 65 + "]" * 65, TOO_DEEP,
        "The off-by-one partner of 0401.",
    ))
    out.append(row(
        "0501-63-nested-objects-is-depth-64",
        "63 nested object literals around a literal is depth 64 and evaluates",
        "{a:" * 63 + "1" + "}" * 63, ok(nested_object(63)),
        "Object values nest exactly as array items do.",
    ))
    out.append(row(
        "0502-64-nested-objects-is-too-deep",
        "64 nested object literals around a literal: EXPR_TOO_DEEP",
        "{a:" * 64 + "1" + "}" * 64, TOO_DEEP,
        "The off-by-one partner of 0501.",
    ))
    out.append(row(
        "0601-63-nested-indices-is-depth-64",
        "x[x[...x[0]...]] with 63 indexings is depth 64 and evaluates",
        "x[" * 63 + "0" + "]" * 63, ok(0),
        "A computed index is a nested expression, so a path holding one is one level deeper than its deepest index.",
        context={"x": [0]},
    ))
    out.append(row(
        "0602-64-nested-indices-is-too-deep",
        "64 nested computed indices: EXPR_TOO_DEEP",
        "x[" * 64 + "0" + "]" * 64, TOO_DEEP,
        "The off-by-one partner of 0601.",
        context={"x": [0]},
    ))
    out.append(row(
        "0701-63-chained-ternaries-is-depth-64",
        "`false ? 0 :` chained 63 times before `1` is depth 64 and evaluates",
        "false ? 0 : " * 63 + "1", ok(1),
        "A right-nested ternary chain -- the `else if` shape -- recurses once per link.",
    ))
    out.append(row(
        "0702-64-chained-ternaries-is-too-deep",
        "64 chained ternaries: EXPR_TOO_DEEP",
        "false ? 0 : " * 64 + "1", TOO_DEEP,
        "The off-by-one partner of 0701.",
    ))

    # -- what does NOT count -----------------------------------------------------------
    out.append(row(
        "0801-a-long-dot-path-is-not-deep",
        "A path of 501 dot-segments is depth 1 and resolves (to null)",
        "a" + ".b" * 500, ok(None),
        "Dot-segments are read in a loop and walked in a loop; they nest nothing. An implementation that counted every segment as a level rejects a legitimate deep data path.",
    ))
    out.append(row(
        "0802-a-wide-array-is-not-deep",
        "An array literal of 1000 items is depth 2 and evaluates",
        "[" + ",".join(["1"] * 1000) + "]", ok([1] * 1000),
        "Width is bounded by the length limit, not the depth limit. An implementation that counted items rejects this.",
    ))
    out.append(row(
        "0803-groups-and-unary-both-count",
        "`!(` repeated 31 times around `true` is depth 63 and evaluates",
        "!(" * 31 + "true" + ")" * 31, ok(False),
        "Each `!(` is two levels: the unary operator and the group.",
    ))
    out.append(row(
        "0804-groups-and-unary-together-over",
        "`!(` repeated 32 times is depth 65: EXPR_TOO_DEEP",
        "!(" * 32 + "true" + ")" * 32, TOO_DEEP,
        "An implementation that counted either construct but not both passes 0803 and accepts this.",
    ))

    # -- codes -----------------------------------------------------------------------
    out.append(row(
        "0901-an-ordinary-syntax-error-is-expr-syntax",
        "A malformed expression within every limit carries EXPR_SYNTAX",
        "in.a &&", SYNTAX,
        "Every failure now carries a stable code, not only the new ones, so a host can branch on the code without parsing a message. The message stays human-facing and may change; the code may not.",
        tags=["expr", "limits", "codes"],
    ))

    return out


def manifest() -> dict[str, Any]:
    return {
        "$schema": "../../../schema/suite-manifest.schema.json",
        "suite": "expr/limits",
        "title": "The fancy-expr input bounds -- length in UTF-8 bytes and nesting depth, with stable error codes",
        "since": SINCE,
        "caseFormat": "table",
        "cases": "cases.json",
        "contract": {
            "function": "evaluate(expression: string, context: object) -> { ok: true, value: json } | { ok: false, code: 'EXPR_SYNTAX' | 'EXPR_TOO_LONG' | 'EXPR_TOO_DEEP' }",
            "summary": "The same evaluate() as expr/evaluate, with the failure side carrying the error's stable code. An expression longer than 8192 UTF-8 bytes is EXPR_TOO_LONG, checked before anything else. An expression whose nesting depth exceeds 64 is EXPR_TOO_DEEP, enforced during parsing so that no input can exhaust a runtime's stack. Depth is defined in GRAMMAR.md ('Limits'): every node is one level deeper than its deepest child, a parenthesised group counts as a level, and dot-segments and list width do not. Every other parse failure is EXPR_SYNTAX.",
            "reference": "node",
            "referenceNote": "Written BEFORE the implementations, like expr/evaluate. Measured on fancy-expr 0.1.1 before the fix: all 15 out-of-limit rows fail in all three runtimes (Node and Python crash their stacks on 0103, 0104 and 0303; PHP returns a value or a code-less syntax error), and all 12 within-limit rows pass, which is how their goldens were checked.",
            "implementations": [
                {"language": "node", "package": "@particle-academy/fancy-expr", "symbol": "evaluate + ExprSyntaxError.code"},
                {"language": "php", "package": "particle-academy/fancy-expr", "symbol": "FancyExpr\\Expr::evaluate + ExprSyntaxError::$code"},
                {"language": "python", "package": "fancy-expr", "symbol": "fancy_expr.evaluate + ExprSyntaxError.code"},
            ],
        },
        "notes": [
            "WHY. fancy-expr's parser is plain recursive descent and had no bound on input length or nesting. `((((...` from an end user or an agent -- the people this grammar exists to accept input from -- overflowed the stack in every runtime, and a stack overflow is not ExprSyntaxError, so a host that validates expressions at save time crashed instead of refusing. document templates (fancy-template) evaluate user-supplied `$if` conditions through this grammar, which is what made it a prerequisite.",
            "TWO MECHANISMS, ONE DEFINITION. A finished-tree depth check alone cannot work: the parser must finish to build the tree, and finishing is the recursion that overflows (0104). A recursion counter alone is not enough either: a 4000-term sum parses in a loop and only overflows when EVALUATED (0303). So depth is checked both on the way down (a level is refused once it is known to exceed the limit) and on the way up (each finished node's depth). Both measure the same definition, so the verdict is the same whichever fires.",
            "LENGTH IS UTF-8 BYTES (0004). Each runtime's native string length counts a different unit, and a bound measured three ways is three bounds.",
            "THE OK ROWS ARE NOT PADDING. Every limit row has an at-the-limit partner that must still evaluate, because 'refuse everything long or nested' passes every out-of-limit row. 0801-0803 pin what does NOT count: dot-segments, width, and that groups and unary count together.",
            "THE LIMITS ARE FIXED, NOT CONFIGURABLE, in this version. A host that wants a tighter bound (fancy-template's 512-byte token limit) applies it before calling in; a looser one is not offered, because the depth limit is what keeps every runtime's default stack safe.",
        ],
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    table = {"$schema": "../../../schema/case-table.schema.json", "suite": "expr/limits", "cases": cases()}
    (OUT / "cases.json").write_text(json.dumps(table, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    (OUT / "manifest.json").write_text(json.dumps(manifest(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {len(table['cases'])} cases to {OUT}")


if __name__ == "__main__":
    main()
