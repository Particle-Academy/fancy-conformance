# http: request guards and one error envelope (normative)

CC-fancy-0031. Design and reasoning: `.ai/plans/request-guards-and-error-envelope.md`
in the envelope. This file is the contract the rows in `http/error-envelope` and
`http/request-guards` are written from. It was written BEFORE any implementation,
so the goldens are authored (`reference: "authored"`); `tests/http-probe.ts` is a
reading of this file, and the discrimination test proves the rows can tell a
faithful reading from the mistakes a port would make.

Implementations:

| Package | Language | Runs |
|---|---|---|
| `@particle-academy/fancy-http-errors` | node | `http/error-envelope` (all functions) |
| `particle-academy/fancy-http-guard` | php | both suites |
| `fancy-http-guard` (PyPI) | python | `http/request-guards`; `http/error-envelope` helpers only (it has no HTTP-client normaliser, so `normalise` rows carry `skip.python`) |

## 1. The envelope (what a server EMITS)

`Content-Type: application/json`. Exactly these members, validated by
`error-envelope/envelope.schema.json`:

| Member | Rule |
|---|---|
| `error` | Required. Matches `^[a-z][a-z0-9_]{0,63}$`. |
| `message` | Required. One plain sentence, section 5 rules applied. Never exception text (section 4.4). |
| `field` | Optional. Dotted path (section 3.3) of the one field at fault. Never on a 422 (it uses `errors`). |
| `limit` | Optional. `{name, max, actual?}`, integers, the limit that refused the request. |
| `errors` | Present on every 422 and only on a 422, at least one item. Item: `{error, message, field?, limit?}`. |
| `retryAfter` | Optional non-negative integer seconds. Present exactly when the response carries a delta-seconds `Retry-After`, and equal to it. |
| `requestId` | Required. Equal to the response's request-id header. |

A 422's top-level `error` is `validation_failed`, and its `message` is the single
item's message when there is one item, else `"{n} fields need attention."` with `n`
the item count.

## 2. Sentences (shared by the emitter and the normaliser)

### 2.1 Status codes and default sentences

| Status | code | Default sentence |
|---|---|---|
| 0 (no response) | `network_error` | We could not reach the server. Check your connection and try again. |
| 400 | `bad_request` | The request could not be understood. |
| 401 | `unauthenticated` | Please sign in to continue. |
| 403 | `forbidden` | You do not have permission to do that. |
| 404 | `not_found` | That could not be found. |
| 405 | `method_not_allowed` | That action is not allowed here. |
| 408 | `request_timeout` | The request took too long. Please try again. |
| 409 | `conflict` | This conflicts with a change made elsewhere. Reload and try again. |
| 410 | `gone` | This is no longer available. |
| 413 | `body_too_large` | This request is too large for the server. |
| 415 | `unsupported_media_type` | That type of content is not accepted here. |
| 422 | `validation_failed` | Some fields need attention. |
| 429 | `rate_limited` | Too many requests. (+ retry clause, 2.3) |
| other 4xx | `client_error` | The request could not be completed. |
| 500, other 5xx | `server_error` | Something went wrong on our side. |
| 502, 504 | `upstream_error` | A service this depends on did not respond. |
| 503 | `unavailable` | The service is unavailable right now. |

**Every 5xx sentence** is the default for its status, then the retry clause when
`retryAfter` is known, then ` If it keeps happening, quote reference {requestId}.`
when a request id is known. Nothing a server or an exception said reaches it.

### 2.2 Templates

- **`body_too_large` with a `limit`:** `This request is {bytes(actual)}, over this endpoint's limit of {bytes(max)}.`;
  without `actual`: `This request is over this endpoint's limit of {bytes(max)}.`
- **`workbook_too_large`**, by `limit.name` (counts through `count()`, sizes through `bytes()`):
  - `maxRows`: `This spreadsheet has {actual} rows, over the limit of {max}.`
  - `maxColumns`: `This spreadsheet has {actual} columns, over the limit of {max}.`
  - `maxCells`: `This spreadsheet has at least {actual} cells, over the limit of {max}.`
  - `maxSharedStrings`: `This spreadsheet has {actual} shared strings, over the limit of {max}.`
  - `maxEntries`: `This spreadsheet has {actual} parts, over the limit of {max}.`
  - `maxArchiveBytes`: `This spreadsheet is {bytes(actual)}, over the limit of {bytes(max)}.`
  - `maxPartBytes`, `maxExpandedBytes`: `This spreadsheet needs at least {bytes(actual)} to open, over the limit of {bytes(max)}.`
  - `maxCompressionRatio`: `This spreadsheet is compressed too tightly to open safely.`
  - any other name, or no `actual`: `This spreadsheet is too large to open here.`
- **`workbook_unreadable`** (a 422 item): `This file could not be read as a spreadsheet.`
- **422 items from the guard:**
  - `not_finite`: `This must be a finite number.`
  - `list_too_long`: `This has more than {count(max)} items.`
  - `too_deep`: `This is nested more than {count(max)} levels deep.`
- **`rate_limited`:** `Too many requests.` + retry clause, or ` Try again shortly.` when unknown.

### 2.3 Helpers (each has its own rows)

- **`count(n)`**: the integer in decimal with `,` every three digits (`1,048,576`).
- **`bytes(n)`**:
  - Under 1024: `1 byte`, else `{count(n)} bytes`.
  - Otherwise take the largest unit `u` of GB (1024^3), MB (1024^2) or KB (1024) with `u <= n`.
    Then `tenths = floor((n * 10 + floor(u / 2)) / u)`, computed in INTEGER arithmetic.
    The result is `{count(tenths div 10)}` + (`.{tenths mod 10}` when that is not 0) + ` ` + unit.
  - Half-to-even rounding (Python `round`) and binary-float `toFixed` both disagree with this on exact halves; row `0005` pins it.
- **`duration(s)`** (the retry clause): ` Try again in {d}.` where
  - `s < 60` gives `{s} second(s)`;
  - `s < 3600` gives `ceil(s / 60)` `minute(s)`;
  - otherwise `ceil(s / 3600)` `hour(s)`.
  - Singular exactly when the number is 1. `s = 0` gives ` Try again now.`
  - The function under test returns the clause WITHOUT its leading space.
- **`sanitise(text, max = 300)`**:
  1. Every code point in U+0000-U+001F and U+007F-U+009F becomes U+0020.
  2. Runs of U+0020 collapse to one, and U+0020 is trimmed from both ends.
  3. Over `max` CODE POINTS (not bytes, not UTF-16 units), keep the first `max - 1` and append U+2026.

## 3. The guard (`http/request-guards`, fn `guard`)

### 3.1 Settings and defaults

Per route, every one configurable (names identical in every port):

| Setting | Default |
|---|---|
| `maxBodyBytes` | 1048576 |
| `maxDepth` | 32 |
| `maxListLength` | 10000 |
| `maxErrors` | 20 |
| `finiteNumbers` | true |
| `workbook.maxRows` | 100000 |
| `workbook.maxColumns` | 1000 |
| `workbook.maxCells` | 100000 |

The `upload` profile is the defaults with `maxBodyBytes` 10485760. App-wide:
`requestIdHeader` (`x-request-id`) and `trustIncomingRequestId` (false).

A row's `input.limits` overrides the defaults key by key; `input.config` sets the app-wide two.

### 3.2 Order

1. **`Content-Length`.** When present it must be 1 to 15 ASCII digits. Anything else
   (a sign, a comma list, letters, two different values) is a 400 `bad_request`.
   An EMPTY value is treated as absent: PHP-FPM sends `CONTENT_LENGTH=""` on every
   bodiless request, and refusing it would refuse every GET. More than 15 digits is
   a 413 with `limit.actual` omitted. A value over `maxBodyBytes` is a 413 with
   `limit.actual` = the value, and **NOT ONE BODY BYTE IS READ.**
2. **Bounded read.** Read at most `maxBodyBytes + 1` bytes. Reaching `maxBodyBytes + 1`
   is a 413 with `limit.actual` omitted (the total is unknown), and the rest is never
   requested. This is what catches a missing or lying `Content-Length`.
3. **Scan**, only when the body is non-empty AND the media type (the `Content-Type` before
   any `;`, ASCII case-insensitive, trimmed) is `application/json` or ends `+json`, OR no
   `Content-Type` header is present. Section 3.3.
4. **Pass.** The application receives the identical bytes.

The 413 envelope: `{error: "body_too_large", message, limit: {name: "maxBodyBytes", max, actual?}, requestId}`.

### 3.3 The scan

One pass over the bytes. No tree is built, nothing recurses, no regex.

- **The body must be valid UTF-8** with no byte-order mark. Otherwise it is a 400
  `malformed_body`: `The request body is not valid JSON.`
- **Grammar is RFC 8259** (whitespace is space, tab, LF, CR only), with one extension:
  the bare tokens `NaN`, `Infinity` and `-Infinity` in value position are recognised so
  they can be REFUSED as `not_finite`. Any other grammar fault is a 400 `malformed_body`.
- **A number literal is `not_finite`** when its value, converted to an IEEE double with
  round-to-nearest, is not finite. That covers `1e400`, `-1e400`, and an integer literal
  of 310 digits. It applies only when `finiteNumbers` is true.
- **Depth.** Entering `[` or `{` adds one level. Entering a level greater than
  `maxDepth` is `too_deep`, at the path of the container being entered, with
  `limit {name: "maxDepth", max: maxDepth}`.
- **Members.** An array's elements and an object's members (duplicates count) are both
  counted. Reaching `maxListLength + 1` is `list_too_long`, at the container's path, with
  `limit {name: "maxListLength", max: maxListLength}`.
- **Paths.** Dotted. A member contributes its key: the decoded string, verbatim, including
  any `.` it contains. A lone surrogate escape becomes U+FFFD. An element contributes its
  0-based index in decimal. The root's path is empty, and an item at the root has no `field`.
- **Stopping.** A `too_deep` or `list_too_long` is recorded and the scan STOPS, so a bomb
  costs no more than its first `maxListLength + 1` members. The scan also stops when it
  holds `maxErrors` items. Otherwise it runs to the end. A grammar fault found before
  stopping makes the whole verdict a 400, discarding any items. Items keep document order.
- **Result.** No items means pass. Otherwise a 422 (section 1), each item
  `{error, message, field?, limit?}`.

### 3.4 Request id

- **Every response carries the request-id header**, a pass included, and every envelope
  carries it as `requestId`.
- **It is generated**, as a lowercase UUID v4, unless `trustIncomingRequestId` is true AND
  the inbound header value matches `^[A-Za-z0-9._:-]{1,128}$`. Then it is reused.
- **Rows write a generated id as `"$generated"`.** The runner checks the UUID v4 shape and
  that the header and the body agree.

## 4. The renderer (fn `render`)

`input.throw` describes what the application raised. Each runner builds the native thing:

| `kind` | Laravel | Starlette / FastAPI |
|---|---|---|
| `http` `{status, message?, headers?}` | `abort()` / `HttpException` | `starlette.exceptions.HTTPException` (fancy `HttpError(public=false)` when Starlette is absent) |
| `crash` `{message}` | `RuntimeException` | `RuntimeError` |
| `validation` `{errors: [{field, message}]}` | `ValidationException::withMessages` | FastAPI `RequestValidationError`, `loc = ("body", *segments)`, digit segments as ints |
| `public` `{status, error, message, retryAfter?}` | the package's `HttpError` with `public: true` | the same |
| `workbook` `{limit, max, actual}` | holy-sheet `ReadLimitExceeded` (a read limit) or `ArchiveRefused::overLimit` (an archive limit) | the same classes in `holy_sheet.exceptions` |
| `response` `{status, headers}` | the app RETURNS this response | the same |

### 4.1 `http`

- The code comes from 2.1.
- **On a 4xx**, a non-empty message (after `sanitise`) is the app's own sentence and
  is used. Starlette's default `detail` (the status's reason phrase) counts as no message.
- With no message, the default sentence is used.
- **A 429 always uses its template.** A delta-seconds `Retry-After` in `headers` becomes
  `retryAfter` and the response header.
- **A 422** becomes `errors: [{error: "invalid", message}]`.
- **A 5xx never uses the message.**

### 4.2 `crash`

Always a 500 `server_error` with the 5xx sentence, whatever the exception says, in every
environment including debug.

### 4.3 `validation`

A 422. Each item is `{error: "invalid", message: sanitise(message), field}`, in the
order given; Laravel keeps the first message per field.

### 4.4 `public`

The given status, `error` and `message` (sanitised), even on a 5xx. This is the one
way an app declares a 5xx sentence public. `retryAfter` sets the header.

### 4.5 `workbook`

A 413 `workbook_too_large`, `limit {name, max, actual}`, with the 2.2 sentence. The
exception's own text is never used, even though holy-sheet's is safe.

### 4.6 `response`

Returned unchanged: status, body and headers. Only the request-id header is added.
This is how Inertia's bare 409 and its `X-Inertia-Location` 409 survive.

## 5. Workbook limits (fns `workbookLimits`, `workbook`)

`workbookLimits(limits)` gives holy-sheet's `limits` option, with its key names:

```
maxRows          = workbook.maxRows
maxColumns       = workbook.maxColumns
maxCells         = workbook.maxCells
maxSharedStrings = workbook.maxCells
maxArchiveBytes  = maxBodyBytes
maxPartBytes     = max(65536, 64 * workbook.maxCells)
maxExpandedBytes = max(262144, 256 * workbook.maxCells)
```

64 bytes per cell is holy-sheet's measured 55-58, rounded up. The floors keep a tiny cap
from refusing a small file's styles part.

`workbook` reads the referenced file through the port's helper, under those limits. A
pass is `{pass: true}`. A limit refusal renders as in 4.5. A file holy-sheet cannot read
at all is a 422 with one item `{error: "workbook_unreadable", message, field: input.field}`.

## 6. The normaliser (`http/error-envelope`, fn `normalise`)

Input `{status, headers, body, now?}`; `body` is a string or null.

Output: `null` for a status from 100 to 399. Otherwise
`{status, code, sentence, fields, retryAfter, requestId}`.

1. **Read the body.** A body over 65536 UTF-8 bytes, or not JSON, or JSON that is not an
   object, or nested deeper than 64, or holding a lone surrogate escape, is UNRECOGNISED.
2. **`requestId`.** The request-id header, else the body's `requestId`; whichever is used
   must match `^[A-Za-z0-9._:-]{1,128}$`, else null.
3. **`retryAfter`.** From `Retry-After` first:
   - 1 to 10 digits are seconds;
   - an IMF-fixdate (`Sun, 06 Nov 1994 08:49:37 GMT`, exactly that form) is
     `max(0, ceil((date - now) / 1000))` when `now` is given, else null.

   Then the body's `retryAfter`, when it is an integer from 0 to 2147483647. Else null.
4. **Shape**, first match wins:
   - **(a) envelope:** `error` matches the code pattern, and `message` is a string.
     `fields` come from `errors[]` items with a string `field` and a string `message`;
     the first per field wins. A top-level string `field` maps to `message`.
   - **(b) FastAPI list:** `detail` is a non-empty array of objects, each with an array `loc`
     and a string `msg`. The path is `loc` with a leading `body`/`query`/`path`/`header`/`cookie`
     dropped, joined by `.`. The code is `validation_failed`.
   - **(c) detail sentence:** `detail` is a string.
   - **(d) Laravel validation:** `errors` is an object whose values are strings or arrays
     (the first string is taken). The code is `validation_failed`.
   - **(e) Laravel message:** `message` is a string.

   Otherwise the body is UNRECOGNISED, and the code comes from the status.
5. **`code`.** The envelope's `error`; else, on a 4xx, `validation_failed` for (b) and
   (d); else the status code from 2.1. A field map on a 5xx is server text and does
   not make the response a validation failure.
6. **`sentence`**, first that applies:
   - **status 0 or 5xx:** the 5xx rule in 2.1 (status 0 has no reference clause).
     Nothing in the body is ever used.
   - **`validation_failed` with at least one item:** one item gives its message, `n`
     items give `{n} fields need attention.` Items are the envelope's `errors[]` (with or
     without a field), FastAPI's list entries, or Laravel's fields.
   - **`rate_limited`, or status 429:** the template.
   - **`body_too_large` or `workbook_too_large` with a well-formed `limit`:** the template.
   - **the server's message** (envelope `message`, `detail`, or Laravel `message`), when
     non-empty after `sanitise`.
   - **the status's default sentence.**
7. **Field messages** go through `sanitise` too. `fields` is `{}` when there are none,
   and ALWAYS `{}` on status 0 and every 5xx: a field message is server text too.
   Keys are the body's own strings, so an implementation must not let `__proto__`
   (or any key) reach a prototype.
