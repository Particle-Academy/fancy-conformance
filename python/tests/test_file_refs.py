"""File references, against the SAME trees the Node, PHP and Rust loaders test.

`testdata/file-refs/` is written once by `scripts/build-file-ref-testdata.py`,
and its `expected.json` is the one statement of every verdict, so four loaders
cannot each test a private idea of "malformed".
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from fancy_conformance import cases, fixture_bytes, is_file_ref, list_suites, manifest

TESTDATA = Path(__file__).resolve().parents[2] / "testdata" / "file-refs"


def refs_in(value: Any) -> list[dict[str, str]]:
    if is_file_ref(value):
        return [value]
    if isinstance(value, list):
        return [r for v in value for r in refs_in(v)]
    if isinstance(value, dict):
        return [r for v in value.values() for r in refs_in(v)]
    return []


def test_every_shared_verdict_from_one_table() -> None:
    expected = json.loads((TESTDATA / "expected.json").read_text(encoding="utf-8"))
    assert len(expected) >= 19

    for suite, want in expected.items():
        if want == "data":
            rows = cases(suite, root=TESTDATA)
            found = refs_in([[r.get("input"), r.get("expected"), r.get("artifacts")] for r in rows])
            assert found == [], suite
        elif want == "ok":
            resolved = 0
            for row in cases(suite, root=TESTDATA):
                for ref in refs_in([row.get("input"), row.get("expected"), row.get("artifacts")]):
                    data = fixture_bytes(suite, ref, root=TESTDATA)
                    assert hashlib.sha256(data).hexdigest() == ref["sha256"]
                    resolved += 1
            assert resolved == 8
        elif "load" in want:
            with pytest.raises(RuntimeError) as caught:
                cases(suite, root=TESTDATA)
            assert want["load"] in str(caught.value), suite
        else:
            ref = refs_in(cases(suite, root=TESTDATA)[0]["input"])[0]
            with pytest.raises(RuntimeError) as caught:
                fixture_bytes(suite, ref, root=TESTDATA)
            assert want["bytes"] in str(caught.value), suite


def test_names_the_case_and_the_pointer() -> None:
    with pytest.raises(RuntimeError) as caught:
        cases("bad-in-expected", root=TESTDATA)
    assert 'case "bad-in-expected/0001-x" has a malformed file reference at /expected/0: ' in str(
        caught.value
    )
    with pytest.raises(RuntimeError) as caught:
        cases("bad-in-artifacts", root=TESTDATA)
    assert (
        'case "bad-in-artifacts/0001-x" references fixtures/absent.bin, which does not exist'
        in str(caught.value)
    )


def test_fixture_bytes_refuses_a_malformed_reference() -> None:
    bad = {"file": "fixtures/../manifest.json", "sha256": "0" * 64}
    with pytest.raises(RuntimeError, match="malformed file reference"):
        fixture_bytes("ok", bad, root=TESTDATA)


def test_every_reference_in_the_real_suites_resolves() -> None:
    count = 0
    for suite in list_suites():
        if manifest(suite).get("caseFormat") != "table":
            continue
        for row in cases(suite):
            for ref in refs_in([row.get("input"), row.get("expected"), row.get("artifacts")]):
                assert hashlib.sha256(fixture_bytes(suite, ref)).hexdigest() == ref["sha256"]
                count += 1
    assert count > 0
