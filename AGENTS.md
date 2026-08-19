# AGENTS.md — fancy-conformance

Shared cross-language conformance fixtures. This file describes **this repo's
code and invariants**. Process rules — publishing, kit versioning, backports —
live in the envelope's `AGENTS.md` and are deliberately not repeated here.

## What this repo is

Data, plus three thin loaders for it. The fixtures are the product; the loaders
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
scripts/cross-check.mjs  runs BOTH loaders and requires identical verdicts
```

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
4. If the suite emits documents rather than values, use `caseFormat: "directory"`
   and declare the normalisation in the manifest. Never byte-compare a zip
   container as shipped — PHP writes DEFLATE with real mtimes, the JS ports
   write STORE with a fixed 1980 date, and those files can never match.

## Testing

```bash
npm test                                                   # Node loader + discrimination
vendor/bin/pest                                            # PHP loader
cd python && python -m pytest                              # Python loader
CONFORMANCE_PHP=<abs path to php.exe> npm run cross-check   # Node + PHP, compared
```

All four are required CI jobs. `npm test` is NOT run with `--if-present` here:
a green tick over an absent suite is the failure this package is about.

**`cross-check.mjs` still compares only Node and PHP.** Extending it to the
Python loader is open work; until it lands, the Python loader is asserted by its
own suite rather than against a peer's verdict, which is weaker and is recorded
here so nobody reads three green ticks as a three-way comparison.

### The float-comparison divergence, in the loaders themselves

`Conformance::equals` compares floats with a scaled `1e-12` epsilon; the
TypeScript `deepEquals` uses exact `Object.is`. The Python loader follows PHP.
So the three loaders do **not** agree on how a float golden is compared, in a
repository whose product is agreement. No shipped case turns on it today
(`shared/decimal`'s float rows round-trip identically through all three JSON
parsers), which is why it has survived. Pick one and make the other two match.
