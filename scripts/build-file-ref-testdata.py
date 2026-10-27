"""Generate `testdata/file-refs/`: one fixture tree every loader's tests read.

File references (`{"file": "fixtures/<name>", "sha256": "<hex>"}`) are read by
four loaders, and each must refuse the same malformed references with the same
message. Four private sets of throwaway trees would drift the way the four
private Python loaders did, so the trees are written ONCE, here, and
`testdata/file-refs/expected.json` says what each suite must do in every
loader:

- `"ok"`: loads, and every reference resolves to bytes matching its sha256;
- `"data"`: loads, and holds NO reference (a `file` member that is not a
  string starting `fixtures/` is ordinary data);
- `"load": "<message fragment>"`: loading the suite fails with that fragment;
- `"bytes": "<message fragment>"`: loads, but `fixtureBytes` refuses.

    python scripts/build-file-ref-testdata.py

Deterministic: gzip members carry mtime 0 and no file name, so a rerun is a
no-op in git. Edit with the editor tools only (RULES.md).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent / "testdata" / "file-refs"

# Every byte value once, then CR LF and a lone LF: a checkout that converts
# line endings, or a reader that opens the file in text mode, changes these
# bytes and the sha256 says so.
RAW = bytes(range(256)) + b"\r\n\n"
# Three gzip members exercising the three DEFLATE block types, so the Rust
# loader's own inflate (std has none) is tested on each: level 0 writes STORED
# blocks, a short run is written with FIXED Huffman codes, and varied text long
# enough to pay for its own code tables is written with DYNAMIC ones.
STORED = b"stored block " * 40
FIXED = b"aaaaaaaaaaaaaaaaaaaaaab"
DYNAMIC = b"".join(
    f"line {i}: the quick brown fox {i * 7919 % 1000} jumps over {i % 13} lazy dogs\n".encode()
    for i in range(400)
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def gz(data: bytes, level: int = 9) -> bytes:
    return gzip.compress(data, compresslevel=level, mtime=0)


def ref(name: str, data: bytes) -> dict[str, str]:
    return {"file": "fixtures/" + name, "sha256": sha(data)}


def row(case_id: str, **fields: Any) -> dict[str, Any]:
    return {
        "id": case_id,
        "title": case_id,
        "since": "0.38.0",
        "input": {},
        "expected": None,
    } | fields


def suite(name: str, rows: list[dict[str, Any]], files: dict[str, bytes]) -> None:
    folder = ROOT / "suites" / name
    (folder / "fixtures").mkdir(parents=True, exist_ok=True)
    for file, data in files.items():
        (folder / "fixtures" / file).write_bytes(data)
    manifest = {"suite": name, "caseFormat": "table"}
    (folder / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    table = {"suite": name, "cases": rows}
    (folder / "cases.json").write_text(
        json.dumps(table, indent=2) + "\n", encoding="utf-8", newline="\n"
    )


def main() -> None:
    if ROOT.exists():
        shutil.rmtree(ROOT)

    files = {
        "raw.bin": RAW,
        "raw.bin.gz": gz(RAW),
        "stored.txt.gz": gz(STORED, level=0),
        "fixed.txt.gz": gz(FIXED),
        "dynamic.txt.gz": gz(DYNAMIC),
    }
    suite(
        "ok",
        [
            row("0001-raw", input={"bytes": ref("raw.bin", RAW)}),
            row("0002-gzip-is-transparent", input={"bytes": ref("raw.bin.gz", RAW)}),
            row("0003-stored-blocks", input={"bytes": ref("stored.txt.gz", STORED)}),
            row("0004-fixed-huffman", input={"bytes": ref("fixed.txt.gz", FIXED)}),
            row("0005-dynamic-huffman", input={"bytes": ref("dynamic.txt.gz", DYNAMIC)}),
            row(
                "0006-nested-in-expected-and-artifacts",
                input={"deep": [{"x": [ref("raw.bin", RAW)]}]},
                expected={"out": ref("raw.bin.gz", RAW)},
                artifacts={"reference": ref("dynamic.txt.gz", DYNAMIC)},
            ),
        ],
        files,
    )

    one = {"raw.bin": RAW}
    bad = {
        "extra-member": {"file": "fixtures/raw.bin", "sha256": sha(RAW), "gzip": True},
        "missing-sha": {"file": "fixtures/raw.bin"},
        "dot-dot": {"file": "fixtures/../manifest.json", "sha256": sha(RAW)},
        "nested-dir": {"file": "fixtures/a/raw.bin", "sha256": sha(RAW)},
        "hidden-name": {"file": "fixtures/.raw.bin", "sha256": sha(RAW)},
        "empty-name": {"file": "fixtures/", "sha256": sha(RAW)},
        "upper-hex": {"file": "fixtures/raw.bin", "sha256": sha(RAW).upper()},
        "short-hex": {"file": "fixtures/raw.bin", "sha256": sha(RAW)[:63]},
        "missing-file": {"file": "fixtures/absent.bin", "sha256": sha(RAW)},
    }
    for name, value in bad.items():
        suite("bad-" + name, [row("0001-x", input={"a": value})], one)

    # NOT references: a `file` member is ordinary data unless it is a string
    # starting `fixtures/`. A hostile document model (fine-print/writer-bytes
    # has one) carries `{"type": "launch", "file": "calc.exe"}` as DATA the
    # writer must ignore; a loader that read it as a reference would refuse
    # the row, or worse, hand the implementation bytes in place of the model.
    data = {
        "launch-action": {"type": "launch", "file": "calc.exe"},
        "outside-fixtures": {"file": "manifest.json", "sha256": sha(RAW)},
        "backslash": {"file": "fixtures" + chr(92) + "raw.bin", "sha256": sha(RAW)},
        "not-a-string": {"file": 7, "sha256": sha(RAW)},
        "no-slash": {"file": "fixtures", "sha256": sha(RAW)},
    }
    for name, value in data.items():
        suite("data-" + name, [row("0001-x", input={"a": value})], one)

    # Where the reference sits must not decide whether it is checked.
    suite("bad-in-expected", [row("0001-x", expected=[bad["dot-dot"]])], one)
    suite("bad-in-artifacts", [row("0001-x", artifacts={"a": bad["missing-file"]})], one)
    # Well-formed and present, but the bytes are not the bytes it names.
    suite("wrong-sha", [row("0001-x", input={"a": ref("raw.bin", RAW + b"!")})], one)
    # A .gz that is not gzip at all.
    suite("not-gzip", [row("0001-x", input={"a": ref("raw.bin.gz", RAW)})], {"raw.bin.gz": RAW})

    malformed = "malformed file reference"
    expected = {
        "ok": "ok",
        "bad-extra-member": {"load": malformed},
        "bad-missing-sha": {"load": malformed},
        "bad-dot-dot": {"load": malformed},
        "bad-nested-dir": {"load": malformed},
        "bad-hidden-name": {"load": malformed},
        "bad-empty-name": {"load": malformed},
        "bad-upper-hex": {"load": malformed},
        "bad-short-hex": {"load": malformed},
        "bad-missing-file": {"load": "which does not exist"},
        "bad-in-expected": {"load": malformed},
        "bad-in-artifacts": {"load": "which does not exist"},
        "wrong-sha": {"bytes": "does not match its sha256"},
        "not-gzip": {"bytes": "is not a gzip file"},
    } | {"data-" + name: "data" for name in data}
    (ROOT / "expected.json").write_text(
        json.dumps(expected, indent=2) + "\n", encoding="utf-8", newline="\n"
    )


if __name__ == "__main__":
    main()
