"""Generate `suites/shared/feature-entitlement/cases.json`.

The goldens come from the reference functions below, which are the ruling in
`.ai/plans/fancy-commerce-gating-rulings.md` expressed as code -- not from what
a value "obviously" is, which is this repository's rule.

Two of these are new contracts rather than ports of existing behaviour, so there
was no prior implementation to take goldens from. That is stated in the
manifest's `referenceNote` rather than hidden: the goldens are computed here,
and the hazard rows exist to catch the specific wrong answers each function
invites.

    python scripts/build-feature-entitlement-cases.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

OUT = Path(__file__).resolve().parent.parent / "suites" / "shared" / "feature-entitlement"


# -- the reference implementations ----------------------------------------


def entitled(enabled: bool, type_: str, included_quantity: int | None, used: int) -> bool:
    """Ruling 1: entitlement, and nothing else.

    `included_quantity` and `used` are accepted and IGNORED. They are in the
    signature so the table can hand them over and require the answer not to
    move.
    """
    return enabled


def consumption_ceiling(included_quantity: int | None, overage_limit: int | None) -> int | None:
    """Ruling 2.1/2.2: the highest total usage a subject may reach."""
    if included_quantity is None:
        return None
    return included_quantity + max(0, overage_limit or 0)


def allows_consumption(used: int, amount: int, ceiling: int | None) -> bool:
    """All-or-nothing. A partial fill would give a caller less than it asked for."""
    if ceiling is None:
        return True
    return used + amount <= ceiling


def overage_delta(used: int, amount: int, included_quantity: int | None) -> int:
    """The billable part of this consumption. Signed: a refund gives a negative."""
    if included_quantity is None:
        return 0
    after = used + amount
    return max(0, after - included_quantity) - max(0, used - included_quantity)


def can_consume(
    enabled: bool,
    included_quantity: int | None,
    overage_limit: int | None,
    used: int,
    amount: int,
) -> bool:
    """The quota-aware read: what `canAccess` used to answer for a source grant."""
    if not enabled:
        return False
    return allows_consumption(used, amount, consumption_ceiling(included_quantity, overage_limit))


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


# -- entitled: Ruling 1 ----------------------------------------------------

add(
    "0001-entitled-granted-with-quota-left",
    "an enabled resource grant with quota left is entitled",
    "entitled",
    {"enabled": True, "type": "resource", "includedQuantity": 100, "used": 30},
    entitled(True, "resource", 100, 30),
    ["entitled", "control"],
    "The control row. Without it the two hazard rows below prove nothing, because an "
    "implementation that always returns false would pass them.",
)
add(
    "0002-entitled-granted-with-quota-exhausted",
    "an enabled resource grant with ZERO quota left is still entitled",
    "entitled",
    {"enabled": True, "type": "resource", "includedQuantity": 100, "used": 100},
    entitled(True, "resource", 100, 100),
    ["entitled", "hazard", "ruling-1"],
    "THE ruling. Both twins answered false here, because a grant-sourced resource feature was "
    "only 'on' while quota remained -- while the same feature defined in the registry was on "
    "regardless. One question, two answers, decided by which layer the plan happened to be "
    "modelled in. An implementation that reintroduces the quota check fails this row and 0004 "
    "and nothing else.",
)
add(
    "0003-entitled-not-granted",
    "a disabled grant is not entitled, whatever the quota says",
    "entitled",
    {"enabled": False, "type": "resource", "includedQuantity": 100, "used": 0},
    entitled(False, "resource", 100, 0),
    ["entitled"],
    "The other half of the control: entitlement still tracks `enabled`. A runtime that "
    "hard-coded true to pass 0002 fails here.",
)
add(
    "0004-entitled-past-the-ceiling",
    "usage PAST the included quantity does not revoke entitlement",
    "entitled",
    {"enabled": True, "type": "resource", "includedQuantity": 100, "used": 140},
    entitled(True, "resource", 100, 140),
    ["entitled", "hazard", "ruling-1", "overage"],
    "A subject in billable overage is emphatically still entitled -- they are paying for the "
    "feature twice over. A settings page that hides it here is hiding it at the exact moment "
    "the customer is spending most.",
)
add(
    "0005-entitled-boolean-feature",
    "a boolean grant ignores quantity fields entirely",
    "entitled",
    {"enabled": True, "type": "boolean", "includedQuantity": None, "used": 0},
    entitled(True, "boolean", None, 0),
    ["entitled"],
)

# -- consumptionCeiling: Ruling 2.1 / 2.2 ---------------------------------

add(
    "0006-ceiling-no-overage-configured",
    "a null overage limit means no overage: the ceiling is the included quantity",
    "consumptionCeiling",
    {"includedQuantity": 100, "overageLimit": None},
    consumption_ceiling(100, None),
    ["consumptionCeiling", "hazard", "ruling-2"],
    "The row that keeps every existing install behaving as it does today. The column has been "
    "stored-and-ignored for the life of the package, so every untouched row is null -- reading "
    "null as 'unbounded' would turn each of them into an unlimited spending authority on "
    "upgrade.",
)
add(
    "0007-ceiling-explicit-zero",
    "an overage limit of 0 is the same as none, stated out loud",
    "consumptionCeiling",
    {"includedQuantity": 100, "overageLimit": 0},
    consumption_ceiling(100, 0),
    ["consumptionCeiling"],
)
add(
    "0008-ceiling-with-overage",
    "an overage limit of 50 on 100 included gives a ceiling of 150",
    "consumptionCeiling",
    {"includedQuantity": 100, "overageLimit": 50},
    consumption_ceiling(100, 50),
    ["consumptionCeiling", "overage"],
    "overage_limit is a ceiling on BILLABLE OVERAGE, not the total. 150, never 50.",
)
add(
    "0009-ceiling-unlimited-included",
    "an unlimited included quantity has no ceiling, and overage is meaningless",
    "consumptionCeiling",
    {"includedQuantity": None, "overageLimit": 50},
    consumption_ceiling(None, 50),
    ["consumptionCeiling", "unlimited"],
    "There is no included line to exceed, so there is nothing to bill as overage. The overage "
    "limit is ignored rather than added to something.",
)
add(
    "0010-ceiling-zero-included-with-overage",
    "zero included plus an overage allowance is a pay-as-you-go band",
    "consumptionCeiling",
    {"includedQuantity": 0, "overageLimit": 500},
    consumption_ceiling(0, 500),
    ["consumptionCeiling", "overage"],
    "Nothing free, 500 billable. `includedQuantity: 0` and `includedQuantity: null` are "
    "opposite configurations and a runtime that conflates them charges nobody or everybody.",
)

# -- allowsConsumption ----------------------------------------------------

add(
    "0011-allows-exactly-to-the-ceiling",
    "consuming exactly up to the ceiling is allowed",
    "allowsConsumption",
    {"used": 90, "amount": 10, "ceiling": 100},
    allows_consumption(90, 10, 100),
    ["allowsConsumption", "hazard", "boundary"],
    "The off-by-one. `used + amount <= ceiling`, not `<`. A plan that says 100 must permit the "
    "hundredth unit.",
)
add(
    "0012-allows-one-past-the-ceiling",
    "consuming one past the ceiling is refused",
    "allowsConsumption",
    {"used": 90, "amount": 11, "ceiling": 100},
    allows_consumption(90, 11, 100),
    ["allowsConsumption", "boundary"],
)
add(
    "0013-allows-all-or-nothing",
    "a request that only partly fits is refused entirely",
    "allowsConsumption",
    {"used": 0, "amount": 150, "ceiling": 100},
    allows_consumption(0, 150, 100),
    ["allowsConsumption", "hazard"],
    "No partial fill. A caller asking for 150 and silently getting 100 has no way to know, "
    "because the answer is a boolean -- and callers do not check quantities they did not ask "
    "to be told about.",
)
add(
    "0014-allows-unlimited",
    "a null ceiling permits any amount",
    "allowsConsumption",
    {"used": 10_000_000, "amount": 1, "ceiling": None},
    allows_consumption(10_000_000, 1, None),
    ["allowsConsumption", "unlimited"],
)
add(
    "0015-allows-zero-amount",
    "consuming nothing is always allowed, even at the ceiling",
    "allowsConsumption",
    {"used": 100, "amount": 0, "ceiling": 100},
    allows_consumption(100, 0, 100),
    ["allowsConsumption", "boundary"],
)

# -- overageDelta: Ruling 2.4 ---------------------------------------------

add(
    "0016-overage-delta-wholly-inside-the-allowance",
    "consumption that stays under the included quantity bills nothing",
    "overageDelta",
    {"used": 10, "amount": 20, "includedQuantity": 100},
    overage_delta(10, 20, 100),
    ["overageDelta", "control"],
)
add(
    "0017-overage-delta-straddling-the-line",
    "consumption that crosses the included line bills only the part above it",
    "overageDelta",
    {"used": 90, "amount": 30, "includedQuantity": 100},
    overage_delta(90, 30, 100),
    ["overageDelta", "hazard", "overage"],
    "20, not 30 and not 0. An implementation that bills the whole amount once the line is "
    "crossed overcharges by the included remainder; one that bills nothing until the line is "
    "passed loses it.",
)
add(
    "0018-overage-delta-already-in-overage",
    "consumption that starts ABOVE the included line bills the whole amount",
    "overageDelta",
    {"used": 140, "amount": 10, "includedQuantity": 100},
    overage_delta(140, 10, 100),
    ["overageDelta", "hazard", "overage"],
    "The row a naive `max(0, after - included)` gets wrong: it answers 50, re-billing the 40 "
    "units already recorded. Subtracting the overage that existed BEFORE the call is what "
    "makes the function composable over a period.",
)
add(
    "0019-overage-delta-refund",
    "a refund unwinds overage as a negative delta",
    "overageDelta",
    {"used": 140, "amount": -10, "includedQuantity": 100},
    overage_delta(140, -10, 100),
    ["overageDelta", "refund", "sign"],
    "One signed function serves increment and decrement, so the two cannot drift apart. The "
    "stored total is clamped at zero by the caller, not here.",
)
add(
    "0020-overage-delta-refund-below-the-line",
    "a refund that drops usage below the included line unwinds only the billable part",
    "overageDelta",
    {"used": 110, "amount": -30, "includedQuantity": 100},
    overage_delta(110, -30, 100),
    ["overageDelta", "refund", "hazard"],
    "-10, not -30. Refunding 30 units when only 10 of them were ever billable must not credit "
    "20 units of overage that never existed.",
)
add(
    "0021-overage-delta-unlimited",
    "an unlimited allowance never accrues overage",
    "overageDelta",
    {"used": 10_000, "amount": 500, "includedQuantity": None},
    overage_delta(10_000, 500, None),
    ["overageDelta", "unlimited"],
    "Unlimited is not unmetered -- usage is still recorded -- but there is no included line, so "
    "nothing above it.",
)

# -- canConsume: the whole ruling composed --------------------------------

add(
    "0022-can-consume-inside-the-included-quantity",
    "an entitled subject inside their allowance may consume",
    "canConsume",
    {"enabled": True, "includedQuantity": 100, "overageLimit": None, "used": 50, "amount": 10},
    can_consume(True, 100, None, 50, 10),
    ["canConsume", "control"],
)
add(
    "0023-can-consume-exhausted-without-overage",
    "an exhausted allowance with no overage refuses -- and this is what canAccess used to answer",
    "canConsume",
    {"enabled": True, "includedQuantity": 100, "overageLimit": None, "used": 100, "amount": 1},
    can_consume(True, 100, None, 100, 1),
    ["canConsume", "ruling-1", "hazard"],
    "The migration target. A caller who used canAccess as a consumption gate wants THIS "
    "answer, and canConsume is where it moved.",
)
add(
    "0024-can-consume-into-the-overage-band",
    "an exhausted allowance WITH an overage limit permits billable consumption",
    "canConsume",
    {"enabled": True, "includedQuantity": 100, "overageLimit": 50, "used": 100, "amount": 1},
    can_consume(True, 100, 50, 100, 1),
    ["canConsume", "overage", "hazard", "ruling-2"],
    "The behaviour change overage_limit buys. Before this ruling the column was stored by "
    "three runtimes and read by none, so this answered false everywhere.",
)
add(
    "0025-can-consume-past-the-overage-ceiling",
    "the overage band has an end, and it is enforced",
    "canConsume",
    {"enabled": True, "includedQuantity": 100, "overageLimit": 50, "used": 150, "amount": 1},
    can_consume(True, 100, 50, 150, 1),
    ["canConsume", "overage", "boundary"],
    "overage_limit is a ceiling, not an alert. A field named *_limit that does not limit is "
    "the same defect in a new costume.",
)
add(
    "0026-can-consume-not-entitled",
    "no entitlement means no consumption, however much quota is configured",
    "canConsume",
    {"enabled": False, "includedQuantity": 1000, "overageLimit": 1000, "used": 0, "amount": 1},
    can_consume(False, 1000, 1000, 0, 1),
    ["canConsume"],
)


def main() -> None:
    payload = {
        "$schema": "../../../schema/case-table.schema.json",
        "suite": "shared/feature-entitlement",
        "cases": cases,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "cases.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"{len(cases)} cases written to {OUT / 'cases.json'}")


if __name__ == "__main__":
    main()
