# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Pre-1.0, breaking changes land in MINOR releases.** The version number is not
promising otherwise until 1.0.

## [Unreleased]

## [0.9.0] - 2026-08-25

### Added

- **`flow/workflow-props` (20 cases)** — resolving the flat, by-name object a
  caller passes against the `inputs` a workflow declares.

  Written ALONGSIDE the feature rather than after it, which is the first time
  that has happened here. `flow/subflow-registry` was written once all four
  runtimes had already shipped the same bug; this table existed before the
  second runtime was started, so it is a specification the ports are built
  against instead of a post-mortem.

  The behaviour being replaced was silence. Run inputs were keyed BY NODE ID,
  so a caller had to know the trigger happened to be called `t` — and nothing
  declared what a workflow accepted, so a **misspelled key was not an error**.
  The value sat unread, the node saw nothing, and the run reported success with
  output that was quietly wrong. Case `0101` is that case, and every
  implementation must fail it.

  Three traps get their own rows because a re-implementation gets them wrong
  and nothing goes red:

  - **`0004`–`0006`, the falsy trap.** `0`, `false` and `""` are values a caller
    MEANT to pass. A default applied with `||`, or `??` on the wrong side,
    silently replaces them — a declared limit of `0` quietly becoming `10` is
    not an error anyone observes.
  - **`0010` / `0106` / `0107`, array-versus-object.** `typeof []` is
    `"object"`, so a check written with `typeof` alone rejects a real array
    declared `array` AND accepts an array declared `object`. Note `0106` passes
    such a mutant by accident, which the discrimination test records rather
    than papers over.
  - **`0007`, absent is absent.** PHP has one absent value and JS has two. A
    port that writes `null` for every unsupplied optional makes
    `{{ $props.note }}` resolve differently across runtimes for one graph.

  Five discrimination tests: a faithful control plus one mutant per hazard,
  each asserting the exact set of ids it fails.

### Fixed

- **The Python loader's version had drifted two releases behind and the check
  that would have caught it was failing.** `python/pyproject.toml` and
  `fancy_conformance.__version__` both sat at `0.7.0` while `VERSION` and
  `package.json` said `0.8.0`, so a Python consumer printing the pinned suite
  version reported a fixture set it was not running.

  The test asserting all four agree already existed and was RED. A red test
  nobody is failing the build on is a comment — and this is the repository
  whose entire product is that unchecked duplicates drift. All four now say
  `0.9.0`.

## [0.8.0] - 2026-08-24

### Added

- **`flow/subflow-registry` (9 cases)** — what executors a `subflow` runs its
  CHILD graph against.

  This table exists because **all four runtimes had the same defect at once**,
  and each of the three that were fixed carried its own hand-written test for
  it. Three copies of an assertion agree right up until someone changes one of
  them, and nothing reports the divergence — the same shape as the bug the
  table describes.

  Reported against the PHP twin as `fancy-flow-php#7`: a child containing a
  host-registered kind failed with `No executor registered`, while the
  identical graph run at top level succeeded. PHP and Python fell back to the
  bare builtins; **TypeScript was worse**, running the child against
  `config.executors ?? {}` — an EMPTY registry unless the graph carried one.
  None warned, because an unregistered kind fails closed with no outputs.

  The costly case is a REPLACED kind rather than a missing one: a host that
  overrides `llm_call` for tenancy or budgeting got its own version in the
  parent and the package's in the child, billing two ways by nesting depth.

- **Discrimination probes for it**, and unlike `flow/graph-runs` this suite
  actually has them. The contract is a function over REGISTRIES rather than a
  graph run, so it can be probed without this package growing a workflow
  engine. Five mutants, three of which shipped in production: bare-builtins
  (PHP/Python), config-only (TypeScript), always-inherit (the plausible
  over-correction, which discards a deliberately injected registry), a
  precedence inversion, and the correct implementation as a control.


## [0.7.0] - 2026-08-23

*For consumers: **nothing to do.*** A new suite adds cases, it does not change
existing ones, and no shipped row was touched. `last-word/docx-constructs` is
opt-in — an engine picks it up when it wires a runner for it.

### Added

- **`suites/last-word/docx-constructs`** — 44 cases pinning which
  WordprocessingML constructs the LastWord document model can express, and the
  exact XML each one emits. Six extraction functions (`runProps`,
  `paragraphProps`, `tableProps`, `cellProps`, `sectionProps`, `readBack`,
  `roundTripFixpoint`) across three engines: PHP `particle-academy/last-word`,
  Node `@particle-academy/last-word`, Python `last-word`.

  It exists because the model was far narrower than the XML the writers already
  emitted. Font size, font family, small caps, letter spacing, per-cell
  shading, borders, padding, vertical alignment and both merge directions were
  produced from hardcoded blocks or from `styles.xml` and were **unreachable
  from the model**. An agent could emit `size`, `colSpan` or `shading`, the
  validator returned no errors, and all three engines silently dropped every
  one of them.

- **Goldens are ORDERED.** `CT_RPr`, `CT_PPr`, `CT_TcPr`, `CT_TblPr` and
  `CT_SectPr` are `xsd:sequence`, so child order is the schema's and not a
  preference. A normalisation to an unordered map would let two engines emit
  different XML and still pass, so the shape is an ordered array of
  `[localName, value]` pairs. Attribute order within an element is *not*
  pinned — attributes are unordered in XML — and three rows (`0006`, `0014`,
  `0031`) exist only to fix an insertion point.

- **A control for the acceptance row.** `0044` asserts `roundTripFixpoint`
  returns `false` for a document that genuinely is not one. Without it, an
  implementation that returns a hardcoded `true` passes `0043` and the suite
  reports success over nothing.

### Notes

- **Three live divergences between the engines are recorded in this suite's
  goldens rather than in prose**, because the change that adds the rows is the
  change that reconciles them:

  | | was | now |
  |---|---|---|
  | table properties | Node referenced `<w:tblStyle w:val="LastWordTable"/>`; PHP and Python inlined `<w:tblBorders>` | inline in all three — a named style cannot vary per table instance, so per-table borders forced it |
  | header cell fill | `E7E7E7` in PHP and Python, `F2F2F2` in Node | `E7E7E7` — the majority |
  | header cell bold | `<w:b/>` on the runs in PHP and Python; a `<w:tblStylePr w:type="firstRow">` in Node | `<w:b/>` in all three, so the same file no longer reads back to two different models |

- **`0042` pins a loss rather than a guarantee.** A `header: true` row is not a
  round-trip fixpoint: the writer bolds the row's runs and the reader honestly
  reports the bold it finds, so the model that comes out is not the model that
  went in. The alternatives were to stop bolding header rows (changing every
  existing consumer's output) or to have the reader strip bold from header rows
  (discarding bold an author really did ask for). Written down so it is a
  documented property instead of a surprise.

- **This is not the binary suite `.ai/plans/polyglot/parity/documents.md` §5.4
  plans.** That one is `caseFormat: "directory"` with a per-engine runner CLI
  and a two-tier zip comparison — and **all four loaders currently reject
  anything that is not `caseFormat: "table"`**, so `directory` is declared in
  the JSON Schema and implemented nowhere. This suite asserts the model→XML
  mapping through the existing loaders today; it is a step toward §5.4, not a
  competitor to it, and the round-trip, markdown and reader-tolerance vectors
  §5.4 lists are still open.

## [0.6.0] - 2026-08-23

*For consumers: **nothing to do.*** A new suite adds cases, it does not change
existing ones, and no shipped row was touched. Adopting `flow/graph-runs` is
opt-in — a runtime picks it up when it wires a runner for it. The two corrected
goldens belong to the new suite and were never published.

**Worth knowing if you pin:** raise your pin to see `flow/graph-runs` at all.
`fancy-flow-php` currently resolves fixture set **0.4.0** from its installed
vendor copy — two minors back, asserting an older table than its log implies,
which is precisely what rule 4 of `runners/README.md` exists to make visible.

### Added

- **A Rust loader** (`rust/`), the fourth, same API shape as the Node, PHP and
  Python ones. Added with `fancy-flow-rs`, for the same reason the Python one
  was: a private copy in the repo under test would have been the fifth, in the
  repository that exists to stop exactly that.

  Its only dependency is first-party `fancy-json`, which has none of its own —
  so a Rust consumer runs the tables without a third-party approval
  conversation. It follows PHP and Python on the float epsilon rather than
  inventing a third comparison; that makes the loaders' known divergence 3-1
  instead of 2-2, which is not a fix and is recorded in `AGENTS.md` as such.

- **`flow/graph-runs` (23 cases)** — whole-graph execution. The same
  `WorkflowSchema` document in, the same `RunResult.outputs` out: Kahn
  topological order, the three port-activation conventions, branch routing,
  dead-edge handling at merge points, cycle detection, and the closed failure of
  an unregistered kind.

  These rows are not new. They spent their whole life as **fancy-flow-php's
  private test fixtures**, which `fancy-flow-py` then duplicated byte for byte
  and held together with a provenance test. That port's own `SOURCE.md` said
  plainly that a copy is a defect and that promoting them here was the fix. A
  fourth runtime (`fancy-flow-rs`) is what made a third copy indefensible.

  **Consumers must state the run precisely**, because the manifest does: lenient
  import, a LOCAL kind registry with the structural kinds registered, and the
  built-in offline executors. A runner that populates the SHARED kind registry
  instead gets different declared output ports for `for_each` and disagrees on a
  case nobody changed.

### Fixed

- **Two `flow/graph-runs` goldens were corrected on promotion, and one of them
  had been hiding a live divergence.**

  Cases `0021` and `0022` previously asserted `errorContains` — a **substring**.
  They now assert the exact message. The substring is what hid it: PHP and
  TypeScript emit `Cycle detected in flow graph — aborting.` with an EM DASH,
  the Python port emits an ASCII hyphen, and `errorContains: "Cycle detected"`
  stops before the character they disagree on. Both reference implementations
  were re-run to capture the exact strings rather than transcribed.

  Case `0014` recorded PHP's *encoding* of an empty header map (`[]`) rather
  than its value, because PHP cannot distinguish an empty array from an empty
  map. The golden is now `{}`. PHP still satisfies it — its loader decodes JSON
  to assoc arrays, where the two are the same value — and the Python port's
  normaliser for this one case can go.

- **The Python loader had no CI job at all.** `AGENTS.md` said "all four are
  required CI jobs"; `ci.yml` had `node`, `php` and `cross-language`. The Python
  loader and its 27 tests ran nowhere, so the sentence was the only thing
  asserting them — in the repository whose entire argument is that such a claim
  must be a test result. `python` and `rust` jobs added, and `cross-language`
  now waits on all four.

- **This package's own version was written in four places and only two were
  compared.** `VERSION` and `package.json` agreed at 0.5.0;
  `python/pyproject.toml` sat at 0.4.0 and the Python loader's `__version__` at
  0.3.0. So a Python consumer honouring rule 4 of `runners/README.md` — print
  the pinned suite version, so an old fixture set is visible rather than
  inferred — was printing a number no other file agreed with.

  In the repository whose entire product is the claim that unchecked duplicates
  drift. All four now agree and all four are asserted; adding a fifth means
  adding it to that assertion, which is the point.

## [0.5.0] - 2026-08-19

### Added

- **`shared/trading-pnl`** — 11 rows covering position, cost basis and P&L
  across asset classes, including inverse contracts.

  Every value in the fixture is a decimal **string**, not a JSON number. A JSON
  number is parsed through a double, so a fixture written to check money
  arithmetic could disagree with itself between runtimes — which is precisely
  the class of bug this suite exists to catch.

  Consumers pin the suite version deliberately, so this release moves the pin in
  every port that carries one. Each was re-run before its pin moved.


## [0.4.0] - 2026-08-19

### Added

- **`shared/flow-run-identity` (25 cases)** — the identity a fancy-flow node
  derives an idempotency key from, and whether a retry may still reuse it.
  Asserted by all three fancy-flow runtimes (TypeScript, PHP, Python).

  Two pure functions. `stepKey(runKey, path, nodeId, occurrence)` composes the
  key; `isReplaySafe(attempt, firstAttemptAt, now, windowSeconds)` says whether
  the provider still remembers the first attempt.

  The rows that carry the weight:

  - **0011 + 0012** are a pair, and only mean something read together: the same
    step on attempt 1 and attempt 5 produces the **same** key. An implementation
    that folds `attempt` into the key passes every other case in the table and
    creates a second charge on the first timeout in production.
  - **0006 + 0007** are the other pair: a node named `a/b` at the top level and
    a node `b` inside an invocation of `a` must not collide. Unescaped they
    spell the same string, so two unrelated writes share an idempotency key and
    the provider deduplicates them into one.
  - **0009** pins that `%` is escaped *first*. Escaping `/` before `%` turns a
    literal `a%2Fb` back into the escaped form of `a/b` — the collision,
    reintroduced by its own fix.
  - **0013 / 0018** are the human-gate rows: attempt 1 is replay-safe however
    long the run was parked, because nothing was sent for the provider to
    forget. Without them an implementation "helpfully" refuses the first write
    of every long-running approval workflow.
  - **0017** is Stripe's 24-hour window, stated as a test rather than as a
    comment.

  *No consumer action:* a new suite adds cases, it does not change existing
  ones.

- **`shared/feature-entitlement` (26 cases)** — the five decisions a gating
  engine makes about a metered feature: is the subject entitled, how far may
  usage go, does this request fit, how much of it is billable overage, and may
  they take it. Asserted by `laravel-fms`,
  `@particle-academy/fancy-features` and `fancy-features-py`.

  It pins two rulings recorded in
  `.ai/plans/fancy-commerce-gating-rulings.md`:

  - **`canAccess` is entitlement only.** `entitled` receives
    `includedQuantity` and `used` and must **ignore** them. That is the
    assertion, not a redundant signature: a runtime that reintroduces the
    quota check fails `0002` and `0004` and nothing else. Both twins used to
    answer the question one way for a registry feature and the other way for a
    catalog-sourced one.
  - **`overage_limit` is a ceiling on billable overage**, stored by three
    runtimes and read by none until now. `0006` pins that `null` means *no*
    overage — every existing database row is null, and reading it as
    "unbounded" would turn each of them into an unlimited spending authority.
    `0018` is the row a naive `max(0, after - included)` gets wrong: it
    re-bills overage already recorded.

  Money is deliberately absent. It enters only when a host multiplies recorded
  overage units by a unit amount, which is `lineTotal` in
  `shared/money-minor-units` — referenced from the manifest rather than
  duplicated, because a golden that exists twice can disagree with itself.

  *No consumer action:* a new suite adds cases, it does not change existing
  ones.

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
