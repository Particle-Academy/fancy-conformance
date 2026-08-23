//! `FANCY_CONFORMANCE_ROOT` — one test, in a test binary of its own, on purpose.
//!
//! Cargo runs each `tests/*.rs` as a separate process but runs the tests
//! *within* one file on parallel threads. `set_var` is process-wide, so any
//! test that points the loader at a bogus root races every sibling that
//! resolves the real one, and passes or fails on thread scheduling.
//!
//! That is not hypothetical. This started as a test inside `loader.rs` and took
//! three unrelated tests down on its second run; splitting it into its own file
//! but leaving TWO tests in it reproduced the same race at smaller scale. Hence
//! one test, asserting both directions in sequence. A conformance loader with a
//! flaky test is worse than one with a gap, because the next red build gets
//! re-run rather than read.

use fancy_conformance::{suites_root, Error, ROOT_ENV};

#[test]
fn the_override_is_honoured_and_a_bogus_one_is_an_error() {
    // Both directions, in order, in one test — because the thing under test is
    // a process-wide variable and nothing else may be touching it.
    let bogus = std::env::temp_dir().join("fancy-conformance-definitely-not-a-checkout");

    // SAFETY: this binary contains exactly one test, so no other thread is
    // reading the environment. That is the whole reason the file exists.
    unsafe {
        std::env::set_var(ROOT_ENV, &bogus);
    }

    // Rule 2 of runners/README.md. `skipIf(!HAS_X)` returning green is the exact
    // mechanism that hid two-way drift for months, so a root that does not
    // exist must turn the job red rather than quietly resolve somewhere else.
    let error = suites_root().expect_err("a bad root must fail, not fall back");
    assert!(matches!(error, Error::RootNotFound(_)), "{error}");
    assert!(
        error.to_string().contains(ROOT_ENV),
        "the message must name the variable that is wrong: {error}"
    );

    // The negative. Without it, a loader that ALWAYS errored would satisfy the
    // assertions above and cover nothing — the same shape as a skip that is
    // really a silent pass.
    unsafe {
        std::env::remove_var(ROOT_ENV);
    }
    assert!(
        suites_root().is_ok(),
        "with no override set, discovery must find the checkout"
    );

    // And an override that DOES point at a checkout is used.
    let real = suites_root().expect("discovery works");
    unsafe {
        std::env::set_var(ROOT_ENV, &real);
    }
    assert_eq!(suites_root().unwrap(), real);

    unsafe {
        std::env::remove_var(ROOT_ENV);
    }
}
