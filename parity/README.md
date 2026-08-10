# The release-parity ledger

The fixtures in `suites/` answer one question: **does this implementation
satisfy contract X?**

They cannot answer a second, separate one: **has this implementation evaluated
the newest canonical PHP release?** An implementation can pass every fixture it
has and still be a release behind, because a PHP release that changed nothing
about a contract does not change a single fixture — and a stale mirror looks
exactly like a current one from the outside.

That is what the ledger is for. It lives here, next to the fixtures, because the
two are read together and a claim of "current" needs both.

## The rules

- A PHP release with **no contract change** requires no fixture churn and no
  mirror release. It still **invalidates every stale attestation** until each
  mirror runs its pinned suite against the newly declared PHP release.
- A PHP release with a **compatible or breaking contract change** must publish
  the new fixtures **before** any mirror can attest `current`.
- `status: current` requires an `implementation`, a `conformance_ref`, an
  `attestation_url`, an `owner` and an `updated_at`. Four of those five are
  things a human has to be able to click, which is the point.
- `status: pending` or `blocked` requires a `tracking_issue`. A mirror that is
  behind with nowhere to look is indistinguishable from a mirror nobody owns.

`ledger.schema.json` enforces all of the above, including the conditional
requirements, so a hand-edited entry that omits its evidence fails validation
rather than reading as a claim.

## Why there is no `ledger.json` yet

Because nothing has attested yet, and a ledger seeded with plausible-looking
version numbers and commit hashes would be worse than an absent one — it would
assert parity that no run has demonstrated, which is precisely the failure this
repository exists to end.

The first entry lands when the first mirror runs its pinned suite in its own CI
and has an attestation URL to point at. Until then the schema is the contract
and this file is the procedure.
