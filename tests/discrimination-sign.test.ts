import assert from "node:assert/strict";
import { createHash, createHmac, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";
import { test } from "node:test";

import { loadSuite } from "../src/index";

/**
 * Do the `sign/*` tables actually CATCH a wrong port of fancy-sign?
 *
 * A faithful Node reading of `suites/sign/SPEC.md` sections 1 to 4, written with
 * `node:crypto` alone (the plan's claim for fancy-sign-js: standard library
 * only), and the mistakes a competent port would plausibly make. The control
 * must pass every row, or the mutants prove nothing; each mutant asserts the
 * EXACT rows that catch it, so deleting the row that catches one turns this
 * file red.
 *
 * sign/fields and the sign/otp scenarios are not probed here: they need a PDF
 * layout engine and the whole signing service. Their manifests say so.
 */

type M = {
  /** Sort object keys with JavaScript's default comparison (UTF-16 code units). */
  utf16Keys?: boolean;
  /** Escape "/" as "\/" (PHP's json_encode default). */
  escapeSlashes?: boolean;
  /** Print a float instead of refusing it. */
  allowFloats?: boolean;
  /** Hash empty event data as [] instead of {}. */
  emptyDataAsList?: boolean;
  /** Admit any type from any source. */
  noSourceRule?: boolean;
  /** verify() never checks prev_hash, so a bad link surfaces later or as a hash mismatch. */
  noLinkCheck?: boolean;
  /** The token hashes JSON.stringify of the record as given (unsorted, all keys). */
  naiveToken?: boolean;
  /** verify() skips the as-sent prefix check. */
  noPrefix?: boolean;
  /** verify() accepts an intact chain of ANY envelope. */
  anyEnvelope?: boolean;
  /** The code digest leaves the purpose out. */
  digestNoPurpose?: boolean;
  /** An object whose keys are exactly "0".."n-1" is written as a list (what PHP's assoc decode does). */
  indexKeysAsList?: boolean;
  /** A 422 keeps its own code at the top level instead of validation_failed + one item. */
  flat422?: boolean;
};

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const GENESIS = "0".repeat(64);
const TYPES = [
  "envelope.created", "envelope.sent", "email.sent", "link.opened", "otp.sent", "otp.verified", "otp.failed",
  "otp.locked", "consent.accepted", "document.opened", "page.viewed", "field.completed", "mark.adopted",
  "signer.signed", "signer.declined", "signer.requested_changes", "reminder.sent", "envelope.completed", "envelope.voided", "envelope.expired",
  "document.downloaded", "seal.applied",
];
const KEYS = ["type", "version", "envelope_id", "as_sent_sha256", "as_sent_bytes", "final_sha256", "signers", "chain_head", "nonce", "key_id"];
const SIGNER_KEYS = ["id", "name", "email", "signed_at", "method", "otp_seq", "consent_seq"];

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const byteOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
const isObject = (v: unknown): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

class Refused extends Error {}

function canonical(value: unknown, m: M, objects: string[] = [], at = ""): string {
  if (objects.includes(at) && Array.isArray(value) && value.length === 0) return "{}";
  if (typeof value === "number") {
    if (!Number.isInteger(value) && !m.allowFloats) throw new Refused("float");
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    const s = JSON.stringify(value);
    return m.escapeSlashes ? s.replace(/\//g, "\\/") : s;
  }
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  const path = (k: string | number) => (at === "" ? String(k) : `${at}.${k}`);
  if (Array.isArray(value)) return `[${value.map((v, i) => canonical(v, m, objects, path(i))).join(",")}]`;
  const keys = Object.keys(value as object);
  if (m.indexKeysAsList && keys.length > 0 && keys.every((k) => /^(0|[1-9][0-9]*)$/.test(k)) && keys.length === new Set(keys).size
    && keys.map(Number).sort((a, b) => a - b).every((n, i) => n === i)) {
    const list = keys.map(Number).sort((a, b) => a - b).map((n) => (value as Record<string, unknown>)[String(n)]);
    return canonical(list, m, [], at);
  }
  keys.sort(m.utf16Keys ? undefined : byteOrder);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k], m, objects, path(k))}`).join(",")}}`;
}

type Event = Record<string, Json>;

function emptyData(data: Json | undefined, m: M): Json {
  const d = data ?? {};
  if (m.emptyDataAsList && isObject(d) && Object.keys(d).length === 0) return [];
  if (Array.isArray(d) && d.length === 0 && !m.emptyDataAsList) return {};
  return d;
}

function hashOf(prev: string, e: Event, m: M): string {
  const body = {
    seq: e.seq, envelope_id: e.envelope_id, at: e.at, type: e.type, actor: e.actor, source: e.source,
    ip: e.ip ?? null, user_agent: e.user_agent ?? null, data: emptyData(e.data, m),
  };
  return sha256(`${prev}\n${canonical(body, m)}`);
}

function append(last: Event | null, e: Event, m: M): unknown {
  if (!TYPES.includes(String(e.type))) return { error: "refused" };
  const client = e.source === "client";
  if (!m.noSourceRule && ((e.source !== "server" && !client) || client !== (e.type === "page.viewed"))) return { error: "refused" };
  const seq = last ? Number(last.seq) + 1 : 1;
  const prev = last ? String(last.hash) : GENESIS;
  const full: Event = { ip: null, user_agent: null, data: {}, ...e, seq };
  return {
    envelope_id: full.envelope_id, seq, at: full.at, type: full.type, actor: full.actor, source: full.source,
    ip: full.ip, user_agent: full.user_agent, data: emptyData(full.data, {}), prev_hash: prev, hash: hashOf(prev, full, m),
  };
}

function verifyChain(rows: Event[], m: M): Record<string, Json> {
  let prev = GENESIS;
  let expected = 1;
  let checked = 0;
  let envelope: Json | undefined;
  for (const row of rows) {
    const seq = Number(row.seq ?? 0);
    if (seq !== expected) return { ok: false, checked, head: prev, seq, problem: "sequence_gap" };
    if (!m.noLinkCheck && row.prev_hash !== prev) return { ok: false, checked, head: prev, seq, problem: "broken_link" };
    envelope ??= row.envelope_id;
    const data = typeof row.data === "string" ? (JSON.parse(row.data) as Json) : row.data;
    let ok = (isObject(data) || Array.isArray(data)) && row.envelope_id === envelope;
    try {
      ok = ok && hashOf(prev, { ...row, data: data ?? null }, m) === row.hash;
    } catch {
      ok = false;
    }
    if (!ok) return { ok: false, checked, head: prev, seq, problem: "hash_mismatch" };
    prev = String(row.hash);
    expected++;
    checked++;
  }
  return { ok: true, checked, head: prev };
}

// ------------------------------------------------------------ completion

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

function keyPair(seedHex: string) {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(seedHex, "hex")]), format: "der", type: "pkcs8" });
  const raw = createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(-32);
  return { priv, publicB64: raw.toString("base64") };
}

const keyId = (publicB64: string) => sha256(Buffer.from(publicB64, "base64")).slice(0, 16);

function recordCanonical(record: Record<string, Json>, m: M): string {
  if (m.naiveToken) return JSON.stringify(record);
  const picked: Record<string, Json> = {};
  for (const k of KEYS) if (k in record) picked[k] = record[k]!;
  return canonical(picked, m);
}

const tokenFor = (record: Record<string, Json>, m: M) => `fsig_v1_${sha256(recordCanonical(record, m))}`;

function wellFormed(record: unknown): boolean {
  if (!isObject(record) || record.type !== "fancy-sign.completion" || record.version !== 1) return false;
  const keys = Object.keys(record);
  if (keys.some((k) => !KEYS.includes(k) && k !== "token" && k !== "seal")) return false;
  if (KEYS.some((k) => !keys.includes(k))) return false;
  for (const k of ["as_sent_sha256", "final_sha256", "chain_head"]) {
    if (typeof record[k] !== "string" || !/^[0-9a-f]{64}$/.test(record[k] as string)) return false;
  }
  if (!Number.isInteger(record.as_sent_bytes) || (record.as_sent_bytes as number) < 1 || !Array.isArray(record.signers)) return false;
  if (typeof record.token !== "string" || typeof record.seal !== "string" || typeof record.key_id !== "string") return false;
  return record.signers.every((s) => isObject(s) && Object.keys(s).every((k) => SIGNER_KEYS.includes(k)));
}

function verifyCompletion(input: Record<string, Json>, m: M): Json {
  const pdf = Buffer.from(String(input.pdf_base64), "base64");
  const c = input.completion as Record<string, Json>;
  const events = (input.events ?? null) as Event[] | null;
  const checks: Record<string, boolean | null> = { seal: null, token: null, final_hash: null, prefix: null, chain: null };
  const fail = (reason: string, check: string) => ({ ok: false, reason, checks: { ...checks, [check]: false } });
  if (!wellFormed(c)) return { ok: false, reason: "completion_invalid", checks };
  if (tokenFor(c, m) !== c.token) return fail("token_mismatch", "token");
  checks.token = true;
  const pk = (input.public_keys as Record<string, string>)[String(c.key_id)];
  let sealOk = false;
  if (typeof pk === "string") {
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pk, "base64")]);
    sealOk = edVerify(null, Buffer.from(recordCanonical(c, m)), createPublicKey({ key: spki, format: "der", type: "spki" }), Buffer.from(String(c.seal), "base64"));
  }
  if (!sealOk) return fail("seal_invalid", "seal");
  checks.seal = true;
  if (sha256(pdf) !== c.final_sha256) return fail("final_hash_mismatch", "final_hash");
  checks.final_hash = true;
  const n = Number(c.as_sent_bytes);
  if (!m.noPrefix && (pdf.length < n || sha256(pdf.subarray(0, n)) !== c.as_sent_sha256)) return fail("prefix_mismatch", "prefix");
  checks.prefix = true;
  if (events !== null) {
    const chain = verifyChain(events, m);
    const ours = m.anyEnvelope || events.every((e) => e.envelope_id === c.envelope_id);
    if (!chain.ok || !ours) return fail("chain_broken", "chain");
    if (!events.some((e) => e.hash === c.chain_head)) return fail("chain_head_mismatch", "chain");
    checks.chain = true;
  }
  return { ok: true, reason: null, checks };
}

function codeDigest(i: Record<string, Json>, m: M): string {
  const message = m.digestNoPurpose
    ? `${i.envelope_id}|${i.signer_id}|${i.code}`
    : `${i.envelope_id}|${i.signer_id}|${i.purpose}|${i.code}`;
  return createHmac("sha256", String(i.app_key)).update(message).digest("hex");
}

const STATUS: Record<string, number> = {
  invalid_request: 422, not_found: 404, forbidden: 403, link_invalid: 404, otp_invalid: 422, otp_locked: 423,
  otp_rate_limited: 429, session_required: 401, consent_required: 409, not_viewed: 409, fields_incomplete: 422,
  mark_invalid: 422, envelope_not_open: 409, envelope_not_draft: 409, already_signed: 409, already_declined: 409,
  step_up_required: 401, limit_exceeded: 429,
};

/** The kit-wide error envelope (suites/http/SPEC.md section 1) for one fancy-sign refusal. */
function envelope(i: Record<string, Json>, m: M): Json {
  const code = String(i.code);
  const message = String(i.message);
  if (STATUS[code] === 422 && !m.flat422) {
    return { error: "validation_failed", message, errors: [{ error: code, message }], requestId: String(i.request_id) };
  }
  return { error: code, message, requestId: String(i.request_id) };
}

// ------------------------------------------------------------ the runner

function run(suite: string, fn: string, input: Record<string, Json>, m: M): unknown {
  switch (`${suite} ${fn}`) {
    case "sign/chain canonical":
      try {
        return canonical(input.value, m, (input.objects as string[] | undefined) ?? []);
      } catch (e) {
        if (e instanceof Refused) return { error: "refused" };
        throw e;
      }
    case "sign/chain hash":
      return hashOf(String(input.prev_hash), input.event as Event, m);
    case "sign/chain append":
      return append((input.last ?? null) as Event | null, input.event as Event, m);
    case "sign/chain verify":
      return verifyChain(input.rows as Event[], m);
    case "sign/completion publicKey":
      return keyPair(String(input.seed)).publicB64;
    case "sign/completion keyId":
      return keyId(String(input.public_key));
    case "sign/completion canonical":
      return recordCanonical(input.record as Record<string, Json>, m);
    case "sign/completion token":
      return tokenFor(input.record as Record<string, Json>, m);
    case "sign/completion seal":
      return edSign(null, Buffer.from(recordCanonical(input.record as Record<string, Json>, m)), keyPair(String(input.seed)).priv).toString("base64");
    case "sign/completion wellFormed":
      return wellFormed(input.record);
    case "sign/completion verify":
      return verifyCompletion(input, m);
    case "sign/otp codeDigest":
      return codeDigest(input, m);
    case "sign/otp envelope":
      return envelope(input, m);
    default:
      return undefined;
  }
}

const PROBED: Record<string, number> = { "sign/chain": 33, "sign/completion": 20, "sign/otp": 24 };

/** The ids (suite/NNNN) this implementation FAILS, over the probed functions. */
function failing(m: M = {}): string[] {
  const out: string[] = [];
  for (const [suite, rows] of Object.entries(PROBED)) {
    const { cases } = loadSuite(suite);
    assert.equal(cases.length, rows, `${suite} lost or gained rows; re-derive every mutant's set`);
    for (const c of cases) {
      const actual = run(suite, String(c.fn), c.input as Record<string, Json>, m);
      if (actual === undefined) continue;
      try {
        assert.deepStrictEqual(actual, c.expected);
      } catch {
        out.push(`${suite.slice(5)}/${c.id.slice(0, 4)}`);
      }
    }
  }
  return out;
}

test("THE CONTROL: a faithful Node reading passes every probed row", () => {
  assert.deepEqual(failing(), [], "the control fails a row, so every mutant below proves nothing");
});

test("the control probes every row of sign/chain and sign/completion, and sign/otp's codeDigest and envelope rows", () => {
  let probed = 0;
  for (const suite of Object.keys(PROBED)) {
    for (const c of loadSuite(suite).cases) {
      if (run(suite, String(c.fn), c.input as Record<string, Json>, {}) !== undefined) probed++;
    }
  }
  assert.equal(probed, 33 + 20 + 2 + 3);
});

test("sorting keys by UTF-16 code units fails exactly the byte-order row", () => {
  assert.deepEqual(failing({ utf16Keys: true }), ["chain/0005"]);
});

test("escaping slashes fails the no-escapes row and every hash over a user agent with a slash in it", () => {
  // Every real user agent has a slash ("Mozilla/5.0"), so this mistake breaks
  // most real chains, not just one canonical row.
  assert.deepEqual(failing({ escapeSlashes: true }), [
    "chain/0002", "chain/0011", "chain/0018", "chain/0023", "chain/0024", "completion/0010", "completion/0020",
  ]);
});

test("printing floats fails exactly the float row", () => {
  assert.deepEqual(failing({ allowFloats: true }), ["chain/0006"]);
});

test("hashing empty data as [] fails every row whose chain holds an event with no data", () => {
  assert.deepEqual(failing({ emptyDataAsList: true }), MUTANT_EMPTY_DATA);
});

test("admitting any source fails exactly the three source-rule rows", () => {
  assert.deepEqual(failing({ noSourceRule: true }), ["chain/0016", "chain/0017", "chain/0033"]);
});

test("skipping the link check fails exactly the broken-link rows", () => {
  assert.deepEqual(failing({ noLinkCheck: true }), MUTANT_NO_LINK);
});

test("a token over JSON.stringify of the record fails exactly the canonical, token, seal and verify rows that hash it", () => {
  assert.deepEqual(failing({ naiveToken: true }), MUTANT_NAIVE_TOKEN);
});

test("skipping the prefix check fails exactly the prefix row", () => {
  assert.deepEqual(failing({ noPrefix: true }), ["completion/0017"]);
});

test("accepting another envelope's intact chain fails exactly the other-envelope row", () => {
  assert.deepEqual(failing({ anyEnvelope: true }), ["completion/0019"]);
});

test("a code digest without the purpose fails exactly the two digest rows", () => {
  assert.deepEqual(failing({ digestNoPurpose: true }), ["otp/0002", "otp/0003"]);
});

test("writing index-keyed objects as lists fails exactly the index-key rows", () => {
  // The defect a PHP port reading JSON with assoc=true has; the 0.52.0 rows exist for it.
  assert.deepEqual(failing({ indexKeysAsList: true }), ["chain/0027", "chain/0029", "chain/0030", "chain/0031"]);
});

test("a flat 422 fails exactly the 422 envelope row", () => {
  assert.deepEqual(failing({ flat422: true }), ["otp/0017"]);
});

// Sets derived by running each mutant once and reading every id against its
// row's title; each is a row that tests what the mutant breaks.
const MUTANT_EMPTY_DATA = [
  "chain/0010", "chain/0013", "chain/0018", "chain/0020", "chain/0021", "chain/0022", "chain/0023", "chain/0024",
  "chain/0025", "chain/0026", "completion/0010", "completion/0020",
];
const MUTANT_NO_LINK = ["chain/0021", "chain/0025", "chain/0026"];
const MUTANT_NAIVE_TOKEN = [
  "completion/0003", "completion/0004", "completion/0005", "completion/0010", "completion/0011", "completion/0014",
  "completion/0015", "completion/0016", "completion/0017", "completion/0018", "completion/0019", "completion/0020",
];
