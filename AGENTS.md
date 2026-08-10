# AGENTS.md — fancy-conformance

Shared cross-language conformance fixtures. This file describes **this repo's
code and invariants**. Process rules — publishing, kit versioning, backports —
live in the envelope's `AGENTS.md` and are deliberately not repeated here.

## What this repo is

Data, plus two thin loaders for it. The fixtures are the product; the loaders
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
scripts/cross-check.mjs  runs BOTH loaders and requires identical verdicts
```

## Invariants

**A skip must have a non-empty reason.** Enforced at LOAD time in both loaders,
with matching messages, asserted positively and negatively on both sides. This
is the repository's entire thesis; if it is ever relaxed, the package is
decoration.

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

**Both loaders take an explicit root** (`loadSuiteFrom`, `Conformance::cases($suite, $root)`)
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
CONFORMANCE_PHP=<abs path to php.exe> npm run cross-check   # both, compared
```

All three are required CI jobs. `npm test` is NOT run with `--if-present` here:
a green tick over an absent suite is the failure this package is about.
