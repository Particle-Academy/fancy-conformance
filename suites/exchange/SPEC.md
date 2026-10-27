# Portable content (`fancyContent: 1`): normative specification

Status: normative from fancy-conformance 0.37.0. Written from the APPROVED plan
`.ai/plans/document-exchange-and-export.md` (owner accepted every section 10
recommendation, 2026-10-27), BEFORE any implementation exists. Where this text
and the plan disagree, this text wins and the disagreement is listed in
section 17.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

Every rule below is pinned by a row in one of the `exchange/*` suites or in
`doc-model/shared`. The suite and row are named next to the rule where it
helps a reader find the test.

## 1. Scope

Portable content is the plain-JSON format the four document packages
(holy-sheet, last-word, dark-slide, fine-print) use to move content between
each other. Every reader emits it (`extract`, `toPortable`); every writer
accepts it (`fromPortable`, and an inline `{"type": "portable"}` node). No
package depends on another to do so.

Conformance is defined over pure functions of JSON. File bytes never appear in
a fixture: a reader is tested from its MODEL JSON (what its `read`/`describe`
already returns), and a writer is tested up to its model JSON (what it would
hand its own writer).

## 2. The envelope

```json
{
  "fancyContent": 1,
  "source": { "package": "holy-sheet", "selector": { "sheet": "Q4", "range": "A1:D20", "headerRows": 1 } },
  "items": [ ],
  "images": { },
  "report": { "dropped": [], "approximated": [], "guard": { "findings": [] } }
}
```

| Key | Required | Meaning |
|---|---|---|
| `fancyContent` | yes | The number `1`. Any other value is `content_invalid`. |
| `items` | yes | Array of items (section 3), in reading order. May be empty. |
| `images` | no | Map of image key to image data (section 4). |
| `source` | no | Where the content came from (section 2.1). |
| `report` | no | What was lost or approximated (section 5). Every reader's output carries one. |

Every object in portable content is CLOSED: a key not listed in this
specification is `content_invalid`. Hostile content is the expected case
(section 14), and an open object is a place to hide things.

### 2.1 `source`

A closed object; every key is optional:

| Key | Type | Meaning |
|---|---|---|
| `package` | string | The reader: `holy-sheet`, `last-word`, `dark-slide` or `fine-print`. |
| `kind` | string | The file format read: `xlsx`, `ods`, `docx`, `pptx`, `pdf`, ... |
| `version` | string | The reader package's own version. |
| `sourceKind` | `"document"` or `"model"` | `document` when extracted from file bytes, `model` when converted from an in-memory model. |
| `selector` | any JSON | The NORMALISED selector actually used (section 8), including the `headerRows` value that was applied. |

The model-to-portable functions pinned by the `from-*` suites emit only
`package` and `selector`. `kind`, `version` and `sourceKind` are added by the
package's `extract`, which knows the bytes and its own version; a fixture can
know neither, so no row asserts them.

## 3. Items

Every item has a `type`: `table`, `text`, `list` or `image`.

### 3.1 Table

```json
{ "type": "table", "caption": "Q4 revenue", "headerRows": 1,
  "columns": [ { "width": 0.3 }, { "width": 0.7, "align": "right" } ],
  "rows": [ { "cells": [ { "t": "string", "v": "Region" }, { "t": "string", "v": "Revenue" } ] } ] }
```

| Key | Required | Rule |
|---|---|---|
| `caption` | no | string |
| `headerRows` | no | integer, `0 <= headerRows <= rows.length`; default 0. The first `headerRows` rows are header rows. |
| `columns` | no | array of `{width?, align?}`; when present its length MUST equal the table's grid width. `width` is a number > 0 (a weight; consumers renormalise); `align` is `left`, `center` or `right`. |
| `rows` | yes | non-empty array of `{cells}`; `cells` is a non-empty array of cells. |

**The grid.** Cells are laid out HTML-style, as in last-word and fine-print: a
cell with `colSpan`/`rowSpan` covers that many slots, and covered slots are
ABSENT from the rows that hold them. Laying the rows out left to right, top to
bottom, skipping slots already covered from above, every row MUST fill exactly
the same number of slots (the grid width), and no span may reach below the last
row. A table that does not lay out to a rectangle is `content_invalid` at
`/items/<i>/rows/<r>`: the first row whose width differs from row 0's, or,
for a span reaching below the last row, the row holding that spanning cell.
A cell placed past a covered slot is placed at the next free slot. Integers are JSON
numbers with no fractional part (`2.0` is an integer).

### 3.2 Cells

```json
{ "t": "number", "v": 4820000, "text": "$4,820,000.00",
  "format": { "kind": "currency", "currency": "USD", "decimals": 2 } }
```

| Key | Rule |
|---|---|
| `t` | required: `string`, `number`, `bool`, `date`, `datetime`, `empty`, `error` |
| `v` | the typed value. `string`: a string. `number`: a JSON number. `bool`: a boolean. `date`: `YYYY-MM-DD`, a real calendar date. `datetime`: `YYYY-MM-DDTHH:MM:SSZ`, a real date and time (00-23, 00-59, 00-59). `error`: a string beginning with `#`. `empty`: `v` MUST be absent. Every other `t` requires `v`. |
| `text` | string: the display string formatted by the SOURCE. Omitted when equal to the canonical stringification of `v` (section 6.1). |
| `format` | closed object `{kind, decimals?, currency?}`. `kind`: `number`, `currency`, `percent`, `date`, `datetime`, `text`. `decimals`: integer 0-10. `currency`: three ASCII capitals, allowed only with `kind: "currency"`. |
| `formula` | non-empty string. METADATA ONLY. `v` is the cached computed value; nothing evaluates a formula, ever. |
| `colSpan`, `rowSpan` | integer >= 1 |
| `align` | `left`, `center`, `right` |
| `runs` | array of runs (section 3.3). The concatenation of the run texts MUST equal the cell's display string (`text` when present, else the canonical stringification of `v`); otherwise `content_invalid` at `.../runs`. |

### 3.3 Runs

A closed object: `text` (required string) plus the optional booleans `bold`,
`italic`, `underline`, `strike`, `code`, and an optional `link`.

`link` MUST match fine-print's `LINK_PATTERN`, case-sensitively:

```
^(https?://|mailto:)[!-~]+$
```

(the character class is printable ASCII, 0x21 to 0x7E: no space, no control
character, nothing non-ASCII) and be at most 2048 bytes. Nothing else is a
link: `javascript:`, `file:`, `data:`, a relative path and `HTTP://` are all
`content_invalid`.

### 3.4 Text

`{ "type": "text", "role": "heading" | "paragraph", "level"?, "runs": [run, ...] }`.
`level` (integer 1-6) is required when `role` is `heading` and forbidden
otherwise. `runs` is an array (it MAY be empty).

### 3.5 List

`{ "type": "list", "ordered"?: boolean, "items": [listItem, ...] }`, with
`listItem = { "runs": [run, ...], "children"?: [listItem, ...] }`. `items` is
non-empty; `ordered` defaults to false.

### 3.6 Image

`{ "type": "image", "ref": "<key>", "alt"?: string, "widthPx"?: number > 0, "heightPx"?: number > 0 }`.
`ref` MUST name an entry of `images`. Never a URL, never a path: there is no
key in which to put one.

## 4. The `images` map

Keys match `^[A-Za-z0-9_-]{1,64}$`. Each value is the closed object
`{ "mime": "image/png" | "image/jpeg", "data": "<base64>" }`.

- `data` is standard base64 (RFC 4648 section 4 alphabet, `=` padding, length a
  multiple of 4, no whitespace).
- The decoded bytes MUST begin with the format's magic bytes: PNG
  `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`. A mime that disagrees with the
  bytes is `content_invalid` at `/images/<key>/data`. (Pixel dimensions are
  sniffed by `shared/image-header` when a writer needs them; validation needs
  only the magic.)
- Every entry MUST be referenced by at least one image item. An unreferenced
  entry is `content_invalid` at `/images/<key>`: unreferenced bytes are
  payload nobody reviews.

## 5. The report

```json
{ "dropped": [ { "kind": "chart", "count": 1, "where": ["/sheets/0/charts/0"] } ],
  "approximated": [ { "kind": "format-approximated", "count": 3, "where": ["/sheets/0/cells/B2", "..."] } ],
  "guard": { "findings": [ { "rule": "invisible-chars", "count": 2 } ] } }
```

Every conversion, in both directions, returns a report with all three keys,
even when they are empty. **Dropping or approximating something with an empty
report is a conformance failure.**

- One entry per kind per list, `count >= 1`, entries sorted by `kind` (code-unit
  order).
- `where` is OPTIONAL in a hand-written report and always emitted by the
  pinned conversions: up to the first 16 locations, in document order, each a
  JSON Pointer (RFC 6901) into the INPUT of that conversion (the source model
  for `from-*`, the portable content for `to-*`). A location, NEVER content:
  no report carries a string taken from the document (fine-print's invariant).
- `guard.findings` is `[{rule, count}]`, sorted by `rule`, no `where`.

### 5.1 The closed list of kinds

A kind not on this list is `content_invalid`, and so is a kind in the wrong
list.

| Kind | List | Emitted when |
|---|---|---|
| `cell-style-dropped` | dropped | fill, border, font size, colour, cell padding or valign could not be carried |
| `chart` | dropped | a chart is not carried |
| `comment` | dropped | a cell comment is not carried |
| `composite-element` | dropped | a dark-slide `kpiBand` / `metadataGrid` is not carried |
| `embedded-object` | dropped | an embed, OLE object or macro part is not carried |
| `hidden-column` | dropped | a hidden spreadsheet column is skipped |
| `hidden-element` | dropped | content the source does not display (a hidden slide element, a value under a merge) is skipped |
| `hidden-row` | dropped | a hidden spreadsheet row is skipped |
| `hidden-sheet` | dropped | a hidden or very hidden sheet is skipped |
| `hidden-slide` | dropped | a hidden slide is skipped |
| `image` | dropped | an image that is not a PNG or JPEG data URI is not carried |
| `link` | dropped | a link outside http, https and mailto is removed (its text is kept) |
| `nested-block` | dropped | a block inside a table cell that is not a heading or paragraph |
| `non-table-item` | dropped | a non-table item written into a spreadsheet |
| `run-style-dropped` | dropped | run styling (colour, highlight, size, font, letter spacing, small caps; or every run style on a plain-text target) |
| `shape` | dropped | a slide shape is not carried |
| `table-clipped` | dropped | a table has more rows than its slide frame holds (section 11.3) |
| `cell-truncated` | approximated | a cell string over `limits.cellBytes` was cut |
| `chart-as-table` | approximated | a chart was carried as its data table (host option) |
| `code-as-text` | approximated | a code block became a paragraph of one `code` run |
| `csv-escaped` | approximated | a CSV field was prefixed with `'` (section 12) |
| `format-approximated` | approximated | a foreign number format became `{kind:"number"}` |
| `formula-as-value` | approximated | a formula was written as its value |
| `formula-uncomputed` | approximated | a formula had no cached value; the cell is `empty` |
| `header-rows-flattened` | approximated | header rows beyond the first, or non-leading header rows, became body rows |
| `layout-not-preserved` | approximated | positions, page breaks, rules, paragraph spacing and table geometry |
| `markup-as-text` | approximated | markdown or html source text was kept literally |
| `merge-flattened` | approximated | a merged region was unmerged |
| `merge-unread` | approximated | the reader cannot read merges (dark-slide pptx today) |
| `quote-flattened` | approximated | a quote's blocks were lifted out of it |
| `structure-not-recovered` | approximated | a PDF page was read as text only |
| `typed-as-text` | approximated | a typed value (number, bool, date, datetime, error) became display text |

## 6. Display strings

### 6.1 Canonical stringification

| `t` | canonical(v) |
|---|---|
| `string`, `date`, `datetime`, `error` | `v` itself |
| `number` | `shared/decimal` `formatFloat`: `number_format(v, 14, '.', '')` with trailing zeros and a trailing point removed, `-0` as `0` |
| `bool` | `TRUE` or `FALSE` |
| `empty` | the empty string |

### 6.2 Number display (`exchange/number-display`)

`display(t, v, format?)` is English-only and depends on nothing but its
arguments. Without a format, or with `kind: "text"`, it is canonical(v).

For a number with a format:

1. Take the SHORTEST decimal string that round-trips to `v` (what JavaScript's
   `String(v)` and Python's `repr` produce), written out without an exponent.
2. `percent` multiplies by 100 by moving that decimal point two places, never
   by a floating-point multiply: `0.145` is `14.5`, not `14.499999999999998`.
3. Round to `decimals` places, half AWAY from zero, on those decimal digits
   (`shared/decimal` rounds half away from zero; this is that rule applied to
   the decimal the source shows). So `1.005` at 2 is `1.01`, and `2.675` at 2
   is `2.68`, where a binary `toFixed` gives `1.00` and `2.67`.
4. A result whose digits are all zero has no minus sign.
5. Defaults and layout follow holy-sheet's writer (`NumFmtBuilder`), so a
   display string is what the spreadsheet showed:

| kind | default decimals | grouping | layout |
|---|---|---|---|
| `number` | 0 | `,` every 3 digits | `-1,234.50` |
| `currency` | 2 | `,` every 3 digits | `-$1,234.50`: minus, symbol, digits |
| `percent` | 1 | none | `-12.5%` |

Currency symbols: USD `$`, EUR `€`, GBP `£`, JPY `¥`, CNY `¥`, INR `₹`, AUD `A$`,
CAD `C$`, CHF `CHF`, KRW `₩`; any other code is the code followed by one space
(`SEK 5.00`). No currency means USD. Note CHF has no space (`CHF1.00`), as in
the writer.

For dates: `date` displays `YYYY-MM-DD`; `datetime` displays
`YYYY-MM-DD HH:MM:SS`. A `datetime` value shown with `kind: "date"` displays its
date part; a `date` value shown with `kind: "datetime"` displays `00:00:00`. A
number with a date kind, or a date with a number kind, displays canonical(v).

`bool`, `string`, `error` and `empty` ignore the format.

## 7. Validation (`exchange/content`)

`validateContent(content, options?) -> {ok: true} | {ok: false, code, path}`.
`path` is a JSON Pointer into `content`; the root is the empty string.

Structural failures are all `content_invalid`. The FIRST failure is reported,
checked in this order:

1. `content` is an object; `fancyContent` equals 1 (path `/fancyContent`).
2. Unknown envelope keys, in code-unit order (path `/<key>`).
3. `images`, when present: an object; then each entry in code-unit key order:
   the key pattern (path `/images/<key>`), a closed `{mime, data}`, the mime,
   the base64, the magic bytes (path `/images/<key>/data`).
4. `items`: required array; then each item in order. Within an object, the
   discriminator (`type`, `t`, `role`) first, then unknown keys in code-unit
   order, then the remaining keys in the order the tables above list them; a
   table's grid is checked after all its cells, then `columns` length.
5. Unreferenced `images` entries, in code-unit key order.
6. `source`, then `report`.
7. Limits (section 9), in this order: `items`, `rows`, `columns`, `cells`,
   `images`, `imageBytes`, `stringBytes`.

Options: `{ "limits": { ... } }` only. An unknown option or limit name, or a
limit that is not a positive integer, THROWS rather than returning a result:
bad options are a programming error, not content. In fixtures a throw is
written `{ "throws": "options_invalid" }`.

## 8. Selectors and the range grammar (`exchange/range`)

### 8.1 A1 references

- A cell is `COLUMN ROW`, each optionally preceded by `$`. Letters are
  case-insensitive and normalise to capitals; `$` is dropped.
- Columns run `A` to `XFD` (16384), rows `1` to `1048576`, no leading zero.
- A range is `CELL:CELL`. It normalises to top-left and bottom-right (`D20:A1`
  is `A1:D20`). A single cell `B2` is the range `B2:B2`.
- Whole-column (`A:C`) and whole-row (`1:3`) ranges are NOT accepted in this
  version.

`parseCell("B12") -> {ok, column: 2, row: 12}` (both 1-based).

### 8.2 Sheet names and quoting

- `Sheet!RANGE`. A sheet name that matches `^[A-Za-z_][A-Za-z0-9_.]*$` MAY be
  bare (`Q4!A1:D20`, the plan's own example, although `Q4` also reads as a
  cell); any other name MUST be quoted: `'Q4 2026'!A1:D20`. Inside quotes,
  `''` is one `'`.
- A sheet name is 1-31 characters, contains none of `/ \ ? * [ ] :`, and does
  not begin or end with `'`.
- **A string without `!` is a whole-sheet selector, never a cell.** `"Q4"`
  means the used range of sheet Q4. Without `!` the whole string is the sheet
  name, quoted or not (`"Q4 2026"` and `"'Q4 2026'"` are the same selector).
  A range always names its sheet.

### 8.3 Selector forms (holy-sheet)

| Input | Normalised |
|---|---|
| `"Q4!A1:D20"`, `"'Q4 2026'!A1:D20"`, `{sheet, range}` | `{kind: "range", sheet, start, end}` |
| `"Q4"`, `"'Q4 2026'"`, `{sheet}` | `{kind: "sheet", sheet}` |
| `{name: "Revenue"}` | `{kind: "name", name}` |
| `{table: "Table1"}` | `{kind: "table", table}` |

An object selector MAY carry `headerRows` (integer >= 0), which is copied into
the normalised form. `headerRows` MAY instead be given as an option; given in
both places it is `selector_invalid` (ambiguous intent is refused, not
guessed). A defined name or table name matches
`^[A-Za-z_][A-Za-z0-9_.]{0,254}$`, is not a cell reference, and is not `R` or
`C` (case-insensitive). Anything else, including an unknown object key, is
`{ok: false, code: "selector_invalid"}`.

### 8.4 Header rows (holy-sheet)

`headerRowsFor({selector?, table?, frozenRows?, startRow, rowCount})` picks,
in order:

1. the selector's `headerRows` (`from: "selector"`); more than `rowCount` is
   `selector_invalid`;
2. an Excel table's header row count (`from: "table"`);
3. `frozenRows`, only when the range starts on row 1 (`from: "frozenRows"`),
   clamped to `rowCount`;
4. otherwise 0 (`from: "default"`).

The value used is written into `source.selector.headerRows`.

### 8.5 Other readers

| Reader | Forms | Index base |
|---|---|---|
| last-word | `{table: n}`, `{underHeading: "Results", nth: 0}`, `{blocks: [a, b]}`, `null` | 0-based, `[a, b]` inclusive |
| dark-slide | `{slide: i}`, `{slide: i, element: "<id>"}`, `{slide: i, table: k}`, `{slides: [a, b]}`, `null` | 0-based, inclusive |
| fine-print | `{pages: [a, b]}`, `null` | 1-based PDF page numbers, inclusive |

Array indexes are 0-based because they index a JSON array the agent can see;
PDF pages are 1-based because that is how a page is named everywhere else.
`underHeading` matches the heading's run text exactly, ASCII
case-insensitively; the section ends at the next heading of the same or a
higher level (a smaller or equal `level` number); `nth` counts tables in the
section. Out of range is `selector_not_found`; `a > b` or a malformed
selector is `selector_invalid`.

## 9. Limits

| Name | Default | Code | Measured as |
|---|---|---|---|
| `items` | 5000 | `content_too_many_items` | entries of top-level `items`; path `/items` |
| `rows` | 2000 | `content_too_many_rows` | rows of one table; path `/items/<i>` |
| `columns` | 64 | `content_too_many_columns` | grid width of one table; path `/items/<i>` |
| `cells` | 10000 | `content_too_many_cells` | grid SLOTS (rows x width) summed over every table, so a span does not hide size; path `/items` |
| `images` | 16 | `content_too_many_images` | entries of `images`; path `/images` |
| `imageBytes` | 5242880 | `image_too_large` | decoded bytes of one image; path `/images/<key>`, first in code-unit order |
| `stringBytes` | 4194304 | `content_too_large` | UTF-8 bytes of every string VALUE anywhere under `items` (keys excluded); path is the root |
| `cellBytes` | 32768 | none: truncation | UTF-8 bytes of one cell's string `v` |

A count AT the limit is allowed; one over is refused. A host MAY raise or
lower any limit. A reader whose output exceeds a limit REFUSES with the code;
it never cuts. The one lossy limit is `cellBytes`: a cell string longer than
it is cut to the longest prefix of whole code points that fits, its `runs`
and `text` are removed, and `cell-truncated` is reported.
`truncateCell(text, maxBytes) -> {text, truncated}` is pinned by
`exchange/limits`.

These sit UNDER each package's existing input limits (archive and file-size
limits apply first).

## 10. From each reader (`exchange/from-*`)

Each `toPortable(model, selector, options?)` returns
`{ok: true, content}` or `{ok: false, refused: {reason}}`. Refusal reasons:
`selector_invalid`, `selector_not_found`, `selector_hidden`,
`selector_unsupported`, a limit code, and (fine-print) `source_refused`,
`source_discarded`. Options: `{includeHidden?: boolean, headerRows?: integer, limits?: {...}}`.

Common to every reader:

- **Guard, v1.** Every string taken from the source is stripped of the
  characters fine-print's `AgentReadGuard::INVISIBLE` matches: U+200B-U+200F,
  U+202A-U+202E, U+2060-U+2064, U+2066-U+2069, U+FEFF, U+180E, U+061C and
  U+E0000-U+E007F (Unicode tags). The report counts one `invisible-chars`
  finding per maximal run removed (as `AgentReadGuard` does), never the text.
- **Paragraph split.** Where plain text becomes items (dark-slide text, notes,
  fine-print pages): CRLF and CR become LF; lines are grouped into paragraphs
  separated by one or more blank lines (a blank line holds only spaces and
  tabs); each paragraph is one `text` item of role `paragraph` with one run,
  its lines joined with LF, unchanged otherwise.
- Hidden content is skipped by default and reported; `includeHidden: true` (a
  HOST option) includes it.
- `source` is `{package, selector}`. holy-sheet's `selector` is the normalised
  form of 8.3 plus the resolved `sheet`, `start`, `end` and the applied
  `headerRows`; the other readers' `selector` is the selector as given. A
  `null` selector leaves `selector` out.
- `images` appears only when an image was carried; keys are `img1`, `img2`,
  ... in document order.

### 10.1 holy-sheet

Input: holy-sheet's read model, plus the fields the reader gains for exchange:
sheet `state` (`visible`, `hidden`, `veryHidden`), `hiddenRows` (1-based row
numbers), `hiddenColumns` (0-based column indexes, as `columnWidths` keys
are), `tables` (`[{name, ref, headerRowCount}]`), workbook `definedNames`
(`[{name, ref}]`, `ref` a sheet-qualified range), and `format.formatCode` (the
raw code of a number format the reader does not recognise).

- Sheet and name lookup is ASCII case-insensitive, as Excel's is.
- `null` selector: every visible sheet's used range, one table each, with
  `caption` = sheet name; hidden sheets reported `hidden-sheet`. The used range
  is the bounding box of every cell and merged region; an empty sheet yields no
  item.
- A selector naming a hidden sheet is `selector_hidden`.
- A defined name whose `ref` is not one sheet-qualified range is
  `selector_unsupported`.
- Hidden rows and columns inside the range are skipped (`hidden-row`,
  `hidden-column`, located at their `hiddenRows` / `hiddenColumns` entry).
- A merged region wholly inside the range and touching no hidden row or column
  becomes `colSpan`/`rowSpan`. Any other merged region intersecting the range
  is unmerged (`merge-flattened`): its anchor, when inside, is an ordinary
  cell and the rest are `empty`. A value stored in a covered cell is never
  emitted (`hidden-element`).
- A cell: absent is `{t: "empty"}`. With a `formula`: `v` is `computedValue`
  (a string equal to an Excel error literal `#NULL!`, `#DIV/0!`, `#VALUE!`,
  `#REF!`, `#NAME?`, `#NUM!`, `#N/A`, `#SPILL!`, `#CALC!` is `t: "error"`); no
  `computedValue` is `{t: "empty", formula}` (`formula-uncomputed`). Otherwise
  `value` by JSON type; a string under a `date` / `datetime` displayFormat
  that matches section 3.2's pattern is `t: "date"` / `"datetime"`.
- Format: `number`, `currency`, `percentage` (as `percent`), `date`,
  `datetime`, `text` map across with their `decimals` and `currency`; `auto`
  is no format. A `formatCode` on a number is `{kind: "number"}` and its text
  is canonical(v) (`format-approximated`). Formats are emitted only on
  `number`, `date` and `datetime` cells. `text` is display(t, v, format) when
  it differs from canonical(v).
- `bold`/`italic` become a single run over the display string (when that is
  not empty); `textAlign` becomes `align`; `color`, `backgroundColor`,
  `fontSize` and any border are `cell-style-dropped`; a `comment` is dropped
  (`comment`).
- `columns` appear only when some visible column of the range has a
  `columnWidths` entry; each width is that column's px (64 when unset) divided
  by the sum over the visible columns.
- Charts anchored (`position.from`) inside the range are dropped (`chart`).

### 10.2 last-word

Input: a last-word Doc. Only `blocks` is content; `title`, `page`,
`defaultFont` and `defaultSize` are document properties and are neither
extracted nor reported.

| Block | Becomes | Reported |
|---|---|---|
| heading, paragraph | `text` | paragraph properties: `layout-not-preserved` |
| list | `list` | |
| table | `table` (below) | |
| code | `text` paragraph, one run `{text, code: true}` | `code-as-text` |
| quote | its blocks, in place | `quote-flattened` |
| image (PNG/JPEG data URI) | `image`, keys `img1`, `img2`, ... in order | |
| image (anything else) | nothing | `image` |
| chart | nothing | `chart` |
| pageBreak, hr | nothing | `layout-not-preserved` |

Runs keep `text`, `bold`, `italic`, `underline`, `strike`, `code`, and a
`link` that matches section 3.3; any other link is removed (`link`); `color`,
`highlight`, `size`, `font`, `letterSpacing`, `smallCaps` are
`run-style-dropped`. A false flag is omitted.

Tables: leading `header: true` rows set `headerRows`; a later header row is a
body row (`header-rows-flattened`). A cell's headings and paragraphs give
`v` (their run texts, paragraphs joined by LF) and `t: "string"`, or
`t: "empty"` when that is empty; its `runs` are kept (an LF run between
paragraphs) only when some run carries a flag or link. Other blocks in a cell
are dropped (`nested-block`); cell `shading`, `borders`, `padding`, `valign`
and paragraph properties inside a cell are `cell-style-dropped`. Short rows
are padded with empty cells. `widths` become `columns` (`w / sum`); table
`width`, `align`, `borders`, `cellPadding` are `layout-not-preserved`.

### 10.3 dark-slide

Input: a dark-slide deck, plus slide `hidden` (the reader gains it). Elements
are taken in array order.

| Element | Becomes | Reported |
|---|---|---|
| text (any `format`) | paragraphs (10, paragraph split) of the literal `content` | `markup-as-text` unless `format` is `plain`; `run-style-dropped` when it has a `style` |
| table | `table` (below) | |
| image, `src` a PNG/JPEG data URI | `image` | |
| image, anything else | nothing; the path or URL is NEVER opened | `image` |
| code | `text` paragraph, one `code` run | `code-as-text` |
| chart | nothing | `chart` |
| shape | nothing | `shape` |
| embed | nothing | `embedded-object` |
| kpiBand, metadataGrid | nothing | `composite-element` |
| `hidden: true` element | nothing | `hidden-element` |

Every carried element adds one to `layout-not-preserved` (its position is not
carried). Slide `notes` follow the slide's elements as paragraphs
(`markup-as-text`, notes being markdown). A hidden slide is skipped
(`hidden-slide`); a selector naming one is `selector_hidden`.

Tables: `columns[].label` (else `key`) is a header row, `headerRows: 1`,
unless `style.header` is `false` (no header row, `headerRows: 0`). Rows are
keyed or positional. A scalar is typed by its JSON type (`null` is empty); a
cell spec's `text` is a string cell whose `bold`/`italic` become a run, its
spans are kept, and its `fill`, `color` or other styling is
`cell-style-dropped`. A value in a slot a span covers is `hidden-element`.
Column widths follow dark-slide's own rule (all <= 1 are fractions with the
remainder shared; any > 1 makes weights, unset ones weigh 1) and are emitted
normalised to sum to 1; `align` left/center/right is carried.

### 10.4 fine-print

Input: the result of fine-print's guarded `read()`. `ok: false` is refused
`source_refused`; `guard.discarded: true` is refused `source_discarded`.
Each selected page's `text` becomes paragraphs (10, paragraph split); each page
adds one to `structure-not-recovered`. The read's own `guard.findings` are
counted by `rule` into the report, with the excerpt and location dropped.

## 11. Into each writer (`exchange/to-*`)

Every writer first validates the content (section 7); invalid content is
`{ok: false, refused: {reason: <code>, path}}`. The writer's report locates
into the portable content.

### 11.1 last-word and fine-print (identical; see `doc-model/shared`)

`fromPortable(content) -> {ok, blocks, report}`:

- `text` heading/paragraph -> heading/paragraph with the same runs.
- `list` -> list (`ordered` always written), items with `runs` and `children`
  (when present).
- `image` -> `{type: "image", src: "data:<mime>;base64,<data>"}` plus `alt`,
  `widthPx`, `heightPx`.
- `table` -> a `caption` becomes a paragraph before the table; each row
  `{header: true}` for the first `headerRows`; each cell
  `{blocks: [paragraph]}` whose runs are the cell's `runs`, else one run of
  its display string, else (empty) no runs; `colSpan`/`rowSpan` copied;
  `align` on the paragraph from the cell's `align`, else `right` for a
  NUMERIC column (every non-empty body cell is `number`, as fine-print's
  `Tabulator` does), else none. `widths` = the column widths, only when every
  column has one.
- Every non-empty, non-string cell is `typed-as-text`; every `formula` is
  `formula-as-value`.

### 11.2 holy-sheet

`fromPortable({content, at}) -> {ok, sheet: {cells, mergedRegions?, columnWidths?}, report}`:

- Table items are placed top to bottom from `at`; one empty row separates
  them; a `caption` is a string cell at the table's first row and the table
  starts below it. Any other item is `non-table-item`.
- **Every string is written as the object `{value: s}`**, so the `=`
  promotion in holy-sheet's normaliser can never fire. A `formula` is never
  written: the cell gets its value (`formula-as-value`).
- `number` keeps its value and its format (`percent` as `percentage`);
  `bool` its value; `date`/`datetime` the ISO string with the displayFormat of
  its format, or of its `t` when it has none;
  `error` is a string (`typed-as-text`); `empty` writes no cell.
- `align` becomes `format.textAlign`; any run flag or link is
  `run-style-dropped`.
- Spans become `mergedRegions`. `columnWidths` (0-based keys) only when every
  column has a width: `floor(width / sum x 64 x columns + 0.5)` px.

### 11.3 dark-slide

`fromPortable({element: {id, x, y, w, h, content}}) -> {ok, elements, report}`:

- n items share the frame top to bottom: item i gets
  `y + i * (h / n)` and height `h / n` (computed in that order), the frame's
  `x` and `w`, and id `<id>-<i>`.
- `table` -> `{type: "table", columns: [{key: "col1", label, width?, align?}], rows}`.
  `label` is the first header row's display text (a slot covered by a header
  span gets `""`, `merge-flattened`); `headerRows: 0` writes
  `style: {header: false}`; header rows after the first are body rows of bold
  cell specs (`header-rows-flattened`). Body cells are the display string, or
  `{text, colSpan?, rowSpan?, bold?}` when spanned; covered slots are left out
  of the row. Every typed cell is `typed-as-text`; any run style is
  `run-style-dropped`. Widths are the column widths when every column has one.
  A table with more rows (header included) than `floor(height * 20 + 1e-9)`
  is `table-clipped`, counting the rows over; nothing is removed.
- `text` and `list` -> a text element `{format: "plain", content}`: a list is
  one line per item, `- ` (or `1. `, `2. `, ...) after two spaces per depth;
  run styles are `run-style-dropped`, list structure `layout-not-preserved`.
- `image` -> `{type: "image", src: "data:<mime>;base64,<data>", fit: "contain", alt?}`.
  **Always a data URI**: dark-slide's local-path and `file://` reads are
  unreachable from portable content.

## 12. CSV (`exchange/csv`)

`toCsv(table, options?) -> {text, report}`; options
`{escapeFormulas?: boolean (default true), display?: boolean (default false)}`.

- RFC 4180: fields separated by `,`; EVERY record ends in CRLF; a field is
  quoted when it contains `"`, `,`, CR or LF, with `"` doubled. UTF-8, no BOM.
- A field is canonical(v) by default, or the display string with
  `display: true`. Empty cells are empty fields. Header rows are ordinary
  records.
- **Formula-injection escaping, on by default:** a `string` or `error` field
  beginning with `=`, `+`, `-`, `@`, TAB or CR is prefixed with `'`
  (`csv-escaped`). Numbers are never escaped (`-5` is a number). Escaping
  happens before quoting. The host turns it off with
  `escapeFormulas: false`.
- A span writes its value in the anchor slot and empty fields in the covered
  slots (`merge-flattened`, one per spanned cell).

## 13. Export policy (`exchange/policy`)

Exports are OFF by default, for every target, in every language. Policy is a
host-built value, never agent input:
`{allow: [target, ...], limits?: {...}, pdf?: {fonts?: ...}, modules?: {...}}`.
A null policy allows nothing.

Targets: `csv`, `markdown`, `text`, `html`, `outline`, `xlsx`, `docx`,
`pptx`, `pdf`, `ods`, `odt`. Per reader (section 5.1 of the plan, deferred
ones excluded):

| Reader | Supported, in this order |
|---|---|
| holy-sheet | `csv`, `markdown`, `xlsx`, `pdf`, `docx` |
| last-word | `markdown`, `text`, `html`, `docx`, `pdf` |
| dark-slide | `markdown`, `outline`, `text`, `pptx`, `pdf` |
| fine-print | `text`, `markdown` |

Optional modules: `pdf` needs `fine-print`; holy-sheet's `docx` needs
`last-word`. Detection is per language (class, import, find_spec); a host or
test MAY inject presence through `policy.modules` (`{"fine-print": false}`
forces absence).

`checkExport(request) -> {ok: true} | {ok: false, refused: {reason, target, missing?, cause?}}`
checks, in this order, returning the first failure:

1. `export_unsupported`: the target is not supported by this reader.
2. `export_disabled`: the policy does not allow it.
3. `export_unavailable`: a module it needs is absent; `missing` names it.
4. `export_refused`: reading the input was refused; `cause` is the reader's
   code.
5. A limit code (section 9).

Before any of them, a malformed policy or options THROW (`options_invalid`):
an unknown key, an unknown target name, a non-array `allow`. Policy keys are
`allow`, `limits`, `pdf`, `csv` (`{escapeFormulas}`, the host's switch for
section 12), `includeHidden` and `modules`. Options (what an agent may pass)
are `selector`, `headerRows` and `display`; nothing in them can widen what
the policy allows. **An `allow` in
the agent's options is an unknown option and throws; it never enables
anything.**

`enabledTargets(reader, policy)` lists, in the reader's order, the targets
that are supported, allowed and available: exactly the `target` enum of
`exportToolDefinition(policy)`. A disabled or unavailable target is not shown
to the agent.

## 14. Security rules

1. Formulas: computed values only; never evaluated; never written as a
   formula. Strings enter holy-sheet as `{value: s}`. CSV escapes as in 12.
2. Links: http, https and mailto only (3.3); anything else is removed and
   reported. Nothing is followed.
3. Images: PNG or JPEG bytes in the `images` map, magic-checked, size-capped.
   Never a path or URL; `dark-slide`'s `fromPortable` emits data URIs only.
4. Embedded objects, OLE, macros: never carried (`embedded-object`).
5. Hidden content: hidden sheets, rows, columns, slides and elements, and
   values under a merge, are skipped by default and reported.
6. Injection text, v1: the invisible-character strip of section 10. Phase 2
   moves instruction-pattern detection into fancy-conformance as data.
7. Reports carry locations and counts, never document text.
8. Size: the package's input limits, then section 9.
9. Determinism: every function here is a pure function of its arguments.

## 15. `doc-model/shared`

last-word and fine-print share one document model. `doc-model/shared` pins,
per definition, the property names both declare and the deltas each may
declare alone. The deltas are DELIBERATE and listed here; anything else is
drift and fails a row:

| Definition | last-word only | fine-print only | Why |
|---|---|---|---|
| block types | `chart` | | fine-print draws no charts yet |
| `run.link` | any string | `^(https?://|mailto:)` | a PDF link is an action |
| `run.size`, `defaultSize`, `band.size` | `exclusiveMinimum: 0` | `minimum: 1` (run, defaultSize also `maximum: 400`) | text under 1pt reads as hidden text |
| `page.size` | | | identical enum |

`page.background` and `page.border` are SHARED: last-word gains them
(owner decision 11). Until it does, the `page` row fails for last-word, which
is the point.

## 16. Versioning

This is `fancyContent: 1`. A change that makes previously valid content
invalid, or changes what a valid content means, is version 2. Adding an
optional key or a report kind is not, because readers of version 1 content
validate it CLOSED; a version-1 validator rejects a key it does not know, so
an addition must still bump the minor version of this suite and every
implementation moves together.

## 17. Decisions the plan did not make

Each is a judgement made while writing this text; the owner may overrule any
of them, and the affected rows are named in the suite notes.

1. Closed objects everywhere (2). The plan does not say; open objects would let
   hostile content ride along unvalidated.
2. Report kinds added to the closed list: `hidden-slide`, `hidden-element`,
   `image`, `nested-block`, `quote-flattened`, `markup-as-text`,
   `composite-element`, plus `cell-truncated` (plan 3.3) and
   `embedded-object` (plan 8), which the plan uses but section 7's table does
   not list. Every one is a loss the plan requires be reported but names no
   kind for.
3. Report shape: all three keys always present; `where` is a capped list of
   JSON Pointers into the conversion's input, rather than a free-form
   location.
4. `runs` allowed on any cell, and must concatenate to the display string, so
   a bold number keeps its bold (the plan lists bold as surviving xlsx).
5. Range grammar: a bare `"Q4"` is a sheet, never a cell (8.2); no whole-row or
   whole-column ranges; reversed ranges normalise.
6. `headerRows` in both the selector and the options is refused.
7. Index bases: 0-based for JSON arrays, 1-based for PDF pages; all ranges
   inclusive.
8. `cells` limit counts grid slots, not cell objects.
9. `stringBytes` counts every string value under `items`.
10. Number display: decimals defaults and layout from holy-sheet's
    `NumFmtBuilder`; rounding half away from zero on the shortest decimal.
    PHP's `number_format` agrees on every number and currency row (checked by
    `cross-check`). For percent it agrees only once the x100 is done on the
    decimal string: `number_format(0.145 * 100, 0)` is `14`, where the spec
    (and Excel) show `15%` (`exchange/number-display/0203`). A PHP
    implementation must not multiply.
11. CSV writes canonical values, not display strings, by default; numbers are
    never escaped.
12. `enabledTargets` excludes an allowed target whose module is absent.
13. dark-slide `table-clipped` reports and does not cut; frames divide
    evenly.
14. `source.version`, `kind` and `sourceKind` are not asserted by fixtures.
15. Notes from dark-slide are ordinary paragraphs; fine-print paragraphs carry
    no page number (the report's `where` locates pages).
16. Two model deltas the plan did not list (run/band/default size minimums)
    are pinned as deliberate in `doc-model/shared`, with the same rationale as
    fine-print's link rule.
