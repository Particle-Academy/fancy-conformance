import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { listSuites, loadSuite } from "../src/index";

/*
 * D4 (fancy-formula plan, accepted 2026-10-28): a suite whose goldens were
 * CAPTURED from Google Sheets says so with `reference: "google-sheets"`, and
 * must name the capture artifact, its date and who captured it in
 * `referenceNote`. `authored` would be false for such a suite, and a capture
 * with no recorded provenance cannot be re-checked.
 */

const schema = JSON.parse(
  readFileSync(new URL("../schema/suite-manifest.schema.json", import.meta.url), "utf8"),
) as {
  properties: {
    contract: {
      properties: { reference: { enum: string[] } };
      allOf?: Array<{
        if: { properties: { reference: { const: string } }; required: string[] };
        then: { required: string[]; properties: { referenceNote: { minLength: number } } };
      }>;
    };
  };
};

test("the manifest schema accepts google-sheets as a reference", () => {
  assert.ok(
    schema.properties.contract.properties.reference.enum.includes("google-sheets"),
    "reference enum has no google-sheets",
  );
});

test("the manifest schema requires a non-empty referenceNote when the reference is google-sheets", () => {
  const rule = (schema.properties.contract.allOf ?? []).find(
    (r) => r.if?.properties?.reference?.const === "google-sheets",
  );
  assert.ok(rule, "no conditional rule for google-sheets");
  assert.deepEqual(rule.if.required, ["reference"]);
  assert.ok(rule.then.required.includes("referenceNote"), "referenceNote is not required");
  assert.ok(rule.then.properties.referenceNote.minLength >= 1, "an empty referenceNote would pass");
});

test("every shipped google-sheets suite carries a referenceNote", () => {
  let checked = 0;
  for (const id of listSuites()) {
    const { manifest } = loadSuite(id);
    if (manifest.contract.reference !== "google-sheets") continue;
    checked += 1;
    assert.ok(
      typeof manifest.contract.referenceNote === "string" && manifest.contract.referenceNote.trim() !== "",
      `${id} is captured from Google Sheets but names no capture in referenceNote`,
    );
  }
  // No google-sheets suite ships yet (the fancy-formula capture is pending), so
  // `checked` is 0 today and this test guards the first one to land.
  assert.ok(checked >= 0);
});
