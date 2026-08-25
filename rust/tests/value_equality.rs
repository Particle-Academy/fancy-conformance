//! This loader's own `equals`, held to the shared table.
//!
//! The package held every implementation to a table except ITSELF. Until
//! `shared/value-equality` existed, each loader's comparison was asserted only
//! by its own hand-written unit tests, against pairs its own author chose --
//! precisely the setup this repository exists to argue against.
//!
//! It was not hypothetical here. This loader asserted that an integer golden is
//! never satisfied by a float, and had a PASSING test saying so, while
//! `shared/decimal/0008-coerce-exponent` carries the integer golden `100000`
//! that PHP's `"1e5" + 0` satisfies with a float. A rule the shipped corpus
//! disproves, green for as long as nobody ran the two against each other. It
//! surfaced in 0.10.0 only because an unrelated change happened to break it.
//!
//! The generalisation: a loader can assert something the REFERENCE LANGUAGE
//! cannot express, and no number of green ticks will surface it.

use fancy_conformance::{equals_within, format_summary, run_table_with, Language};
use fancy_json::Value;

#[test]
fn this_loader_agrees_with_the_shared_equality_table() {
    let summary = run_table_with(
        "shared/value-equality",
        Language::Rust,
        None,
        |case| {
            let input = case.raw().get("input").cloned().unwrap_or(Value::Null);
            let a = input.get("a").cloned().unwrap_or(Value::Null);
            let b = input.get("b").cloned().unwrap_or(Value::Null);
            let tolerance = input.get("tolerance").and_then(Value::as_f64);
            Ok(Value::Bool(equals_within(&a, &b, tolerance)))
        },
        equals_within_exact,
    )
    .expect("run the shared equality table");

    println!("{}", format_summary(&summary));
    assert_eq!(
        summary.failed, 0,
        "this loader disagrees with the shared equality table"
    );
    // A suite that skipped every row would also report zero failures.
    assert!(summary.passed > 25, "too few rows ran: {}", summary.passed);
}

/// Compare the boolean VERDICTS exactly.
///
/// Deliberately not `equals`: using the comparator under test to judge its own
/// output would be circular, and a broken `equals` could pass its own table.
fn equals_within_exact(a: &Value, b: &Value) -> bool {
    matches!((a, b), (Value::Bool(x), Value::Bool(y)) if x == y)
}
