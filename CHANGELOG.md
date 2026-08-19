# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Pre-1.0, breaking changes land in MINOR releases.** The version number is not
promising otherwise until 1.0.

## [Unreleased]

### Added

- **A Python loader**, `python/src/fancy_conformance/`, published as the PyPI
  distribution `fancy-conformance`. Same API shape as the Node and PHP loaders
  on purpose, so a reviewer comparing three CI logs is comparing like with like.
  The wheel **ships the fixture tree inside it**, so an installed package does
  not need a checkout of this repository beside it; `suites_root()` still finds
  a checkout, an envelope `repos/` layout, or `FANCY_CONFORMANCE_ROOT` first.

  It exists because four Python packages had already written it themselves.
  `holy-sheet-py`, `dark-slide-py`, `last-word-py` and `fancy-flow-py` each
  carried a private copy, **and the copies had diverged**: two of them read a
  case's `skip` as a scalar rather than as a map keyed by language, so a row
  skipped for PHP skipped on Python as well — silently reducing coverage while
  the log read green. That is this repository's own thesis failing inside its
  own consumers, four times. 27 tests, including a positive and a negative for
  every load-time guard and one specifically for the scalar-skip bug.

  *No consumer action:* nothing existing changes. Consumers should delete their
  private `tests/conformance/loader.py` and depend on this instead, as each repo
  is next touched.

### Fixed

- **`equals` no longer treats `True` as `1`** in the Python loader (the peers
  compare with `===`, so this is a Python-specific hazard). Without the guard a
  row expecting `False` is satisfied by an implementation returning `0`, which
  for a money suite is the difference between a payout and nothing.

### Known divergence

- **The three loaders do not agree on float comparison.** `Conformance::equals`
  (PHP) uses a scaled `1e-12` epsilon, `deepEquals` (TypeScript) uses exact
  `Object.is`, and the new Python loader follows PHP. No shipped case turns on
  it today, which is why it survived unnoticed in a repository whose product is
  agreement. Recorded rather than silently resolved; pick one and make the other
  two match.

## [0.3.0] - 2026-08-18

### Added

- **`shared/image-header` - intrinsic image dimensions, sniffed from PNG and
  JPEG headers.** 16 rows. Every document writer in this org needs this
  function, because a model that omits `widthPx`/`heightPx` has to be sized
  from the image itself.

  **Four implementations of this one concern already exist inside the document
  family** - `last-word`'s hand-rolled PHP sniffer, `last-word-js`'s hand-rolled
  Node sniffer, `dark-slide`'s call to PHP's `getimagesizefromstring`, and a
  fourth hand-rolled sniffer in `dark-slide-js` with different format coverage
  again. Nothing compared any of them.

  **Two live divergences were found by writing this suite**, and they run in
  OPPOSITE directions, which is the finding:

  - `0011-jpeg-fill-bytes` - a 0xFF fill byte before a marker is legal
    (ITU T.81 B.1.1.2) and real encoders emit them. The PHP sniffer advances by
    one and re-syncs; the **Node** sniffer advances by two, steps over the real
    frame marker and returns null. The same JPEG therefore embeds at a
    different size depending on which backend wrote the document.
  - `0012-jpeg-sos-before-sof` - after a start-of-scan the bytes are
    entropy-coded, so an `FF Cx` sequence found there is compressed data, not a
    frame header. The Node sniffer stops; the **PHP** sniffer keeps walking and
    reports dimensions it read out of the scan. This is the worse failure: a
    null sniff falls back to a default, a wrong sniff is believed.

  Neither hand-rolled sniffer is a superset of the other - each has exactly one
  defect - so "just follow the reference" would have shipped one of the two into
  every new implementation. Each divergent case carries a `skip` for the engine
  that fails it, naming the defect and the fix, and those skips print in every
  runner's log until they are gone.

  `0012` also carries a `python` skip, and the reason is the point of the suite:
  the new Python port of `last-word` is a faithful mirror of the PHP reference
  and therefore **inherited the defect** - verified against the table rather
  than assumed. It was deliberately not fixed there alone, because fixing one
  engine breaks part-level parity with the other two, which is the whole
  contract. That is the prediction this suite was written to test, and it
  came true on the first run.

  PHP's own `getimagesizefromstring` was run over the same bytes as a third
  opinion and is what breaks each tie. It is not itself a candidate reference:
  it answers `4x4` for a PNG whose first chunk is not IHDR (`0005`) and `0x9`
  for a zero-width one (`0006`), where both hand-rolled sniffers correctly
  refuse.

  GIF, WebP, BMP, TIFF and ICO are deliberately **not** in the contract, with a
  case (`0014`) pinning the refusal. `getimagesizefromstring` knows all of them
  and both hand-rolled sniffers know none; widening the contract is a decision
  for the pair owners, not something a fixture should smuggle in.

  Seven discrimination tests, each asserting the **exact** set of ids its mutant
  fails, plus a faithful control - without which a table no implementation can
  pass would look maximally discriminating. The mutants run as `rust`, a
  language with no `skip` entries, because running them as `node` or `php` would
  silently drop the very case that catches each one.

### Fixed

- **`VERSION` and `package.json` are now asserted to agree.** The test named
  `reports the suite collection's own version` carried the comment *"If VERSION
  and package.json ever disagree, the pin a consumer states in its README means
  nothing"* — and then asserted only that the string looked like a semver
  triple. The invariant it named was checked by nobody.

  That is the same mechanism this repository documents elsewhere: two files
  holding one number with nothing comparing them. It is what left every package
  in the documents family misreporting its own version at runtime — three PHP
  constants stale against their own CHANGELOGs, three Node constants stale
  against their own `package.json`s. Verified the new assertion fails against a
  drifted `VERSION` before keeping it.

- `shared/image-header` added to the suite-discovery assertion, so a suite that
  vanished would fail rather than simply stop being covered.

## [0.2.0] - 2026-08-11

### Added

- **`shared/expr` - `{{ }}` expression resolution for fancy-flow node config.**
  20 rows covering dot-path resolution, the `$json` / `$input` aliases, the
  whole-string-keeps-its-type rule, interpolation stringifying, and branch
  truthiness.

  This suite exists because of what conformance could NOT catch, which is worth
  recording. `FancyFlow\Nodes\Support\Expr` shipped in PHP with **no TypeScript
  twin at all**. A fixture table compares two implementations - it is
  structurally unable to report a MISSING one. The gap surfaced only when a
  consumer asked for editor autocomplete over the grammar, and the grammar
  turned out to live on exactly one side.

  `truthy` carries the weight: `"0"`, `"false"` and `[]` are all truthy in
  JavaScript and falsy in PHP, and a branch node reading a form value or a JSON
  body hits every one. An implementation forwarding to native truthiness fails
  cases 0013-0015 and nothing else.


## [0.1.0] - 2026-08-10

First release. Fixtures, two loaders, and the CI shape that makes them mean
something.

### Added

- **`suites/shared/satisfies-range`** — 17 cases, the minimal semver range
  matcher. Promoted verbatim from the identical table already carried by
  `fancy-ui-cli`, `fancy-flow` and `fancy-flow-php`. Two rows deliberately
  disagree with standard semver (`1.2.3-beta.1` vs `^1.2`, and `0.0.2` vs
  `^0.0.1`), and are tagged `non-standard` so a fourth implementation reaching
  for a stock semver library fails exactly those rather than discovering the
  difference in production.
- **`suites/shared/decimal`** — 18 cases covering float formatting, numeric
  string coercion, and money rounding. Every formatting case was a live PHP↔JS
  disagreement in shipped packages.
- **`suites/shared/strings`** — 8 cases pinning inline-markdown segmentation
  across CJK, emoji, combining marks and accented Latin. PHP indexes by byte and
  the TypeScript port by UTF-16 code unit; they agree, but **incidentally**, and
  Rust cannot inherit that for free.
- **Two loaders with one API shape** — `src/index.ts` and
  `php/src/Conformance.php`. Both reject a skip with no reason and a duplicate
  case id at load time, both take an explicit root so those guards are testable
  through the real code, and both print every skip by name and reason.
- **`npm run cross-check`** — runs both loaders over the same suites and
  requires identical verdicts case by case. Exits non-zero if zero cases were
  compared, so a run that asserted nothing cannot look like a run that asserted
  everything.
- **Discrimination tests** — deliberately wrong implementations, each required
  to fail the exact set of case ids that exists to catch it, alongside a
  faithful control that must pass everything.
- **Language-neutral tarball** on every GitHub release, holding just the
  fixtures, for a CI job with no npm or Composer.

### Fixed

- **A live PHP↔JS divergence in `fancy-mlm`**, found by writing
  `suites/shared/decimal`. `RewardComputation::amountAsInt()` is `(int) round($v)`
  — half away from zero — and its documented mirror `amountAsInt()` in
  `fancy-mlm-js` is `Math.round(v)`, which is half toward positive infinity.
  They disagree on **every negative half**: PHP pays `-3` where JS pays `-2`,
  and `-0.5` becomes a whole unit on one backend and nothing on the other.

  Reachable through configuration rather than only in theory: `levelFactors` is
  `.map(Number)` straight off host config with no sign validation, so a negative
  factor produces a negative reward and the two backends then pay different
  amounts for the same event.

  **Pinned here as cases `0014`, `0015` and `0016`.** This repository does not
  ship the fix — it ships the failing evidence, which is the point. See
  `fancy-mlm-js`'s own changelog for the correction.

### Notes for consumers

Nothing to upgrade — this is a new package. To adopt it, add the dev dependency,
write a runner (see [`runners/README.md`](./runners/README.md)), and make it a
required CI job. The four rules in the README are not style preferences; each
one is traceable to a suite in this org that reported green while covering
nothing.

[Unreleased]: https://github.com/Particle-Academy/fancy-conformance/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Particle-Academy/fancy-conformance/releases/tag/v0.1.0
