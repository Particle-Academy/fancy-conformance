# sign: fancy-sign, simple electronic signatures (normative)

CC-fancy-0036, phase 1 (SES). Design: `.ai/plans/fancy-sign.md` in the envelope,
sections 5.3 (codes), 5.4 (chain), 5.6 (seal and completion), 5.2 (fields). This
file is what the five `sign/*` suites are written from. The goldens are the PHP
package's output (`particle-academy/fancy-sign`), exported by
`fancy-sign-php/tests/Conformance/Export.php`; a port never regenerates them.

| Package | Language | Runs |
|---|---|---|
| `particle-academy/fancy-sign` | php | all five suites (the reference) |
| `@particle-academy/fancy-sign` (`fancy-sign-js`) | node | planned. `sign/fields` `placement` needs the fine-print-js writer |

`tests/discrimination-sign.test.ts` is a Node reading of sections 1 to 3 and 6.1 with
`node:crypto` only, plus the mutants a port would plausibly be.

## 1. Canonical JSON (`sign/chain` `canonical`)

The one byte form that is hashed and sealed. change-council's scheme.

- Object keys sorted by **UTF-8 byte order**, recursively. Not UTF-16 code-unit
  order (JavaScript's default `sort()`): the two disagree for a key outside the
  Basic Multilingual Plane against one at U+E000 or above (row `0005`).
- List order kept. No whitespace.
- `/`, every non-ASCII character, and U+2028 / U+2029 are written raw. Quotes,
  backslashes and C0 controls are escaped as JSON requires (`\n`, `\t`, `\"`,
  `\\`, otherwise `\u00XX`).
- Integers, `true`, `false` and `null` print as literals. **Floats are refused**:
  PHP and JavaScript do not print them alike. Anything hashed holds integers or
  strings.
- An empty object is `{}` and an empty list is `[]`.
- **An object is an object whatever its keys.** `{"0": "a", "1": "b"}` is
  written `{"0":"a","1":"b"}` and never `["a","b"]` (rows `0027` to `0031`,
  0.52.0). A runtime whose JSON decoder cannot keep the two apart (PHP with
  `assoc: true`) must decode with objects kept as objects wherever the value is
  hashed or sealed; the rows' `objects` paths name every object a PHP runner
  would otherwise lose.

## 2. The chain (`sign/chain` `hash`, `append`, `verify`)

```
hash = sha256_hex(prev_hash + "\n" + canonical({seq, envelope_id, at, type, actor, source, ip, user_agent, data}))
```

- One chain per envelope. The genesis `prev_hash` is 64 zeros; `seq` starts at 1.
- `data` empty is hashed as `{}`. `ip` and `user_agent` may be null.
- The event set is closed: `envelope.created`, `envelope.sent`, `email.sent`,
  `link.opened`, `otp.sent`, `otp.verified`, `otp.failed`, `otp.locked`,
  `consent.accepted`, `document.opened`, `page.viewed`, `field.completed`,
  `mark.adopted`, `signer.signed`, `signer.declined`,
  `signer.requested_changes` (section 4b), `reminder.sent`,
  `envelope.completed`, `envelope.voided`, `envelope.expired`,
  `document.downloaded`, `seal.applied`, and from 0.57.0 (data mode, section
  6.2) `document.rendered` and `signature.sealed`, and from 0.58.0
  `document.finalized`.
- `source` is `client` for `page.viewed` and `document.rendered` and `server`
  for every other type; any other pairing is refused. A browser may claim it
  showed a page or a rendering, never that someone signed.
- `verify(rows)` walks in order and stops at the first problem, reporting
  `checked` (rows that passed), `head` (the last good hash, the genesis if none)
  and the failing row's `seq`:
  1. `seq` is not the expected next number: `sequence_gap`;
  2. `prev_hash` is not the previous hash: `broken_link`;
  3. the recomputed hash differs, `data` is not an object, or the row's
     `envelope_id` differs from the first row's: `hash_mismatch`.

  `data` may arrive as a JSON string (a raw database read).

## 3. Completion record, token, seal (`sign/completion`)

- Keys: `type` (`fancy-sign.completion`), `version` (1), `envelope_id`,
  `as_sent_sha256`, `as_sent_bytes`, `final_sha256`, `signers`, `chain_head`,
  `nonce` (16 random bytes, hex), `key_id`. Each signer: `id`, `name`, `email`,
  `signed_at`, `method`, `otp_seq`, `consent_seq`. **Closed sets**: an extra key
  makes the record not well formed.
- canonical bytes = section 1 over those keys only (never `token` or `seal`).
- `token = "fsig_v1_" + sha256_hex(canonical)`.
- `seal = base64(Ed25519 detached signature of canonical)` by the host's seal
  key. Ed25519 is deterministic, so the seal is pinned byte for byte.
- `key_id` = the first 16 hex characters of `sha256(raw 32-byte public key)`.
- `verify(final, record, events?)`, stopping at the first failure:
  `completion_invalid` (not well formed), `token_mismatch`, `seal_invalid`
  (including an unknown `key_id`), `final_hash_mismatch`, `prefix_mismatch`
  (the first `as_sent_bytes` of the final file do not hash to `as_sent_sha256`),
  then, when events are given, `chain_broken` (section 2 fails, or a row is of
  another envelope) and `chain_head_mismatch` (the sealed head is not a hash in
  the chain). `checks` reports each check as true, false, or null when not
  reached.

## 4. Codes (`sign/otp`)

- Six digits from a CSPRNG, stored only as
  `hmac_sha256_hex(app_key, envelope_id + "|" + signer_id + "|" + purpose + "|" + code)`.
- Purposes `view` and `accept` are separate. Only a view code opens a session;
  the accept code is sent with `sign` and checked LAST there.
- A code expires `ttl_seconds` (600) after it is sent, is consumed when used,
  and is replaced by a new request. A wrong try keeps it with one more attempt;
  at `max_attempts` (5) it locks until a new code is requested.
- Wire: unknown, expired and wrong are all `otp_invalid` (422); `otp_locked` is
  423. The `otp.failed` event's `reason` is `otp_unknown`, `otp_expired` or
  `otp_wrong`. Codes never appear in an event.
- Every limit is a setting; the defaults are above.

## 4a. Refusals on the wire (`sign/otp` `envelope`, 0.52.0)

Every refusal is the kit-wide error envelope, `suites/http/SPEC.md` section 1
(CC-fancy-0031): `{error, message, errors?, requestId}` plus the request-id
header. A fancy-sign code whose status is 422 (`invalid_request`, `otp_invalid`,
`fields_incomplete`, `mark_invalid`) is `error: "validation_failed"` with ONE
item `{error: <code>, message}` and the top-level `message` equal to the item's;
every other code is the top-level `error`. A client reads the fancy-sign code
from the item on a 422 and from `error` otherwise.

## 4b. Requests for changes (`sign/chain` append, `sign/otp` scenario, 0.53.0)

- `signer.requested_changes` is in the closed event set, server-observed, with
  `data: {text}`: the signer's message, trimmed, 1 to `max_decline_reason`
  (1000) characters, required.
- It needs the signer's session (after the view code), as decline does, and is
  refused once the signer has signed or declined, or once the envelope is no
  longer open (`envelope_not_open`).
- It does NOT end the envelope: the signer can still sign or decline.
- A signer may ask at most `max_change_requests` (5) times per envelope; the
  next is `limit_exceeded` (429). Every limit is a setting.
- Scenario op: `changes {text}`, answering `{changes_requested: n}`. The
  scenario includes `data` for this event as it does for `otp.*` and `link.*`.

## 4c. Signing order (`sign/otp` `errorCodes`, CC-fancy-0051)

- `settings.order` is `parallel` (the default, unchanged) or `sequential`.
  Under `sequential` only the lowest-order group of unsigned signers is
  invited; the others are `waiting` and have no link.
- A link opened by a `waiting` signer is refused before anything is shown or
  recorded: `not_your_turn` (409), a top-level `error` like every non-422 code.
- The behaviour itself is pinned by the reference package's own suite, not by
  rows here yet; only the closed code set changed.

## 5. Fields (`sign/fields`)

- Document field nodes become fields in document order, with `anchor: {node}`.
- Per signer, in signer order: `final-signature-{id}` (signature) and
  `final-date-{id}` (date_signed), anchored `{final_page: true}`; then, if
  `per_page` is `initials` or `signature`, `every-page-{per_page}-{id}`,
  anchored `{every_page: true}`.
- An organisation's `per_page`, when not `none`, applies to its envelopes; a
  sender's different value is `invalid_request`.
- After send, an every-page field lands on pages 1..N, N the last authored page,
  and never on the generated final page, at any page count.

## 6. Data mode (`sign/data`, 0.57.0, CC-fancy-0052)

An envelope with `settings.mode: "data"` signs the HOST's data, an opaque JSON
object, instead of a PDF the package renders. Design: `.ai/plans/fancy-sign-data-mode.md`
in the envelope.

### 6.1 The canonical form `fsig-data-1` (`sign/data` `canonical`)

Section 1, every bullet, with these differences only:

1. **The top level must be an object** (`{}` is allowed). Anything else is refused.
2. **Numbers** are read as IEEE-754 doubles, then:
   - integral and `|x| <= 2^53 - 1`: a decimal integer. `12.0`, `1E2` and
     `-0.0` print `12`, `100` and `0`.
   - integral and `|x| > 2^53 - 1`: **refused**. `9007199254740993` parses to
     a different double in some runtimes than the text says, so two runtimes
     would hash different numbers. This also refuses `1e21`.
   - non-integral: ECMAScript `Number::toString(x)` (ECMA-262 section
     6.1.6.1.20), the shortest digits that round-trip, which is RFC 8785 section
     3.2.2.3. The exponent form appears only below `1e-6` (`1e-7`, `-1.5e-9`),
     never as PHP writes it (`1.0e-7`).
   - NaN and the infinities cannot come through JSON; a runtime holding one
     refuses it.
3. **Strings and keys** must be well-formed Unicode; a lone surrogate is refused.
4. Floats stay **refused everywhere else**: chain events, completion and
   signature records and marks keep section 1 exactly.

`data_sha256` is the lowercase hex sha256 of the UTF-8 bytes and `data_bytes`
their length, with no prefix: any host recomputes it from its own data.

The input is JSON TEXT, so a row tests the decoder as well. A runtime whose
decoder loses `{}` against `[]`, or `{"0": "a"}` against `["a"]` (PHP with
`assoc: true`), must decode with objects kept as objects. Keys sort by UTF-8
bytes, not by UTF-16 code units, which is where this form departs from RFC 8785
as written; row `0006` discriminates.

### 6.2 Events and codes

- `document.rendered` is a CLIENT claim (`source: client`), like `page.viewed`:
  `{data_sha256, renderer, pages}`, which presentation the signer's browser says
  it showed. `renderer` is the host's own string (template and release).
- `signature.sealed` is server-observed: `{signer_id, token, key_id}`, a
  signature record's token on the chain right after the `signer.signed` it seals.
- `sign/otp` `errorCodes` gains `data_hash_mismatch` (422: the data does not
  hash to the host's `data_sha256`, at create or update, or the `data_sha256`
  sent with sign differs) and `data_external_reference` (422: under the optional
  `last-word` profile, an image not inlined as a `data:` URI).
- `document.finalized` (from 0.58.0) is server-observed:
  `{final_sha256, final_bytes}`, the hash and length of the final PDF the host
  made from the data, registered once after completion. The package never
  receives the PDF. A client `document.finalized` is refused.
- `sign/otp` `errorCodes` gains (from 0.58.0) `envelope_not_completed` (409: a
  final registered before every signer has signed) and `final_already_attached`
  (409: a different final for an envelope that already has one; the same hash
  and length again is idempotent).

The signature record, the version-2 completion and their verifier are pinned by
the reference package's own suite, not by rows here yet.
