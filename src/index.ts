import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CaseResult,
  ConformanceCase,
  Language,
  RunSummary,
  Suite,
  SuiteManifest,
} from "./types";

export * from "./types";

/**
 * The repository root, whether this is running from `dist/` in an installed
 * package or from `src/` in a checkout.
 *
 * Resolved by walking up to the directory that holds `suites/`, rather than by
 * a fixed `../..`. The two existing parity harnesses in this suite both
 * hard-coded a relative path to a sibling checkout (`../../holy-sheet/src/`),
 * which is why they work in exactly one directory layout and silently no-op
 * everywhere else. This package must not repeat that.
 */
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (let i = 0; i < 6; i++) {
    try {
      if (statSync(join(dir, "suites")).isDirectory()) {
        return dir;
      }
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    "fancy-conformance: could not locate the suites/ directory. " +
      "If you vendored this package, keep suites/ next to dist/.",
  );
}

/** The suite collection's own version — the thing a runner must print. */
export function suiteVersion(): string {
  return readFileSync(join(packageRoot(), "VERSION"), "utf8").trim();
}

/** Every suite id present, e.g. `["shared/decimal", "shared/satisfies-range", …]`. */
export function listSuites(): string[] {
  const root = join(packageRoot(), "suites");
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = join(dir, entry.name);
      try {
        statSync(join(child, "manifest.json"));
        found.push(relative(root, child).split(sep).join("/"));
      } catch {
        walk(child);
      }
    }
  };

  walk(root);
  return found.sort();
}

/** Load one suite's manifest and cases. Throws rather than returning a partial. */
export function loadSuite(id: string): Suite {
  return loadSuiteFrom(packageRoot(), id);
}

/**
 * Load a suite from an explicit root.
 *
 * Exported so the load-time guards below can be tested against a throwaway
 * fixture tree, rather than a test re-implementing them. A guard asserted by a
 * copy of itself is the failure mode this whole repository exists to stop, and
 * it would be an embarrassing one to ship here.
 */
export function loadSuiteFrom(root: string, id: string): Suite {
  const dir = join(root, "suites", ...id.split("/"));
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as SuiteManifest;

  if (manifest.caseFormat !== "table") {
    throw new Error(
      `fancy-conformance: suite "${id}" uses caseFormat "${manifest.caseFormat}", ` +
        "which loadSuite() does not read. Use the artifact runner in runners/.",
    );
  }

  const table = JSON.parse(
    readFileSync(join(dir, manifest.cases ?? "cases.json"), "utf8"),
  ) as { cases: ConformanceCase[] };

  assertUsableCases(id, table.cases);

  return { manifest, cases: table.cases };
}

/**
 * Reject a case table that cannot do its job, at LOAD time.
 *
 * A skip with no reason, and a duplicate id, are both silent in every other
 * respect: the suite still loads, still reports green, and still covers less
 * than it appears to. That is the exact failure this repository exists to stop,
 * so it is a hard error here rather than a lint somewhere else.
 */
function assertUsableCases(id: string, cases: ConformanceCase[]): void {
  const seen = new Set<string>();

  for (const c of cases) {
    if (seen.has(c.id)) {
      throw new Error(`fancy-conformance: suite "${id}" has duplicate case id "${c.id}".`);
    }
    seen.add(c.id);

    for (const [lang, reason] of Object.entries(c.skip ?? {})) {
      if (typeof reason !== "string" || reason.trim() === "") {
        throw new Error(
          `fancy-conformance: case "${id}/${c.id}" skips ${lang} with no reason. ` +
            "A skip must say why, because every runner prints it.",
        );
      }
    }
  }
}

export interface RunOptions {
  /** Which language is under test — decides which `skip` entries apply. */
  language: Language;
  /**
   * Compare a produced value with the expected one. Defaults to a
   * canonicalising deep equality: object keys sorted, arrays order-sensitive.
   */
  equals?: (actual: unknown, expected: unknown) => boolean;
}

/**
 * Run one implementation against a table suite.
 *
 * `impl` receives the case and returns the value to compare. Throwing is a
 * failure, not a crash — a case that blows up is data about the implementation.
 */
export function runTable(
  suiteId: string,
  impl: (c: ConformanceCase) => unknown,
  options: RunOptions,
): RunSummary {
  const { manifest, cases } = loadSuite(suiteId);
  const equals = options.equals ?? deepEquals;
  const results: CaseResult[] = [];

  for (const c of cases) {
    const reason = c.skip?.[options.language];
    if (reason !== undefined) {
      results.push({ id: c.id, title: c.title, status: "skip", reason });
      continue;
    }

    let actual: unknown;
    try {
      actual = impl(c);
    } catch (error) {
      results.push({
        id: c.id,
        title: c.title,
        status: "fail",
        expected: c.expected,
        actual: `threw: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    results.push(
      equals(actual, c.expected)
        ? { id: c.id, title: c.title, status: "pass" }
        : { id: c.id, title: c.title, status: "fail", expected: c.expected, actual },
    );
  }

  const failed = results.filter((r) => r.status === "fail").length;

  return {
    suite: manifest.suite,
    language: options.language,
    suiteVersion: suiteVersion(),
    passed: results.filter((r) => r.status === "pass").length,
    failed,
    skipped: results.filter((r) => r.status === "skip").length,
    results,
    ok: failed === 0,
  };
}

/**
 * A summary a CI log can be read from — including every skip, by name and
 * reason.
 *
 * Skips are printed unconditionally and never folded into a count. "3 skipped"
 * in a log is indistinguishable from full coverage at a glance, which is how a
 * suite stops meaning anything without anyone deciding that it should.
 */
export function formatSummary(summary: RunSummary): string {
  const lines: string[] = [
    `${summary.suite} [${summary.language}] — fancy-conformance ${summary.suiteVersion}`,
    `  ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`,
  ];

  for (const r of summary.results) {
    if (r.status === "skip") {
      lines.push(`  SKIP ${r.id} — ${r.reason}`);
    }
    if (r.status === "fail") {
      lines.push(`  FAIL ${r.id} ${r.title}`);
      lines.push(`       expected: ${preview(r.expected)}`);
      lines.push(`       actual:   ${preview(r.actual)}`);
    }
  }

  return lines.join("\n");
}

function preview(value: unknown): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s === undefined) return String(value);
  return s.length > 120 ? `${s.slice(0, 60)}…${s.slice(-40)} (len ${s.length})` : s;
}

/** Order-sensitive for arrays, order-insensitive for object keys. */
export function deepEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEquals(v, b[i]));
  }

  if (typeof a === "object") {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) =>
      deepEquals((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }

  return false;
}

/** Absolute path to a suite's directory — for runners that read artifacts. */
export function suitePath(id: string): string {
  return resolve(join(packageRoot(), "suites", ...id.split("/")));
}
