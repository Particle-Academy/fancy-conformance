# fancy-conformance

Shared cross-language conformance fixtures for the [Fancy](https://ui.particle.academy) suite.

One contract, N implementations, and a single fixture table that **every**
implementation asserts in **its own CI, on every push** — so "parity" is a test
result rather than a claim.

```bash
npm install --save-dev @particle-academy/fancy-conformance
composer require --dev particle-academy/fancy-conformance
```

For a language with no package yet, every release attaches a plain
`fancy-conformance-<version>.tar.gz` containing just the fixtures — no npm, no
Composer, no JavaScript toolchain.

## The policy

> **N implementations of one contract are acceptable if and only if a shared
> fixture table is asserted by every implementation, in that implementation's
> own CI, on every push.**

Anything less is not parity. It is a transliteration with a README.

## Why this exists

Most Fancy server capabilities ship as a matched PHP + Node pair, so the same
feature works behind the same UI whichever backend runs it. Keeping two
implementations honest by hand does not work, and we have the receipts:

- `mcp-relay-client` ships four single-file clients. All four were
  hand-transliterated in one commit and none was touched again while the
  TypeScript source took four substantive changes. Result: **9 divergences**,
  including a wrong default relay path in all four. CI never compiled the Go
  one, never imported the Python one, never executed the shell one.
- `holy-sheet`'s PHP↔JS parity suite — the strongest guarantee in that pair —
  **never ran in CI**. `describe.skipIf(!HAS_PHP)` skipped silently and the
  workflow installed Node only. It also hard-coded `../../holy-sheet/src/`, so
  it worked in exactly one directory layout.
- `dark-slide`'s harness had the same shape, with the same green-on-zero-coverage
  outcome.
- The `FeatureSource` contract is byte-identical in two packages and maintained
  by hand. It survives only because TypeScript's structural typing does the
  checking — a mechanism that does not exist in Rust or Go.

**The counter-example is in the same org and is the whole argument.**
`satisfiesRange` is *also* a three-way duplicate — `fancy-ui-cli`, `fancy-flow`,
`fancy-flow-php` — and it has **not** drifted. The only thing it does
differently: each repo carries the identical case table in its own CI, the PHP
one literally titled *"matches the TypeScript satisfiesRange, clause for
clause."*

Same organisation, same problem shape, opposite outcome. The variable is the
shared table. That table is now `suites/shared/satisfies-range/`, promoted here
verbatim.

## What is in here

| Suite | Cases | Pins |
|---|---|---|
| `shared/satisfies-range` | 17 | Minimal semver range matching, including **two rows that deliberately disagree with standard semver** |
| `shared/decimal` | 18 | Float formatting, numeric-string coercion, and money rounding |
| `shared/money-minor-units` | 26 | Minor-unit conversion across zero-decimal and three-decimal currencies |
| `shared/strings` | 8 | Inline-markdown segmentation across CJK, emoji, combining marks and accented Latin |
| `shared/expr` | 20 | `{{ }}` dot-path resolution and branch truthiness for fancy-flow node config |
| `shared/image-header` | 16 | Image dimensions read from the header bytes, without an image library |
| `shared/flow-run-identity` | 25 | fancy-flow's run/step identity: the idempotency key a retrying connector sends, and when a retry may still reuse it |
| `flow/graph-runs` | 23 | Whole-graph execution: the same `WorkflowSchema` in, the same `RunResult.outputs` out |

Every case carries an `id`, a `title`, the suite version it arrived in, and —
where it exists to catch something specific — a `notes` field saying what.

## Using it

```ts
import { runTable, formatSummary } from "@particle-academy/fancy-conformance";
import { satisfiesRange } from "../src/marketplace/manifest";

const summary = runTable(
  "shared/satisfies-range",
  (c) => satisfiesRange(c.input.version, c.input.range),
  { language: "node" },
);

console.log(formatSummary(summary));   // always — see rule 3
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

Full runner contract, including the subprocess CLI for suites that emit
documents rather than return values: [`runners/README.md`](./runners/README.md).

## The four rules for a consuming repo

Each one is traceable to a suite in this org that reported green while covering
nothing.

1. **Run the suite on every push and PR.** Not nightly, not at release.
2. **A missing toolchain is a FAILURE, not a skip.** `skipIf(!HAS_PHP)`
   returning green is the specific mechanism that hid two-way drift for months.
   If the suite cannot run, the job goes red.
3. **Print the summary unconditionally, including every skip and its reason.**
   A bare "3 skipped" reads identically to full coverage at a glance.
4. **Print and assert the pinned suite version**, so "we're on an old fixture
   set" is visible rather than inferred.

## Skipping a case

`skip` is the only sanctioned way not to run a case, it is keyed by language,
and **the reason may not be empty** — an empty one is a load error, in both
loaders, asserted on both sides:

```json
{
  "id": "0014-round-negative-half",
  "skip": { "go": "no decimal type yet — tracking Particle-Academy/…#12" }
}
```

Every runner prints every skip. A silent skip is what turned two existing parity
suites into decoration, so it is not representable here.

## This repository holds itself to the same standard

It ships four loaders for one fixture format, which is itself a duplicated
contract. So:

- Each language's test suite proves that language reads the fixtures correctly.
- `npm run cross-check` runs **both** loaders over the same suites and requires
  identical verdicts case by case — the claim neither suite can make about
  itself. It is a required CI job, and it exits non-zero if zero cases were
  compared.
- `tests/discrimination.test.ts` runs deliberately **wrong** implementations and
  requires each to fail the exact cases that exist to catch it. A golden table
  that every plausible implementation passes is decoration; this is what proves
  it is not.

## Adding a case

A new case lands **here first, red**, then in each implementation. Where an
implementation cannot pass it yet, it gets a `skip` with a real reason and a
tracking issue — and that skip appears in that repo's CI log every run until it
is gone.

Never renumber an id. Ids appear in changelogs and in other repos' skip lists.

## Versioning

`VERSION` is the fixture set's own semver, and the publish workflow refuses a
tag unless the tag, `VERSION` and `package.json` all agree. Every implementation
pins a version and states it in its README; raising the pin is a deliberate act
with a changelog entry.

Pre-1.0, breaking changes land in minor releases.

## License

MIT
