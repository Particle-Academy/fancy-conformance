"""Tests for scripts/build-formula-cases.py.

EVERY WORKBOOK HERE IS A SYNTHETIC TEST INPUT, NOT A GOLDEN. No Google Sheets
capture exists yet; the xlsx files below are written by this test with values
it invents, in the shape a Sheets export takes, purely to drive the generator
through its happy path and every refusal. None of these values may ever be
copied into a suite.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import zipfile
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "build-formula-cases.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("build_formula_cases", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # dataclasses resolves annotations through sys.modules[cls.__module__].
    sys.modules["build_formula_cases"] = module
    spec.loader.exec_module(module)
    return module


bfc = _load()

INPUT_SHA = "a" * 64

# Synthetic: (id, row, suite, formula, value kind, value).
ROWS: list[tuple[str, int, str | None, str, str, Any]] = [
    ("K-0001", 2, None, "=1+1", "n", 2),
    ("K-0002", 3, None, "=0.1+0.2", "n", 0.30000000000000004),
    ("E-0001", 4, "formula/eval-math", "=SUM(1,2,3)", "n", 6),
    ("E-0002", 5, "formula/eval-info", "=NA()", "e", "#N/A"),
    ("E-0003", 6, "formula/eval-text", '=UPPER("a")', "str", "A"),
    ("A-0001", 7, "formula/pricing", "=Inputs!X2>0", "b", True),
]

TYPE_OF = {"n": 1, "str": 2, "b": 4, "e": 16}


def request() -> dict[str, Any]:
    cases = []
    for case_id, row, suite, formula, _kind, _value in ROWS:
        case: dict[str, Any] = {
            "id": case_id,
            "row": row,
            "suite": suite,
            "formula": formula,
            "request": {
                "version": 1,
                "formulas": {"result": formula},
                "outputs": {"result": {}},
                "trace": "none",
            },
        }
        if case_id.startswith("E-"):
            case["fn"] = {"E-0001": "SUM", "E-0002": "NA", "E-0003": "UPPER"}[case_id]
        if case_id.startswith("A-"):
            case.update({"case": "A", "output": "grid_discount.vlookup", "hypotheses": ["H-27"]})
        cases.append(case)
    return {
        "capture": "v1",
        "workbook": "capture-v1.xlsx",
        "workbookSha256": INPUT_SHA,
        "expect": {"locale": "en_US", "timeZone": "UTC"},
        "layout": {
            "sheet": "Cases",
            "firstRow": 2,
            "columns": {"id": "A", "formula": "B", "type": "C", "errorType": "D", "length": "E"},
        },
        "canaries": [
            {"id": "K-0001", "formula": "=1+1", "accept": [{"t": "number", "v": 2}]},
            {
                "id": "K-0002",
                "formula": "=0.1+0.2",
                "accept": [{"t": "number", "v": 0.30000000000000004}, {"t": "number", "v": 0.3}],
            },
        ],
        "hypotheses": {},
        "cases": cases,
    }


def _cell(ref: str, kind: str | None, value: Any, formula: str | None, shared: list[str]) -> str:
    f = "" if formula is None else f"<f>{_esc(formula.lstrip('='))}</f>"
    if kind is None:
        return f'<c r="{ref}">{f}</c>'
    if kind == "s":
        shared.append(str(value))
        return f'<c r="{ref}" t="s">{f}<v>{len(shared) - 1}</v></c>'
    if kind == "b":
        return f'<c r="{ref}" t="b">{f}<v>{1 if value else 0}</v></c>'
    if kind in ("str", "e"):
        return f'<c r="{ref}" t="{kind}">{f}<v>{_esc(str(value))}</v></c>'
    return f'<c r="{ref}">{f}<v>{value!r}</v></c>'


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def make_export(
    path: Path,
    rows: list[tuple[str, int, str | None, str, str, Any]] = ROWS,
    *,
    uncached: str | None = None,
    as_value: str | None = None,
    bad_type: str | None = None,
) -> Path:
    """Write a SYNTHETIC export shaped like a Google Sheets xlsx download."""
    shared: list[str] = []
    xml_rows = []
    for case_id, row, _suite, formula, kind, value in rows:
        cells = [_cell(f"A{row}", "s", case_id, None, shared)]
        if case_id == uncached:
            cells.append(_cell(f"B{row}", None, None, formula, shared))
        elif case_id == as_value:
            cells.append(_cell(f"B{row}", kind, value, None, shared))
        else:
            cells.append(_cell(f"B{row}", kind, value, formula, shared))
        type_code = 2 if case_id == bad_type else TYPE_OF[kind]
        cells.append(_cell(f"C{row}", "n", type_code, f"=TYPE(B{row})", shared))
        err = {"#N/A": 7}.get(value, "") if kind == "e" else ""
        cells.append(
            _cell(f"D{row}", "n" if err else "str", err, f'=IFERROR(ERROR.TYPE(B{row}),"")', shared)
        )
        xml_rows.append(f'<row r="{row}">{"".join(cells)}</row>')
    main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    sheet = f'<worksheet xmlns="{main}"><sheetData>{"".join(xml_rows)}</sheetData></worksheet>'
    sst = f'<sst xmlns="{main}">' + "".join(f"<si><t>{_esc(s)}</t></si>" for s in shared) + "</sst>"
    workbook = (
        f'<workbook xmlns="{main}" xmlns:r="{rel}"><sheets>'
        '<sheet name="Cases" sheetId="1" r:id="rId1"/>'
        '<sheet name="Inputs" sheetId="2" r:id="rId2"/>'
        "</sheets></workbook>"
    )
    rels = (
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>'
        "</Relationships>"
    )
    inputs = (
        f'<worksheet xmlns="{main}"><sheetData>'
        '<row r="2"><c r="X2"><v>30</v></c></row></sheetData></worksheet>'
    )
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", rels)
        z.writestr("xl/sharedStrings.xml", sst)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
        z.writestr("xl/worksheets/sheet2.xml", inputs)
    return path


def provenance(export: Path, **override: str) -> dict[str, Any]:
    p = {
        "date": "2026-10-28",
        "capturer": "synthetic test input",
        "accountType": "none -- synthetic",
        "locale": "en_US",
        "timeZone": "UTC",
        "exportRoute": "written by test_build_formula_cases.py",
        "inputSha256": INPUT_SHA,
        "outputSha256": hashlib.sha256(export.read_bytes()).hexdigest(),
    }
    p.update(override)
    return p


# --- happy path ---------------------------------------------------------------


def test_a_trustworthy_export_becomes_one_suite_per_category(tmp_path: Path) -> None:
    export = make_export(tmp_path / "export.xlsx")
    suites = bfc.build(export, request(), provenance(export), "0.39.0")

    assert sorted(suites) == [
        "formula/eval-info",
        "formula/eval-math",
        "formula/eval-text",
        "formula/pricing",
    ]
    math_row = suites["formula/eval-math"]["cases"][0]
    assert math_row["id"] == "0001-e-sum"
    assert math_row["expected"] == {"value": {"t": "number", "v": 6}}
    assert math_row["tags"] == ["E-0001"]
    assert math_row["input"]["formulas"]["result"] == "=SUM(1,2,3)"
    assert "tolerance" not in math_row
    assert suites["formula/eval-info"]["cases"][0]["expected"] == {
        "value": {"t": "error", "v": "#N/A"}
    }
    assert suites["formula/eval-text"]["cases"][0]["expected"] == {
        "value": {"t": "string", "v": "A"}
    }
    pricing = suites["formula/pricing"]["cases"][0]
    assert pricing["id"] == "0001-a-a-grid-discount-vlookup"
    assert pricing["expected"] == {"value": {"t": "bool", "v": True}}
    assert pricing["tags"] == ["A-0001", "H-27"]


def test_canaries_are_guards_not_rows(tmp_path: Path) -> None:
    export = make_export(tmp_path / "export.xlsx")
    suites = bfc.build(export, request(), provenance(export), "0.39.0")
    tags = [t for s in suites.values() for c in s["cases"] for t in c["tags"]]
    assert "K-0001" not in tags
    assert "K-0002" not in tags


def test_the_manifest_names_google_sheets_and_the_capture(tmp_path: Path) -> None:
    export = make_export(tmp_path / "export.xlsx")
    manifest = bfc.build(export, request(), provenance(export), "0.39.0")["formula/eval-math"][
        "manifest"
    ]
    contract = manifest["contract"]
    assert contract["reference"] == "google-sheets"
    assert "synthetic test input" in contract["referenceNote"]
    assert INPUT_SHA in contract["referenceNote"]
    assert contract["implementations"][0]["symbol"] == "FancyFormula\\Engine::evaluate"


def test_a_15_digit_export_declares_a_tolerance_on_every_nonzero_number(tmp_path: Path) -> None:
    rows = [r if r[0] != "K-0002" else (*r[:5], 0.3) for r in ROWS]
    export = make_export(tmp_path / "export.xlsx", rows)
    suites = bfc.build(export, request(), provenance(export), "0.39.0")
    row = suites["formula/eval-math"]["cases"][0]
    assert row["tolerance"] == pytest.approx(5e-15)
    assert "tolerance" not in suites["formula/eval-info"]["cases"][0]
    assert "15 significant digits" in suites["formula/eval-math"]["manifest"]["notes"][0]


def test_main_writes_suites_and_the_raw_artifacts(tmp_path: Path) -> None:
    export = make_export(tmp_path / "export.xlsx")
    req = tmp_path / "request.json"
    req.write_text(json.dumps(request()), encoding="utf-8")
    prov = tmp_path / "provenance.json"
    prov.write_text(json.dumps(provenance(export)), encoding="utf-8")
    out = tmp_path / "out"
    argv = ["--capture", str(export), "--request", str(req), "--provenance", str(prov)]
    code = bfc.main([*argv, "--since", "0.39.0", "--out", str(out)])
    assert code == 0
    table = json.loads((out / "eval-math" / "cases.json").read_text(encoding="utf-8"))
    assert table["suite"] == "formula/eval-math"
    assert (out / "eval-math" / "manifest.json").is_file()
    assert (out / "captures" / "v1" / "provenance.json").is_file()
    assert (out / "captures" / "v1" / "capture-v1-export.xlsx").read_bytes() == export.read_bytes()


# --- refusals: every guard, one test each ---------------------------------------


def refused(
    tmp_path: Path,
    export: Path,
    prov: dict[str, Any],
    match: str,
    req: dict[str, Any] | None = None,
) -> None:
    with pytest.raises(bfc.CaptureRefusedError, match=match):
        bfc.build(export, req or request(), prov, "0.39.0")


def test_refuses_a_formula_cell_with_no_cached_value(tmp_path: Path) -> None:
    export = make_export(tmp_path / "x.xlsx", uncached="E-0001")
    refused(tmp_path, export, provenance(export), "no cached value")


def test_refuses_a_formula_replaced_by_a_value(tmp_path: Path) -> None:
    export = make_export(tmp_path / "x.xlsx", as_value="E-0001")
    refused(tmp_path, export, provenance(export), "no longer a formula")


def test_refuses_a_wrong_canary(tmp_path: Path) -> None:
    rows = [r if r[0] != "K-0001" else (*r[:5], 3) for r in ROWS]
    export = make_export(tmp_path / "x.xlsx", rows)
    refused(tmp_path, export, provenance(export), "Canary K-0001")


def test_refuses_a_missing_case_id(tmp_path: Path) -> None:
    export = make_export(tmp_path / "x.xlsx", [r for r in ROWS if r[0] != "E-0002"])
    refused(tmp_path, export, provenance(export), "do not match request.json")


def test_refuses_an_unexpected_case_id(tmp_path: Path) -> None:
    rows = [*ROWS, ("E-0099", 8, "formula/eval-math", "=1", "n", 1)]
    export = make_export(tmp_path / "x.xlsx", rows)
    refused(tmp_path, export, provenance(export), "do not match request.json")


def test_refuses_a_duplicate_case_id(tmp_path: Path) -> None:
    rows = [*ROWS, ("E-0001", 8, "formula/eval-math", "=1", "n", 1)]
    export = make_export(tmp_path / "x.xlsx", rows)
    refused(tmp_path, export, provenance(export), "appears twice")


def test_refuses_a_case_on_the_wrong_row(tmp_path: Path) -> None:
    rows = [r if r[0] != "E-0001" else (r[0], 9, *r[2:]) for r in ROWS]
    export = make_export(tmp_path / "x.xlsx", rows)
    refused(tmp_path, export, provenance(export), "is on row 9")


def test_refuses_a_type_probe_that_disagrees(tmp_path: Path) -> None:
    export = make_export(tmp_path / "x.xlsx", bad_type="E-0001")
    refused(tmp_path, export, provenance(export), "TYPE says")


def test_refuses_the_wrong_locale(tmp_path: Path) -> None:
    export = make_export(tmp_path / "x.xlsx")
    refused(tmp_path, export, provenance(export, locale="en_GB"), "locale")


def test_refuses_the_wrong_time_zone(tmp_path: Path) -> None:
    export = make_export(tmp_path / "x.xlsx")
    refused(tmp_path, export, provenance(export, timeZone="Europe/London"), "time zone")


@pytest.mark.parametrize(
    "field", ["date", "capturer", "accountType", "locale", "timeZone", "exportRoute"]
)
def test_refuses_incomplete_provenance(tmp_path: Path, field: str) -> None:
    export = make_export(tmp_path / "x.xlsx")
    refused(tmp_path, export, provenance(export, **{field: " "}), f"missing {field}")


def test_refuses_an_upload_that_was_not_this_workbook(tmp_path: Path) -> None:
    export = make_export(tmp_path / "x.xlsx")
    refused(tmp_path, export, provenance(export, inputSha256="b" * 64), "not this capture")


def test_refuses_an_export_changed_after_provenance_was_recorded(tmp_path: Path) -> None:
    export = make_export(tmp_path / "x.xlsx")
    refused(tmp_path, export, provenance(export, outputSha256="c" * 64), "changed after")


def test_refuses_a_file_that_is_not_an_xlsx(tmp_path: Path) -> None:
    export = tmp_path / "x.xlsx"
    export.write_bytes(b"not a zip")
    refused(tmp_path, export, provenance(export), "not an xlsx")


def test_a_refusal_writes_nothing(tmp_path: Path) -> None:
    export = make_export(tmp_path / "x.xlsx", uncached="E-0002")
    req = tmp_path / "request.json"
    req.write_text(json.dumps(request()), encoding="utf-8")
    prov = tmp_path / "provenance.json"
    prov.write_text(json.dumps(provenance(export)), encoding="utf-8")
    out = tmp_path / "out"
    argv = ["--capture", str(export), "--request", str(req), "--provenance", str(prov)]
    assert bfc.main([*argv, "--since", "0.39.0", "--out", str(out)]) == 1
    assert not out.exists()
