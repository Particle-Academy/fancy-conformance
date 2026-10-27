/**
 * A compact, deliberately mutable reading of suites/exchange/SPEC.md, covering
 * what the exchange/* and doc-model/shared rows exercise.
 *
 * It is NOT the reference and is not exported from the package: the shipped
 * implementations live in holy-sheet, last-word, dark-slide and fine-print.
 * It exists so tests/discrimination-exchange.test.ts can show the rows are
 * satisfiable (the control passes all of them) and that they discriminate
 * (each mutation, a mistake a competent port author would plausibly make,
 * fails an exact set of ids).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;
export type Mutations = Record<string, boolean | undefined>;

export class OptionsInvalid extends Error {
  constructor() {
    super("options_invalid");
  }
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const isObj = (x: J): x is Record<string, J> => typeof x === "object" && x !== null && !Array.isArray(x);
const isInt = (x: J): boolean => typeof x === "number" && Number.isInteger(x);
const cu = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedKeys = (o: Record<string, J>): string[] => Object.keys(o).sort(cu);
export const esc = (k: string): string => k.replace(/~/g, "~0").replace(/\//g, "~1");

export function utf8Len(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

function stringBytes(v: J, m: Mutations): number {
  if (typeof v === "string") return m.charLength ? v.length : utf8Len(v);
  if (Array.isArray(v)) return v.reduce((a: number, x: J) => a + stringBytes(x, m), 0);
  if (isObj(v)) return Object.values(v).reduce((a: number, x: J) => a + stringBytes(x, m), 0);
  return 0;
}

const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿᠎؜\u{E0000}-\u{E007F}]+/gu;

/** Strip the AgentReadGuard INVISIBLE class; count maximal runs (or characters, under a mutation). */
class Guard {
  counts = new Map<string, number>();
  constructor(private m: Mutations) {}
  strip(s: string): string {
    if (this.m.noStrip) return s;
    let n = 0;
    const out = s.replace(INVISIBLE, (run) => {
      n += this.m.countChars ? [...run].length : 1;
      return "";
    });
    if (n > 0) this.add("invisible-chars", n);
    return out;
  }
  add(rule: string, n: number): void {
    this.counts.set(rule, (this.counts.get(rule) ?? 0) + n);
  }
}

// ---------------------------------------------------------------------------
// reports (SPEC 5)
// ---------------------------------------------------------------------------

export const DROPPED = [
  "cell-style-dropped", "chart", "comment", "composite-element", "embedded-object", "hidden-column", "hidden-element",
  "hidden-row", "hidden-sheet", "hidden-slide", "image", "link", "nested-block", "non-table-item", "run-style-dropped",
  "shape", "table-clipped",
];
export const APPROXIMATED = [
  "cell-truncated", "chart-as-table", "code-as-text", "csv-escaped", "format-approximated", "formula-as-value",
  "formula-uncomputed", "header-rows-flattened", "layout-not-preserved", "markup-as-text", "merge-flattened",
  "merge-unread", "quote-flattened", "structure-not-recovered", "typed-as-text",
];

export function classifyKind(kind: string, m: Mutations = {}): string | null {
  if (m.caseInsensitiveKinds) kind = kind.toLowerCase();
  if (DROPPED.includes(kind)) return m.swapCellStyle && kind === "cell-style-dropped" ? "approximated" : "dropped";
  if (APPROXIMATED.includes(kind)) return "approximated";
  return null;
}

type Entry = { count: number; where: string[] | null };

class Report {
  lists: Record<"dropped" | "approximated", Map<string, Entry>> = { dropped: new Map(), approximated: new Map() };
  constructor(public guard: Guard, private m: Mutations = {}) {}
  add(kind: string, where?: string, count = 1): void {
    const list = classifyKind(kind) as "dropped" | "approximated";
    const e = this.lists[list].get(kind) ?? { count: 0, where: null };
    e.count += count;
    if (where !== undefined) {
      e.where ??= [];
      if (this.m.noWhereCap || e.where.length < 16) e.where.push(where);
    }
    this.lists[list].set(kind, e);
  }
  build(): J {
    const out = (list: Map<string, Entry>) =>
      [...list.keys()].sort(cu).map((k) => {
        const e = list.get(k)!;
        return e.where === null ? { kind: k, count: e.count } : { kind: k, count: e.count, where: e.where };
      });
    return {
      dropped: out(this.lists.dropped),
      approximated: out(this.lists.approximated),
      guard: {
        findings: [...this.guard.counts.keys()].sort(cu).map((rule) => ({ rule, count: this.guard.counts.get(rule)! })),
      },
    };
  }
}

export function mergeReports(a: J, b: J, m: Mutations = {}): J {
  const r = new Report(new Guard({}), m);
  for (const rep of [a, b]) {
    for (const list of ["dropped", "approximated"] as const) {
      for (const e of rep[list] ?? []) {
        const cur = r.lists[list].get(e.kind) ?? { count: 0, where: null };
        cur.count += e.count;
        if (e.where) {
          cur.where ??= [];
          for (const w of e.where) if (m.noWhereCap || cur.where.length < 16) cur.where.push(w);
        }
        r.lists[list].set(e.kind, cur);
      }
    }
    for (const f of rep.guard?.findings ?? []) r.guard.add(f.rule, f.count);
  }
  return r.build();
}

// ---------------------------------------------------------------------------
// display (SPEC 6)
// ---------------------------------------------------------------------------

export function formatFloat(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const s = Math.abs(v) >= 1e21 ? BigInt(v).toString() : v.toFixed(14);
  const t = s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  return t === "-0" ? "0" : t;
}

export function canonical(t: string, v: J): string {
  if (t === "number") return formatFloat(v);
  if (t === "bool") return v ? "TRUE" : "FALSE";
  if (t === "empty") return "";
  return String(v);
}

/** The shortest round-trip decimal of |v|, written out without an exponent. */
function plainDecimal(v: number): string {
  const s = String(Math.abs(v));
  const mm = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!mm) return s;
  const digits = mm[1]! + (mm[2] ?? "");
  const point = mm[1]!.length + Number(mm[3]);
  if (point <= 0) return "0." + "0".repeat(-point) + digits;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return digits.slice(0, point) + "." + digits.slice(point);
}

/** Round a plain non-negative decimal string to `places`, half away from zero (or half-even). */
function roundDecimal(d: string, places: number, halfEven: boolean): string {
  let [whole, frac = ""] = d.split(".") as [string, string?];
  frac = frac ?? "";
  if (frac.length <= places) return whole + (places > 0 ? "." + frac.padEnd(places, "0") : "");
  const keep = frac.slice(0, places);
  const rest = frac.slice(places);
  let digits = (whole + keep).split("").map(Number);
  const first = Number(rest[0]);
  const tail = rest.slice(1).replace(/0/g, "");
  let up = first > 5 || (first === 5 && (tail.length > 0 || !halfEven));
  if (first === 5 && tail.length === 0 && halfEven) up = (digits[digits.length - 1]! % 2) === 1;
  if (up) {
    let i = digits.length - 1;
    while (i >= 0) {
      if (digits[i]! === 9) {
        digits[i] = 0;
        i--;
      } else {
        digits[i]!++;
        break;
      }
    }
    if (i < 0) digits = [1, ...digits];
  }
  const all = digits.join("");
  const w = all.slice(0, all.length - places) || "0";
  return places > 0 ? w + "." + all.slice(all.length - places) : w;
}

const SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", INR: "₹", AUD: "A$", CAD: "C$", CHF: "CHF", KRW: "₩",
};

export function display(t: string, v: J, fmt: J, m: Mutations = {}): string {
  const kind = fmt?.kind;
  if (t === "number" && (kind === "number" || kind === "currency" || kind === "percent")) {
    const places = fmt.decimals ?? { number: 0, currency: 2, percent: 1 }[kind as string]!;
    let negative = v < 0 || Object.is(v, -0);
    let rounded: string;
    if (m.binaryRound) {
      const x = kind === "percent" ? Math.abs(v) * 100 : Math.abs(v);
      rounded = x.toFixed(places);
    } else {
      let d = m.exponentString ? String(Math.abs(v)) : plainDecimal(v);
      if (kind === "percent") {
        if (m.floatPercent) d = plainDecimal(Math.abs(v) * 100);
        else {
          const [w, f = ""] = d.split(".") as [string, string?];
          const ff = (f ?? "").padEnd(2, "0");
          d = (w + ff.slice(0, 2)).replace(/^0+(?=\d)/, "") + (ff.length > 2 ? "." + ff.slice(2) : "");
        }
      }
      rounded = roundDecimal(d, places, !!m.halfEven);
    }
    if (!m.signedZero && /^[0.]+$/.test(rounded)) negative = false;
    let [whole, frac] = rounded.split(".") as [string, string?];
    if (kind !== "percent" || m.groupPercent) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const num = whole + (frac !== undefined ? "." + frac : "");
    const sign = negative ? "-" : "";
    if (kind === "percent") return sign + num + "%";
    if (kind === "currency") {
      const code = fmt.currency ?? "USD";
      const sym = SYMBOLS[code] ?? code + " ";
      return sign + (m.currencySpace && !sym.endsWith(" ") ? sym + " " : sym) + num;
    }
    return sign + num;
  }
  if ((t === "date" || t === "datetime") && (kind === "date" || kind === "datetime")) {
    const date = String(v).slice(0, 10);
    if (kind === "date") return date;
    return date + " " + (t === "datetime" ? String(v).slice(11, 19) : "00:00:00");
  }
  return canonical(t, v);
}

const displayOf = (cell: J): string => cell.text ?? canonical(cell.t, cell.v);

// ---------------------------------------------------------------------------
// validation (SPEC 7, 9)
// ---------------------------------------------------------------------------

export const DEFAULT_LIMITS: Record<string, number> = {
  items: 5000, rows: 2000, columns: 64, cells: 10000, images: 16, imageBytes: 5242880, stringBytes: 4194304, cellBytes: 32768,
};

function resolveLimits(options: J, m: Mutations): Record<string, number> {
  const limits = { ...DEFAULT_LIMITS };
  if (options === undefined || options === null) return limits;
  if (!isObj(options)) throw new OptionsInvalid();
  for (const k of Object.keys(options)) if (k !== "limits" && !m.lenientOptions) throw new OptionsInvalid();
  const l = options.limits;
  if (l === undefined) return limits;
  if (!isObj(l)) throw new OptionsInvalid();
  for (const [k, v] of Object.entries(l)) {
    if (!(k in DEFAULT_LIMITS) || !isInt(v) || (v as number) <= 0) {
      if (m.lenientOptions) continue;
      throw new OptionsInvalid();
    }
    limits[k] = v as number;
  }
  return limits;
}

const LINK_FULL = /^(https?:\/\/|mailto:)[!-~]+$/;
const LINK_PREFIX = /^(https?:\/\/|mailto:)/;
function linkOk(link: J, m: Mutations): boolean {
  if (typeof link !== "string" || utf8Len(link) > 2048) return false;
  const re = m.linkPrefixOnly ? LINK_PREFIX : LINK_FULL;
  return m.linkCaseInsensitive ? new RegExp(re.source, "i").test(link) : re.test(link);
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function dateOk(y: number, mo: number, d: number, m: Mutations): boolean {
  if (m.noCalendar) return mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
  if (mo < 1 || mo > 12) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const max = mo === 2 && leap ? 29 : DAYS[mo - 1]!;
  return d >= 1 && d <= max;
}
export function isDate(v: J, m: Mutations = {}): boolean {
  const r = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  return !!r && dateOk(+r[1]!, +r[2]!, +r[3]!, m);
}
export function isDateTime(v: J, m: Mutations = {}): boolean {
  const r = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(v) : null;
  return !!r && dateOk(+r[1]!, +r[2]!, +r[3]!, m) && +r[4]! < 24 && +r[5]! < 60 && +r[6]! < 60;
}

export function decodeBase64(s: J): Uint8Array | null {
  if (typeof s !== "string" || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  return new Uint8Array(Buffer.from(s, "base64"));
}
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
function magicOk(mime: string, b: Uint8Array): boolean {
  const magic = mime === "image/png" ? PNG_MAGIC : JPEG_MAGIC;
  return magic.every((x, i) => b[i] === x);
}

class Bad extends Error {
  constructor(readonly path: string) {
    super(path);
  }
}

/** Lay a table's rows out HTML-style; returns anchors and the grid size, or the bad row. */
export function layout(rows: J[]): { ok: boolean; badRow?: number; width: number; anchors: Array<Array<[number, number]>> } {
  const covered = new Map<number, Set<number>>();
  const anchors: Array<Array<[number, number]>> = [];
  let width = -1;
  for (let r = 0; r < rows.length; r++) {
    const occ = new Set(covered.get(r) ?? []);
    const coveredCount = occ.size;
    const row: Array<[number, number]> = [];
    let c = 0;
    let span = 0;
    for (const cell of rows[r].cells ?? []) {
      while (occ.has(c)) c++;
      const cs = cell.colSpan ?? 1;
      const rs = cell.rowSpan ?? 1;
      if (r + rs > rows.length) return { ok: false, badRow: r, width, anchors };
      row.push([r, c]);
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          if (dr === 0) occ.add(c + dc);
          else {
            const s = covered.get(r + dr) ?? new Set<number>();
            s.add(c + dc);
            covered.set(r + dr, s);
          }
        }
      }
      span += cs;
      c += cs;
    }
    anchors.push(row);
    const max = occ.size === 0 ? 0 : Math.max(...occ) + 1;
    const w = coveredCount + span;
    if (w !== max) return { ok: false, badRow: r, width, anchors };
    if (width === -1) width = w;
    else if (w !== width) return { ok: false, badRow: r, width, anchors };
  }
  return { ok: true, width: Math.max(width, 0), anchors };
}

function checkKeys(o: Record<string, J>, allowed: string[], path: string, m: Mutations): void {
  if (m.openObjects) return;
  for (const k of sortedKeys(o)) if (!allowed.includes(k)) throw new Bad(`${path}/${esc(k)}`);
}

const RUN_FLAGS = ["bold", "italic", "underline", "strike", "code"];

function checkRun(run: J, p: string, m: Mutations): void {
  if (!isObj(run)) throw new Bad(p);
  checkKeys(run, ["text", ...RUN_FLAGS, "link"], p, m);
  if (typeof run.text !== "string") throw new Bad(`${p}/text`);
  for (const f of RUN_FLAGS) if (f in run && typeof run[f] !== "boolean") throw new Bad(`${p}/${f}`);
  if ("link" in run && !linkOk(run.link, m)) throw new Bad(`${p}/link`);
}
function checkRuns(runs: J, p: string, m: Mutations): void {
  if (!Array.isArray(runs)) throw new Bad(p);
  runs.forEach((r, i) => checkRun(r, `${p}/${i}`, m));
}

const CELL_KEYS = ["t", "v", "text", "format", "formula", "colSpan", "rowSpan", "align", "runs"];
const T = ["string", "number", "bool", "date", "datetime", "empty", "error"];

function checkCell(cell: J, p: string, m: Mutations): void {
  if (!isObj(cell)) throw new Bad(p);
  if (!T.includes(cell.t)) throw new Bad(`${p}/t`);
  checkKeys(cell, CELL_KEYS, p, m);
  const t = cell.t;
  const has = "v" in cell;
  const v = cell.v;
  const vOk =
    t === "empty" ? !has
    : !has ? false
    : t === "string" ? typeof v === "string"
    : t === "number" ? typeof v === "number" && Number.isFinite(v)
    : t === "bool" ? typeof v === "boolean"
    : t === "date" ? isDate(v, m)
    : t === "datetime" ? isDateTime(v, m)
    : typeof v === "string" && v.startsWith("#");
  if (!vOk) throw new Bad(`${p}/v`);
  if ("text" in cell && typeof cell.text !== "string") throw new Bad(`${p}/text`);
  if ("format" in cell) {
    const f = cell.format;
    const fp = `${p}/format`;
    if (!isObj(f)) throw new Bad(fp);
    if (!["number", "currency", "percent", "date", "datetime", "text"].includes(f.kind)) throw new Bad(`${fp}/kind`);
    checkKeys(f, ["kind", "decimals", "currency"], fp, m);
    if ("decimals" in f && !(isInt(f.decimals) && f.decimals >= 0 && f.decimals <= 10)) throw new Bad(`${fp}/decimals`);
    if ("currency" in f && !(f.kind === "currency" && typeof f.currency === "string" && /^[A-Z]{3}$/.test(f.currency))) throw new Bad(`${fp}/currency`);
  }
  if ("formula" in cell && !(typeof cell.formula === "string" && cell.formula.length > 0)) throw new Bad(`${p}/formula`);
  for (const k of ["colSpan", "rowSpan"]) if (k in cell && !(isInt(cell[k]) && cell[k] >= 1)) throw new Bad(`${p}/${k}`);
  if ("align" in cell && !["left", "center", "right"].includes(cell.align)) throw new Bad(`${p}/align`);
  if ("runs" in cell) {
    checkRuns(cell.runs, `${p}/runs`, m);
    if (!m.noRunsConcat && cell.runs.map((r: J) => r.text).join("") !== displayOf(cell)) throw new Bad(`${p}/runs`);
  }
}

function checkListItem(it: J, p: string, m: Mutations): void {
  if (!isObj(it)) throw new Bad(p);
  checkKeys(it, ["runs", "children"], p, m);
  checkRuns(it.runs, `${p}/runs`, m);
  if ("children" in it) {
    if (!Array.isArray(it.children)) throw new Bad(`${p}/children`);
    it.children.forEach((c: J, i: number) => checkListItem(c, `${p}/children/${i}`, m));
  }
}

function checkItem(item: J, p: string, images: Record<string, J>, m: Mutations): void {
  if (!isObj(item)) throw new Bad(p);
  const type = item.type;
  if (!["table", "text", "list", "image"].includes(type)) throw new Bad(`${p}/type`);
  if (type === "text") {
    if (!["heading", "paragraph"].includes(item.role)) throw new Bad(`${p}/role`);
    checkKeys(item, ["type", "role", "level", "runs"], p, m);
    if (item.role === "heading" ? !(isInt(item.level) && item.level >= 1 && item.level <= 6) : "level" in item) throw new Bad(`${p}/level`);
    checkRuns(item.runs, `${p}/runs`, m);
    return;
  }
  if (type === "list") {
    checkKeys(item, ["type", "ordered", "items"], p, m);
    if ("ordered" in item && typeof item.ordered !== "boolean") throw new Bad(`${p}/ordered`);
    if (!Array.isArray(item.items) || item.items.length === 0) throw new Bad(`${p}/items`);
    item.items.forEach((it: J, i: number) => checkListItem(it, `${p}/items/${i}`, m));
    return;
  }
  if (type === "image") {
    checkKeys(item, ["type", "ref", "alt", "widthPx", "heightPx"], p, m);
    if (typeof item.ref !== "string" || !(item.ref in images)) throw new Bad(`${p}/ref`);
    if ("alt" in item && typeof item.alt !== "string") throw new Bad(`${p}/alt`);
    for (const k of ["widthPx", "heightPx"]) if (k in item && !(typeof item[k] === "number" && item[k] > 0)) throw new Bad(`${p}/${k}`);
    return;
  }
  checkKeys(item, ["type", "caption", "headerRows", "columns", "rows"], p, m);
  if ("caption" in item && typeof item.caption !== "string") throw new Bad(`${p}/caption`);
  if ("headerRows" in item) {
    if (!(isInt(item.headerRows) && item.headerRows >= 0)) throw new Bad(`${p}/headerRows`);
    if (Array.isArray(item.rows) && item.headerRows > item.rows.length) throw new Bad(`${p}/headerRows`);
  }
  if ("columns" in item) {
    if (!Array.isArray(item.columns)) throw new Bad(`${p}/columns`);
    item.columns.forEach((c: J, i: number) => {
      const cp = `${p}/columns/${i}`;
      if (!isObj(c)) throw new Bad(cp);
      checkKeys(c, ["width", "align"], cp, m);
      if ("width" in c && !(typeof c.width === "number" && c.width > 0)) throw new Bad(`${cp}/width`);
      if ("align" in c && !["left", "center", "right"].includes(c.align)) throw new Bad(`${cp}/align`);
    });
  }
  if (!Array.isArray(item.rows) || item.rows.length === 0) throw new Bad(`${p}/rows`);
  item.rows.forEach((r: J, ri: number) => {
    const rp = `${p}/rows/${ri}`;
    if (!isObj(r)) throw new Bad(rp);
    checkKeys(r, ["cells"], rp, m);
    if (!Array.isArray(r.cells) || r.cells.length === 0) throw new Bad(`${rp}/cells`);
    r.cells.forEach((c: J, ci: number) => checkCell(c, `${rp}/cells/${ci}`, m));
  });
  if (!m.noGridCheck) {
    const g = layout(item.rows);
    if (!g.ok) throw new Bad(`${p}/rows/${g.badRow}`);
    if ("columns" in item && item.columns.length !== g.width) throw new Bad(`${p}/columns`);
  }
}

function checkReport(rep: J, m: Mutations): void {
  const p = "/report";
  if (!isObj(rep)) throw new Bad(p);
  checkKeys(rep, ["dropped", "approximated", "guard"], p, m);
  for (const list of ["dropped", "approximated"]) {
    if (!(list in rep)) continue;
    const lp = `${p}/${list}`;
    if (!Array.isArray(rep[list])) throw new Bad(lp);
    rep[list].forEach((e: J, i: number) => {
      const ep = `${lp}/${i}`;
      if (!isObj(e)) throw new Bad(ep);
      checkKeys(e, ["kind", "count", "where"], ep, m);
      if (m.anyKind ? typeof e.kind !== "string" : classifyKind(e.kind) !== list) throw new Bad(`${ep}/kind`);
      if (!(isInt(e.count) && e.count >= 1)) throw new Bad(`${ep}/count`);
      if ("where" in e && !(Array.isArray(e.where) && e.where.length <= 16 && e.where.every((w: J) => typeof w === "string"))) throw new Bad(`${ep}/where`);
    });
  }
  if ("guard" in rep) {
    const g = rep.guard;
    if (!isObj(g)) throw new Bad(`${p}/guard`);
    checkKeys(g, ["findings"], `${p}/guard`, m);
    if (!Array.isArray(g.findings)) throw new Bad(`${p}/guard/findings`);
    g.findings.forEach((f: J, i: number) => {
      const fp = `${p}/guard/findings/${i}`;
      if (!isObj(f)) throw new Bad(fp);
      checkKeys(f, ["rule", "count"], fp, m);
      if (typeof f.rule !== "string" || f.rule === "") throw new Bad(`${fp}/rule`);
      if (!(isInt(f.count) && f.count >= 1)) throw new Bad(`${fp}/count`);
    });
  }
}

function referencedImages(items: J[]): Set<string> {
  return new Set(items.filter((i) => isObj(i) && i.type === "image").map((i) => i.ref));
}

function structural(c: J, m: Mutations): void {
  if (!isObj(c)) throw new Bad("");
  if (c.fancyContent !== 1) throw new Bad("/fancyContent");
  checkKeys(c, ["fancyContent", "source", "items", "images", "report"], "", m);
  const images: Record<string, J> = isObj(c.images) ? c.images : {};
  const checkImages = () => {
    if (!("images" in c)) return;
    if (!isObj(c.images)) throw new Bad("/images");
    for (const k of sortedKeys(c.images)) {
      const ip = `/images/${m.noPointerEscape ? k : esc(k)}`;
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(k)) throw new Bad(ip);
      const e = c.images[k];
      if (!isObj(e)) throw new Bad(ip);
      checkKeys(e, ["mime", "data"], ip, m);
      if (!["image/png", "image/jpeg"].includes(e.mime)) throw new Bad(`${ip}/mime`);
      const bytes = decodeBase64(e.data);
      if (!bytes) throw new Bad(`${ip}/data`);
      if (!m.noMagic && !magicOk(e.mime, bytes)) throw new Bad(`${ip}/data`);
    }
  };
  const checkItems = () => {
    if (!Array.isArray(c.items)) throw new Bad("/items");
    c.items.forEach((it: J, i: number) => checkItem(it, `/items/${i}`, images, m));
  };
  if (m.imagesAfterItems) {
    checkItems();
    checkImages();
  } else {
    checkImages();
    checkItems();
  }
  if (!m.allowUnreferenced && isObj(c.images)) {
    const used = referencedImages(c.items);
    for (const k of sortedKeys(c.images)) if (!used.has(k)) throw new Bad(`/images/${esc(k)}`);
  }
  if ("source" in c) {
    const s = c.source;
    if (!isObj(s)) throw new Bad("/source");
    checkKeys(s, ["package", "kind", "version", "sourceKind", "selector"], "/source", m);
    for (const k of ["package", "kind", "version"]) if (k in s && typeof s[k] !== "string") throw new Bad(`/source/${k}`);
    if ("sourceKind" in s && !["document", "model"].includes(s.sourceKind)) throw new Bad("/source/sourceKind");
  }
  if ("report" in c) checkReport(c.report, m);
}

/** The limit checks of SPEC 9, in order. Returns [code, path] or null. */
export function limitFailure(c: J, limits: Record<string, number>, m: Mutations = {}): [string, string] | null {
  const over = (n: number, lim: number) => (m.limitOffByOne ? n >= lim : n > lim);
  const items: J[] = c.items ?? [];
  if (over(items.length, limits.items!)) return ["content_too_many_items", "/items"];
  const tables = items.map((it, i) => [it, i] as const).filter(([it]) => it.type === "table");
  for (const [t, i] of tables) if (over(t.rows.length, limits.rows!)) return ["content_too_many_rows", `/items/${i}`];
  let slots = 0;
  for (const [t, i] of tables) {
    const w = m.columnsByCells ? t.rows[0].cells.length : layout(t.rows).width;
    if (over(w, limits.columns!)) return ["content_too_many_columns", `/items/${i}`];
  }
  for (const [t] of tables) {
    slots += m.countCellObjects ? t.rows.reduce((a: number, r: J) => a + r.cells.length, 0) : t.rows.length * layout(t.rows).width;
  }
  if (over(slots, limits.cells!)) return ["content_too_many_cells", "/items"];
  const images = c.images ?? {};
  if (over(Object.keys(images).length, limits.images!)) return ["content_too_many_images", "/images"];
  for (const k of sortedKeys(images)) {
    const n = m.base64Length ? images[k].data.length : decodeBase64(images[k].data)!.length;
    if (over(n, limits.imageBytes!)) return ["image_too_large", `/images/${esc(k)}`];
  }
  if (over(stringBytes(items, m), limits.stringBytes!)) return ["content_too_large", ""];
  return null;
}

export function validateContent(c: J, options: J, m: Mutations = {}): J {
  const limits = resolveLimits(options, m);
  if (m.limitsFirst) {
    const lf = safeLimit(c, limits, m);
    if (lf) return { ok: false, code: lf[0], path: lf[1] };
  }
  try {
    structural(c, m);
  } catch (e) {
    if (e instanceof Bad) return { ok: false, code: "content_invalid", path: e.path };
    throw e;
  }
  const lf = limitFailure(c, limits, m);
  return lf ? { ok: false, code: lf[0], path: lf[1] } : { ok: true };
}

function safeLimit(c: J, limits: Record<string, number>, m: Mutations): [string, string] | null {
  try {
    return limitFailure(c, limits, m);
  } catch {
    return null;
  }
}

export function truncateCell(text: string, maxBytes = DEFAULT_LIMITS.cellBytes!, m: Mutations = {}): J {
  if (m.truncateUtf16) {
    if (text.length <= maxBytes) return { text, truncated: false };
    return { text: text.slice(0, maxBytes), truncated: true };
  }
  if (utf8Len(text) <= maxBytes) return { text, truncated: false };
  let out = "";
  let n = 0;
  for (const ch of text) {
    const l = utf8Len(ch);
    if (n + l > maxBytes) break;
    out += ch;
    n += l;
  }
  return { text: out, truncated: true };
}

// ---------------------------------------------------------------------------
// range grammar (SPEC 8)
// ---------------------------------------------------------------------------

const MAX_COL = 16384;
const MAX_ROW = 1048576;

export function colLetters(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export const addr = (col: number, row: number): string => colLetters(col) + row;

export function parseCell(ref: J, m: Mutations = {}): J {
  const r = typeof ref === "string" ? /^\$?([A-Za-z]{1,3})\$?([0-9]+)$/.exec(ref) : null;
  const bad = { ok: false, code: "selector_invalid" };
  if (!r) return bad;
  if (!m.allowLeadingZero && r[2]!.startsWith("0")) return bad;
  let col = 0;
  for (const ch of r[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  if (m.zeroBasedColumn) col -= 1;
  const row = Number(r[2]);
  if (col < (m.zeroBasedColumn ? 0 : 1) || col > MAX_COL || row < 1 || row > MAX_ROW) return bad;
  return { ok: true, column: col, row };
}

const BARE_SHEET = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,254}$/;

function sheetNameOk(n: string): boolean {
  return n.length >= 1 && n.length <= 31 && !/[/\\?*[\]:]/.test(n) && !n.startsWith("'") && !n.endsWith("'");
}

function parseRange(s: string, m: Mutations): { start: string; end: string } | null {
  const parts = s.split(":");
  if (parts.length > 2) return null;
  const a = parseCell(parts[0], m);
  const b = parseCell(parts[1] ?? parts[0], m);
  if (!a.ok || !b.ok) return null;
  if (m.noReverse) return { start: addr(a.column, a.row), end: addr(b.column, b.row) };
  if (m.noCornerNormalise) {
    const swap = a.row > b.row || (a.row === b.row && a.column > b.column);
    const [x, y] = swap ? [b, a] : [a, b];
    return { start: addr(x.column, x.row), end: addr(y.column, y.row) };
  }
  return {
    start: addr(Math.min(a.column, b.column), Math.min(a.row, b.row)),
    end: addr(Math.max(a.column, b.column), Math.max(a.row, b.row)),
  };
}

/** Split `Sheet!RANGE` / `'Quoted'!RANGE` / a bare sheet. */
function splitSheet(s: string, m: Mutations): { sheet: string; range: string | null } | null {
  if (s.startsWith("'")) {
    let i = 1;
    let name = "";
    for (;;) {
      if (i >= s.length) return null;
      if (s[i] === "'") {
        if (s[i + 1] === "'" && !m.noDoubledQuote) {
          name += "'";
          i += 2;
          continue;
        }
        break;
      }
      name += s[i];
      i++;
    }
    const rest = s.slice(i + 1);
    if (rest === "") return { sheet: name, range: null };
    if (!rest.startsWith("!")) return null;
    return { sheet: name, range: rest.slice(1) };
  }
  const bang = s.lastIndexOf("!");
  if (bang < 0) return { sheet: s, range: null };
  const sheet = s.slice(0, bang);
  if (!BARE_SHEET.test(sheet)) return null;
  return { sheet, range: s.slice(bang + 1) };
}

export function parseSelector(sel: J, options: J = undefined, m: Mutations = {}): J {
  const bad = { ok: false, code: "selector_invalid" };
  const optRows = options?.headerRows;
  let out: J;
  if (typeof sel === "string") {
    if (m.bareIsCell && !sel.includes("!") && parseCell(sel).ok) return bad;
    const sp = splitSheet(sel, m);
    if (!sp || !sheetNameOk(sp.sheet)) return bad;
    if (sp.range === null) out = { kind: "sheet", sheet: sp.sheet };
    else {
      const r = parseRange(sp.range, m);
      if (!r) return bad;
      out = { kind: "range", sheet: sp.sheet, ...r };
    }
  } else if (isObj(sel)) {
    const kinds = ["sheet", "name", "table"].filter((k) => k in sel);
    if (kinds.length !== 1) return bad;
    const allowed = kinds[0] === "sheet" ? ["sheet", "range", "headerRows"] : [kinds[0]!, "headerRows"];
    if (Object.keys(sel).some((k) => !allowed.includes(k))) return bad;
    if ("headerRows" in sel && !(isInt(sel.headerRows) && sel.headerRows >= 0)) return bad;
    if (kinds[0] === "sheet") {
      if (typeof sel.sheet !== "string" || !sheetNameOk(sel.sheet)) return bad;
      if ("range" in sel) {
        if (typeof sel.range !== "string" || sel.range.includes("!")) return bad;
        const r = parseRange(sel.range, m);
        if (!r) return bad;
        out = { kind: "range", sheet: sel.sheet, ...r };
      } else out = { kind: "sheet", sheet: sel.sheet };
    } else {
      const n = sel[kinds[0]!];
      if (typeof n !== "string" || !NAME.test(n) || parseCell(n).ok || /^[rc]$/i.test(n)) return bad;
      out = { kind: kinds[0], [kinds[0]!]: n };
    }
    if ("headerRows" in sel) {
      if (optRows !== undefined && !m.headerRowsTwiceOk) return bad;
      out.headerRows = sel.headerRows;
    }
  } else return bad;
  if (optRows !== undefined && out.headerRows === undefined) out.headerRows = optRows;
  return { ok: true, selector: out };
}

export function headerRowsFor(i: J, m: Mutations = {}): J {
  if (i.selector !== undefined) {
    if (i.selector > i.rowCount) return { ok: false, code: "selector_invalid" };
    return { ok: true, headerRows: i.selector, from: "selector" };
  }
  if (i.table !== undefined && !(m.tableZeroFallsThrough && i.table === 0)) return { ok: true, headerRows: i.table, from: "table" };
  if (i.frozenRows && (m.frozenAnyRow || i.startRow === 1)) {
    return { ok: true, headerRows: m.frozenNoClamp ? i.frozenRows : Math.min(i.frozenRows, i.rowCount), from: "frozenRows" };
  }
  return { ok: true, headerRows: 0, from: "default" };
}

// ---------------------------------------------------------------------------
// shared reader helpers (SPEC 10)
// ---------------------------------------------------------------------------

export function paragraphs(text: string, m: Mutations = {}): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let cur: string[] = [];
  for (const line of lines) {
    const blank = m.singleNewlineSplits ? true : /^[ \t]*$/.test(line);
    if (m.singleNewlineSplits && !/^[ \t]*$/.test(line)) {
      out.push(line);
      continue;
    }
    if (blank) {
      if (cur.length) out.push(cur.join("\n"));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

const textItem = (s: string): J => ({ type: "text", role: "paragraph", runs: [{ text: s }] });

function dataUri(src: J): { mime: string; data: string } | null {
  const r = typeof src === "string" ? /^data:image\/(png|jpe?g);base64,(.*)$/.exec(src) : null;
  if (!r) return null;
  const mime = r[1] === "png" ? "image/png" : "image/jpeg";
  const bytes = decodeBase64(r[2]);
  if (!bytes || !magicOk(mime, bytes)) return null;
  return { mime, data: r[2]! };
}

function finish(items: J[], images: Record<string, J>, source: J, rep: Report, limits: Record<string, number>): J {
  const c: J = { fancyContent: 1, source, items };
  if (Object.keys(images).length) c.images = images;
  c.report = rep.build();
  const lf = limitFailure(c, limits);
  if (lf) return { ok: false, refused: { reason: lf[0] } };
  return { ok: true, content: c };
}

// ---------------------------------------------------------------------------
// from holy-sheet (SPEC 10.1)
// ---------------------------------------------------------------------------

const ERRORS = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#SPILL!", "#CALC!"];
const lc = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const STYLE_DROPPED = ["color", "backgroundColor", "fontSize", "borderTop", "borderRight", "borderBottom", "borderLeft"];
const DF: Record<string, string> = { number: "number", currency: "currency", percentage: "percent", date: "date", datetime: "datetime", text: "text" };

function cellRef(s: string): { col: number; row: number } {
  const p = parseCell(s);
  return { col: p.column, row: p.row };
}

export function fromHolySheet(model: J, selector: J, options: J = {}, m: Mutations = {}): J {
  const opts = options ?? {};
  const limits = resolveLimits(opts.limits ? { limits: opts.limits } : undefined, {});
  const includeHidden = !!opts.includeHidden || !!m.readHidden;
  const guard = new Guard(m);
  const rep = new Report(guard);
  const sheets: J[] = model.sheets ?? [];
  const eq = (a: string, b: string) => (m.caseSensitive ? a === b : lc(a) === lc(b));
  const isHidden = (s: J) => s.state === "hidden" || s.state === "veryHidden";

  const usedRange = (s: J): [number, number, number, number] | null => {
    let r1 = Infinity, c1 = Infinity, r2 = 0, c2 = 0;
    const touch = (a: string) => {
      const { col, row } = cellRef(a);
      r1 = Math.min(r1, row); c1 = Math.min(c1, col); r2 = Math.max(r2, row); c2 = Math.max(c2, col);
    };
    for (const [a, cell] of Object.entries(s.cells ?? {})) if (cell !== null) touch(a);
    for (const mr of s.mergedRegions ?? []) { touch(mr.start); touch(mr.end); }
    return r2 === 0 ? null : [r1, c1, r2, c2];
  };

  const buildTable = (si: number, r1: number, c1: number, r2: number, c2: number, header: (rowCount: number) => J): J => {
    const s = sheets[si];
    const sp = `/sheets/${si}`;
    const hiddenRows: number[] = includeHidden ? [] : (s.hiddenRows ?? []);
    const hiddenCols: number[] = includeHidden ? [] : (s.hiddenColumns ?? []);
    const rows: number[] = [];
    const cols: number[] = [];
    for (let c = c1; c <= c2; c++) {
      const k = hiddenCols.indexOf(c - 1);
      if (k >= 0) rep.add("hidden-column", `${sp}/hiddenColumns/${k}`);
      else cols.push(c);
    }
    for (let r = r1; r <= r2; r++) {
      const k = hiddenRows.indexOf(r);
      if (k >= 0) rep.add("hidden-row", `${sp}/hiddenRows/${k}`);
      else rows.push(r);
    }
    const kept = new Map<string, [number, number]>();
    const coveredKept = new Set<string>();
    const coveredFlat = new Set<string>();
    (s.mergedRegions ?? []).forEach((mr: J, k: number) => {
      const a = cellRef(mr.start);
      const b = cellRef(mr.end);
      const intersects = a.row <= r2 && b.row >= r1 && a.col <= c2 && b.col >= c1;
      if (!intersects) return;
      const inside = a.row >= r1 && b.row <= r2 && a.col >= c1 && b.col <= c2;
      let touchesHidden = false;
      for (let r = a.row; r <= b.row; r++) if (hiddenRows.includes(r)) touchesHidden = true;
      for (let c = a.col; c <= b.col; c++) if (hiddenCols.includes(c - 1)) touchesHidden = true;
      const keep = (inside && !touchesHidden) || m.noFlatten;
      if (!keep) rep.add("merge-flattened", `${sp}/mergedRegions/${k}`);
      for (let r = a.row; r <= b.row; r++) {
        for (let c = a.col; c <= b.col; c++) {
          if (r === a.row && c === a.col) continue;
          (keep ? coveredKept : coveredFlat).add(addr(c, r));
        }
      }
      if (keep) {
        const rs = Math.min(b.row, r2) - a.row + 1;
        const cs = Math.min(b.col, c2) - a.col + 1;
        kept.set(addr(a.col, a.row), [rs, cs]);
      }
    });
    const outRows: J[] = [];
    for (const r of rows) {
      const cells: J[] = [];
      for (const c of cols) {
        const a = addr(c, r);
        const raw = s.cells?.[a];
        const cp = `${sp}/cells/${a}`;
        if (coveredKept.has(a) && !m.emitCovered) {
          if (raw != null) rep.add("hidden-element", cp);
          continue;
        }
        if (coveredFlat.has(a) && !m.emitCovered) {
          if (raw != null) rep.add("hidden-element", cp);
          cells.push({ t: "empty" });
          continue;
        }
        const cell = mapHsCell(raw, cp, guard, rep, limits, m);
        const span = kept.get(a);
        if (span) {
          if (span[1] > 1) cell.colSpan = span[1];
          if (span[0] > 1) cell.rowSpan = span[0];
        }
        cells.push(cell);
      }
      outRows.push({ cells });
    }
    const t: J = { type: "table", headerRows: 0, rows: outRows };
    const h = header(rows.length);
    if (!h.ok) return h;
    t.headerRows = h.headerRows;
    const widths = s.columnWidths ?? {};
    if (cols.some((c) => String(c - 1) in widths)) {
      const px = cols.map((c) => widths[String(c - 1)] ?? 64);
      const sum = px.reduce((x, y) => x + y, 0);
      t.columns = px.map((p) => ({ width: p / sum }));
    }
    (s.charts ?? []).forEach((ch: J, k: number) => {
      const from = ch.position?.from;
      if (!from) return;
      const { col, row } = cellRef(from);
      if (row >= r1 && row <= r2 && col >= c1 && col <= c2) rep.add("chart", `${sp}/charts/${k}`);
    });
    return { ok: true, table: t };
  };

  const frozenHeader = (s: J, startRow: number) => (rowCount: number) =>
    headerRowsFor({ frozenRows: s.frozenRows, startRow, rowCount });

  if (selector === null || selector === undefined) {
    const items: J[] = [];
    sheets.forEach((s, si) => {
      if (isHidden(s) && !includeHidden) {
        rep.add("hidden-sheet", `/sheets/${si}`);
        return;
      }
      const u = usedRange(s);
      if (!u) return;
      const b = buildTable(si, u[0], u[1], u[2], u[3], frozenHeader(s, u[0]));
      items.push({ ...b.table, caption: guard.strip(s.name) });
    });
    return finish(items, {}, { package: "holy-sheet" }, rep, limits);
  }

  const p = parseSelector(selector, opts.headerRows !== undefined ? { headerRows: opts.headerRows } : undefined);
  if (!p.ok) return { ok: false, refused: { reason: "selector_invalid" } };
  const sel = p.selector;
  let si = -1;
  let range: [number, number, number, number] | null = null;
  let tableHeader: number | undefined;
  const findSheet = (name: string) => sheets.findIndex((s) => eq(s.name, name));
  if (sel.kind === "range" || sel.kind === "sheet") {
    si = findSheet(sel.sheet);
  } else if (sel.kind === "name") {
    const dn = (model.definedNames ?? []).find((d: J) => eq(d.name, sel.name));
    if (!dn) return { ok: false, refused: { reason: "selector_not_found" } };
    if (String(dn.ref).includes(",")) return { ok: false, refused: { reason: "selector_unsupported" } };
    const sp = splitSheet(String(dn.ref), {});
    const r = sp?.range ? parseRange(sp.range, {}) : null;
    if (!sp || !r) return { ok: false, refused: { reason: "selector_unsupported" } };
    si = findSheet(sp.sheet);
    const a = cellRef(r.start), b = cellRef(r.end);
    range = [a.row, a.col, b.row, b.col];
  } else {
    for (let i = 0; i < sheets.length && si < 0; i++) {
      const t = (sheets[i].tables ?? []).find((x: J) => eq(x.name, sel.table));
      if (t) {
        si = i;
        const r = parseRange(t.ref, {})!;
        const a = cellRef(r.start), b = cellRef(r.end);
        range = [a.row, a.col, b.row, b.col];
        tableHeader = t.headerRowCount ?? 1;
      }
    }
    if (si < 0) return { ok: false, refused: { reason: "selector_not_found" } };
  }
  if (si < 0) return { ok: false, refused: { reason: "selector_not_found" } };
  const s = sheets[si];
  if (isHidden(s) && !includeHidden) return { ok: false, refused: { reason: "selector_hidden" } };
  if (sel.kind === "range") {
    const a = cellRef(sel.start), b = cellRef(sel.end);
    range = [a.row, a.col, b.row, b.col];
  } else if (sel.kind === "sheet") range = usedRange(s);

  const src: J = { ...sel, sheet: s.name };
  if (!range) return finish([], {}, { package: "holy-sheet", selector: src }, rep, limits);
  let applied = 0;
  const b = buildTable(si, range[0], range[1], range[2], range[3], (rowCount) => {
    const h = headerRowsFor({ selector: sel.headerRows, table: tableHeader, frozenRows: s.frozenRows, startRow: range![0], rowCount });
    if (h.ok) applied = h.headerRows;
    return h;
  });
  if (!b.ok) return { ok: false, refused: { reason: b.code } };
  src.start = addr(range[1], range[0]);
  src.end = addr(range[3], range[2]);
  src.headerRows = applied;
  return finish([b.table], {}, { package: "holy-sheet", selector: src }, rep, limits);
}

function mapHsCell(raw: J, cp: string, guard: Guard, rep: Report, limits: Record<string, number>, m: Mutations): J {
  if (raw === null || raw === undefined) return { t: "empty" };
  const f = raw.format ?? {};
  let out: J;
  const hasFormula = typeof raw.formula === "string";
  let value: J = raw.value;
  if (hasFormula) {
    if (raw.computedValue === undefined || raw.computedValue === null) {
      if (m.uncachedAsValue && value !== null && value !== undefined) value = raw.value;
      else {
        rep.add("formula-uncomputed", cp);
        return { t: "empty", formula: raw.formula };
      }
    } else value = raw.computedValue;
  }
  if (typeof value === "string") value = guard.strip(value);
  if (value === null || value === undefined) out = { t: "empty" };
  else if (typeof value === "boolean") out = { t: "bool", v: value };
  else if (typeof value === "number") out = { t: "number", v: value };
  else if (hasFormula && ERRORS.includes(value) && !m.noErrorType) out = { t: "error", v: value };
  else if (f.displayFormat === "date" && isDate(value)) out = { t: "date", v: value };
  else if (f.displayFormat === "datetime" && isDateTime(value)) out = { t: "datetime", v: value };
  else if (m.stringPromoted && value.startsWith("=")) out = { t: "empty", formula: value.slice(1) };
  else out = { t: "string", v: value };
  if (hasFormula) out.formula = raw.formula;

  let approximated = false;
  if (out.t === "number") {
    if (typeof f.formatCode === "string") {
      out.format = { kind: "number" };
      approximated = !m.formatForeign;
      rep.add("format-approximated", cp);
    } else if (DF[f.displayFormat]) {
      out.format = { kind: DF[f.displayFormat] };
      if (f.decimals !== undefined) out.format.decimals = f.decimals;
      if (f.currency !== undefined) out.format.currency = f.currency;
    }
  } else if ((out.t === "date" || out.t === "datetime") && DF[f.displayFormat]) out.format = { kind: DF[f.displayFormat] };
  let truncated = false;
  if (out.t === "string" && utf8Len(out.v) > limits.cellBytes!) {
    out.v = truncateCell(out.v, limits.cellBytes!).text;
    rep.add("cell-truncated", cp);
    truncated = true;
  }
  // A foreign format's best-effort text is canonical(v) (SPEC 10.1), never the
  // approximated {kind: "number"} formatted at its 0-place default.
  const shown = out.format && !approximated ? display(out.t, out.v, out.format) : canonical(out.t, out.v);
  if (out.format && shown !== canonical(out.t, out.v)) out.text = shown;
  if ((f.bold || f.italic) && shown !== "" && !truncated) {
    const run: J = { text: shown };
    if (f.bold) run.bold = true;
    if (f.italic) run.italic = true;
    out.runs = [run];
  }
  if (["left", "center", "right"].includes(f.textAlign)) out.align = f.textAlign;
  if (STYLE_DROPPED.some((k) => k in f)) rep.add("cell-style-dropped", cp);
  if (raw.comment !== undefined && raw.comment !== null) rep.add("comment", cp);
  return out;
}

// ---------------------------------------------------------------------------
// from last-word (SPEC 10.2)
// ---------------------------------------------------------------------------

const PARA_PROPS = ["align", "borders", "indentLeft", "indentRight", "keepNext", "lineHeight", "shading", "spaceAfter", "spaceBefore"];
const RUN_STYLE = ["color", "highlight", "size", "font", "letterSpacing"];

function mapRuns(runs: J[], p: string, guard: Guard, rep: Report, m: Mutations): J[] {
  return (runs ?? []).map((r, i) => {
    const out: J = { text: guard.strip(String(r.text ?? "")) };
    for (const f of RUN_FLAGS) if (r[f] === true) out[f] = true;
    if (typeof r.link === "string") {
      if (m.keepAllLinks || linkOk(r.link, {})) out.link = r.link;
      else rep.add("link", `${p}/${i}`);
    }
    if (RUN_STYLE.some((k) => k in r) || r.smallCaps === true) rep.add("run-style-dropped", `${p}/${i}`);
    return out;
  });
}

const styled = (runs: J[]): boolean => runs.some((r) => RUN_FLAGS.some((f) => r[f]) || r.link);

export function fromLastWord(doc: J, selector: J, options: J = {}, m: Mutations = {}): J {
  const limits = resolveLimits(options?.limits ? { limits: options.limits } : undefined, {});
  const guard = new Guard(m);
  const rep = new Report(guard);
  const blocks: J[] = doc.blocks ?? [];
  const no = (reason: string) => ({ ok: false, refused: { reason } });
  let picked: number[];
  if (selector === null || selector === undefined) picked = blocks.map((_, i) => i);
  else if (!isObj(selector)) return no("selector_invalid");
  else if ("table" in selector) {
    if (!isInt(selector.table) || selector.table < 0 || Object.keys(selector).length !== 1) return no("selector_invalid");
    const tables = blocks.map((b, i) => [b, i] as const).filter(([b]) => b.type === "table");
    const hit = tables[selector.table];
    if (!hit) return no("selector_not_found");
    picked = [hit[1]];
  } else if ("underHeading" in selector) {
    const nth = selector.nth ?? 0;
    if (typeof selector.underHeading !== "string" || !isInt(nth) || nth < 0) return no("selector_invalid");
    const textOf = (b: J) => (b.runs ?? []).map((r: J) => r.text).join("");
    const h = blocks.findIndex((b) => b.type === "heading" && lc(textOf(b)) === lc(selector.underHeading));
    if (h < 0) return no("selector_not_found");
    const level = blocks[h].level;
    const tables: number[] = [];
    for (let i = h + 1; i < blocks.length; i++) {
      if (!m.noSectionEnd && blocks[i].type === "heading" && blocks[i].level <= level) break;
      if (blocks[i].type === "table") tables.push(i);
    }
    if (tables[nth] === undefined) return no("selector_not_found");
    picked = [tables[nth]!];
  } else if ("blocks" in selector) {
    const r = selector.blocks;
    if (!Array.isArray(r) || r.length !== 2 || !r.every((x: J) => isInt(x) && x >= 0) || r[0] > r[1]) return no("selector_invalid");
    const last = m.exclusiveRange ? r[1] - 1 : r[1];
    if (last >= blocks.length) return no("selector_not_found");
    picked = [];
    for (let i = r[0]; i <= last; i++) picked.push(i);
  } else return no("selector_invalid");

  const items: J[] = [];
  const images: Record<string, J> = {};
  const mapBlock = (b: J, p: string): void => {
    switch (b.type) {
      case "heading":
      case "paragraph": {
        if (PARA_PROPS.some((k) => k in b)) rep.add("layout-not-preserved", p);
        const runs = mapRuns(b.runs, `${p}/runs`, guard, rep, m);
        items.push(b.type === "heading" ? { type: "text", role: "heading", level: b.level, runs } : { type: "text", role: "paragraph", runs });
        return;
      }
      case "list": {
        const mapItem = (it: J, ip: string): J => {
          if (PARA_PROPS.some((k) => k in it)) rep.add("layout-not-preserved", ip);
          const o: J = { runs: mapRuns(it.runs, `${ip}/runs`, guard, rep, m) };
          if (Array.isArray(it.children)) o.children = it.children.map((c: J, k: number) => mapItem(c, `${ip}/children/${k}`));
          return o;
        };
        items.push({ type: "list", ordered: b.ordered === true, items: (b.items ?? []).map((it: J, k: number) => mapItem(it, `${p}/items/${k}`)) });
        return;
      }
      case "table":
        items.push(mapLwTable(b, p, guard, rep, m));
        return;
      case "code":
        rep.add("code-as-text", p);
        items.push({ type: "text", role: "paragraph", runs: [{ text: guard.strip(String(b.text ?? "")), code: true }] });
        return;
      case "quote":
        rep.add("quote-flattened", p);
        (b.blocks ?? []).forEach((c: J, k: number) => mapBlock(c, `${p}/blocks/${k}`));
        return;
      case "image": {
        const d = dataUri(b.src);
        if (!d) {
          rep.add("image", p);
          return;
        }
        const ref = `img${Object.keys(images).length + 1}`;
        images[ref] = d;
        const it: J = { type: "image", ref };
        for (const k of ["alt", "widthPx", "heightPx"]) if (k in b) it[k] = k === "alt" ? guard.strip(b.alt) : b[k];
        items.push(it);
        return;
      }
      case "chart":
        rep.add("chart", p);
        return;
      default:
        rep.add("layout-not-preserved", p);
    }
  };
  for (const i of picked) mapBlock(blocks[i], `/blocks/${i}`);
  const source: J = { package: "last-word" };
  if (selector !== null && selector !== undefined) source.selector = selector;
  return finish(items, images, source, rep, limits);
}

function mapLwTable(b: J, p: string, guard: Guard, rep: Report, m: Mutations): J {
  if (["width", "align", "borders", "cellPadding"].some((k) => k in b)) rep.add("layout-not-preserved", p);
  let headerRows = 0;
  let leading = true;
  const rows: J[] = (b.rows ?? []).map((r: J, ri: number) => {
    const rp = `${p}/rows/${ri}`;
    if (r.header === true) {
      if (leading || m.allHeaderRows) headerRows++;
      else rep.add("header-rows-flattened", rp);
    } else leading = false;
    const cells = (r.cells ?? []).map((c: J, ci: number) => {
      const cp = `${rp}/cells/${ci}`;
      let styleDropped = ["shading", "borders", "padding", "valign"].some((k) => k in c);
      const texts: string[] = [];
      const runSets: J[][] = [];
      (c.blocks ?? []).forEach((blk: J, k: number) => {
        if (blk.type === "paragraph" || blk.type === "heading") {
          if (PARA_PROPS.some((x) => x in blk)) styleDropped = true;
          const runs = mapRuns(blk.runs, `${cp}/blocks/${k}/runs`, guard, rep, m);
          runSets.push(runs);
          texts.push(runs.map((x: J) => x.text).join(""));
        } else rep.add("nested-block", `${cp}/blocks/${k}`);
      });
      if (styleDropped) rep.add("cell-style-dropped", cp);
      const v = texts.join("\n");
      const cell: J = v === "" ? { t: "empty" } : { t: "string", v };
      const all = runSets.flatMap((rs, k) => (k === 0 ? rs : [{ text: "\n" }, ...rs]));
      if (v !== "" && (m.runsAlways || styled(all))) cell.runs = all;
      if ("colSpan" in c) cell.colSpan = c.colSpan;
      if ("rowSpan" in c) cell.rowSpan = c.rowSpan;
      return cell;
    });
    return { cells };
  });
  // pad short rows
  let maxW = 0;
  const perRow = rowWidths(rows);
  for (const w of perRow) maxW = Math.max(maxW, w);
  rows.forEach((r, i) => {
    for (let k = perRow[i]!; k < maxW; k++) r.cells.push({ t: "empty" });
  });
  const t: J = { type: "table", headerRows, rows };
  if (Array.isArray(b.widths)) {
    const sum = b.widths.reduce((x: number, y: number) => x + y, 0);
    t.columns = b.widths.map((w: number) => ({ width: w / sum }));
  }
  return t;
}

/** Occupied slots per row, spans considered (the grid width each row reaches). */
function rowWidths(rows: J[]): number[] {
  const covered = new Map<number, number>();
  return rows.map((r, ri) => {
    let w = covered.get(ri) ?? 0;
    for (const c of r.cells) {
      const cs = c.colSpan ?? 1;
      const rs = c.rowSpan ?? 1;
      w += cs;
      for (let d = 1; d < rs; d++) covered.set(ri + d, (covered.get(ri + d) ?? 0) + cs);
    }
    return w;
  });
}

// ---------------------------------------------------------------------------
// from dark-slide (SPEC 10.3)
// ---------------------------------------------------------------------------

const SPEC_STYLE = ["fill", "color", "underline", "align", "anchor", "fontSize", "letterSpacing", "caps", "fontFamily", "padding", "borders"];

function dsWidths(cols: J[]): number[] | null {
  const declared = cols.map((c) => (typeof c.width === "number" ? c.width : null));
  if (declared.every((w) => w === null)) return null;
  let ws: number[];
  if (declared.some((w) => w !== null && w > 1)) ws = declared.map((w) => w ?? 1);
  else {
    const sum = declared.reduce((a: number, w) => a + (w ?? 0), 0);
    const missing = declared.filter((w) => w === null).length;
    ws = declared.map((w) => w ?? (missing ? (1 - sum) / missing : 0));
  }
  const total = ws.reduce((a, b) => a + b, 0);
  return ws.map((w) => w / total);
}

export function fromDarkSlide(deck: J, selector: J, options: J = {}, m: Mutations = {}): J {
  const limits = resolveLimits(options?.limits ? { limits: options.limits } : undefined, {});
  const includeHidden = !!options?.includeHidden || !!m.readHidden;
  const guard = new Guard(m);
  const rep = new Report(guard);
  const slides: J[] = deck.slides ?? [];
  const no = (reason: string) => ({ ok: false, refused: { reason } });
  const items: J[] = [];
  const images: Record<string, J> = {};

  const mapElement = (e: J, p: string): void => {
    if (e.hidden === true && !includeHidden) {
      rep.add("hidden-element", p);
      return;
    }
    switch (e.type) {
      case "text":
        rep.add("layout-not-preserved", p);
        if (e.format !== "plain") rep.add("markup-as-text", p);
        if (e.style !== undefined) rep.add("run-style-dropped", p);
        for (const para of paragraphs(guard.strip(String(e.content ?? "")), m)) items.push(textItem(para));
        return;
      case "code":
        rep.add("layout-not-preserved", p);
        rep.add("code-as-text", p);
        items.push({ type: "text", role: "paragraph", runs: [{ text: guard.strip(String(e.code ?? "")), code: true }] });
        return;
      case "image": {
        const d = dataUri(e.src);
        if (!d) {
          if (!m.silentImages) rep.add("image", p);
          return;
        }
        rep.add("layout-not-preserved", p);
        const ref = `img${Object.keys(images).length + 1}`;
        images[ref] = d;
        const it: J = { type: "image", ref };
        if (typeof e.alt === "string") it.alt = guard.strip(e.alt);
        items.push(it);
        return;
      }
      case "table":
        rep.add("layout-not-preserved", p);
        items.push(mapDsTable(e, p, guard, rep, m));
        return;
      case "chart":
        rep.add("chart", p);
        return;
      case "shape":
        rep.add("shape", p);
        return;
      case "embed":
        rep.add("embedded-object", p);
        return;
      default:
        rep.add("composite-element", p);
    }
  };
  const mapSlide = (si: number, notes: boolean): void => {
    const s = slides[si];
    (s.elements ?? []).forEach((e: J, k: number) => mapElement(e, `/slides/${si}/elements/${k}`));
    if (notes && typeof s.notes === "string" && !m.noNotes) {
      const ps = paragraphs(guard.strip(s.notes), m);
      if (ps.length) rep.add("markup-as-text", `/slides/${si}/notes`);
      for (const para of ps) items.push(textItem(para));
    }
  };
  const visibleRange = (a: number, b: number): void => {
    for (let i = a; i <= b; i++) {
      if (slides[i].hidden === true && !includeHidden) rep.add("hidden-slide", `/slides/${i}`);
      else mapSlide(i, true);
    }
  };

  if (selector === null || selector === undefined) visibleRange(0, slides.length - 1);
  else if (!isObj(selector)) return no("selector_invalid");
  else if ("slides" in selector) {
    const r = selector.slides;
    if (!Array.isArray(r) || r.length !== 2 || !r.every((x: J) => isInt(x) && x >= 0) || r[0] > r[1]) return no("selector_invalid");
    if (r[1] >= slides.length) return no("selector_not_found");
    visibleRange(r[0], r[1]);
  } else if ("slide" in selector) {
    const i = selector.slide;
    if (!isInt(i) || i < 0) return no("selector_invalid");
    if (i >= slides.length) return no("selector_not_found");
    if (slides[i].hidden === true && !includeHidden) return no("selector_hidden");
    const els: J[] = slides[i].elements ?? [];
    if ("element" in selector) {
      const k = els.findIndex((e) => e.id === selector.element);
      if (k < 0) return no("selector_not_found");
      mapElement(els[k], `/slides/${i}/elements/${k}`);
    } else if ("table" in selector) {
      const tables = els.map((e, k) => [e, k] as const).filter(([e]) => e.type === "table");
      const hit = tables[selector.table];
      if (!hit) return no("selector_not_found");
      mapElement(hit[0], `/slides/${i}/elements/${hit[1]}`);
    } else mapSlide(i, true);
  } else return no("selector_invalid");

  const source: J = { package: "dark-slide" };
  if (selector !== null && selector !== undefined) source.selector = selector;
  return finish(items, images, source, rep, limits);
}

function mapDsTable(e: J, p: string, guard: Guard, rep: Report, m: Mutations): J {
  const cols: J[] = e.columns ?? [];
  const n = cols.length;
  const header = e.style?.header !== false;
  const rows: J[] = [];
  if (header) rows.push({ cells: cols.map((c) => ({ t: "string", v: guard.strip(String(c.label ?? c.key)) })) });
  const raw: J[] = e.rows ?? [];
  const covered = new Set<string>();
  raw.forEach((row: J, r: number) => {
    const inner = isObj(row) && isObj(row.cells) ? row.cells : row;
    const base = isObj(row) && isObj(row.cells) ? `${p}/rows/${r}/cells` : `${p}/rows/${r}`;
    const cells: J[] = [];
    cols.forEach((col, c) => {
      const key = Array.isArray(inner) ? c : col.key;
      const value = Array.isArray(inner) ? inner[c] : inner?.[col.key];
      const cp = `${base}/${esc(String(key))}`;
      if (covered.has(`${r}:${c}`) && !m.emitCovered) {
        if (value !== undefined && value !== null) rep.add("hidden-element", cp);
        return;
      }
      let cell: J;
      if (value === undefined || value === null) cell = { t: "empty" };
      else if (typeof value === "string") cell = { t: "string", v: guard.strip(value) };
      else if (typeof value === "number") cell = { t: "number", v: value };
      else if (typeof value === "boolean") cell = { t: "bool", v: value };
      else {
        const text = guard.strip(String(value.text ?? ""));
        cell = text === "" ? { t: "empty" } : { t: "string", v: text };
        if (text !== "" && (value.bold || value.italic)) {
          const run: J = { text };
          if (value.bold) run.bold = true;
          if (value.italic) run.italic = true;
          cell.runs = [run];
        }
        const cs = Math.min(isInt(value.colSpan) ? value.colSpan : 1, n - c);
        const rs = Math.min(isInt(value.rowSpan) ? value.rowSpan : 1, raw.length - r);
        if (cs > 1) cell.colSpan = cs;
        if (rs > 1) cell.rowSpan = rs;
        for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) if (dr || dc) covered.add(`${r + dr}:${c + dc}`);
        if (SPEC_STYLE.some((k) => k in value)) rep.add("cell-style-dropped", cp);
      }
      cells.push(cell);
    });
    rows.push({ cells });
  });
  const t: J = { type: "table", headerRows: header ? 1 : 0, rows };
  const ws = m.rawWidths ? (cols.some((c) => typeof c.width === "number") ? cols.map((c) => c.width ?? 0) : null) : dsWidths(cols);
  const aligns = cols.map((c) => (["left", "center", "right"].includes(c.align) ? c.align : undefined));
  if (ws || aligns.some(Boolean)) {
    t.columns = cols.map((_c, i) => {
      const o: J = {};
      if (ws) o.width = ws[i];
      if (aligns[i]) o.align = aligns[i];
      return o;
    });
  }
  return t;
}

// ---------------------------------------------------------------------------
// from fine-print (SPEC 10.4)
// ---------------------------------------------------------------------------

export function fromFinePrint(read: J, selector: J, options: J = {}, m: Mutations = {}): J {
  const limits = resolveLimits(options?.limits ? { limits: options.limits } : undefined, {});
  if (read.ok === false) return { ok: false, refused: { reason: "source_refused", cause: read.refused?.reason } };
  if (read.guard?.discarded === true) return { ok: false, refused: { reason: "source_discarded" } };
  const guard = new Guard(m);
  const rep = new Report(guard);
  const pages: J[] = read.pages ?? [];
  let a = 1;
  let b = pages.length;
  if (selector !== null && selector !== undefined) {
    const r = isObj(selector) ? selector.pages : null;
    const lo = m.zeroBasedPages ? 0 : 1;
    if (!Array.isArray(r) || r.length !== 2 || !r.every((x: J) => isInt(x) && x >= lo) || r[0] > r[1]) return { ok: false, refused: { reason: "selector_invalid" } };
    [a, b] = m.zeroBasedPages ? [r[0] + 1, r[1] + 1] : [r[0], r[1]];
    if (b > pages.length) return { ok: false, refused: { reason: "selector_not_found" } };
  }
  for (const f of read.guard?.findings ?? []) {
    if (m.excerptFindings) guard.add(`${f.rule}:${f.excerpt ?? ""}`, 1);
    else guard.add(f.rule, 1);
  }
  const items: J[] = [];
  for (let n = a; n <= b; n++) {
    const i = n - 1;
    rep.add("structure-not-recovered", `/pages/${i}`);
    const text = m.noOwnStrip ? String(pages[i].text ?? "") : guard.strip(String(pages[i].text ?? ""));
    for (const para of paragraphs(text, m)) items.push(textItem(para));
  }
  const source: J = { package: "fine-print" };
  if (selector !== null && selector !== undefined) source.selector = selector;
  return finish(items, {}, source, rep, limits);
}

// ---------------------------------------------------------------------------
// into writers (SPEC 11)
// ---------------------------------------------------------------------------

function validated(content: J): J | null {
  const v = validateContent(content, undefined);
  return v.ok ? null : { ok: false, refused: { reason: v.code, path: v.path } };
}

const typedCell = (c: J): boolean => c.t !== "string" && c.t !== "empty";

export function toDoc(content: J, m: Mutations = {}): J {
  const bad = validated(content);
  if (bad) return bad;
  const rep = new Report(new Guard({}));
  const blocks: J[] = [];
  content.items.forEach((it: J, i: number) => {
    const p = `/items/${i}`;
    if (it.type === "text") {
      blocks.push(it.role === "heading" ? { type: "heading", level: it.level, runs: it.runs } : { type: "paragraph", runs: it.runs });
    } else if (it.type === "list") {
      const mapItem = (x: J): J => {
        const o: J = { runs: x.runs };
        if (x.children) o.children = x.children.map(mapItem);
        return o;
      };
      blocks.push({ type: "list", ordered: it.ordered ?? false, items: it.items.map(mapItem) });
    } else if (it.type === "image") {
      const img = content.images[it.ref];
      const o: J = { type: "image", src: `data:${img.mime};base64,${img.data}` };
      for (const k of ["alt", "widthPx", "heightPx"]) if (k in it) o[k] = it[k];
      blocks.push(o);
    } else {
      if (it.caption !== undefined) blocks.push({ type: "paragraph", runs: [{ text: it.caption }] });
      const g = layout(it.rows);
      const hr = it.headerRows ?? 0;
      const numeric: boolean[] = [];
      for (let c = 0; c < g.width; c++) {
        const body = it.rows.flatMap((r: J, ri: number) =>
          ri < hr ? [] : r.cells.filter((_x: J, ci: number) => g.anchors[ri]![ci]![1] === c),
        ).filter((x: J) => x.t !== "empty");
        numeric.push(!m.noNumericAlign && body.length > 0 && body.every((x: J) => x.t === "number"));
      }
      const rows = it.rows.map((r: J, ri: number) => {
        const cells = r.cells.map((cell: J, ci: number) => {
          const cp = `${p}/rows/${ri}/cells/${ci}`;
          if (cell.formula !== undefined) rep.add("formula-as-value", cp);
          if (typedCell(cell)) rep.add("typed-as-text", cp);
          const shown = displayOf(cell);
          const runs = cell.runs ?? (shown !== "" ? [{ text: shown }] : []);
          const para: J = { type: "paragraph", runs };
          const col = g.anchors[ri]![ci]![1];
          const align = cell.align ?? (numeric[col] && !(m.headerExcludedFromAlign && ri < hr) ? "right" : undefined);
          if (align) para.align = align;
          const o: J = { blocks: [para] };
          if (cell.colSpan !== undefined) o.colSpan = cell.colSpan;
          if (cell.rowSpan !== undefined) o.rowSpan = cell.rowSpan;
          return o;
        });
        return ri < hr ? { header: true, cells } : { cells };
      });
      const t: J = { type: "table", rows };
      if (it.columns && (m.widthsPartial ? it.columns.some((c: J) => c.width !== undefined) : it.columns.every((c: J) => c.width !== undefined))) {
        t.widths = it.columns.map((c: J) => c.width ?? 1);
      }
      blocks.push(t);
    }
  });
  return { ok: true, blocks, report: rep.build() };
}

const DISPLAY_FORMAT: Record<string, string> = { number: "number", currency: "currency", percent: "percentage", date: "date", datetime: "datetime", text: "text" };

export function toHolySheet(input: J, m: Mutations = {}): J {
  const content = input.content;
  const bad = validated(content);
  if (bad) return bad;
  const rep = new Report(new Guard({}));
  const at = parseCell(input.at);
  const col0 = m.noOffset ? 1 : at.column;
  let row = m.noOffset ? 1 : at.row;
  const cells: Record<string, J> = {};
  const merged: J[] = [];
  const widths: Record<string, number> = {};
  let first = true;
  content.items.forEach((it: J, i: number) => {
    const p = `/items/${i}`;
    if (it.type !== "table") {
      rep.add("non-table-item", p);
      return;
    }
    if (!first) row += 1;
    first = false;
    if (it.caption !== undefined) {
      cells[addr(col0, row)] = { value: it.caption };
      row++;
    }
    const g = layout(it.rows);
    it.rows.forEach((r: J, ri: number) => {
      r.cells.forEach((cell: J, ci: number) => {
        const cp = `${p}/rows/${ri}/cells/${ci}`;
        const [ar, ac] = g.anchors[ri]![ci]!;
        const a = addr(col0 + ac, row + ar);
        if (cell.formula !== undefined) {
          rep.add("formula-as-value", cp);
          if (m.writeFormula) {
            cells[a] = { formula: cell.formula };
            return;
          }
        }
        if (cell.runs && styled(cell.runs)) rep.add("run-style-dropped", cp);
        if ((cell.colSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1) {
          merged.push({ start: a, end: addr(col0 + ac + (cell.colSpan ?? 1) - 1, row + ar + (cell.rowSpan ?? 1) - 1) });
        }
        if (cell.t === "empty") return;
        let out: J;
        if (cell.t === "string") out = m.promoteEquals && cell.v.startsWith("=") ? { formula: cell.v.slice(1) } : { value: cell.v };
        else if (cell.t === "error") {
          rep.add("typed-as-text", cp);
          out = { value: cell.v };
        } else out = { value: cell.v };
        const fmt: J = {};
        if (cell.t === "number" && cell.format) {
          fmt.displayFormat = DISPLAY_FORMAT[cell.format.kind];
          if (cell.format.decimals !== undefined) fmt.decimals = cell.format.decimals;
          if (cell.format.currency !== undefined) fmt.currency = cell.format.currency;
        }
        if (cell.t === "date" || cell.t === "datetime") {
          const k = cell.format?.kind;
          fmt.displayFormat = k === "date" || k === "datetime" ? k : cell.t;
        }
        if (cell.align) fmt.textAlign = cell.align;
        if (Object.keys(fmt).length) out.format = fmt;
        cells[a] = out;
      });
    });
    if (it.columns && it.columns.every((c: J) => c.width !== undefined)) {
      const sum = it.columns.reduce((x: number, c: J) => x + c.width, 0);
      it.columns.forEach((c: J, j: number) => {
        widths[String(col0 - 1 + j)] = Math.floor((c.width / sum) * 64 * it.columns.length + 0.5);
      });
    }
    row += it.rows.length;
  });
  const sheet: J = { cells };
  if (merged.length) sheet.mergedRegions = merged;
  if (Object.keys(widths).length) sheet.columnWidths = widths;
  return { ok: true, sheet, report: rep.build() };
}

export function toDarkSlide(input: J, m: Mutations = {}): J {
  const el = input.element;
  const content = el.content;
  const bad = validated(content);
  if (bad) return bad;
  const rep = new Report(new Guard({}));
  const n = content.items.length;
  const elements: J[] = [];
  content.items.forEach((it: J, i: number) => {
    const p = `/items/${i}`;
    const h = el.h / n;
    const y = m.multiplyFirst ? el.y + (i * el.h) / n : el.y + i * (el.h / n);
    const base: J = { id: `${el.id}-${i}`, x: el.x, y, w: el.w, h };
    if (it.type === "image") {
      const img = content.images[it.ref];
      const o: J = { ...base, type: "image", src: m.refSrc ? it.ref : `data:${img.mime};base64,${img.data}`, fit: "contain" };
      if (it.alt !== undefined) o.alt = it.alt;
      elements.push(o);
      return;
    }
    if (it.type === "text") {
      if (styled(it.runs)) rep.add("run-style-dropped", p);
      elements.push({ ...base, type: "text", format: "plain", content: it.runs.map((r: J) => r.text).join("") });
      return;
    }
    if (it.type === "list") {
      const lines: string[] = [];
      const walk = (xs: J[], depth: number) => {
        xs.forEach((x, k) => {
          if (styled(x.runs)) rep.add("run-style-dropped", p);
          lines.push("  ".repeat(depth) + (it.ordered ? `${k + 1}. ` : "- ") + x.runs.map((r: J) => r.text).join(""));
          if (x.children) walk(x.children, depth + 1);
        });
      };
      walk(it.items, 0);
      rep.add("layout-not-preserved", p);
      elements.push({ ...base, type: "text", format: "plain", content: lines.join("\n") });
      return;
    }
    const g = layout(it.rows);
    const hr = it.headerRows ?? 0;
    const keys = Array.from({ length: g.width }, (_x, k) => `col${k + 1}`);
    const labels = keys.map(() => "");
    if (hr > 0) {
      it.rows[0].cells.forEach((cell: J, ci: number) => {
        const c = g.anchors[0]![ci]![1];
        const cp = `${p}/rows/0/cells/${ci}`;
        labels[c] = displayOf(cell);
        if ((cell.colSpan ?? 1) > 1) {
          rep.add("merge-flattened", cp);
          if (m.repeatSpanLabel) for (let d = 1; d < cell.colSpan; d++) labels[c + d] = displayOf(cell);
        }
        if (typedCell(cell)) rep.add("typed-as-text", cp);
        if (cell.runs && styled(cell.runs)) rep.add("run-style-dropped", cp);
      });
    }
    const columns = keys.map((key, k) => {
      const o: J = { key, label: labels[k] };
      const cdef = it.columns?.[k];
      if (it.columns && it.columns.every((c: J) => c.width !== undefined)) o.width = cdef.width;
      if (cdef?.align) o.align = cdef.align;
      return o;
    });
    const rows: J[] = [];
    it.rows.forEach((r: J, ri: number) => {
      if (ri === 0 && hr > 0) return;
      if (ri > 0 && ri < hr) rep.add("header-rows-flattened", `${p}/rows/${ri}`);
      const out: J = {};
      r.cells.forEach((cell: J, ci: number) => {
        const cp = `${p}/rows/${ri}/cells/${ci}`;
        const c = g.anchors[ri]![ci]![1];
        if (typedCell(cell)) rep.add("typed-as-text", cp);
        if (cell.runs && styled(cell.runs)) rep.add("run-style-dropped", cp);
        if (cell.t === "empty") return;
        const text = displayOf(cell);
        const bold = ri < hr;
        const spanned = (cell.colSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1;
        if (spanned || bold) {
          const spec: J = { text };
          if ((cell.colSpan ?? 1) > 1) spec.colSpan = cell.colSpan;
          if ((cell.rowSpan ?? 1) > 1) spec.rowSpan = cell.rowSpan;
          if (bold) spec.bold = true;
          out[keys[c]!] = spec;
        } else out[keys[c]!] = text;
      });
      rows.push(out);
    });
    // Rows drawn: the header (when there is one) plus the body, i.e. every portable row.
    const total = it.rows.length;
    const cap = Math.floor(h * 20 + (m.noEpsilon ? 0 : 1e-9));
    if (total > cap) rep.add("table-clipped", p, total - cap);
    const o: J = { ...base, type: "table", columns, rows };
    if (hr === 0 && !m.keepHeaderOnZero) o.style = { header: false };
    elements.push(o);
  });
  return { ok: true, elements, report: rep.build() };
}

// ---------------------------------------------------------------------------
// export policy (SPEC 13)
// ---------------------------------------------------------------------------

export const TARGETS = ["csv", "markdown", "text", "html", "outline", "xlsx", "docx", "pptx", "pdf", "ods", "odt"];
export const SUPPORTED: Record<string, string[]> = {
  "holy-sheet": ["csv", "markdown", "xlsx", "pdf", "docx"],
  "last-word": ["markdown", "text", "html", "docx", "pdf"],
  "dark-slide": ["markdown", "outline", "text", "pptx", "pdf"],
  "fine-print": ["text", "markdown"],
};

function checkPolicy(policy: J, options: J, m: Mutations): string[] {
  if (options !== undefined && options !== null) {
    if (!isObj(options)) throw new OptionsInvalid();
    for (const k of Object.keys(options)) {
      if (k === "allow" && m.agentAllow) continue;
      if (!["selector", "headerRows", "display"].includes(k)) throw new OptionsInvalid();
    }
  }
  if (policy === null || policy === undefined) return m.agentAllow && Array.isArray(options?.allow) ? options.allow : [];
  if (!isObj(policy)) throw new OptionsInvalid();
  for (const k of Object.keys(policy)) if (!["allow", "limits", "pdf", "csv", "includeHidden", "modules"].includes(k)) throw new OptionsInvalid();
  const allow = policy.allow ?? [];
  if (!Array.isArray(allow) || !allow.every((t: J) => TARGETS.includes(t))) throw new OptionsInvalid();
  return allow;
}

function needs(reader: string, target: string): string | null {
  if (target === "pdf") return "fine-print";
  if (reader === "holy-sheet" && target === "docx") return "last-word";
  return null;
}

function available(module: string, policy: J, env: J, m: Mutations): boolean {
  const injected = m.ignoreInjected ? undefined : policy?.modules?.[module];
  return injected ?? env?.[module] ?? false;
}

export function checkExport(req: J, m: Mutations = {}): J {
  const allow = checkPolicy(req.policy, req.options, m);
  const target = req.target;
  const no = (reason: string, extra: J = {}) => ({ ok: false, refused: { reason, target, ...extra } });
  const steps: Array<() => J | null> = [
    () => (SUPPORTED[req.reader]!.includes(target) ? null : no("export_unsupported")),
    () => (allow.includes(target) ? null : no("export_disabled")),
  ];
  if (m.disabledFirst) steps.reverse();
  for (const s of steps) {
    const r = s();
    if (r) return r;
  }
  const need = needs(req.reader, target);
  const unavailable = need && !available(need, req.policy, req.environment, m) ? no("export_unavailable", { missing: need }) : null;
  const refusedInput = req.inputRefused ? no("export_refused", { cause: req.inputRefused }) : null;
  if (m.refusedFirst) {
    if (refusedInput) return refusedInput;
    if (unavailable) return unavailable;
  } else {
    if (unavailable) return unavailable;
    if (refusedInput) return refusedInput;
  }
  if (req.limitCode) return no(req.limitCode);
  return { ok: true };
}

export function enabledTargets(req: J, m: Mutations = {}): string[] {
  const allow = checkPolicy(req.policy, undefined, m);
  return SUPPORTED[req.reader]!.filter((t) => {
    if (!allow.includes(t)) return false;
    const need = needs(req.reader, t);
    return m.showUnavailable || !need || available(need, req.policy, req.environment, m);
  });
}

// ---------------------------------------------------------------------------
// CSV (SPEC 12)
// ---------------------------------------------------------------------------

export function toCsv(table: J, options: J = {}, m: Mutations = {}): J {
  const rep = new Report(new Guard({}));
  const escape = options?.escapeFormulas !== false && !m.noEscape;
  const showDisplay = options?.display === true || !!m.displayDefault;
  const g = layout(table.rows);
  const grid: string[][] = table.rows.map(() => Array.from({ length: g.width }, () => ""));
  table.rows.forEach((r: J, ri: number) => {
    r.cells.forEach((cell: J, ci: number) => {
      const cp = `/rows/${ri}/cells/${ci}`;
      const [ar, ac] = g.anchors[ri]![ci]!;
      if ((cell.colSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1) rep.add("merge-flattened", cp);
      let f = showDisplay ? displayOf(cell.format && !cell.text ? { ...cell, text: display(cell.t, cell.v, cell.format) } : cell) : canonical(cell.t, cell.v);
      const escapable = m.escapeNumbers ? cell.t !== "empty" : cell.t === "string" || cell.t === "error";
      const lead = m.quoteThenEscape ? null : f[0];
      if (escape && escapable && lead !== null && lead !== undefined && "=+-@\t\r".includes(lead)) {
        f = "'" + f;
        rep.add("csv-escaped", cp);
      }
      if (/[",\r\n]/.test(f)) f = '"' + f.replace(/"/g, '""') + '"';
      if (m.quoteThenEscape && escape && escapable && "=+-@\t\r".includes(f[0] ?? "")) {
        f = "'" + f;
        rep.add("csv-escaped", cp);
      }
      grid[ar]![ac] = f;
    });
  });
  const eol = m.lfRecords ? "\n" : "\r\n";
  return { text: grid.map((r) => r.join(",") + eol).join(""), report: rep.build() };
}

// ---------------------------------------------------------------------------
// doc-model/shared (SPEC 15) -- the two schemas as data, target state
// ---------------------------------------------------------------------------

const PROPS = ["align", "spaceBefore", "spaceAfter", "lineHeight", "indentLeft", "indentRight", "keepNext", "shading", "borders"];
const BASE_DEFS: Record<string, string[]> = {
  document: ["title", "blocks", "page", "defaultFont", "defaultSize"],
  page: ["size", "orientation", "margins", "header", "footer", "background", "border"],
  pageBorder: ["style", "width", "color", "inset"],
  band: ["left", "center", "right", "size", "color"],
  blockTypes: ["heading", "paragraph", "list", "table", "code", "quote", "image", "pageBreak", "hr"],
  run: ["text", "bold", "italic", "underline", "strike", "code", "smallCaps", "link", "color", "highlight", "size", "font", "letterSpacing"],
  paragraph: ["type", "runs", ...PROPS],
  heading: ["type", "level", "runs", ...PROPS],
  listItem: ["runs", "children", ...PROPS],
  table: ["type", "widths", "width", "align", "borders", "cellPadding", "rows"],
  tableRow: ["header", "cells"],
  tableCell: ["blocks", "shading", "borders", "padding", "valign", "colSpan", "rowSpan"],
  image: ["type", "src", "widthPx", "heightPx", "alt"],
  border: ["style", "width", "color"],
};
const SIZE_LW = { type: "number", exclusiveMinimum: 0 };
const BASE_CONSTRAINTS = {
  lastWord: {
    "run.link": { type: "string" },
    "run.size": SIZE_LW,
    defaultSize: SIZE_LW,
    "band.size": SIZE_LW,
    "image.src": { type: "string", pattern: "^data:image/(png|jpe?g);base64," },
    "page.size": { enum: ["letter", "legal", "a4"] },
  } as Record<string, J>,
  finePrint: {
    "run.link": { type: "string", pattern: "^(https?://|mailto:)" },
    "run.size": { type: "number", minimum: 1, maximum: 400 },
    defaultSize: { type: "number", minimum: 1, maximum: 400 },
    "band.size": { type: "number", minimum: 1 },
    "image.src": { type: "string", pattern: "^data:image/(png|jpe?g);base64," },
    "page.size": { enum: ["letter", "legal", "a4"] },
  } as Record<string, J>,
};

function schemas(m: Mutations): { lw: Record<string, string[]>; fp: Record<string, string[]> } {
  const lw = structuredClone(BASE_DEFS);
  const fp = structuredClone(BASE_DEFS);
  lw.blockTypes!.push("chart");
  if (m.lastWordToday) {
    lw.page = lw.page!.filter((k) => k !== "background" && k !== "border");
    lw.pageBorder = [];
  }
  if (m.finePrintChart) fp.blockTypes!.push("chart");
  return { lw, fp };
}

export function docModelCompare(def: string, m: Mutations = {}): J {
  const { lw, fp } = schemas(m);
  const a = new Set(lw[def] ?? []);
  const b = new Set(fp[def] ?? []);
  return {
    both: [...a].filter((x) => b.has(x)).sort(cu),
    lastWordOnly: [...a].filter((x) => !b.has(x)).sort(cu),
    finePrintOnly: [...b].filter((x) => !a.has(x)).sort(cu),
  };
}

export function docModelConstraint(def: string, m: Mutations = {}): J {
  const c = structuredClone(BASE_CONSTRAINTS);
  if (m.linkConverged) c.lastWord["run.link"] = c.finePrint["run.link"];
  if (m.sizeConverged) c.finePrint["run.size"] = c.lastWord["run.size"];
  return { lastWord: c.lastWord[def], finePrint: c.finePrint[def] };
}

// ---------------------------------------------------------------------------
// one runner per suite: case -> the value its row expects
// ---------------------------------------------------------------------------

function throwsAsValue(fn: () => J): J {
  try {
    return fn();
  } catch (e) {
    if (e instanceof OptionsInvalid) return { throws: "options_invalid" };
    throw e;
  }
}

export const RUNNERS: Record<string, (c: { fn?: string; input: J }, m: Mutations) => J> = {
  "exchange/content": (c, m) => throwsAsValue(() => validateContent(c.input.content, c.input.options, m)),
  "exchange/limits": (c, m) =>
    c.fn === "truncateCell"
      ? truncateCell(c.input.text, c.input.maxBytes, m)
      : throwsAsValue(() => validateContent(c.input.content, c.input.options, m)),
  "exchange/range": (c, m) =>
    c.fn === "parseCell" ? parseCell(c.input.ref, m)
    : c.fn === "parseSelector" ? parseSelector(c.input.selector, c.input.options, m)
    : headerRowsFor(c.input, m),
  "exchange/number-display": (c, m) => display(c.input.t, c.input.v, c.input.format, m),
  "exchange/from-holy-sheet": (c, m) => fromHolySheet(c.input.model, c.input.selector, c.input.options, m),
  "exchange/from-last-word": (c, m) => fromLastWord(c.input.model, c.input.selector, c.input.options, m),
  "exchange/from-dark-slide": (c, m) => fromDarkSlide(c.input.model, c.input.selector, c.input.options, m),
  "exchange/from-fine-print": (c, m) => fromFinePrint(c.input.model, c.input.selector, c.input.options, m),
  "exchange/to-last-word": (c, m) => toDoc(c.input.content, m),
  "exchange/to-fine-print": (c, m) => toDoc(c.input.content, m),
  "exchange/to-holy-sheet": (c, m) => toHolySheet(c.input, m),
  "exchange/to-dark-slide": (c, m) => toDarkSlide(c.input, m),
  "exchange/report-kinds": (c, m) => (c.fn === "classifyKind" ? classifyKind(c.input.kind, m) : mergeReports(c.input.a, c.input.b, m)),
  "exchange/policy": (c, m) => throwsAsValue(() => (c.fn === "checkExport" ? checkExport(c.input, m) : enabledTargets(c.input, m))),
  "exchange/csv": (c, m) => toCsv(c.input.table, c.input.options, m),
  "doc-model/shared": (c, m) => (c.fn === "compare" ? docModelCompare(c.input.def, m) : docModelConstraint(c.input.def, m)),
};
