# fancy-conformance (Python)

The Python loader for the shared [fancy-conformance](../README.md) fixtures —
the third one, alongside `src/index.ts` (Node) and `php/src/Conformance.php`
(PHP), and deliberately the same shape so a reviewer comparing three CI logs is
comparing like with like.

```bash
pip install fancy-conformance          # ships the fixtures with it
```

## Why it lives here

Four Python packages — `holy-sheet-py`, `dark-slide-py`, `last-word-py` and
`fancy-flow-py` — each carried a private copy of this file, because there was no
Python loader to import. **Those copies had already diverged.** Two of them read
a case's `skip` as a scalar rather than as a map keyed by language, so a row
skipped for PHP skipped on Python too — silently reducing coverage while the log
still read green.

That is the exact failure this repository exists to stop, reproduced inside its
own consumers, four times, within weeks. A shared contract with N hand-maintained
copies is the thing the README argues against; the loader was not exempt.

## Using it

```python
from fancy_conformance import format_summary, run_table
from my_package import round_money


def impl(case):
    return round_money(case["input"]["value"])


summary = run_table("shared/decimal", impl)
print(format_summary(summary))  # unconditionally, including skips
assert summary["ok"], format_summary(summary)
```

`run_table` takes `language="python"` by default; pass another when a Python
harness drives a different implementation out of process, exactly as the PHP
loader's `$language` argument allows.

## API

| Function | What it does |
|---|---|
| `suites_root()` | The fixture root. **Raises** if it cannot be found — never returns `None`. |
| `version()` | The fixture collection's own semver. A runner must print it. |
| `list_suites()` | Every suite id present. |
| `manifest(suite)` | One suite's manifest: the contract, and whose behaviour is the reference. |
| `cases(suite)` | The rows, with the load-time guards enforced. |
| `run_table(suite, impl, language=…)` | Run one implementation; a throw is a failing row, not a crash. |
| `format_summary(summary)` | A log a human can read, naming every skip. |
| `equals(a, b)` | The comparison `run_table` uses; exported so a suite can override it. |
| `suite_path(suite)` | Absolute path to a suite directory, for artifact runners. |

## Two rules in `equals` that differ from a peer

**Booleans are not integers.** Python's `==` says `True == 1`. Without the guard,
a row expecting `False` is satisfied by an implementation returning `0`. The
peers compare with `===` / `===`; this restores that. Python-specific, and not a
divergence.

**Floats compare within a scaled `1e-12` epsilon; integers compare exactly.**
This follows the *PHP* loader. The TypeScript loader uses exact `Object.is`
instead — so the three loaders do not currently agree on float comparison, which
is a real (if narrow) divergence recorded in
`.ai/plans/fancy-python-commerce-gating.md` rather than quietly picked. Integers
stay exact so a `roundMoney` returning 2 never satisfies a golden of 3.

## Finding the fixtures

Resolution order, and none of it is a fixed `../..`:

1. `FANCY_CONFORMANCE_ROOT`
2. fixtures shipped inside the installed wheel (`fancy_conformance/_data/`)
3. a bounded walk up to whatever directory holds `suites/` (a checkout)
4. a bounded walk up for a sibling `fancy-conformance`, directly or under
   `repos/` (an envelope layout)

If all four fail it **raises**. A missing checkout is a red build, not a skip.

## Testing

```bash
python -m pytest            # 27 tests, no install required
```

The suite is written against the real loader with an explicit `root`, never
against a copy of a guard living in the test — the failure mode this repository
exists to catch, and one that was nearly shipped inside it twice.
