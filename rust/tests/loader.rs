//! The Rust loader must behave identically to the Node, PHP and Python ones.
//!
//! Four loaders for one fixture format is itself a duplicated contract, so it
//! is held to the standard everything else here is held to: the same guards,
//! the same summary shape, asserted on every side.
//!
//! Every guard is reached through the REAL loader by handing it an explicit
//! root, never through a copy of the guard living in this file. An earlier
//! draft of the Node and PHP test files re-implemented the guard inside the
//! test, which would have asserted nothing — the exact bug this repository
//! exists to catch, nearly shipped inside it.

use std::fs;
use std::path::{Path, PathBuf};

use fancy_conformance::{
    cases, equals, format_summary, list_suites, manifest, run_table, suite_path, suites_root,
    version, Language,
};
use fancy_json::{parse, to_string, Value};

/// A throwaway fixture tree, so the load-time guards are tested through the
/// real loader rather than through a restatement of them.
struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("fancy-conformance-rs-{name}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        Self { root }
    }

    fn suite(&self, suite: &str, cases_json: &str) -> &Path {
        let directory = self.root.join("suites").join(suite);
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("manifest.json"),
            format!(r#"{{"suite":"{suite}","caseFormat":"table"}}"#),
        )
        .unwrap();
        fs::write(
            directory.join("cases.json"),
            format!(r#"{{"suite":"{suite}","cases":{cases_json}}}"#),
        )
        .unwrap();
        &self.root
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

// -- finding the fixtures ------------------------------------------------

#[test]
fn finds_the_suites_without_a_hard_coded_relative_path() {
    // The bug this replaces: both parity harnesses fancy-conformance retired
    // hard-coded `../../holy-sheet/src/`, so they ran in exactly one directory
    // layout and silently no-opped everywhere else — including in CI.
    let root = suites_root().expect("the fixtures must be findable");
    assert!(root.join("suites").is_dir());
    assert!(list_suites()
        .unwrap()
        .contains(&"shared/decimal".to_string()));
}

#[test]
fn reports_the_pinned_suite_version() {
    // Rule 4: "we're on an old fixture set" should be visible in the log
    // rather than inferred months later.
    let version = version().unwrap();
    let parts: Vec<&str> = version.split('.').collect();
    assert_eq!(parts.len(), 3, "not a semver: {version}");
    assert!(
        parts.iter().all(|p| p.parse::<u32>().is_ok()),
        "not a semver: {version}"
    );
}

#[test]
fn finds_a_suites_own_directory_and_manifest() {
    let path = suite_path("shared/expr", None).unwrap();
    assert!(path.join("cases.json").is_file());
    let meta = manifest("shared/expr", None).unwrap();
    assert_eq!(
        meta.get("suite").and_then(Value::as_str),
        Some("shared/expr")
    );
}

// -- the load-time guards ------------------------------------------------

#[test]
fn a_skip_without_a_reason_is_a_load_error_not_a_quiet_pass() {
    // This repository's entire thesis. If it is ever relaxed, the package is
    // decoration.
    let scratch = Scratch::new("empty-skip");
    let root = scratch.suite(
        "scratch/suite",
        r#"[{"id":"0001-a","title":"a","since":"0.1.0","input":{},"expected":1,
            "skip":{"rust":"   "}}]"#,
    );

    let error = cases("scratch/suite", Some(root)).expect_err("an empty reason must not load");
    let message = error.to_string();
    assert!(message.contains("skips rust with no reason"), "{message}");
}

#[test]
fn a_well_formed_skip_loads_and_keeps_its_reason() {
    // The negative of the test above. Without it, a loader that refused EVERY
    // skip would pass the guard test and quietly cover nothing.
    let scratch = Scratch::new("good-skip");
    let root = scratch.suite(
        "scratch/suite",
        r#"[{"id":"0001-a","title":"a","since":"0.1.0","input":{},"expected":1,
            "skip":{"go":"no decimal type yet"}}]"#,
    );

    let rows = cases("scratch/suite", Some(root)).unwrap();
    assert_eq!(
        rows[0].skip_reason(Language::Go),
        Some("no decimal type yet")
    );
    // And it is a MAP: a row skipped for Go is NOT skipped for Rust.
    assert_eq!(rows[0].skip_reason(Language::Rust), None);
}

#[test]
fn a_duplicate_case_id_is_a_load_error() {
    // Ids appear in other repos' skip lists and in changelogs.
    let scratch = Scratch::new("dup-id");
    let root = scratch.suite(
        "scratch/suite",
        r#"[{"id":"0001-a","title":"a","since":"0.1.0","input":{},"expected":1},
            {"id":"0001-a","title":"b","since":"0.1.0","input":{},"expected":2}]"#,
    );

    let error = cases("scratch/suite", Some(root)).expect_err("a duplicate id must not load");
    assert!(error.to_string().contains("duplicate case id"), "{error}");
}

#[test]
fn an_empty_case_table_is_a_load_error() {
    let scratch = Scratch::new("no-cases");
    let root = scratch.suite("scratch/suite", "[]");
    let error = cases("scratch/suite", Some(root)).expect_err("an empty table must not load");
    assert!(error.to_string().contains("has no cases"), "{error}");
}

// -- running a table -----------------------------------------------------

#[test]
fn counts_pass_fail_and_skip_separately() {
    let scratch = Scratch::new("counts");
    let root = scratch.suite(
        "scratch/suite",
        r#"[{"id":"0001-pass","title":"p","since":"0.1.0","input":{"v":1},"expected":1},
            {"id":"0002-fail","title":"f","since":"0.1.0","input":{"v":1},"expected":2},
            {"id":"0003-skip","title":"s","since":"0.1.0","input":{"v":1},"expected":3,
             "skip":{"rust":"not implemented yet"}}]"#,
    );

    let summary = run_table("scratch/suite", Language::Rust, Some(root), |case| {
        Ok(case.input().get("v").cloned().unwrap_or(Value::Null))
    })
    .unwrap();

    assert_eq!((summary.passed, summary.failed, summary.skipped), (1, 1, 1));
    assert!(!summary.ok);
}

#[test]
fn a_failing_implementation_is_a_failure_and_a_panicking_one_is_too() {
    // An implementation blowing up is DATA about the implementation, not a
    // reason for the harness to stop.
    let scratch = Scratch::new("throws");
    let root = scratch.suite(
        "scratch/suite",
        r#"[{"id":"0001-err","title":"e","since":"0.1.0","input":{"how":"err"},"expected":1},
            {"id":"0002-panic","title":"p","since":"0.1.0","input":{"how":"panic"},"expected":1}]"#,
    );

    let summary = run_table(
        "scratch/suite",
        Language::Rust,
        Some(root),
        |case| match case.input().get("how").and_then(Value::as_str) {
            Some("panic") => panic!("boom"),
            _ => Err("nope".to_string()),
        },
    )
    .unwrap();

    assert_eq!(summary.failed, 2);
    assert!(summary.results[0]
        .actual
        .as_deref()
        .unwrap()
        .contains("threw: nope"));
    assert!(summary.results[1]
        .actual
        .as_deref()
        .unwrap()
        .contains("threw: boom"));
}

#[test]
fn the_summary_prints_every_skip_by_name_and_reason() {
    // Rule 3. A bare "3 skipped" reads identically to full coverage.
    let scratch = Scratch::new("summary");
    let root = scratch.suite(
        "scratch/suite",
        r#"[{"id":"0001-skip","title":"s","since":"0.1.0","input":{},"expected":1,
            "skip":{"rust":"tracking issue #12"}}]"#,
    );

    let summary = run_table("scratch/suite", Language::Rust, Some(root), |_| {
        Ok(Value::Null)
    })
    .unwrap();
    let text = format_summary(&summary);

    assert!(
        text.contains("SKIP 0001-skip -- tracking issue #12"),
        "{text}"
    );
    assert!(
        text.contains("fancy-conformance "),
        "the pinned version must be printed: {text}"
    );
}

// -- the comparator ------------------------------------------------------

#[test]
fn object_key_order_does_not_affect_equality_but_array_order_does() {
    assert!(equals(
        &parse(r#"{"a":1,"b":2}"#).unwrap(),
        &parse(r#"{"b":2,"a":1}"#).unwrap()
    ));
    assert!(!equals(&parse("[1,2]").unwrap(), &parse("[2,1]").unwrap()));
}

#[test]
fn an_integer_golden_is_never_satisfied_by_a_float() {
    // The money rule. `roundMoney` returning 2 must never satisfy a golden of
    // 3, and a golden of 0 must never be satisfied by 0.0 from a float path.
    assert!(!equals(&parse("3").unwrap(), &parse("3.0").unwrap()));
    assert!(!equals(&parse("2").unwrap(), &parse("3").unwrap()));
    assert!(equals(&parse("3").unwrap(), &parse("3").unwrap()));
}

#[test]
fn floats_compare_within_a_scaled_epsilon() {
    // Follows the PHP and Python loaders. The TypeScript one uses exact
    // comparison — a divergence recorded in this repo's AGENTS.md, which a
    // fourth loader must not deepen by inventing a third behaviour.
    assert!(equals(
        &parse("0.1").unwrap(),
        &parse("0.1000000000000000001").unwrap()
    ));
    assert!(!equals(&parse("0.1").unwrap(), &parse("0.2").unwrap()));
}

#[test]
fn a_bool_is_never_a_number() {
    // Python's `==` says `True == 1`; the peers compare with `===`. Rust's
    // types make this structural, and the test pins it anyway because the
    // guarantee is cross-language, not per-language.
    assert!(!equals(&Value::Bool(false), &parse("0").unwrap()));
    assert!(!equals(&Value::Bool(true), &parse("1").unwrap()));
}

// -- every shipped suite actually loads ----------------------------------

#[test]
fn every_shipped_suite_loads_through_this_loader() {
    // A loader that reads one suite and chokes on another is a loader nobody
    // finds out about until the day they add the second suite.
    for suite in list_suites().unwrap() {
        let meta = manifest(&suite, None).unwrap();
        if meta.get("caseFormat").and_then(Value::as_str) != Some("table") {
            continue;
        }
        let rows = cases(&suite, None).unwrap_or_else(|e| panic!("{suite}: {e}"));
        assert!(!rows.is_empty(), "{suite} loaded zero cases");
        for row in &rows {
            assert!(!row.id().is_empty(), "{suite} has a case with no id");
            assert!(!row.title().is_empty(), "{} has no title", row.id());
        }
    }
}

#[test]
fn the_graph_runs_suite_carries_what_a_flow_runtime_needs() {
    // The suite promoted out of fancy-flow-php's private fixtures. Asserting
    // its SHAPE here means a runtime wiring it up finds a clear failure rather
    // than a confusing one.
    let rows = cases("flow/graph-runs", None).unwrap();
    assert_eq!(rows.len(), 23);

    for row in &rows {
        let input = row.input();
        assert!(input.get("schema").is_some(), "{} has no schema", row.id());
        assert!(
            input.get("initialInputs").is_some(),
            "{} has no initialInputs",
            row.id()
        );

        let expected = row.expected();
        let ok = expected.get("ok").and_then(Value::as_bool);
        assert!(
            ok.is_some(),
            "{} does not say whether the run succeeds",
            row.id()
        );

        // A successful run is compared on outputs; a failed one on the exact
        // error. Never both, and never neither — the shape is what tells a
        // runner which comparison to make.
        let has_outputs = expected.get("outputs").is_some();
        let has_error = expected.get("error").is_some();
        assert_eq!(
            has_outputs,
            ok == Some(true),
            "{}: outputs must be present exactly when ok is true",
            row.id()
        );
        assert_eq!(
            has_error,
            ok == Some(false),
            "{}: error must be present exactly when ok is false",
            row.id()
        );
    }
}

#[test]
fn the_graph_runs_error_goldens_are_exact_strings_not_substrings() {
    // The promotion's whole point. `errorContains: "Cycle detected"` stopped
    // before the character PHP/TypeScript and Python disagreed on — an em dash
    // versus an ASCII hyphen — and hid the divergence for two releases.
    let rows = cases("flow/graph-runs", None).unwrap();
    let cycle = rows.iter().find(|r| r.id().starts_with("0021")).unwrap();
    assert_eq!(
        cycle.expected().get("error").and_then(Value::as_str),
        Some("Cycle detected in flow graph \u{2014} aborting.")
    );
    assert!(
        to_string(cycle.expected()).contains('\u{2014}'),
        "the golden must carry the em dash the runtimes must agree on"
    );
}
