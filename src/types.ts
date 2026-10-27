/** The languages a case may be skipped for, and that a runner may report. */
export type Language = "php" | "node" | "rust" | "python" | "go";

export interface ImplementationRef {
  language: Language;
  package: string;
  symbol?: string;
}

export interface SuiteContract {
  summary: string;
  function?: string;
  functions?: Record<string, string>;
  runShape?: Record<string, unknown>;
  /** Whose behaviour the goldens were taken from. */
  reference?: Language;
  referenceNote?: string;
  implementations: ImplementationRef[];
}

export interface SuiteManifest {
  suite: string;
  title: string;
  since: string;
  /**
   * `table` — one `cases.json` whose rows are the cases. For pure functions.
   * `directory` — `cases/<id>/` holding input and expected artifacts. For
   * capabilities that emit files, where an expectation is a tree of bytes and
   * cannot live in a JSON cell.
   */
  caseFormat: "table" | "directory";
  cases?: string;
  contract: SuiteContract;
  normalisation?: {
    ignoreAttributes?: string[];
    orderInsensitive?: string[];
    whitespace?: "preserve" | "collapse-between-elements";
    newline?: "lf" | "crlf" | "preserve";
  };
  notes?: string[];
}

export interface ConformanceCase {
  id: string;
  title: string;
  since: string;
  tags?: string[];
  /** Which of the suite's functions this case exercises. */
  fn?: string;
  input: Record<string, unknown>;
  expected: unknown;
  /**
   * The only sanctioned way not to run a case. Keyed by language, valued with a
   * REASON that may not be empty — and every runner prints these.
   */
  skip?: Partial<Record<Language, string>>;
  /** A row-declared float tolerance; absent means numbers compare exactly. */
  tolerance?: number;
  /**
   * Named data that is NOT compared: typically file references to the
   * reference implementation's own output, kept so a failing implementation
   * can diff against it. A runner must never derive its answer from these.
   */
  artifacts?: Record<string, unknown>;
  notes?: string;
}

/**
 * Bytes too large or too binary for a JSON cell, stored beside the suite.
 *
 * `file` is `fixtures/<name>` relative to the suite directory, with a flat
 * name of `[A-Za-z0-9._-]` not starting with a dot. A name ending in `.gz` is
 * a gzip file and resolves to its DECOMPRESSED bytes. `sha256` is the
 * lowercase hex digest of the bytes the reference resolves to (after gunzip).
 */
export interface FileRef {
  file: string;
  sha256: string;
}

export interface Suite {
  manifest: SuiteManifest;
  cases: ConformanceCase[];
}

export interface CaseResult {
  id: string;
  title: string;
  status: "pass" | "fail" | "skip";
  /** Present when skipped — always non-empty, because an empty reason is a load error. */
  reason?: string;
  expected?: unknown;
  actual?: unknown;
}

export interface RunSummary {
  suite: string;
  language: Language;
  /** The suite version the results were produced against. Printed, not inferred. */
  suiteVersion: string;
  passed: number;
  failed: number;
  skipped: number;
  results: CaseResult[];
  ok: boolean;
}
