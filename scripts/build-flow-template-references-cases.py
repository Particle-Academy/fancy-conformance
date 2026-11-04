"""Generate `flow/template-references` by RUNNING the reference.

    python scripts/build-flow-template-references-cases.py [--flow ../fancy-flow-php] [--write]

The inputs are written here; every golden is whatever fancy-flow-php's
`TemplateReferences` says, never what a value obviously ought to be. Without
--write it prints each row whose golden would change and exits 1 if any would, so
it doubles as a drift check. Rows append: ids are never renumbered.
"""

# ruff: noqa: E501
# A row's title is fixture text. It is read as one line, in the table and here.

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CASES = ROOT / "suites" / "flow" / "template-references" / "cases.json"
REFERENCE = ROOT / "scripts" / "flow-template-references-reference.php"
SINCE = "0.46.0"

LLM = ("llm_call", {"model": "m", "prompt": "x"})
TRIGGER = ("manual_trigger", {})


def graph(nodes: dict, edges: list) -> dict:
    return {
        "$schema": "https://particle.academy/schemas/workflow/v1.json",
        "version": 1,
        "graph": {
            "nodes": [
                {"id": node_id, "kind": kind, "position": {"x": 0, "y": 0}, "config": config}
                for node_id, (kind, config) in nodes.items()
            ],
            "edges": [
                {
                    "id": f"e{index}",
                    "source": edge[0],
                    "target": edge[1],
                    **({"sourceHandle": edge[2]} if len(edge) > 2 and edge[2] else {}),
                    **({"targetHandle": edge[3]} if len(edge) > 3 and edge[3] else {}),
                }
                for index, edge in enumerate(edges)
            ],
        },
    }


def row(slug: str, title: str, tags: list, nodes: dict, edges: list) -> dict:
    return {"slug": slug, "title": title, "tags": tags, "schema": graph(nodes, edges)}


def log(template: str) -> tuple:
    return ("log", {"message": template})


ROWS = [
    row(
        "wrong-field-is-found",
        "A template naming a field the upstream kind does not declare is found, with what it could have named.",
        ["finds", "static-shape"],
        {"t": TRIGGER, "a": LLM, "o": log("{{ in.txt }}")},
        [("t", "a"), ("a", "o")],
    ),
    row(
        "declared-field-is-silent",
        "A template naming a declared field is silent.",
        ["silent", "static-shape"],
        {"t": TRIGGER, "a": LLM, "o": log("{{ in.text }}")},
        [("t", "a"), ("a", "o")],
    ),
    row(
        "null-shape-refuses-nothing",
        "A kind with no declared shape is UNKNOWN, so any field is silent. This is the row that catches null read as empty.",
        ["silent", "unknown"],
        {"t": TRIGGER, "u": ("tool_use", {"tool": "x"}), "o": log("{{ in.anything }}")},
        [("t", "u"), ("u", "o")],
    ),
    row(
        "passthrough-carries-the-shape",
        "A kind whose relation is `input` passes the upstream shape through, on every port it publishes.",
        ["finds", "relation-input"],
        {
            "t": TRIGGER,
            "a": LLM,
            "b": ("branch", {"condition": "{{ in.text }}"}),
            "y": log("{{ in.txt }}"),
        },
        [("t", "a"), ("a", "b"), ("b", "y", "true")],
    ),
    row(
        "passthrough-of-unknown-is-unknown",
        "A passthrough whose source is unknown stays unknown.",
        ["silent", "unknown", "relation-input"],
        {
            "t": TRIGGER,
            "b": ("branch", {"condition": "{{ in.flag }}"}),
            "y": log("{{ in.whatever }}"),
        },
        [("t", "b"), ("b", "y", "true")],
    ),
    row(
        "entry-point-is-not-judged",
        "A node with no inbound edge reads what the host seeded, so nothing on it is judged.",
        ["silent", "entry-point"],
        {"o": log("{{ in.x }} {{ y }}")},
        [],
    ),
    row(
        "for-each-item-is-unknown-and-done-is-not",
        "The for_each shape describes `done`. The `item` port carries one element of the list and is never judged against it.",
        ["finds", "silent", "for-each"],
        {
            "t": TRIGGER,
            "e": ("for_each", {"source": "{{ in.users }}"}),
            "per": log("{{ in.name }}"),
            "after": log("{{ in.nope }} {{ in.count }}"),
        },
        [("t", "e"), ("e", "per", "item"), ("e", "after", "done")],
    ),
    row(
        "rejoined-sources-union",
        "Edges rejoining on one port deliver one payload per run, so a field any source declares is present.",
        ["finds", "rejoin"],
        {
            "t": TRIGGER,
            "a": LLM,
            "b": ("api_request", {"url": "https://example.test/"}),
            "o": log("{{ in.text }} {{ in.status }} {{ in.zzz }}"),
        },
        [("t", "a"), ("t", "b"), ("a", "o"), ("b", "o")],
    ),
    row(
        "one-unknown-source-makes-the-port-unknown",
        "One unknown source on a port makes the whole port unknown.",
        ["silent", "rejoin", "unknown"],
        {"t": TRIGGER, "a": LLM, "b": ("tool_use", {"tool": "x"}), "o": log("{{ in.zzz }}")},
        [("t", "a"), ("t", "b"), ("a", "o"), ("b", "o")],
    ),
    row(
        "deeper-than-a-declared-field",
        "A path deeper than a declared field is silent: the field may be an object nobody described.",
        ["silent", "paths"],
        {
            "t": TRIGGER,
            "h": ("api_request", {"url": "https://example.test/"}),
            "o": log("{{ in.body.items.0.name }} {{ in.headers }}"),
        },
        [("t", "h"), ("h", "o")],
    ),
    row(
        "every-spelling-of-the-input",
        "`in`, `$json`, `$input` and a handle-less edge's source id all read the same wire.",
        ["finds", "heads"],
        {
            "t": TRIGGER,
            "a": LLM,
            "o": log(
                "{{ in.a1 }} {{ $json.a2 }} {{ $input.a3 }} {{ a.a4 }} {{ in.text }} {{ $json }} {{ in }}"
            ),
        },
        [("t", "a"), ("a", "o")],
    ),
    row(
        "a-named-port-and-an-unknown-head",
        "A wired port name is judged. A head that is not a wired port cannot be proved and is silent.",
        ["finds", "silent", "heads"],
        {"t": TRIGGER, "a": LLM, "m": log("{{ p.text }} {{ p.nope }} {{ unrelated.thing }}")},
        [("t", "a"), ("a", "m", None, "p")],
    ),
    row(
        "not-a-dot-path-is-not-judged",
        "A template that is not a plain dot-path, an empty one and an unterminated one are all silent here.",
        ["silent", "grammar"],
        {"t": TRIGGER, "a": LLM, "o": log("{{ { id: $json.id } }} {{ a && b }} {{ }} {{ unclosed")},
        [("t", "a"), ("a", "o")],
    ),
    row(
        "merge-is-the-union-of-its-ports",
        "`merge` emits the union of every port's payload fields.",
        ["finds", "relation-inputs-merged"],
        {
            "t": TRIGGER,
            "a": LLM,
            "b": ("api_request", {"url": "https://example.test/"}),
            "m": ("merge", {}),
            "o": log("{{ in.text }} {{ in.status }} {{ in.gone }}"),
        },
        [("t", "a"), ("t", "b"), ("a", "m", None, "a"), ("b", "m", None, "b"), ("m", "o")],
    ),
    row(
        "merge-concat-is-unknown",
        "`merge` in concat mode builds a list and declares nothing, which is not the same as no fields.",
        ["silent", "unknown"],
        {"t": TRIGGER, "a": LLM, "m": ("merge", {"mode": "concat"}), "o": log("{{ in.gone }}")},
        [("t", "a"), ("a", "m", None, "a"), ("m", "o")],
    ),
    row(
        "single-reference-expression-carries-the-shape",
        "A `variable` holding exactly one reference emits that reference's shape.",
        ["finds", "relation-expression"],
        {
            "t": TRIGGER,
            "a": LLM,
            "v": ("variable", {"name": "v", "value": "{{ in }}"}),
            "o": log("{{ in.text }} {{ in.nope }}"),
        },
        [("t", "a"), ("a", "v"), ("v", "o")],
    ),
    row(
        "interpolated-expression-is-unknown",
        "Interpolating produces a string with no addressable fields. It must not be expanded into the source's shape.",
        ["silent", "relation-expression"],
        {
            "t": TRIGGER,
            "a": LLM,
            "v": ("variable", {"name": "v", "value": "x {{ in.text }} y"}),
            "o": log("{{ in.anything }}"),
        },
        [("t", "a"), ("a", "v"), ("v", "o")],
    ),
    row(
        "transform-fields-rows-are-read",
        "A transform's `fields` rows are templates. The object it builds declares nothing, so what follows is unknown.",
        ["finds", "silent", "transform"],
        {
            "t": TRIGGER,
            "a": LLM,
            "tf": (
                "transform",
                {"mode": "fields", "fields": [{"key": "k", "value": "{{ in.txt }}"}]},
            ),
            "o": log("{{ in.whatever }}"),
        },
        [("t", "a"), ("a", "tf"), ("tf", "o")],
    ),
    row(
        "dynamic-shape-with-its-config",
        "`llm_call` gains `data` when a response schema is set: the shape is resolved from the node's own config.",
        ["silent", "dynamic-shape"],
        {
            "t": TRIGGER,
            "a": ("llm_call", {"model": "m", "prompt": "x", "response_schema": {"type": "object"}}),
            "o": log("{{ in.data.score }}"),
        },
        [("t", "a"), ("a", "o")],
    ),
    row(
        "dynamic-shape-without-its-config",
        "The same reference with no response schema is found.",
        ["finds", "dynamic-shape"],
        {"t": TRIGGER, "a": LLM, "o": log("{{ in.data.score }}")},
        [("t", "a"), ("a", "o")],
    ),
    row(
        "a-cycle-is-not-a-hang",
        "A back edge terminates and says nothing.",
        ["silent", "cycle"],
        {
            "a": ("branch", {"condition": "{{ in.x }}"}),
            "b": ("branch", {"condition": "{{ in.y }}"}),
        },
        [("a", "b", "true"), ("b", "a", "true")],
    ),
    row(
        "malformed-config-for-a-shape-function",
        "A shape computed from config that the config cannot satisfy is unknown, not a crash.",
        ["silent", "dynamic-shape", "hostile"],
        {"t": TRIGGER, "u": ("user_input", {"fields": ["not-an-object"]}), "o": log("{{ in.x }}")},
        [("t", "u"), ("u", "o")],
    ),
    row(
        "user-input-declares-its-own-keys",
        "`user_input` emits the keys its author defined.",
        ["finds", "dynamic-shape"],
        {
            "t": TRIGGER,
            "u": ("user_input", {"fields": [{"key": "email", "label": "Email"}]}),
            "o": log("{{ in.email }} {{ in.phone }}"),
        },
        [("t", "u"), ("u", "o")],
    ),
    row(
        "wait-nests-rather-than-passes",
        "`wait` carries its input under `input`, so an inbound field is not top level.",
        ["finds", "nesting"],
        {
            "t": TRIGGER,
            "a": LLM,
            "w": ("wait", {"mode": "duration", "duration": "1s"}),
            "o": log("{{ in.text }} {{ in.input.text }}"),
        },
        [("t", "a"), ("a", "w"), ("w", "o")],
    ),
    row(
        "credential-fields-are-not-templates",
        "A credential field is a reference to a host secret, never a template.",
        ["silent", "config-keys"],
        {
            "t": TRIGGER,
            "a": LLM,
            "n": ("human_approval", {"channel": "{{ in.nope }}"}),
        },
        [("t", "a"), ("a", "n")],
    ),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--flow", default=str(ROOT.parent / "fancy-flow-php"))
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    php = shutil.which("php")
    if php is None:
        print("php is not on PATH", file=sys.stderr)
        return 2

    result = subprocess.run(
        [php, str(REFERENCE), args.flow],
        input=json.dumps([r["schema"] for r in ROWS]).encode("utf-8"),
        capture_output=True,
    )
    if result.returncode != 0:
        print(result.stderr.decode("utf-8", "replace"), file=sys.stderr)
        return 2

    goldens = json.loads(result.stdout)
    if len(goldens) != len(ROWS):
        print(f"reference returned {len(goldens)} goldens for {len(ROWS)} rows", file=sys.stderr)
        return 2

    existing = json.loads(CASES.read_text(encoding="utf-8")) if CASES.exists() else {"cases": []}
    old = {case["id"]: case["expected"] for case in existing["cases"]}

    cases = []
    drift = 0
    for index, (spec, golden) in enumerate(zip(ROWS, goldens, strict=True), start=1):
        case_id = f"{index:04d}-{spec['slug']}"
        if case_id in old and old[case_id] != golden:
            drift += 1
            print(f"{case_id}: {json.dumps(old[case_id])} -> {json.dumps(golden)}")
        cases.append(
            {
                "id": case_id,
                "title": spec["title"],
                "since": SINCE,
                "tags": spec["tags"],
                "input": {"schema": spec["schema"]},
                "expected": golden,
            }
        )

    if not args.write:
        missing = [case["id"] for case in cases if case["id"] not in old]
        for case_id in missing:
            print(f"{case_id}: not written yet")
        return 1 if drift or missing else 0

    table = {
        "$schema": "../../../schema/case-table.schema.json",
        "suite": "flow/template-references",
        "cases": cases,
    }
    text = json.dumps(table, indent=2, ensure_ascii=False) + "\n"
    CASES.parent.mkdir(parents=True, exist_ok=True)
    CASES.write_text(text, encoding="utf-8", newline="\n")
    print(
        f"wrote {len(cases)} rows, {sum(1 for c in cases if c['expected'])} of them with findings"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
