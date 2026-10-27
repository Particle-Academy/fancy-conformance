# fine-print suites: the contract

Normative text for every `fine-print/*` suite. The reference implementation is
`particle-academy/fine-print` (PHP); the ports are `@particle-academy/fine-print`
(`fine-print-js`) and `fancy-fine-print` (`fine-print-py`). The plan is the
envelope's `.ai/plans/fine-print-ports.md`.

## 1. Where the rows come from

Every row is EXPORTED from PHP by `fine-print/tests/Conformance/Export.php`
(`composer conformance:export`). Every golden is the output of running PHP,
never what a value obviously is. A port never regenerates a row, and nobody
edits one by hand: change the exporter, re-export, and let fine-print's
`DriftTest` and this repository's tests see the difference.

Case ids are `NNNN-slug` in the order the exporter adds rows, and are never
renumbered. A new row goes at the end of its suite.

## 2. File references

Bytes that do not fit a JSON cell (PDFs, fonts) live in the suite's `fixtures/`
directory and a row names them:

```json
{ "file": "fixtures/0041-host-font.pdf.gz", "sha256": "<64 lowercase hex>" }
```

- An object is a reference when its `file` member is a STRING starting
  `fixtures/`. Any other `file` member is ordinary data. (The hostile-keys row
  carries `{"type": "launch", "file": "calc.exe"}` as model data.)
- A reference has exactly the members `file` and `sha256`. The name is flat,
  made of `A-Z a-z 0-9 . _ -`, and does not start with a dot.
- A name ending `.gz` is a single gzip member and resolves to its DECOMPRESSED
  bytes. `sha256` is the digest of the resolved bytes, so the compression of
  the stored file is never part of the contract.
- References may sit in `input`, `expected` or `artifacts`. Every loader checks
  shape and existence at load time and the digest in `fixtureBytes()`
  (`fixture_bytes()` in Python and Rust).

A runner replaces every reference in `input` with `fixtureBytes(...)` before
calling the implementation.

`artifacts` is never compared. In `writer-bytes` it holds PHP's own output
(`artifacts.pdf`) so a failing port can diff against it: the raw PDF for a
raw-tier row, `canon()` of the PDF for a canon-tier row. A runner must never
derive its answer from an artifact.

## 3. canon(): a writer PDF with its compression taken out

Three runtimes ship three deflaters. PHP has zlib, Node has Chromium's fork,
and CPython on Windows has zlib-ng (measured in plan section 4, W0.3). Their
compressed bytes differ for the same input, so a PDF containing any deflated
stream cannot be compared raw. canon() is defined ONLY on the output grammar of
the fine-print writer (`Writer/Pdf/PdfFile.php`), and on anything else it must
fail:

1. **Header.** Copy every byte before the first `1 0 obj\n` as it is.
2. **Objects.** Repeat while the next bytes are `<n> 0 obj\n` (decimal `n`):
   - copy that line, then read one line `L` (up to, not including, the next
     `\n`);
   - **Stream.** If `L` ends `/Length <d> >>` and the next 7 bytes after the
     newline are `stream\n`, then the data is EXACTLY `d` bytes, and the
     18 bytes after them are `\nendstream\nendobj\n`. Never search for
     `endstream`. If `L` contains `/Filter /FlateDecode`, replace the data with
     its zlib (RFC 1950) inflation, and replace the final `/Length <d> >>` of `L`
     with `/Length <inflated length> >>`. Emit
     `L \n stream\n data \nendstream\nendobj\n`;
   - **Otherwise.** The body runs to the next `\nendobj\n`. Copy it, with that
     terminator, unchanged.
3. **Cross-reference.** The next 5 bytes must be `xref\n`. Drop everything up to
   `trailer\n`. The offsets move whenever a length does.
4. **Trailer.** Keep the dictionary between `trailer\n` and `\nstartxref\n`,
   replacing its first `/ID [<32 hex> <32 hex>]` with `/ID [<> <>]`. The
   writer's ID is an md5 over the body INCLUDING the compressed bytes, so it
   differs whenever deflate does.
5. **End.** What follows must be `\nstartxref\n<digits>\n%%EOF\n` and end the
   file. Emit `trailer\n` + dictionary + `\n%%EOF\n`.

Inflating a PNG passed through with `/DecodeParms << /Predictor 15 ... >>`
yields the PNG-filtered scanlines, not pixels. canon() never un-predicts. The
filter bytes the writer chose are part of the contract.

## 4. Suites

### 4.1 `fine-print/php-semantics`

The PHP behaviours a port must reproduce rather than borrow from its platform.
Each port carries a `php` helper module (as `holy-sheet-py` does) whose
functions these rows pin:

| fn | PHP | input | expected |
|---|---|---|---|
| `num` | `Syntax::num` (`sprintf('%.4F')`, trimmed) | `value` | string |
| `rgb` | `Syntax::rgb` (`round(x / 255, 4)`) | `hex` | `[r, g, b]` |
| `rgbMany` | the same, 256 values in one row | `hexes` | list of triples |
| `numberFormat` | `number_format($v, $d)` | `value`, `decimals` | string |
| `text` | `Syntax::text` (UTF-16BE + BOM, hex) | `utf8Base64` | string |
| `name` | `Syntax::name` | `bytesBase64` | string |
| `validUtf8` | `Syntax::validUtf8` (`mb_convert_encoding` substitution) | `bytesBase64` | base64 |
| `winAnsi` | `StandardFont::encode` | `text` | lowercase hex |

Measured on PHP 8.4: `%.4F` rounds an EXACT decimal tie half-to-even
(`0.03125` gives `0.0312`, `0.09375` gives `0.0938`). `number_format` rounds
half away from zero after PHP's pre-rounding (`2.675` gives `2.68`, `1.005`
gives `1.01`). Neither is what `toFixed` or Python's `format` does on every
input. The rows are the arbiter.

### 4.2 `fine-print/writer-model`

The model functions: `validate`, `validateAndRepair`, `fromArray`, `describe`,
`lint`, `jsonSchema`, and `guide`, whose expected value is
`{sha256: sha256(guide with CRLF -> LF)}`. Results compare as values, so key
order is free.

**The PHP empty-object rule.** PHP decodes `{}` and `[]` to the same value and
encodes both as `[]`, so a golden written by PHP shows `[]` wherever PHP held an
empty object (`repair-decoration`: `"border": []`). A port's runner replaces
every EMPTY object in its result with an empty list before comparing. Nothing
else is normalised. This is `shared/value-equality/0210`'s blind spot, declared
here once rather than worked around per row.

`lint` rows whose golden contains a `guard:*` finding need the READER (lint
writes the PDF and reads it back). They carry a `node`/`python` skip until
phase R, and the skip is the only one the writer phase allows.

### 4.3 `fine-print/writer-bytes`

`toBytes(doc, options)`. A runner resolves the references in `input.options`
(host fonts), writes the PDF, and returns `fingerprint(pdf, input.tier)`:

| tier | when | fingerprint |
|---|---|---|
| `raw` | the PDF contains no `/FlateDecode` at all | `{tier, sha256, length, canonSha256}` |
| `canon` | it contains any | `{tier, canonSha256, canonLength}` |

`sha256` and `length` are of the PDF as written. `canonSha256` and
`canonLength` are of `canon(pdf)`. A raw-tier row is strict byte identity,
including the md5 file ID. A canon-tier row is identity after section 3.
The tier is decided by PHP's output and written into the row. A port that
emits `/FlateDecode` on a raw-tier row fails it, as it should.

Canon-tier goldens never carry a raw hash: PHP's own deflate differs between
zlib builds, so a raw hash would fail PHP on another machine.

## 5. Tolerances (render suites, phase X)

Numbers in these suites compare EXACTLY, the repository default. The renderer
suites (`render-exact`, `render-golden`) will compare pixels, and a row that is
not bit-exact across runtimes (libm: `hypot`, `sin`, `cos`, `pow`, `log`,
`fmod`) declares its tolerance ON THE ROW, never globally:

```json
"expected": { "width": 200, "height": 150, "complete": true, "skipped": [],
              "rgbSha256": "...",
              "pixelTolerance": { "maxChannelDelta": 1, "maxPixels": 12,
                                  "reason": "sin/cos in the arc flattener (measured W0)" } }
```

- With no `pixelTolerance`, `rgbSha256` must match: exact pixels.
- With one, the runner compares decoded RGB against the row's pixel artifact
  (a file reference). At most `maxPixels` pixels may differ, each by at most
  `maxChannelDelta` per channel. `reason` is required and non-empty, like a
  skip's.
- A tolerance is added only where W0 or a later phase MEASURED a divergence,
  and the measurement is cited in `reason`.

Those manifests arrive with their rows. Every loader refuses a suite with no
cases, so a suite is not declared before it has rows.
