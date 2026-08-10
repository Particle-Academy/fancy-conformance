# Writing a runner

A runner connects one implementation to the fixtures. There are two kinds,
because there are two kinds of suite.

## Table suites (`caseFormat: "table"`)

The whole suite is one JSON file of rows. A runner loads it, calls the function
under test once per row, and compares. No subprocess, no temp files.

Both loaders shipped here — `src/index.ts` for Node, `php/src/Conformance.php`
for PHP — do this for you and produce an identical summary shape:

```ts
import { runTable, formatSummary } from "@particle-academy/fancy-conformance";
import { satisfiesRange } from "../src/marketplace/manifest";

const summary = runTable(
  "shared/satisfies-range",
  (c) => satisfiesRange(c.input.version, c.input.range),
  { language: "node" },
);

console.log(formatSummary(summary));   // ALWAYS print it — see below
if (!summary.ok) process.exit(1);
```

```php
use ParticleAcademy\Conformance\Conformance;

$summary = Conformance::runTable(
    'shared/satisfies-range',
    fn (array $c) => NodeManifest::satisfiesRange($c['input']['version'], $c['input']['range']),
);

echo Conformance::formatSummary($summary), "\n";
exit($summary['ok'] ? 0 : 1);
```

For a language with no loader yet, the file format is small enough to read
directly: `suites/<id>/manifest.json` names the contract, `cases.json` holds
`{id, title, since, tags?, fn?, input, expected, skip?, notes?}` rows.

## Artifact suites (`caseFormat: "directory"`)

For capabilities that emit a document rather than return a value. Each case is a
directory holding `input.json`, `expected/`, and `meta.json`, and the
implementation is driven as a subprocess through a fixed CLI:

```
<impl-cli> <suite> <case-dir> --out <dir> [--now <iso8601>] [--profile canonical]

exit 0 — produced output
exit 2 — case not supported (MUST match a `skip` entry in the case's meta)
```

One neutral runner drives every implementation through that CLI. This is
deliberately *not* "each language writes its own harness": a per-language
harness is how the `holy-sheet` and `dark-slide` parity suites became
directory-layout-dependent and silently skippable.

Binary containers are **never** compared byte-for-byte as shipped. PHP writes
via `ZipArchive` (DEFLATE, real mtimes); the JS ports write STORE with a fixed
1980-01-01 DOS date. Those files can never match. The comparison is two-tier —
normalised parts first, then an optional rezip to a single canonical profile —
and the normalisation is declared once in the suite manifest so it cannot
quietly loosen per case.

Every writer therefore needs a determinism flag (`--now` or equivalent).
Without one, a case cannot be a golden fixture at all.

## Four rules a runner must follow

These are not style preferences. Each one is traceable to a suite in this org
that reported green while covering nothing.

1. **Run on every push and PR.** Not nightly, not at release.
2. **A missing toolchain is a FAILURE, not a skip.** `skipIf(!HAS_PHP)`
   returning green is the exact mechanism that hid two-way drift for months.
   If the suite cannot run, the job goes red.
3. **Print the summary unconditionally, including every skip and its reason.**
   Both `formatSummary` helpers do this. A bare "3 skipped" in a log reads
   identically to full coverage at a glance.
4. **Print and assert the pinned suite version.** `suiteVersion()` /
   `Conformance::version()`. "We're on an old fixture set" should be visible in
   the log rather than inferred months later.

## Adding a case

A new case lands **here first, red**, then in each implementation. Where an
implementation cannot pass it yet, it gets a `skip` entry with a real reason and
a tracking issue — and the skip shows up in that repo's CI log every run until
it is gone.
