import assert from "node:assert/strict";
import { test } from "node:test";

import { type ConformanceCase, loadSuite } from "../src/index";

/**
 * Does `flow/durable-dispatch` actually CATCH a wrong dispatcher?
 *
 * Unlike `flow/graph-runs`, the functions under test here are small: a frontier
 * over node states and a selection that slices it. A compact, deliberately
 * mutable reading of both is exactly what a probe needs, so this suite has one.
 *
 * ## The control comes first
 *
 * A faithful dispatcher must pass EVERY row, or the mutants below prove nothing:
 * a table that rejects everything would "catch" all of them.
 *
 * ## Each mutant is a mistake a competent author would make
 *
 * and each asserts the EXACT rows it fails. Writing these is what changed the
 * table's shape: the first draft pinned lists of dispatch BATCHES, and the
 * "a paused node is not held" mutant produced identical batches -- it dispatches
 * `c` the moment the gate pauses rather than after `b` settles, and a batch list
 * cannot see WHEN. The goldens became an ordered trace, and row 0014 was added
 * for the per-batch cap, which the batch shape also let through.
 */

type Mutations = {
  /** Count only CLAIMED nodes as held; a paused gate frees its slot. */
  pausedNotHeld?: boolean;
  /** Apply the cap to each batch rather than to work already held. */
  perBatchCap?: boolean;
  /** The pre-#17 default: an unset (here: serial) limit dispatches everything. */
  serialIsUnlimited?: boolean;
  /** Dispatch in the order nodes BECAME ready (breadth-first), not declaration order. */
  readinessOrder?: boolean;
};

type Node = { id: string; kind: string };
type Edge = { source: string; target: string; sourceHandle?: string };
type Status = "claimed" | "completed" | "skipped" | "paused";
type Entry = { status: Status; ports: string[] };

type Input = {
  schema: { graph: { nodes: Node[]; edges: Edge[] } };
  maxConcurrent: number;
  publishes: Record<string, string[]>;
  pauses: string[];
};

/** The frontier: ready nodes in declaration order, and what just became skippable. */
function frontier(nodes: Node[], edges: Edge[], state: Record<string, Entry>): { ready: string[]; skipped: string[] } {
  const settled = new Map<string, string[]>();
  const held = new Set<string>();
  for (const [id, entry] of Object.entries(state)) {
    if (entry.status === "completed") settled.set(id, entry.ports);
    else if (entry.status === "skipped") settled.set(id, []);
    else held.add(id);
  }

  const ready: string[] = [];
  const skipped: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (settled.has(node.id) || held.has(node.id) || ready.includes(node.id)) continue;
      const incoming = edges.filter((e) => e.target === node.id);
      if (incoming.some((e) => !settled.has(e.source))) continue;
      const active = incoming.some((e) => settled.get(e.source)!.includes(e.sourceHandle ?? "out"));
      if ((incoming.length > 0 && !active) || node.kind === "note") {
        settled.set(node.id, []);
        skipped.push(node.id);
        changed = true;
        continue;
      }
      ready.push(node.id);
    }
  }

  return { ready, skipped };
}

function dispatchTrace(c: ConformanceCase, m: Mutations = {}): { trace: string[]; neverDispatched: string[] } {
  const input = c.input as Input;
  const { nodes, edges } = input.schema.graph;
  let limit: number | null = input.maxConcurrent === 0 ? null : input.maxConcurrent;
  if (m.serialIsUnlimited && limit === 1) limit = null;

  const state: Record<string, Entry> = {};
  const inFlight: string[] = [];
  const trace: string[] = [];
  const becameReady: string[] = [];

  for (let step = 0; step < 1000; step++) {
    const f = frontier(nodes, edges, state);
    for (const id of f.skipped) {
      state[id] = { status: "skipped", ports: [] };
      trace.push(`skip ${id}`);
    }

    let ready = f.ready;
    if (m.readinessOrder) {
      for (const id of ready) if (!becameReady.includes(id)) becameReady.push(id);
      ready = becameReady.filter((id) => f.ready.includes(id));
    }

    let selected = ready;
    if (limit !== null) {
      const held = Object.values(state).filter(
        (e) => e.status === "claimed" || (!m.pausedNotHeld && e.status === "paused"),
      ).length;
      selected = ready.slice(0, Math.max(0, m.perBatchCap ? limit : limit - held));
    }

    for (const id of selected) {
      state[id] = { status: "claimed", ports: [] };
      inFlight.push(id);
      trace.push(`dispatch ${id}`);
    }

    if (inFlight.length === 0) break;

    const id = inFlight.shift()!;
    if (input.pauses.includes(id)) {
      state[id] = { status: "paused", ports: [] };
      trace.push(`pause ${id}`);
    } else {
      state[id] = { status: "completed", ports: input.publishes[id] ?? ["out"] };
      trace.push(`complete ${id}`);
    }
  }

  return { trace, neverDispatched: nodes.filter((n) => !(n.id in state)).map((n) => n.id) };
}

/** The four-digit ids this implementation FAILS. */
function failing(m: Mutations = {}): string[] {
  const { cases } = loadSuite("flow/durable-dispatch");
  assert.equal(cases.length, 14, "flow/durable-dispatch lost or gained rows; re-derive every mutant's set");

  return cases
    .filter((c) => {
      try {
        assert.deepStrictEqual(dispatchTrace(c, m), c.expected);
        return false;
      } catch {
        return true;
      }
    })
    .map((c) => c.id.slice(0, 4));
}

test("THE CONTROL: a faithful dispatcher passes every row", () => {
  assert.deepEqual(failing(), [], "the control fails a row, so every mutant below proves nothing");
});

test("a paused node that is not held fails exactly 0008 and 0010", () => {
  // 0008: the gate's siblings go out while a person decides -- the gap the
  // owner's ruling closes. 0010: under a cap, `c` goes out the moment the gate
  // pauses instead of after `b` settles; only the trace can see that.
  assert.deepEqual(failing({ pausedNotHeld: true }), ["0008", "0010"]);
});

test("a cap applied per batch fails exactly 0008, 0010 and 0014", () => {
  // 0014 is the row written for it: when `a` settles a per-batch cap sends out
  // `c` AND `d`, three in flight under a cap of 2.
  assert.deepEqual(failing({ perBatchCap: true }), ["0008", "0010", "0014"]);
});

test("the pre-#17 default (serial read as unlimited) fails every serial row that branches", () => {
  // Not 0011, 0012: a single ready node at every step is the same either way.
  assert.deepEqual(failing({ serialIsUnlimited: true }), ["0001", "0004", "0005", "0007", "0008", "0013"]);
});

test("breadth-first order fails exactly 0007", () => {
  assert.deepEqual(failing({ readinessOrder: true }), ["0007"]);
});
