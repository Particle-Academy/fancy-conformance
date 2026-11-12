/**
 * A compact, deliberately mutable reading of suites/http/SPEC.md.
 *
 * NOT the reference, and not exported from the package. The shipped
 * implementations are @particle-academy/fancy-http-errors,
 * particle-academy/fancy-http-guard and fancy-http-guard (Python). This exists
 * so tests/discrimination-http.test.ts can show the rows are satisfiable (the
 * control passes every one it can run) and that they discriminate (each
 * mutation, a mistake a competent port author would plausibly make, fails an
 * exact set of ids).
 *
 * The `workbook` rows need holy-sheet and are not run here.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;
export type Mutations = Record<string, boolean | undefined>;

export const GEN = "$generated";
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
const RID = /^[A-Za-z0-9._:-]{1,128}$/;

const isObj = (x: J): x is Record<string, J> => typeof x === "object" && x !== null && !Array.isArray(x);

// ---------------------------------------------------------------------------
// section 2: sentences
// ---------------------------------------------------------------------------

export function count(n: number): string {
  const s = String(Math.trunc(n));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return out;
}

export function formatBytes(n: number, m: Mutations = {}): string {
  if (n < 1024) return n === 1 ? "1 byte" : `${count(n)} bytes`;
  const units: Array<[number, string]> = [
    [1024 ** 3, "GB"],
    [1024 ** 2, "MB"],
    [1024, "KB"],
  ];
  const [u, name] = units.find(([size]) => size <= n)!;
  let tenths: number;
  if (m.halfEven) {
    const exact = (n * 10) / u;
    const f = Math.floor(exact);
    const diff = exact - f;
    tenths = diff > 0.5 ? f + 1 : diff < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  } else {
    tenths = Math.floor((n * 10 + Math.floor(u / 2)) / u);
  }
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return `${count(whole)}${frac ? `.${frac}` : ""} ${name}`;
}

export function formatDuration(s: number, m: Mutations = {}): string {
  if (s <= 0) return "Try again now.";
  const round = m.retryRoundsDown ? Math.floor : Math.ceil;
  const unit = (n: number, one: string) => `${count(n)} ${one}${n === 1 ? "" : "s"}`;
  if (s < 60) return `Try again in ${unit(s, "second")}.`;
  if (s < 3600) return `Try again in ${unit(round(s / 60), "minute")}.`;
  return `Try again in ${unit(round(s / 3600), "hour")}.`;
}

export function sanitise(text: string, max = 300, m: Mutations = {}): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    out += cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) ? " " : ch;
  }
  out = out.replace(/ {2,}/g, " ");
  let a = 0;
  let b = out.length;
  while (a < b && out[a] === " ") a++;
  while (b > a && out[b - 1] === " ") b--;
  out = out.slice(a, b);
  if (m.utf16Cap) return out.length > max ? out.slice(0, max - 1) + "…" : out;
  const cps = Array.from(out);
  return cps.length > max ? cps.slice(0, max - 1).join("") + "…" : out;
}

const STATUS: Record<number, [string, string]> = {
  0: ["network_error", "We could not reach the server. Check your connection and try again."],
  400: ["bad_request", "The request could not be understood."],
  401: ["unauthenticated", "Please sign in to continue."],
  403: ["forbidden", "You do not have permission to do that."],
  404: ["not_found", "That could not be found."],
  405: ["method_not_allowed", "That action is not allowed here."],
  408: ["request_timeout", "The request took too long. Please try again."],
  409: ["conflict", "This conflicts with a change made elsewhere. Reload and try again."],
  410: ["gone", "This is no longer available."],
  413: ["body_too_large", "This request is too large for the server."],
  415: ["unsupported_media_type", "That type of content is not accepted here."],
  422: ["validation_failed", "Some fields need attention."],
  429: ["rate_limited", "Too many requests."],
  500: ["server_error", "Something went wrong on our side."],
  502: ["upstream_error", "A service this depends on did not respond."],
  503: ["unavailable", "The service is unavailable right now."],
  504: ["upstream_error", "A service this depends on did not respond."],
};

export function statusEntry(status: number): [string, string] {
  if (STATUS[status]) return STATUS[status]!;
  if (status >= 500) return STATUS[500]!;
  return ["client_error", "The request could not be completed."];
}

export function serverSentence(status: number, retryAfter: number | null, requestId: string | null, m: Mutations = {}): string {
  let s = statusEntry(status)[1];
  if (retryAfter !== null) s += " " + formatDuration(retryAfter, m);
  if (requestId !== null && status !== 0) s += ` If it keeps happening, quote reference ${requestId}.`;
  return s;
}

export function rateLimited(retryAfter: number | null, m: Mutations = {}): string {
  return "Too many requests. " + (retryAfter === null ? "Try again shortly." : formatDuration(retryAfter, m));
}

const isInt = (x: J): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;

function wellFormedLimit(l: J): boolean {
  return isObj(l) && typeof l.name === "string" && isInt(l.max) && (l.actual === undefined || isInt(l.actual));
}

export function bodyTooLarge(limit: J, m: Mutations = {}): string {
  return limit.actual === undefined
    ? `This request is over this endpoint's limit of ${formatBytes(limit.max, m)}.`
    : `This request is ${formatBytes(limit.actual, m)}, over this endpoint's limit of ${formatBytes(limit.max, m)}.`;
}

export function workbookTooLarge(limit: J, m: Mutations = {}): string {
  const { name, max, actual } = limit;
  if (name === "maxCompressionRatio") return "This spreadsheet is compressed too tightly to open safely.";
  if (actual === undefined) return "This spreadsheet is too large to open here.";
  const c = count;
  const b = (n: number) => formatBytes(n, m);
  switch (name) {
    case "maxRows":
      return `This spreadsheet has ${c(actual)} rows, over the limit of ${c(max)}.`;
    case "maxColumns":
      return `This spreadsheet has ${c(actual)} columns, over the limit of ${c(max)}.`;
    case "maxCells":
      return `This spreadsheet has at least ${c(actual)} cells, over the limit of ${c(max)}.`;
    case "maxSharedStrings":
      return `This spreadsheet has ${c(actual)} shared strings, over the limit of ${c(max)}.`;
    case "maxEntries":
      return `This spreadsheet has ${c(actual)} parts, over the limit of ${c(max)}.`;
    case "maxArchiveBytes":
      return `This spreadsheet is ${b(actual)}, over the limit of ${b(max)}.`;
    case "maxPartBytes":
    case "maxExpandedBytes":
      return `This spreadsheet needs at least ${b(actual)} to open, over the limit of ${b(max)}.`;
    default:
      return "This spreadsheet is too large to open here.";
  }
}

// ---------------------------------------------------------------------------
// section 6: the normaliser
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IMF = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([0-9]{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/;

function header(headers: Record<string, string>, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers ?? {})) if (k.toLowerCase() === name) return v;
  return undefined;
}

function wellFormedStrings(v: J, maxDepth: number): boolean {
  const stack: Array<[J, number]> = [[v, 1]];
  while (stack.length) {
    const [x, d] = stack.pop()!;
    if (typeof x === "string") {
      if (!x.isWellFormed()) return false;
      continue;
    }
    if (typeof x !== "object" || x === null) continue;
    if (d > maxDepth) return false;
    if (Array.isArray(x)) for (const e of x) stack.push([e, d + 1]);
    else
      for (const [k, e] of Object.entries(x)) {
        if (!k.isWellFormed()) return false;
        stack.push([e, d + 1]);
      }
  }
  return true;
}

function readBody(body: string | null): Record<string, J> | null {
  if (body === null || body === "") return null;
  if (new TextEncoder().encode(body).length > 65536) return null;
  let v: J;
  try {
    v = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  if (!wellFormedStrings(v, 64)) return null;
  return v;
}

export function normalise(input: J, m: Mutations = {}): J {
  const status: number = input.status;
  if (status >= 100 && status < 400) return null;
  const headers: Record<string, string> = input.headers ?? {};
  const b = readBody(input.body ?? null);

  let requestId: string | null = null;
  const hid = header(headers, "x-request-id");
  if (hid !== undefined && RID.test(hid)) requestId = hid;
  else if (b && typeof b.requestId === "string" && RID.test(b.requestId)) requestId = b.requestId;

  let retryAfter: number | null = null;
  const ra = header(headers, "retry-after");
  if (ra !== undefined) {
    const t = ra.trim();
    if (/^[0-9]{1,10}$/.test(t)) retryAfter = Number(t);
    else {
      const d = IMF.exec(t);
      if (d && typeof input.now === "string") {
        const at = Date.UTC(Number(d[4]), MONTHS.indexOf(d[3]!), Number(d[2]), Number(d[5]), Number(d[6]), Number(d[7]));
        retryAfter = Math.max(0, Math.ceil((at - Date.parse(input.now)) / 1000));
      }
    }
  }
  if (retryAfter === null && b && isInt(b.retryAfter) && b.retryAfter <= 2147483647) retryAfter = b.retryAfter;

  let code = statusEntry(status)[0];
  let serverMessage: string | null = null;
  let items = 0;
  const fields: Record<string, string> = {};
  const put = (f: string, msg: string) => {
    if (Object.prototype.hasOwnProperty.call(fields, f)) return;
    if (m.assignsFields) fields[f] = sanitise(msg, 300, m);
    else Object.defineProperty(fields, f, { value: sanitise(msg, 300, m), enumerable: true, writable: true, configurable: true });
  };
  let limit: J;

  if (b && typeof b.error === "string" && CODE.test(b.error) && typeof b.message === "string") {
    code = b.error;
    serverMessage = b.message;
    limit = b.limit;
    if (Array.isArray(b.errors)) {
      for (const it of b.errors) {
        if (!isObj(it) || typeof it.message !== "string") continue;
        items++;
        if (typeof it.field === "string") put(it.field, it.message);
      }
    }
    if (typeof b.field === "string") put(b.field, b.message);
  } else if (
    b &&
    Array.isArray(b.detail) &&
    b.detail.length > 0 &&
    b.detail.every((d: J) => isObj(d) && Array.isArray(d.loc) && typeof d.msg === "string")
  ) {
    if (status >= 400 && status < 500) code = "validation_failed";
    for (const d of b.detail) {
      items++;
      const loc = [...d.loc];
      if (["body", "query", "path", "header", "cookie"].includes(loc[0])) loc.shift();
      const path = loc.map(String).join(".");
      if (path !== "") put(path, d.msg);
    }
  } else if (b && typeof b.detail === "string") {
    serverMessage = b.detail;
  } else if (b && isObj(b.errors) && Object.values(b.errors).every((v) => typeof v === "string" || Array.isArray(v))) {
    if (status >= 400 && status < 500) code = "validation_failed";
    for (const [f, v] of Object.entries(b.errors)) {
      const first = typeof v === "string" ? v : (v as J[]).find((x) => typeof x === "string");
      if (typeof first === "string") {
        items++;
        put(f, first);
      }
    }
    if (typeof b.message === "string") serverMessage = b.message;
  } else if (b && typeof b.message === "string") {
    serverMessage = b.message;
  }

  let sentence: string;
  if (status === 0 || status >= 500) {
    const msg = m.echo5xx && serverMessage ? sanitise(serverMessage, 300, m) : "";
    sentence = msg || serverSentence(status, retryAfter, requestId, m);
  } else if (code === "validation_failed" && items > 0) {
    if (items === 1) {
      const only = Object.values(fields)[0];
      sentence = only ?? sanitise(firstItemMessage(b) ?? "", 300, m);
    } else sentence = `${items} fields need attention.`;
  } else if (code === "rate_limited" || status === 429) {
    sentence = rateLimited(retryAfter, m);
  } else if (code === "body_too_large" && wellFormedLimit(limit)) {
    sentence = bodyTooLarge(limit, m);
  } else if (code === "workbook_too_large" && wellFormedLimit(limit)) {
    sentence = workbookTooLarge(limit, m);
  } else {
    const s = serverMessage === null ? "" : sanitise(serverMessage, 300, m);
    sentence = s || statusEntry(status)[1];
  }

  const serverSide = status === 0 || status >= 500;
  return { status, code, sentence, fields: serverSide && !m.echo5xx ? {} : fields, retryAfter, requestId };
}

function firstItemMessage(b: J): string | null {
  if (b && Array.isArray(b.errors)) for (const it of b.errors) if (isObj(it) && typeof it.message === "string") return it.message;
  return null;
}

// ---------------------------------------------------------------------------
// section 3: the guard
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  maxBodyBytes: 1048576,
  maxDepth: 32,
  maxListLength: 10000,
  maxErrors: 20,
  finiteNumbers: true,
  workbook: { maxRows: 100000, maxColumns: 1000, maxCells: 100000 },
};

export function settings(limits: J = {}): typeof DEFAULTS {
  return { ...DEFAULTS, ...limits, workbook: { ...DEFAULTS.workbook, ...(limits.workbook ?? {}) } };
}

function requestId(headers: Record<string, string>, config: J, m: Mutations): [string, string] {
  const name = (config?.requestIdHeader ?? "x-request-id").toLowerCase();
  const inbound = header(headers, name);
  const trusted = m.trustInboundId || config?.trustIncomingRequestId === true;
  if (trusted && inbound !== undefined && (m.trustInboundId || RID.test(inbound))) return [name, inbound];
  return [name, GEN];
}

function envelope(status: number, body: J, ridName: string, extraHeaders: Record<string, string> = {}): J {
  return { status, headers: { "content-type": "application/json", [ridName]: body.requestId, ...extraHeaders }, body };
}

function v422(items: J[], rid: string, ridName: string): J {
  const message = items.length === 1 ? items[0].message : `${items.length} fields need attention.`;
  return envelope(422, { error: "validation_failed", message, errors: items, requestId: rid }, ridName);
}

const withField = (item: J, segs: string[]): J => (segs.length ? { ...item, field: segs.join(".") } : item);

type Scan = { fault: true } | { fault: false; items: J[] };

/** One pass, an explicit stack, no tree, no recursion. */
export function scan(text: string, lim: typeof DEFAULTS, m: Mutations = {}): Scan {
  const items: J[] = [];
  const n = text.length;
  let i = 0;
  const stack: Array<{ kind: "a" | "o"; count: number; segs: string[] }> = [];
  const ws = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };
  const FAULT: Scan = { fault: true };
  const stopped = (): Scan => ({ fault: false, items });

  const str = (): string | null => {
    // at the opening quote
    i++;
    let out = "";
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        i++;
        return out;
      }
      if (c < 0x20) return null;
      if (c === 92) {
        const e = text[i + 1];
        i += 2;
        if (e === undefined) return null;
        const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (e in simple) {
          out += simple[e];
          continue;
        }
        if (e !== "u") return null;
        const hex = text.slice(i, i + 4);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return null;
        i += 4;
        let cu = parseInt(hex, 16);
        if (cu >= 0xd800 && cu <= 0xdbff && text[i] === "\\" && text[i + 1] === "u") {
          const lo = text.slice(i + 2, i + 6);
          if (/^[0-9A-Fa-f]{4}$/.test(lo)) {
            const l = parseInt(lo, 16);
            if (l >= 0xdc00 && l <= 0xdfff) {
              i += 6;
              out += String.fromCodePoint(0x10000 + ((cu - 0xd800) << 10) + (l - 0xdc00));
              continue;
            }
          }
        }
        if (cu >= 0xd800 && cu <= 0xdfff) cu = 0xfffd;
        out += String.fromCharCode(cu);
        continue;
      }
      out += text[i];
      i++;
    }
    return null;
  };

  /** Returns false when the scan must stop. */
  const member = (f: { kind: "a" | "o"; count: number; segs: string[] }): boolean => {
    f.count++;
    if ((f.kind === "a" || !m.arraysOnly) && f.count > lim.maxListLength) {
      items.push(
        withField(
          { error: "list_too_long", message: `This has more than ${count(lim.maxListLength)} items.`, limit: { name: "maxListLength", max: lim.maxListLength } },
          f.segs,
        ),
      );
      return false;
    }
    return true;
  };
  /** Returns false when the scan must stop. */
  const notFinite = (segs: string[]): boolean => {
    if (!lim.finiteNumbers) return true;
    items.push(withField({ error: "not_finite", message: "This must be a finite number." }, segs));
    return items.length < lim.maxErrors;
  };

  let mode: "value" | "after" = "value";
  let segs: string[] = [];
  for (;;) {
    if (mode === "value") {
      ws();
      if (i >= n) return FAULT;
      const c = text[i]!;
      if (c === "[" || c === "{") {
        const depth = stack.length + 1;
        if (m.depthOffByOne ? depth >= lim.maxDepth : depth > lim.maxDepth) {
          items.push(withField({ error: "too_deep", message: `This is nested more than ${count(lim.maxDepth)} levels deep.`, limit: { name: "maxDepth", max: lim.maxDepth } }, segs));
          return stopped();
        }
        i++;
        const f = { kind: c === "[" ? ("a" as const) : ("o" as const), count: 0, segs };
        stack.push(f);
        ws();
        if (text[i] === (f.kind === "a" ? "]" : "}")) {
          i++;
          stack.pop();
          mode = "after";
          continue;
        }
        if (f.kind === "a") {
          if (!member(f)) return stopped();
          segs = [...f.segs, "0"];
        } else {
          if (text[i] !== '"') return FAULT;
          const key = str();
          if (key === null) return FAULT;
          ws();
          if (text[i] !== ":") return FAULT;
          i++;
          if (!member(f)) return stopped();
          segs = [...f.segs, key];
        }
        continue;
      }
      if (c === '"') {
        if (str() === null) return FAULT;
        mode = "after";
        continue;
      }
      const token = (t: string) => text.startsWith(t, i);
      if (token("NaN") || token("Infinity") || token("-Infinity")) {
        i += token("NaN") ? 3 : token("Infinity") ? 8 : 9;
        if (!m.missesNaNToken && !notFinite(segs)) return stopped();
        mode = "after";
        continue;
      }
      if (c === "-" || (c >= "0" && c <= "9")) {
        const start = i;
        if (text[i] === "-") i++;
        if (text[i] === "0") i++;
        else if (text[i]! >= "1" && text[i]! <= "9") while (text[i]! >= "0" && text[i]! <= "9") i++;
        else return FAULT;
        if (text[i] === ".") {
          i++;
          if (!(text[i]! >= "0" && text[i]! <= "9")) return FAULT;
          while (text[i]! >= "0" && text[i]! <= "9") i++;
        }
        if (text[i] === "e" || text[i] === "E") {
          i++;
          if (text[i] === "+" || text[i] === "-") i++;
          if (!(text[i]! >= "0" && text[i]! <= "9")) return FAULT;
          while (text[i]! >= "0" && text[i]! <= "9") i++;
        }
        if (!m.missesOverflow && !Number.isFinite(Number(text.slice(start, i))) && !notFinite(segs)) return stopped();
        mode = "after";
        continue;
      }
      if (token("true") || token("null")) {
        i += 4;
        mode = "after";
        continue;
      }
      if (token("false")) {
        i += 5;
        mode = "after";
        continue;
      }
      return FAULT;
    }
    // after a value
    const f = stack[stack.length - 1];
    ws();
    if (!f) {
      return i < n ? FAULT : { fault: false, items };
    }
    const c = text[i];
    if (c === ",") {
      i++;
      ws();
      if (f.kind === "a") {
        if (!member(f)) return stopped();
        segs = [...f.segs, String(f.count - 1)];
      } else {
        if (text[i] !== '"') return FAULT;
        const key = str();
        if (key === null) return FAULT;
        ws();
        if (text[i] !== ":") return FAULT;
        i++;
        if (!member(f)) return stopped();
        segs = [...f.segs, key];
      }
      mode = "value";
      continue;
    }
    if (c === (f.kind === "a" ? "]" : "}")) {
      i++;
      stack.pop();
      continue;
    }
    return FAULT;
  }
}

function bodyBytes(body: J, resolve: (ref: J) => Uint8Array): Uint8Array {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (isObj(body) && typeof body.hex === "string") return Uint8Array.from(Buffer.from(body.hex, "hex"));
  return resolve(body);
}

export function guard(input: J, resolve: (ref: J) => Uint8Array, m: Mutations = {}): J {
  const lim = settings(input.limits);
  const headers: Record<string, string> = input.headers ?? {};
  const [ridName, rid] = requestId(headers, input.config, m);
  const bytes = bodyBytes(input.body, resolve);
  const err = (status: number, body: J, read?: string) => {
    const out = envelope(status, { ...body, requestId: rid }, ridName);
    if (read) out.bodyRead = read;
    return out;
  };
  const tooLarge = (actual: number | undefined, read: string) =>
    err(413, { error: "body_too_large", message: bodyTooLarge({ max: lim.maxBodyBytes, actual }, m), limit: actual === undefined ? { name: "maxBodyBytes", max: lim.maxBodyBytes } : { name: "maxBodyBytes", max: lim.maxBodyBytes, actual } }, read);

  const unread = m.readsBeforeRefusing ? "bounded" : "none";
  const cl = header(headers, "content-length");
  if (cl !== undefined) {
    if (!/^[0-9]+$/.test(cl)) return err(400, { error: "bad_request", message: "The request could not be understood." }, unread);
    if (cl.length > 15) return tooLarge(undefined, unread);
    if (Number(cl) > lim.maxBodyBytes) return tooLarge(Number(cl), unread);
  }
  const counted = !(m.trustContentLength && cl !== undefined);
  if (counted && bytes.length > lim.maxBodyBytes) return tooLarge(undefined, "bounded");

  const ct = header(headers, "content-type");
  const media = ct === undefined ? null : ct.split(";")[0]!.trim().toLowerCase();
  const scanned = bytes.length > 0 && (media === "application/json" || (media !== null && media.endsWith("+json")) || (media === null && !m.scansOnlyDeclaredJson));
  if (scanned) {
    const malformed = () => err(400, { error: "malformed_body", message: "The request body is not valid JSON." });
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return malformed();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return malformed();
    }
    const r = scan(text, lim, m);
    if (r.fault) return malformed();
    if (r.items.length) return v422(r.items, rid, ridName);
  }
  return { pass: true, requestId: rid };
}

// ---------------------------------------------------------------------------
// section 4: the renderer
// ---------------------------------------------------------------------------

export function render(input: J, m: Mutations = {}): J {
  const t = input.throw;
  const [ridName, rid] = requestId(input.headers ?? {}, input.config, m);
  const env = (status: number, body: J, extra: Record<string, string> = {}) =>
    envelope(status, { ...body, requestId: rid }, ridName, extra);
  const crash = () => env(500, { error: "server_error", message: serverSentence(500, null, rid, m) });

  switch (t.kind) {
    case "response":
      if (m.rewrites409) return env(t.status, { error: statusEntry(t.status)[0], message: statusEntry(t.status)[1] });
      return { passthrough: true, status: t.status };
    case "crash":
      return m.echoCrash ? env(500, { error: "server_error", message: sanitise(t.message) }) : crash();
    case "validation":
      return v422(t.errors.map((e: J) => ({ error: "invalid", message: sanitise(e.message, 300, m), field: e.field })), rid, ridName);
    case "workbook": {
      const limit = { name: t.limit, max: t.max, actual: t.actual };
      return env(413, { error: "workbook_too_large", message: workbookTooLarge(limit, m), limit });
    }
    case "public": {
      if (!CODE.test(t.error)) return crash();
      const body: J = { error: t.error, message: sanitise(t.message, 300, m) };
      const extra: Record<string, string> = {};
      if (isInt(t.retryAfter)) {
        body.retryAfter = t.retryAfter;
        extra["retry-after"] = String(t.retryAfter);
      }
      return env(t.status, body, extra);
    }
    case "http": {
      const status: number = t.status;
      const [code, fallback] = statusEntry(status);
      const msg = typeof t.message === "string" ? sanitise(t.message, 300, m) : "";
      const ra = header(t.headers ?? {}, "retry-after");
      const retry = ra !== undefined && /^[0-9]{1,10}$/.test(ra.trim()) ? Number(ra.trim()) : null;
      const extra: Record<string, string> = retry === null ? {} : { "retry-after": String(retry) };
      const withRetry = (b: J) => (retry === null ? b : { ...b, retryAfter: retry });
      if (status >= 500) {
        if (m.echoHttp5xx && msg) return env(status, withRetry({ error: code, message: msg }), extra);
        return env(status, withRetry({ error: code, message: serverSentence(status, retry, rid, m) }), extra);
      }
      if (status === 429) return env(429, withRetry({ error: code, message: rateLimited(retry, m) }), extra);
      if (status === 422) return v422([{ error: "invalid", message: msg || fallback }], rid, ridName);
      return env(status, withRetry({ error: code, message: msg || fallback }), extra);
    }
  }
  throw new Error(`unknown kind ${t.kind}`);
}

// ---------------------------------------------------------------------------
// section 5
// ---------------------------------------------------------------------------

export function workbookLimits(input: J, m: Mutations = {}): J {
  const s = settings(input.limits);
  const cells = s.workbook.maxCells;
  return {
    maxRows: s.workbook.maxRows,
    maxColumns: s.workbook.maxColumns,
    maxCells: cells,
    maxSharedStrings: cells,
    maxArchiveBytes: s.maxBodyBytes,
    maxPartBytes: m.noPartFloor ? 64 * cells : Math.max(65536, 64 * cells),
    maxExpandedBytes: m.noPartFloor ? 256 * cells : Math.max(262144, 256 * cells),
  };
}

export function run(fn: string, input: J, resolve: (ref: J) => Uint8Array, m: Mutations = {}): J {
  switch (fn) {
    case "formatBytes":
      return formatBytes(input.n, m);
    case "formatDuration":
      return formatDuration(input.s, m);
    case "sanitise":
      return sanitise(input.text, input.max ?? 300, m);
    case "normalise":
      return normalise(input, m);
    case "guard":
      return guard(input, resolve, m);
    case "render":
      return render(input, m);
    case "workbookLimits":
      return workbookLimits(input, m);
  }
  throw new Error(`the probe does not run ${fn}`);
}
