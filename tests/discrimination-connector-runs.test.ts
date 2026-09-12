import assert from "node:assert/strict";
import { test } from "node:test";

import { type ConformanceCase, loadSuite } from "../src/index";

/**
 * Does `flow/connector-runs` actually CATCH a wrong connector?
 *
 * `flow/graph-runs` ships no probe, and its manifest says so plainly — the
 * implementation under test there is an entire workflow engine, which this
 * package does not carry and should not grow. That reasoning does not extend to
 * this suite: a connector's contribution to a run is a small published object,
 * and a compact mutable reading of it is exactly what a probe needs.
 *
 * ## The control comes first, and it is not a formality
 *
 * Without a faithful implementation that passes EVERY row, the mutants prove
 * nothing: a table that rejects everything would "catch" all five and be
 * useless. The control is what separates "this table discriminates" from "this
 * table is broken".
 *
 * ## These are mutants, not implementations
 *
 * Nothing here is the reference. The real connectors live in the `-php`, `-js`
 * and (eventually) Python packages; the correct answers live in the case table.
 * Each mutation below is a mistake a competent author would genuinely make, and
 * each asserts the EXACT paths it breaks — "at least one failure" would prove
 * nothing about which expectation did the catching, and would keep passing
 * after that expectation was deleted.
 *
 * The third mutant is the one that justifies the whole file. The authored
 * golden originally asserted `email` alone, and the graph's email coincides with
 * the faker fixture's own default — so a connector that ignored its config
 * entirely would have passed. `name` has no default. The hole was in the golden,
 * and writing the probes is what found it.
 */

type Mutations = {
  /** A faked id shaped like a real Stripe one — no `_fake_` infix. */
  plausibleId?: boolean;
  /** The faker returns "now" instead of its authored literal. */
  freshCreated?: boolean;
  /** The executor ignores node config and uses the fixture defaults. */
  ignoresConfig?: boolean;
  /** The node never ran; nothing is published at `out`. */
  skipsNode?: boolean;
  /** Numbers arrive as strings on the way out. */
  stringifies?: boolean;
};

/** The faker fixture's own defaults — what a config-ignoring executor emits. */
const FIXTURE_DEFAULT_EMAIL = "ada@example.test";
const FIXTURE_DEFAULT_NAME = "Anonymous Customer";

/** A compact, deliberately mutable reading of what a connector node publishes. */
function runConnectorGraph(c: ConformanceCase, m: Mutations = {}): Record<string, unknown> {
  if (m.skipsNode) return {};

  const schema = (c.input as { schema: any }).schema;
  const node = schema.graph.nodes.find((n: any) => n.kind === "@particle-academy/stripe_customer");
  const config = node?.config ?? {};

  const created = m.freshCreated ? Math.floor(Date.now() / 1000) : 1767225600;

  return {
    out: {
      mode: "fake",
      data: {
        object: "customer",
        id: m.plausibleId ? "cus_NffrFeUfNV2Hib" : "cus_fake_abaeeb55ae4a",
        email: m.ignoresConfig ? FIXTURE_DEFAULT_EMAIL : config.email,
        name: m.ignoresConfig ? FIXTURE_DEFAULT_NAME : config.name,
        created: m.stringifies ? String(created) : created,
        livemode: false,
      },
    },
  };
}

/** Read a dotted path, distinguishing ABSENT from a published null. */
function readPath(root: unknown, path: string): { found: boolean; value: unknown } {
  let cursor: any = root;

  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object" || !(segment in cursor)) {
      return { found: false, value: undefined };
    }
    cursor = cursor[segment];
  }

  return { found: true, value: cursor };
}

/**
 * Which named paths this implementation FAILS.
 *
 * `absent !== null` is enforced here rather than assumed: a path that was never
 * published fails its check instead of comparing equal to null, which is what
 * stops the skipped-node mutant satisfying half the table.
 */
function failingPaths(c: ConformanceCase, outputs: Record<string, unknown>): string[] {
  const expected = c.expected as {
    paths: { equals: Record<string, unknown>; matches: Record<string, string> };
  };
  const failures: string[] = [];

  for (const [path, want] of Object.entries(expected.paths.equals)) {
    const { found, value } = readPath(outputs, path);
    // Object.is, not ==: "1767225600" is not 1767225600.
    if (!found || !Object.is(value, want)) failures.push(path);
  }

  for (const [path, pattern] of Object.entries(expected.paths.matches)) {
    const { found, value } = readPath(outputs, path);
    if (!found || typeof value !== "string" || !new RegExp(pattern).test(value)) {
      failures.push(path);
    }
  }

  return failures.sort();
}

function theCase(): ConformanceCase {
  const { cases } = loadSuite("flow/connector-runs");
  const found = cases.find((c) => c.id === "0001-stripe-customer-fake");

  // Loading it by id rather than by index: a suite that stops being discovered,
  // or a case that is renumbered, must fail here rather than silently probe
  // nothing.
  assert.ok(found, "flow/connector-runs/0001-stripe-customer-fake was not found");

  return found;
}

test("THE CONTROL: a faithful connector passes every named path", () => {
  const c = theCase();

  assert.deepEqual(
    failingPaths(c, runConnectorGraph(c)),
    [],
    "the control fails a row, so every mutant below proves nothing",
  );
});

test("a plausible id with no `_fake_` infix fails exactly out.data.id", () => {
  const c = theCase();

  // The reassuring reading: a faked id that cannot be told from a real one.
  assert.deepEqual(failingPaths(c, runConnectorGraph(c, { plausibleId: true })), ["out.data.id"]);
});

test("a freshly generated `created` fails exactly out.data.created", () => {
  const c = theCase();

  // The authored literal is the whole argument for this row: an engine
  // fabricating plausible data cannot produce 1767225600.
  assert.deepEqual(failingPaths(c, runConnectorGraph(c, { freshCreated: true })), [
    "out.data.created",
  ]);
});

test("an executor that ignores its config fails out.data.name, and NOT out.data.email", () => {
  const c = theCase();

  // The reason `name` is in the case at all. The graph's email equals the
  // fixture default, so email cannot tell these apart — asserting it alone
  // would have passed a connector that never read the graph.
  assert.deepEqual(failingPaths(c, runConnectorGraph(c, { ignoresConfig: true })), [
    "out.data.name",
  ]);
});

test("a skipped node fails EVERY path, because absent is not null", () => {
  const c = theCase();
  const expected = c.expected as {
    paths: { equals: Record<string, unknown>; matches: Record<string, string> };
  };
  const everyPath = [
    ...Object.keys(expected.paths.equals),
    ...Object.keys(expected.paths.matches),
  ].sort();

  assert.deepEqual(failingPaths(c, runConnectorGraph(c, { skipsNode: true })), everyPath);
});

test("a stringified number fails exactly out.data.created", () => {
  const c = theCase();

  assert.deepEqual(failingPaths(c, runConnectorGraph(c, { stringifies: true })), [
    "out.data.created",
  ]);
});

test("the case still declares the python skip with a reason", () => {
  // The red lane is the point. If this row ever loses its skip, Python has
  // either shipped its executors or been quietly dropped from the contract —
  // and those need opposite reactions.
  const c = theCase();

  assert.ok(c.skip?.python, "the python row lost its skip; say which of the two happened");
  assert.ok(c.skip!.python!.length > 20, "a skip reason has to say something");
});
