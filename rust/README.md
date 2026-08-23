# fancy-conformance (Rust)

The Rust loader for the shared conformance fixtures. The **fourth**,
deliberately the same shape as the Node, PHP and Python ones so a reviewer
comparing four CI logs is comparing like with like.

```toml
[dev-dependencies]
fancy-conformance = { git = "https://github.com/Particle-Academy/fancy-conformance", branch = "main" }
```

```rust,no_run
use fancy_conformance::{format_summary, run_table, Language};

let summary = run_table("shared/expr", Language::Rust, None, |case| {
    match case.function() {
        Some("truthy") => Ok(fancy_json::Value::Bool(
            my_truthy(case.input().get("value").unwrap()),
        )),
        Some(other) => Err(format!("unimplemented fn {other}")),
        None => Err("case declares no fn".to_string()),
    }
})?;

println!("{}", format_summary(&summary));   // ALWAYS — see rule 3
assert!(summary.ok, "conformance failed");
# fn my_truthy(_: &fancy_json::Value) -> bool { true }
# Ok::<(), fancy_conformance::Error>(())
```

## The four rules

From [`../runners/README.md`](../runners/README.md). Each is traceable to a
suite in this org that reported green while covering nothing.

1. **Run on every push and PR.** Not nightly, not at release.
2. **A missing toolchain is a FAILURE, not a skip.** `suites_root()` returns
   `Err`, never `None`, so a suite that cannot run turns the job red.
3. **Print the summary unconditionally**, including every skip and its reason.
   `format_summary` does.
4. **Print and assert the pinned suite version.** `version()`.

## Why it lives here

Four Python packages each wrote their own copy of this loader, and **two had
already diverged** — reading a case's `skip` as a scalar rather than a map keyed
by language, so a row skipped for PHP silently skipped on Python too while the
log still read green. A fifth private copy, in Rust, would have been the same
mistake with different syntax.

## Dependencies

One: first-party [`fancy-json`](https://github.com/Particle-Academy/fancy-json-rs),
which has none of its own. A consuming repo runs the tables without a
third-party approval conversation.

## Where the fixtures come from

`suites_root()` resolves, in order: `FANCY_CONFORMANCE_ROOT`; a bounded walk up
to whatever directory holds `suites/`; a sibling `fancy-conformance` checkout,
directly or under `repos/`.

Never a fixed `../..`, and never a hard-coded sibling path — the two parity
harnesses this package replaced both did that, which is why they ran in exactly
one directory layout and silently no-opped everywhere else.
