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
  notes?: string;
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
