# ruff: noqa: E501 -- refusal messages are prose for the person running the capture.
"""Turn a Google Sheets capture into the `formula/*` conformance suites.

Google Sheets is the ONLY golden source for fancy-formula (plan D3). The capture
workbook is built in the fancy-formula repo (`capture/vN/capture-vN.xlsx`, every
formula written with NO cached value) together with `request.json`, which lists
every case id, its formula, and the engine request its conformance row carries.
Someone uploads the workbook, converts it to a Google Sheet (locale United
States, time zone UTC), lets it recalculate, downloads it as xlsx, and records
`provenance.json`. This script turns that export into `cases.json` files.

It REFUSES the export -- writing nothing at all -- when it cannot trust it:

  * a formula cell has no cached value (Sheets never computed it);
  * a case's formula cell is not a formula any more (a value replaced it);
  * a canary's value is wrong;
  * the case ids in the export differ from request.json's;
  * a TYPE probe disagrees with the kind of the value beside it;
  * provenance.json is incomplete, or records a locale or time zone other than
    the ones request.json expects, or digests that do not match the files.

Rows are never edited by hand: fix the capture or the request, then rerun.

    python scripts/build-formula-cases.py \\
        --capture capture-v1-export.xlsx \\
        --request ../fancy-formula/capture/v1/request.json \\
        --provenance provenance.json \\
        --since 0.39.0

Standard library only. The xlsx reader is deliberately small: it reads the
parts a Sheets export writes (workbook, relationships, shared strings,
worksheets) and nothing else.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "suites" / "formula"

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}
R_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

# A capture is a few hundred rows; anything near these is not one.
MAX_PART_BYTES = 64 * 1024 * 1024
MAX_PARTS = 4096

PROVENANCE_FIELDS = (
    "date",
    "capturer",
    "accountType",
    "locale",
    "timeZone",
    "exportRoute",
    "inputSha256",
    "outputSha256",
)

# TYPE() codes, keyed by the kind of a scalar value.
TYPE_CODE = {"number": 1, "string": 2, "bool": 4, "error": 16, "empty": 1}

ERROR_VALUES = {"#N/A", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#NULL!", "#ERROR!"}

CELL_RE = re.compile(r"^([A-Z]{1,3})([0-9]+)$")


class CaptureRefusedError(Exception):
    """The export cannot be trusted; nothing was written."""


@dataclass(frozen=True)
class Cell:
    """One worksheet cell as the export stored it."""

    kind: str  # "number" | "string" | "bool" | "error" | "empty"
    value: Any
    formula: str | None
    cached: bool  # the cell carried a value (<v> or inline string)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# --------------------------------------------------------------------------
# Reading the export
# --------------------------------------------------------------------------


def _read_part(z: zipfile.ZipFile, name: str) -> bytes:
    info = z.getinfo(name)
    if info.file_size > MAX_PART_BYTES:
        raise CaptureRefusedError(f"{name} expands to {info.file_size} bytes; refusing.")
    return z.read(name)


def read_xlsx(path: Path) -> dict[str, dict[str, Cell]]:
    """Sheet name -> address -> Cell."""
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as e:
        raise CaptureRefusedError(f"{path} is not an xlsx (zip) file: {e}") from e
    with z:
        if len(z.infolist()) > MAX_PARTS:
            raise CaptureRefusedError(f"{path} has {len(z.infolist())} parts; refusing.")
        names = set(z.namelist())

        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            root = ElementTree.fromstring(_read_part(z, "xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))

        workbook = ElementTree.fromstring(_read_part(z, "xl/workbook.xml"))
        rels = ElementTree.fromstring(_read_part(z, "xl/_rels/workbook.xml.rels"))
        targets = {
            rel.get("Id"): rel.get("Target", "") for rel in rels.findall("pr:Relationship", NS)
        }

        sheets: dict[str, dict[str, Cell]] = {}
        for sheet in workbook.findall("m:sheets/m:sheet", NS):
            name = sheet.get("name", "")
            target = targets.get(sheet.get(R_ID), "")
            part = target.lstrip("/")
            if not part.startswith("xl/"):
                part = "xl/" + part
            if part not in names:
                raise CaptureRefusedError(
                    f"Sheet {name!r} points at {part}, which is not in the file."
                )
            sheets[name] = _read_sheet(_read_part(z, part), shared)
        return sheets


def _read_sheet(xml: bytes, shared: list[str]) -> dict[str, Cell]:
    root = ElementTree.fromstring(xml)
    cells: dict[str, Cell] = {}
    for c in root.iter(f"{{{NS['m']}}}c"):
        ref = c.get("r", "")
        t = c.get("t", "n")
        f = c.find("m:f", NS)
        v = c.find("m:v", NS)
        formula = None if f is None else (f.text or "")
        raw = None if v is None else (v.text or "")
        if t == "inlineStr":
            is_ = c.find("m:is", NS)
            text = "" if is_ is None else "".join(x.text or "" for x in is_.iter(f"{{{NS['m']}}}t"))
            cells[ref] = Cell("string", text, formula, True)
            continue
        if raw is None:
            cells[ref] = Cell("empty", None, formula, False)
            continue
        if t == "s":
            cells[ref] = Cell("string", shared[int(raw)], formula, True)
        elif t == "str":
            cells[ref] = Cell("string", raw, formula, True)
        elif t == "b":
            cells[ref] = Cell("bool", raw == "1", formula, True)
        elif t == "e":
            cells[ref] = Cell("error", raw, formula, True)
        else:
            cells[ref] = Cell("number", float(raw), formula, True)
    return cells


# --------------------------------------------------------------------------
# Guards
# --------------------------------------------------------------------------


def check_provenance(provenance: dict[str, Any], request: dict[str, Any], capture: Path) -> None:
    missing = [
        k
        for k in PROVENANCE_FIELDS
        if not isinstance(provenance.get(k), str) or not provenance[k].strip()
    ]
    if missing:
        raise CaptureRefusedError(f"provenance.json is missing {', '.join(missing)}.")
    expect = request["expect"]
    if provenance["locale"] != expect["locale"]:
        raise CaptureRefusedError(
            f"provenance.json records locale {provenance['locale']!r}; the capture requires {expect['locale']!r}. Set File > Settings > Locale and capture again."
        )
    if provenance["timeZone"] != expect["timeZone"]:
        raise CaptureRefusedError(
            f"provenance.json records time zone {provenance['timeZone']!r}; the capture requires {expect['timeZone']!r}."
        )
    if provenance["inputSha256"] != request["workbookSha256"]:
        raise CaptureRefusedError(
            "provenance.json's inputSha256 is not the workbook request.json describes: the uploaded file is not this capture."
        )
    actual = sha256_file(capture)
    if provenance["outputSha256"] != actual:
        raise CaptureRefusedError(
            f"provenance.json's outputSha256 does not match the export ({actual}): the file changed after it was recorded."
        )


# ERROR.TYPE() codes in Google Sheets. #ERROR! (8) is Sheets' parse-error value.
ERROR_TYPE_CODE = {
    "#NULL!": 1,
    "#DIV/0!": 2,
    "#VALUE!": 3,
    "#REF!": 4,
    "#NAME?": 5,
    "#NUM!": 6,
    "#N/A": 7,
    "#ERROR!": 8,
}


def _sheets_text_error(case_id: str, cell: Cell, type_cell: Cell | None, err_cell: Cell | None) -> Cell:
    """Google Sheets' xlsx download stores a formula's ERROR result as t="str"
    holding the literal, never t="e" (observed in capture v1, row P-0004:
    `-2^0.5` came back as t="str" "#NUM!" beside TYPE 16 and ERROR.TYPE 6).

    Read it as the error only when BOTH probes vouch for it: TYPE says 16 and
    ERROR.TYPE gives exactly that literal's code. A string that merely looks
    like an error (`="#NUM!"`) has TYPE 2 and stays text; a disagreeing or
    missing ERROR.TYPE refuses the export rather than guessing.
    """
    if not (
        cell.kind == "string"
        and cell.value in ERROR_VALUES
        and type_cell is not None
        and type_cell.kind == "number"
        and int(type_cell.value) == TYPE_CODE["error"]
    ):
        return cell
    want = ERROR_TYPE_CODE[cell.value]
    got = None if err_cell is None or err_cell.kind != "number" else int(err_cell.value)
    if got != want:
        raise CaptureRefusedError(
            f"{case_id}: the value is the text {cell.value!r} and TYPE says error, but ERROR.TYPE gives {got!r}, not {want}."
        )
    return Cell("error", cell.value, cell.formula, cell.cached)


def _sheets_blank(case_id: str, cell: Cell, type_cell: Cell | None, len_cell: Cell | None) -> Cell:
    """Google Sheets' xlsx download stores a formula's BLANK result as t="str"
    with an empty value (observed in capture v2, row E-0186: `=IFERROR(NA())`
    came back empty beside TYPE 1 and LEN 0). TYPE of a blank is 1 in Sheets,
    while a real zero-length string (`=""`) has TYPE 2 and stays a string.

    Read it as empty only when TYPE says 1 AND the LEN probe says exactly 0;
    a missing or disagreeing LEN refuses the export rather than guessing.
    """
    if not (
        cell.kind == "string"
        and cell.value == ""
        and type_cell is not None
        and type_cell.kind == "number"
        and int(type_cell.value) == TYPE_CODE["number"]
    ):
        return cell
    got = None if len_cell is None or len_cell.kind != "number" else int(len_cell.value)
    if got != 0:
        raise CaptureRefusedError(
            f"{case_id}: the value is empty text and TYPE says 1 (a blank), but LEN gives {got!r}, not 0."
        )
    return Cell("empty", None, cell.formula, cell.cached)


def scalar(cell: Cell) -> dict[str, Any]:
    """The exchange cell for a captured value."""
    if cell.kind == "number":
        v: Any = cell.value
        if not math.isfinite(v):
            raise CaptureRefusedError("A captured number is not finite.")
        if float(v).is_integer() and abs(v) < 2**53:
            v = int(v)
        return {"t": "number", "v": v}
    if cell.kind == "string":
        return {"t": "string", "v": cell.value}
    if cell.kind == "bool":
        return {"t": "bool", "v": cell.value}
    if cell.kind == "error":
        if cell.value not in ERROR_VALUES:
            raise CaptureRefusedError(f"Unknown error value {cell.value!r}.")
        return {"t": "error", "v": cell.value}
    return {"t": "empty"}


def collect(
    sheets: dict[str, dict[str, Cell]], request: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Case id -> captured value, after every per-cell guard."""
    layout = request["layout"]
    sheet_name = layout["sheet"]
    if sheet_name not in sheets:
        raise CaptureRefusedError(f"The export has no {sheet_name!r} sheet.")
    sheet = sheets[sheet_name]
    cols = layout["columns"]

    # 1. Every formula cell, anywhere in the workbook, carries a value.
    uncached = sorted(
        f"{name}!{ref}"
        for name, cells in sheets.items()
        for ref, c in cells.items()
        if c.formula is not None and not c.cached
    )
    if uncached:
        more = f" (and {len(uncached) - 5} more)" if len(uncached) > 5 else ""
        raise CaptureRefusedError(
            f"{len(uncached)} formula cells have no cached value, so Sheets never computed them: {', '.join(uncached[:5])}{more}."
        )

    # 2. The case ids are exactly request.json's, on the rows it names.
    want = {c["id"]: c for c in request["cases"]}
    first = layout["firstRow"]
    found: dict[str, int] = {}
    for ref, c in sheet.items():
        m = CELL_RE.match(ref)
        if (
            m
            and m.group(1) == cols["id"]
            and int(m.group(2)) >= first
            and c.kind == "string"
            and c.value
        ):
            if c.value in found:
                raise CaptureRefusedError(f"Case id {c.value} appears twice in the export.")
            found[c.value] = int(m.group(2))
    if set(found) != set(want):
        extra = sorted(set(found) - set(want))
        lost = sorted(set(want) - set(found))
        raise CaptureRefusedError(
            f"The export's case ids do not match request.json: {len(lost)} missing {lost[:5]}, {len(extra)} unexpected {extra[:5]}."
        )
    for case_id, row in found.items():
        if row != want[case_id]["row"]:
            raise CaptureRefusedError(
                f"{case_id} is on row {row}; request.json puts it on row {want[case_id]['row']}."
            )

    # 3. Each case's formula cell is still a formula, and TYPE agrees with it.
    values: dict[str, dict[str, Any]] = {}
    for case_id, row in found.items():
        cell = sheet.get(f"{cols['formula']}{row}")
        if cell is None or cell.formula is None:
            raise CaptureRefusedError(
                f"{case_id}: {cols['formula']}{row} is no longer a formula; a value replaced it."
            )
        type_cell = sheet.get(f"{cols['type']}{row}")
        cell = _sheets_text_error(case_id, cell, type_cell, sheet.get(f"{cols['errorType']}{row}"))
        cell = _sheets_blank(case_id, cell, type_cell, sheet.get(f"{cols['length']}{row}"))
        expected_type = TYPE_CODE.get(cell.kind)
        if (
            type_cell is None
            or type_cell.kind != "number"
            or expected_type is None
            or int(type_cell.value) != expected_type
        ):
            got = None if type_cell is None else type_cell.value
            raise CaptureRefusedError(
                f"{case_id}: TYPE says {got!r} but the value beside it is a {cell.kind}."
            )
        values[case_id] = scalar(cell)

    # 4. Canaries.
    for canary in request["canaries"]:
        got = values.get(canary["id"])
        if got not in canary["accept"]:
            raise CaptureRefusedError(
                f"Canary {canary['id']} ({canary['formula']}) is {got}; expected one of {canary['accept']}."
            )

    return values


# --------------------------------------------------------------------------
# Rows
# --------------------------------------------------------------------------


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def case_id(case: dict[str, Any]) -> str:
    prefix, number = case["id"].split("-")
    if "case" in case and "output" in case:
        tail = f"{case['case']}-{case['output']}"
    else:
        tail = case.get("fn", "")
    base = f"{number}-{prefix.lower()}"
    return f"{base}-{slug(tail)}" if tail else base


def tolerance_at_15_digits(v: float) -> float:
    """Half a unit in the 15th significant digit: the declared tolerance when the export kept only 15."""
    if v == 0:
        return 0.0
    return 0.5 * 10 ** (math.floor(math.log10(abs(v))) - 14)


def check_literals_survived(workbook: Path, request: dict[str, Any], export: dict[str, dict[str, Cell]]) -> None:
    """Every literal (non-formula, non-empty) cell of the uploaded workbook must
    come back from Sheets with the same kind and value.

    Capture v1 is why: holy-sheet wrote a row's cells out of column order
    (A1, AA1, ..., B1), Google Sheets kept A1 and silently dropped the rest, and
    every formula reading those inputs computed over blanks. Each such row was
    still internally consistent (TYPE agreed with its value), so no per-row
    guard could see it. Only comparing the inputs themselves can.
    """
    if sha256_file(workbook) != request["workbookSha256"]:
        raise CaptureRefusedError(
            f"{workbook} is not the workbook request.json describes (sha256 mismatch)."
        )
    original = read_xlsx(workbook)
    lost: list[str] = []
    for name, cells in sorted(original.items()):
        got_sheet = export.get(name, {})
        for ref, cell in sorted(cells.items()):
            if cell.formula is not None or cell.kind == "empty":
                continue
            got = got_sheet.get(ref)
            same = got is not None and got.formula is None and got.kind == cell.kind
            if same and cell.kind == "number":
                same = abs(float(got.value) - float(cell.value)) <= tolerance_at_15_digits(float(cell.value))
            elif same:
                same = got.value == cell.value
            if not same:
                shown = "nothing" if got is None or got.kind == "empty" else f"{got.kind} {got.value!r}"
                lost.append(f"{name}!{ref} ({cell.kind} {cell.value!r} came back as {shown})")
    if lost:
        more = f" (and {len(lost) - 5} more)" if len(lost) > 5 else ""
        raise CaptureRefusedError(
            f"{len(lost)} literal cells of the uploaded workbook did not survive the round trip through Sheets, "
            f"so formulas reading them computed over different inputs: {'; '.join(lost[:5])}{more}."
        )


def build(
    capture: Path,
    request: dict[str, Any],
    provenance: dict[str, Any],
    since: str,
    *,
    workbook: Path,
) -> dict[str, dict[str, Any]]:
    """Suite id -> {"manifest": ..., "cases": ...}. Raises CaptureRefusedError; writes nothing."""
    check_provenance(provenance, request, capture)
    sheets = read_xlsx(capture)
    check_literals_survived(workbook, request, sheets)
    values = collect(sheets, request)

    k2 = values.get("K-0002", {}).get("v")
    full_precision = k2 == 0.30000000000000004
    note = (
        "The export kept full double precision (canary K-0002 read 0.30000000000000004), so numbers compare exactly."
        if full_precision
        else "The export kept 15 significant digits (canary K-0002 read 0.3), so every numeric row declares a tolerance of half a unit in the 15th digit."
    )

    reference_note = (
        f"Captured from Google Sheets by {provenance['capturer']} ({provenance['accountType']}) on {provenance['date']}, "
        f"via {provenance['exportRoute']}, locale {provenance['locale']}, time zone {provenance['timeZone']}. "
        f"Workbook {request['workbook']} (sha256 {provenance['inputSha256']}) exported as sha256 {provenance['outputSha256']}. "
        f"Raw artifacts: suites/formula/captures/{request['capture']}/."
    )

    suites: dict[str, dict[str, Any]] = {}
    for case in request["cases"]:
        suite = case.get("suite")
        if suite is None:
            continue  # canaries are guards, not rows
        value = values[case["id"]]
        row: dict[str, Any] = {
            "id": case_id(case),
            "title": case["formula"],
            "since": since,
            "tags": [case["id"], *case.get("hypotheses", [])],
            "fn": "evaluate",
            "input": case["request"],
            "expected": {"value": value},
        }
        if case.get("note"):
            row["notes"] = case["note"]
        if not full_precision and value["t"] == "number" and value["v"] != 0:
            row["tolerance"] = tolerance_at_15_digits(float(value["v"]))
        suites.setdefault(suite, {"cases": []})["cases"].append(row)

    for suite, entry in suites.items():
        entry["cases"].sort(key=lambda r: r["id"])
        ids = [r["id"] for r in entry["cases"]]
        if len(ids) != len(set(ids)):
            raise CaptureRefusedError(f"{suite}: two rows map to the same conformance id.")
        entry["manifest"] = {
            "$schema": "../../../schema/suite-manifest.schema.json",
            "suite": suite,
            "title": f"fancy-formula: {suite.split('/', 1)[1]}",
            "since": since,
            "caseFormat": "table",
            "contract": {
                "summary": "Engine::evaluate(input) reports results.result.value equal to `expected.value`, the value Google Sheets computed for the same formula over the same cells.",
                "functions": {"evaluate": "Engine::evaluate(request) -> results.result.value"},
                "reference": "google-sheets",
                "referenceNote": reference_note,
                "implementations": [
                    {
                        "language": "php",
                        "package": "particle-academy/fancy-formula",
                        "symbol": "FancyFormula\\Engine::evaluate",
                    }
                ],
            },
            "notes": [
                note,
                "Generated by scripts/build-formula-cases.py; never edit a row by hand. Each row's first tag is its capture id; the rest are the SPEC.md hypotheses it decides.",
            ],
        }
    return suites


def write(
    suites: dict[str, dict[str, Any]],
    out: Path,
    capture: Path,
    request_path: Path,
    provenance_path: Path,
    version: str,
) -> None:
    for suite, entry in suites.items():
        directory = out / suite.split("/", 1)[1]
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "manifest.json").write_text(
            json.dumps(entry["manifest"], indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        table = {
            "$schema": "../../../schema/case-table.schema.json",
            "suite": suite,
            "cases": entry["cases"],
        }
        (directory / "cases.json").write_text(
            json.dumps(table, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    raw = out / "captures" / version
    raw.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(capture, raw / f"capture-{version}-export.xlsx")
    shutil.copyfile(request_path, raw / "request.json")
    shutil.copyfile(provenance_path, raw / "provenance.json")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "--capture", type=Path, required=True, help="the xlsx downloaded from Google Sheets"
    )
    parser.add_argument(
        "--request", type=Path, required=True, help="the request.json the workbook was built with"
    )
    parser.add_argument(
        "--workbook",
        type=Path,
        required=True,
        help="the xlsx that was UPLOADED (its sha256 must match request.json); every literal cell must survive",
    )
    parser.add_argument(
        "--provenance", type=Path, required=True, help="provenance.json recorded at capture time"
    )
    parser.add_argument(
        "--since", required=True, help="the fancy-conformance version these rows first ship in"
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    request = json.loads(args.request.read_text(encoding="utf-8"))
    provenance = json.loads(args.provenance.read_text(encoding="utf-8"))
    try:
        suites = build(args.capture, request, provenance, args.since, workbook=args.workbook)
    except CaptureRefusedError as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 1
    write(suites, args.out, args.capture, args.request, args.provenance, request["capture"])
    for suite, entry in sorted(suites.items()):
        print(f"{suite:28} {len(entry['cases']):4} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
