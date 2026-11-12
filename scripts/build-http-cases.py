"""Write suites/http/error-envelope and suites/http/request-guards.

The goldens are AUTHORED from suites/http/SPEC.md: every sentence and verdict
below is typed from the spec, never computed by an implementation of it. Only
two things are computed here, and both are measurements rather than answers:

- file digests (sha256 of each fixture);
- holy-sheet's own counts for the workbook rows (how many rows, columns and
  cells it reports when it refuses), taken by RUNNING fancy-holy-sheet, the
  Python port, from the sibling checkout. The guard's contract is how it renders
  holy-sheet's refusal, not what holy-sheet counts.

Usage (from the repository root):
    python -I scripts/build-http-cases.py <path to holy-sheet-py/src>

Rows are never renumbered: append new ones at the end of their table.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTTP = ROOT / "suites" / "http"
SINCE = "0.48.0"
GEN = "$generated"
JSON_CT = "application/json"


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, indent=2, ensure_ascii=True) + "\n"
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def fixture(suite_dir: Path, name: str, data: bytes) -> dict[str, str]:
    target = suite_dir / "fixtures" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return {"file": "fixtures/" + name, "sha256": hashlib.sha256(data).hexdigest()}


class Table:
    def __init__(self) -> None:
        self.rows: list[dict[str, object]] = []

    def add(self, slug: str, title: str, fn: str, inp: object, expected: object, **extra: object) -> None:
        row: dict[str, object] = {
            "id": "%04d-%s" % (len(self.rows) + 1, slug),
            "title": title,
            "since": SINCE,
            "fn": fn,
            "input": inp,
            "expected": expected,
        }
        row.update(extra)
        self.rows.append(row)


NO_PY_NORMALISE = {"python": "fancy-http-guard (Python) has no HTTP-client normaliser; the UI normaliser is TypeScript and the server one is Laravel's. Listed so the language reads as decided, not forgotten."}


# --------------------------------------------------------------------------
# http/error-envelope
# --------------------------------------------------------------------------

def error_envelope() -> None:
    t = Table()

    for n, out, note in [
        (0, "0 bytes", None),
        (1, "1 byte", "Singular exactly at 1."),
        (1023, "1,023 bytes", "The last value below the KB unit, with the thousands separator."),
        (1024, "1 KB", "A whole unit drops the .0."),
        (1280, "1.3 KB", "An EXACT half (12.5 tenths). The integer rule rounds it up; Python's half-to-even round() gives 1.2 and fails here."),
        (1536, "1.5 KB", None),
        (1048575, "1,024 KB", "One byte under a MB stays in KB and rounds to 1,024: the unit is chosen before rounding, deliberately."),
        (1048576, "1 MB", None),
        (10485760, "10 MB", "The upload profile's default limit."),
        (13002342, "12.4 MB", "124.4999 tenths: just under a half, rounds down."),
        (1073741824, "1 GB", None),
        (5497558138880, "5,120 GB", "GB is the largest unit; the whole part takes thousands separators."),
    ]:
        extra = {"notes": note} if note else {}
        t.add("bytes-%d" % n, "bytes(%d)" % n, "formatBytes", {"n": n}, out, **extra)

    for s, out in [
        (0, "Try again now."),
        (1, "Try again in 1 second."),
        (30, "Try again in 30 seconds."),
        (59, "Try again in 59 seconds."),
        (60, "Try again in 1 minute."),
        (61, "Try again in 2 minutes."),
        (3599, "Try again in 60 minutes."),
        (3600, "Try again in 1 hour."),
        (3601, "Try again in 2 hours."),
        (90000, "Try again in 25 hours."),
    ]:
        t.add("duration-%d" % s, "duration(%d)" % s, "formatDuration", {"s": s}, out,
              **({"notes": "Minutes and hours round UP: telling someone to retry before the server will accept it costs them a second refusal."} if s in (61, 3601) else {}))

    t.add("sanitise-collapse", "Runs of spaces collapse and the ends trim", "sanitise",
          {"text": "  hello    world  "}, "hello world")
    t.add("sanitise-controls", "C0 and C1 controls become spaces", "sanitise",
          {"text": "a" + chr(0) + "b" + chr(10) + "c" + chr(0x85) + "d" + chr(0x7F) + "e" + chr(9) + chr(13) + "f"},
          "a b c d e f",
          notes="NUL, LF, NEL (C1), DEL and a TAB+CR pair. A message is one line in a toast; a newline or a NUL in it is either a rendering bug or an injection into a log line.")
    t.add("sanitise-at-max", "Exactly max code points is unchanged", "sanitise",
          {"text": "x" * 300}, "x" * 300)
    t.add("sanitise-over-max", "One over max keeps max-1 and adds an ellipsis", "sanitise",
          {"text": "x" * 301}, "x" * 299 + chr(0x2026))
    t.add("sanitise-astral", "The cap counts CODE POINTS, not UTF-16 units", "sanitise",
          {"text": chr(0x1F600) * 301}, chr(0x1F600) * 299 + chr(0x2026),
          notes="Each emoji is one code point and two UTF-16 units. A port that slices a JS string by length cuts after 150 emoji, or splits a surrogate pair.")
    t.add("sanitise-custom-max", "max is a parameter", "sanitise",
          {"text": "abcdef", "max": 4}, "abc" + chr(0x2026))
    t.add("sanitise-empty", "Only controls and spaces gives the empty string", "sanitise",
          {"text": " " + chr(10) + " "}, "")

    def norm(slug: str, title: str, status: int, headers: dict[str, str], body: str | None, expected: object, **extra: object) -> None:
        inp: dict[str, object] = {"status": status, "headers": headers, "body": body}
        if "now" in extra:
            inp["now"] = extra.pop("now")
        t.add(slug, title, "normalise", inp, expected, skip=NO_PY_NORMALISE, **extra)

    def out(status: int, code: str, sentence: str, fields: dict[str, str] | None = None,
            retry: int | None = None, rid: str | None = None) -> dict[str, object]:
        return {"status": status, "code": code, "sentence": sentence, "fields": fields or {},
                "retryAfter": retry, "requestId": rid}

    norm("ok-is-null", "A 2xx is not an error", 200, {}, '{"ok":true}', None)
    norm("redirect-is-null", "A 3xx is not an error", 302, {"location": "/x"}, None, None)
    norm("network", "Status 0: no response at all", 0, {}, None,
         out(0, "network_error", "We could not reach the server. Check your connection and try again."))

    norm("envelope-413-limit", "Envelope 413 with a limit uses the template", 413, {"x-request-id": "r-1"},
         json.dumps({"error": "body_too_large", "message": "server wording", "limit": {"name": "maxBodyBytes", "max": 10485760, "actual": 13002342}, "requestId": "r-1"}),
         out(413, "body_too_large", "This request is 12.4 MB, over this endpoint's limit of 10 MB.", rid="r-1"),
         notes="The client builds the sentence from the limit, so a translated UI never shows the server's English.")
    norm("envelope-413-no-actual", "Envelope 413 without actual", 413, {},
         json.dumps({"error": "body_too_large", "message": "x", "limit": {"name": "maxBodyBytes", "max": 1048576}, "requestId": "r-2"}),
         out(413, "body_too_large", "This request is over this endpoint's limit of 1 MB.", rid="r-2"))
    norm("html-413", "An nginx HTML 413 page is unrecognised", 413, {"content-type": "text/html"},
         "<html><head><title>413 Request Entity Too Large</title></head><body><center><h1>413 Request Entity Too Large</h1></center><hr><center>nginx</center></body></html>",
         out(413, "body_too_large", "This request is too large for the server."),
         notes="The proxy refused before the app ran: no envelope exists. The status is all there is.")
    norm("fastapi-detail-410", "A FastAPI detail sentence on a 410", 410, {}, '{"detail":"This invite has expired."}',
         out(410, "gone", "This invite has expired."))
    norm("empty-410", "A 410 with no body", 410, {}, "",
         out(410, "gone", "This is no longer available."))
    norm("envelope-410", "Envelope 410 with the app's message", 410, {},
         json.dumps({"error": "gone", "message": "This link was used already.", "requestId": "r-3"}),
         out(410, "gone", "This link was used already.", rid="r-3"))
    norm("app-code", "An app's own code is kept", 410, {},
         json.dumps({"error": "invite_expired", "message": "Ask for a new invite.", "requestId": "r-4"}),
         out(410, "invite_expired", "Ask for a new invite.", rid="r-4"))

    norm("429-header", "429 with Retry-After seconds", 429, {"retry-after": "30"}, "",
         out(429, "rate_limited", "Too many requests. Try again in 30 seconds.", retry=30))
    norm("429-date", "429 with an HTTP-date and a clock", 429, {"retry-after": "Thu, 12 Nov 2026 10:00:45 GMT"}, None,
         out(429, "rate_limited", "Too many requests. Try again in 45 seconds.", retry=45),
         now="2026-11-12T10:00:00.000Z")
    norm("429-date-no-clock", "429 with an HTTP-date and no clock", 429, {"retry-after": "Thu, 12 Nov 2026 10:00:45 GMT"}, None,
         out(429, "rate_limited", "Too many requests. Try again shortly."),
         notes="Without `now` a date cannot become seconds. Guessing from the machine clock would make the row depend on when it ran.")
    norm("429-date-past", "A date in the past is zero", 429, {"retry-after": "Thu, 12 Nov 2026 09:00:00 GMT"}, None,
         out(429, "rate_limited", "Too many requests. Try again now.", retry=0),
         now="2026-11-12T10:00:00.000Z")
    norm("429-body", "retryAfter from the body when no header", 429, {},
         json.dumps({"error": "rate_limited", "message": "x", "retryAfter": 90, "requestId": "r-5"}),
         out(429, "rate_limited", "Too many requests. Try again in 2 minutes.", retry=90, rid="r-5"))
    norm("429-header-wins", "The header wins over the body", 429, {"retry-after": "5"},
         json.dumps({"error": "rate_limited", "message": "x", "retryAfter": 90, "requestId": "r-6"}),
         out(429, "rate_limited", "Too many requests. Try again in 5 seconds.", retry=5, rid="r-6"))
    norm("429-bad-header", "A Retry-After that is neither form is ignored", 429, {"retry-after": "soon"}, None,
         out(429, "rate_limited", "Too many requests. Try again shortly."))
    norm("429-laravel", "Laravel's throttle body", 429, {"retry-after": "60"}, '{"message":"Too Many Attempts."}',
         out(429, "rate_limited", "Too many requests. Try again in 1 minute.", retry=60),
         notes="429 always uses the template, so the server's English never reaches a translated UI.")

    norm("422-envelope-two", "Envelope 422 with two items", 422, {"x-request-id": "r-7"},
         json.dumps({"error": "validation_failed", "message": "2 fields need attention.", "errors": [
             {"error": "not_finite", "message": "This must be a finite number.", "field": "items.3.price"},
             {"error": "invalid", "message": "Enter an email address.", "field": "email"}], "requestId": "r-7"}),
         out(422, "validation_failed", "2 fields need attention.",
             {"items.3.price": "This must be a finite number.", "email": "Enter an email address."}, rid="r-7"))
    norm("422-envelope-one", "Envelope 422 with one item", 422, {},
         json.dumps({"error": "validation_failed", "message": "x", "errors": [
             {"error": "too_deep", "message": "This is nested more than 32 levels deep.", "field": "a"}], "requestId": "r-8"}),
         out(422, "validation_failed", "This is nested more than 32 levels deep.", {"a": "This is nested more than 32 levels deep."}, rid="r-8"))
    norm("422-envelope-root", "An item with no field still counts", 422, {},
         json.dumps({"error": "validation_failed", "message": "x", "errors": [
             {"error": "not_finite", "message": "This must be a finite number."}], "requestId": "r-9"}),
         out(422, "validation_failed", "This must be a finite number.", rid="r-9"),
         notes="A NaN at the root has no field, so fields is empty, but the sentence still says what is wrong.")
    norm("422-envelope-first-wins", "The first message per field wins", 422, {},
         json.dumps({"error": "validation_failed", "message": "x", "errors": [
             {"error": "invalid", "message": "First.", "field": "a"},
             {"error": "invalid", "message": "Second.", "field": "a"}], "requestId": "r-10"}),
         out(422, "validation_failed", "2 fields need attention.", {"a": "First."}, rid="r-10"),
         notes="The count is items, not distinct fields; the map keeps the first, matching Inertia's flat errors.")
    norm("422-fastapi", "FastAPI's 422 list", 422, {},
         json.dumps({"detail": [
             {"loc": ["body", "items", 3, "price"], "msg": "Input should be a valid number", "type": "float_parsing"},
             {"loc": ["query", "page"], "msg": "Input should be greater than 0", "type": "greater_than"}]}),
         out(422, "validation_failed", "2 fields need attention.",
             {"items.3.price": "Input should be a valid number", "page": "Input should be greater than 0"}))
    norm("422-fastapi-one", "FastAPI's 422 list with one entry", 422, {},
         json.dumps({"detail": [{"loc": ["body", "email"], "msg": "Field required", "type": "missing"}]}),
         out(422, "validation_failed", "Field required", {"email": "Field required"}))
    norm("422-laravel-one", "Laravel's validation map, one field", 422, {},
         json.dumps({"message": "The email field is required.", "errors": {"email": ["The email field is required.", "The email must be valid."]}}),
         out(422, "validation_failed", "The email field is required.", {"email": "The email field is required."}))
    norm("422-laravel-two", "Laravel's validation map, two fields", 422, {},
         json.dumps({"message": "The name field is required. (and 1 more error)", "errors": {"name": ["The name field is required."], "items.0.qty": ["The qty must be at least 1."]}}),
         out(422, "validation_failed", "2 fields need attention.",
             {"name": "The name field is required.", "items.0.qty": "The qty must be at least 1."}))

    norm("500-laravel-debug", "Laravel debug output is never shown", 500, {"x-request-id": "4f8c2a9e-1b7d-4c3e-9a5f-2d6b8e0c1a73"},
         json.dumps({"message": "SQLSTATE[42S02]: Base table or view not found: 1146 Table 'prod.users' doesn't exist", "exception": "Illuminate\\Database\\QueryException", "file": "/var/www/app/vendor/laravel/framework/src/Illuminate/Database/Connection.php", "line": 825, "trace": [{"file": "/var/www/app/app/Http/Controllers/UserController.php"}]}),
         out(500, "server_error", "Something went wrong on our side. If it keeps happening, quote reference 4f8c2a9e-1b7d-4c3e-9a5f-2d6b8e0c1a73.", rid="4f8c2a9e-1b7d-4c3e-9a5f-2d6b8e0c1a73"),
         notes="APP_DEBUG=true in production. A normaliser that shows a 4xx-style server message here prints a table name and a filesystem path to a user.")
    norm("500-envelope-message", "Even our own envelope's 5xx message is ignored", 500, {},
         json.dumps({"error": "server_error", "message": "db at 10.0.0.4 refused", "requestId": "r-11"}),
         out(500, "server_error", "Something went wrong on our side. If it keeps happening, quote reference r-11.", rid="r-11"))
    norm("500-no-id", "No request id, no reference clause", 500, {}, "Internal Server Error",
         out(500, "server_error", "Something went wrong on our side."))
    norm("503-retry", "503 with Retry-After", 503, {"retry-after": "120", "x-request-id": "r-12"}, "",
         out(503, "unavailable", "The service is unavailable right now. Try again in 2 minutes. If it keeps happening, quote reference r-12.", retry=120, rid="r-12"))
    norm("502-html", "A gateway's HTML 502", 502, {"content-type": "text/html"}, "<html><body>Bad Gateway</body></html>",
         out(502, "upstream_error", "A service this depends on did not respond."))
    norm("504", "A 504", 504, {}, None, out(504, "upstream_error", "A service this depends on did not respond."))
    norm("501", "Another 5xx", 501, {}, '{"detail":"Not Implemented: /admin/export"}',
         out(501, "server_error", "Something went wrong on our side."))

    norm("403-controls", "A 4xx message is sanitised", 403, {},
         json.dumps({"detail": "No" + chr(10) + chr(10) + "access" + chr(0) + "  here."}),
         out(403, "forbidden", "No access here."))
    norm("400-long", "A 4xx message is capped", 400, {}, json.dumps({"detail": "y" * 400}),
         out(400, "bad_request", "y" * 299 + chr(0x2026)))
    norm("401-envelope", "Envelope 401", 401, {}, json.dumps({"error": "unauthenticated", "message": "Your session ended. Sign in again.", "requestId": "r-13"}),
         out(401, "unauthenticated", "Your session ended. Sign in again.", rid="r-13"))
    norm("418", "An unlisted 4xx", 418, {}, None, out(418, "client_error", "The request could not be completed."))
    norm("404-laravel-message", "Laravel's plain message on a 404", 404, {}, '{"message":"Invite not found."}',
         out(404, "not_found", "Invite not found."))
    norm("404-empty-message", "An empty message falls back to the default", 404, {}, '{"message":""}',
         out(404, "not_found", "That could not be found."))

    norm("rid-header-bad", "An invalid header id falls back to the body", 410, {"x-request-id": "bad id"},
         json.dumps({"error": "gone", "message": "Gone.", "requestId": "r-14"}),
         out(410, "gone", "Gone.", rid="r-14"),
         notes="A request id is printed into a sentence and a support ticket; one with spaces or markup is refused at the door.")
    norm("rid-body-bad", "An invalid body id is null", 410, {}, json.dumps({"error": "gone", "message": "Gone.", "requestId": "<script>"}),
         out(410, "gone", "Gone."))
    norm("rid-header-wins", "The header id wins over the body", 410, {"x-request-id": "h-1"}, json.dumps({"error": "gone", "message": "Gone.", "requestId": "b-1"}),
         out(410, "gone", "Gone.", rid="h-1"))

    norm("bad-code", "A code that breaks the pattern is not an envelope", 410, {},
         json.dumps({"error": "Bad Code", "message": "Shown as a Laravel message."}),
         out(410, "gone", "Shown as a Laravel message."),
         notes="Falls through to shape (e), so the code comes from the status rather than from a string nobody vetted.")
    norm("array-body", "A JSON array is unrecognised", 400, {}, "[1,2]", out(400, "bad_request", "The request could not be understood."))
    norm("over-64k", "A body over 64 KiB is unrecognised", 400, {}, json.dumps({"detail": "z" * 65530}),
         out(400, "bad_request", "The request could not be understood."),
         notes="The cap is on UTF-8 bytes before parsing. This body is 65,544 bytes.")
    deep_ok = '{"error":"gone","message":"Gone.","x":' + "[" * 63 + "]" * 63 + "}"
    deep_bad = '{"error":"gone","message":"Gone.","x":' + "[" * 64 + "]" * 64 + "}"
    norm("depth-64", "Nesting of exactly 64 is read", 410, {}, deep_ok, out(410, "gone", "Gone."))
    norm("depth-65", "Nesting of 65 is unrecognised", 410, {}, deep_bad, out(410, "gone", "This is no longer available."),
         notes="PHP's json_decode depth and an iterative walk in TS must agree on where 64 ends.")
    norm("lone-surrogate", "A lone surrogate escape is unrecognised", 400, {}, '{"detail":"a\\ud800b"}',
         out(400, "bad_request", "The request could not be understood."),
         notes="PHP's json_decode refuses it (JSON_ERROR_UTF16) and JSON.parse accepts it, so the TS port must refuse it explicitly or the two disagree.")
    norm("field-top-level", "A top-level field maps to the message", 409, {},
         json.dumps({"error": "slug_taken", "message": "That address is taken.", "field": "slug", "requestId": "r-15"}),
         out(409, "slug_taken", "That address is taken.", {"slug": "That address is taken."}, rid="r-15"))
    norm("workbook-envelope", "Envelope workbook_too_large uses the template", 413, {},
         json.dumps({"error": "workbook_too_large", "message": "x", "limit": {"name": "maxRows", "max": 100000, "actual": 150000}, "requestId": "r-16"}),
         out(413, "workbook_too_large", "This spreadsheet has 150,000 rows, over the limit of 100,000.", rid="r-16"))
    norm("413-bad-limit", "A malformed limit falls back to the message", 413, {},
         json.dumps({"error": "body_too_large", "message": "Too big.", "limit": {"name": "maxBodyBytes", "max": "lots"}, "requestId": "r-17"}),
         out(413, "body_too_large", "Too big.", rid="r-17"))
    norm("500-field-map", "A 5xx with a validation map shows no field text either", 500, {},
         json.dumps({"message": "x", "errors": {"db": ["SQLSTATE[HY000] [2002] Connection refused at 10.0.0.4:5432"]}}),
         out(500, "server_error", "Something went wrong on our side."),
         notes="Field messages are server text too. A port that only guards the sentence still prints a connection string under a form field.")
    norm("proto-key", "A __proto__ field is an ordinary key", 422, {},
         '{"message":"x","errors":{"__proto__":["Polluted?"],"name":["Required."]}}',
         out(422, "validation_failed", "2 fields need attention.", {"__proto__": "Polluted?", "name": "Required."}),
         notes="JSON.parse makes __proto__ an own key; assigning it into a plain object instead sets the prototype and the field silently disappears.")

    d = HTTP / "error-envelope"
    write_json(d / "cases.json", {"$schema": "../../../schema/case-table.schema.json", "suite": "http/error-envelope", "cases": t.rows})
    write_json(d / "manifest.json", {
        "$schema": "../../../schema/suite-manifest.schema.json",
        "suite": "http/error-envelope",
        "title": "One error envelope: the shared sentences, and the normaliser that turns any error response into one",
        "since": SINCE,
        "caseFormat": "table",
        "cases": "cases.json",
        "contract": {
            "functions": {
                "normalise": "normalise({status, headers, body, now?}) -> null | {status, code, sentence, fields, retryAfter, requestId}",
                "formatBytes": "formatBytes(n) -> string",
                "formatDuration": "formatDuration(s) -> string (the retry clause, no leading space)",
                "sanitise": "sanitise(text, max = 300) -> string",
            },
            "summary": "Normative text: suites/http/SPEC.md sections 2 and 6. Written BEFORE any implementation (CC-fancy-0031). The envelope's JSON Schema is envelope.schema.json beside this file; each package ships a byte copy pinned by sha256.",
            "reference": "authored",
            "referenceNote": "Authored from suites/http/SPEC.md in scripts/build-http-cases.py on 2026-11-12, before any implementation existed. tests/http-probe.ts is a reading of the spec that passes every row, and tests/discrimination-http.test.ts pins the mistakes it catches.",
            "implementations": [
                {"language": "node", "package": "@particle-academy/fancy-http-errors", "symbol": "normalise"},
                {"language": "php", "package": "particle-academy/fancy-http-guard", "symbol": "ParticleAcademy\\HttpGuard\\Client\\ErrorNormaliser::normalise"},
                {"language": "python", "package": "fancy-http-guard", "symbol": "fancy_http_guard.sentences"},
            ],
        },
        "notes": [
            "Python runs formatBytes, formatDuration and sanitise, which its guard uses to write sentences; every normalise row carries skip.python with the reason.",
            "Two halves on purpose: the servers EMIT one strict shape, and the normaliser ACCEPTS every shape a real server sends, because the UI talks to servers nobody here wrote.",
        ],
    })


# --------------------------------------------------------------------------
# http/request-guards
# --------------------------------------------------------------------------

def env(error: str, message: str, **rest: object) -> dict[str, object]:
    body: dict[str, object] = {"error": error, "message": message}
    body.update(rest)
    body["requestId"] = rest.get("requestId", GEN) if "requestId" in rest else GEN
    return body


def refused(status: int, body: dict[str, object], read: str | None = None, headers: dict[str, str] | None = None) -> dict[str, object]:
    h = {"content-type": JSON_CT, "x-request-id": body["requestId"]}  # type: ignore[dict-item]
    if headers:
        h.update(headers)
    outv: dict[str, object] = {"status": status, "headers": h, "body": body}
    if read:
        outv["bodyRead"] = read
    return outv


def v422(items: list[dict[str, object]], rid: str = GEN) -> dict[str, object]:
    message = items[0]["message"] if len(items) == 1 else "%d fields need attention." % len(items)
    return refused(422, {"error": "validation_failed", "message": message, "errors": items, "requestId": rid})


NF = "This must be a finite number."


def nf(field: str | None) -> dict[str, object]:
    item: dict[str, object] = {"error": "not_finite", "message": NF}
    if field:
        item["field"] = field
    return item


def deep(field: str | None, mx: int) -> dict[str, object]:
    item: dict[str, object] = {"error": "too_deep", "message": "This is nested more than %s levels deep." % format(mx, ","), "limit": {"name": "maxDepth", "max": mx}}
    if field:
        item["field"] = field
    return item


def long_(field: str | None, mx: int) -> dict[str, object]:
    item: dict[str, object] = {"error": "list_too_long", "message": "This has more than %s items." % format(mx, ","), "limit": {"name": "maxListLength", "max": mx}}
    if field:
        item["field"] = field
    return item


MALFORMED = {"error": "malformed_body", "message": "The request body is not valid JSON."}
PASS = {"pass": True, "requestId": GEN}


def request_guards(holy_sheet_src: str) -> None:
    sys.path.insert(0, holy_sheet_src)
    from holy_sheet import agent  # noqa: PLC0415
    from holy_sheet.exceptions import ArchiveRefused  # noqa: PLC0415

    d = HTTP / "request-guards"
    t = Table()

    def g(slug: str, title: str, body: object, expected: object, *, ct: str | None = JSON_CT, cl: object = "auto",
          limits: dict[str, object] | None = None, config: dict[str, object] | None = None,
          headers: dict[str, str] | None = None, **extra: object) -> None:
        h: dict[str, str] = {}
        if ct is not None:
            h["content-type"] = ct
        if cl == "auto":
            if isinstance(body, str):
                h["content-length"] = str(len(body.encode("utf-8")))
            elif isinstance(body, dict) and "hex" in body:
                h["content-length"] = str(len(bytes.fromhex(body["hex"])))  # type: ignore[arg-type]
            elif isinstance(body, dict) and "bytes" in body:
                h["content-length"] = str(body.pop("bytes"))
        elif cl is not None:
            h["content-length"] = str(cl)
        if headers:
            h.update(headers)
        inp: dict[str, object] = {"headers": h, "body": body}
        if limits:
            inp["limits"] = limits
        if config:
            inp["config"] = config
        t.add(slug, title, "guard", inp, expected, **extra)

    # --- pass and scan selection
    g("pass-small", "A small JSON body passes untouched", '{"a":1,"b":[true,null,"x"]}', PASS)
    g("pass-empty", "An empty body passes; the framework decides", "", PASS)
    g("text-not-scanned", "A non-JSON media type is not scanned", "NaN", PASS, ct="text/plain")
    g("no-ct-scanned", "No Content-Type at all IS scanned", '{"x":NaN}', v422([nf("x")]), ct=None,
      notes="FastAPI parses a body with no Content-Type as JSON, so skipping the scan here would let NaN straight through.")
    g("plus-json", "A +json media type is scanned", '{"x":Infinity}', v422([{"error": "not_finite", "message": NF, "field": "x"}]), ct="application/vnd.api+json")
    g("ct-case-params", "The media type is case-insensitive and ignores parameters", '[NaN]', v422([nf("0")]), ct=" Application/JSON ; charset=utf-8")

    # --- size
    g("cl-over", "A declared length over the limit is refused unread", "x" * 32,
      refused(413, env("body_too_large", "This request is 32 bytes, over this endpoint's limit of 16 bytes.", limit={"name": "maxBodyBytes", "max": 16, "actual": 32}), "none"),
      ct="application/octet-stream", limits={"maxBodyBytes": 16},
      notes="bodyRead none: the runner fails the row if ONE body byte was requested. Reading a body to refuse it is the cost the guard exists to avoid.")
    g("cl-huge", "A 20-digit length is refused unread, actual omitted", "x" * 8,
      refused(413, env("body_too_large", "This request is over this endpoint's limit of 16 bytes.", limit={"name": "maxBodyBytes", "max": 16}), "none"),
      ct="application/octet-stream", cl="99999999999999999999", limits={"maxBodyBytes": 16},
      notes="Over 15 digits cannot be held exactly by a double, so it is not echoed as a number.")
    g("cl-letters", "A Content-Length with letters is a 400", "x" * 4,
      refused(400, env("bad_request", "The request could not be understood."), "none"), ct="application/octet-stream", cl="12abc")
    g("cl-negative", "A negative Content-Length is a 400", "x" * 4,
      refused(400, env("bad_request", "The request could not be understood."), "none"), ct="application/octet-stream", cl="-1")
    g("cl-list", "A comma list Content-Length is a 400", "x" * 4,
      refused(400, env("bad_request", "The request could not be understood."), "none"), ct="application/octet-stream", cl="4, 4",
      notes="Two lengths is the request-smuggling shape. Refuse rather than pick one.")
    g("cl-lies-low", "A Content-Length smaller than the body is caught by counting", "x" * 64,
      refused(413, env("body_too_large", "This request is over this endpoint's limit of 32 bytes.", limit={"name": "maxBodyBytes", "max": 32}), "bounded"),
      ct="application/octet-stream", cl="10", limits={"maxBodyBytes": 32},
      notes="A guard that trusts the header passes this. bodyRead bounded: no more than maxBodyBytes + 1 bytes (plus one transport chunk) were requested.")
    g("chunked-over", "No Content-Length, over the limit", "x" * 64,
      refused(413, env("body_too_large", "This request is over this endpoint's limit of 32 bytes.", limit={"name": "maxBodyBytes", "max": 32}), "bounded"),
      ct="application/octet-stream", cl=None, limits={"maxBodyBytes": 32})
    g("at-limit", "Exactly maxBodyBytes passes", '"' + "a" * 14 + '"', PASS, limits={"maxBodyBytes": 16})
    g("one-over", "maxBodyBytes + 1 is refused", '"' + "a" * 15 + '"',
      refused(413, env("body_too_large", "This request is 17 bytes, over this endpoint's limit of 16 bytes.", limit={"name": "maxBodyBytes", "max": 16, "actual": 17}), "none"),
      limits={"maxBodyBytes": 16})
    g("chunked-one-over", "maxBodyBytes + 1 with no Content-Length", '"' + "a" * 15 + '"',
      refused(413, env("body_too_large", "This request is over this endpoint's limit of 16 bytes.", limit={"name": "maxBodyBytes", "max": 16}), "bounded"),
      cl=None, limits={"maxBodyBytes": 16})

    # --- finite numbers
    g("nan", "The NaN literal", '{"items":[NaN]}', v422([nf("items.0")]),
      notes="Python's json.loads ACCEPTS NaN by default, so FastAPI takes it today.")
    g("infinity", "The Infinity literal", '{"a":Infinity}', v422([nf("a")]))
    g("neg-infinity", "The -Infinity literal", '{"a":-Infinity}', v422([nf("a")]))
    g("overflow", "1e400 overflows a double", '{"a":1e400}', v422([nf("a")]),
      notes="Valid JSON grammar. PHP json_decode, Python float() and JS Number() all make it infinity, so a guard checking only the NaN/Infinity tokens misses it.")
    g("neg-overflow", "-1e400", '{"a":-1e400}', v422([nf("a")]))
    g("long-integer", "A 310-digit integer is not finite as a double", '{"a":' + "9" * 310 + "}", v422([nf("a")]),
      notes="Python would parse it as an exact int, but every other runtime and every JS client sees Infinity. The rule is the double's value, stated in SPEC 3.3.")
    g("dbl-max", "DBL_MAX itself is finite", '{"a":1.7976931348623157e308}', PASS)
    g("1e308", "1e308 is finite", '{"a":1e308,"b":-1e308,"c":5e-324}', PASS)
    g("finite-off", "finiteNumbers false lets NaN through", '{"a":NaN,"b":1e400}', PASS, limits={"finiteNumbers": False})
    g("three-in-order", "Several are reported in document order", '{"a":NaN,"b":[1,Infinity],"c":{"d":-1e999}}',
      v422([nf("a"), nf("b.1"), nf("c.d")]))
    g("max-errors", "maxErrors bounds the list", '[NaN,NaN,NaN]', v422([nf("0"), nf("1")]), limits={"maxErrors": 2})
    g("root-nan", "NaN at the root has no field", "NaN", v422([nf(None)]))
    g("lowercase-nan", "nan is not a recognised token", '{"a":nan}', refused(400, env(**MALFORMED)))
    g("nan-in-string", "NaN inside a string is just text", '{"a":"NaN","Infinity":"1e400"}', PASS)
    g("dotted-key", "A key containing a dot is kept verbatim", '{"a.b":[NaN]}', v422([nf("a.b.0")]))
    g("escaped-key", "An escaped key is decoded for the path", '{"\\u0061\\u00e9":NaN}', v422([nf("a" + chr(0xE9))]))
    g("lone-surrogate-key", "A lone surrogate escape in a key becomes U+FFFD", '{"\\ud800":NaN}', v422([nf(chr(0xFFFD))]))

    # --- depth
    g("depth-at-limit", "Exactly maxDepth levels pass", "[" * 32 + "0" + "]" * 32, PASS)
    g("depth-over", "maxDepth + 1 is too_deep at the container's path", "[" * 33 + "0" + "]" * 33,
      v422([deep(".".join(["0"] * 32), 32)]),
      notes="The 33rd container is entered at index 0 of the 32nd, so its path is 32 zeros. Off-by-one in either direction fails this row or the one before.")
    g("depth-object", "Depth through objects", '{"a":{"b":{"c":1}}}', v422([deep("a.b", 2)]), limits={"maxDepth": 2})
    g("depth-bomb", "100,000 open brackets stop at the first level over", "[" * 100000, v422([deep(".".join(["0"] * 32), 32)]),
      notes="The body never closes. The scan stops at level 33, so it never reaches the grammar fault at the end: a bomb costs 33 bytes of work, not 100,000.")

    # --- list length
    g("list-at-limit", "Exactly maxListLength members pass", "[1,2,3]", PASS, limits={"maxListLength": 3})
    g("list-over-root", "maxListLength + 1 at the root has no field", "[1,2,3,4]", v422([long_(None, 3)]), limits={"maxListLength": 3})
    g("object-members", "Object members count too", '{"o":{"a":1,"b":2,"c":3,"d":4}}', v422([long_("o", 3)]), limits={"maxListLength": 3},
      notes="A guard counting arrays only lets a 10-million-key object route straight around the cap.")
    g("duplicate-keys", "Duplicate keys each count", '{"a":1,"a":2,"a":3,"a":4}', v422([long_(None, 3)]), limits={"maxListLength": 3})
    g("bomb-before-garbage", "A list bomb stops the scan before later garbage", "[1,2,3,4, garbage", v422([long_(None, 3)]), limits={"maxListLength": 3})
    g("nan-then-garbage", "A grammar fault after items makes the verdict 400", '[NaN, garbage', refused(400, env(**MALFORMED)),
      notes="Items found before a fault are discarded: a body that is not JSON gets one answer, not a list about the parts that parsed.")
    ten_k = "[" + ",".join(["0"] * 10000) + "]"
    ten_k_one = "[" + ",".join(["0"] * 10001) + "]"
    ref_ok = fixture(d, "list-10000.json", ten_k.encode())
    ref_over = fixture(d, "list-10001.json", ten_k_one.encode())
    g("default-list-at", "10,000 elements pass at the default", dict(ref_ok, bytes=len(ten_k)), PASS)
    g("default-list-over", "10,001 elements are refused at the default", dict(ref_over, bytes=len(ten_k_one)), v422([long_(None, 10000)]))

    # --- malformed
    g("malformed", "An unclosed object", "{", refused(400, env(**MALFORMED)))
    g("bom", "A byte-order mark is refused", {"hex": "efbbbf7b7d"}, refused(400, env(**MALFORMED)))
    g("bad-utf8", "Invalid UTF-8 is refused", {"hex": "7b2261223a2280ff227d"}, refused(400, env(**MALFORMED)))
    g("trailing", "Trailing content after the value", "{} x", refused(400, env(**MALFORMED)))
    g("control-in-string", "A raw control character inside a string", '{"a":"x' + chr(1) + 'y"}', refused(400, env(**MALFORMED)))
    g("single-quotes", "Single quotes are not JSON", "{'a':1}", refused(400, env(**MALFORMED)))
    g("leading-zero", "A leading zero is not JSON", '{"a":01}', refused(400, env(**MALFORMED)))

    # --- request id
    g("rid-untrusted", "An inbound id is ignored by default", "{}", {"pass": True, "requestId": GEN}, headers={"x-request-id": "abc-123"},
      notes="Trusting it by default lets any client choose the id its request is logged under.")
    g("rid-trusted", "A trusted, well-formed inbound id is reused", "{}", {"pass": True, "requestId": "abc-123"},
      headers={"x-request-id": "abc-123"}, config={"trustIncomingRequestId": True})
    g("rid-trusted-bad", "A trusted but malformed id is replaced", "{}", {"pass": True, "requestId": GEN},
      headers={"x-request-id": "abc 123<script>"}, config={"trustIncomingRequestId": True})
    g("rid-trusted-long", "129 characters is replaced", "{}", {"pass": True, "requestId": GEN},
      headers={"x-request-id": "a" * 129}, config={"trustIncomingRequestId": True})
    g("rid-custom-header", "The header name is a setting", "[NaN]",
      v422([nf("0")], rid="corr-9") | {"headers": {"content-type": JSON_CT, "x-correlation-id": "corr-9"}},
      headers={"x-correlation-id": "corr-9"}, config={"trustIncomingRequestId": True, "requestIdHeader": "x-correlation-id"})

    # --- render
    def r(slug: str, title: str, throw: dict[str, object], expected: object, *, config: dict[str, object] | None = None,
          headers: dict[str, str] | None = None, **extra: object) -> None:
        inp: dict[str, object] = {"throw": throw}
        if config:
            inp["config"] = config
        if headers:
            inp["headers"] = headers
        t.add(slug, title, "render", inp, expected, **extra)

    REF = " If it keeps happening, quote reference " + GEN + "."
    r("http-410", "A deliberate 410 keeps the app's sentence", {"kind": "http", "status": 410, "message": "This invite has expired."},
      refused(410, env("gone", "This invite has expired.")))
    r("http-404-bare", "A 404 with no message gets the default", {"kind": "http", "status": 404}, refused(404, env("not_found", "That could not be found.")),
      notes="Starlette fills an empty detail with the reason phrase; that counts as no message.")
    r("http-503-message", "A 5xx message is never used", {"kind": "http", "status": 503, "message": "db down at 10.0.0.4"},
      refused(503, env("unavailable", "The service is unavailable right now." + REF)))
    r("crash", "A crash is a fixed 500", {"kind": "crash", "message": "SQLSTATE[42S02]: Base table or view not found: 1146 Table 'prod.users'"},
      refused(500, env("server_error", "Something went wrong on our side." + REF)),
      notes="Runners also assert the exception text appears NOWHERE in the response bytes, headers included.")
    r("crash-trusted-id", "The reference is the trusted inbound id", {"kind": "crash", "message": "boom"},
      refused(500, env("server_error", "Something went wrong on our side. If it keeps happening, quote reference req-123.", requestId="req-123")),
      config={"trustIncomingRequestId": True}, headers={"x-request-id": "req-123"})
    r("http-429-retry", "A 429 with Retry-After", {"kind": "http", "status": 429, "message": "Too Many Attempts.", "headers": {"Retry-After": "30"}},
      refused(429, env("rate_limited", "Too many requests. Try again in 30 seconds.", retryAfter=30), headers={"retry-after": "30"}))
    r("http-429-bare", "A 429 with no Retry-After", {"kind": "http", "status": 429}, refused(429, env("rate_limited", "Too many requests. Try again shortly.")))
    r("validation-two", "Framework validation, two fields", {"kind": "validation", "errors": [
        {"field": "email", "message": "The email field is required."}, {"field": "items.0.qty", "message": "The qty must be at least 1."}]},
      v422([{"error": "invalid", "message": "The email field is required.", "field": "email"},
            {"error": "invalid", "message": "The qty must be at least 1.", "field": "items.0.qty"}]))
    r("validation-one", "Framework validation, one field", {"kind": "validation", "errors": [{"field": "name", "message": "Field required"}]},
      v422([{"error": "invalid", "message": "Field required", "field": "name"}]))
    r("public-503", "A public 503 keeps its sentence and retry", {"kind": "public", "status": 503, "error": "maintenance", "message": "Back at 14:00 UTC.", "retryAfter": 600},
      refused(503, env("maintenance", "Back at 14:00 UTC.", retryAfter=600), headers={"retry-after": "600"}))
    r("public-bad-code", "A public error with a malformed code is a crash", {"kind": "public", "status": 400, "error": "Bad Code", "message": "Shown?"},
      refused(500, env("server_error", "Something went wrong on our side." + REF)),
      notes="A code nobody can match on is a programming error, so it is treated as one rather than echoed.")
    r("refusal-rows", "holy-sheet refuses on rows", {"kind": "workbook", "limit": "maxRows", "max": 100000, "actual": 150000},
      refused(413, env("workbook_too_large", "This spreadsheet has 150,000 rows, over the limit of 100,000.", limit={"name": "maxRows", "max": 100000, "actual": 150000})))
    r("refusal-part-bytes", "holy-sheet refuses on part bytes", {"kind": "workbook", "limit": "maxPartBytes", "max": 6400000, "actual": 275497997},
      refused(413, env("workbook_too_large", "This spreadsheet needs at least 262.7 MB to open, over the limit of 6.1 MB.", limit={"name": "maxPartBytes", "max": 6400000, "actual": 275497997})))
    r("refusal-ratio", "holy-sheet refuses on compression ratio", {"kind": "workbook", "limit": "maxCompressionRatio", "max": 1000, "actual": 4096},
      refused(413, env("workbook_too_large", "This spreadsheet is compressed too tightly to open safely.", limit={"name": "maxCompressionRatio", "max": 1000, "actual": 4096})))
    r("response-409-location", "An Inertia location 409 is returned untouched", {"kind": "response", "status": 409, "headers": {"X-Inertia-Location": "https://example.com/elsewhere"}},
      {"passthrough": True, "status": 409},
      notes="409 + X-Inertia-Location is Inertia's external-redirect branch. Rewriting it breaks every external redirect.")
    r("response-409-bare", "Inertia's bare version-mismatch 409 is returned untouched", {"kind": "response", "status": 409, "headers": {"X-Inertia": "true"}},
      {"passthrough": True, "status": 409},
      notes="The asset-version mismatch. Wrapping it in an envelope means the app-update banner never fires.")
    r("http-422-message", "A deliberate 422 becomes a one-item list", {"kind": "http", "status": 422, "message": "That date is in the past."},
      v422([{"error": "invalid", "message": "That date is in the past."}]))
    r("http-403-controls", "A 4xx message is sanitised", {"kind": "http", "status": 403, "message": "No" + chr(10) + "entry" + chr(0) + " here."},
      refused(403, env("forbidden", "No entry here.")))
    r("http-418", "An unlisted 4xx", {"kind": "http", "status": 418}, refused(418, env("client_error", "The request could not be completed.")))
    r("http-500-no-message", "A bare 500", {"kind": "http", "status": 500}, refused(500, env("server_error", "Something went wrong on our side." + REF)))
    r("http-502", "A deliberate 502", {"kind": "http", "status": 502, "message": "upstream 10.1.2.3:9000 refused"},
      refused(502, env("upstream_error", "A service this depends on did not respond." + REF)))

    # --- workbookLimits
    t.add("limits-default", "The default profile", "workbookLimits", {"limits": {}},
          {"maxRows": 100000, "maxColumns": 1000, "maxCells": 100000, "maxSharedStrings": 100000,
           "maxArchiveBytes": 1048576, "maxPartBytes": 6400000, "maxExpandedBytes": 25600000})
    t.add("limits-upload", "The upload profile", "workbookLimits", {"limits": {"maxBodyBytes": 10485760}},
          {"maxRows": 100000, "maxColumns": 1000, "maxCells": 100000, "maxSharedStrings": 100000,
           "maxArchiveBytes": 10485760, "maxPartBytes": 6400000, "maxExpandedBytes": 25600000})
    t.add("limits-floors", "A tiny cell cap keeps the part floors", "workbookLimits", {"limits": {"workbook": {"maxCells": 10}}},
          {"maxRows": 100000, "maxColumns": 1000, "maxCells": 10, "maxSharedStrings": 10,
           "maxArchiveBytes": 1048576, "maxPartBytes": 65536, "maxExpandedBytes": 262144},
          notes="64 x 10 cells is 640 bytes, smaller than a real workbook's styles part; without the floor a 10-cell cap would refuse every file.")
    t.add("limits-override", "Rows and columns are set independently", "workbookLimits",
          {"limits": {"maxBodyBytes": 2097152, "workbook": {"maxRows": 500, "maxColumns": 20, "maxCells": 5000}}},
          {"maxRows": 500, "maxColumns": 20, "maxCells": 5000, "maxSharedStrings": 5000,
           "maxArchiveBytes": 2097152, "maxPartBytes": 320000, "maxExpandedBytes": 1280000})

    # --- workbook (holy-sheet does the counting; its counts are measured here)
    # Written ONCE and then kept: holy-sheet stamps the time into docProps, so
    # re-writing it would move the digest on every run for no change in content.
    existing = d / "fixtures" / "five-rows.xlsx"
    if existing.exists():
        data = existing.read_bytes()
    else:
        sheet = agent.from_array([[i, i * 2, "row %d" % i] for i in range(1, 6)], ["n", "double", "label"], "Data")
        data = agent.to_bytes(sheet)
    xlsx = fixture(d, "five-rows.xlsx", data)
    corrupt = fixture(d, "not-a-workbook.xlsx", b"PK\x03\x04 this is not a zip archive")

    def measured(limits: dict[str, int]) -> tuple[str, int, int]:
        try:
            agent.read(data, limits=limits)
        except ArchiveRefused as e:  # ReadLimitExceeded extends it
            return str(e.limit), int(e.max), int(e.actual)
        raise SystemExit("holy-sheet did not refuse " + json.dumps(limits))

    def wb_limits(w: dict[str, int], body: int = 1048576) -> dict[str, int]:
        cells = w.get("maxCells", 100000)
        return {"maxRows": w.get("maxRows", 100000), "maxColumns": w.get("maxColumns", 1000), "maxCells": cells,
                "maxSharedStrings": cells, "maxArchiveBytes": body, "maxPartBytes": max(65536, 64 * cells),
                "maxExpandedBytes": max(262144, 256 * cells)}

    def words(name: str, mx: int, actual: int) -> str:
        c = lambda n: format(n, ",")  # noqa: E731
        return {
            "maxRows": "This spreadsheet has %s rows, over the limit of %s." % (c(actual), c(mx)),
            "maxColumns": "This spreadsheet has %s columns, over the limit of %s." % (c(actual), c(mx)),
            "maxCells": "This spreadsheet has at least %s cells, over the limit of %s." % (c(actual), c(mx)),
        }[name]

    for slug, w in [("rows", {"maxRows": 4}), ("columns", {"maxColumns": 2}), ("cells", {"maxCells": 10})]:
        name, mx, actual = measured(wb_limits(w))
        t.add("workbook-" + slug, "A real workbook over " + name, "workbook", {"limits": {"workbook": w}, "file": xlsx, "field": "file"},
              refused(413, env("workbook_too_large", words(name, mx, actual), limit={"name": name, "max": mx, "actual": actual})),
              notes="The count (%d) is holy-sheet's, measured by running fancy-holy-sheet when this row was written; the sentence is the guard's." % actual)
    name, mx, actual = measured(wb_limits({}, 1024))
    assert name == "maxArchiveBytes", name
    t.add("workbook-archive-bytes", "The body cap becomes holy-sheet's archive cap", "workbook",
          {"limits": {"maxBodyBytes": 1024}, "file": xlsx, "field": "file"},
          refused(413, env("workbook_too_large", "This spreadsheet is %s, over the limit of 1 KB." % ("%s KB" % _kb(actual)),
                           limit={"name": "maxArchiveBytes", "max": 1024, "actual": actual})),
          notes="Pins the derivation: a file the body cap would have refused cannot be read through a looser archive cap.")
    t.add("workbook-pass", "Under every limit it reads", "workbook", {"limits": {}, "file": xlsx, "field": "file"}, {"pass": True})
    t.add("workbook-unreadable", "A file holy-sheet cannot read at all", "workbook", {"limits": {}, "file": corrupt, "field": "upload"},
          v422([{"error": "workbook_unreadable", "message": "This file could not be read as a spreadsheet.", "field": "upload"}]))

    write_json(d / "cases.json", {"$schema": "../../../schema/case-table.schema.json", "suite": "http/request-guards", "cases": t.rows})
    write_json(d / "manifest.json", {
        "$schema": "../../../schema/suite-manifest.schema.json",
        "suite": "http/request-guards",
        "title": "Request guards checked before the body is parsed, the renderer that turns what an app raised into the envelope, and the workbook pairing with holy-sheet",
        "since": SINCE,
        "caseFormat": "table",
        "cases": "cases.json",
        "contract": {
            "functions": {
                "guard": "guard({headers, body, limits?, config?}) -> {pass, requestId?} | {status, headers, body, bodyRead?}",
                "render": "render({throw, config?, headers?}) -> {status, headers, body} | {passthrough, status}",
                "workbookLimits": "workbookLimits(limits) -> holy-sheet limits",
                "workbook": "workbook({limits, file, field}) -> {pass} | {status, headers, body}",
            },
            "summary": "Normative text: suites/http/SPEC.md sections 3 to 5. body is a string (sent as UTF-8), {hex}, or a file reference. \"$generated\" anywhere in an expected string stands for the generated request id: a lowercase UUID v4, the same in the header and the body. bodyRead is reported on body_too_large and bad_request refusals only: none = not one body byte requested; bounded = at most maxBodyBytes + 1 bytes plus one transport chunk. Expected headers are a subset, names lowercase.",
            "reference": "authored",
            "referenceNote": "Authored from suites/http/SPEC.md in scripts/build-http-cases.py on 2026-11-12, before any implementation existed. The workbook rows' counts were measured by running fancy-holy-sheet 0.13.2 from the envelope's sibling checkout; everything else is typed from the spec. tests/http-probe.ts passes every row but the workbook ones, which need holy-sheet.",
            "implementations": [
                {"language": "php", "package": "particle-academy/fancy-http-guard", "symbol": "ParticleAcademy\\HttpGuard\\Http\\Middleware\\GuardRequests"},
                {"language": "python", "package": "fancy-http-guard", "symbol": "fancy_http_guard.GuardMiddleware"},
            ],
        },
        "notes": [
            "The 413/400 rows marked bodyRead none are the reason this suite exists: refusing a body after reading it is what the guard is for avoiding.",
            "PHP-FPM parses multipart and urlencoded bodies before any PHP runs, so those rows use other media types; the Laravel README states the post_max_size arrangement instead.",
            "The workbook rows need holy-sheet in the runner's test environment (first-party). The probe does not run them.",
        ],
    })


def _kb(n: int) -> str:
    """Only for the one archive row, whose actual is a measured file size."""
    tenths = (n * 10 + 512) // 1024
    whole, frac = divmod(tenths, 10)
    return format(whole, ",") + ("." + str(frac) if frac else "")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    error_envelope()
    request_guards(sys.argv[1])
    print("wrote", HTTP)
