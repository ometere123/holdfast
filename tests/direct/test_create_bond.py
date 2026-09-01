"""`create_bond`: what it escrows, what it refuses, and what it does with the stake when it refuses.

WHAT IS ACTUALLY AT STAKE HERE. `create_bond` is payable, and a payable method that refuses by
reverting on StudioNet keeps the money it has just declined to work for. That was measured, not
reasoned about: transaction 0xc3a12dd2 sent 250,000,000,000,000,000 wei into this method, reached a
refusal, resolved as a rollback, and the value did not come back. A GenVM revert undoes the storage
writes; it does not undo the transfer that funded the call. So the method is a refusal boundary. It
catches its own refusal, emits a refund, and returns the tagged sentence, and the tests below read
that sentence off the return value rather than out of an exception.

THE ORDERING CLAIM SURVIVED THE FIX, and it is still tested. Each case in `REFUSALS` breaks exactly
one field, calls with no value, and asserts the contract reports THAT fault rather than the missing
stake, because the frontend's dry run simulates the identical call with nothing attached and a
simulation that answers "you sent no value" has told the promisor nothing they did not already know.
The consequence of getting the order wrong is smaller than it was: a fault the simulation cannot
reach now costs a transaction rather than a stake. It is still worth not costing a transaction.

AND IT IS A CLAIM ABOUT THE NETWORK, so that is tested too, by omission. `bonds.simulate` clears the
mock table before it calls, so the harness raises `MockNotFoundError` at the first fetch, and that is
not a `gl.vm.UserError`, so the boundary does not swallow it. A refusal that arrives as a tagged
string is therefore also proof that no capture was retrieved to produce it: the check ran on the
arguments alone, which is the only way a browser could have run it.
"""

import json
import re

import pytest

import archive
import bonds
from conftest import address_hex, numeric_constant, returned_refusal, str_constant

ST_ACTIVE = str_constant("ST_ACTIVE")
MIN_TERM_DAYS = numeric_constant("MIN_TERM_DAYS")
MAX_TERM_DAYS = numeric_constant("MAX_TERM_DAYS")
MIN_COMMITMENT_CHARS = numeric_constant("MIN_COMMITMENT_CHARS")
MIN_ANCHOR_WORDS = numeric_constant("MIN_ANCHOR_WORDS")
MAX_TERMINAL_CHARS = numeric_constant("MAX_TERMINAL_CHARS")
MIN_DERIVED_ANCHOR_CHARS = numeric_constant("MIN_DERIVED_ANCHOR_CHARS")

NO_VALUE = "carried no value"


# ---------------------------------------------------------------------------
# The happy path
# ---------------------------------------------------------------------------


def test_a_bond_placed_on_a_real_gzip_capture_reports_what_it_escrowed(
        contract, direct_vm, value_ledger):
    """The return string, field by field, because it is the only receipt the promisor gets.

    Read as a whole sentence rather than by substring count: this is what the frontend shows after a
    successful create, so a field missing from it is a field the promisor has no way to check.
    """
    bonds.stage(direct_vm)
    value_ledger.fund(bonds.DEFAULT_STAKE)
    receipt = contract.create_bond(**bonds.draft())

    assert receipt.startswith(bonds.DEFAULT_BOND_ID + " bonded ")
    assert str(bonds.DEFAULT_STAKE) + " wei" in receipt
    assert bonds.BOND_URL in receipt
    assert bonds.BASELINE_STAMP in receipt
    assert "term %d days" % bonds.TERM_DAYS in receipt
    assert "cursor " in receipt


def test_the_baseline_capture_was_gzip_and_the_bond_records_the_hash_of_what_it_inflated_to(
        contract, direct_vm, value_ledger):
    """The single most important assertion in this file, and it is checked against the artefact.

    The capture is 89,652 bytes of gzip that inflate to 819,751. A contract that skipped
    decompression would still reach the gates with a document, because a lenient utf-8 decode of
    compressed bytes yields tens of thousands of replacement characters rather than nothing. It would
    fail the gates, so `create_bond` would refuse, and the refusal would read as a page that is not
    the document it names. So `encoding == "gzip"` alone is weak: it is the contract's own report of
    what it thinks it did.

    `decoded_sha256` is not. It is a hash over the bytes the contract actually went on to read, and
    this test recomputes it here with the standard library over the same file, which no amount of
    agreement between the contract's own fields could fake. If decompression were dropped, or done
    with the wrong window bits, or done twice, this digest changes.
    """
    import gzip
    import hashlib

    bond_id = bonds.place(contract, direct_vm, value_ledger)
    bond = contract.get_bond(bond_id)
    assert bond["baseline_encoding"] == "gzip"

    raw = archive.raw(bonds.SNAPSHOT_ROUTE)
    assert raw[:2] == b"\x1f\x8b", "the fixture is no longer a gzip member"
    inflated = gzip.decompress(raw)

    point = contract.bond_history(bond_id)[0]
    assert point["encoding"] == "gzip"
    assert point["decoded_sha256"] == hashlib.sha256(inflated).hexdigest()
    # `raw_len` is the compressed size as served, read off the file rather than typed.
    assert int(point["raw_len"]) == len(raw)
    # And `text_len` is a character count of extracted visible text, so it belongs to neither of the
    # two byte counts. Pinned because of a coincidence in this particular fixture that is a trap: the
    # raw member is 89,652 bytes and its visible text is 89,605 characters, 47 apart. A build that
    # put the raw byte count in the text field would be wrong by 0.05 percent and would look right in
    # every view. It is the inflated size, 819,751, that the text count must sit far below.
    text_len = int(point["text_len"])
    assert text_len != int(point["raw_len"])
    assert text_len < len(inflated) // 8
    assert archive.expectation(bonds.SNAPSHOT_ROUTE)["decoded_bytes"] == len(inflated)


def test_the_stake_is_escrowed_to_the_wei_and_the_ledger_says_so(
        contract, direct_vm, value_ledger):
    """Counted from stored bonds and the ledger, never from `self.balance`.

    The direct harness credits no value at all, so `self.balance` reads zero however much a test
    sends. Every escrow assertion in this suite is computed from what the contract stored plus what
    the ledger recorded leaving, which is also the only accounting a reader of the deployed contract
    can perform without trusting the node.
    """
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    bond = contract.get_bond(bond_id)
    ledger = contract.get_ledger()

    assert bond["stake"] == str(bonds.DEFAULT_STAKE)
    assert ledger["total_escrowed"] == str(bonds.DEFAULT_STAKE)
    assert ledger["bonds_created"] == "1"
    assert ledger["total_paid_to_payees"] == "0"
    assert ledger["total_returned_to_promisors"] == "0"
    # Nothing left the contract. A create that emitted a transfer would be a refund path, and this
    # method does not have one.
    assert value_ledger.transfers == []
    assert value_ledger.retained == bonds.DEFAULT_STAKE


def test_the_promisor_is_the_caller_and_the_payee_is_the_argument(
        contract, direct_vm, value_ledger):
    """Neither address is taken on trust from the other side."""
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    bond = contract.get_bond(bond_id)
    assert bond["promisor"].lower() == address_hex(direct_vm.sender)
    assert bond["payee"].lower() == bonds.PAYEE.lower()


def test_the_term_runs_from_the_baseline_capture_and_not_from_the_moment_of_creation(
        contract, direct_vm, value_ledger):
    """Two bonds on one baseline, created ten months apart, expire on the same day.

    Both halves of that are deliberate. The term is a claim about how long the commitment has to
    survive in the document, and the document's clock is the archive's, so the expiry belongs to the
    capture. Anchoring to creation would also let a promisor buy extra term by bonding an old
    baseline: pin a capture from last January, create today, and collect a year of coverage over a
    period that has already happened.
    """
    first = bonds.place(contract, direct_vm, value_ledger, at="2026-08-25T11:00:00Z")
    second = bonds.place(
        contract, direct_vm, value_ledger,
        at="2026-12-25T00:00:00Z",
        bond_id="gcp-terms-notice-two",
        commitment="We will not begin charging for a feature that is free today without a full "
                   "billing cycle of advance written notice.",
    )

    early = contract.get_bond(first)
    late = contract.get_bond(second)
    assert early["baseline_timestamp"] == late["baseline_timestamp"] == bonds.BASELINE_STAMP
    assert early["expires_at"] == late["expires_at"]
    # 2026-01-29 plus 365 days. Stated as a date rather than as arithmetic repeated from the
    # contract, so that a change to how the expiry is derived shows up here as a different day.
    assert early["expires_at"].startswith("2027-01-29")
    # And the creation times did differ, so the assertion above is not vacuous.
    assert early["created_at"] != late["created_at"]


def test_the_cursor_lands_on_the_newest_row_of_the_baseline_window(
        contract, direct_vm, value_ledger):
    """Past the baseline, and inside the window, so the first check has somewhere to start.

    A cursor left at the baseline would make the first `check_commitment` re-examine a capture
    already known to qualify and hold, which costs a retrieval and a model call to learn nothing. A
    cursor at the wall clock would skip every capture the saturated window did not return.
    """
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    bond = contract.get_bond(bond_id)
    assert re.fullmatch(r"[0-9]{14}", bond["cursor_timestamp"])
    assert bond["cursor_timestamp"] > bonds.BASELINE_STAMP
    assert bond["state"] == ST_ACTIVE


# ---------------------------------------------------------------------------
# The deterministic refusals, and the order they arrive in
# ---------------------------------------------------------------------------


#: One broken field per case, in the order the contract checks them, with the phrase the refusal has
#: to carry. Every one of these runs with no value attached and an empty mock table.
REFUSALS = [
    ("an empty bond id", {"bond_id": "  "}, "bond_id must be 1 to 64 characters"),
    ("a bond id past 64 characters", {"bond_id": "b" * 65}, "bond_id must be 1 to 64 characters"),
    ("a plain http url", {"url": "http://cloud.google.com/terms"}, "must be an https URL"),
    ("a url carrying a fragment", {"url": bonds.BOND_URL + "#tos"}, "must not carry a fragment"),
    ("a url carrying a port", {"url": "https://cloud.google.com:443/terms"},
     "must not carry a port"),
    ("a commitment too short to locate", {"commitment": "no data sales"},
     "commitment must be %d to" % MIN_COMMITMENT_CHARS),
    ("a baseline that is not fourteen digits", {"baseline_timestamp": "2026-01-29"},
     "baseline_timestamp must be an exact 14-digit Wayback timestamp"),
    ("too few anchor words", {"anchor_words": '["definitions", "payment"]'},
     "anchor_words must hold %d to" % MIN_ANCHOR_WORDS),
    ("anchor words that are not JSON", {"anchor_words": "definitions, payment, confidential"},
     "anchor_words must be a JSON array"),
    ("a duplicated anchor word", {"anchor_words": '["payment", "payment", "definitions"]'},
     "is a duplicate of another entry"),
    ("an empty terminal", {"anchor_terminal": "   "},
     "anchor_terminal must be 1 to %d characters" % MAX_TERMINAL_CHARS),
    ("a url with no meaningful final segment", {"url": "https://cloud.google.com/"},
     "under the %d characters gate B needs" % MIN_DERIVED_ANCHOR_CHARS),
    ("the zero address as payee", {"payee": "0x" + "00" * 20}, "payee must not be the zero address"),
    ("a term under the floor", {"term_days": MIN_TERM_DAYS - 1},
     "term_days must be %d to %d" % (MIN_TERM_DAYS, MAX_TERM_DAYS)),
    ("a term over the ceiling", {"term_days": MAX_TERM_DAYS + 1},
     "term_days must be %d to %d" % (MIN_TERM_DAYS, MAX_TERM_DAYS)),
    ("a terminal that contains the derived anchor", {"anchor_terminal": "these terms in general"},
     "the gate specification is not usable"),
    ("a terminal that is also a section", {"anchor_terminal": "payment"},
     "the gate specification is not usable"),
]


@pytest.mark.parametrize("label,override,phrase", REFUSALS, ids=[case[0] for case in REFUSALS])
def test_a_simulation_with_no_value_reports_the_draft_fault_and_not_the_missing_stake(
        contract, direct_vm, value_ledger, label, override, phrase):
    """The property the frontend's dry run depends on, one field at a time.

    The second assertion is the one that carries the argument. Reporting the fault is necessary but
    not sufficient: the refusal must also NOT be the stake refusal, because a simulation that
    answers "you sent no value" has told the promisor nothing they did not already know and they
    will sign the same broken draft with 250 GEN attached to it.

    The third is about the refund path rather than the ordering. These calls attach nothing, and
    `_pay` returns early on a zero amount, so a refusal here must emit no transfer at all. A contract
    that sent a zero-value `EthSend` on every refused simulation would be paying gas to move nothing.
    """
    message = returned_refusal(bonds.simulate(contract, direct_vm, value_ledger, **override))
    assert phrase in message, f"{label}: {message}"
    assert NO_VALUE not in message, (
        f"{label}: the contract reported the missing stake instead of the fault in the draft, so "
        f"the stake check has moved above it and the dry run no longer answers anything: {message}"
    )
    assert value_ledger.transfers == [], f"{label}: refunded a call that sent nothing"


def test_every_deterministic_refusal_is_expected_and_never_external_or_transient(
        contract, direct_vm, value_ledger):
    """The tag decides whether the interface offers a retry, and none of these is worth retrying.

    `[EXTERNAL]` and `[TRANSIENT]` both mean the archive was the problem, so either one on a fault in
    the arguments would put a retry button in front of a promisor whose draft will be refused
    identically forever.
    """
    for label, override, _ in REFUSALS:
        message = returned_refusal(bonds.simulate(contract, direct_vm, value_ledger, **override))
        assert message.startswith("[EXPECTED]"), f"{label}: {message}"
        for tag in ("[EXTERNAL]", "[TRANSIENT]", "[LLM_ERROR]"):
            assert tag not in message, f"{label}: {message}"


def test_a_perfect_draft_with_no_value_is_refused_for_the_stake_and_nothing_else(
        contract, direct_vm, value_ledger):
    """The other half of the ordering claim, and the reason the list above is a complete answer.

    Every fault reports itself, and a draft with no faults reports only the missing stake. Together
    those two say that a zero-value simulation returning this exact message means the draft is sound
    on every check that can be answered without the network. That is what the create form tells the
    promisor before it asks them to sign.
    """
    message = returned_refusal(bonds.simulate(contract, direct_vm, value_ledger))
    assert message == "[EXPECTED] a bond needs a stake; this call carried no value", message


def test_a_refused_create_leaves_no_trace_of_itself_in_storage(
        contract, direct_vm, value_ledger):
    """Nothing is written before the last check, and this is the test that holds that line.

    It matters more now than it did when these refusals reverted. A revert rolled storage back, so an
    early write was harmless; the boundary catches the refusal instead, and catching an exception is
    ordinary Python and rolls nothing back. A future check placed after the first append would leave a
    bond half created and a change point recorded against it, and this loop is the only thing that
    would notice.
    """
    for _, override, _ in REFUSALS:
        returned_refusal(bonds.simulate(contract, direct_vm, value_ledger, **override))

    assert contract.list_bonds() == []
    ledger = contract.get_ledger()
    assert ledger["bonds_created"] == "0"
    assert ledger["total_escrowed"] == "0"


def test_a_refused_funded_call_writes_no_state_and_returns_every_wei(
        contract, direct_vm, value_ledger):
    """The same invariant with money on it, which is the case the boundary exists for.

    Named in `_refund_and_report`'s own docstring as the guard on its one unsafe assumption. The
    method catches a refusal that may have been raised anywhere inside `_open_bond`, including on the
    far side of two network calls and a model call, and hands the stake back. That is only sound while
    nothing has been written by the time the refusal is raised, because the catch does not undo
    writes.

    So this drives a refusal as deep as one can go: the world is fully staged, the capture decodes,
    the gates pass, and the model answers ABSENT, which is refused after everything else has already
    happened. Then it asserts the two halves that together mean the promisor is exactly where they
    started. No bond, no change point, no counter moved, and the full stake back at the address that
    sent it.
    """
    bonds.stage(direct_vm, answer=archive.finding("ABSENT", "governing law"))
    value_ledger.fund(bonds.DEFAULT_STAKE)
    message = returned_refusal(contract.create_bond(**bonds.draft()))
    assert "reads as ABSENT" in message, message

    assert contract.list_bonds() == []
    ledger = contract.get_ledger()
    assert ledger["bonds_created"] == "0"
    assert ledger["total_escrowed"] == "0"

    assert value_ledger.paid_to(direct_vm.sender) == bonds.DEFAULT_STAKE
    assert value_ledger.retained == 0, (
        "the refusal kept %d wei, which is the failure transaction 0xc3a12dd2 measured"
        % value_ledger.retained)

    # The change point ledger is global and keyed by bond id, so a stray append during the refused
    # call is invisible until a bond exists under that id to read it back. Create the same bond
    # properly and count: one point, the baseline, and not two.
    value_ledger.clear()
    bonds.place(contract, direct_vm, value_ledger)
    assert len(contract.bond_history(bonds.DEFAULT_BOND_ID)) == 1, (
        "the refused call left a change point behind, so a write now happens before the last check "
        "and the boundary is handing back a stake over half-written state")



# ---------------------------------------------------------------------------
# The two collisions, which need a bond to collide with
# ---------------------------------------------------------------------------


def test_a_second_bond_cannot_reuse_an_id(contract, direct_vm, value_ledger, bonded):
    """The id is the key every view takes, so two bonds under one id would make one unreachable."""
    message = returned_refusal(bonds.simulate(contract, direct_vm, value_ledger, bond_id=bonded))
    assert "already exists" in message, message
    assert bonded in message
    assert NO_VALUE not in message


def test_a_second_bond_cannot_cover_the_same_url_and_commitment_under_a_new_id(
        contract, direct_vm, value_ledger, bonded):
    """The pair is hashed and stored, and the refusal names the bond that already covers it.

    Without this, one promisor could place ten bonds on one sentence and collect ten payouts from a
    single change, or a second party could shadow an existing bond to force a duplicate model call
    on every check. Naming the existing bond is what makes the refusal actionable rather than just
    a denial.
    """
    message = returned_refusal(
        bonds.simulate(contract, direct_vm, value_ledger, bond_id="a-different-id"))
    assert "already covers this url and commitment" in message, message
    assert bonded in message
    assert NO_VALUE not in message


def test_the_pair_is_matched_on_the_normalized_commitment_and_not_the_typed_one(
        contract, direct_vm, value_ledger, bonded):
    """Repunctuating a sentence does not make it a different commitment.

    `normalize_commitment` strips punctuation and collapses whitespace, and the pair hash is taken
    over the normalized form precisely so that re-typing the same promise with different quotation
    marks cannot buy a second bond on it.
    """
    respaced = bonds.COMMITMENT.replace(" ", "  ").replace("notice", "notice,")
    assert respaced != bonds.COMMITMENT
    message = returned_refusal(bonds.simulate(
        contract, direct_vm, value_ledger, bond_id="respaced", commitment=respaced))
    assert "already covers this url and commitment" in message, message


def test_the_payee_may_not_be_the_promisor(contract, direct_vm, value_ledger):
    """Read from the harness rather than restated, because the default sender is the harness's.

    Kept out of the parametrized list for that reason: every other case is a literal, and this one
    has to be computed from whoever is calling.
    """
    message = returned_refusal(bonds.simulate(
        contract, direct_vm, value_ledger, payee=address_hex(direct_vm.sender)))
    assert "payee must not be the promisor" in message, message
    assert NO_VALUE not in message


# ---------------------------------------------------------------------------
# The reading, which is the one part no amount of argument checking covers
# ---------------------------------------------------------------------------


def test_a_baseline_that_does_not_hold_the_commitment_cannot_be_bonded(
        contract, direct_vm, value_ledger):
    """There is nothing to bond if the sentence is not in the document to begin with.

    A bond measures a commitment leaving a document it was in. Allowing a baseline read as ABSENT
    would let a promisor stake on a promise the page never made, wait for any capture the model
    happens to read differently, and collect. The refusal is `[EXPECTED]`, because the answer will
    not change on a retry.
    """
    bonds.stage(direct_vm, answer=archive.finding("ABSENT", "governing law"))
    value_ledger.fund(bonds.DEFAULT_STAKE)
    message = returned_refusal(contract.create_bond(**bonds.draft()))
    assert message.startswith("[EXPECTED]"), message
    assert "reads as ABSENT for this commitment" in message, message
    assert contract.list_bonds() == []


def test_a_breach_finding_whose_quote_is_not_in_the_document_fails_closed(
        contract, direct_vm, value_ledger):
    """A confident sentence must not be able to move a stake on its own.

    The quote is checked against the same text the model was shown, in deterministic code, after the
    answer comes back. `[LLM_ERROR]` rather than `[EXPECTED]`, because the document is fine and the
    answer is not, and the two want different handling in the interface.
    """
    bonds.stage(direct_vm, answer=archive.finding(
        "WEAKENED", "we reserve the right to change these terms at any time without notice"))
    value_ledger.fund(bonds.DEFAULT_STAKE)
    message = returned_refusal(contract.create_bond(**bonds.draft()))
    assert message.startswith("[LLM_ERROR]"), message
    assert "quoted excerpt is not in the document" in message, message
    # A model fault is still the promisor's money. The tag says who was at fault; the refund says who
    # holds the stake, and the answer is the same for all four tags.
    assert value_ledger.retained == 0


def test_an_answer_outside_the_four_classifications_is_refused_with_no_fallback(
        contract, direct_vm, value_ledger):
    """Choosing which of four answers was meant would let a malformed response move a stake."""
    bonds.stage(direct_vm, answer=json.dumps(
        {"classification": "PROBABLY FINE", "excerpt": "", "rationale": ""}))
    value_ledger.fund(bonds.DEFAULT_STAKE)
    message = returned_refusal(contract.create_bond(**bonds.draft()))
    assert message.startswith("[LLM_ERROR]"), message
    assert "which is not one of" in message, message
    for permitted in ("HOLDS", "WEAKENED", "ABSENT", "INDETERMINATE"):
        assert permitted in message, message


def test_an_answer_that_is_not_an_object_at_all_is_refused_rather_than_coerced(
        contract, direct_vm, value_ledger):
    """`response_format="json"` guarantees JSON, not a JSON object. A bare string parses fine."""
    bonds.stage(direct_vm, answer='"the commitment still holds"')
    value_ledger.fund(bonds.DEFAULT_STAKE)
    message = returned_refusal(contract.create_bond(**bonds.draft()))
    assert message.startswith("[LLM_ERROR]"), message


def test_the_rationale_and_excerpt_the_model_returned_are_stored_on_the_change_point(
        contract, direct_vm, value_ledger):
    """The reader sees what the model said, not just what the contract concluded from it.

    A HOLDS point with no rationale would leave the baseline frame as an assertion with nothing
    behind it, which on this interface is exactly the shape a blank frame has.
    """
    bonds.stage(direct_vm, answer=archive.holds(
        excerpt="governing law", rationale="the notice period clause is present and unqualified"))
    value_ledger.fund(bonds.DEFAULT_STAKE)
    contract.create_bond(**bonds.draft())

    point = contract.bond_history(bonds.DEFAULT_BOND_ID)[0]
    assert point["classification"] == "HOLDS"
    assert point["excerpt"] == "governing law"
    assert point["rationale"] == "the notice period clause is present and unqualified"
