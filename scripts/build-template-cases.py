# ruff: noqa: E501 -- the rows are data tables: titles and notes are prose and expected documents are literal JSON, and wrapping them changes nothing a reader needs.
"""Generate the `template/*` suites (fancy-template's conformance corpus).

Written BEFORE any implementation, against fancy-template's SPEC.md. Every
expected document below is written out by hand from the spec; the only things
computed here are MEASUREMENTS a person should not type -- byte sizes, node
counts, weekday names, the markdown escape of a string -- and each is computed
by a small function whose definition is the spec's sentence.

    python scripts/build-template-cases.py

Backslashes are produced with chr(92) rather than written in string literals,
because this estate has had literal backslashes collapse in transit more than
once (RULES.md, "the measuring instrument can be the thing that lies").
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import struct
import zlib
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent / "suites" / "template"
SINCE = "0.35.0"
BS = chr(92)

SPEC_REF = "fancy-template SPEC.md"

# ---------------------------------------------------------------------------
# fixtures-wide helpers
# ---------------------------------------------------------------------------


def png_bytes() -> bytes:
    """A real 1x1 PNG, built here so no binary is committed."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\xff\x00\x00")
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def data_url(mime: str, raw: bytes) -> str:
    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")


PNG = data_url("image/png", png_bytes())
JPEG = data_url("image/jpeg", b"\xff\xd8\xff\xe0" + b"\x00" * 12)
GIF = data_url("image/gif", b"GIF89a" + b"\x00" * 10)
PNG_LABEL_JPEG_BYTES = data_url("image/png", b"\xff\xd8\xff\xe0" + b"\x00" * 12)


def env(document: Any, variables: Any = None, writer: str = "fine-print") -> dict[str, Any]:
    out: dict[str, Any] = {"fancyTemplate": 1, "writer": writer}
    if variables is not None:
        out["variables"] = variables
    out["document"] = document
    return out


def doc(*blocks: Any, **extra: Any) -> dict[str, Any]:
    out: dict[str, Any] = dict(extra)
    out["blocks"] = list(blocks)
    return out


def para(*texts: str) -> dict[str, Any]:
    return {"type": "paragraph", "runs": [{"text": t} for t in texts]}


def ok_doc(document: Any) -> dict[str, Any]:
    return {"ok": True, "document": document}


def err(code: str, path: str) -> dict[str, Any]:
    return {"ok": False, "code": code, "path": path}


def S(**k: Any) -> dict[str, Any]:  # noqa: N802 -- one-letter schema helpers keep the rows readable
    return {"type": "string", **k}


def utf8(s: str) -> int:
    return len(s.encode("utf-8"))


def template_bytes(value: Any) -> int:
    """SPEC 10: UTF-8 bytes of every string in the envelope, keys included."""
    if isinstance(value, str):
        return utf8(value)
    if isinstance(value, dict):
        return sum(utf8(k) + template_bytes(v) for k, v in value.items())
    if isinstance(value, list):
        return sum(template_bytes(v) for v in value)
    return 0


def output_nodes(value: Any) -> int:
    """SPEC 10: each object, array and scalar is one value."""
    if isinstance(value, dict):
        return 1 + sum(output_nodes(v) for v in value.values())
    if isinstance(value, list):
        return 1 + sum(output_nodes(v) for v in value)
    return 1


def output_bytes(value: Any) -> int:
    """SPEC 10: UTF-8 bytes of every string VALUE in the output (keys excluded)."""
    if isinstance(value, str):
        return utf8(value)
    if isinstance(value, dict):
        return sum(output_bytes(v) for v in value.values())
    if isinstance(value, list):
        return sum(output_bytes(v) for v in value)
    return 0


def deepest_level(value: Any, level: int = 1) -> int:
    """SPEC 10: the outermost container is level 1."""
    if isinstance(value, dict):
        return max([level] + [deepest_level(v, level + 1) for v in value.values()])
    if isinstance(value, list):
        return max([level] + [deepest_level(v, level + 1) for v in value])
    return level - 1


def first_container_above(value: Any, limit: int, path: str = "", level: int = 1) -> str | None:
    """The JSON Pointer of the first container, in document order, at a level above `limit`."""
    if not isinstance(value, (dict, list)):
        return None
    if level > limit:
        return path
    items = value.items() if isinstance(value, dict) else enumerate(value)
    for k, v in items:
        found = first_container_above(v, limit, f"{path}/{k}", level + 1)
        if found is not None:
            return found
    return None


def md_escape(s: str) -> str:
    """SPEC 9: CommonMark backslash escape of every ASCII punctuation character."""
    punct = "!\"#$%&'()*+,-./:;<=>?@[" + BS + "]^_`{|}~"
    return "".join(BS + ch if ch in punct else ch for ch in s)


def html_escape(s: str) -> str:
    """SPEC 9: & < > " ' as entities, ampersand first."""
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def date_text(iso: str, pattern_python: str) -> str:
    """Only used for WEEKDAY and MONTH NAMES, which a person should not compute by hand."""
    return dt.date.fromisoformat(iso).strftime(pattern_python)


# ---------------------------------------------------------------------------
# case writer
# ---------------------------------------------------------------------------


class Suite:
    def __init__(self, name: str) -> None:
        self.name = name
        self.cases: list[dict[str, Any]] = []

    def add(
        self,
        id_: str,
        title: str,
        fn: str,
        input_: dict[str, Any],
        expected: Any,
        notes: str,
        skip: dict[str, str] | None = None,
        tags: list[str] | None = None,
    ) -> None:
        row: dict[str, Any] = {
            "id": id_,
            "title": title,
            "since": SINCE,
            "tags": tags or ["template", self.name.split("/")[1]],
            "fn": fn,
            "input": input_,
            "expected": expected,
            "notes": notes,
        }
        if skip:
            row["skip"] = skip
        self.cases.append(row)

    def render(
        self,
        id_: str,
        title: str,
        template: Any,
        data: Any,
        expected: Any,
        notes: str,
        options: dict[str, Any] | None = None,
        **kw: Any,
    ) -> None:
        inp: dict[str, Any] = {"template": template, "data": data}
        if options:
            inp["options"] = options
        self.add(id_, title, "render", inp, expected, notes, **kw)


PHASE6_DS = {
    "php": "The dark-slide profile is phase 6 of the plan (TS + Python legs; holy-sheet and dark-slide profiles). The PHP leg implements fine-print and last-word only; this row is the spec it will be built against."
}
PHASE6_HS = {
    "php": "The holy-sheet profile is phase 6 of the plan (TS + Python legs; holy-sheet and dark-slide profiles). The PHP leg implements fine-print and last-word only; this row is the spec it will be built against."
}

# ---------------------------------------------------------------------------
# template/tokenize
# ---------------------------------------------------------------------------


def tokenize_suite() -> Suite:
    s = Suite("template/tokenize")

    def tok(
        id_: str,
        title: str,
        text: str,
        expected: Any,
        notes: str,
        options: dict[str, Any] | None = None,
    ) -> None:
        inp: dict[str, Any] = {"text": text}
        if options:
            inp["options"] = options
        s.add(id_, title, "tokenize", inp, expected, notes)

    def okp(*parts: Any) -> dict[str, Any]:
        return {"ok": True, "parts": list(parts)}

    def bad(code: str) -> dict[str, Any]:
        return {"ok": False, "code": code}

    def path(*segs: str, filters: list[dict[str, str]] | None = None) -> dict[str, Any]:
        return {"path": list(segs), "filters": filters or []}

    tok(
        "0001-plain-text",
        "Text with no token is one text part",
        "Hello",
        okp({"text": "Hello"}),
        "The baseline.",
    )
    tok(
        "0002-empty-string",
        "The empty string has no parts",
        "",
        okp(),
        "Not one empty text part: empty text is omitted, so a consumer never iterates over a part that renders nothing.",
    )
    tok(
        "0003-token-in-text",
        "A token between two texts",
        "Dear {{ name }},",
        okp({"text": "Dear "}, path("name"), {"text": ","}),
        "Whitespace inside the braces is not part of the path.",
    )
    tok(
        "0004-no-inner-whitespace",
        "Whitespace inside the braces is optional",
        "{{name}}",
        okp(path("name")),
        "",
    )
    tok(
        "0005-tabs-are-whitespace",
        "Tabs count as whitespace inside a token",
        "{{\t name \t}}",
        okp(path("name")),
        "SPEC 5: ws is space or TAB, and nothing else.",
    )
    tok(
        "0006-dotted-path-with-index",
        "A path walks names and array indices",
        "{{ a.b.0.c }}",
        okp(path("a", "b", "0", "c")),
        'Digits are a segment, kept as the STRING "0": the path is data about the template, and a number there would invite arithmetic.',
    )
    tok(
        "0007-loop-binding-head",
        "`$index` is a valid head",
        "{{ $index }}",
        okp(path("$index")),
        "",
    )
    tok(
        "0008-unknown-dollar-head-is-syntax",
        "Any other `$` head is TOKEN_SYNTAX",
        "{{ $foo }}",
        bad("TOKEN_SYNTAX"),
        "Only $index, $first and $last exist. An agent reaching for $now or $today -- the shape fancy-expr's references() exists to catch -- is refused while it is still a typo.",
    )
    tok(
        "0009-filter-chain-with-quoted-arg",
        "Filters chain left to right; a quoted argument keeps its spaces and comma",
        '{{ d | date:"MMMM d, yyyy" | upper }}',
        okp(path("d", filters=[{"name": "date", "arg": "MMMM d, yyyy"}, {"name": "upper"}])),
        "A filter with no argument has no `arg` key at all, rather than an empty one.",
    )
    tok(
        "0010-bare-arguments",
        "A bare argument is a string too",
        "{{ n | number:2 | default:none }}",
        okp(
            path("n", filters=[{"name": "number", "arg": "2"}, {"name": "default", "arg": "none"}])
        ),
        '`2` is the string "2": a filter decides what its argument means, not the tokenizer.',
    )
    tok(
        "0011-escapes-in-a-quoted-argument",
        "Inside quotes, backslash escapes a quote and a backslash",
        '{{ x | default:"say ' + BS + '"hi' + BS + '" ' + BS + BS + ' bye" }}',
        okp(path("x", filters=[{"name": "default", "arg": 'say "hi" ' + BS + " bye"}])),
        "The only two escapes. Generated with chr(92); see the generator's docstring.",
    )
    tok(
        "0012-literal-open-braces",
        '`{{ "{{" }}` is how a literal `{{` is written',
        '{{ "{{" }}',
        okp({"literal": "{{", "filters": []}),
        "There is no other escape. One way to say it is one thing to get right in three languages.",
    )
    tok(
        "0013-close-braces-inside-a-string-do-not-close",
        "`}}` inside a string literal does not end the token",
        'a{{ "}}" }}b',
        okp({"text": "a"}, {"literal": "}}", "filters": []}, {"text": "b"}),
        "The scanner skips string literals while looking for the close. A scanner that searched for the first `}}` would cut this token in half.",
    )
    tok(
        "0014-lone-close-braces-are-text",
        "A `}}` outside a token is literal text",
        "a }} b",
        okp({"text": "a }} b"}),
        "Only `{{` is special in text.",
    )
    tok(
        "0015-single-braces-are-text",
        "Single braces are literal text",
        "{a} {b}",
        okp({"text": "{a} {b}"}),
        "fine-print's own `{page}` lives in text like this, and must pass through untouched.",
    )
    tok(
        "0016-adjacent-tokens",
        "Two adjacent tokens are two parts",
        "{{a}}{{b}}",
        okp(path("a"), path("b")),
        "The corner fancy-flow once read as ONE path `a }}{{ b` (shared/expr 0023).",
    )
    tok(
        "0017-unclosed",
        "No closing `}}` is TOKEN_UNCLOSED",
        "Hi {{ name",
        bad("TOKEN_UNCLOSED"),
        "Never literal text: an author who forgot the braces must hear about it, not ship them.",
    )
    tok(
        "0018-unclosed-string-is-unclosed",
        "A string literal that never closes reaches the end: TOKEN_UNCLOSED",
        '{{ "abc }}',
        bad("TOKEN_UNCLOSED"),
        "The `}}` is inside the unterminated string, so the token has no end.",
    )
    tok(
        "0019-empty-token",
        "Only whitespace between the braces is TOKEN_EMPTY",
        "{{ }}",
        bad("TOKEN_EMPTY"),
        "",
    )
    tok(
        "0020-newline-in-a-token",
        "A newline inside a token is TOKEN_SYNTAX",
        "{{ a\n}}",
        bad("TOKEN_SYNTAX"),
        "Tokens are single-line. A newline inside one is almost always a missing `}}` further up, and refusing it points at the right place.",
    )
    tok(
        "0021-dangling-dot",
        "A path ending in `.` is TOKEN_SYNTAX",
        "{{ a. }}",
        bad("TOKEN_SYNTAX"),
        "",
    )
    tok(
        "0022-triple-braces",
        "`{{{ a }}}` is TOKEN_SYNTAX, not a token in braces",
        "{{{ a }}}",
        bad("TOKEN_SYNTAX"),
        "`{{` opens at offset 0 and the inner text begins with `{`. There is no triple-brace form, and inventing a reading of it would be a guess.",
    )
    tok(
        "0023-filter-names-are-lowercase",
        "A capitalised filter name is TOKEN_SYNTAX",
        "{{ a | Upper }}",
        bad("TOKEN_SYNTAX"),
        "The grammar's fname is [a-z]+. Unknown-but-well-formed names are inspect's FILTER_UNKNOWN; this is a different failure, at a different layer.",
    )
    tok(
        "0024-trailing-pipe",
        "A pipe with no filter is TOKEN_SYNTAX",
        "{{ a | }}",
        bad("TOKEN_SYNTAX"),
        "",
    )
    inner_512 = " " + "a" * 510 + " "
    tok(
        "0025-token-at-the-length-limit",
        "A token whose inner text is exactly 512 bytes tokenizes",
        "{{" + inner_512 + "}}",
        okp(path("a" * 510)),
        "The limit is INCLUSIVE and counts every byte between the braces, whitespace too.",
    )
    tok(
        "0026-token-one-byte-over",
        "513 bytes between the braces is TOKEN_TOO_LONG",
        "{{" + inner_512 + " }}",
        bad("TOKEN_TOO_LONG"),
        "The off-by-one partner of 0025.",
    )
    tok(
        "0027-long-unclosed-token-is-too-long",
        "An unclosed token longer than the limit is TOKEN_TOO_LONG, not TOKEN_UNCLOSED",
        "{{ " + "a" * 600,
        bad("TOKEN_TOO_LONG"),
        "Pins the ORDER: the scan for `}}` stops at the limit, so a hostile string of a million bytes after `{{` costs 512 bytes of work to refuse. An implementation that found the end first reports TOKEN_UNCLOSED here and scanned everything to do it.",
    )
    tok(
        "0028-unicode-text-is-preserved",
        "Non-ASCII text around a token is untouched",
        "Łódź — {{ city }}",
        okp({"text": "Łódź — "}, path("city")),
        "",
    )
    tok(
        "0029-a-path-cannot-start-with-digits",
        "A head of digits is TOKEN_SYNTAX",
        "{{ 0 }}",
        bad("TOKEN_SYNTAX"),
        "Digits are only valid after a dot. A bare number would look like a literal that the grammar does not have.",
    )
    tok(
        "0030-whitespace-around-the-colon",
        "Whitespace is allowed around a filter's colon",
        "{{ a | number : 2 }}",
        okp(path("a", filters=[{"name": "number", "arg": "2"}])),
        "",
    )
    tok(
        "0031-two-paths-is-syntax",
        "Two paths in one token is TOKEN_SYNTAX",
        "{{ a b }}",
        bad("TOKEN_SYNTAX"),
        "",
    )
    tok(
        "0032-token-length-is-host-overridable",
        "options.limits.tokenLength lowers the bound",
        "{{ recipientName }}",
        bad("TOKEN_TOO_LONG"),
        "15 bytes between the braces against a limit of 10.",
        options={"limits": {"tokenLength": 10}},
    )
    return s


# ---------------------------------------------------------------------------
# template/resolve (render, validateData, preview)
# ---------------------------------------------------------------------------

CERT_VARS = {
    "recipientName": S(required=True, maxLength=200, example="Ada Lovelace"),
    "programName": S(required=True, example="Analytical Engines"),
    "subtitle": S(),
    "issuer": S(default="Particle Academy"),
    "tags": {"type": "array", "items": S()},
    "program": {
        "type": "object",
        "properties": {"name": S(required=True), "hours": {"type": "integer", "default": 10}},
    },
}


def resolve_suite() -> Suite:
    s = Suite("template/resolve")
    base = {"recipientName": "Ada Lovelace", "programName": "Analytical Engines"}

    s.render(
        "0001-a-token-in-a-run",
        "A token in run text is replaced by the value",
        env(doc(para("{{ recipientName }}")), CERT_VARS),
        base,
        ok_doc(doc(para("Ada Lovelace"))),
        "The whole feature in one row.",
    )
    s.render(
        "0002-two-tokens-and-text",
        "Several tokens and text in one string",
        env(doc(para("{{ recipientName }} completed {{ programName }}.")), CERT_VARS),
        base,
        ok_doc(doc(para("Ada Lovelace completed Analytical Engines."))),
        "",
    )
    s.render(
        "0003-title-takes-tokens",
        "The document title is a text field",
        env({"title": "Certificate for {{ recipientName }}", "blocks": []}, CERT_VARS),
        base,
        ok_doc({"title": "Certificate for Ada Lovelace", "blocks": []}),
        "",
    )
    s.render(
        "0004-declared-default-fills-an-absent-value",
        "An absent variable with a declared default takes it",
        env(doc(para("Issued by {{ issuer }}")), CERT_VARS),
        base,
        ok_doc(doc(para("Issued by Particle Academy"))),
        "",
    )
    s.render(
        "0005-nested-property-and-nested-default",
        "A dotted path walks an object; a property's own default applies",
        env(doc(para("{{ program.name }}: {{ program.hours }} hours")), CERT_VARS),
        {**base, "program": {"name": "Engines"}},
        ok_doc(doc(para("Engines: 10 hours"))),
        "Defaults apply at every level (SPEC 4), and an integer in a text field is its digits.",
    )
    nums = {f"n{i}": {"type": "number"} for i in range(1, 8)}
    s.render(
        "0006-numbers-stringify-like-javascript",
        "A number in a text field is JavaScript's Number#toString",
        env(
            doc(
                para(
                    "{{ n1 }}",
                    "{{ n2 }}",
                    "{{ n3 }}",
                    "{{ n4 }}",
                    "{{ n5 }}",
                    "{{ n6 }}",
                    "{{ n7 }}",
                )
            ),
            nums,
        ),
        {"n1": 42, "n2": 0.1, "n3": 3.0, "n4": 1e21, "n5": 1.5e-7, "n6": -0.0, "n7": 123456789.125},
        ok_doc(doc(para("42", "0.1", "3", "1e+21", "1.5e-7", "0", "123456789.125"))),
        "The cross-language row. PHP's (string) of a float uses `precision` (14 digits) and its json_encode uses `serialize_precision` and writes 1.0e+21; Python's str writes 3.0 and 1e+21; only one of the three is the spec. -0 is \"0\", as in JavaScript.",
    )
    s.render(
        "0007-booleans-stringify",
        "A boolean in a text field is true or false",
        env(doc(para("{{ a }}/{{ b }}")), {"a": {"type": "boolean"}, "b": {"type": "boolean"}}),
        {"a": True, "b": False},
        ok_doc(doc(para("true/false"))),
        "Not 1 and the empty string, which is PHP's native cast.",
    )
    s.render(
        "0008-an-array-in-text-is-not-a-scalar",
        "An array in a text field is TEMPLATE_NOT_SCALAR",
        env(doc(para("Tags: {{ tags }}")), CERT_VARS),
        {**base, "tags": ["a", "b"]},
        err("TEMPLATE_NOT_SCALAR", "/document/blocks/0/runs/0/text"),
        "Never `Array`, `[object Object]` or a JSON dump. The way to write a list is `| join`.",
    )
    s.render(
        "0009-absent-optional-is-loud",
        "An absent optional variable in a token is TEMPLATE_MISSING",
        env(doc(para("{{ subtitle }}")), CERT_VARS),
        base,
        err("TEMPLATE_MISSING", "/document/blocks/0/runs/0/text"),
        "THE RULE the plan calls 'missing data is loud'. Not an empty string: an empty string is what laravel-courses' Blade templates silently produced. The path names the template field, never the data.",
    )
    s.render(
        "0010-array-index",
        "Digits index into an array",
        env(doc(para("{{ tags.1 }}")), CERT_VARS),
        {**base, "tags": ["first", "second"]},
        ok_doc(doc(para("second"))),
        "",
    )
    s.render(
        "0011-index-out-of-range-is-missing",
        "An index past the end is absent: TEMPLATE_MISSING",
        env(doc(para("{{ tags.5 }}")), CERT_VARS),
        {**base, "tags": ["first"]},
        err("TEMPLATE_MISSING", "/document/blocks/0/runs/0/text"),
        "Absent, not an error of a different kind and not an empty string.",
    )
    s.render(
        "0012-literal-open-braces-render",
        '`{{ "{{" }}` renders a literal `{{`',
        env(doc(para('{{ "{{" }} name }}')), CERT_VARS),
        base,
        ok_doc(doc(para("{{ name }}"))),
        "How an author writes about templates inside a template.",
    )
    s.render(
        "0013-non-string-values-are-untouched",
        "Numbers, booleans and token-free strings in the document pass through",
        env(
            doc(
                {
                    "type": "paragraph",
                    "align": "center",
                    "spaceAfter": 18,
                    "keepNext": True,
                    "runs": [{"text": "Plain {page}", "size": 30, "italic": True}],
                }
            ),
            CERT_VARS,
        ),
        base,
        ok_doc(
            doc(
                {
                    "type": "paragraph",
                    "align": "center",
                    "spaceAfter": 18,
                    "keepNext": True,
                    "runs": [{"text": "Plain {page}", "size": 30, "italic": True}],
                }
            )
        ),
        "Key order is the template's. `{page}` in a run is fine-print's business, not ours.",
    )
    s.render(
        "0014-render-validates-data-first",
        "Missing required data stops render with the DATA code and a data path",
        env(doc(para("{{ recipientName }}")), CERT_VARS),
        {"programName": "x"},
        err("DATA_REQUIRED", "/recipientName"),
        "SPEC 11: inspect, then validateData, then render; the first failure is thrown.",
    )
    s.render(
        "0015-render-inspects-first",
        "An undeclared token stops render before data is looked at",
        env(doc(para("{{ nope }}")), CERT_VARS),
        {},
        err("TOKEN_UNDECLARED", "/document/blocks/0/runs/0/text"),
        "The template is wrong whatever the data says, and that is the more useful thing to hear first.",
    )
    s.render(
        "0016-extra-data-is-ignored",
        "Data the template does not declare is ignored",
        env(doc(para("{{ recipientName }}")), CERT_VARS),
        {**base, "password": "hunter2"},
        ok_doc(doc(para("Ada Lovelace"))),
        "Not an error, and not reachable: inspect refuses any token naming an undeclared variable, so extra data can never reach a document (SPEC 4).",
    )

    # -- validateData ---------------------------------------------------------
    def vd(
        id_: str, title: str, variables: Any, data: Any, errors: list[tuple[str, str]], notes: str
    ) -> None:
        s.add(
            id_,
            title,
            "validateData",
            {"template": env(doc(), variables), "data": data},
            {"errors": [{"path": p, "code": c} for p, c in errors]},
            notes,
        )

    vd("0101-valid-data", "Valid data has no errors", CERT_VARS, base, [], "")
    vd(
        "0102-every-missing-required-is-listed",
        "Every absent required variable is listed, in declaration order",
        CERT_VARS,
        {},
        [("/recipientName", "DATA_REQUIRED"), ("/programName", "DATA_REQUIRED")],
        "All errors, not the first: a form should show every field at once.",
    )
    vd(
        "0103-null-is-not-a-value",
        "null is DATA_TYPE for any type",
        CERT_VARS,
        {**base, "subtitle": None},
        [("/subtitle", "DATA_TYPE")],
        "null is not absent. A host sending null for 'no subtitle' should omit the key; accepting null would give every variable two spellings of nothing.",
    )
    vd(
        "0104-max-length-counts-code-points",
        "maxLength counts code points, not bytes or UTF-16 units",
        {"a": S(maxLength=3), "b": S(maxLength=3), "c": S(maxLength=2)},
        {"a": "Łód", "b": "Łódź", "c": "😀😀"},
        [("/b", "DATA_MAX_LENGTH")],
        "JSON Schema's unit. Łód is 3 code points and 5 bytes; two emoji are 2 code points and 4 UTF-16 units. A byte count fails a, a UTF-16 count fails c.",
    )
    vd(
        "0105-number-types",
        'integer accepts 3.0, rejects 3.5; strings are never numbers; "true" is not a boolean',
        {
            "i": {"type": "integer"},
            "j": {"type": "integer"},
            "n": {"type": "number"},
            "b": {"type": "boolean"},
        },
        {"i": 3.0, "j": 3.5, "n": "3", "b": "true"},
        [("/j", "DATA_TYPE"), ("/n", "DATA_TYPE"), ("/b", "DATA_TYPE")],
        "No coercion of any kind.",
    )
    vd(
        "0106-enum",
        "A value outside enum is DATA_ENUM",
        {"tier": S(enum=["gold", "silver"])},
        {"tier": "bronze"},
        [("/tier", "DATA_ENUM")],
        "",
    )
    vd(
        "0107-dates",
        "Calendar dates and times are checked for real",
        {
            "a": {"type": "date"},
            "b": {"type": "date"},
            "c": {"type": "date"},
            "d": {"type": "date"},
            "e": {"type": "date"},
            "f": {"type": "date"},
        },
        {
            "a": "2024-02-29",
            "b": "2026-02-29",
            "c": "2026-10-27T25:00",
            "d": "27/10/2026",
            "e": "2026-10-27T14:05:09.5+05:30",
            "f": "2026-10-27T14:05Z",
        },
        [("/b", "DATA_FORMAT"), ("/c", "DATA_FORMAT"), ("/d", "DATA_FORMAT")],
        "2024 is a leap year and 2026 is not. A regex alone passes b.",
    )
    vd(
        "0108-images",
        "An image is a PNG or JPEG data URL whose bytes match its type",
        {
            "a": {"type": "image"},
            "b": {"type": "image"},
            "c": {"type": "image"},
            "d": {"type": "image"},
            "e": {"type": "image"},
            "f": {"type": "image"},
        },
        {
            "a": PNG,
            "b": JPEG,
            "c": GIF,
            "d": PNG_LABEL_JPEG_BYTES,
            "e": "data:image/png;base64,***",
            "f": "/etc/passwd",
        },
        [
            ("/c", "DATA_FORMAT"),
            ("/d", "DATA_FORMAT"),
            ("/e", "DATA_FORMAT"),
            ("/f", "DATA_FORMAT"),
        ],
        "d is labelled PNG and carries JPEG bytes: the magic-byte check, not the label, decides. f is a local path, which is exactly what dark-slide's ImageResolver would read off the host's disk.",
    )
    vd(
        "0109-nested-paths",
        "Errors inside objects and arrays carry their full pointer",
        {**CERT_VARS, "tags": {"type": "array", "maxItems": 2, "items": S()}},
        {**base, "program": {"name": 7}, "tags": ["a", 2, "c"]},
        [("/tags", "DATA_MAX_ITEMS"), ("/tags/1", "DATA_TYPE"), ("/program/name", "DATA_TYPE")],
        "Declaration order: tags is declared before program.",
    )
    vd(
        "0110-data-must-be-an-object",
        "Data that is not an object is DATA_TYPE at the root",
        CERT_VARS,
        ["Ada"],
        [("", "DATA_TYPE")],
        "",
    )
    vd(
        "0111-a-default-satisfies-required",
        "A required variable with a default may be absent",
        {"x": S(required=True, default="fallback")},
        {},
        [],
        "",
    )

    # -- preview ----------------------------------------------------------------
    def pv(id_: str, title: str, template: Any, expected: Any, notes: str) -> None:
        s.add(id_, title, "preview", {"template": template}, expected, notes)

    pv(
        "0201-preview-uses-examples",
        "preview renders each variable's example",
        env(
            doc(para("{{ recipientName }} / {{ programName }} / {{ issuer }}")),
            {k: CERT_VARS[k] for k in ("recipientName", "programName", "issuer")},
        ),
        ok_doc(doc(para("Ada Lovelace / Analytical Engines / Particle Academy"))),
        "issuer has no example and falls back to its default.",
    )
    pv(
        "0202-preview-needs-something",
        "A required variable with neither example nor default fails preview",
        env(doc(para("{{ x }}")), {"x": S(required=True)}),
        err("DATA_REQUIRED", "/x"),
        "A preview that invented a value would show the admin a document the real data cannot produce.",
    )
    return s


# ---------------------------------------------------------------------------
# template/filters
# ---------------------------------------------------------------------------


def filters_suite() -> Suite:
    s = Suite("template/filters")

    def f(
        id_: str,
        title: str,
        text: str,
        decl: dict[str, Any],
        data: dict[str, Any],
        expected_text: str | None,
        notes: str,
        error: tuple[str, str] | None = None,
    ) -> None:
        tpl = env(doc(para(text)), decl)
        exp = err(*error) if error else ok_doc(doc(para(expected_text)))
        s.render(id_, title, tpl, data, exp, notes)

    T = "/document/blocks/0/runs/0/text"  # noqa: N806
    v, n, i, d, a = (
        {"v": S()},
        {"v": {"type": "number"}},
        {"v": {"type": "integer"}},
        {"v": {"type": "date"}},
        {"v": {"type": "array", "items": {"type": "string"}}},
    )

    f(
        "0001-default-when-absent",
        "default replaces an absent value",
        '{{ v | default:"N/A" }}',
        v,
        {},
        "N/A",
        "",
    )
    f(
        "0002-default-when-present",
        "default passes a present value through",
        '{{ v | default:"N/A" }}',
        v,
        {"v": "Ada"},
        "Ada",
        "",
    )
    f(
        "0003-default-then-upper",
        "default first, then another filter",
        '{{ v | default:"none" | upper }}',
        v,
        {},
        "NONE",
        "Left to right.",
    )
    f(
        "0004-upper-before-default-is-missing",
        "A filter before default meets the absent value: TEMPLATE_MISSING",
        '{{ v | upper | default:"x" }}',
        v,
        {},
        None,
        "Order is meaning. `upper` is handed nothing and cannot invent something.",
        error=("TEMPLATE_MISSING", T),
    )
    f(
        "0005-bare-default-is-a-string",
        "A bare default argument is a string",
        "{{ v | default:0 }}",
        n,
        {},
        "0",
        "",
    )
    f(
        "0006-upper-ascii",
        "upper maps ASCII letters",
        "{{ v | upper }}",
        v,
        {"v": "ada lovelace"},
        "ADA LOVELACE",
        "",
    )
    f(
        "0007-upper-leaves-non-ascii",
        "upper leaves non-ASCII characters as they are",
        "{{ v | upper }}",
        v,
        {"v": "łukasz ß é"},
        "łUKASZ ß é",
        "ENGLISH ONLY in v1 (owner decision 4). Full Unicode case mapping differs between JavaScript, PHP and Python (ß, dotted I, final sigma), and PHP needs mbstring for it. Unchanged is wrong-looking but identical everywhere; a half-mapped string would be wrong AND different per runtime.",
    )
    f(
        "0008-lower",
        "lower maps ASCII letters",
        "{{ v | lower }}",
        v,
        {"v": "ÉCOLE Normale"},
        "École normale",
        "",
    )
    f(
        "0009-upper-on-a-number",
        "upper stringifies a scalar first",
        "{{ v | upper }}",
        n,
        {"v": 3},
        "3",
        "",
    )
    f(
        "0010-number-pads-and-groups",
        "number:2 pads and groups thousands",
        "{{ v | number:2 }}",
        n,
        {"v": 1234.5},
        "1,234.50",
        "",
    )
    f(
        "0011-number-rounds-in-decimal",
        "2.675 rounds to 2.68, not 2.67",
        "{{ v | number:2 }}",
        n,
        {"v": 2.675},
        "2.68",
        "The double nearest 2.675 is 2.67499999...; binary rounding (JavaScript's toFixed, PHP's round on the double) gives 2.67. The spec rounds the SHORTEST round-trip decimal, \"2.675\", which is what the author typed.",
    )
    f(
        "0012-number-1-005",
        "1.005 rounds to 1.01",
        "{{ v | number:2 }}",
        n,
        {"v": 1.005},
        "1.01",
        "The other classic.",
    )
    f(
        "0013-number-negative-zero",
        "A value rounding to zero has no sign",
        "{{ v | number:2 }}",
        n,
        {"v": -0.004},
        "0.00",
        "",
    )
    f(
        "0014-number-half-away-from-zero",
        "Halves round away from zero",
        "{{ v | number:0 }} {{ w | number:0 }}",
        {"v": {"type": "number"}, "w": {"type": "number"}},
        {"v": 0.5, "w": -2.5},
        "1 -3",
        "Not banker's rounding, which is Python's round() and gives 0 and -2.",
    )
    f(
        "0015-number-carry",
        "Rounding carries through the grouping",
        "{{ v | number:2 }}",
        n,
        {"v": 999999.995},
        "1,000,000.00",
        "",
    )
    f(
        "0016-number-huge",
        "A large integer keeps every digit",
        "{{ v | number:0 }}",
        n,
        {"v": 1e21},
        "1,000,000,000,000,000,000,000",
        "Shortest repr is 1e+21; the filter expands it rather than printing an exponent.",
    )
    f(
        "0017-number-on-a-string",
        "number on a string is FILTER_INPUT",
        "{{ v | number:2 }}",
        v,
        {"v": "12"},
        None,
        "No coercion.",
        error=("FILTER_INPUT", T),
    )
    f(
        "0018-money-usd",
        "money takes integer MINOR units",
        "{{ v | money:USD }}",
        i,
        {"v": 123450},
        "$1,234.50",
        "Never via a float: the amount is an integer the whole way.",
    )
    f(
        "0019-money-jpy",
        "JPY has no minor digits",
        "{{ v | money:JPY }}",
        i,
        {"v": 1234},
        "¥1,234",
        "",
    )
    f(
        "0020-money-kwd",
        "KWD has three, and no symbol",
        "{{ v | money:KWD }}",
        i,
        {"v": 1234567},
        "KWD 1,234.567",
        "A hard-coded 100 multiplies a Kuwaiti price by ten (shared/money-minor-units).",
    )
    f(
        "0021-money-negative",
        "A negative amount puts the sign before the symbol",
        "{{ v | money:EUR }}",
        i,
        {"v": -5},
        "-€0.05",
        "",
    )
    f(
        "0022-money-zero-and-code",
        "Zero pads; a currency without a symbol is written as its code",
        "{{ v | money:GBP }} {{ w | money:CHF }}",
        {"v": {"type": "integer"}, "w": {"type": "integer"}},
        {"v": 0, "w": 1},
        "£0.00 CHF 0.01",
        "",
    )
    f(
        "0023-money-english-grouping",
        "Grouping is English, not per-locale",
        "{{ v | money:INR }}",
        i,
        {"v": 100000000},
        "₹1,000,000.00",
        "Not the lakh grouping 10,00,000.00. One locale in v1 (owner decision 4).",
    )
    f(
        "0024-money-rejects-a-fraction",
        "money on a non-integer is FILTER_INPUT",
        "{{ v | money:USD }}",
        n,
        {"v": 12.5},
        None,
        "12.5 minor units is not an amount. Guessing major units here is how a price becomes a hundred times wrong.",
        error=("FILTER_INPUT", T),
    )
    weekday = date_text("2026-10-27", "%A")
    f(
        "0025-date-long",
        "date with month name",
        '{{ v | date:"MMMM d, yyyy" }}',
        d,
        {"v": "2026-10-27"},
        "October 27, 2026",
        "",
    )
    f(
        "0026-date-weekday",
        "date with weekday and short forms",
        '{{ v | date:"EEEE, d MMM yy" }}',
        d,
        {"v": "2026-10-27"},
        f"{weekday}, 27 Oct 26",
        "Weekday computed from the calendar by the generator.",
    )
    f(
        "0027-date-twelve-hour",
        "date with a 12-hour clock",
        '{{ v | date:"h:mm a" }}',
        d,
        {"v": "2026-10-27T14:05:09Z"},
        "2:05 PM",
        "",
    )
    f(
        "0028-date-midnight-and-noon",
        "Midnight is 12 AM, noon 12 PM",
        '{{ v | date:"hh a" }} {{ w | date:"hh a" }}',
        {"v": {"type": "date"}, "w": {"type": "date"}},
        {"v": "2026-10-27T00:00", "w": "2026-10-27T12:00"},
        "12 AM 12 PM",
        "",
    )
    f(
        "0029-date-quoted-literal",
        "Quoted text is literal, and '' is one quote",
        "{{ v | date:\"yyyy-MM-dd'T'HH:mm 'o''clock'\" }}",
        d,
        {"v": "2026-01-05T09:07"},
        "2026-01-05T09:07 o'clock",
        "",
    )
    f(
        "0030-date-offset-is-not-applied",
        "An offset is ignored: the wall-clock time is written as given",
        '{{ v | date:"HH:mm" }}',
        d,
        {"v": "2026-10-27T23:30:00-05:00"},
        "23:30",
        "No time-zone database in any runtime. Converting would need one, and a certificate's date should be the date the issuer wrote.",
    )
    f(
        "0031-date-on-a-non-date",
        "date on a string that is not a date is FILTER_INPUT",
        '{{ v | date:"d MMM" }}',
        v,
        {"v": "yesterday"},
        None,
        "",
        error=("FILTER_INPUT", T),
    )
    f(
        "0032-join-default-separator",
        'join without an argument uses ", "',
        "{{ v | join }}",
        a,
        {"v": ["a", "b", "c"]},
        "a, b, c",
        "",
    )
    f(
        "0033-join-separator-and-scalars",
        "join stringifies scalars",
        '{{ v | join:" / " }}',
        {"v": {"type": "array", "items": {"type": "number"}}},
        {"v": [1, 2.5]},
        "1 / 2.5",
        "",
    )
    f(
        "0034-join-empty",
        "join of an empty array is the empty string",
        "[{{ v | join }}]",
        a,
        {"v": []},
        "[]",
        "Present and empty, which is different from absent.",
    )
    f(
        "0035-join-nested-is-input-error",
        "join of an array holding an array is FILTER_INPUT",
        "{{ v | join }}",
        {"v": {"type": "array", "items": {"type": "array", "items": S()}}},
        {"v": [["x"]]},
        None,
        "",
        error=("FILTER_INPUT", T),
    )
    f(
        "0036-filter-on-a-literal",
        "Filters apply to a string literal too",
        '{{ "draft" | upper }}',
        {},
        {},
        "DRAFT",
        "",
    )
    f(
        "0037-default-keeps-a-present-empty-string",
        "default keeps a present empty string",
        '[{{ v | default:"N/A" }}]',
        v,
        {"v": ""},
        "[]",
        'Present and empty is not absent (SPEC 7: the input unchanged if present). A `default` that also replaced "" would quietly turn a deliberate blank into placeholder text. Added after fancy-template\'s sabotage pass found that no row pinned it: treating "" as absent left every other row green.',
    )
    return s


# ---------------------------------------------------------------------------
# template/directives
# ---------------------------------------------------------------------------


def directives_suite() -> Suite:
    s = Suite("template/directives")
    people = {
        "people": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"name": S(required=True), "score": {"type": "number"}},
            },
        },
        "title": S(),
        "showNotes": {"type": "boolean"},
    }
    data = {
        "people": [
            {"name": "Ada", "score": 91},
            {"name": "Charles", "score": 42},
            {"name": "Mary", "score": 77},
        ]
    }

    def each_para(**k: Any) -> dict[str, Any]:
        return {**k, "type": "paragraph", "runs": [{"text": "{{ item.name }}"}]}

    s.render(
        "0001-each-repeats-an-item",
        "$each repeats an array item once per element, splicing in order",
        env(
            doc(
                para("Before"),
                {"$each": "people", "type": "paragraph", "runs": [{"text": "{{ item.name }}"}]},
                para("After"),
            ),
            people,
        ),
        data,
        ok_doc(doc(para("Before"), para("Ada"), para("Charles"), para("Mary"), para("After"))),
        "The default binding name is `item`.",
    )
    s.render(
        "0002-as-index-first-last",
        "$as names the binding; $index, $first and $last are available",
        env(
            doc(
                {
                    "$each": "people",
                    "$as": "p",
                    "type": "paragraph",
                    "runs": [{"text": "{{ $index }}:{{ p.name }}:{{ $first }}:{{ $last }}"}],
                }
            ),
            people,
        ),
        data,
        ok_doc(
            doc(para("0:Ada:true:false"), para("1:Charles:false:false"), para("2:Mary:false:true"))
        ),
        "$index is 0-based.",
    )
    s.render(
        "0003-if-keeps-and-drops",
        "$if keeps an item when truthy and drops it when not, and is removed from the output",
        env(
            doc(
                {"$if": "title", "type": "heading", "level": 1, "runs": [{"text": "{{ title }}"}]},
                {"$if": "showNotes", "type": "paragraph", "runs": [{"text": "Notes"}]},
            ),
            people,
        ),
        {"title": "Report", "showNotes": False},
        ok_doc(doc({"type": "heading", "level": 1, "runs": [{"text": "Report"}]})),
        "",
    )
    s.render(
        "0004-each-then-if-per-element",
        "With both, $each runs first and $if filters each element",
        env(doc({"$each": "people", "$if": "item.score >= 50", **each_para()}), people),
        data,
        ok_doc(doc(para("Ada"), para("Mary"))),
        "",
    )
    table = {
        "type": "table",
        "rows": [
            {
                "$each": "people",
                "cells": [
                    {"blocks": [para("{{ item.name }}")]},
                    {"blocks": [para("{{ item.score }}")]},
                ],
            }
        ],
    }
    s.render(
        "0005-each-on-table-rows",
        "$each works on any array, here a table's rows",
        env(doc(table), people),
        data,
        ok_doc(
            doc(
                {
                    "type": "table",
                    "rows": [
                        {
                            "cells": [
                                {"blocks": [para(p["name"])]},
                                {"blocks": [para(str(p["score"]))]},
                            ]
                        }
                        for p in data["people"]
                    ],
                }
            )
        ),
        "",
    )
    s.render(
        "0006-empty-array-renders-nothing",
        "$each over an empty array leaves no item",
        env(doc(para("Before"), {"$each": "people", **each_para()}), people),
        {"people": []},
        ok_doc(doc(para("Before"))),
        "Present and empty is not absent: no error.",
    )
    s.render(
        "0007-if-on-an-absent-optional-is-false",
        "$if on an absent optional variable drops the item, without an error",
        env(
            doc({"$if": "title", "type": "paragraph", "runs": [{"text": "x"}]}, para("kept")),
            people,
        ),
        {},
        ok_doc(doc(para("kept"))),
        "fancy-expr's rule: an absent path is null, and null is falsy. A TOKEN reading an absent variable fails (resolve 0009); a CONDITION asking whether it is there must not.",
    )
    s.render(
        "0008-each-over-an-absent-array-is-missing",
        "$each over an absent optional array is TEMPLATE_MISSING",
        env(doc({"$each": "people", **each_para()}), people),
        {},
        err("TEMPLATE_MISSING", "/document/blocks/0/$each"),
        'Rendering nothing would be the silent-empty outcome the plan refuses. A template that may have no rows says so with `$if: "people"` on a wrapper.',
    )
    s.render(
        "0009-directive-keys-stripped-order-kept",
        "Directive keys are removed wherever they were written; other keys keep their order",
        env(
            doc(
                {
                    "type": "paragraph",
                    "$each": "people",
                    "align": "center",
                    "runs": [{"text": "{{ item.name }}"}],
                    "spaceAfter": 0,
                }
            ),
            people,
        ),
        {"people": [{"name": "Ada"}]},
        ok_doc(
            doc(
                {"type": "paragraph", "align": "center", "runs": [{"text": "Ada"}], "spaceAfter": 0}
            )
        ),
        "",
    )
    s.render(
        "0010-each-on-runs",
        "$each inside a paragraph's runs",
        env(
            doc(
                {
                    "type": "paragraph",
                    "runs": [
                        {"text": "Team: "},
                        {"$each": "people", "$as": "p", "text": "{{ p.name }} ", "bold": True},
                    ],
                }
            ),
            people,
        ),
        data,
        ok_doc(
            doc(
                {
                    "type": "paragraph",
                    "runs": [
                        {"text": "Team: "},
                        {"text": "Ada ", "bold": True},
                        {"text": "Charles ", "bold": True},
                        {"text": "Mary ", "bold": True},
                    ],
                }
            )
        ),
        "",
    )
    s.render(
        "0011-if-with-first",
        'A separator with `$if: "!$first"`',
        env(
            doc(
                {
                    "type": "paragraph",
                    "runs": [
                        {"$each": "people", "text": "{{ item.name }}"},
                    ],
                }
            ),
            people,
        ),
        {"people": [{"name": "A"}]},
        ok_doc(doc({"type": "paragraph", "runs": [{"text": "A"}]})),
        "The simple case; 0012 is the separator.",
    )
    s.render(
        "0012-separator-pattern",
        "Nested arrays let an element carry its own separator run",
        env(
            doc(
                {
                    "$each": "people",
                    "type": "paragraph",
                    "runs": [{"$if": "!$first", "text": ", "}, {"text": "{{ item.name }}"}],
                }
            ),
            people,
        ),
        {"people": [{"name": "A"}, {"name": "B"}]},
        ok_doc(
            doc(
                {"type": "paragraph", "runs": [{"text": "A"}]},
                {"type": "paragraph", "runs": [{"text": ", "}, {"text": "B"}]},
            )
        ),
        "$first is the INNERMOST loop's, and an inner array item with only $if is not a loop, so it reads the outer one.",
    )
    prog = {
        "program": {"type": "object", "properties": {"modules": {"type": "array", "items": S()}}}
    }
    s.render(
        "0013-each-over-a-nested-path",
        "$each takes a dotted path",
        env(
            doc(
                {
                    "$each": "program.modules",
                    "$as": "m",
                    "type": "paragraph",
                    "runs": [{"text": "{{ m }}"}],
                }
            ),
            prog,
        ),
        {"program": {"modules": ["Intro", "Gears"]}},
        ok_doc(doc(para("Intro"), para("Gears"))),
        "",
    )
    grid = {"rows": {"type": "array", "items": {"type": "array", "items": S()}}}
    s.render(
        "0014-nested-each-inner-index-wins",
        "In nested loops, $index is the innermost loop's",
        env(
            doc(
                {
                    "$each": "rows",
                    "$as": "row",
                    "type": "paragraph",
                    "runs": [{"$each": "row", "$as": "cell", "text": "{{ $index }}{{ cell }} "}],
                }
            ),
            grid,
        ),
        {"rows": [["a", "b"], ["c"]]},
        ok_doc(
            doc(
                {"type": "paragraph", "runs": [{"text": "0a "}, {"text": "1b "}]},
                {"type": "paragraph", "runs": [{"text": "0c "}]},
            )
        ),
        "",
    )
    s.render(
        "0015-if-reads-item-and-variables",
        "$if sees the loop binding and the declared variables together",
        env(doc({"$each": "people", "$if": "item.name !== title", **each_para()}), people),
        {**data, "title": "Charles"},
        ok_doc(doc(para("Ada"), para("Mary"))),
        "",
    )
    return s


# ---------------------------------------------------------------------------
# template/limits
# ---------------------------------------------------------------------------


def limits_suite() -> Suite:
    s = Suite("template/limits")
    v = {"name": S()}

    small = env(doc(para("Hi {{ name }}")), v)
    size = template_bytes(small)
    s.render(
        "0001-template-bytes-at-limit",
        "A template of exactly limits.templateBytes renders",
        small,
        {"name": "A"},
        ok_doc(doc(para("Hi A"))),
        f"Measured as SPEC 10 says: {size} bytes of strings, keys included.",
        options={"limits": {"templateBytes": size}},
    )
    s.render(
        "0002-template-bytes-over",
        "One byte under the template's size is TEMPLATE_TOO_LARGE",
        small,
        {"name": "A"},
        err("TEMPLATE_TOO_LARGE", ""),
        "Checked before anything else is read.",
        options={"limits": {"templateBytes": size - 1}},
    )

    three = env(doc(para("{{ name }}{{ name }}{{ name }}")), v)
    s.render(
        "0003-tokens-at-limit",
        "Exactly limits.tokens tokens renders",
        three,
        {"name": "x"},
        ok_doc(doc(para("xxx"))),
        "",
        options={"limits": {"tokens": 3}},
    )
    s.render(
        "0004-tokens-over",
        "More tokens than limits.tokens is TEMPLATE_TOO_MANY_TOKENS",
        three,
        {"name": "x"},
        err("TEMPLATE_TOO_MANY_TOKENS", ""),
        "",
        options={"limits": {"tokens": 2}},
    )

    long_name = "a" * 510
    at = env(doc(para("{{ " + long_name + " }}")), {long_name: S()})
    s.render(
        "0005-token-length-default-at-limit",
        "A token of exactly 512 bytes renders with the default limits",
        at,
        {long_name: "ok"},
        ok_doc(doc(para("ok"))),
        "",
    )
    over = env(doc(para("{{ " + long_name + "  }}")), {long_name: S()})
    s.render(
        "0006-token-length-default-over",
        "513 bytes is TOKEN_TOO_LONG at the field's path",
        over,
        {long_name: "ok"},
        err("TOKEN_TOO_LONG", "/document/blocks/0/runs/0/text"),
        "",
    )
    s.render(
        "0007-if-is-bounded-by-token-length",
        "A $if longer than limits.tokenLength is TOKEN_TOO_LONG",
        env(doc({"$if": "name && name && name", "type": "paragraph", "runs": [{"text": "x"}]}), v),
        {"name": "x"},
        err("TOKEN_TOO_LONG", "/document/blocks/0/$if"),
        "A condition is a token by another name, and fancy-expr's own 8192-byte limit is far above what a template needs.",
        options={"limits": {"tokenLength": 10}},
    )

    def nested_quotes(levels: int) -> dict[str, Any]:
        inner: Any = para("deep")
        for _ in range(levels):
            inner = {"$if": "true", "type": "quote", "blocks": [inner]}
        return inner

    def plain_quotes(levels: int) -> dict[str, Any]:
        inner: Any = para("deep")
        for _ in range(levels):
            inner = {"type": "quote", "blocks": [inner]}
        return inner

    s.render(
        "0008-directive-depth-at-limit",
        "8 nested directive objects render",
        env(doc(nested_quotes(8)), {}),
        {},
        ok_doc(doc(plain_quotes(8))),
        "",
    )
    s.render(
        "0009-directive-depth-over",
        "9 nested directive objects is DIRECTIVE_TOO_DEEP at the ninth",
        env(doc(nested_quotes(9)), {}),
        {},
        err("DIRECTIVE_TOO_DEEP", "/document/blocks/0" + "/blocks/0" * 8),
        "Each level is a separate ruling to evaluate per element of every enclosing loop; eight is far past any document a person writes.",
    )

    nums = {"xs": {"type": "array", "items": {"type": "integer"}}}
    each = env(doc({"$each": "xs", "type": "paragraph", "runs": [{"text": "{{ item }}"}]}), nums)
    s.render(
        "0010-iterations-at-limit",
        "Exactly limits.iterations elements expand",
        each,
        {"xs": [1, 2, 3, 4, 5]},
        ok_doc(doc(*[para(str(k)) for k in range(1, 6)])),
        "",
        options={"limits": {"iterations": 5}},
    )
    s.render(
        "0011-iterations-over",
        "One more is RENDER_TOO_MANY_ITERATIONS at the $each",
        each,
        {"xs": [1, 2, 3, 4, 5, 6]},
        err("RENDER_TOO_MANY_ITERATIONS", "/document/blocks/0/$each"),
        "",
        options={"limits": {"iterations": 5}},
    )
    grid = {"rows": {"type": "array", "items": {"type": "array", "items": {"type": "integer"}}}}
    nested = env(
        doc(
            {
                "$each": "rows",
                "$as": "r",
                "type": "paragraph",
                "runs": [{"$each": "r", "$as": "c", "text": "{{ c }}"}],
            }
        ),
        grid,
    )
    nested_out = doc(
        {"type": "paragraph", "runs": [{"text": "1"}, {"text": "2"}, {"text": "3"}]},
        {"type": "paragraph", "runs": [{"text": "4"}, {"text": "5"}, {"text": "6"}]},
    )
    s.render(
        "0012-nested-iterations-count-every-element",
        "Nested loops count outer and inner elements together: 2 + 6 = 8",
        nested,
        {"rows": [[1, 2, 3], [4, 5, 6]]},
        ok_doc(nested_out),
        "",
        options={"limits": {"iterations": 8}},
    )
    s.render(
        "0013-nested-iterations-over",
        "The same at a limit of 7 is RENDER_TOO_MANY_ITERATIONS at the inner $each",
        nested,
        {"rows": [[1, 2, 3], [4, 5, 6]]},
        err("RENDER_TOO_MANY_ITERATIONS", "/document/blocks/0/runs/0/$each"),
        "Counted as they happen: outer element 1 (1), its three cells (4), outer element 2 (5), cells 4 and 5 (7), cell 6 is the eighth.",
        options={"limits": {"iterations": 7}},
    )

    out = doc(para("Hi A"))
    nodes, nbytes = output_nodes(out), output_bytes(out)
    s.render(
        "0014-output-nodes-at-limit",
        "An output of exactly limits.outputNodes values renders",
        small,
        {"name": "A"},
        ok_doc(out),
        f"{nodes} values: every object, array and scalar counts one.",
        options={"limits": {"outputNodes": nodes}},
    )
    s.render(
        "0015-output-nodes-over",
        "One fewer allowed is RENDER_TOO_MANY_NODES",
        small,
        {"name": "A"},
        err("RENDER_TOO_MANY_NODES", ""),
        "",
        options={"limits": {"outputNodes": nodes - 1}},
    )
    s.render(
        "0016-output-bytes-at-limit",
        "An output of exactly limits.outputBytes renders",
        small,
        {"name": "A"},
        ok_doc(out),
        f'{nbytes} bytes of string values ("paragraph" + "Hi A"); keys do not count.',
        options={"limits": {"outputBytes": nbytes}},
    )
    s.render(
        "0017-output-bytes-over",
        "One fewer allowed is RENDER_TOO_LARGE",
        small,
        {"name": "A"},
        err("RENDER_TOO_LARGE", ""),
        "",
        options={"limits": {"outputBytes": nbytes - 1}},
    )

    depth = deepest_level(small)
    s.render(
        "0018-template-depth-at-limit",
        "A template exactly limits.depth deep renders",
        small,
        {"name": "A"},
        ok_doc(out),
        f"The envelope is level 1; the deepest container here is level {depth}.",
        options={"limits": {"depth": depth}},
    )
    s.render(
        "0019-template-depth-over",
        "One level less is TEMPLATE_TOO_DEEP at the first container past it",
        small,
        {"name": "A"},
        err("TEMPLATE_TOO_DEEP", first_container_above(small, depth - 1) or ""),
        "",
        options={"limits": {"depth": depth - 1}},
    )
    deep_data = {"name": "A", "extra": [[[[[["x"]]]]]]}
    s.render(
        "0020-data-depth-over",
        "Data deeper than limits.depth is DATA_TOO_DEEP, even under an undeclared key",
        small,
        deep_data,
        err("DATA_TOO_DEEP", first_container_above(deep_data, depth) or ""),
        f"The template is exactly {depth} deep, so it passes; the data is {deepest_level(deep_data)}. Measured on everything the host passed, because the walk that reduces data to plain JSON visits it all.",
        options={"limits": {"depth": depth}},
    )
    big = env(doc({"$each": "xs", "type": "hr"}), nums)
    s.render(
        "0021-default-iterations-limit",
        "10001 elements with the default limits is RENDER_TOO_MANY_ITERATIONS",
        big,
        {"xs": list(range(10001))},
        err("RENDER_TOO_MANY_ITERATIONS", "/document/blocks/0/$each"),
        "The default is 10000 (plan section 5).",
    )
    s.render(
        "0022-fancy-expr-limits-apply-in-if",
        "A $if nested past fancy-expr's depth is DIRECTIVE_EXPR",
        env(doc({"$if": "(" * 70 + "true" + ")" * 70, "type": "hr"}), {}),
        {},
        err("DIRECTIVE_EXPR", "/document/blocks/0/$if"),
        "144 bytes, under the token-length limit, and 71 levels deep: fancy-expr's EXPR_TOO_DEEP, surfaced as the directive's code (expr/limits).",
    )
    return s


# ---------------------------------------------------------------------------
# template/profiles
# ---------------------------------------------------------------------------


def profiles_suite() -> Suite:
    s = Suite("template/profiles")
    v = {"name": S(), "logo": {"type": "image"}, "url": S()}
    band = lambda **k: {"blocks": [], "page": {"footer": k}}  # noqa: E731

    s.render(
        "0001-fine-print-band-token",
        "A token in a band slot renders; the template's own {page} stays",
        env(band(left="{{ name }}", right="Page {page} of {pages}"), v),
        {"name": "Ada"},
        ok_doc(band(left="Ada", right="Page {page} of {pages}")),
        "{page} written by the template author is the writer's feature.",
    )
    s.render(
        "0002-fine-print-band-value-with-page-is-refused",
        "A band VALUE containing {page} is VALUE_PAGE_FIELD",
        env(band(left="{{ name }}"), v),
        {"name": "see {page}"},
        err("VALUE_PAGE_FIELD", "/document/page/footer/left"),
        "THE NAMED {page} ROW. fine-print replaces {page} in band text with str_replace and has no escape for it, so a recipient named 'see {page}' would print a page number. A refusal is loud; any lookalike substitution prints a different character. The plan said 'escaped'; there is nothing to escape WITH, recorded in SPEC 9.",
    )
    s.render(
        "0003-fine-print-band-value-with-pages",
        "{pages} likewise",
        env(band(center="{{ name }}"), v),
        {"name": "of {pages}"},
        err("VALUE_PAGE_FIELD", "/document/page/footer/center"),
        "",
    )
    s.render(
        "0004-fine-print-link-is-forbidden",
        "A token in a run's link is TOKEN_FORBIDDEN_FIELD",
        env(doc({"type": "paragraph", "runs": [{"text": "site", "link": "{{ url }}"}]}), v),
        {"url": "javascript:alert(1)"},
        err("TOKEN_FORBIDDEN_FIELD", "/document/blocks/0/runs/0/link"),
        "Links come from the template author, never from data (plan section 2).",
    )
    s.render(
        "0005-fine-print-style-fields-take-no-tokens",
        "A token in a colour is TOKEN_FORBIDDEN_FIELD",
        env(doc({"type": "paragraph", "runs": [{"text": "x", "color": "{{ name }}"}]}), v),
        {"name": "#000000"},
        err("TOKEN_FORBIDDEN_FIELD", "/document/blocks/0/runs/0/color"),
        "The profile is an ALLOWLIST: a field it does not name refuses tokens.",
    )
    img = lambda src: doc({"type": "image", "src": src, "alt": "Logo of {{ name }}"})  # noqa: E731
    s.render(
        "0006-fine-print-image-from-an-image-variable",
        "An image src from a declared image variable renders the data URL",
        env(img("{{ logo }}"), v),
        {"name": "Acme", "logo": PNG},
        ok_doc(doc({"type": "image", "src": PNG, "alt": "Logo of Acme"})),
        "alt is a text field.",
    )
    s.render(
        "0007-fine-print-image-from-a-string-is-refused",
        "An image src from a string variable is TOKEN_IMAGE_FIELD",
        env(img("{{ name }}"), v),
        {"name": "x", "logo": PNG},
        err("TOKEN_IMAGE_FIELD", "/document/blocks/0/src"),
        "Only an `image` variable has been through the magic-byte check.",
    )
    s.render(
        "0008-fine-print-image-must-be-a-whole-token",
        "A src with text around the token is TOKEN_IMAGE_FIELD",
        env(img("{{ logo }}#x"), v),
        {"name": "x", "logo": PNG},
        err("TOKEN_IMAGE_FIELD", "/document/blocks/0/src"),
        "",
    )
    s.render(
        "0009-fine-print-literal-src-must-be-a-data-url",
        "A literal src that is not an image data URL is TEMPLATE_IMAGE_INVALID",
        env(img("file:///etc/passwd"), v),
        {"name": "x"},
        err("TEMPLATE_IMAGE_INVALID", "/document/blocks/0/src"),
        "THE NAMED FORBIDDEN-SRC ROW, fine-print side. fine-print itself refuses a non-data src too; refusing at inspect means an admin hears it at SAVE time.",
    )
    s.render(
        "0010-fine-print-code-text",
        "A code block's text is a text field",
        env(doc({"type": "code", "text": "print('{{ name }}')"}), v),
        {"name": "Ada"},
        ok_doc(doc({"type": "code", "text": "print('Ada')"})),
        "",
    )

    lw = lambda d, vars_=v: env(d, vars_, writer="last-word")  # noqa: E731
    s.render(
        "0011-last-word-run-and-band",
        "last-word: run text and band slots take tokens",
        lw({"blocks": [para("{{ name }}")], "page": {"header": {"right": "{{ name }} - {page}"}}}),
        {"name": "Ada"},
        ok_doc({"blocks": [para("Ada")], "page": {"header": {"right": "Ada - {page}"}}}),
        "last-word and fine-print share the Doc model; the profiles are separate data all the same, pinned to separate schema versions.",
    )
    s.render(
        "0012-last-word-chart-option-is-forbidden",
        "last-word: a token in a chart option is TOKEN_FORBIDDEN_FIELD",
        lw(doc({"type": "chart", "option": {"title": {"text": "{{ name }}"}}})),
        {"name": "x"},
        err("TOKEN_FORBIDDEN_FIELD", "/document/blocks/0/option/title/text"),
        "Plan section 2: chart `option` is forbidden everywhere.",
    )
    s.render(
        "0013-last-word-band-page-refused",
        "last-word: {page} in a band value is VALUE_PAGE_FIELD",
        lw({"blocks": [], "page": {"footer": {"left": "{{ name }}"}}}),
        {"name": "{page}"},
        err("VALUE_PAGE_FIELD", "/document/page/footer/left"),
        "",
    )
    s.render(
        "0014-last-word-http-src-is-invalid",
        "last-word: an http src is TEMPLATE_IMAGE_INVALID",
        lw(doc({"type": "image", "src": "https://example.com/x.png"})),
        {},
        err("TEMPLATE_IMAGE_INVALID", "/document/blocks/0/src"),
        "A fetch at render time is a request the host did not decide to make.",
    )

    ds = lambda d, vars_=v: env(d, vars_, writer="dark-slide")  # noqa: E731
    hostile = "*bold* _x_ # [a](javascript:x) `c` " + BS + " 1. <b>&"
    el = lambda **k: {"type": "text", "x": 0, "y": 0, "w": 1, "h": 1, **k}  # noqa: E731
    s.render(
        "0101-dark-slide-markdown-is-escaped",
        "dark-slide: a value in markdown content is backslash-escaped",
        ds({"slides": [{"elements": [el(content="Hello {{ name }}", format="markdown")]}]}),
        {"name": hostile},
        ok_doc(
            {
                "slides": [
                    {"elements": [el(content="Hello " + md_escape(hostile), format="markdown")]}
                ]
            }
        ),
        "THE NAMED MARKDOWN ROW. The value is never parsed as markup; the template's own `Hello ` is untouched. CommonMark escaping. dark-slide's PPTX MarkdownInline does not yet honour backslash escapes (SPEC 9).",
        skip=PHASE6_DS,
    )
    s.render(
        "0102-dark-slide-html-is-entity-escaped",
        "dark-slide: a value in html content is entity-escaped",
        ds({"slides": [{"elements": [el(content="<p>{{ name }}</p>", format="html")]}]}),
        {"name": "<script>x</script> & 'q' \"d\""},
        ok_doc(
            {
                "slides": [
                    {
                        "elements": [
                            el(
                                content="<p>"
                                + html_escape("<script>x</script> & 'q' \"d\"")
                                + "</p>",
                                format="html",
                            )
                        ]
                    }
                ]
            }
        ),
        "THE NAMED HTML ROW.",
        skip=PHASE6_DS,
    )
    s.render(
        "0103-dark-slide-plain-is-raw",
        "dark-slide: plain or absent format leaves the value as it is",
        ds(
            {
                "slides": [
                    {
                        "elements": [
                            el(content="{{ name }}"),
                            el(content="{{ name }}", format="plain"),
                        ]
                    }
                ]
            }
        ),
        {"name": "*x*"},
        ok_doc({"slides": [{"elements": [el(content="*x*"), el(content="*x*", format="plain")]}]}),
        "dark-slide's own default format is plain.",
        skip=PHASE6_DS,
    )
    s.render(
        "0104-dark-slide-notes-are-markdown",
        "dark-slide: speaker notes are always markdown-escaped",
        ds({"slides": [{"elements": [], "notes": "Say {{ name }}"}]}),
        {"name": "_hi_"},
        ok_doc({"slides": [{"elements": [], "notes": "Say " + md_escape("_hi_")}]}),
        "",
        skip=PHASE6_DS,
    )
    s.render(
        "0105-dark-slide-local-path-src-is-invalid",
        "dark-slide: a literal src that is a local path is TEMPLATE_IMAGE_INVALID",
        ds(
            {
                "slides": [
                    {
                        "elements": [
                            {"type": "image", "src": "/etc/passwd", "x": 0, "y": 0, "w": 1, "h": 1}
                        ]
                    }
                ]
            }
        ),
        {},
        err("TEMPLATE_IMAGE_INVALID", "/document/slides/0/elements/0/src"),
        "THE NAMED FORBIDDEN-SRC ROW. dark-slide's ImageResolver reads LOCAL PATHS: a src is a file-include primitive, which no template may carry.",
        skip=PHASE6_DS,
    )
    s.render(
        "0106-dark-slide-href-is-forbidden",
        "dark-slide: a token in an element href is TOKEN_FORBIDDEN_FIELD",
        ds({"slides": [{"elements": [el(content="x", href="{{ url }}")]}]}),
        {"url": "https://example.com"},
        err("TOKEN_FORBIDDEN_FIELD", "/document/slides/0/elements/0/href"),
        "",
        skip=PHASE6_DS,
    )

    hs = lambda d, vars_: env(d, vars_, writer="holy-sheet")  # noqa: E731
    hv = {"s": S(), "n": {"type": "number"}, "b": {"type": "boolean"}, "d": {"type": "date"}}
    sheet = lambda *row: {"sheets": [{"name": "Data", "rows": [list(row)]}]}  # noqa: E731
    s.render(
        "0201-holy-sheet-equals-never-becomes-a-formula",
        "holy-sheet: a string starting with = is written {value: s}",
        hs(sheet("{{ s }}"), hv),
        {"s": '=HYPERLINK("http://x","click")'},
        ok_doc(sheet({"value": '=HYPERLINK("http://x","click")'})),
        "THE NAMED = ROW. holy-sheet promotes a BARE string starting with '=' to a formula (normalizer.ts promoteFormula); `{value: s}` is its documented escape hatch, so user data can never become a formula.",
        skip=PHASE6_HS,
    )
    s.render(
        "0202-holy-sheet-typed-values-stay-typed",
        "holy-sheet: a whole-token number, boolean or date stays as it is",
        hs(sheet("{{ n }}", "{{ b }}", "{{ d }}", "{{ s }}"), hv),
        {"n": 12.5, "b": True, "d": "2026-10-27", "s": "plain"},
        ok_doc(sheet(12.5, True, "2026-10-27", {"value": "plain"})),
        "A date is validated ISO, which cannot begin with =, so it stays bare and the column's date type formats it. EVERY string result is wrapped, not only those starting with =: a rule keyed on the first character is a rule someone will get wrong.",
        skip=PHASE6_HS,
    )
    s.render(
        "0203-holy-sheet-mixed-text-is-wrapped",
        "holy-sheet: text around a token is always written {value: s}",
        hs(sheet("Total: {{ n }}"), hv),
        {"n": 3},
        ok_doc(sheet({"value": "Total: 3"})),
        "",
        skip=PHASE6_HS,
    )
    s.render(
        "0204-holy-sheet-formula-is-forbidden",
        "holy-sheet: a token in a formula is TOKEN_FORBIDDEN_FIELD",
        hs({"sheets": [{"name": "Data", "cells": {"A1": {"formula": "SUM({{ s }})"}}}]}, hv),
        {"s": "A1:A9"},
        err("TOKEN_FORBIDDEN_FIELD", "/document/sheets/0/cells/A1/formula"),
        "",
        skip=PHASE6_HS,
    )
    return s


# ---------------------------------------------------------------------------
# template/inspect
# ---------------------------------------------------------------------------


def inspect_suite() -> Suite:
    s = Suite("template/inspect")

    def ins(
        id_: str,
        title: str,
        template: Any,
        issues: list[tuple[str, str]],
        notes: str,
        skip: dict[str, str] | None = None,
    ) -> None:
        s.add(
            id_,
            title,
            "inspect",
            {"template": template},
            {"issues": [{"code": c, "path": p} for c, p in issues]},
            notes,
            skip=skip,
        )

    clean = env(doc(para("{{ recipientName }}")), CERT_VARS)
    ins("0001-clean", "A valid template has no issues", clean, [], "The control.")
    ins(
        "0002-version",
        "fancyTemplate other than 1 is TEMPLATE_VERSION",
        {**clean, "fancyTemplate": 2},
        [("TEMPLATE_VERSION", "/fancyTemplate")],
        "",
    )
    ins(
        "0003-writer",
        "An unknown writer is TEMPLATE_WRITER",
        {**clean, "writer": "word"},
        [("TEMPLATE_WRITER", "/writer")],
        "",
    )
    ins(
        "0004-envelope-shape",
        "A missing document and an unknown key are TEMPLATE_SHAPE",
        {"fancyTemplate": 1, "writer": "fine-print", "theme": "dark"},
        [("TEMPLATE_SHAPE", "/theme"), ("TEMPLATE_SHAPE", "/document")],
        "Envelope keys in written order, then the missing one. Only `description` is allowed besides the four.",
    )
    ins(
        "0005-envelope-not-an-object",
        "An envelope that is not an object is TEMPLATE_SHAPE at the root",
        ["not", "a", "template"],
        [("TEMPLATE_SHAPE", "")],
        "",
    )
    ins(
        "0006-declarations",
        "Bad declarations are DECL_INVALID at the offending key",
        env(
            doc(),
            {
                "a": {"type": "datetime"},
                "b": {"required": True},
                "c": {"type": "boolean", "maxLength": 3},
                "d": {"type": "string", "default": 5},
                "1x": S(),
                "f": {"type": "array"},
                "g": {"type": "string", "format": "email"},
            },
        ),
        [
            ("DECL_INVALID", "/variables/a/type"),
            ("DECL_INVALID", "/variables/b"),
            ("DECL_INVALID", "/variables/c/maxLength"),
            ("DECL_INVALID", "/variables/d/default"),
            ("DECL_INVALID", "/variables/1x"),
            ("DECL_INVALID", "/variables/f"),
            ("DECL_INVALID", "/variables/g/format"),
        ],
        "One per declaration, in written order. f is an array with no `items`.",
    )
    ins(
        "0007-undeclared-paths",
        "Every unresolvable token path is TOKEN_UNDECLARED",
        env(
            doc(
                para("{{ nope }}"),
                para("{{ program.nope }}"),
                para("{{ recipientName.first }}"),
                para("{{ $index }}"),
            ),
            CERT_VARS,
        ),
        [
            ("TOKEN_UNDECLARED", "/document/blocks/0/runs/0/text"),
            ("TOKEN_UNDECLARED", "/document/blocks/1/runs/0/text"),
            ("TOKEN_UNDECLARED", "/document/blocks/2/runs/0/text"),
            ("TOKEN_UNDECLARED", "/document/blocks/3/runs/0/text"),
        ],
        "An unknown variable, an unknown property, a step into a string, and a loop binding outside any loop. The path is walked through the DECLARATIONS (SPEC 6).",
    )
    ins(
        "0008-forbidden-field",
        "A token in a field the profile does not list is TOKEN_FORBIDDEN_FIELD",
        env(doc({"type": "paragraph", "align": "{{ recipientName }}", "runs": []}), CERT_VARS),
        [("TOKEN_FORBIDDEN_FIELD", "/document/blocks/0/align")],
        "",
    )
    ins(
        "0009-token-in-a-key",
        "A token inside an object key is TOKEN_IN_KEY",
        env(doc({"type": "paragraph", "runs": [], "{{ recipientName }}": 1}), CERT_VARS),
        [("TOKEN_IN_KEY", "/document/blocks/0/{{ recipientName }}")],
        "",
    )
    ins(
        "0010-filters",
        "Unknown filters and bad arguments",
        env(
            doc(
                para("{{ recipientName | shout }}"),
                para("{{ score | number:x }}"),
                para("{{ score | number:11 }}"),
                para("{{ recipientName | upper:x }}"),
                para('{{ issuedAt | date:"Q" }}'),
                para('{{ issuedAt | date:"mmm" }}'),
                para("{{ cents | money:XYZ }}"),
                para("{{ cents | money }}"),
                para("{{ issuedAt | date }}"),
                para("{{ recipientName | default }}"),
            ),
            {
                "recipientName": S(),
                "score": {"type": "number"},
                "issuedAt": {"type": "date"},
                "cents": {"type": "integer"},
            },
        ),
        [("FILTER_UNKNOWN", "/document/blocks/0/runs/0/text")]
        + [("FILTER_ARG", f"/document/blocks/{k}/runs/0/text") for k in range(1, 10)],
        "Static, so an admin hears it when saving rather than when the first certificate is issued.",
    )
    ins(
        "0011-token-syntax-in-a-field",
        "Token syntax errors are reported at the field",
        env(doc(para("{{ recipientName"), para("{{ a b }}")), CERT_VARS),
        [
            ("TOKEN_UNCLOSED", "/document/blocks/0/runs/0/text"),
            ("TOKEN_SYNTAX", "/document/blocks/1/runs/0/text"),
        ],
        "",
    )
    ins(
        "0012-misplaced-directives",
        "A directive on an object that is not an array element is DIRECTIVE_MISPLACED",
        env({"$if": "true", "page": {"$if": "true", "size": "letter"}, "blocks": []}, {}),
        [("DIRECTIVE_MISPLACED", "/document/$if"), ("DIRECTIVE_MISPLACED", "/document/page/$if")],
        "There is nothing to remove an object FROM unless it is an element of an array.",
    )
    ins(
        "0013-unknown-directive",
        "An unknown $-key is DIRECTIVE_UNKNOWN",
        env(doc({"$for": "x", "type": "hr"}), {}),
        [("DIRECTIVE_UNKNOWN", "/document/blocks/0/$for")],
        "No writer model uses $-keys, so the whole namespace is reserved.",
    )
    ins(
        "0014-invalid-directives",
        "$as alone, a shadowing $as and a non-string $each are DIRECTIVE_INVALID",
        env(
            doc(
                {"$as": "x", "type": "hr"},
                {"$each": "tags", "$as": "recipientName", "type": "hr"},
                {"$each": 5, "type": "hr"},
            ),
            CERT_VARS,
        ),
        [
            ("DIRECTIVE_INVALID", "/document/blocks/0/$as"),
            ("DIRECTIVE_INVALID", "/document/blocks/1/$as"),
            ("DIRECTIVE_INVALID", "/document/blocks/2/$each"),
        ],
        "",
    )
    ins(
        "0015-bad-condition",
        "A $if fancy-expr refuses is DIRECTIVE_EXPR",
        env(doc({"$if": "recipientName &&", "type": "hr"}), CERT_VARS),
        [("DIRECTIVE_EXPR", "/document/blocks/0/$if")],
        "",
    )
    ins(
        "0016-undeclared-directive-references",
        "$if and $each naming nothing in scope are DIRECTIVE_UNDECLARED",
        env(doc({"$if": "nope", "type": "hr"}, {"$each": "nope", "type": "hr"}), CERT_VARS),
        [
            ("DIRECTIVE_UNDECLARED", "/document/blocks/0/$if"),
            ("DIRECTIVE_UNDECLARED", "/document/blocks/1/$each"),
        ],
        "fancy-expr's references() is exactly this question (expr/references), and the host -- here, this package -- decides what exists.",
    )
    ins(
        "0017-each-over-a-non-array",
        "$each over a declared string is DIRECTIVE_NOT_ARRAY",
        env(doc({"$each": "recipientName", "type": "hr"}), CERT_VARS),
        [("DIRECTIVE_NOT_ARRAY", "/document/blocks/0/$each")],
        "",
    )
    ins(
        "0018-loop-scope",
        "A loop binding is in scope inside its item and nowhere else",
        env(
            doc(
                {
                    "$each": "tags",
                    "type": "paragraph",
                    "runs": [{"text": "{{ item }} {{ $index }}"}],
                },
                para("{{ item }}"),
            ),
            CERT_VARS,
        ),
        [("TOKEN_UNDECLARED", "/document/blocks/1/runs/0/text")],
        "",
    )
    ins(
        "0019-order-variables-then-document",
        "Issues come in document order: declarations, then document, $-keys first within an object",
        env(
            doc({"type": "paragraph", "runs": [{"text": "{{ nope | shout }}"}], "$if": "alsoNope"}),
            {"bad": {"type": "nope"}},
        ),
        [
            ("DECL_INVALID", "/variables/bad/type"),
            ("DIRECTIVE_UNDECLARED", "/document/blocks/0/$if"),
            ("TOKEN_UNDECLARED", "/document/blocks/0/runs/0/text"),
            ("FILTER_UNKNOWN", "/document/blocks/0/runs/0/text"),
        ],
        "Within a token the path is reported before its filters (SPEC 11).",
    )
    ins(
        "0020-limit-issue-stops-inspect",
        "A template over a size bound is reported with that one issue",
        env(doc(para("{{ nope }}"), {"$for": 1}), {}) | {"description": "x" * 300000},
        [("TEMPLATE_TOO_LARGE", "")],
        "The bound exists so an oversized template costs nothing more to refuse; reporting every other issue in it would be the cost.",
    )
    ins(
        "0021-dark-slide-image-variable-into-src-is-allowed",
        "dark-slide: an image variable in an element src is allowed",
        env(
            {
                "slides": [
                    {
                        "elements": [
                            {"type": "image", "src": "{{ logo }}", "x": 0, "y": 0, "w": 1, "h": 1}
                        ]
                    }
                ]
            },
            {"logo": {"type": "image"}},
            writer="dark-slide",
        ),
        [],
        "The plan's one route for images: a declared image variable, magic-byte checked, in an image-capable field.",
        skip=PHASE6_DS,
    )
    return s


# ---------------------------------------------------------------------------
# manifests
# ---------------------------------------------------------------------------

IMPLEMENTATIONS = [
    {
        "language": "php",
        "package": "particle-academy/fancy-template",
        "symbol": "FancyTemplate\\Template",
    },
]

CONTRACTS: dict[str, tuple[str, dict[str, str], list[str]]] = {
    "template/tokenize": (
        "Splitting one string into text and `{{ }}` tokens",
        {
            "tokenize": "tokenize(text: string, options?) -> { ok: true, parts: Part[] } | { ok: false, code }",
        },
        [
            "The scanner is linear and never backtracks (plan section 5). 0027 pins the property that makes that matter: the search for `}}` stops at the token-length limit.",
            "Parts are DATA about a template, so digits in a path stay strings and every filter argument is a string; a filter decides what its argument means.",
        ],
    ),
    "template/resolve": (
        "Resolving token paths against declared, validated data",
        {
            "render": "render(template, data, options?) -> { ok: true, document } | { ok: false, code, path }",
            "validateData": "validateData(template, data) -> { errors: [{ path, code }] }",
            "preview": "preview(template, options?) -> { ok: true, document } | { ok: false, code, path }",
        },
        [
            "MISSING DATA IS LOUD (0009, 0011). The certificate migration this exists for replaced Blade templates that rendered an absent variable as an empty string, and laravel-courses' own test pinned that behaviour. Here it throws, with the template path and never the data.",
            "0006 is the cross-language number row: each runtime's native float-to-string differs and only JavaScript's Number#toString is the spec.",
        ],
    ),
    "template/filters": (
        "The fixed filter list: default, upper, lower, number, money, date, join",
        {
            "render": "render(template, data, options?) -> { ok: true, document } | { ok: false, code, path }",
        },
        [
            "English only (owner decision 4): ASCII case mapping, English month and day names, comma grouping. 0007 pins that a non-ASCII letter is left alone rather than half-mapped.",
            "number rounds the shortest round-trip DECIMAL, half away from zero (0011, 0012, 0014): binary rounding gives 2.67 for 2.675 in every runtime, and Python's round() is banker's.",
            "money takes integer minor units and never a float (shared/money-minor-units).",
        ],
    ),
    "template/directives": (
        "JSON directives: $each, $as, $if",
        {
            "render": "render(template, data, options?) -> { ok: true, document } | { ok: false, code, path }",
        },
        [
            "Structure is never text syntax (plan section 2). A directive is a key on an array element and is removed from the output.",
            "A TOKEN reading an absent variable throws (resolve 0009); a CONDITION asking whether one is there does not (0007). Both are deliberate and they are the same rule seen from two sides.",
        ],
    ),
    "template/limits": (
        "The bounds from plan section 5, each with a stable code and an at-the-limit partner",
        {
            "render": "render(template, data, options?) -> { ok: true, document } | { ok: false, code, path }",
        },
        [
            "Every bound is pinned from both sides, with host-lowered limits so a row does not have to be megabytes long. 0021 is the one default-limit row that is cheap enough to carry.",
            "Sizes, node counts and depths in the notes are computed by the generator from SPEC 10's definitions.",
        ],
    ),
    "template/profiles": (
        "Which fields take tokens per writer, and how a value is encoded there",
        {
            "render": "render(template, data, options?) -> { ok: true, document } | { ok: false, code, path }",
        },
        [
            "The named security rows from the plan: holy-sheet `=` (0201), dark-slide markdown and html escaping (0101, 0102), forbidden image src (0009, 0014, 0105), and {page} (0002, 0003, 0013).",
            "dark-slide and holy-sheet rows are skipped for PHP with the reason stated: those profiles are phase 6. They are written now so the phase-6 implementation is built against them rather than the other way round.",
            "FINDING, not covered by any row: dark-slide's PPTX MarkdownInline has no backslash escapes and writes `format: html` as plain text, so 0101/0102's correct encodings print their escapes in a .pptx today (SPEC 9).",
        ],
    ),
    "template/inspect": (
        "Static checks with no data: what an admin hears when saving a template",
        {
            "inspect": "inspect(template, options?) -> { issues: [{ code, path }] }",
        },
        [
            "Issues are listed in document order (SPEC 11), so the list is comparable byte for byte across runtimes.",
        ],
    ),
}


def manifest(suite: str) -> dict[str, Any]:
    title, functions, notes = CONTRACTS[suite]
    return {
        "$schema": "../../../schema/suite-manifest.schema.json",
        "suite": suite,
        "title": title,
        "since": SINCE,
        "caseFormat": "table",
        "cases": "cases.json",
        "contract": {
            "functions": functions,
            "summary": f"Normative text: {SPEC_REF}. Written BEFORE any implementation; every expected value is the spec's, hand-written in scripts/build-template-cases.py.",
            "reference": "php",
            "referenceNote": "No implementation existed when these rows were written. PHP is the first leg (plan section 6, step 3); TypeScript and Python follow in phase 6.",
            "implementations": IMPLEMENTATIONS,
        },
        "notes": [
            "Generated by scripts/build-template-cases.py. Edit the generator, not the JSON.",
            "NO DISCRIMINATION PROBES IN THIS REPOSITORY, the same known gap as flow/graph-runs: the implementation under test is a template engine, which this package does not carry. These rows guard DRIFT between runtimes; that they DISCRIMINATE is shown by fancy-template's sabotage pass (each bound and guard broken in turn, a row going red), not by anything here.",
            *notes,
        ],
    }


def main() -> None:
    suites = [
        tokenize_suite(),
        resolve_suite(),
        filters_suite(),
        directives_suite(),
        limits_suite(),
        profiles_suite(),
        inspect_suite(),
    ]
    total = 0
    for suite in suites:
        out = ROOT / suite.name.split("/")[1]
        out.mkdir(parents=True, exist_ok=True)
        table = {
            "$schema": "../../../schema/case-table.schema.json",
            "suite": suite.name,
            "cases": suite.cases,
        }
        (out / "cases.json").write_text(
            json.dumps(table, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
        )
        (out / "manifest.json").write_text(
            json.dumps(manifest(suite.name), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        print(f"{suite.name}: {len(suite.cases)} cases")
        total += len(suite.cases)
    print(f"total: {total}")


if __name__ == "__main__":
    main()
