//! Loader for the shared conformance fixtures, for Rust implementations.
//!
//! The **fourth** loader, deliberately the same shape as `src/index.ts` (Node),
//! `php/src/Conformance.php` (PHP) and `python/src/fancy_conformance/`
//! (Python), so a reviewer comparing four CI logs is comparing like with like.
//!
//! It lives here rather than in the repo under test, and the reason is written
//! into this repository's own history: four Python packages each carried a
//! private `tests/conformance/loader.py`, and **two had already diverged** —
//! reading a case's `skip` as a scalar rather than a map keyed by language, so
//! a row skipped for PHP silently skipped on Python too while the log still
//! read green. That is this repository's thesis failing inside its own
//! consumers. A fifth private copy, in Rust, would have been the same mistake
//! with a different syntax.
//!
//! # The four rules a runner must follow
//!
//! From `runners/README.md`. Each is traceable to a suite in this org that
//! reported green while covering nothing.
//!
//! 1. Run on every push and PR — not nightly, not at release.
//! 2. **A missing toolchain is a FAILURE, not a skip.** [`suites_root`]
//!    returns an error rather than `None`, so a suite that cannot run turns the
//!    job red.
//! 3. Print the summary unconditionally, including every skip and its reason.
//!    [`format_summary`] does.
//! 4. Print and assert the pinned suite version. [`version`] is what to print.
//!
//! ```no_run
//! use fancy_conformance::{format_summary, run_table, Language};
//!
//! let summary = run_table("shared/satisfies-range", Language::Rust, None, |case| {
//!     let input = case.input();
//!     Ok(fancy_json::Value::Bool(my_satisfies_range(
//!         input.get("version").and_then(fancy_json::Value::as_str).unwrap(),
//!         input.get("range").and_then(fancy_json::Value::as_str).unwrap(),
//!     )))
//! })?;
//!
//! println!("{}", format_summary(&summary)); // ALWAYS — see rule 3
//! assert!(summary.ok, "conformance failed");
//! # fn my_satisfies_range(_: &str, _: &str) -> bool { true }
//! # Ok::<(), fancy_conformance::Error>(())
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs)]

/// The README's example, compiled as a doctest.
///
/// A README that does not compile is a README that stopped being true, and
/// nothing else in the build would notice.
#[cfg(doctest)]
#[doc = include_str!("../README.md")]
struct Readme;

use std::collections::BTreeSet;
use std::env;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use fancy_json::Value;

/// The environment variable that overrides fixture discovery.
pub const ROOT_ENV: &str = "FANCY_CONFORMANCE_ROOT";

/// Which implementation is being run, deciding which `skip` entries apply.
///
/// A parameter rather than a constant, exactly as the PHP loader's `$language`
/// argument is, so a Rust harness can drive another implementation out of
/// process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    /// PHP.
    Php,
    /// Node / TypeScript.
    Node,
    /// Rust.
    Rust,
    /// Python.
    Python,
    /// Go.
    Go,
}

impl Language {
    /// The key this language uses in a case's `skip` map.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Php => "php",
            Self::Node => "node",
            Self::Rust => "rust",
            Self::Python => "python",
            Self::Go => "go",
        }
    }
}

impl fmt::Display for Language {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Anything that stops the fixtures being loaded.
///
/// Every variant is a **failure**. There is deliberately no "could not find the
/// fixtures, carrying on" path: that is the exact shape that hid two-way drift
/// for months in two earlier parity harnesses.
#[derive(Debug)]
pub enum Error {
    /// The `suites/` directory could not be located.
    RootNotFound(String),
    /// A file could not be read.
    Io(PathBuf, std::io::Error),
    /// A fixture file is not the JSON it should be.
    Malformed(PathBuf, String),
    /// A case table violates one of this repository's load-time invariants.
    InvalidCases(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RootNotFound(message) => write!(f, "fancy-conformance: {message}"),
            Self::Io(path, error) => {
                write!(
                    f,
                    "fancy-conformance: cannot read {}: {error}",
                    path.display()
                )
            }
            Self::Malformed(path, message) => {
                write!(
                    f,
                    "fancy-conformance: {} is malformed: {message}",
                    path.display()
                )
            }
            Self::InvalidCases(message) => write!(f, "fancy-conformance: {message}"),
        }
    }
}

impl std::error::Error for Error {}

/// The fixture root — the directory holding `suites/`.
///
/// Resolution order, mirroring the peer loaders:
///
/// 1. the [`ROOT_ENV`] environment variable,
/// 2. a bounded walk up from this crate's manifest directory to whatever
///    directory holds `suites/` (a checkout of this repository),
/// 3. a bounded walk up looking for a sibling `fancy-conformance` checkout,
///    directly or under `repos/` (an envelope layout).
///
/// Never a fixed `../..`, and never a hard-coded sibling path: the two parity
/// harnesses this package replaced both did that, which is why they ran in
/// exactly one directory layout and silently no-opped everywhere else.
///
/// # Errors
///
/// [`Error::RootNotFound`] when there is nowhere to read fixtures from. This is
/// an error and not an `Option` on purpose — see rule 2.
pub fn suites_root() -> Result<PathBuf, Error> {
    if let Some(override_path) = env::var_os(ROOT_ENV) {
        let candidate = PathBuf::from(&override_path);
        if candidate.join("suites").is_dir() {
            return Ok(candidate);
        }
        return Err(Error::RootNotFound(format!(
            "{ROOT_ENV} is set to {} but there is no suites/ directory there.",
            candidate.display()
        )));
    }

    let start = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut cursor: Option<&Path> = Some(start.as_path());
    for _ in 0..8 {
        let Some(directory) = cursor else { break };
        if directory.join("suites").is_dir() {
            return Ok(directory.to_path_buf());
        }
        for base in [directory.to_path_buf(), directory.join("repos")] {
            let sibling = base.join("fancy-conformance");
            if sibling.join("suites").is_dir() {
                return Ok(sibling);
            }
        }
        cursor = directory.parent();
    }

    Err(Error::RootNotFound(format!(
        "could not locate the suites/ directory. Check this repository out beside the one \
         under test or set {ROOT_ENV} to its root. This is deliberately an error and not a \
         skip: a conformance suite that silently does not run is worse than no suite, because \
         the log reads identically to full coverage."
    )))
}

fn root_or(root: Option<&Path>) -> Result<PathBuf, Error> {
    match root {
        Some(path) => Ok(path.to_path_buf()),
        None => suites_root(),
    }
}

fn read_json(path: &Path) -> Result<Value, Error> {
    let text = fs::read_to_string(path).map_err(|e| Error::Io(path.to_path_buf(), e))?;
    fancy_json::parse(&text).map_err(|e| Error::Malformed(path.to_path_buf(), e.to_string()))
}

/// The fixture collection's own version — the thing a runner must print.
///
/// # Errors
///
/// As [`suites_root`], or if `VERSION` cannot be read.
pub fn version() -> Result<String, Error> {
    let path = suites_root()?.join("VERSION");
    let text = fs::read_to_string(&path).map_err(|e| Error::Io(path, e))?;
    Ok(text.trim().to_string())
}

/// Every suite id present, e.g. `["flow/graph-runs", "shared/decimal", ...]`.
///
/// # Errors
///
/// As [`suites_root`].
pub fn list_suites() -> Result<Vec<String>, Error> {
    let root = suites_root()?.join("suites");
    let mut found = BTreeSet::new();
    collect_suites(&root, &root, &mut found)?;
    Ok(found.into_iter().collect())
}

fn collect_suites(root: &Path, at: &Path, found: &mut BTreeSet<String>) -> Result<(), Error> {
    let entries = fs::read_dir(at).map_err(|e| Error::Io(at.to_path_buf(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| Error::Io(at.to_path_buf(), e))?;
        let path = entry.path();
        if path.is_dir() {
            collect_suites(root, &path, found)?;
        } else if path.file_name().is_some_and(|name| name == "manifest.json") {
            if let Some(parent) = path.parent().and_then(|p| p.strip_prefix(root).ok()) {
                found.insert(parent.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    Ok(())
}

/// Absolute path to a suite's directory — for runners that read artifacts.
///
/// # Errors
///
/// As [`suites_root`] when `root` is `None`.
pub fn suite_path(suite: &str, root: Option<&Path>) -> Result<PathBuf, Error> {
    Ok(root_or(root)?.join("suites").join(suite))
}

/// One suite's manifest: the contract it pins, and whose behaviour is the reference.
///
/// # Errors
///
/// As [`suites_root`], plus [`Error::Malformed`] if it is not an object.
pub fn manifest(suite: &str, root: Option<&Path>) -> Result<Value, Error> {
    let path = suite_path(suite, root)?.join("manifest.json");
    let value = read_json(&path)?;
    if value.as_object().is_none() {
        return Err(Error::Malformed(path, "not an object".into()));
    }
    Ok(value)
}

/// The stand-in for an absent field.
///
/// A `static` rather than a temporary, so the accessors below can hand out a
/// `&Value` with no lifetime gymnastics. `Value` has a `Drop` impl, which a
/// `const` cannot have — a `static` is never dropped, so it can.
static ABSENT: Value = Value::Null;

/// One row of a table suite.
#[derive(Debug, Clone)]
pub struct Case {
    raw: Value,
}

impl Case {
    /// The case id, e.g. `0005-merge-after-decision`.
    #[must_use]
    pub fn id(&self) -> &str {
        self.raw.get("id").and_then(Value::as_str).unwrap_or("")
    }

    /// The one-line title.
    #[must_use]
    pub fn title(&self) -> &str {
        self.raw.get("title").and_then(Value::as_str).unwrap_or("")
    }

    /// Which of the suite's functions this case exercises, when it declares several.
    #[must_use]
    pub fn function(&self) -> Option<&str> {
        self.raw.get("fn").and_then(Value::as_str)
    }

    /// The case's input object.
    #[must_use]
    pub fn input(&self) -> &Value {
        self.raw.get("input").unwrap_or(&ABSENT)
    }

    /// The golden value.
    #[must_use]
    pub fn expected(&self) -> &Value {
        self.raw.get("expected").unwrap_or(&ABSENT)
    }

    /// Why this case is skipped for `language`, if it is.
    #[must_use]
    pub fn skip_reason(&self, language: Language) -> Option<&str> {
        self.raw.get("skip")?.get(language.as_str())?.as_str()
    }

    /// The whole row, for anything the accessors above do not cover.
    #[must_use]
    pub fn raw(&self) -> &Value {
        &self.raw
    }
}

/// Load a table suite's rows, enforcing this repository's own invariants.
///
/// `root` exists so the load-time guards below can be tested against a
/// throwaway fixture tree rather than a test re-implementing them. A guard
/// asserted by a copy of itself is the failure mode this whole repository
/// exists to stop, and it would be an embarrassing one to ship here. Every peer
/// loader takes the same argument for the same reason.
///
/// # Errors
///
/// [`Error::InvalidCases`] for a duplicate case id or a skip with no reason —
/// both otherwise silent — plus anything [`manifest`] can return.
pub fn cases(suite: &str, root: Option<&Path>) -> Result<Vec<Case>, Error> {
    let base = root_or(root)?;
    let meta = manifest(suite, Some(&base))?;

    if meta.get("caseFormat").and_then(Value::as_str) != Some("table") {
        return Err(Error::InvalidCases(format!(
            "suite \"{suite}\" is not a table suite. Directory suites are driven through the \
             subprocess CLI in runners/, not this loader."
        )));
    }

    let file = meta
        .get("cases")
        .and_then(Value::as_str)
        .unwrap_or("cases.json");
    let path = base.join("suites").join(suite).join(file);
    let payload = read_json(&path)?;

    let rows = payload
        .get("cases")
        .and_then(Value::as_array)
        .filter(|rows| !rows.is_empty())
        .ok_or_else(|| Error::InvalidCases(format!("suite \"{suite}\" has no cases.")))?;

    let mut seen: BTreeSet<&str> = BTreeSet::new();
    for row in rows {
        let id = row.get("id").and_then(Value::as_str).unwrap_or("");
        if !seen.insert(id) {
            return Err(Error::InvalidCases(format!(
                "suite \"{suite}\" has duplicate case id \"{id}\"."
            )));
        }

        // `skip` is a MAP keyed by language, not a scalar. Reading it as a
        // truthy value makes every skip apply to every language AND makes the
        // empty-reason guard unreachable, because a non-empty map is never
        // blank. Two shipped Python copies had exactly this bug.
        if let Some(skips) = row.get("skip").and_then(Value::as_object) {
            for (language, reason) in skips.iter() {
                let usable = reason.as_str().is_some_and(|text| !text.trim().is_empty());
                if !usable {
                    return Err(Error::InvalidCases(format!(
                        "case \"{suite}/{id}\" skips {language} with no reason. A skip must say \
                         why, because every runner prints it."
                    )));
                }
            }
        }
    }

    Ok(rows.iter().map(|raw| Case { raw: raw.clone() }).collect())
}

/// What happened to one case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Status {
    /// The implementation agreed with the golden.
    Pass,
    /// It did not, or it panicked.
    Fail,
    /// The case declares a skip for this language.
    Skip,
}

/// One case's outcome.
#[derive(Debug, Clone)]
pub struct CaseResult {
    /// The case id.
    pub id: String,
    /// The case title.
    pub title: String,
    /// Pass, fail or skip.
    pub status: Status,
    /// The skip reason, when skipped.
    pub reason: Option<String>,
    /// The golden, when failed.
    pub expected: Option<String>,
    /// What the implementation produced, when failed.
    pub actual: Option<String>,
}

/// A whole suite's outcome.
#[derive(Debug, Clone)]
pub struct Summary {
    /// The suite id.
    pub suite: String,
    /// Which implementation was run.
    pub language: Language,
    /// The pinned fixture-set version — rule 4.
    pub suite_version: String,
    /// How many cases passed.
    pub passed: usize,
    /// How many failed.
    pub failed: usize,
    /// How many were skipped.
    pub skipped: usize,
    /// Every case, in order.
    pub results: Vec<CaseResult>,
    /// Whether nothing failed.
    pub ok: bool,
}

/// Run one implementation against a table suite.
///
/// `run` receives a case and returns the value to compare. Returning `Err` is a
/// **failure** with the message recorded, not a crash — an implementation
/// blowing up is data about the implementation. A panic is caught and recorded
/// the same way, for the same reason.
///
/// # Errors
///
/// Anything [`cases`] can return. A suite that cannot be loaded is a hard
/// error, never an empty green run.
pub fn run_table<F>(
    suite: &str,
    language: Language,
    root: Option<&Path>,
    run: F,
) -> Result<Summary, Error>
where
    F: Fn(&Case) -> Result<Value, String> + std::panic::RefUnwindSafe,
{
    run_table_with(suite, language, root, run, equals)
}

/// [`run_table`] with a custom comparator.
///
/// # Errors
///
/// As [`run_table`].
pub fn run_table_with<F, E>(
    suite: &str,
    language: Language,
    root: Option<&Path>,
    run: F,
    compare: E,
) -> Result<Summary, Error>
where
    F: Fn(&Case) -> Result<Value, String> + std::panic::RefUnwindSafe,
    E: Fn(&Value, &Value) -> bool,
{
    let rows = cases(suite, root)?;
    let mut results = Vec::with_capacity(rows.len());

    for case in &rows {
        if let Some(reason) = case.skip_reason(language) {
            results.push(CaseResult {
                id: case.id().to_string(),
                title: case.title().to_string(),
                status: Status::Skip,
                reason: Some(reason.to_string()),
                expected: None,
                actual: None,
            });
            continue;
        }

        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(case)))
            .unwrap_or_else(|payload| Err(panic_message(&payload)));

        let (status, actual) = match outcome {
            Ok(value) => {
                if compare(&value, case.expected()) {
                    (Status::Pass, None)
                } else {
                    (Status::Fail, Some(fancy_json::to_string(&value)))
                }
            }
            Err(message) => (Status::Fail, Some(format!("threw: {message}"))),
        };

        results.push(CaseResult {
            id: case.id().to_string(),
            title: case.title().to_string(),
            reason: None,
            expected: (status == Status::Fail).then(|| fancy_json::to_string(case.expected())),
            actual,
            status,
        });
    }

    let count = |status: &Status| results.iter().filter(|r| &r.status == status).count();
    let failed = count(&Status::Fail);

    Ok(Summary {
        suite: suite.to_string(),
        language,
        suite_version: version()?,
        passed: count(&Status::Pass),
        skipped: count(&Status::Skip),
        results,
        failed,
        ok: failed == 0,
    })
}

fn panic_message(payload: &Box<dyn std::any::Any + Send>) -> String {
    payload.downcast_ref::<&str>().map_or_else(
        || {
            payload
                .downcast_ref::<String>()
                .cloned()
                .unwrap_or_else(|| "panicked".to_string())
        },
        |text| (*text).to_string(),
    )
}

/// Compare an implementation's output with a golden.
///
/// Order-sensitive for arrays, order-**insensitive** for object keys — an
/// object's key order is authored presentation, not part of the value.
///
/// # The float rule, and a divergence this loader inherits deliberately
///
/// Floats compare within a scaled `1e-12` epsilon; integers compare exactly. A
/// golden written as `0.002` in JSON is a decimal literal, and the nearest
/// double to it is not the nearest double to every language's parse of the same
/// text. Integers stay exact so a `roundMoney` returning 2 never satisfies a
/// golden of 3.
///
/// **All four loaders now compare EXACTLY.** This one used to follow PHP and
/// Python's scaled `1e-12` epsilon while TypeScript used exact `Object.is` — a
/// 3-1 split in a repository whose product is agreement, recorded in `AGENTS.md`
/// for months with the note "pick one and make the other three match".
///
/// The epsilon lost, because its justification was measurably false: `0.002`
/// (the literal the justification itself named), `0.1`, `1e300`, `DBL_MAX`, the
/// `5e-324` denormal and `0.30000000000000004` all parse to BIT-IDENTICAL
/// doubles in PHP, Python and Node. What it actually did was let two runtimes
/// that computed DIFFERENT values pass as equal.
///
/// A case that genuinely needs tolerance declares one on the row, where a
/// reader of the fixture can see it.
#[must_use]
pub fn equals(a: &Value, b: &Value) -> bool {
    equals_within(a, b, None)
}

/// `equals`, with a case's declared float tolerance.
///
/// `None` means EXACT, which is now the rule in all four loaders.
#[must_use]
pub fn equals_within(a: &Value, b: &Value, tolerance: Option<f64>) -> bool {
    match (a, b) {
        (Value::Number(left), Value::Number(right)) => {
            if left.is_integer() && right.is_integer() {
                return left == right;
            }

            // Compared AS NUMBERS, so an int golden and a float actual of the
            // same value agree. An earlier draft of this change rejected
            // int-vs-float outright and `shared/decimal/0008-coerce-exponent`
            // caught it: the reference language is JavaScript, which has ONE
            // number type, so a golden can never encode "this must be a float".
            // Enforcing a distinction the reference cannot express asserts
            // something no golden can honestly claim.
            let (x, y) = (left.as_f64(), right.as_f64());

            match tolerance {
                Some(epsilon) => {
                    let scale = 1.0_f64.max(x.abs()).max(y.abs());
                    (x - y).abs() <= epsilon * scale
                }
                None => x == y,
            }
        }
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right.iter())
                    .all(|(x, y)| equals_within(x, y, tolerance))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left.iter().all(|(key, value)| {
                    right
                        .get(key)
                        .is_some_and(|other| equals_within(value, other, tolerance))
                })
        }
        _ => a == b,
    }
}

/// A summary a CI log can be read from — including every skip, by name and reason.
///
/// Skips are printed unconditionally and never folded into a bare count. "3
/// skipped" in a log looks the same as full coverage at a glance, which is how
/// a suite stops meaning anything without anyone deciding that it should.
#[must_use]
pub fn format_summary(summary: &Summary) -> String {
    let mut lines = vec![
        format!(
            "{} [{}] -- fancy-conformance {}",
            summary.suite, summary.language, summary.suite_version
        ),
        format!(
            "  {} passed, {} failed, {} skipped",
            summary.passed, summary.failed, summary.skipped
        ),
    ];

    for result in &summary.results {
        match result.status {
            Status::Skip => lines.push(format!(
                "  SKIP {} -- {}",
                result.id,
                result.reason.as_deref().unwrap_or("")
            )),
            Status::Fail => {
                lines.push(
                    format!("  FAIL {} {}", result.id, result.title)
                        .trim_end()
                        .to_string(),
                );
                lines.push(format!(
                    "       expected: {}",
                    preview(result.expected.as_deref())
                ));
                lines.push(format!(
                    "       actual:   {}",
                    preview(result.actual.as_deref())
                ));
            }
            Status::Pass => {}
        }
    }

    lines.join("\n")
}

fn preview(text: Option<&str>) -> String {
    let text = text.unwrap_or("");
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= 120 {
        return text.to_string();
    }
    let head: String = chars[..60].iter().collect();
    let tail: String = chars[chars.len() - 40..].iter().collect();
    format!("{head}...{tail} (len {})", chars.len())
}
