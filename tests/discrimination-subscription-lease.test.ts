import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSuite } from "../src/index";

/**
 * Does `shared/subscription-lease` actually CATCH a wrong lease?
 *
 * The table was authored by the connector lab (weaver) and landed as written.
 * Its boundaries are decisions -- `due` inclusive at renewAt, `expired` inclusive
 * at expiresAt and winning over `due`, a missed lease resynced rather than
 * quietly re-created -- and a decision nobody can see enforced is a decision a
 * port can get wrong and still pass. This file shows which rows enforce which.
 *
 * ## The control comes first
 *
 * A faithful lease must pass EVERY row, or the mutants below prove nothing.
 *
 * ## Each mutant is a mistake a competent author would make
 *
 * and each asserts the EXACT rows it fails, so deleting the row that catches it
 * turns this file red rather than leaving a mutant uncaught.
 */

type Mutations = {
  /** `due` only once now is strictly PAST renewAt. */
  dueExclusive?: boolean;
  /** `expired` only once now is strictly PAST expiresAt. */
  expiredExclusive?: boolean;
  /** Check `due` before `expired`, so a lease past renewAt never reads expired. */
  dueWins?: boolean;
  /** An expired lease is renewed (a quiet re-create) instead of resynced. */
  expiredRenews?: boolean;
  /** A numeric string is taken as an epoch in milliseconds instead of refused. */
  guessesEpoch?: boolean;
  /** A zero margin is accepted. */
  allowsZeroMargin?: boolean;
  /** The UTC offset is ignored: the wall-clock time is read as if it were Z. */
  dropsOffset?: boolean;
  /** Fractional seconds are truncated away. */
  truncatesFraction?: boolean;
};

type Input = { expiresAt: string; renewBeforeSeconds: number; renewOperation: string; now: string };

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Milliseconds since the epoch, or null when the text is not an RFC 3339 instant. */
function parseInstant(text: string, m: Mutations): number | null {
  if (m.guessesEpoch && /^\d+$/.test(text)) return Number(text);

  const match = INSTANT.exec(text);
  if (!match) return null;

  const [, y, mo, d, h, mi, s, fraction, zone] = match;
  let millis = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (fraction && !m.truncatesFraction) millis += Math.round(Number(fraction) * 1000);
  if (zone !== "Z" && !m.dropsOffset) {
    const sign = zone.startsWith("-") ? -1 : 1;
    const [oh, om] = zone.slice(1).split(":").map(Number);
    millis -= sign * (oh * 3_600_000 + om * 60_000);
  }

  return millis;
}

function lease(input: Input, m: Mutations = {}): Record<string, unknown> {
  const expiresAt = parseInstant(input.expiresAt, m);
  if (expiresAt === null) return { refused: "expiresAt" };
  if (!(input.renewBeforeSeconds > 0) && !(m.allowsZeroMargin && input.renewBeforeSeconds === 0)) {
    return { refused: "renewBeforeSeconds" };
  }
  if (input.renewOperation === "") return { refused: "renewOperation" };

  const now = parseInstant(input.now, m)!;
  const renewAt = expiresAt - input.renewBeforeSeconds * 1000;

  const expired = m.expiredExclusive ? now > expiresAt : now >= expiresAt;
  const due = m.dueExclusive ? now > renewAt : now >= renewAt;

  let state: "active" | "due" | "expired";
  if (m.dueWins) state = due ? "due" : expired ? "expired" : "active";
  else state = expired ? "expired" : due ? "due" : "active";

  const action = state === "active" ? "none" : state === "due" || m.expiredRenews ? "renew" : "resync";

  return { renewAt: new Date(renewAt).toISOString(), state, action };
}

/** The four-digit ids this implementation FAILS. */
function failing(m: Mutations = {}): string[] {
  const { cases } = loadSuite("shared/subscription-lease");
  assert.equal(cases.length, 13, "shared/subscription-lease lost or gained rows; re-derive every mutant's set");

  return cases
    .filter((c) => {
      try {
        assert.deepStrictEqual(lease(c.input as Input, m), c.expected);
        return false;
      } catch {
        return true;
      }
    })
    .map((c) => c.id.slice(0, 4));
}

test("THE CONTROL: a faithful lease passes every row", () => {
  assert.deepEqual(failing(), [], "the control fails a row, so every mutant below proves nothing");
});

test("an exclusive `due` fails exactly 0002", () => {
  assert.deepEqual(failing({ dueExclusive: true }), ["0002"]);
});

test("an exclusive `expired` fails exactly 0004", () => {
  // At the instant of expiry a provider has already stopped delivering.
  assert.deepEqual(failing({ expiredExclusive: true }), ["0004"]);
});

test("`due` winning over `expired` fails exactly 0004 and 0007", () => {
  assert.deepEqual(failing({ dueWins: true }), ["0004", "0007"]);
});

test("renewing a missed lease instead of resyncing fails exactly 0004 and 0007", () => {
  // The notifications during the gap are gone; a quiet re-create loses them.
  assert.deepEqual(failing({ expiredRenews: true }), ["0004", "0007"]);
});

test("guessing an epoch as milliseconds fails exactly 0010", () => {
  assert.deepEqual(failing({ guessesEpoch: true }), ["0010"]);
});

test("accepting a zero margin fails exactly 0011", () => {
  assert.deepEqual(failing({ allowsZeroMargin: true }), ["0011"]);
});

test("dropping the UTC offset fails exactly 0008", () => {
  assert.deepEqual(failing({ dropsOffset: true }), ["0008"]);
});

test("truncating fractional seconds fails exactly 0009", () => {
  assert.deepEqual(failing({ truncatesFraction: true }), ["0009"]);
});
