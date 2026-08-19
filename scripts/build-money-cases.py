"""Generate `suites/shared/money-minor-units/cases.json`.

The goldens are exact decimal arithmetic, produced by the reference
implementation's own approach (`decimal.Decimal`) rather than typed by hand --
which is this repository's rule: "goldens come from running the reference
implementation, never from what the value obviously is".

Re-run and commit the result when a case is added. It is a generator rather than
a hand-edited file for one row in particular: 0011's expected value is 15 digits
and typing it is exactly the kind of thing that goes wrong silently.

    python scripts/build-money-cases.py
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path
from typing import Any

OUT = Path(__file__).resolve().parent.parent / "suites" / "shared" / "money-minor-units"


def to_minor(amount: str, exponent: int) -> int:
    """The reference conversion: exact decimal scaling, never a float."""
    scaled = Decimal(amount).scaleb(exponent)
    if scaled != scaled.to_integral_value():
        raise ValueError(f"{amount!r} carries more precision than exponent {exponent} allows")
    return int(scaled)


def format_minor(minor: int, exponent: int) -> str:
    """The reference inverse: sign in front, fraction zero-padded to the width."""
    if exponent == 0:
        return str(minor)
    sign = "-" if minor < 0 else ""
    digits = str(abs(minor)).rjust(exponent + 1, "0")
    return f"{sign}{digits[:-exponent]}.{digits[-exponent:]}"


cases: list[dict[str, Any]] = []


def add(
    case_id: str,
    title: str,
    fn: str,
    inp: dict[str, Any],
    expected: Any,
    tags: list[str],
    notes: str | None = None,
) -> None:
    row: dict[str, Any] = {
        "id": case_id,
        "title": title,
        "since": "0.4.0",
        "tags": tags,
        "fn": fn,
        "input": inp,
        "expected": expected,
    }
    if notes:
        row["notes"] = notes
    cases.append(row)


# -- toMinorUnits ----------------------------------------------------------

add(
    "0001-to-minor-classic-float-trap",
    "toMinorUnits of '19.99' at exponent 2 is 1999, not 1998",
    "toMinorUnits",
    {"amount": "19.99", "exponent": 2},
    to_minor("19.99", 2),
    ["toMinorUnits", "hazard", "float"],
    "THE money bug. int(19.99 * 100) is 1998 in every IEEE-754 language: the nearest double to "
    "19.99 is 19.98999999999999843..., and truncation takes the 1998. One cent, on every order.",
)
add(
    "0002-to-minor-round-rescues-this-one",
    "toMinorUnits of '0.07' at exponent 2 is 7",
    "toMinorUnits",
    {"amount": "0.07", "exponent": 2},
    to_minor("0.07", 2),
    ["toMinorUnits", "float", "control"],
    "0.07 * 100 is 7.000000000000001 as a double, so truncation gives 7 here by luck. The "
    "control row: an implementation that fixes 0001 by swapping trunc for round still passes "
    "this and still fails 0003.",
)
add(
    "0003-to-minor-round-does-not-rescue-this-one",
    "toMinorUnits of '8.615' at exponent 3 is 8615",
    "toMinorUnits",
    {"amount": "8.615", "exponent": 3},
    to_minor("8.615", 3),
    ["toMinorUnits", "hazard", "float"],
    "8.615 * 1000 is 8614.999999999999 as a double, so BOTH truncation and a naive round give "
    "8614. The only way through is not to use a float at all. This is the row that forces exact "
    "decimal arithmetic rather than a rounding tweak.",
)
add(
    "0004-to-minor-kuwaiti-dinar",
    "toMinorUnits of '1.005' at exponent 3 is 1005",
    "toMinorUnits",
    {"amount": "1.005", "exponent": 3},
    to_minor("1.005", 3),
    ["toMinorUnits", "exponent"],
    "KWD, BHD and JOD have three minor digits. A hard-coded 100 turns 1.005 dinars into 100 "
    "fils and undercharges by a factor of ten.",
)
add(
    "0005-to-minor-yen",
    "toMinorUnits of '1000' at exponent 0 is 1000",
    "toMinorUnits",
    {"amount": "1000", "exponent": 0},
    to_minor("1000", 0),
    ["toMinorUnits", "exponent"],
    "JPY has no minor unit. A hard-coded 100 charges a hundred times the price.",
)
add(
    "0006-to-minor-negative",
    "toMinorUnits of '-19.99' at exponent 2 is -1999",
    "toMinorUnits",
    {"amount": "-19.99", "exponent": 2},
    to_minor("-19.99", 2),
    ["toMinorUnits", "sign"],
    "A refund line. abs(f(-x)) == abs(f(x)) is the property that matters for money, and it is "
    "the first thing to break when an implementation reaches for floor().",
)
add(
    "0007-to-minor-zero",
    "toMinorUnits of '0' at exponent 2 is 0",
    "toMinorUnits",
    {"amount": "0", "exponent": 2},
    to_minor("0", 2),
    ["toMinorUnits"],
)
add(
    "0008-to-minor-one-decimal",
    "toMinorUnits of '0.1' at exponent 2 is 10",
    "toMinorUnits",
    {"amount": "0.1", "exponent": 2},
    to_minor("0.1", 2),
    ["toMinorUnits"],
    "Fewer decimals than the currency has: the value is scaled, not padded as text.",
)
add(
    "0009-to-minor-trailing-zero",
    "toMinorUnits of '8.20' at exponent 2 is 820",
    "toMinorUnits",
    {"amount": "8.20", "exponent": 2},
    to_minor("8.20", 2),
    ["toMinorUnits", "parse"],
    "A trailing zero is significant to a text parser and irrelevant to the value. 82 is what a "
    "strip-the-dot-and-parse implementation returns.",
)
add(
    "0010-to-minor-leading-dot",
    "toMinorUnits of '.5' at exponent 2 is 50",
    "toMinorUnits",
    {"amount": ".5", "exponent": 2},
    to_minor(".5", 2),
    ["toMinorUnits", "parse"],
    "A leading dot is legal decimal notation and appears in hand-entered prices.",
)
add(
    "0011-to-minor-near-the-double-boundary",
    "toMinorUnits of '9007199254740.99' at exponent 2 is exact",
    "toMinorUnits",
    {"amount": "9007199254740.99", "exponent": 2},
    to_minor("9007199254740.99", 2),
    ["toMinorUnits", "precision"],
    "Just under 2^53. Beyond this a JavaScript implementation needs BigInt; this row marks "
    "where the boundary is rather than crossing it, because a golden past it could not survive "
    "JSON.parse either.",
)
add(
    "0012-to-minor-leading-zeros",
    "toMinorUnits of '007.50' at exponent 2 is 750",
    "toMinorUnits",
    {"amount": "007.50", "exponent": 2},
    to_minor("007.50", 2),
    ["toMinorUnits", "parse"],
    "Must NOT be read as octal -- a trap in several languages' integer-parse routines.",
)

# -- formatMinorUnits ------------------------------------------------------

add(
    "0013-format-plain",
    "formatMinorUnits of 1999 at exponent 2 is '19.99'",
    "formatMinorUnits",
    {"minor": 1999, "exponent": 2},
    format_minor(1999, 2),
    ["formatMinorUnits"],
)
add(
    "0014-format-negative",
    "formatMinorUnits of -1999 at exponent 2 is '-19.99'",
    "formatMinorUnits",
    {"minor": -1999, "exponent": 2},
    format_minor(-1999, 2),
    ["formatMinorUnits", "sign"],
)
add(
    "0015-format-pads-the-fraction",
    "formatMinorUnits of 7 at exponent 2 is '0.07'",
    "formatMinorUnits",
    {"minor": 7, "exponent": 2},
    format_minor(7, 2),
    ["formatMinorUnits", "hazard"],
    "The commonest formatting bug: '0.7'. The fraction is zero-PADDED on the left to the "
    "currency's width, and the integer part is 0 rather than absent.",
)
add(
    "0016-format-negative-sub-unit",
    "formatMinorUnits of -7 at exponent 2 is '-0.07'",
    "formatMinorUnits",
    {"minor": -7, "exponent": 2},
    format_minor(-7, 2),
    ["formatMinorUnits", "sign", "hazard"],
    "The sign belongs in front of the whole amount. Taking abs() to pad and forgetting to put "
    "it back gives '0.07'; applying it after the split gives '0.-07'.",
)
add(
    "0017-format-zero",
    "formatMinorUnits of 0 at exponent 2 is '0.00'",
    "formatMinorUnits",
    {"minor": 0, "exponent": 2},
    format_minor(0, 2),
    ["formatMinorUnits"],
)
add(
    "0018-format-yen",
    "formatMinorUnits of 1000 at exponent 0 is '1000'",
    "formatMinorUnits",
    {"minor": 1000, "exponent": 0},
    format_minor(1000, 0),
    ["formatMinorUnits", "exponent"],
    "Exponent 0 means no decimal separator at all -- not '1000.' and not '1000.0'.",
)
add(
    "0019-format-near-the-double-boundary",
    "formatMinorUnits inverts 0011 exactly",
    "formatMinorUnits",
    {"minor": 900719925474099, "exponent": 2},
    format_minor(900719925474099, 2),
    ["formatMinorUnits", "precision"],
    "The inverse of 0011. Together they pin the round trip at the largest amount every runtime "
    "can still represent exactly.",
)
add(
    "0020-format-kuwaiti-dinar",
    "formatMinorUnits of 1005 at exponent 3 is '1.005'",
    "formatMinorUnits",
    {"minor": 1005, "exponent": 3},
    format_minor(1005, 3),
    ["formatMinorUnits", "exponent"],
)

# -- lineTotal -------------------------------------------------------------

add(
    "0021-line-total-plain",
    "lineTotal of 1999 x 3 is 5997",
    "lineTotal",
    {"unitAmount": 1999, "quantity": 3},
    1999 * 3,
    ["lineTotal"],
)
add(
    "0022-line-total-zero-quantity",
    "lineTotal of 1999 x 0 is 0",
    "lineTotal",
    {"unitAmount": 1999, "quantity": 0},
    0,
    ["lineTotal"],
)
add(
    "0023-line-total-free-item",
    "lineTotal of 0 x 5 is 0",
    "lineTotal",
    {"unitAmount": 0, "quantity": 5},
    0,
    ["lineTotal"],
)
add(
    "0024-line-total-large",
    "lineTotal of 2500 x 1000000 is exact",
    "lineTotal",
    {"unitAmount": 2500, "quantity": 1000000},
    2500 * 1000000,
    ["lineTotal"],
)
add(
    "0025-line-total-refund-line",
    "lineTotal of -1999 x 2 is -3998",
    "lineTotal",
    {"unitAmount": -1999, "quantity": 2},
    -1999 * 2,
    ["lineTotal", "sign"],
    "A credit note is a negative line, and it must be the exact negation of the charge it "
    "reverses.",
)
add(
    "0026-line-total-zero-exponent-currency",
    "lineTotal of 150000000 x 100000 is exact",
    "lineTotal",
    {"unitAmount": 150000000, "quantity": 100000},
    150000000 * 100000,
    ["lineTotal", "precision"],
    "1.5e13 -- an ordinary invoice in a currency with no minor unit (IDR, VND). Well within a "
    "double, and a reminder that 'the numbers are small' is a USD assumption.",
)


def main() -> None:
    payload = {
        "$schema": "../../../schema/case-table.schema.json",
        "suite": "shared/money-minor-units",
        "cases": cases,
    }
    (OUT / "cases.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"{len(cases)} cases written to {OUT / 'cases.json'}")


if __name__ == "__main__":
    main()
