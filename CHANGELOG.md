# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Pre-1.0, breaking changes land in MINOR releases.** The version number is not
promising otherwise until 1.0.

## [Unreleased]

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
