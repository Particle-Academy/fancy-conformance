# Using fancy-conformance — guide for agents

How an agent installs and uses this package in a consumer repo. What the package
is, is in [README.md](./README.md). Notes for working ON this repo's code are in
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Install

Always as a DEV dependency: it is test data plus loaders, never runtime code.

```bash
npm install --save-dev @particle-academy/fancy-conformance
composer require --dev particle-academy/fancy-conformance
```

- **Node:** `>=22`. **PHP:** `^8.4`.
- **Python:** `pip install fancy-conformance` (from 0.55.1; import
  `fancy_conformance`, `>=3.11`). The wheel carries the fixtures, so
  `suites_root()` finds them inside the installed package. Checking this
  repository out at a pinned tag and putting `python/src` on the path still
  works.
- **Any other language:** every release attaches
  `fancy-conformance-<version>.tar.gz` with just the fixtures.

## Find it on the Fancy MCP server

The catalog server is `https://ui.particle.academy/mcp` (streamable HTTP, no API
key; MCP id `fancy-ui`). This package is one registry entry, slug
`fancy-conformance`. Find it with `search-backend-packages` (it is not a UI
component), and get the install commands with `install-instructions`.

## API essentials

The same API shape in every loader:

| | Node | PHP (`ParticleAcademy\Conformance\Conformance`) | Python (`fancy_conformance`) |
|---|---|---|---|
| Run an implementation over a suite | `runTable(id, impl, { language })` | `Conformance::runTable($id, $impl, $language)` | `run_table(...)` |
| Print the summary | `formatSummary(summary)` | `Conformance::formatSummary($summary)` | `format_summary(summary)` |
| Load rows | `loadSuite(id)` / `loadSuiteFrom(root, id)` | `Conformance::cases($suite, $root)` | `cases(suite, root=...)` |
| Fixture-set version | `suiteVersion()` | `Conformance::version()` | `version()` |
| Resolve a file reference | `fixtureBytes(suite, ref)` | `Conformance::fixtureBytes(...)` | `fixture_bytes(...)` |

`impl` receives a case and returns the value compared with `expected`. Throwing
counts as a failure, not a crash. Worked examples are in the README's "Using
it"; the subprocess CLI contract for suites that emit documents is in
[`runners/README.md`](./runners/README.md).

## Traps

- **The four rules for a consuming repo** (README): run the suite on every push
  and PR; a missing toolchain is a FAILURE, not a skip; print the summary every
  time, skips included; print and assert the pinned suite version.
- **`skip` is a map keyed by language, with a non-empty reason**:
  `{"php": "no PHP impl"}` skips PHP only. An empty reason is a load error.
- **Never renumber a case id.** Ids appear in other repos' skip lists and
  changelogs.
- **Floats compare exactly.** A row that genuinely needs tolerance declares
  `"tolerance"` on the row; there is no global epsilon. Numbers compare by value,
  not JSON type, so an integer golden is satisfied by an equal float.
- **Do not write your own loader.** Four consumers did and their copies diverged
  (two read `skip` as a scalar). Use the shipped one.
- A new case lands here first, red, then in each implementation.
