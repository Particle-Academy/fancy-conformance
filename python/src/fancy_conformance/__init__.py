"""Loader for the shared conformance fixtures, for Python implementations.

The third loader, deliberately the same shape as ``src/index.ts`` (Node) and
``php/src/Conformance.php`` (PHP), so a reviewer comparing three CI logs is
comparing like with like.

It exists because four Python packages -- ``holy-sheet-py``, ``dark-slide-py``,
``last-word-py`` and ``fancy-flow-py`` -- each carried a private copy of it, and
those copies had **already diverged**: two of them read a case's ``skip`` as a
scalar rather than as a map keyed by language, which makes a row skipped for PHP
silently skip on Python too, while the log still reads green. That is precisely
the failure this repository exists to stop, reproduced inside its own consumers,
which is why the loader belongs here rather than in any of them.

Zero runtime dependencies: a fixture loader that needs a framework booted is a
fixture loader that gets skipped.

Four rules from ``runners/README.md``, all honoured below:

1. Run on every push and PR -- not nightly, not at release.
2. **A missing toolchain is a FAILURE, not a skip.** ``skipIf(!HAS_X)``
   returning green is the exact mechanism that hid two-way drift for months, so
   :func:`suites_root` raises rather than returning ``None``.
3. Print the summary unconditionally, including every skip and its reason.
4. Print and assert the pinned suite version.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from pathlib import Path
from collections.abc import Mapping
from typing import Any, Literal

__version__ = "0.18.0"

Language = Literal["php", "node", "rust", "python", "go"]

__all__ = [
    "Language",
    "cases",
    "equals",
    "format_summary",
    "list_suites",
    "manifest",
    "run_table",
    "suite_path",
    "suites_root",
    "version",
]

_ENV = "FANCY_CONFORMANCE_ROOT"

#: Where a wheel build drops the fixture tree, so an installed package carries
#: its own data and does not need a checkout beside it.
_PACKAGED_DATA = Path(__file__).resolve().parent / "_data"


def suites_root() -> Path:
    """The fixture root -- the directory holding ``suites/``.

    Resolution order:

    1. the ``FANCY_CONFORMANCE_ROOT`` environment variable,
    2. fixtures shipped inside this package (an installed wheel),
    3. a bounded walk up from this file to whatever directory holds ``suites/``
       (a checkout of this repository),
    4. a bounded walk up looking for a sibling ``fancy-conformance`` checkout,
       directly or under ``repos/`` (an envelope layout).

    Never a fixed ``../..`` and never a hard-coded sibling path: the two parity
    harnesses this package replaced both did that, which is why they ran in
    exactly one directory layout and silently no-opped everywhere else.

    Raises rather than returning ``None`` so the failure is a red build.
    """
    override = os.environ.get(_ENV)
    if override:
        candidate = Path(override)
        if (candidate / "suites").is_dir():
            return candidate
        raise RuntimeError(
            f"{_ENV} is set to {override!r} but there is no suites/ directory there."
        )

    if (_PACKAGED_DATA / "suites").is_dir():
        return _PACKAGED_DATA

    here = Path(__file__).resolve()
    for parent in here.parents[:8]:
        if (parent / "suites").is_dir():
            return parent
        for base in (parent, parent / "repos"):
            sibling = base / "fancy-conformance"
            if (sibling / "suites").is_dir():
                return sibling

    raise RuntimeError(
        "fancy-conformance: could not locate the suites/ directory. Check this repository "
        f"out beside the one under test or set {_ENV} to its root. This is deliberately an "
        "error and not a skip: a conformance suite that silently does not run is worse than "
        "no suite, because the log reads identically to full coverage."
    )


def version() -> str:
    """The fixture collection's own version -- the thing a runner must print."""
    return (suites_root() / "VERSION").read_text(encoding="utf-8").strip()


def list_suites() -> list[str]:
    """Every suite id present, e.g. ``["shared/decimal", "shared/expr", ...]``."""
    root = suites_root() / "suites"
    return sorted(m.parent.relative_to(root).as_posix() for m in root.rglob("manifest.json"))


def suite_path(suite: str, root: Path | str | None = None) -> str:
    """Absolute path to a suite's directory -- for runners that read artifacts."""
    return str(_root(root) / "suites" / suite)


def manifest(suite: str, root: Path | str | None = None) -> dict[str, Any]:
    """One suite's manifest: the contract it pins and whose behaviour is the reference."""
    path = _root(root) / "suites" / suite / "manifest.json"
    decoded = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(decoded, dict):
        raise RuntimeError(f"fancy-conformance: {path} is not an object.")
    return decoded


def cases(suite: str, root: Path | str | None = None) -> list[dict[str, Any]]:
    """Load a table suite's rows, enforcing the repository's own invariants.

    ``root`` exists so the load-time guards below can be tested against a
    throwaway fixture tree, rather than a test re-implementing them. A guard
    asserted by a copy of itself is the failure mode this whole repository
    exists to stop, and it would be an embarrassing one to ship here. Both peer
    loaders take the same argument for the same reason.
    """
    base = _root(root)
    meta = manifest(suite, base)

    if meta.get("caseFormat") != "table":
        raise RuntimeError(
            f'fancy-conformance: suite "{suite}" is not a table suite. Directory suites are '
            "driven through the subprocess CLI in runners/, not this loader."
        )

    payload = json.loads(
        (base / "suites" / suite / meta.get("cases", "cases.json")).read_text(encoding="utf-8")
    )
    rows = payload.get("cases")

    if not isinstance(rows, list) or not rows:
        raise RuntimeError(f'fancy-conformance: suite "{suite}" has no cases.')

    _assert_usable_cases(suite, rows)
    return rows


def _assert_usable_cases(suite: str, rows: list[dict[str, Any]]) -> None:
    """Reject a case table that cannot do its job, at LOAD time.

    A skip with no reason and a duplicate id are both otherwise silent: the
    suite still loads, still reports green, and still covers less than it
    appears to.
    """
    seen: set[str] = set()

    for row in rows:
        case_id = str(row.get("id"))
        if case_id in seen:
            raise RuntimeError(
                f'fancy-conformance: suite "{suite}" has duplicate case id "{case_id}".'
            )
        seen.add(case_id)

        # `skip` is a MAP keyed by language, not a string. Reading it as a
        # scalar makes every skip apply to every language AND makes the
        # empty-reason guard unreachable, because `str({...})` is never blank.
        for language, reason in (row.get("skip") or {}).items():
            if not isinstance(reason, str) or reason.strip() == "":
                raise RuntimeError(
                    f'fancy-conformance: case "{suite}/{case_id}" skips {language} with no '
                    "reason. A skip must say why, because every runner prints it."
                )


def run_table(
    suite: str,
    impl: Callable[[dict[str, Any]], Any],
    language: Language | str = "python",
    root: Path | str | None = None,
    equals_fn: Callable[[Any, Any], bool] | None = None,
) -> dict[str, Any]:
    """Run one implementation against a table suite.

    ``impl`` receives a case and returns the value to compare. A case that
    raises is a FAILURE with the message recorded, not a crash -- an
    implementation blowing up is data about the implementation.

    ``language`` decides which ``skip`` entries apply, and is reported in the
    summary. It is a parameter rather than a constant so a Python harness can
    drive another implementation out of process, exactly as the PHP loader's
    ``$language`` argument allows.
    """
    # A caller-supplied comparator may take two arguments; the built-in takes an
    # optional third. Adapting here keeps a custom comparator working rather
    # than breaking every caller that passed one before tolerances existed.
    base = equals_fn or equals

    def compare(actual: Any, expected: Any, tolerance: float | None) -> bool:
        try:
            return bool(base(actual, expected, tolerance))
        except TypeError:
            return bool(base(actual, expected))

    results: list[dict[str, Any]] = []

    for row in cases(suite, root):
        reason = (row.get("skip") or {}).get(language)
        if reason is not None:
            results.append(
                {"id": row["id"], "title": row.get("title"), "status": "skip", "reason": reason}
            )
            continue

        try:
            actual: Any = impl(row)
        except Exception as exc:
            results.append(
                {
                    "id": row["id"],
                    "title": row.get("title"),
                    "status": "fail",
                    "expected": row.get("expected"),
                    "actual": f"threw: {exc}",
                }
            )
            continue

        expected = row.get("expected")
        results.append(
            {"id": row["id"], "title": row.get("title"), "status": "pass"}
            if compare(actual, expected, _tolerance_for(row))
            else {
                "id": row["id"],
                "title": row.get("title"),
                "status": "fail",
                "expected": expected,
                "actual": actual,
            }
        )

    def count(status: str) -> int:
        return sum(1 for r in results if r["status"] == status)

    failed = count("fail")

    return {
        "suite": suite,
        "language": language,
        "suiteVersion": version(),
        "passed": count("pass"),
        "failed": failed,
        "skipped": count("skip"),
        "results": results,
        "ok": failed == 0,
    }


def _tolerance_for(case: Mapping[str, Any]) -> float | None:
    """A case's declared float tolerance, or ``None`` for exact comparison.

    Declared ON THE ROW so it is visible in the fixtures and in any diff of
    them. A global epsilon is invisible: nobody reading a case can tell whether
    it asserts a value or a neighbourhood.

    ``bool`` is excluded explicitly -- ``isinstance(True, int)`` is true in
    Python, so a stray ``"tolerance": true`` would otherwise become a tolerance
    of 1.0 and quietly pass almost anything.
    """
    tolerance = case.get("tolerance")
    if isinstance(tolerance, bool) or not isinstance(tolerance, int | float):
        return None
    return float(tolerance)


def equals(a: Any, b: Any, tolerance: float | None = None) -> bool:
    """Order-sensitive for lists, order-insensitive for object keys.

    Two deliberate rules, each with a peer it is matching:

    **Booleans are not integers.** Python's ``==`` says ``True == 1`` and
    ``False == 0``; the peers compare with ``===`` and PHP's ``equals`` with
    ``===`` too. Without this a row expecting ``False`` is satisfied by an
    implementation returning ``0``, and a money row expecting ``0`` by one
    returning ``False``.

    **Floats compare EXACTLY, by numeric value.** A scaled ``1e-12`` epsilon
    used to live here, justified as "a golden written as ``0.002`` in JSON is a
    decimal literal, and the nearest double to it is not the nearest double to
    every language's parse of the same text".

    That justification is FALSE, and it was measured rather than argued.
    ``0.002`` -- the literal the reason itself named -- along with ``0.1``,
    ``1e300``, ``DBL_MAX``, the ``5e-324`` denormal and
    ``0.30000000000000004`` all parse to BIT-IDENTICAL doubles in PHP, Python
    and Node. Decimal-to-double conversion is specified, not per-implementation.

    What the epsilon actually did was let two runtimes that computed DIFFERENT
    values pass as equal, in the package whose entire product is detecting
    exactly that. On a money row a relative ``1e-12`` is real money at scale.

    Where a case genuinely needs tolerance it declares one -- visible on the row
    and reviewable in a diff, rather than a global behaviour no reader of the
    fixtures can see. Same principle as a skip having to state its reason.
    """
    if isinstance(a, bool) != isinstance(b, bool):
        return False
    if isinstance(a, bool):
        return a is b

    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            return False
        return all(equals(a[k], b[k], tolerance) for k in a)

    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False
        return all(equals(x, y, tolerance) for x, y in zip(a, b, strict=True))

    if isinstance(a, dict | list) or isinstance(b, dict | list):
        return False

    if isinstance(a, int | float) and isinstance(b, int | float):
        if isinstance(a, int) and isinstance(b, int):
            return a == b
        if tolerance is not None:
            scale = max(1.0, abs(float(a)), abs(float(b)))
            return abs(float(a) - float(b)) <= tolerance * scale
        return float(a) == float(b)

    return bool(a == b)


def format_summary(summary: dict[str, Any]) -> str:
    """A summary a CI log can be read from -- including every skip, by name and reason.

    Skips are printed unconditionally and never folded into a bare count.
    "3 skipped" in a log looks the same as full coverage at a glance, which is
    how a suite stops meaning anything without anyone deciding that it should.
    """
    lines = [
        f"{summary['suite']} [{summary['language']}] "
        f"-- fancy-conformance {summary['suiteVersion']}",
        f"  {summary['passed']} passed, {summary['failed']} failed, {summary['skipped']} skipped",
    ]

    for r in summary["results"]:
        if r["status"] == "skip":
            lines.append(f"  SKIP {r['id']} -- {r['reason']}")
        if r["status"] == "fail":
            lines.append(f"  FAIL {r['id']} {r.get('title') or ''}".rstrip())
            lines.append(f"       expected: {_preview(r.get('expected'))}")
            lines.append(f"       actual:   {_preview(r.get('actual'))}")

    return "\n".join(lines)


def _preview(value: Any) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return f"{text[:60]}...{text[-40:]} (len {len(text)})" if len(text) > 120 else text


def _root(root: Path | str | None) -> Path:
    return suites_root() if root is None else Path(root)
