//! File references, against the SAME trees the Node, PHP and Python loaders
//! test: `testdata/file-refs/`, written once by
//! `scripts/build-file-ref-testdata.py`, with `expected.json` as the one
//! statement of every verdict.

use std::path::PathBuf;

use fancy_conformance::{
    cases, fixture_bytes, is_file_ref, list_suites, manifest, sha256_hex, Error,
};
use fancy_json::Value;

fn testdata() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../testdata/file-refs")
}

fn refs_in<'a>(value: &'a Value, out: &mut Vec<&'a Value>) {
    if is_file_ref(value) {
        out.push(value);
    } else if let Some(items) = value.as_array() {
        for item in items {
            refs_in(item, out);
        }
    } else if let Some(object) = value.as_object() {
        for (_, item) in object.iter() {
            refs_in(item, out);
        }
    }
}

fn row_refs(row: &Value) -> Vec<&Value> {
    let mut out = Vec::new();
    for member in ["input", "expected", "artifacts"] {
        if let Some(value) = row.get(member) {
            refs_in(value, &mut out);
        }
    }
    out
}

fn sha(reference: &Value) -> &str {
    reference.get("sha256").and_then(Value::as_str).unwrap()
}

#[test]
fn every_shared_verdict_from_one_table() {
    let text = std::fs::read_to_string(testdata().join("expected.json")).unwrap();
    let expected = fancy_json::parse(&text).unwrap();
    let table = expected.as_object().unwrap();
    assert!(table.len() >= 19);
    let root = testdata();

    for (suite, want) in table.iter() {
        if want.as_str() == Some("data") {
            for case in cases(suite, Some(&root)).unwrap() {
                assert!(row_refs(case.raw()).is_empty(), "{suite} is data");
            }
        } else if want.as_str() == Some("ok") {
            let mut resolved = 0;
            for case in cases(suite, Some(&root)).unwrap() {
                for reference in row_refs(case.raw()) {
                    let bytes = fixture_bytes(suite, reference, Some(&root)).unwrap();
                    assert_eq!(fancy_conformance_sha(&bytes), sha(reference), "{suite}");
                    resolved += 1;
                }
            }
            assert_eq!(resolved, 8);
        } else if let Some(fragment) = want.get("load").and_then(Value::as_str) {
            let message = cases(suite, Some(&root)).err().map(|e| e.to_string());
            assert!(
                message.as_deref().is_some_and(|m| m.contains(fragment)),
                "{suite}: {message:?}"
            );
        } else {
            let fragment = want.get("bytes").and_then(Value::as_str).unwrap();
            let rows = cases(suite, Some(&root)).unwrap();
            let refs = row_refs(rows[0].raw());
            let message = fixture_bytes(suite, refs[0], Some(&root))
                .err()
                .map(|e| e.to_string());
            assert!(
                message.as_deref().is_some_and(|m| m.contains(fragment)),
                "{suite}: {message:?}"
            );
        }
    }
}

/// The loader's own digest, checked below against FIPS 180-4's vectors so it
/// is not trusted on its word.
fn fancy_conformance_sha(bytes: &[u8]) -> String {
    sha256_hex(bytes)
}

#[test]
fn the_digest_matches_the_fips_vectors() {
    assert_eq!(
        fancy_conformance_sha(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        fancy_conformance_sha(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(
        fancy_conformance_sha(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
}

#[test]
fn names_the_case_and_the_pointer() {
    let root = testdata();
    let message = cases("bad-in-expected", Some(&root))
        .err()
        .unwrap()
        .to_string();
    assert!(message.contains(
        "case \"bad-in-expected/0001-x\" has a malformed file reference at /expected/0: "
    ));
    let message = cases("bad-in-artifacts", Some(&root))
        .err()
        .unwrap()
        .to_string();
    assert!(message.contains(
        "case \"bad-in-artifacts/0001-x\" references fixtures/absent.bin, which does not exist"
    ));
}

#[test]
fn fixture_bytes_refuses_a_malformed_reference() {
    let root = testdata();
    let bad = fancy_json::parse(&format!(
        "{{\"file\": \"fixtures/../manifest.json\", \"sha256\": \"{}\"}}",
        "0".repeat(64)
    ))
    .unwrap();
    let error = fixture_bytes("ok", &bad, Some(&root)).unwrap_err();
    assert!(matches!(error, Error::Fixture(_)));
    assert!(error.to_string().contains("malformed file reference"));
}

#[test]
fn every_reference_in_the_real_suites_resolves() {
    let mut count = 0;
    for suite in list_suites().unwrap() {
        if manifest(&suite, None)
            .unwrap()
            .get("caseFormat")
            .and_then(Value::as_str)
            != Some("table")
        {
            continue;
        }
        for case in cases(&suite, None).unwrap() {
            for reference in row_refs(case.raw()) {
                let bytes = fixture_bytes(&suite, reference, None).unwrap();
                assert_eq!(sha256_hex(&bytes), sha(reference), "{suite}");
                count += 1;
            }
        }
    }
    assert!(count > 0, "no suite carries a file reference");
}
