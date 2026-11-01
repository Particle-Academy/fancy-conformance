// Generate the `transform` rows: flow/graph-runs 0037-0041 and the whole of
// flow/config-admission.
//
//     npm --prefix ../fancy-flow run build
//     node scripts/build-flow-transform-cases.mjs ../fancy-flow
//
// Every golden is produced by RUNNING the reference, @particle-academy/fancy-flow
// (its built dist), never typed: the graph rows through `importWorkflow`
// (lenient) and `runFlow`, the admission rows through `validateConfig`. The
// inputs are written here; the expected values are whatever the reference says.
//
// The graph-runs rows are spliced in by id, so rows 0001-0036 are untouched and
// a re-run replaces only these five. The admission suite is written whole.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SINCE = "0.42.0";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flowRoot = process.argv[2];
if (!flowRoot) {
  console.error("usage: node scripts/build-flow-transform-cases.mjs <path to a built fancy-flow checkout>");
  process.exit(2);
}

const dist = (entry) => pathToFileURL(join(resolve(flowRoot), "dist", entry)).href;
const pkg = JSON.parse(readFileSync(join(resolve(flowRoot), "package.json"), "utf8"));
const { registerBuiltinKinds, getNodeKind, validateConfig, defaultConfigFor } = await import(dist("registry.js"));
const { importWorkflow } = await import(dist("schema.js"));
const { runFlow } = await import(dist("engine.js"));
registerBuiltinKinds();
const REFERENCE = `${pkg.name} ${pkg.version}`;

const transform = getNodeKind("transform");
const EDITOR_DEFAULTS = defaultConfigFor(transform);

// ---------------------------------------------------------------------------
// flow/graph-runs: manual_trigger -> transform -> output
// ---------------------------------------------------------------------------

function graph(config) {
  const tf = { id: "tf", kind: "transform", position: { x: 1, y: 0 } };
  if (config !== undefined) tf.config = config;
  return {
    $schema: "https://particle.academy/schemas/workflow/v1.json",
    version: 1,
    graph: {
      nodes: [
        { id: "t", kind: "manual_trigger", position: { x: 0, y: 0 } },
        tf,
        { id: "o", kind: "output", position: { x: 2, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "t", target: "tf" },
        { id: "e2", source: "tf", target: "o" },
      ],
    },
  };
}

async function runGraph(schema, initialInputs) {
  const imported = importWorkflow(schema, { lenient: true });
  const result = await runFlow(imported.graph, {}, undefined, { initialInputs });
  return result.ok ? { ok: true, outputs: result.outputs } : { ok: false, error: result.error };
}

const RUN_ROWS = [
  {
    id: "0037-transform-editor-defaults-pass-through",
    title: "A transform with the editor's untouched defaults (fields mode, one blank row) passes its input through.",
    tags: ["logic", "transform", "editor-defaults"],
    config: EDITOR_DEFAULTS,
    payload: { user: { name: "Ada" } },
    notes:
      "The config is the reference's own `defaultConfigFor(transform)`, which is what the editor writes for a new node. The blank row has no key, so it writes nothing, and a transform that writes nothing passes its input through rather than emptying it. Reported by Maipa: this exact config was refused by the Python port's admission and, had it run there, fields mode did not exist.",
  },
  {
    id: "0038-transform-fields-mode-builds-the-object",
    title: "Fields mode builds the output object row by row: whole expressions keep their type, mixed text interpolates, a literal stays literal, keys are trimmed and blank rows are skipped.",
    tags: ["logic", "transform", "fields"],
    config: {
      mode: "fields",
      fields: [
        { key: "", value: "" },
        { key: " name ", value: "{{ $json.user.name }}" },
        { key: "greeting", value: "Hi {{ $json.user.name }}" },
        { key: "age", value: "{{ $json.user.age }}" },
        { key: "source", value: "manual" },
        { key: "count", value: 3 },
        { key: "source", value: "editor" },
      ],
    },
    payload: { user: { name: "Ada", age: 36 } },
    notes:
      "Each pinned behaviour is a way a port goes wrong silently: `age` must stay a NUMBER (a whole `{{ }}` keeps its type); ` name ` must arrive as `name`; the blank first row must not produce an empty-string key; a non-string value (`count: 3`) is already a value; and a repeated key (`source`) keeps the LATER value at the FIRST position, which is what a JavaScript object does. Compare outputs as maps, not as ordered text.",
  },
  {
    id: "0039-transform-expression-mode",
    title: "Expression mode returns the expression's value.",
    tags: ["logic", "transform", "expression"],
    config: { mode: "expression", expression: "{{ $json.user }}" },
    payload: { user: { name: "Ada" } },
  },
  {
    id: "0040-transform-expression-mode-ignores-stale-fields",
    title: "Expression mode ignores the `fields` the editor left behind, including a filled-in row.",
    tags: ["logic", "transform", "expression", "editor-defaults"],
    config: {
      mode: "expression",
      fields: [{ key: "", value: "" }, { key: "who", value: "{{ $json.user.name }}" }],
      expression: "{{ $json.user }}",
    },
    payload: { user: { name: "Ada" } },
    notes:
      "NodeConfigPanel MERGES an edited key into the existing config, so switching a node to 'One expression' leaves `fields` in place. The unused mode's keys are ignored, not refused and not applied.",
  },
  {
    id: "0041-transform-unknown-mode-takes-the-fields-path",
    title: "A `mode` the schema does not list takes the fields path at run time; refusing it is the validator's job (flow/config-admission 0005).",
    tags: ["logic", "transform", "fields"],
    config: {
      mode: "rows",
      fields: [{ key: "who", value: "{{ $json.user.name }}" }],
      expression: "{{ $json.user }}",
    },
    payload: { user: { name: "Ada" } },
    notes:
      "Pinned because the runtimes DISAGREED here before this row: the reference's executor treats any mode other than `expression` (or none) as fields, while ports that read `expression` unconditionally returned the expression's value. Same JSON in, different outputs. Whether an unknown mode should fail the RUN is a separate question; today import reports it as a warning and the run proceeds, in every runtime.",
  },
];

const runRows = [];
for (const row of RUN_ROWS) {
  const input = { schema: graph(row.config), initialInputs: { t: row.payload } };
  const expected = await runGraph(input.schema, input.initialInputs);
  const out = { id: row.id, title: row.title, since: SINCE, tags: row.tags, input, expected };
  if (row.notes) out.notes = row.notes;
  runRows.push(out);
}

const graphRunsPath = join(ROOT, "suites/flow/graph-runs/cases.json");
const graphRuns = JSON.parse(readFileSync(graphRunsPath, "utf8"));
const ours = new Set(runRows.map((r) => r.id));
graphRuns.cases = [...graphRuns.cases.filter((c) => !ours.has(c.id)), ...runRows];
writeFileSync(graphRunsPath, JSON.stringify(graphRuns, null, 2) + "\n");

// ---------------------------------------------------------------------------
// flow/config-admission: validateConfig(kind, config)
// ---------------------------------------------------------------------------

const SHALLOW_RUST =
  "fancy-flow-rs validate_config is deliberately shallow (required fields and select options only) and does not type-check values or walk repeater rows";

const ADMISSION_ROWS = [
  {
    id: "0001-transform-editor-defaults-are-admitted",
    title: "The editor's own defaults for a transform are admitted.",
    config: EDITOR_DEFAULTS,
    notes:
      "The defect this suite exists for. The reference's validator refused its own defaults (the blank row's `key` is required) until 0.82.0, and the Python and PHP ports declared only a REQUIRED `expression`, so every node dropped from the editor was refused. `fields` now declares `skipBlankRows`: a row whose every field is blank is an unfilled placeholder.",
  },
  {
    id: "0002-transform-expression-mode-with-a-stale-blank-row-is-admitted",
    title: "Expression mode with the blank default row still present is admitted.",
    config: { mode: "expression", fields: [{ key: "", value: "" }], expression: "{{ $json.user }}" },
  },
  {
    id: "0003-transform-fields-mode-with-real-rows-is-admitted",
    title: "Fields mode with filled-in rows and a trailing blank row is admitted.",
    config: { mode: "fields", fields: [{ key: "name", value: "{{ $json.first }}" }, { key: "", value: "" }] },
  },
  {
    id: "0004-transform-a-row-object-with-no-keys-is-blank",
    title: "A row that is an empty object is blank, and admitted.",
    config: { mode: "fields", fields: [{}] },
    notes:
      "PHP decodes `{}` to `[]`, the same value as an empty list, so the PHP port treats an empty array row as the blank object it came from.",
  },
  {
    id: "0005-transform-unknown-mode-is-refused",
    title: "A mode the schema does not list is refused.",
    config: { mode: "rows", fields: [] },
  },
  {
    id: "0006-transform-a-value-without-a-key-is-refused",
    title: "A row with a value and no key is refused: the executor would drop that value silently.",
    config: { mode: "fields", fields: [{ key: "", value: "{{ $json.a }}" }] },
    skip: { rust: SHALLOW_RUST },
    notes:
      "This is why the blank-row rule is 'every field blank' rather than 'key blank'. Skipping on a blank key alone would admit a configured value that never reaches the output -- field loss with no signal.",
  },
  {
    id: "0007-transform-fields-not-a-list-is-refused",
    title: "`fields` that is not a list is refused.",
    config: { mode: "fields", fields: "name" },
    skip: { rust: SHALLOW_RUST },
  },
  {
    id: "0008-transform-a-row-that-is-not-an-object-is-refused",
    title: "A `fields` row that is not an object is refused.",
    config: { mode: "fields", fields: ["name"] },
    skip: { rust: SHALLOW_RUST },
  },
  {
    id: "0009-transform-an-expression-that-is-not-a-string-is-refused",
    title: "An `expression` that is not a string is refused, whichever mode is selected.",
    config: { mode: "fields", fields: [], expression: 5 },
    skip: { rust: SHALLOW_RUST },
  },
];

const admissionRows = ADMISSION_ROWS.map((row) => {
  const issues = validateConfig(transform, row.config);
  const out = {
    id: row.id,
    title: row.title,
    since: SINCE,
    tags: ["transform", issues.length === 0 ? "admitted" : "refused"],
    input: { kind: "transform", config: row.config },
    expected: { issueKeys: issues.map((i) => i.key) },
  };
  if (row.skip) out.skip = row.skip;
  if (row.notes) out.notes = row.notes;
  return out;
});

const admissionDir = join(ROOT, "suites/flow/config-admission");
mkdirSync(admissionDir, { recursive: true });
writeFileSync(
  join(admissionDir, "cases.json"),
  JSON.stringify({ $schema: "../../../schema/case-table.schema.json", suite: "flow/config-admission", cases: admissionRows }, null, 2) +
    "\n",
);

console.log(`reference: ${REFERENCE}`);
for (const r of runRows) console.log(`flow/graph-runs ${r.id}: ${JSON.stringify(r.expected)}`);
for (const r of admissionRows) console.log(`flow/config-admission ${r.id}: ${JSON.stringify(r.expected)}`);
