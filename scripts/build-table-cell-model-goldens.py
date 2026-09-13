"""Regenerate the `dark-slide/table-cell-model` goldens by RUNNING the reference.

The manifest's rule is that every golden is the output of running
particle-academy/dark-slide, never what a value obviously ought to be. This makes
that rule a command instead of a hope:

    python scripts/build-table-cell-model-goldens.py [--dark-slide ../dark-slide] [--write]

Without --write it prints each case whose golden would change and exits 1 if any
would, so it doubles as a drift check. Inputs, ids, titles and notes are never
touched; edit those by hand, then regenerate.

Python owns the file because PHP's json_decode turns `{}` into `[]`; see
table-cell-model-reference.php.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CASES = ROOT / "suites" / "dark-slide" / "table-cell-model" / "cases.json"
REFERENCE = ROOT / "scripts" / "table-cell-model-reference.php"


def flatten(value, prefix=""):
    if isinstance(value, dict):
        for key, inner in value.items():
            yield from flatten(inner, f"{prefix}.{key}" if prefix else key)
    elif isinstance(value, list):
        for index, inner in enumerate(value):
            yield from flatten(inner, f"{prefix}[{index}]")
    else:
        yield prefix, value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dark-slide", default=str(ROOT.parent / "dark-slide"))
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    php = shutil.which("php")
    if php is None:
        print("php is not on PATH", file=sys.stderr)
        return 2

    raw = CASES.read_text(encoding="utf-8")
    suite = json.loads(raw)
    result = subprocess.run(
        [php, str(REFERENCE), str(pathlib.Path(args.dark_slide) / "src")],
        input=raw.encode("utf-8"),
        capture_output=True,
    )
    if result.returncode != 0:
        print(result.stderr.decode("utf-8", "replace"), file=sys.stderr)
        return 2

    goldens = json.loads(result.stdout)
    if len(goldens) != len(suite["cases"]):
        print(f"reference returned {len(goldens)} goldens for {len(suite['cases'])} cases", file=sys.stderr)
        return 2

    changed = 0
    for case, golden in zip(suite["cases"], goldens):
        before = dict(flatten(case.get("expected")))
        after = dict(flatten(golden))
        diffs = [f"{k}: {before.get(k)!r} -> {after.get(k)!r}" for k in sorted(set(before) | set(after)) if before.get(k) != after.get(k)]
        if diffs:
            changed += 1
            print(case["id"])
            for line in diffs:
                print("   ", line)
        case["expected"] = golden

    print(f"{changed} of {len(suite['cases'])} goldens {'changed' if args.write else 'would change'}")

    if args.write and changed:
        CASES.write_text(json.dumps(suite, indent=4, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        return 0

    return 1 if changed and not args.write else 0


if __name__ == "__main__":
    sys.exit(main())
