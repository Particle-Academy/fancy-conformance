import assert from "node:assert/strict";
import { test } from "node:test";

import { type ConformanceCase, listSuites, runTable } from "../src/index";
import { type Mutations, RUNNERS } from "./exchange-probe";

/**
 * Do the exchange/* and doc-model/shared rows CATCH a wrong implementation?
 *
 * The rows were written by hand from suites/exchange/SPEC.md before any
 * implementation existed, so nothing has yet shown they are satisfiable or
 * that they discriminate. tests/exchange-probe.ts is a compact, mutable
 * reading of the spec:
 *
 *   - the CONTROL (no mutation) must pass every row of every suite; without it
 *     a mutant "failing rows" proves nothing, because the rows might simply be
 *     unreachable;
 *   - each MUTANT is a mistake a competent port author would plausibly make,
 *     and must fail EXACTLY the ids listed -- not "some rows". An id appearing
 *     or disappearing from a set is a change to what the suite pins.
 *
 * Ids are written by their 4-digit prefix, which is unique within a suite.
 */

const SUITES = Object.keys(RUNNERS);

function run(suite: string, m: Mutations) {
  const impl = RUNNERS[suite]!;
  return runTable(suite, (c: ConformanceCase) => impl(c as never, m), { language: "node" });
}

function failed(suite: string, m: Mutations): string[] {
  return run(suite, m)
    .results.filter((r) => r.status === "fail")
    .map((r) => r.id.slice(0, 4))
    .sort();
}

test("every exchange suite and doc-model/shared has a probe", () => {
  const shipped = listSuites().filter((s) => s.startsWith("exchange/") || s.startsWith("doc-model/"));
  assert.deepEqual([...shipped].sort(), [...SUITES].sort());
  assert.equal(SUITES.length, 16);
});

for (const suite of SUITES) {
  test(`control: a faithful probe passes every row of ${suite}`, () => {
    const s = run(suite, {});
    assert.equal(s.failed, 0, JSON.stringify(s.results.filter((r) => r.status === "fail"), null, 1));
    assert.equal(s.skipped, 0);
    assert.ok(s.passed > 0);
  });
}

const MUTANTS: Array<[string, string, string, string[]]> = [
  // exchange/content
  ["exchange/content", "open objects: unknown keys carried", "openObjects", ["0005", "0008", "0038", "0051"]],
  ["exchange/content", "a date checked by pattern only", "noCalendar", ["0011"]],
  ["exchange/content", "a case-insensitive link scheme", "linkCaseInsensitive", ["0019"]],
  ["exchange/content", "the link checked by prefix only (as last-word's JSON schema does)", "linkPrefixOnly", ["0020"]],
  ["exchange/content", "runs not checked against the display string", "noRunsConcat", ["0016"]],
  ["exchange/content", "no magic-byte check", "noMagic", ["0030"]],
  ["exchange/content", "unreferenced images allowed", "allowUnreferenced", ["0033"]],
  ["exchange/content", "a pointer built without RFC 6901 escaping", "noPointerEscape", ["0034"]],
  ["exchange/content", "limits checked before structure", "limitsFirst", ["0053"]],
  ["exchange/content", "no grid check", "noGridCheck", ["0022", "0023", "0025"]],
  ["exchange/content", "images checked after items", "imagesAfterItems", ["0052"]],
  ["exchange/content", "any report kind accepted", "anyKind", ["0035", "0036"]],
  ["exchange/content", "bad options ignored instead of thrown", "lenientOptions", ["0046"]],
  // exchange/limits
  ["exchange/limits", "string bytes counted as UTF-16 units", "charLength", ["0017"]],
  ["exchange/limits", "image size measured on the base64", "base64Length", ["0012", "0014"]],
  ["exchange/limits", ">= where the spec says >", "limitOffByOne", ["0001", "0003", "0004", "0006", "0008", "0010", "0012", "0016", "0021"]],
  ["exchange/limits", "columns counted as cell objects", "columnsByCells", ["0005"]],
  ["exchange/limits", "cells counted as cell objects, not grid slots", "countCellObjects", ["0007"]],
  ["exchange/limits", "truncation in UTF-16 units", "truncateUtf16", ["0103", "0104"]],
  ["exchange/limits", "bad limits ignored instead of thrown", "lenientOptions", ["0023", "0024", "0025", "0026"]],
  // exchange/range
  ["exchange/range", "a bare cell-shaped string read as a cell", "bareIsCell", ["0105"]],
  ["exchange/range", "a reversed range swapped, not normalised per axis", "noCornerNormalise", ["0109"]],
  ["exchange/range", "ranges never normalised", "noReverse", ["0108", "0109"]],
  ["exchange/range", "0-based columns", "zeroBasedColumn", ["0001", "0002", "0003", "0004", "0005", "0011", "0101", "0102", "0103", "0108", "0109", "0110", "0201", "0209", "0210"]],
  ["exchange/range", "'' not unescaped inside quotes", "noDoubledQuote", ["0103"]],
  ["exchange/range", "a leading zero in a row number", "allowLeadingZero", ["0007"]],
  ["exchange/range", "frozenRows applied below row 1", "frozenAnyRow", ["0306"]],
  ["exchange/range", "frozenRows not clamped", "frozenNoClamp", ["0307"]],
  ["exchange/range", "a table's 0 header rows falls through to frozenRows", "tableZeroFallsThrough", ["0304"]],
  ["exchange/range", "headerRows in both places accepted", "headerRowsTwiceOk", ["0211"]],
  // exchange/number-display
  ["exchange/number-display", "binary toFixed rounding", "binaryRound", ["0004", "0005", "0010", "0011", "0203"]],
  ["exchange/number-display", "half-even rounding", "halfEven", ["0002", "0003", "0004", "0006", "0007", "0008", "0106", "0203", "0204", "0205"]],
  ["exchange/number-display", "percent by float multiply", "floatPercent", ["0203"]],
  ["exchange/number-display", "a signed zero", "signedZero", ["0009", "0107"]],
  ["exchange/number-display", "grouped percent", "groupPercent", ["0204"]],
  ["exchange/number-display", "the number's String() kept in exponent form", "exponentString", ["0011", "0012", "0013"]],
  ["exchange/number-display", "a space after every currency symbol", "currencySpace", ["0101", "0102", "0103", "0104", "0106", "0107", "0108", "0109"]],
  // exchange/from-holy-sheet
  ["exchange/from-holy-sheet", "hidden sheets, rows and columns read", "readHidden", ["0005", "0007", "0008"]],
  ["exchange/from-holy-sheet", "an uncached formula's stale value trusted", "uncachedAsValue", ["0032"]],
  ["exchange/from-holy-sheet", "a crossing merge clipped instead of unmerged", "noFlatten", ["0010"]],
  ["exchange/from-holy-sheet", "covered cells emitted", "emitCovered", ["0009", "0011"]],
  ["exchange/from-holy-sheet", "invisible characters counted, not runs", "countChars", ["0015"]],
  ["exchange/from-holy-sheet", "no error type", "noErrorType", ["0004"]],
  ["exchange/from-holy-sheet", "case-sensitive lookup", "caseSensitive", ["0018", "0025"]],
  ["exchange/from-holy-sheet", "a string starting = read as a formula", "stringPromoted", ["0026"]],
  ["exchange/from-holy-sheet", "a foreign format displayed at the approximated default", "formatForeign", ["0013"]],
  ["exchange/from-holy-sheet", "no invisible-character strip", "noStrip", ["0015"]],
  // exchange/from-last-word
  ["exchange/from-last-word", "every link kept", "keepAllLinks", ["0003"]],
  ["exchange/from-last-word", "a heading section that never ends", "noSectionEnd", ["0014"]],
  ["exchange/from-last-word", "an exclusive block range", "exclusiveRange", ["0015"]],
  ["exchange/from-last-word", "every header row counted", "allHeaderRows", ["0006"]],
  ["exchange/from-last-word", "cell runs always emitted", "runsAlways", ["0004", "0005", "0006", "0007", "0008", "0011", "0013", "0015", "0019", "0020"]],
  ["exchange/from-last-word", "invisible characters counted, not runs", "countChars", ["0022"]],
  // exchange/from-dark-slide
  ["exchange/from-dark-slide", "hidden slides and elements read", "readHidden", ["0008", "0013"]],
  ["exchange/from-dark-slide", "a path or URL image dropped without a report", "silentImages", ["0006"]],
  ["exchange/from-dark-slide", "values under a span emitted", "emitCovered", ["0004"]],
  ["exchange/from-dark-slide", "widths copied raw", "rawWidths", ["0003", "0015"]],
  ["exchange/from-dark-slide", "notes left out", "noNotes", ["0009"]],
  ["exchange/from-dark-slide", "no invisible-character strip", "noStrip", ["0017"]],
  // exchange/from-fine-print
  ["exchange/from-fine-print", "0-based page numbers", "zeroBasedPages", ["0002", "0006"]],
  ["exchange/from-fine-print", "findings counted with their excerpt", "excerptFindings", ["0003", "0009"]],
  ["exchange/from-fine-print", "the read's text trusted unstripped", "noOwnStrip", ["0009"]],
  ["exchange/from-fine-print", "every line its own paragraph", "singleNewlineSplits", ["0001"]],
  // exchange/to-last-word, exchange/to-fine-print (the same rows)
  ...(["exchange/to-last-word", "exchange/to-fine-print"] as const).flatMap((s): Array<[string, string, string, string[]]> => [
    [s, "no numeric right-alignment", "noNumericAlign", ["0002", "0004", "0007", "0010"]],
    [s, "the header row left out of the numeric alignment", "headerExcludedFromAlign", ["0002", "0010"]],
    [s, "widths from a partial column list", "widthsPartial", ["0009"]],
  ]),
  // exchange/to-holy-sheet
  ["exchange/to-holy-sheet", "a formula written as a formula", "writeFormula", ["0003"]],
  ["exchange/to-holy-sheet", "a string starting = written as a formula", "promoteEquals", ["0002"]],
  ["exchange/to-holy-sheet", "at ignored", "noOffset", ["0004"]],
  // exchange/to-dark-slide
  ["exchange/to-dark-slide", "an image src that is not a data URI", "refSrc", ["0008"]],
  ["exchange/to-dark-slide", "capacity floored without the epsilon", "noEpsilon", ["0012"]],
  ["exchange/to-dark-slide", "a spanned header label repeated", "repeatSpanLabel", ["0005"]],
  ["exchange/to-dark-slide", "the generated header kept when headerRows is 0", "keepHeaderOnZero", ["0002"]],
  ["exchange/to-dark-slide", "y computed as y + (i x h) / n", "multiplyFirst", ["0013"]],
  // exchange/report-kinds
  ["exchange/report-kinds", "kinds case-insensitive", "caseInsensitiveKinds", ["0102"]],
  ["exchange/report-kinds", "cell-style-dropped filed as approximated", "swapCellStyle", ["0001"]],
  ["exchange/report-kinds", "where never capped", "noWhereCap", ["0202"]],
  // exchange/policy
  ["exchange/policy", "disabled checked before unsupported", "disabledFirst", ["0003"]],
  ["exchange/policy", "refused checked before unavailable", "refusedFirst", ["0009"]],
  ["exchange/policy", "an agent's allow honoured", "agentAllow", ["0012"]],
  ["exchange/policy", "unavailable targets shown to the agent", "showUnavailable", ["0101", "0104"]],
  ["exchange/policy", "an injected module ignored", "ignoreInjected", ["0006", "0104"]],
  // exchange/csv
  ["exchange/csv", "numbers escaped", "escapeNumbers", ["0004"]],
  ["exchange/csv", "no formula-injection escaping", "noEscape", ["0003", "0004", "0011"]],
  ["exchange/csv", "quoted before escaping", "quoteThenEscape", ["0003", "0011"]],
  ["exchange/csv", "LF records", "lfRecords", ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012"]],
  ["exchange/csv", "display strings by default", "displayDefault", ["0006"]],
  // doc-model/shared
  ["doc-model/shared", "last-word as it is today, without page.background/border", "lastWordToday", ["0002", "0003"]],
  ["doc-model/shared", "fine-print accepting chart", "finePrintChart", ["0005"]],
  ["doc-model/shared", "the link rule converged (a deliberate delta erased)", "linkConverged", ["0101"]],
  ["doc-model/shared", "the size rule converged (a deliberate delta erased)", "sizeConverged", ["0102"]],
];

for (const [suite, name, flag, expected] of MUTANTS) {
  test(`mutant (${suite}): ${name} -- fails exactly ${expected.length} row(s)`, () => {
    assert.deepEqual(failed(suite, { [flag]: true }), [...expected].sort());
  });
}

test("every suite has at least one mutant", () => {
  const covered = new Set(MUTANTS.map(([s]) => s));
  for (const s of SUITES) assert.ok(covered.has(s), `${s} has no mutant`);
});
