# AGENTS.md — fancy-conformance

Shared cross-language conformance fixtures. This file describes **this repo's
code and invariants**. Process rules — publishing, kit versioning, backports —
live in the envelope's `AGENTS.md` and are deliberately not repeated here.

## What this repo is

Data, plus four thin loaders for it. The fixtures are the product; the loaders
exist so a consumer does not have to hand-roll JSON reading in every repo.

```
VERSION                  the fixture set's own semver — printed by every runner
suites/<id>/manifest.json  what contract this suite pins, and whose behaviour is the reference
suites/<id>/cases.json     the rows
schema/                  JSON Schema for both of the above
parity/                  the release-parity ledger schema + procedure
runners/README.md        how to write a runner; the subprocess CLI contract
src/index.ts             Node loader
php/src/Conformance.php  PHP loader — same API shape, deliberately
python/src/fancy_conformance/  Python loader — same again; ships the fixtures in its wheel
rust/src/lib.rs          Rust loader — same again; reads JSON through first-party `fancy-json`
scripts/cross-check.mjs  runs BOTH loaders and requires identical verdicts
```

**The Rust loader was added with `fancy-flow-rs`, for the same reason the Python
one was.** Writing a private copy in the repo under test would have been the
fifth time, in the repository that exists to stop exactly that. Its only
dependency is first-party `fancy-json`, which has none of its own — so a Rust
consumer runs the tables without a third-party approval conversation.

**The Python loader was added because four consumers had already written it
themselves and their copies had diverged.** `holy-sheet-py`, `dark-slide-py`,
`last-word-py` and `fancy-flow-py` each carried a private `tests/conformance/loader.py`;
two of them read a case's `skip` as a scalar instead of a map keyed by language,
so a row skipped for PHP skipped on Python too and the log still read green.
That is this repository's own thesis failing inside its own consumers. Delete
those copies as each repo is next touched — the promoted loader is the one that
gets fixed.

## Invariants

**A skip must have a non-empty reason.** Enforced at LOAD time in every loader,
with matching messages, asserted positively and negatively on every side. This
is the repository's entire thesis; if it is ever relaxed, the package is
decoration.

**`skip` is a MAP keyed by language, never a scalar.** `{"php": "no PHP impl"}`
skips PHP and nothing else. A loader reading it as a truthy value skips the row
for *every* language and simultaneously makes the empty-reason guard unreachable,
because a non-empty dict is never blank. Both effects are silent. Two shipped
Python copies had exactly this bug; `python/tests/test_loader.py` now pins it
from both directions.

**A duplicate case id is a load error.** Ids appear in other repos' skip lists
and in changelogs.

**Case ids are never renumbered.** A test asserts they are unique and sorted.
Inserting between `0003` and `0004` means `0004` and everything after it keeps
its number and the new case goes at the end — ordering in the file is not
chronology.

**Goldens come from running the reference implementation, never from what the
value obviously is.** `suites/shared/decimal/0003-format-1e300` is 301 digits
and is *not* 1 followed by 300 zeros, because `number_format` prints the exact
value of the double and the nearest double to 1e300 is not 10^300. The first
draft of the discrimination probe asserted the round number and was wrong.

**The loaders find their root by walking up to `suites/`.** Never a fixed
`../..`, and never a path to a sibling checkout. The two parity harnesses this
package replaces both hard-coded `../../holy-sheet/src/`, which is why they ran
in exactly one directory layout and silently no-opped everywhere else.

**Every loader takes an explicit root** (`loadSuiteFrom`, `Conformance::cases($suite, $root)`,
`cases(suite, root=...)`)
so the guards above are tested through the real code rather than a copy. An
earlier draft of both test files re-implemented the guard inside the test, which
would have asserted nothing — the exact bug this repo exists to catch, nearly
shipped inside it.

## Traps

**Do not embed PHP in a JavaScript template literal.** `scripts/cross-check-driver.php`
is a real file for this reason: a namespace separator and a regex `\d` are both
backslashes, and the doubling rules differ. The first version got it wrong in
two places and failed to parse. The bad outcome is the slip that still parses.

**`toExponential(20)` is not an exact expansion.** It gives 21 significant
digits and pads. Use `BigInt(v)` for an integral double.

**Pest's `toContain` takes variadic needles.** `expect($x)->toContain($needle, $message)`
looks for the message too, and fails for a reason unrelated to the assertion.
Use `expect(condition)->toBeTrue($message)`.

**On Windows, `php` from Herd is a shell shim** and cannot be spawned by Node.
`CONFORMANCE_PHP` takes an absolute path to a real `php.exe`. It is not an opt
out — an unset or wrong value still fails the run.

## Adding a suite

1. `suites/<capability>/manifest.json` — declare the contract, the reference
   language, and every known implementation.
2. `cases.json` — rows. Give each one a `notes` if it exists to catch something
   specific; a case without a stated purpose gets deleted by someone later.
3. Add discrimination tests: a faithful probe that passes everything (the
   control — without it the mutants prove nothing), plus one mutant per hazard
   asserting the **exact** set of ids it fails.

   **`flow/graph-runs` has none, and that is a known gap rather than an
   oversight.** The implementation under test there is an entire workflow
   engine, which this package does not carry and should not grow. Its rows
   therefore guard DRIFT between four runtimes but do not prove they
   discriminate; the manifest's `notes` says so, so nobody reads its green tick
   as the stronger claim.
4. If the suite emits documents rather than values, use `caseFormat: "directory"`
   and declare the normalisation in the manifest. Never byte-compare a zip
   container as shipped — PHP writes DEFLATE with real mtimes, the JS ports
   write STORE with a fixed 1980 date, and those files can never match.

## Testing

```bash
npm test                                                   # Node loader + discrimination
vendor/bin/pest                                            # PHP loader
cd python && python -m pytest                              # Python loader
cd rust && cargo test                                      # Rust loader
CONFORMANCE_PHP=<abs path to php.exe> npm run cross-check   # Node + PHP, compared
```

All five are required CI jobs. `npm test` is NOT run with `--if-present` here:
a green tick over an absent suite is the failure this package is about.

**This section said "all four are required CI jobs" while `ci.yml` had only
`node`, `php` and `cross-language`.** The Python loader and its 27 tests ran
NOWHERE — a claim about coverage, in the repository whose entire argument is
that such a claim must be a test result rather than a sentence. Both the
`python` and `rust` jobs were added on 2026-08-23. If you add a sixth loader,
the job is part of adding it.

**`cross-check.mjs` still compares only Node and PHP.** Extending it to the
Python loader is open work; until it lands, the Python loader is asserted by its
own suite rather than against a peer's verdict, which is weaker and is recorded
here so nobody reads three green ticks as a three-way comparison.

### Float comparison — CLOSED, and how

This section used to record a live 3-1 split: PHP, Python and Rust compared
floats with a scaled `1e-12` epsilon while TypeScript used exact `Object.is`, in
a repository whose product is agreement. It ended with "pick one and make the
other three match". Resolved in 0.10.0: **all four are exact.**

**The epsilon lost because its justification was measurably false.** It was
stated as "a golden written as `0.002` in JSON is a decimal literal, and the
nearest double to it is not the nearest double to every language's parse of the
same text". Measured rather than argued: `0.002` (the literal the justification
itself named), `0.1`, `1e300`, `DBL_MAX`, the `5e-324` denormal and
`0.30000000000000004` all parse to **bit-identical doubles** in PHP, Python and
Node. Decimal-to-double conversion is specified, not per-implementation.

What the epsilon actually did was let two runtimes that computed DIFFERENT
values pass as equal — the one thing this package exists to catch. On a money
row a relative `1e-12` is real money at scale.

**A case that genuinely needs tolerance declares one on the row**
(`"tolerance": 1e-9`), where a reader of the fixture can see it. A global
epsilon is invisible: nobody reading a case can tell whether it asserts a value
or a neighbourhood. Same principle as a skip having to state its reason.

**Numbers compare by VALUE, not by JSON type.** An integer golden IS satisfied
by a float of the same value, and that is not laxness — `shared/decimal/0008-coerce-exponent`
requires it, because PHP's `"1e5" + 0` yields `float(100000)` against an integer
golden. The reference language is JavaScript, which has ONE number type, so a
golden can never encode "this must be a float"; a loader enforcing that
distinction asserts something no golden is able to claim. An earlier draft of
the 0.10.0 change did enforce it, and both that fixture and a Rust unit test
caught the contradiction — the Rust test was the one that was wrong, and its
value assertions survive unchanged and are now stronger, being exact.

Proven by `npm run cross-check`: 35 cases, two loaders, identical verdicts.
