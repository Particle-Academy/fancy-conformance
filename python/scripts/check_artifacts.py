#!/usr/bin/env python3
"""Assert the built artifacts actually CARRY the fixture tree.

The fixtures are the product of this package; the loader only exists so
consumers do not hand-roll JSON reading. A wheel that builds cleanly and ships
an *empty* loader is precisely the failure this repository argues against, and
"the build succeeded" does not rule it out — `force-include` reaching outside
`python/` is exactly the kind of thing that silently resolves to nothing.

Run it after `python -m build --sdist --wheel`:

    python scripts/check_artifacts.py

It is a file rather than an inline `python -c` in the workflow because both
inline forms are traps: a heredoc terminator cannot be indented inside a YAML
`run:` block, and YAML's `>-` folding prefixes the script with a space, which
Python rejects as an IndentationError. Both were tried.
"""

from __future__ import annotations

import glob
import sys
import tarfile
import zipfile

MIN_FIXTURES = 20


def main() -> int:
    wheels = glob.glob("dist/*.whl")
    sdists = glob.glob("dist/*.tar.gz")

    if not wheels or not sdists:
        print(f"FAIL: expected a wheel and an sdist in dist/, found {wheels + sdists}")
        return 1

    names = zipfile.ZipFile(wheels[0]).namelist()
    suites = sum(1 for n in names if "_data/suites/" in n)

    problems: list[str] = []
    if suites <= MIN_FIXTURES:
        problems.append(f"wheel carries only {suites} fixture files")
    if not any(n.endswith("_data/VERSION") for n in names):
        problems.append("wheel has no VERSION")
    if not any(n.endswith("py.typed") for n in names):
        problems.append("wheel has no py.typed, but the metadata claims Typing :: Typed")

    with tarfile.open(sdists[0]) as tar:
        tnames = tar.getnames()
    if sum(1 for n in tnames if "/suites/" in n) <= MIN_FIXTURES:
        problems.append("sdist has no fixture tree")

    if problems:
        for p in problems:
            print(f"FAIL: {p}")
        return 1

    print(f"OK: wheel carries {suites} fixture files, VERSION and py.typed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
