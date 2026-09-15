# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Pre-1.0, breaking changes land in MINOR releases.** The version number is not
promising otherwise until 1.0.

## [Unreleased]

## [0.26.0] - 2026-09-15

**A new suite, `shared/subscription-lease`, and Rust joins `flow/durable-dispatch`.
No existing case or golden changed.**

### Added

- **`shared/subscription-lease`: a subscription that EXPIRES, and when the host
  must act on it.** 13 rows over `renewAt`, `state` (active / due / expired) and
  `action` (none / renew / resync), plus the three refusals: an epoch where an
  RFC 3339 instant belongs, a margin that is not positive, and no renew
  operation.
  - **Boundaries:** `due` is inclusive at renewAt; `expired` is inclusive at
    expiresAt and wins over `due`.
  - **A missed lease is `resync`, never a quiet re-create.**

  Authored by the connector lab (weaver) in fancy-connector-core v0.7.0 and
  landed as written. The rows, contract and notes are unchanged; only the split
  into manifest + cases and a per-row `since` were added. Implementations are
  fancy-connector-core's Node and PHP runtimes. Core reads the suite from here
  once it pins this release, and deletes its local copy.
- **A discrimination probe for it**
  (`tests/discrimination-subscription-lease.test.ts`). The control passes all 13
  rows, and eight mutants each fail an exact set:
  - an exclusive `due` (0002);
  - an exclusive `expired` (0004);
  - `due` winning over `expired` (0004, 0007);
  - renewing a missed lease (0004, 0007);
  - guessing an epoch (0010);
  - allowing a zero margin (0011);
  - dropping the offset (0008);
  - truncating fractions (0009).
- **`flow/durable-dispatch` lists Rust.** fancy-flow-rs now has a durable,
  per-node coordinator, serial by default, and passes all 14 rows.

### Changed

- **The manifest schema accepts what an existing suite already uses:**
  `reference: "authored"` (goldens decided by the suite's author, as
  `flow/connector-runs` and now `shared/subscription-lease` declare) and an
  `engine` field on an implementation.

## [0.25.0] - 2026-09-14

**A new suite, `flow/durable-dispatch`. No existing case or golden changed.**
fancy-flow-php passes it from 0.54.0. `@particle-academy/fancy-flow` and
`fancy-flow` (Python) implement it next; fancy-flow-rs has no durable coordinator
and is not listed.

### Added

- **`flow/durable-dispatch`: a queued run hands out one node at a time unless the
  host asks for more** (fancy-flow-php#17, the owner's ruling). 14 rows simulate a
  per-node run with each runtime's OWN frontier and dispatch selection, FIFO
  workers settling one node at a time, and no engine or queue:
  - **Serial is the default** (`maxConcurrent` 1). A node is dispatched only after
    the node before it settles, in DECLARATION order among what is ready now.
    0007 pins that this is not breadth-first; 0004 that edge-list order is ignored.
  - **A paused gate keeps its slot** (0008, and 0010 under a cap), so nothing
    queues alongside a person who is still deciding.
  - **A cap is measured against work already held**, not the size of one batch
    (0014).
  - **`maxConcurrent` 0 is the whole ready frontier** (0002, 0006, 0009): the
    opt-in to parallel.
  - Skips and notes never take a slot (0011, 0012).

  The goldens are an ordered TRACE (`dispatch`/`complete`/`pause`/`skip`), not a
  list of dispatch batches. Produced by fancy-flow-php 0.54.0's `Frontier` and
  `DispatchLimit`, reviewed row by row.
- **A discrimination probe for it** (`tests/discrimination-durable-dispatch.test.ts`):
  the control passes every row, and four mutants each fail an exact set. Writing
  the probe is what changed the golden shape: a batch list let both a
  paused-node-not-held and a per-batch cap dispatcher through, because it cannot
  see WHEN a node was dispatched.

## [0.24.0] - 2026-09-14

**A new suite, `flow/run-diagnostics`. No existing case or golden changed.** Only
fancy-flow-php passes it today. `@particle-academy/fancy-flow`, `fancy-flow`
(Python) and fancy-flow-rs emit neither warning, and pass only the eight silent
rows until they implement it (fancy-flow#17).

### Added

- **`flow/run-diagnostics`: a graph that runs and delivers nothing must say so.**
  14 rows over the two run-time warnings fancy-flow-php emits and the other three
  runtimes do not:
  - **Undelivered edge:** an edge whose `sourceHandle` names a port its source
    COMPLETED without publishing, and could never publish. The warning goes
    against the target node.
  - **Route on an unresolved path:** a `branch` condition or `switch_case` value
    that is one whole `{{ path }}` which did not resolve, so the run took
    `false` or `default` because a value was absent.

  The contract returns every `warn` log event as `{ nodeId, message, detail }`
  sorted by message, so exact wording and structured detail are both pinned.
  Goldens are from fancy-flow-php 0.52.2, reviewed row by row.
  - Six rows warn: 0001 and 0006 (routing), 0008, 0010, 0012 and 0013
    (undelivered).
    - 0010 is the flabs smart-routing graph with an inverted `cases` map. It is
      the graph that exposed the gap: PHP warned, and the other three passed it
      silently.
    - 0012 pins the near-miss note for a handle that is a declared output FIELD.
  - Eight rows are silent on purpose: a false condition, a null value, mixed
    text, adjacent references, an unmatched switch value, the untaken branch
    port, a port that exists only through the node's own `cases`, and an edge
    out of a node that never ran. Each is a way to warn on ordinary branching,
    which is how a real warning stops being read.

## [0.23.0] - 2026-09-14

**Six rows added to `shared/expr`. A runtime without the fancy-flow-php#16 fix
fails five of them**, so moving a pin to this version means taking that fix in
the same change. No existing case or golden changed.

### Added

- **`shared/expr` 0021-0026: a whole-string expression is EXACTLY one `{{ }}`.**
  Every fancy-flow runtime decided a template was a single expression by asking
  whether the trimmed string starts with `{{` and ends with `}}`. So
  `{{ in.text }} --- {{ user.transcript }}` became one path,
  `in.text }} --- {{ user.transcript`, which never resolves: the template returned
  null, and a document node wrote nothing with both references valid. All four
  runtimes documented it as a deliberate corner, and this table, which compares
  them with each other, read their agreement as parity. The rule now: the inner
  text may contain neither `}}` nor `{{`; anything else interpolates each
  reference. Goldens from fancy-flow-php 0.52.2 (0.52.1 returns null for all but
  0024).
  - `0021-several-references-interpolate-each`: the reported template.
  - `0022-several-references-across-newlines`: the production shape, with a
    trailing newline that must survive.
  - `0023-adjacent-references-are-two-references`: `{{ a }}{{ b }}` is `"12"`.
  - `0024-padded-single-expression-keeps-type`: ` {{ a }} ` is still the number 1.
  - `0025-one-unresolved-reference-of-several-interpolates-empty`: the policy
    applies per reference.
  - `0026-an-inner-opening-brace-is-not-one-expression`: the rule's second
    condition, which no other row reaches.

  The table models only the default unresolved-path policy. Its contract takes no
  policy argument and fancy-flow-rs has none; Keep and Throw are pinned in each
  runtime's own suite.

  **What to do:** a runner of `shared/expr` moves its pin together with the
  engine fix (fancy-flow-php 0.52.2, fancy-flow 0.70.4, fancy-flow Python 0.20.2,
  fancy-flow-rs main). An engine without it fails 0021, 0022, 0023, 0025 and
  0026, and nothing else. A runner that counts rows expects 26.

- **`tests/discrimination-shared-expr.test.ts`**: the first probes for
  `shared/expr`. A faithful evaluator passes all 26 rows; the shipped corner fails
  exactly the five above; a port that checks only for an inner `}}` fails 0026
  alone; one that drops the typed branch fails 0001, 0007 and 0024. Against the
  0.22.1 table the three mutants caught nothing.

### Changed

- **`shared/expr` manifest lists the Python and Rust implementations**, which
  already ran this table while the manifest named only PHP and Node, and records
  the whole-expression rule and the one-policy limit.

### Removed

- **The PyPI publish jobs.** This repository is the suite's alignment tool, not
  a product; Python consumers check it out at the tag they pin. The job failed
  on every tag since it was added (2026-08-25) for want of a trusted publisher.
  **What to do:** nothing. `pip install fancy-conformance` never worked.

## [0.22.1] - 2026-09-13

No case or golden changed.

### Fixed

- **The Rust loader depends on `fancy-json` at tag `v0.1.1`, not `branch = "main"`.**
  A consumer pinning this repository by tag still got whatever fancy-json's `main`
  was, and could not pin fancy-json itself: two refs of one crate are two crates to
  Cargo, and their types do not unify. **What to do:** a Rust consumer that also
  depends on fancy-json moves that dependency to `tag = "v0.1.1"` together with
  this pin.

- **`dark-slide/table-cell-model` manifest no longer claims the loaders disagree on float
  comparison.** They have compared exactly since 0.10.0; the note was wrong when it was
  written. No case or golden changed.

### Added

- **`runners/README.md`: a consumer reading the fixtures from git checks out the
  tag it pins.** Unpinned `actions/checkout` steps turned four Python ports red
  on every fixture release, for weeks, for reasons none of their commits caused.
  Docs only. **What to do:** if your CI checks this repository out with no
  `ref`, set `ref: v<your pinned version>` on that step and add a test that the
  two agree; otherwise nothing.

## [0.22.0] - 2026-09-13

### Changed

- **BREAKING for `dark-slide/table-cell-model` runners: the goldens follow
  dark-slide 0.10's unit model.** Every authored length is now a design pixel on
  a canvas `theme.slideWidth` wide (1920 by default), resolving to
  `px * 720 / slideWidth` points. Before, a table's `fontSize` was halved and
  every other length taken as points.

  23 of the 26 existing goldens changed, and every change is one of two kinds:
  the default font size (28px is now 10.5pt, `fontSizeHundredths` 1400 → 1050),
  or a length the case states explicitly (a 1-wide border is now 0.375pt, 4763
  EMU instead of 12700). Inputs are untouched. Unstated defaults such as the
  7.2pt / 3.6pt insets stay points, so rows that never state a padding keep
  91440 / 45720.

  **What to do:** move the engine under test to dark-slide 0.10 (PHP), 0.8
  (Node) or 0.3 (Python) with this version. An engine still on the old model
  fails 23 named rows here and nothing else changes.

- **Case `0026` renamed** from `0026-font-size-is-halved-into-points` to
  `0026-font-size-is-a-design-pixel`, because the old id stated the rule this
  release removes. Its number is unchanged, and no repository referenced the old
  id in a skip list.

- **`flow/connector-runs` manifest: the schema-version split is recorded as
  closed.** Its "IMPORT IS STRICT HERE" note said `fancy-flow-php` ran a
  versionless graph that the TypeScript and Python twins refused. `lenient` no
  longer softens the version in any runtime (fancy-flow 0.70.0, fancy-flow-php
  0.52.0, fancy-flow Python 0.20.0). The note keeps the part that still holds:
  import strictly here, because `lenient` softens an unregistered connector
  kind. No case or golden changed. No case was added to pin the version
  refusal: `graph-runs` asserts exact errors and the three runtimes format an
  absent version differently (`undefined`, `NULL`, `None`), and its contract
  does not yet say how a refused import surfaces. Each runtime pins the rule in
  its own suite.

### Added

- **`0027-slide-width-1440-reproduces-the-old-halving`**: `theme.slideWidth: 1440`
  lands every length where dark-slide 0.9 put it, the documented upgrade path.
- **`0028-authored-lengths-convert-defaults-stay-points`**: a stated padding and
  border width convert; the unstated insets stay PowerPoint's points.
- **`scripts/build-table-cell-model-goldens.py`** regenerates the goldens by
  running the PHP reference (`scripts/table-cell-model-reference.php`). Without
  `--write` it is a drift check. Before rewriting anything it was run against the
  previous reference (dark-slide 0.9.2): it reproduced all 26 goldens exactly, so
  the projection matches how they were first made. Python writes the file because
  PHP's `json_decode` turns `{}` into `[]`.

## [0.21.2] - 2026-09-13

### Fixed

- **The connector-runs run identity is now a pinned CONSTANT: `labd5f9ddb2`.**
  0.21.1 defined four canonical-JSON rules, and two faithful implementations of
  those four still disagreed — `labe4b755a3` in Node, `labd5f9ddb2` in PHP. The
  graph contains `config: {}`; a JavaScript parse keeps it an object, and PHP's
  `json_decode(..., true)` — which this package's own PHP loader uses — turns it
  into `[]`, with nothing left to recover the difference from. The definition
  never said what an empty object is.

  Found by the connector lab comparing its PHP and Node canonical forms byte for
  byte, and independently re-derived in Python while landing it: all three give
  `labe4b755a3` under the old rules and `labd5f9ddb2` under the new one.

  `value` is authoritative; `derivation` and `canonicalJson` stay as provenance
  so a runner can prove it agrees. A runner SHOULD derive the identity itself and
  refuse a run whose supplied value differs, rather than trust the literal.

- **Three rules added, and the other two the definition promised are now TESTS.**
  - An empty object and an empty array are one value: emit `[]`. It is the only
    spelling every runtime can reach given how the PHP loader decodes.
  - **Integers only** in the hashed input. Measured, not assumed: Python prints
    the float `1.0` as `1.0`, JavaScript as `1`, PHP as either depending on
    `JSON_PRESERVE_ZERO_FRACTION` — so no output format is native everywhere,
    while an integer is. ("Numbers as written" in 0.21.1 was unimplementable:
    no runtime can recover how a number was written after a parse.)
  - **Code point** key order, replacing UTF-16 code unit. PHP's bytewise UTF-8
    sort, Python and Rust all produce code point order natively; only
    JavaScript's default sort does not. They diverge when a supplementary-plane
    character sits beside one in U+E000–U+FFFF. **ASCII keys only**, so that
    divergence cannot be reached silently.

  `tests/connector-runs-identity.test.ts` recomputes the key from the case and
  requires it to equal the literal, pins the literal itself, proves the `{}`
  rule changes the result (without it the graph derives `labe4b755a3`), and
  enforces integers-only and ASCII keys. The case text said "enforced by a test"
  — this is that test, written in the same release rather than promised.
  Verified by mutation: a fractional number, a non-ASCII key and a changed graph
  fail four of the five, and restoring the case passes all five.

## [0.21.1] - 2026-09-13

### Fixed

- **`flow/connector-runs` specified "canonical JSON" without defining it.** The
  run identity is derived as `"lab" + sha256(<json of the schema>)[0:8]`, and
  every runner must derive the SAME identity — the connector keys its
  idempotency on it and the faker seeds its id from that key, so a different
  identity produces a different `out.data.id` and fails the determinism check
  for a reason that has nothing to do with the connector.

  The authoring lab specified `sha256(json)`. 0.21.0 recorded it as
  `sha256(canonical json)` — a change made while landing the case and NOT
  flagged to the lab, which caught it by asking. "Canonical" was the right
  instinct, since `json_encode` differs across these runtimes, but an undefined
  word is worse than either concrete choice: every runtime believes its own
  encoder is canonical. PHP escapes `/` and every non-ASCII character by
  default; Node escapes neither.

  `input.runIdentity.canonicalJson` now defines it: keys sorted by UTF-16 code
  unit at every depth, array order preserved, separators exactly `,` and `:`,
  UTF-8 with only the escapes JSON requires (PHP must pass
  `JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE`), numbers as written.
  Defined in ONE place — the manifest note points at it rather than restating
  it.

  The resulting key is not yet pinned as a literal and should be: for a fixed
  fixture graph the identity is a constant, and a constant cannot be disagreed
  about the way a derivation can. It lands once the first runner implements this
  form and reports the value.

## [0.21.0] - 2026-09-12

### Added

- **`flow/connector-runs` — a connector node inside a running graph.** One case
  so far, `0001-stripe-customer-fake`: `manual_trigger → stripe_customer (fake)
  → output`, asserting the fields the faker AUTHORED and the fields the node's
  own CONFIG supplied.

  Authored by the connector lab and landed here rather than held privately, so
  the lab and this suite cannot end up holding two goldens that disagree — which
  is the whole property this repository sells.

  **It is a separate suite from `flow/graph-runs` on purpose.** That contract
  specifies a lenient import, a LOCAL registry of built-in and structural kinds,
  and the built-in offline executors. A connector kind is none of those, so a
  connector case dropped in there would be red against a contract that excludes
  it — permanently, which is not what "lands here first, red" means. This
  suite's `contract.implementations` names the packages a runner must carry.

  `created: 1767225600` is a literal in the provider's faker fixture, not a
  captured value: an engine fabricating plausible customer data cannot produce
  it, and a faker that drifts stops producing it. `out.data.id` cannot be
  authored, so it is pinned by shape (`^cus_fake_[0-9a-f]{12}$`) and by
  determinism. The `_fake_` infix is deliberate — a faked id indistinguishable
  from a real one is the reassuring reading.

  **The Python row is SKIPPED WITH A REASON rather than removed.** `fancy-stripe`
  ships no `flow` module yet, so the `fancy_flow.nodes` entry point finds nothing
  to register. A removed row would say the language is not part of the contract;
  a skipped one says it is and has not arrived.

- **Discrimination probes for it**, in `tests/discrimination-connector-runs.test.ts`
  — a faithful control plus five mutants, each asserting the EXACT set of paths
  it breaks: a plausible id with no `_fake_` infix, a freshly generated
  `created`, an executor that ignores its config, a skipped node, and a
  stringified number.

  **The third one found a hole in the golden before it landed.** The case
  originally asserted `email` alone, and the graph's email coincides with the
  faker fixture's own default — so a connector that never read the graph would
  have passed. `name` has no default, so it discriminates and is now asserted
  too. That is the argument for writing probes rather than recording that you
  should: this table would have shipped green and hollow.

  `flow/graph-runs` still has none, and that remains a stated gap rather than an
  oversight — the implementation under test there is an entire workflow engine.

### Changed

- **This suite asserts NAMED PATHS, not the whole outputs object**, which is
  weaker than `graph-runs` in one specific way: an extra key a runtime publishes
  will not fail a case. The manifest says so, because `out.data.id` is drawn
  from a seeded sequence and a whole-object equality would have to pin a value
  nobody wrote down. Read its green as "every named field agrees".

## [0.20.0] - 2026-08-26

### Changed

- **`manual_trigger` and `schedule_trigger` now declare `input-map-merged`, not
  `input` / `inputs-merged`.** They merge the raw input MAP; `merge` unions each
  port's PAYLOAD. Those coincide **only at an entry point**, because
  `collectInputs` seeds an entry node FLAT and keys every other node by handle.

  Give a `schedule_trigger` an inbound edge — a subflow where the trigger is
  also a target — and it emits `{cron, timezone, in: {...}}`. One keyword
  covering both over-permitted `{{ in.<upstream field> }}` when the real path is
  `{{ in.in.<field> }}`.

  **Two names because they are two operations**, rather than one name plus a
  positional rule the reader has to know. Named by the reference consumer, who
  found the boundary by reading `$ctx->inputs`'s two shapes rather than the
  relation's description.

## [0.19.0] - 2026-08-26

### Added

- **`flow/kind-declaration-surface` — parity of SURFACE, not behaviour.** 20
  cases asserting that every runtime's `NodeKind` declares the same things about
  the same kinds: the SET of field paths in `outputShape`, and the `emits`
  relation.

  **Every other suite here pins behaviour. Nothing pinned surface**, and four
  capabilities were found present in one runtime and absent in the others as a
  result — `graph.inputs` dropped on import, `sideEffects` declared by nothing,
  the Python loader never published, and `outputShape` existing only in
  TypeScript. In each, **absent reads as a legitimate answer**, so nothing
  reported the gap.

  Three design rules, each from a real near-miss:

  - **Assert the SHAPE of each field, not its presence.** `OutputField[] | ((config) => OutputField[])`
    in one runtime and a plain `array` in another passes a presence check and
    fails every real use. A presence-only fixture would have been the fifth
    instance, written by the people fixing the first four.
  - **Compare field paths as a SET.** Rust's `for_each` inserts `count` before
    `items`; the values are maps, so order carries no meaning and asserting on
    it would report a divergence that is not one.
  - **TypeScript is the SPECIFICATION, not a peer.** It ships no executors, so
    its declarations are the only ones that cannot be checked against code. A
    disagreement is an implementation contradicting the spec — and the
    implementation is the one with an executor to be wrong about.

  `wait` and `schedule_trigger` are the rows that carry the hard-won rule: a
  relation with no destination can only express a TOP-LEVEL merge, so a kind
  that NESTS its input declares fields and no relation.

## [0.18.0] - 2026-08-26

### Added

- **Discrimination probes for `expr/evaluate` and `expr/references`** —
  `tests/discrimination-expr.test.ts`. The `expr/evaluate` manifest had said
  since 0.14.0 that this suite "needs DISCRIMINATION PROBES before it can claim
  more than drift-guarding", and named three. They are written: six mutants over
  `evaluate`, three over `references`, each asserting the **exact** set of ids it
  breaks, plus a faithful control and a guard that no two mutants fail the same
  rows.

  It matters more here than elsewhere. `fancy-expr` exists *because*
  `symfony/expression-language`, `expr-eval` and `simpleeval` disagree on these
  semantics — a table all three would pass is evidence of nothing.

- **`expr/evaluate/1101` — the loose spelling does not coerce either.**

### Fixed

- **The suite could not catch a coercing `==`, while the manifest said it
  could.** That claim — "one that coerces on `==` (must fail 0503)" — was false:
  `0503` pins no-coercion using the **strict** spelling (`'3' === in.count`) and
  `0502` compares two values equal either way. So an implementation whose `==`
  coerced — **PHP's and JavaScript's native behaviour, and the likeliest port
  mistake there is** — passed *every row in the suite*.

  Prose beside a check, asserting what the check could not express. Found by
  writing the probes the same manifest asked for, which is the only reason it
  surfaced: the mutant failed nothing, and a mutant that fails nothing is a
  table that is not looking.

  `1101` is the row that makes the claim true. `0502` and `1101` are not
  duplicates: the first asks whether the loose spelling is *accepted*, the
  second whether it *coerces*, and a table with only the first reads as covering
  equality while covering half of it.

  The manifest's other two predictions were merely **incomplete** rather than
  wrong — boolean `&&`/`||` also breaks `0402` and `1002`, and short-circuiting
  `references` also breaks `0104`. Both are now pinned as exact id sets.

- **`py.typed` was missing**, while `python/pyproject.toml` declared
  `Typing :: Typed`. A consumer running mypy against the installed package got
  `cannot be type checked due to missing py.typed marker` and **no type
  information at all** — metadata claiming what the wheel did not carry.

  Six of the kit's eight Python packages ship the marker. The two that did not
  are this repo and `fancy-expr` — the only two where Python lives in `python/`
  rather than at the repository root. It passes locally because
  `mypy_path = src` checks the SOURCE; only a check against the INSTALLED
  package asks the question a consumer asks.

- **The Python loader has a PyPI publish job. It never had one.** The workflow
  was called *"Publish to npm"* — accurate, and exactly the problem.

  This loader was promoted into this repo because FOUR consumers had each
  hand-rolled it and two of their copies read `skip` as a scalar, silently
  skipping every language. It has 29 tests and a required CI job. It has never
  been installable: `pip install fancy-conformance` 404s, and every Python
  consumer in the kit has to install it from a path.

  So the fix for "four consumers wrote their own" shipped to none of them, and
  nothing reported it — the npm and Packagist halves published fine, and a green
  release is a green release.

  It was found when `ship-it`'s preflight was taught that **a repo can publish
  to more than one registry**. Before that it returned on the first manifest it
  found and called this repo `ALREADY SHIPPED` having checked npm alone — a
  verdict reading as full coverage while covering one registry of three, from
  the tool written to prevent that.

  **The PyPI name still needs the owner**: a pending publisher must be
  configured before the first tag can claim it. Nothing publishes to PyPI until
  that exists, so the job is armed rather than live.

## [0.17.0] - 2026-08-25

### Added

- **`expr/references` — a new suite: what an expression READS.** Twelve rows
  pinning `references(expression) -> string[]`, the root identifiers an
  expression needs, unique and sorted, answered with no data and no evaluation.

  It exists because of a field report. `{{ $now }}` renders as nothing: a
  `$`-prefixed root reads to an author as *engine-provided*, so agents reach for
  `$now` / `$today` / `$index` the way they reach for the two that exist, and a
  real document shipped titled `"Deal List Export -"` with the date silently
  missing. The reporter's own observation is the one that mattered — **an
  unknown `$` root is detectable at PARSE time in a way `in.genuinely_absent`
  is not.**

  The check deliberately does **not** live in `fancy-expr`. It cannot know
  whether `$now` exists; `$json`, `$input` and `$props` are real in one host and
  meaningless in another. So the package answers the only question it can answer
  honestly and the host compares that list against what it provides. The same
  primitive also catches the second reported shape — `{{ n2.transcript }}`, a
  real node id two hops upstream that resolves to nothing because a node id only
  addresses a *direct* predecessor.

  `0106` and `0108` are the rows that matter most: object-literal KEYS are not
  references (collecting them makes a host reject a valid expression, and a
  false rejection at save time is the worse direction — the author cannot
  comply), and BOTH branches of a ternary are read (an implementation reusing
  the evaluator's short-circuit would approve an expression that fails on the
  other road).

  The manifest also records what it **cannot** catch: `{{ in.output }}`, a real
  root with a field that node never emits. Nothing static separates that from a
  field absent this run.

- **`expr/evaluate` 1001-1003 — the field report itself, as rows.** `1001` is a
  consumer's production expression *verbatim*: an object literal with three
  `||` fallback chains, a ternary and four keys, every operand a path that may
  legitimately be absent. Under the old dot-path-only resolver the whole thing
  evaluated to `null` and the run reported success.

  Their description is why it is in the table rather than paraphrased: it is
  "what an agent writes when it is trying to normalise two trigger shapes into
  one, which is the single most common thing they attempt." Every other row here
  isolates one rule; this one is the rules COMPOSED, which is how they arrive.

  `1003` is extracted from it deliberately — the composed row would still pass
  if the `|| ''` tail broke, because its `transcript` key never reaches the
  final fallback.

### Fixed

- **`VERSION`, `python/…/__init__.py` and `rust/Cargo.toml` are back in step.**
  The repo's own `every manifest that carries this version agrees with VERSION`
  test caught two stale declarations during this bump — which is the guard doing
  exactly its job, in the repository that argues a claim must be a test result.

## [0.16.0] - 2026-08-25

### Changed

- **`expr/evaluate/0904` is now skipped for PHP, and `0906` pins the same rule in
  a form every runtime can express.** The table earned its keep on the first
  independent implementation, exactly as its manifest predicted.

  The PHP port — written against these published rows rather than against the
  TypeScript source — failed **1 of 44** on its first run: `0904`, that an object
  has no `.length`.

  It is **not a bug in the port.** `json_decode('{}', true)` and
  `json_decode('[]', true)` produce the *identical value* in PHP, and
  `array_is_list()` calls both a list. So an EMPTY object cannot be distinguished
  from an empty array, and the `.length` an empty array legitimately has is
  returned. A genuine cross-language expressiveness limit — the same one
  `shared/value-equality/0210` already records.

  Skipped there with that reason attached, and `0906` pins the identical rule
  using a **non-empty** object, which is unambiguous everywhere. Two rows, one
  rule, divergence documented rather than discovered — the same shape as
  `flow/workflow-props` `0106`/`0109`.

  This is the argument for writing the table first, in one paragraph: a port
  built against a specification found a real limit of its own language on day
  one, instead of quietly encoding it as behaviour for someone to trip over
  later.

## [0.15.0] - 2026-08-25

### Added

- **`.length` in `expr/evaluate` (rows `0901`–`0905`)** — the grammar's one
  pseudo-property, on arrays and strings.

  It is load-bearing rather than convenient. Because `[]` is **truthy**
  (row `0301`), a consumer without `.length` would have **no way to ask whether a
  collection is empty** — the grammar would assert that an array which exists is
  a value and then leave nobody able to test the thing they actually care about.

  A computed count, not host reach: nothing is called and no prototype walked.
  `0905` pins that nothing else on the chain resolves, and `0904` pins that
  objects deliberately have none, since no count would survive three languages.

  **These rows exist because writing the reference implementation's
  discrimination tests found the SPEC contradicting the CODE.** The truthiness
  rule was justified with `.length` while `.length` returned `null` — prose
  promising what the code did not do, in a package written the same hour. Exactly
  the failure this corpus argues against, caught by the practice it argues for.

## [0.14.0] - 2026-08-25

### Added

- **`expr/evaluate` — the fancy-expr grammar, written BEFORE any implementation
  of it exists.** 39 rows. Nothing satisfies them yet; each of the three ports
  will be built against published rows rather than against another port's source.

  Every previous flow suite was a post-mortem in fixture form — rows written once
  all the runtimes had already shipped the same bug. This one is a
  **specification**, which is the whole argument for owning the grammar: three
  real expression libraries (`symfony/expression-language`, `expr-eval`,
  `simpleeval`) exist and **disagree with each other**, so adopting them would
  ship three subtly different languages under one syntax with nobody able to fix
  the divergence.

  The rows that carry the weight are the ones three languages would otherwise
  drift on:

  - **Truthiness (`0301`–`0305`).** `[]` and `{}` are **TRUTHY**, against PHP's
    and Python's native instincts. The data arrived as JSON: an array that exists
    is a value, and asking whether it is *empty* is what `.length` is for.
  - **Equality (`0501`–`0503`).** `==` and `===` are the SAME operator and
    neither coerces.
  - **Short-circuit (`0401`–`0404`).** `&&` and `||` return the **operand**, not
    a boolean — which is what makes `in.transcript || in.content` a fallback
    rather than merely `true`.
  - **Malformed fails (`0801`–`0805`).** Never `null`, because a null there is
    indistinguishable from an absent path — the exact defect being removed. A
    function call does not parse: sandboxing is a security property, since these
    expressions arrive from end users and agents over the wire.

  Row `0406` is a consumer's production condition verbatim — the one that
  returned `null`, was read as `false` by `branch`, and routed a live graph the
  wrong way on every run while reporting success.

  Discrimination probes are NOT yet written, and the manifest says so, so the
  green tick is not read as the stronger claim.

### Removed

- The `flow/expression-classification` suite added earlier the same day, before
  it ever shipped. It classified an expression as `path` or `malformed`; the
  design then settled on malformed expressions **throwing**, which `expr/evaluate`
  pins directly. Two suites saying the same thing is the duplication this
  repository exists to argue against.

## [0.13.0] - 2026-08-25

### Added

- **`flow/entry-points` — which entry point fired, and therefore which nodes
  run.** 7 rows pinning a rule that does not exist in any runtime yet, so this
  suite is a **specification rather than a post-mortem**.

  The defect it fixes was measured in production, not imagined. A graph may hold
  more than one trigger — a `manual_trigger` for hand-testing beside the event
  trigger that runs it for real — and **every runtime executes every trigger's
  branch on every run**, because a trigger has no inbound edges and "no inbound
  edges" is exactly the readiness rule. Verified identical under both PHP queue
  drivers: `FlowRunner` walks a Kahn order and `Frontier::compute` restates the
  same rule for the per-node driver.

  The cost is downstream, not the triggers themselves. Two measured failures: an
  empty payload winning a race into a shared `transform`, and — with no
  workaround — a `user_input` on the manual branch executing during an
  **event**-triggered run, so the run parks asking a person to paste data the
  event already supplied. From outside, that looks like the event trigger being
  ignored.

  **The rule:** `entryNodes` marks which nodes WITH NO INCOMING EDGES are live.
  An unnamed entry point is inactive, and the existing "at least one active
  inbound edge" rule then skips everything reachable only from it. Nodes that
  have incoming edges are untouched. No new routing logic — both schedulers
  already have the seam at their `incoming === []` check.

  Rows worth reading before implementing: `0101` (unset must behave exactly as
  before — the compatibility guarantee), `0104` (a merge fed by both branches
  must still run, or the documented workaround for this very bug breaks),
  `0106` (empty is NOT unset), and `0107` (naming a non-entry node selects no
  entry and runs nothing — a consequence of the rule, pinned so nobody
  reinterprets it).

## [0.12.0] - 2026-08-25

### Added

- **`flow/executor-resolution` — which executor a node actually runs.** 14 rows
  pinning the `node id → kind → *` order, alias resolution in **both**
  directions (a bare binding reached by a namespaced node and the reverse), and
  failing **closed** when nothing matches.

  It exists because fancy-flow ≤ 0.51.1 could run the **wrong executor,
  silently**. Its alias step tried `data.kind`'s ids before `node.type`'s, so a
  node with `type: "llm_call"` and `data.kind: "output"` ran the OUTPUT
  executor — **even when an `llm_call` executor was registered** (row `0203`).
  Nothing reported it, because running the wrong executor and running the right
  one look identical from outside: the graph still completes.

  The rule the rows pin: **when `node.type` names a registered kind it is
  authoritative** and `data.kind` does not contribute; otherwise `data.kind`
  decides. Row `0205` is what stops that from over-reaching — a `type` naming no
  registered kind is an xyflow *renderer* type (`"fancyNode"`), which is
  ordinary practice, and there `data.kind` is the only real answer.

  **The eight `0100` rows run on all three runtimes.** The six `0200` rows are
  skipped for PHP and Python on a **structural** ground, stated on each row:
  their `FlowNode` is *flattened* — `type` IS the kind, there is no `data` slot
  for a second opinion to live in — so the precedence question cannot arise
  there. That asymmetry is why exactly one runtime had the bug, and it is
  recorded rather than hidden. Adding a `data.kind` field to two runtimes so
  they could answer rows about it would be writing code to satisfy a table,
  which is the inversion this package exists to prevent.

### Changed

- `VERSION` → `0.12.0`, and the four manifests that declare it. Additive: no
  existing suite, case id or golden changed, so a consumer already on 0.11.x
  needs to do **nothing** beyond bumping if they want the new suite.

## [0.11.1] - 2026-08-25

### Fixed

- **The version-drift check now ENUMERATES its copies instead of listing them.**
  Yesterday's fix added `rust/Cargo.toml` to a hand-maintained list. That is one
  more copy of the thing being guarded, with the same failure mode — the sixth
  loader would have gone missing exactly as the fifth did.

  The old comment read *"adding a fifth means adding it to this list, which is
  the point"*: the rule was written down, correctly, beside the code that failed
  to follow it. **Prose adjacent to a check is not the check.** The list is now
  discovered, with a vacuity guard so a broken discovery fails instead of
  passing over nothing. Verified red by reverting `Cargo.toml`.

  The generalisation came from an agent building a parity repo for another
  package family, reading our Cargo.toml miss.

### Added

- **A golden may not carry an integer JavaScript cannot represent.** The mirror
  of `shared/value-equality/0210`, pointing the other way.

  There, PHP could not distinguish `[]` from `{}` — a limit every PHP-authored
  golden would inherit if PHP were the reference. Here the weak language is
  **ours**: JS numbers are doubles, so `9007199254740993` parses as `...992`,
  and **JavaScript cannot detect its own error** — comparing the rounded value
  against the same literal is `true`, because both sides round identically.

  A golden holding a chain block height, a nanosecond timestamp or a snowflake
  id would therefore be wrong the moment it was authored, and every
  implementation that "passed" would have matched a corrupted expectation. The
  check reads the case files as TEXT, because parsing them would destroy the
  evidence using the very defect being looked for. Nothing shipped violates it
  today; verified red by planting one.

## [0.11.0] - 2026-08-25

### Added

- **`shared/value-equality` (32 cases) — the loaders' own comparison, held to a
  table.** This package held every implementation to a table **except itself**.
  Each loader's `equals` was asserted only by its own hand-written unit tests,
  against pairs its own author chose — precisely the setup this repository
  exists to argue against.

  It was not hypothetical. In 0.10.0 the Rust loader was found asserting that an
  integer golden is never satisfied by a float, with a **passing unit test**
  saying so, while `shared/decimal/0008-coerce-exponent` carries the integer
  golden `100000` that PHP's `"1e5" + 0` satisfies with a float. A rule the
  shipped corpus disproves, green for as long as nobody ran the two against each
  other. It surfaced only because an unrelated change happened to break it.

  The generalisation, which is the suite's reason to exist: **a loader can
  assert something the REFERENCE LANGUAGE cannot express, and no number of green
  ticks will surface it.**

  **It found a divergence on its first run.** `0210-array-is-not-an-object`:
  Node, Python and Rust all distinguish `[]` from `{}`; PHP cannot, because
  `json_decode('[]', true)` and `json_decode('{}', true)` produce the identical
  value. Skipped for PHP with that reason — a real expressiveness limit rather
  than a loader defect, and one a PHP-authored golden inherits.

  Cases `0201`-`0205` pin the absent-versus-null axis, raised by an agent
  building a parity repo whose reference is PHP: PHP has one absent value while
  TypeScript has `null` and `undefined` and Python has `None`, so a TS loader
  could assert a distinction no PHP-authored golden can encode and be wrong in
  exactly the Rust way. The four loaders agree today; now that agreement is a
  test result.

### Fixed

- **`rust/Cargo.toml` had drifted three releases behind, and the test written to
  catch that did not cover it.** It sat at `0.7.0` against a `VERSION` of
  `0.10.0`, so `cargo test` printed the wrong suite version on every run.

  The test's own comment reads *"Every copy is compared here now; adding a fifth
  means adding it to this list, which is the point."* The Rust loader **was**
  added, on 2026-08-23, and its manifest was not added to the list. All five
  copies now agree and the fifth is asserted; verified by reverting it and
  watching the suite go red.

  Third instance of this shape in the kit in one day. The mechanism is always
  identical: N copies of one number and a check covering N-1.

## [0.10.0] - 2026-08-25

### Changed

- **BREAKING: all four loaders now compare floats EXACTLY.** PHP, Python and
  Rust used a scaled `1e-12` epsilon while TypeScript used exact `Object.is` —
  a 3-1 split recorded in `AGENTS.md` for months with the note *"pick one and
  make the other three match"*. The three now match the one.

  **What a consumer must DO: probably nothing.** No shipped case turns on it —
  all 11 float goldens in the corpus parse to bit-identical doubles in every
  language, and `cross-check` confirms 35 cases with identical verdicts across
  two loaders. If one of YOUR cases passed only by epsilon, it will now fail,
  and that failure is the point: it means two runtimes computed different
  values. Add `"tolerance": <number>` to that case if the difference is genuine.

  **The epsilon lost because its justification was measurably false.** It was
  stated as "a golden written as `0.002` in JSON is a decimal literal, and the
  nearest double to it is not the nearest double to every language's parse of
  the same text". Measured: `0.002` — the literal the justification itself
  named — plus `0.1`, `1e300`, `DBL_MAX`, the `5e-324` denormal and
  `0.30000000000000004` all parse to **bit-identical doubles** in PHP, Python
  and Node. Decimal-to-double conversion is specified, not per-implementation.

  What it actually did was let two runtimes that computed DIFFERENT values pass
  as equal, in the package whose whole product is catching that. On a money row
  a relative `1e-12` is real money at scale.

  Prompted by two unrelated consumers naming round-trip-through-storage as
  their next divergence surface within the same hour — one of them persisting
  graphs between an unattended run and a human approval, in a codebase using
  `float` for money. Their point was that the first computed-float case to land
  would decide this implicitly, in whichever direction that case happened to
  run.

### Added

- **`tolerance` on a case.** Optional, relative, scaled by the larger
  magnitude. Declared ON THE ROW so a reader of the fixture can see whether it
  asserts a value or a neighbourhood — a global epsilon is invisible. Same
  principle as a skip having to state its reason. Added to the case schema,
  which sets `additionalProperties: false` and would otherwise have rejected it.

### Fixed

- **Numbers now compare by VALUE rather than by JSON type in every loader.**
  Rust rejected an integer golden satisfied by a float, and an earlier draft of
  this change added the same rule to PHP. Both were wrong, and two things
  caught it: `shared/decimal/0008-coerce-exponent` (an integer golden `100000`
  that PHP's `"1e5" + 0` satisfies with a float) and a Rust unit test asserting
  the opposite.

  The corpus wins. The reference language is JavaScript, which has ONE number
  type, so a golden can never encode "this must be a float" — a loader
  enforcing that distinction asserts something no golden is able to claim. The
  Rust test's VALUE assertions survive unchanged and are stronger for being
  exact; only its type assertion is gone.

## [0.9.1] - 2026-08-25

### Added

- **`0109`, the runnable half of `0106`.** `0106` asserts that a map supplied
  where an `array` is declared must fail — and it is **not representable in
  PHP**: `json_decode('{"0":"a"}', true)` coerces the numeric STRING key to int
  `0`, producing a list, so `array_is_list` correctly reports a list and the
  map the case describes cannot exist on that runtime.

  `0106` is now skipped for PHP with that reason and kept rather than
  rewritten, because the divergence is worth recording — a JS host and a PHP
  host genuinely disagree about this value, and neither implementation is
  wrong. `0109` uses a non-numeric key, which survives `json_decode` as a
  string-keyed array, so it pins object-is-not-array on all three runtimes.

  Found by the PHP port failing exactly one row of a table it was written
  against, which is the table doing its job on its first real use.

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
