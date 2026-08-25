"""The Python loader must behave identically to the TypeScript and PHP ones.

Three loaders for one fixture format is itself a duplicated contract, so it is
held to the standard everything else here is held to: the same guards, the same
summary shape, asserted on every side.

Every guard is reached through the REAL loader by handing it an explicit root,
never through a copy of the guard living in this file. An earlier draft of the
Node and PHP test files re-implemented the guard inside the test, which would
have asserted nothing -- the exact bug this repository exists to catch, nearly
shipped inside it.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import pytest

from fancy_conformance import (
    cases,
    format_summary,
    list_suites,
    manifest,
    run_table,
    suite_path,
    suites_root,
    version,
)


def _write_suite(root: Path, suite: str, rows: list[dict[str, Any]]) -> Path:
    directory = root / "suites" / suite
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "manifest.json").write_text(
        json.dumps({"suite": suite, "caseFormat": "table"}), encoding="utf-8"
    )
    (directory / "cases.json").write_text(
        json.dumps({"suite": suite, "cases": rows}), encoding="utf-8"
    )
    return root


# --- Finding the fixtures -------------------------------------------------


def test_finds_the_suites_regardless_of_where_it_is_called_from(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The bug this replaces: both parity harnesses fancy-conformance retired
    # hard-coded `../../holy-sheet/src/`, so they ran in exactly one directory
    # layout and silently no-opped everywhere else -- including in CI.
    monkeypatch.chdir(tmp_path)
    assert "shared/decimal" in list_suites()


def test_reports_the_fixture_version() -> None:
    assert re.fullmatch(r"\d+\.\d+\.\d+", version())


def test_a_missing_checkout_is_an_error_not_a_skip(monkeypatch: pytest.MonkeyPatch) -> None:
    # `skipIf(!HAS_X)` returning green is the exact mechanism that hid two-way
    # drift for months. Resolution must fail loudly.
    monkeypatch.setenv("FANCY_CONFORMANCE_ROOT", str(Path(os.devnull).parent / "nope"))
    with pytest.raises(RuntimeError, match="no suites/ directory"):
        suites_root()


def test_suite_path_points_at_a_real_directory() -> None:
    assert (Path(suite_path("shared/decimal")) / "cases.json").is_file()


def test_manifest_reads_the_contract() -> None:
    assert manifest("shared/decimal")["suite"] == "shared/decimal"


# --- The load-time guards -------------------------------------------------


def test_rejects_a_skip_with_no_reason_at_load_time(tmp_path: Path) -> None:
    _write_suite(
        tmp_path,
        "bad",
        [{"id": "0001-x", "title": "x", "input": {}, "expected": 1, "skip": {"rust": "   "}}],
    )
    with pytest.raises(RuntimeError, match="skips rust with no reason"):
        cases("bad", tmp_path)


def test_rejects_a_non_string_skip_reason(tmp_path: Path) -> None:
    # `skip: {python: true}` is the shape someone reaches for first, and it
    # carries no reason at all.
    _write_suite(
        tmp_path,
        "bad",
        [{"id": "0001-x", "title": "x", "input": {}, "expected": 1, "skip": {"python": True}}],
    )
    with pytest.raises(RuntimeError, match="skips python with no reason"):
        cases("bad", tmp_path)


def test_rejects_a_duplicate_case_id_at_load_time(tmp_path: Path) -> None:
    _write_suite(
        tmp_path,
        "dup",
        [
            {"id": "0001-x", "title": "x", "input": {}, "expected": 1},
            {"id": "0001-x", "title": "y", "input": {}, "expected": 2},
        ],
    )
    with pytest.raises(RuntimeError, match="duplicate case id"):
        cases("dup", tmp_path)


def test_loads_a_well_formed_skip_and_keeps_its_reason(tmp_path: Path) -> None:
    # The positive half. Without it the two tests above would also pass against
    # a loader that rejected every skip.
    _write_suite(
        tmp_path,
        "ok",
        [
            {
                "id": "0001-x",
                "title": "x",
                "input": {},
                "expected": 1,
                "skip": {"rust": "no rust implementation yet"},
            }
        ],
    )
    assert cases("ok", tmp_path)[0]["skip"]["rust"] == "no rust implementation yet"


def test_refuses_a_directory_suite(tmp_path: Path) -> None:
    directory = tmp_path / "suites" / "docs"
    directory.mkdir(parents=True)
    (directory / "manifest.json").write_text(
        json.dumps({"suite": "docs", "caseFormat": "directory"}), encoding="utf-8"
    )
    with pytest.raises(RuntimeError, match="not a table suite"):
        cases("docs", tmp_path)


def test_refuses_an_empty_case_table(tmp_path: Path) -> None:
    # A suite with no rows reports "0 passed, 0 failed" and reads as success.
    _write_suite(tmp_path, "empty", [])
    with pytest.raises(RuntimeError, match="has no cases"):
        cases("empty", tmp_path)


# --- skip is a MAP, keyed by language -------------------------------------


def test_a_skip_for_another_language_still_runs_here(tmp_path: Path) -> None:
    # THE regression this file exists for. `skip` is `{"<language>": "<reason>"}`.
    # A loader reading it as a scalar treats `{"php": "..."}` as truthy and
    # skips the row for EVERY language -- silently reducing coverage while the
    # log still reads green. Two of the four Python ports shipped that loader.
    _write_suite(
        tmp_path,
        "langs",
        [
            {
                "id": "0001-x",
                "title": "x",
                "input": {},
                "expected": 7,
                "skip": {"php": "no PHP impl"},
            }
        ],
    )
    summary = run_table("langs", lambda c: 7, root=tmp_path)
    assert summary["skipped"] == 0
    assert summary["passed"] == 1


def test_a_skip_for_python_is_honoured(tmp_path: Path) -> None:
    _write_suite(
        tmp_path,
        "langs",
        [
            {
                "id": "0001-x",
                "title": "x",
                "input": {},
                "expected": 7,
                "skip": {"python": "no Python impl"},
            }
        ],
    )
    summary = run_table("langs", lambda c: 0, root=tmp_path)
    assert summary["skipped"] == 1
    assert summary["failed"] == 0
    assert summary["results"][0]["reason"] == "no Python impl"


def test_the_language_under_test_is_selectable(tmp_path: Path) -> None:
    # A Python runner driving another implementation out-of-process reports
    # that implementation's language, exactly as the PHP loader's `$language`
    # argument allows.
    _write_suite(
        tmp_path,
        "langs",
        [{"id": "0001-x", "title": "x", "input": {}, "expected": 7, "skip": {"go": "no go impl"}}],
    )
    summary = run_table("langs", lambda c: 7, language="go", root=tmp_path)
    assert summary["language"] == "go"
    assert summary["skipped"] == 1


# --- Running a table ------------------------------------------------------


def test_a_throwing_implementation_is_a_failing_row_not_a_crash(tmp_path: Path) -> None:
    _write_suite(tmp_path, "boom", [{"id": "0001-x", "title": "x", "input": {}, "expected": 1}])

    def impl(_case: dict[str, Any]) -> Any:
        raise ValueError("kaboom")

    summary = run_table("boom", impl, root=tmp_path)
    assert summary["ok"] is False
    assert "kaboom" in str(summary["results"][0]["actual"])


def test_true_does_not_satisfy_a_row_expecting_one(tmp_path: Path) -> None:
    # Python's `==` treats booleans as integers, so `True == 1`. The peers
    # compare with `===`. Without this guard a `truthy` row expecting `False`
    # is satisfied by an implementation returning `0`.
    _write_suite(tmp_path, "bools", [{"id": "0001-x", "title": "x", "input": {}, "expected": 1}])
    assert run_table("bools", lambda c: True, root=tmp_path)["ok"] is False

    _write_suite(
        tmp_path, "bools2", [{"id": "0001-x", "title": "x", "input": {}, "expected": False}]
    )
    assert run_table("bools2", lambda c: 0, root=tmp_path)["ok"] is False


def test_a_nested_bool_mismatch_is_caught(tmp_path: Path) -> None:
    _write_suite(
        tmp_path,
        "nested",
        [{"id": "0001-x", "title": "x", "input": {}, "expected": {"a": [False]}}],
    )
    assert run_table("nested", lambda c: {"a": [0]}, root=tmp_path)["ok"] is False


def test_a_missing_key_is_a_failure(tmp_path: Path) -> None:
    # An intersection-only dict comparison passes `{}` against `{"a": 1}`.
    _write_suite(
        tmp_path, "keys", [{"id": "0001-x", "title": "x", "input": {}, "expected": {"a": 1}}]
    )
    assert run_table("keys", lambda c: {}, root=tmp_path)["ok"] is False


def test_a_shorter_list_is_a_failure(tmp_path: Path) -> None:
    _write_suite(
        tmp_path, "lists", [{"id": "0001-x", "title": "x", "input": {}, "expected": [1, 2, 3]}]
    )
    assert run_table("lists", lambda c: [1, 2], root=tmp_path)["ok"] is False


def test_object_key_order_does_not_matter(tmp_path: Path) -> None:
    _write_suite(
        tmp_path,
        "order",
        [{"id": "0001-x", "title": "x", "input": {}, "expected": {"a": 1, "b": 2}}],
    )
    assert run_table("order", lambda c: {"b": 2, "a": 1}, root=tmp_path)["ok"] is True


def test_list_order_does_matter(tmp_path: Path) -> None:
    _write_suite(
        tmp_path, "order2", [{"id": "0001-x", "title": "x", "input": {}, "expected": [1, 2]}]
    )
    assert run_table("order2", lambda c: [2, 1], root=tmp_path)["ok"] is False


def test_floats_compare_exactly_by_default(tmp_path: Path) -> None:
    """A scaled 1e-12 epsilon used to live here, and it was wrong.

    Its stated reason was that a golden written as ``0.002`` in JSON is a
    decimal literal whose nearest double differs between languages. That was
    measured and is false: ``0.002`` -- the literal the reason itself named --
    plus ``0.1``, ``1e300``, ``DBL_MAX``, the ``5e-324`` denormal and
    ``0.30000000000000004`` all parse to BIT-IDENTICAL doubles in PHP, Python
    and Node.

    What it actually did was pass two runtimes that computed DIFFERENT values,
    in the package whose whole product is detecting that. On a money row a
    relative 1e-12 is real money at scale.
    """
    _write_suite(
        tmp_path, "floats", [{"id": "0001-x", "title": "x", "input": {}, "expected": 0.002}]
    )

    assert run_table("floats", lambda c: 0.002, root=tmp_path)["ok"] is True
    # One ulp away is a DIFFERENT value and now fails. This is the assertion
    # that reversed.
    assert run_table("floats", lambda c: 0.002 + 1e-18, root=tmp_path)["ok"] is False
    assert run_table("floats", lambda c: 0.0021, root=tmp_path)["ok"] is False


def test_a_case_may_declare_a_tolerance(tmp_path: Path) -> None:
    """The escape hatch, and why it lives on the ROW.

    A global epsilon is invisible -- nobody reading a case can tell whether it
    asserts a value or a neighbourhood. Declared per case, it shows up in the
    fixture and in any diff of it, the same way a skip has to state its reason.
    """
    _write_suite(
        tmp_path,
        "floats",
        [{"id": "0001-x", "title": "x", "input": {}, "expected": 0.002, "tolerance": 1e-12}],
    )

    assert run_table("floats", lambda c: 0.002 + 1e-18, root=tmp_path)["ok"] is True
    # A tolerance widens the target; it does not remove it.
    assert run_table("floats", lambda c: 0.0021, root=tmp_path)["ok"] is False


def test_a_boolean_tolerance_is_ignored(tmp_path: Path) -> None:
    """``isinstance(True, int)`` is true in Python.

    A stray ``"tolerance": true`` would otherwise become a tolerance of 1.0 and
    pass almost anything -- a fixture that looks strict and asserts nothing.
    """
    _write_suite(
        tmp_path,
        "floats",
        [{"id": "0001-x", "title": "x", "input": {}, "expected": 0.002, "tolerance": True}],
    )

    assert run_table("floats", lambda c: 0.5, root=tmp_path)["ok"] is False


def test_integers_compare_exactly(tmp_path: Path) -> None:
    # roundMoney returns an int and 2 vs 3 must never be within tolerance.
    _write_suite(tmp_path, "ints", [{"id": "0001-x", "title": "x", "input": {}, "expected": 3}])
    assert run_table("ints", lambda c: 2, root=tmp_path)["ok"] is False


# --- The summary ----------------------------------------------------------


def test_the_summary_names_every_skip(tmp_path: Path) -> None:
    # "3 skipped" in a log is indistinguishable from full coverage at a glance,
    # which is how a suite stops meaning anything without anyone deciding it
    # should.
    _write_suite(
        tmp_path,
        "sk",
        [
            {
                "id": "0001-x",
                "title": "x",
                "input": {},
                "expected": 1,
                "skip": {"python": "waiting on the adapter"},
            }
        ],
    )
    text = format_summary(run_table("sk", lambda c: 1, root=tmp_path))
    assert "SKIP 0001-x" in text
    assert "waiting on the adapter" in text


def test_the_summary_prints_the_suite_version(tmp_path: Path) -> None:
    _write_suite(tmp_path, "v", [{"id": "0001-x", "title": "x", "input": {}, "expected": 1}])
    assert version() in format_summary(run_table("v", lambda c: 1, root=tmp_path))


def test_the_summary_shows_expected_and_actual_for_a_failure(tmp_path: Path) -> None:
    _write_suite(tmp_path, "f", [{"id": "0001-x", "title": "x", "input": {}, "expected": 1}])
    text = format_summary(run_table("f", lambda c: 2, root=tmp_path))
    assert "FAIL 0001-x" in text
    assert "expected" in text and "actual" in text


# --- The real suites ------------------------------------------------------


def test_every_shipped_table_suite_loads(tmp_path: Path) -> None:
    # Guards against a suite that the Node and PHP loaders accept and this one
    # chokes on -- the drift a third loader is most likely to introduce.
    loaded = 0
    for suite in list_suites():
        if manifest(suite).get("caseFormat") != "table":
            continue
        assert cases(suite), suite
        loaded += 1
    assert loaded >= 3
