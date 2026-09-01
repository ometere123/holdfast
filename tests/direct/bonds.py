"""The one bond the lifecycle tests start from, placed against real captured bytes.

WHY A HELPER RATHER THAN A FIXTURE PER TEST. `create_bond` is the only method that has to satisfy
every layer at once: eleven deterministic checks, a CDX index whose row 0 must be the exact pin, a
gzip member that must decode and pass three gates, and a model answer that must classify as HOLDS.
A test about `get_bond`'s field list should not have to get all of that right to say what it means,
and a test about the refusals should be able to break exactly one part of it and leave the rest
correct. So the working draft lives here once and every caller states its deviation from it.

WHICH PAIR, AND WHY THIS ONE. `cdx-gcp-terms` with `snap-gcp-terms-gzip`, which is the Google Cloud
terms page as the archive replayed it: 89,652 bytes of gzip that inflate to 819,751. It is the
better of the two bondable pairs for the happy path precisely because it is compressed. A test
built on the uncompressed OpenAI capture would pass against a contract that had never learned to
decompress anything, which is the one failure this project exists to prevent.

THE DERIVED ANCHOR IS NOT THE PAGE'S TITLE. `_derive_anchor` takes the last path segment, so this
URL yields "terms" and not "terms of service". The manifest records the page's own heading under
`expect.anchor` because the offline archive suite drives `GateSpec` directly and can pass whatever
anchor it likes. The contract cannot: it derives the anchor from the URL so that a promisor cannot
choose a phrase they know is present. Gate B therefore tests "terms" against this document, and the
happy path works because a terms page contains the word.

THE ORDER OF THE THREE SETUP CALLS IS LOAD BEARING. `Archive.serve()` calls `clear_mocks()`, which
clears the LLM table as well as the web one, so a model answer registered before the captures is
silently discarded and the contract reaches `exec_prompt` with nothing mocked. Serve first, then
mock the model. `set_block_time` may go anywhere, but it cannot be skipped: `_now()` reads
`gl.message_raw["datetime"]` verbatim and `warp()` alone does not write it, so an unmirrored clock
leaves the contract building a `to=` bound out of the empty string.
"""

from __future__ import annotations

import archive
from conftest import set_block_time

#: The prompt marker `_judge_block` writes into every commitment question. Matching on the section
#: header rather than on the commitment text means a test can change the commitment without the
#: model answer silently going unmocked.
JUDGE_HOOK = "THE COMMITMENT UNDER TEST"

#: 250 GEN. Chosen so the ten percent contest bond is a whole number of wei with room to spare, and
#: so a split that lost precision would be visible rather than rounding to something plausible.
DEFAULT_STAKE = 250 * 10**18

#: The captured pair. `captured_pin_row: 0` in the manifest is what makes this index usable as a
#: baseline window: `_cdx_anchored_block` requires the pin at row 0, and four of the five original
#: fixtures in this project failed that requirement.
CDX_ROUTE = "cdx-gcp-terms"
SNAPSHOT_ROUTE = "snap-gcp-terms-gzip"

BOND_URL = "https://cloud.google.com/terms"
BASELINE_STAMP = "20260129024608"

#: Neither the promisor (the direct harness's default sender, `0xaaa…`) nor the zero address, both
#: of which `create_bond` refuses. A payee equal to the promisor would make the bond a promise to
#: oneself, and the zero address would burn the stake on a breach.
PAYEE = "0x" + "b" * 40

#: Over the 40 character floor and over the 20 character normalized floor, and phrased as something
#: a terms page could actually stop saying.
COMMITMENT = (
    "We will give at least twelve months written notice before any material change to these "
    "terms takes effect for an existing customer."
)

#: Three sections, all three present in the decoded capture, which matters because gate C admits
#: `hits >= total - 1`: with three declared, two present would still pass. Naming three that are all
#: present means a gate C failure in a test is a fact about the document and not about the margin.
ANCHOR_WORDS = '["definitions", "payment", "confidential"]'

#: Gate D is a plain substring test for this phrase in the normalized text, and `GateSpec.validate`
#: additionally requires it to be independent of the anchor and of every section in both directions.
#: "governing law" is present in this capture and shares no substring with "terms", "definitions",
#: "payment" or "confidential".
ANCHOR_TERMINAL = "governing law"

TERM_DAYS = 365

#: The wall clock the bond is created at: after the baseline capture, and inside the window the
#: index covers. `expires_at` is computed from the baseline rather than from this, so moving it does
#: not move the expiry.
CREATED_AT = "2026-08-25T11:00:00Z"

DEFAULT_BOND_ID = "gcp-terms-notice"


def draft(**overrides) -> dict:
    """The eight arguments `create_bond` takes, as a working set with named deviations.

    Returned as a dict rather than a tuple so a refusal test reads as `draft(term_days=29)` and the
    reader does not have to count positions to see which of the eight was broken.
    """
    values = {
        "bond_id": DEFAULT_BOND_ID,
        "url": BOND_URL,
        "commitment": COMMITMENT,
        "baseline_timestamp": BASELINE_STAMP,
        "anchor_words": ANCHOR_WORDS,
        "anchor_terminal": ANCHOR_TERMINAL,
        "payee": PAYEE,
        "term_days": TERM_DAYS,
    }
    unknown = set(overrides) - set(values)
    assert not unknown, f"create_bond takes no argument named {sorted(unknown)}"
    values.update(overrides)
    return values


def stage(direct_vm, *, cdx=CDX_ROUTE, snapshot=SNAPSHOT_ROUTE, answer=None,
          at=CREATED_AT) -> archive.Archive:
    """Register the captures, the clock and the model answer for one `create_bond` call.

    Split out from `place` so a test can stage the world, then call `create_bond` itself and inspect
    what it raised. Returns the `Archive` so a caller can `add` a second capture to it.
    """
    served = archive.Archive(direct_vm).serve(cdx, snapshot)
    set_block_time(direct_vm, at)
    direct_vm.mock_llm(JUDGE_HOOK, answer if answer is not None else archive.holds())
    return served


def place(contract, direct_vm, value_ledger, *, stake=DEFAULT_STAKE, at=CREATED_AT,
          answer=None, **overrides) -> str:
    """Stage the world and create one bond. Returns its id.

    Asserts nothing. A test that wants to know what the return string says should read it from
    `create_bond` directly; this exists so that a test about what happens *after* a bond exists does
    not open with twelve lines of setup it does not care about.
    """
    stage(direct_vm, answer=answer, at=at)
    value_ledger.fund(stake)
    fields = draft(**overrides)
    contract.create_bond(**fields)
    return str(fields["bond_id"])


def simulate(contract, direct_vm, value_ledger, *, at=CREATED_AT, **overrides):
    """Call `create_bond` with no value and an EMPTY mock table, the way the frontend's dry run does.

    Returns whatever the method answered with, which for a broken draft is the tagged refusal itself:
    `create_bond` is a refusal boundary and hands its sentence back rather than reverting, because on
    StudioNet a revert keeps the stake. Callers read it with `conftest.returned_refusal`.

    The ordering property this shape rests on is unchanged and still worth testing. The stake check is
    the last of the deterministic checks, so a zero-value call reports any other fault in the draft
    instead of "this call carried no value", and the frontend can therefore learn that a draft is
    sound before it asks anyone to sign. What changed is the consequence of getting that wrong: a
    fault the simulation cannot reach now costs a transaction rather than the stake.

    THE EMPTY MOCK TABLE IS PART OF THE ASSERTION, not an omission. Nothing here registers a
    capture, so the harness raises `MockNotFoundError` the moment the contract reaches its first
    fetch, and that error is not a `gl.vm.UserError`, so the boundary does not catch it. A refusal
    that arrives as a tagged string therefore proves two things at once: that the contract refused for
    the stated reason, and that it refused without touching the network. If a network call ever moved
    above one of these checks, the test fails with an unmocked-URL error rather than passing quietly.
    """
    direct_vm.clear_mocks()
    set_block_time(direct_vm, at)
    value_ledger.no_value()
    return contract.create_bond(**draft(**overrides))
