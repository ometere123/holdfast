"""The four methods that move money, and the one property none of them may violate.

WHAT THIS FILE IS FOR. `test_create_bond.py` proves a stake can be placed without being stranded.
This file proves it can be got back out, by exactly one of the three routes that exist: returned at
the end of the term, paid to the payee on a settled breach, or split by an adjudicated contest. Every
payout below is checked against the `EthSend` requests the contract actually emitted, to the wei,
never against `self.balance` — the direct harness has no `EthSend` handler and reports the balance as
zero however much value a test attaches, so a suite that trusted the balance would pass with the
money going nowhere.

THE TIMESTAMPS ARE INVENTED AND THE BYTES ARE NOT. A run of two consecutive weakened captures
followed by a settlement is a sequence no real page's history happens to contain on demand, so
`Archive.window` replays real captured payloads at chosen timestamps and computes the index digests
from those same bytes. That leaves the timestamp as the only fabricated column, which is the one
column the contract treats as an opaque key. It matters that the bytes are real: five of the six
captures used below are gzip members, so the decode, the gates and the text extraction all run over
the evidence they run over in production. A synthesised document would be plain text and would pass a
pipeline that had never learned to decompress anything.

WHICH CAPTURES, AND WHY THOSE. Measured, not chosen for convenience. Under this bond's derived gate
specification — anchor "terms" from the URL's last segment, sections definitions/payment/confidential,
terminal "governing law" — exactly two of the eight captured payloads qualify, `snap-gcp-terms-gzip`
and `snap-github-tos-gzip`, and their digests differ. That is what makes an honest two-capture breach
possible at all: a run needs two distinct captures, and a real `collapse=digest` response cannot
return the same digest twice. `snap-github-tos-chrome-only` fails gates C and D with zero of three
section hits, which is the blank frame. `snap-aws-terms-gzip` fails gate D alone, with gate B passing
and gate C passing at two of three on the `hits >= total - 1` margin, which is used once below as the
only available evidence that gate D does independent work.

AND ONE HONEST LIMITATION, STATED HERE RATHER THAN LEFT TO BE DISCOVERED. Gate B passes on all eight
captured payloads under this specification, including the chrome-only shell, because a shell of the
terms page still contains the word "terms". In this fixture set gates C and D do all of the
rejecting. Nothing below claims otherwise, and no test here should ever be read as showing that three
gates catch bad captures.
"""

import json

import pytest

import archive
import bonds
from conftest import (numeric_constant, returned_refusal, set_block_time, str_constant,
                      user_error_message)

ST_ACTIVE = str_constant("ST_ACTIVE")
ST_BREACH_CLAIMED = str_constant("ST_BREACH_CLAIMED")
ST_CONTESTED = str_constant("ST_CONTESTED")
ST_BREACHED = str_constant("ST_BREACHED")
ST_RETURNED = str_constant("ST_RETURNED")

CL_HOLDS = str_constant("CL_HOLDS")
CL_WEAKENED = str_constant("CL_WEAKENED")
CL_ABSENT = str_constant("CL_ABSENT")
CL_INDETERMINATE = str_constant("CL_INDETERMINATE")

BREACH_RUN_LENGTH = numeric_constant("BREACH_RUN_LENGTH")
CHECK_INTERVAL_SECONDS = numeric_constant("CHECK_INTERVAL_SECONDS")
CONTEST_WINDOW_SECONDS = numeric_constant("CONTEST_WINDOW_SECONDS")
CONTEST_BOND_BASIS_POINTS = numeric_constant("CONTEST_BOND_BASIS_POINTS")
MAX_POINTS_PER_CHECK = numeric_constant("MAX_POINTS_PER_CHECK")

#: Ten percent of 250 GEN, computed from the constant rather than typed, so a change to the basis
#: points breaks the tests that depend on the amount instead of silently moving what a contest costs.
CONTEST_BOND_WEI = bonds.DEFAULT_STAKE * CONTEST_BOND_BASIS_POINTS // 10000

#: The two stamps a breach is built from. Both are after `20260417134054`, the newest row in the
#: 200-row captured index, which is where `create_bond` leaves the cursor; and both are before the
#: wall clock of the check, so the `to=` bound the contract builds actually covers them.
FIRST_STAMP = "20260601090000"
SECOND_STAMP = "20260715120000"

#: A third stamp, for the capture that sits between two weakened ones and breaks the run.
BLANK_STAMP = "20260620000000"

#: The capture the promisor cites when contesting. Same page, a different instant.
CONTEST_STAMP = "20260801000000"

BREACH_ROWS = [(FIRST_STAMP, bonds.SNAPSHOT_ROUTE), (SECOND_STAMP, "snap-github-tos-gzip")]

#: "governing law" is this bond's gate D terminal, so it is present in the normalized text of both
#: qualifying captures by construction: gate D is the same substring test `_classification_of` runs
#: over the model's excerpt. Using it as the quote means a WEAKENED finding is locatable in either
#: capture without a test having to go and read one to find a phrase.
WEAKENED = archive.finding(CL_WEAKENED, "governing law",
                           "the notice period is now stated as thirty days")
ABSENT = archive.finding(CL_ABSENT, "governing law",
                         "the document no longer addresses advance notice at all")
UNREADABLE = archive.finding(CL_INDETERMINATE, "",
                            "this capture does not let the commitment be read either way")

CHECKED_AT = "2026-08-26T09:00:00Z"
#: `CHECKED_AT` plus `CONTEST_WINDOW_SECONDS`. Written out so a test can assert the contract computed
#: it, and asserted against arithmetic over the constant so the two cannot both be wrong.
CONTEST_DEADLINE = "2026-09-02T09:00:00Z"
CONTESTED_AT = "2026-08-27T10:00:00Z"
ADJUDICATED_AT = "2026-08-28T10:00:00Z"

#: The term runs from the baseline capture, 2026-01-29T02:46:08Z, plus 365 days.
EXPIRES_AT = "2027-01-29T02:46:08Z"


# ----------------------------------------------------------------------------
# Staging helpers. Each one states which mocks the method under test may reach.
# ----------------------------------------------------------------------------

def check(contract, direct_vm, value_ledger, bond_id, rows, *, at,
          answers=(), fallback=None):
    """Serve a forward window from the bond's own cursor and run one check.

    The cursor is READ OFF THE BOND rather than written down, so the window is anchored where the
    contract actually is. A test that hard-coded the anchor would keep passing if `create_bond` ever
    stopped advancing the cursor to the newest row it saw, which is the property that stops the first
    check from re-examining the baseline.

    `answers` is a list of `(stamp, json)` pairs, registered before `fallback`, because both mock
    tables are insertion-ordered and the first match wins.
    """
    cursor = contract.get_bond(bond_id)["cursor_timestamp"]
    archive.Archive(direct_vm).window(bonds.BOND_URL, rows, cursor=cursor)
    set_block_time(direct_vm, at)
    for stamp, answer in answers:
        direct_vm.mock_llm(archive.judged_at(stamp), answer)
    if fallback is not None:
        direct_vm.mock_llm(bonds.JUDGE_HOOK, fallback)
    value_ledger.no_value()
    return contract.check_commitment(bond_id)


def claim_breach(contract, direct_vm, value_ledger, *, second=WEAKENED, at=CHECKED_AT):
    """Place a bond and walk it into BREACH_CLAIMED. Returns the bond id."""
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    check(contract, direct_vm, value_ledger, bond_id, BREACH_ROWS, at=at,
          answers=[(FIRST_STAMP, WEAKENED), (SECOND_STAMP, second)])
    return bond_id


def contest(contract, direct_vm, value_ledger, bond_id, *, at=CONTESTED_AT,
            url=bonds.BOND_URL, stamp=CONTEST_STAMP, offer=None):
    """File a contest against an EMPTY mock table.

    The empty table is the assertion. `contest_breach` is documented as deterministic: nothing is
    fetched and no model is asked, because a promisor must not be able to file a contest and then
    decline to have it judged. If a fetch ever moved into filing, every call below fails with an
    unmocked-URL error rather than passing quietly.
    """
    direct_vm.clear_mocks()
    set_block_time(direct_vm, at)
    value_ledger.fund(CONTEST_BOND_WEI if offer is None else offer)
    return contract.contest_breach(bond_id, url, stamp)


def adjudicate(contract, direct_vm, value_ledger, bond_id, *, answer, at=ADJUDICATED_AT,
               url=bonds.BOND_URL, stamp=CONTEST_STAMP, route=bonds.SNAPSHOT_ROUTE):
    """Serve the cited capture as a one-row window and judge it.

    A one-row window is legitimate here where it would not be for a check: `_cdx_member_block`
    requires membership anywhere in the window rather than a pin at row zero, precisely because a
    contest cites a capture the promisor chose and that is legitimately anywhere in the page's
    history.
    """
    archive.Archive(direct_vm).window(url, [(stamp, route)])
    set_block_time(direct_vm, at)
    direct_vm.mock_llm(archive.judged_at(stamp), answer)
    value_ledger.no_value()
    return contract.adjudicate_contest(bond_id)


def settle(contract, direct_vm, value_ledger, bond_id, *, at=CONTEST_DEADLINE, rows=BREACH_ROWS):
    """Re-serve the two cited captures with NO index and NO model answer.

    Both omissions are assertions. `settle_breach` re-fetches the two captures using the digest and
    index length it recorded at claim time, so it needs no fresh CDX call; and it re-verifies rather
    than re-judges, so it asks no model. Serving neither means a settlement that started doing either
    fails here instead of passing on a mock some other helper left registered.
    """
    archive.Archive(direct_vm).snapshots(bonds.BOND_URL, rows)
    set_block_time(direct_vm, at)
    value_ledger.no_value()
    return contract.settle_breach(bond_id)


def offline(direct_vm, value_ledger, at):
    """Clear every mock and set the clock, for the calls that must reach no third party."""
    direct_vm.clear_mocks()
    set_block_time(direct_vm, at)
    value_ledger.no_value()


# ----------------------------------------------------------------------------
# check_commitment: what is and is not a breach
# ----------------------------------------------------------------------------

def test_one_weakened_capture_is_a_run_of_one_and_claims_nothing(
        contract, direct_vm, value_ledger):
    """The floor of the whole design. One edit is not a breach.

    A single weakened capture could be a draft, a staging deploy, an A/B variant, or an edit that is
    reverted the same afternoon. Forfeiting a stake on one reading would make the instrument unusable
    by anyone who edits their own terms page, which is everyone who has one.
    """
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    result = check(contract, direct_vm, value_ledger, bond_id,
                   [(FIRST_STAMP, bonds.SNAPSHOT_ROUTE)], at=CHECKED_AT,
                   answers=[(FIRST_STAMP, WEAKENED)])

    bond = contract.get_bond(bond_id)
    assert bond["state"] == ST_ACTIVE
    assert bond["run_length"] == "1"
    assert bond["run_first_timestamp"] == FIRST_STAMP
    assert bond["breach_first_timestamp"] == ""
    assert bond["cursor_timestamp"] == FIRST_STAMP
    assert bond["last_checked_at"] == CHECKED_AT
    assert "run length 1" in result
    # Nor is a weakened reading a passed check. `create_bond` sets `checks_passed` to 1, because
    # creating a bond judges the baseline capture and requires it to hold, so the count starts at one
    # verified reading and a run of one leaves it there.
    assert bond["checks_passed"] == "1"
    assert value_ledger.transfers == [], "a single weakened capture moved money"


def test_two_consecutive_weakened_captures_claim_a_breach_and_still_move_no_money(
        contract, direct_vm, value_ledger):
    """The claim, and the fact that a claim is not a payout.

    BREACH_CLAIMED opens a contest window and pays nobody. That separation is the whole reason the
    promisor has somewhere to go: a contract that paid the payee the moment two captures read badly
    would give the party who published the commitment no way to show that the archive, or the model,
    or the capture, was wrong about them.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    bond = contract.get_bond(bond_id)

    assert bond["state"] == ST_BREACH_CLAIMED
    assert bond["run_length"] == str(BREACH_RUN_LENGTH)
    assert bond["breach_first_timestamp"] == FIRST_STAMP
    assert bond["breach_second_timestamp"] == SECOND_STAMP
    # The two cited captures are distinct documents. `collapse=digest` means a real index cannot
    # return one digest twice, so a run built from a single capture served at two timestamps would be
    # a sequence the archive could not produce.
    assert bond["breach_first_digest"] != bond["breach_second_digest"]
    assert bond["breach_excerpt"] == "governing law"
    assert bond["claimed_at"] == CHECKED_AT
    assert bond["contest_deadline"] == CONTEST_DEADLINE
    assert bond["cursor_timestamp"] == SECOND_STAMP
    assert bond["settled"] is False
    assert bond["paid_to_payee"] == "0"
    assert value_ledger.transfers == [], "claiming a breach paid somebody"
    assert value_ledger.retained == bonds.DEFAULT_STAKE

    ledger = contract.get_ledger()
    assert ledger["breaches_claimed"] == "1"
    assert ledger["total_paid_to_payees"] == "0"


def test_the_contest_deadline_is_exactly_the_contest_window_after_the_claim(
        contract, direct_vm, value_ledger):
    """Asserted twice over, because a deadline is the one field a promisor plans around.

    Once against the literal in this file, and once against `datetime` arithmetic over the contract's
    own constant. The two are genuinely independent because `_add_seconds` is hand-written calendar
    arithmetic with no date library at all: GenVM's determinism requirements are why the contract
    carries its own leap-year handling, and `datetime` is exactly the implementation it could not use.
    Checking the result against the standard library is therefore a second opinion rather than a
    restatement, and this case crosses a month boundary, which is where a hand-rolled carry fails.
    """
    from datetime import datetime, timedelta, timezone

    bond_id = claim_breach(contract, direct_vm, value_ledger)
    deadline = contract.get_bond(bond_id)["contest_deadline"]

    assert deadline == CONTEST_DEADLINE
    expected = datetime(2026, 8, 26, 9, 0, 0, tzinfo=timezone.utc) + timedelta(
        seconds=CONTEST_WINDOW_SECONDS)
    assert deadline == expected.strftime("%Y-%m-%dT%H:%M:%SZ")
    assert deadline[:7] != CHECKED_AT[:7], "this case no longer crosses a month boundary"
    assert deadline[11:] == CHECKED_AT[11:], "the window moved the time of day as well as the date"


def test_a_gate_rejected_capture_between_two_weakened_ones_breaks_the_run(
        contract, direct_vm, value_ledger):
    """The most consequential of the three non-breach outcomes, and the hardest to argue for.

    A capture that fails the gates is recorded and BREAKS the run. The contract does not know what
    the document said at that instant, and two weakened readings either side of an unknown are not
    consecutive. Treating the gap as transparent would let two unrelated edits separated by one
    defective capture forfeit a stake; treating it as a loss would turn a broken archive capture into
    evidence against the promisor, which is the failure this project measured across four companies.

    The middle capture is a real one: `snap-github-tos-chrome-only`, 8,015 bytes of gzip that inflate
    to a navigation shell with 569 characters of visible text. It is what the archive returns when
    the crawl caught the chrome and not the content, and it is exactly the artefact that looks like a
    successful retrieval and is not one.
    """
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    check(contract, direct_vm, value_ledger, bond_id,
          [(FIRST_STAMP, bonds.SNAPSHOT_ROUTE),
           (BLANK_STAMP, "snap-github-tos-chrome-only"),
           (SECOND_STAMP, "snap-github-tos-gzip")],
          at=CHECKED_AT,
          answers=[(FIRST_STAMP, WEAKENED), (SECOND_STAMP, WEAKENED)])

    bond = contract.get_bond(bond_id)
    assert bond["state"] == ST_ACTIVE, "two weakened captures around a blank frame claimed a breach"
    assert bond["run_length"] == "1", "the run did not restart at the capture after the gap"
    assert bond["run_first_timestamp"] == SECOND_STAMP
    # Four points, not three: `create_bond` records the baseline capture as the first one, so the
    # walk's three sit on top of it.
    assert bond["points_recorded"] == "4", "the blank frame was not recorded"

    history = contract.bond_history(bond_id)
    blank = history[2]
    assert blank["timestamp"] == BLANK_STAMP
    assert blank["qualified"] is False
    assert blank["failed_gates"] == "C,D", blank["failed_gates"]
    assert blank["gate_c_hits"] == "0"
    # No classification, because no model was asked. A gate-rejected capture never reaches the
    # prompt, which is also why this test registers no answer for its stamp.
    assert blank["classification"] == ""
    assert blank["excerpt"] == ""
    assert value_ledger.transfers == []


def test_the_blank_frame_is_visible_in_the_history_rather_than_smoothed_away(
        contract, direct_vm, value_ledger):
    """A history that only listed the captures that worked would make a gap look like a clean run."""
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    check(contract, direct_vm, value_ledger, bond_id,
          [(BLANK_STAMP, "snap-github-tos-chrome-only")], at=CHECKED_AT)

    status = contract.commitment_status(bond_id)
    assert status["examined"] == "2", "the baseline plus the blank frame"
    assert status["qualified"] == "1"
    assert status["gate_rejected"] == "1"
    assert status["holds"] == "1", "the baseline held; the blank frame was never judged"
    # The distinction that matters: the blank frame taught the contract nothing, so the newest capture
    # the commitment is known to have survived is still the baseline. A build that counted a
    # gate-rejected retrieval as a reading would move this forward and report a page as verified at an
    # instant where all the contract holds is 569 characters of navigation chrome.
    assert status["last_qualified_timestamp"] == bonds.BASELINE_STAMP
    assert status["run_length"] == "0"
    assert contract.get_bond(bond_id)["checks_passed"] == "1", "unchanged from creation"


def test_an_indeterminate_reading_breaks_the_run_without_reverting(
        contract, direct_vm, value_ledger):
    """The model saying it cannot tell is a real answer, not an error.

    So it is recorded, it breaks the run, and it does not revert. The alternative — treating "I
    cannot tell" as a failure of the call — would make the bond unresolvable on any page the model
    finds ambiguous, and would hand the outcome to whoever chose to retry at a better moment.
    """
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    result = check(contract, direct_vm, value_ledger, bond_id, BREACH_ROWS, at=CHECKED_AT,
                   answers=[(FIRST_STAMP, WEAKENED), (SECOND_STAMP, UNREADABLE)])

    bond = contract.get_bond(bond_id)
    assert bond["state"] == ST_ACTIVE
    assert bond["run_length"] == "0"
    assert bond["run_first_timestamp"] == ""
    assert bond["points_recorded"] == "3"
    assert "run length 0" in result

    status = contract.commitment_status(bond_id)
    assert status["weakened"] == "1"
    assert status["indeterminate"] == "1"
    assert status["holds"] == "1", "the baseline, and nothing since"
    # All three captures were readable documents, so this is not the blank-frame path wearing a
    # different label: the gates passed and the model declined to rule on the last one.
    assert status["qualified"] == "3"
    assert status["gate_rejected"] == "0"


def test_a_holding_capture_resets_a_run_and_counts_as_a_passed_check(
        contract, direct_vm, value_ledger):
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    check(contract, direct_vm, value_ledger, bond_id, BREACH_ROWS, at=CHECKED_AT,
          answers=[(FIRST_STAMP, WEAKENED), (SECOND_STAMP, archive.holds())])

    bond = contract.get_bond(bond_id)
    assert bond["state"] == ST_ACTIVE
    assert bond["run_length"] == "0"
    assert bond["checks_passed"] == "2", "the baseline plus this one"
    assert contract.commitment_status(bond_id)["holds"] == "2"


def test_the_cursor_row_comes_back_in_the_window_and_is_not_examined_again(
        contract, direct_vm, value_ledger):
    """`from=` is inclusive in CDX, so the contract is handed a capture it has already paid for.

    The proof that it filters that row out rather than re-examining it is structural: the cursor row
    in the served index carries a digest and a length but NO payload mock. A build that fetched it
    would fail here with an unmocked-URL error naming the cursor's own replay URL.
    """
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    cursor = contract.get_bond(bond_id)["cursor_timestamp"]
    result = check(contract, direct_vm, value_ledger, bond_id,
                   [(FIRST_STAMP, bonds.SNAPSHOT_ROUTE)], at=CHECKED_AT,
                   answers=[(FIRST_STAMP, archive.holds())])

    assert "examined 1 change point(s)" in result, result
    history = contract.bond_history(bond_id)
    assert [point["timestamp"] for point in history] == [bonds.BASELINE_STAMP, FIRST_STAMP]
    assert cursor not in [point["timestamp"] for point in history]


def test_an_index_with_nothing_newer_than_the_cursor_reverts_external_and_writes_nothing(
        contract, direct_vm, value_ledger):
    """A retrieval that established nothing must not be recorded as a check that found nothing.

    This is the same distinction the embedded region's empty-index refusal makes: absence of data,
    never absence of change. A page with no new captures has not been verified, so the cursor must
    not move, `last_checked_at` must not be set, and the 24-hour interval must not start running from
    a call that examined no document.
    """
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    before = contract.get_bond(bond_id)

    with pytest.raises(Exception) as caught:
        check(contract, direct_vm, value_ledger, bond_id, [], at=CHECKED_AT)
    message = user_error_message(caught.value)
    assert message.startswith("[EXTERNAL]"), message
    assert "none is newer than the cursor" in message
    assert "examined no document" in message

    after = contract.get_bond(bond_id)
    assert after["cursor_timestamp"] == before["cursor_timestamp"]
    assert after["last_checked_at"] == ""
    assert after["points_recorded"] == "1", "a failed check recorded a change point"
    assert contract.get_ledger()["checks_run"] == "0"


def test_a_second_check_inside_the_interval_is_refused_and_names_the_next_available_time(
        contract, direct_vm, value_ledger):
    """Wayback is a rate-limited third party and a permissionless method is a loop waiting to happen.

    The interval is what stops one bond being used to hammer the archive: anyone may trigger a check,
    but not more than once a day per bond.
    """
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    check(contract, direct_vm, value_ledger, bond_id, [(FIRST_STAMP, bonds.SNAPSHOT_ROUTE)],
          at=CHECKED_AT, answers=[(FIRST_STAMP, archive.holds())])

    with pytest.raises(Exception) as caught:
        check(contract, direct_vm, value_ledger, bond_id, [(SECOND_STAMP, "snap-github-tos-gzip")],
              at="2026-08-26T14:00:00Z", answers=[(SECOND_STAMP, archive.holds())])
    message = user_error_message(caught.value)
    assert message.startswith("[EXPECTED]"), message
    assert "was checked at %s" % CHECKED_AT in message
    assert "the next check is available at 2026-08-27T09:00:00Z" in message
    assert "rate-limited third party" in message
    assert CHECK_INTERVAL_SECONDS == 86400


def test_a_check_once_the_interval_has_elapsed_is_allowed_and_advances_from_the_new_cursor(
        contract, direct_vm, value_ledger):
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    check(contract, direct_vm, value_ledger, bond_id, [(FIRST_STAMP, bonds.SNAPSHOT_ROUTE)],
          at=CHECKED_AT, answers=[(FIRST_STAMP, archive.holds())])
    result = check(contract, direct_vm, value_ledger, bond_id,
                   [(SECOND_STAMP, "snap-github-tos-gzip")],
                   at="2026-08-27T09:00:00Z", answers=[(SECOND_STAMP, archive.holds())])

    bond = contract.get_bond(bond_id)
    assert bond["cursor_timestamp"] == SECOND_STAMP
    assert bond["checks_passed"] == "3", "the baseline plus one per check"
    assert bond["points_recorded"] == "3", "the baseline plus one capture per check"
    assert "examined 1 change point(s)" in result
    # Two calls to `check_commitment`, and the baseline reading is not one of them. `checks_run` on
    # the ledger counts the calls; `checks_passed` on the bond counts readings that held, which is why
    # the two differ by exactly the baseline.
    assert contract.get_ledger()["checks_run"] == "2"


def test_a_saturated_window_defers_the_rest_instead_of_skipping_it(
        contract, direct_vm, value_ledger):
    """The cursor advances to the newest row EXAMINED, never to the wall clock.

    That is what makes truncation safe. CDX truncation drops the newest rows, and a contract that
    moved its cursor to "now" after a capped walk would step over every change point it had not
    looked at, which on a busy page is where a breach would be.

    Nine blank frames rather than nine documents, deliberately. The claim here is arithmetic over row
    counts, and the chrome-only shell is 8,015 bytes against the terms page's 89,652, so using it
    keeps the test measuring deferral rather than measuring how long it takes to inflate and strip
    nine copies of a large page.
    """
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    stamps = ["202605%02d000000" % day for day in range(1, MAX_POINTS_PER_CHECK + 2)]
    assert len(stamps) == MAX_POINTS_PER_CHECK + 1
    result = check(contract, direct_vm, value_ledger, bond_id,
                   [(stamp, "snap-github-tos-chrome-only") for stamp in stamps], at=CHECKED_AT)

    bond = contract.get_bond(bond_id)
    # The baseline plus the cap, and not the baseline plus all nine.
    assert bond["points_recorded"] == str(MAX_POINTS_PER_CHECK + 1)
    assert bond["cursor_timestamp"] == stamps[MAX_POINTS_PER_CHECK - 1]
    assert bond["cursor_timestamp"] != stamps[-1]
    assert "1 further change point(s) are waiting" in result, result


def test_only_an_active_bond_has_change_points_left_to_examine(
        contract, direct_vm, value_ledger):
    bond_id = claim_breach(contract, direct_vm, value_ledger)

    with pytest.raises(Exception) as caught:
        check(contract, direct_vm, value_ledger, bond_id,
              [(CONTEST_STAMP, bonds.SNAPSHOT_ROUTE)], at="2026-08-27T09:00:00Z",
              answers=[(CONTEST_STAMP, archive.holds())])
    message = user_error_message(caught.value)
    assert message.startswith("[EXPECTED]"), message
    assert "is %s, and only an %s bond" % (ST_BREACH_CLAIMED, ST_ACTIVE) in message


def test_a_check_past_the_end_of_the_term_is_refused_and_points_at_expire_bond(
        contract, direct_vm, value_ledger):
    bond_id = bonds.place(contract, direct_vm, value_ledger)

    with pytest.raises(Exception) as caught:
        check(contract, direct_vm, value_ledger, bond_id, [(FIRST_STAMP, bonds.SNAPSHOT_ROUTE)],
              at=EXPIRES_AT, answers=[(FIRST_STAMP, archive.holds())])
    message = user_error_message(caught.value)
    assert message.startswith("[EXPECTED]"), message
    assert "reached the end of its term at %s" % EXPIRES_AT in message
    assert "call expire_bond" in message


def test_the_model_answer_is_stored_on_the_change_point_it_was_given_for(
        contract, direct_vm, value_ledger):
    """Per-stamp answers, so a walk over two captures cannot attribute one reading to both.

    The prompt names the capture's timestamp, which is what lets this test answer each change point
    differently and then check that the right answer landed on the right point. A build that judged
    once and reused the finding would pass every count in this file and fail here.
    """
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    check(contract, direct_vm, value_ledger, bond_id, BREACH_ROWS, at=CHECKED_AT,
          answers=[(FIRST_STAMP, archive.holds("", "unchanged in substance")),
                   (SECOND_STAMP, UNREADABLE)])

    history = {point["timestamp"]: point for point in contract.bond_history(bond_id)}
    assert history[FIRST_STAMP]["classification"] == CL_HOLDS
    assert history[FIRST_STAMP]["rationale"] == "unchanged in substance"
    assert history[SECOND_STAMP]["classification"] == CL_INDETERMINATE
    assert history[SECOND_STAMP]["rationale"].startswith("this capture does not let")


def test_the_two_captures_a_breach_cites_are_recorded_with_their_own_digests_and_encodings(
        contract, direct_vm, value_ledger):
    """The citation has to be retrievable later, which means it has to be specific now."""
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    bond = contract.get_bond(bond_id)
    history = {point["timestamp"]: point for point in contract.bond_history(bond_id)}

    assert bond["breach_first_digest"] == history[FIRST_STAMP]["digest"]
    assert bond["breach_second_digest"] == history[SECOND_STAMP]["digest"]
    assert history[FIRST_STAMP]["digest"] == archive.cdx_digest(archive.raw(bonds.SNAPSHOT_ROUTE))
    assert history[SECOND_STAMP]["digest"] == archive.cdx_digest(archive.raw("snap-github-tos-gzip"))
    # Both captures were compressed on the wire and the contract inflated both. Recorded per point,
    # so a build that decoded one and not the other is visible rather than averaged away.
    assert history[FIRST_STAMP]["encoding"] == "gzip"
    assert history[SECOND_STAMP]["encoding"] == "gzip"
    assert history[FIRST_STAMP]["decoded_sha256"] != history[SECOND_STAMP]["decoded_sha256"]


# ----------------------------------------------------------------------------
# contest_breach
# ----------------------------------------------------------------------------

def test_a_contest_costs_exactly_the_declared_basis_points_of_the_stake(
        contract, direct_vm, value_ledger):
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    result = contest(contract, direct_vm, value_ledger, bond_id)

    bond = contract.get_bond(bond_id)
    assert bond["state"] == ST_CONTESTED
    assert bond["contest_bond"] == str(CONTEST_BOND_WEI)
    assert CONTEST_BOND_WEI == bonds.DEFAULT_STAKE // 10
    assert bond["contest_url"] == bonds.BOND_URL
    assert bond["contest_timestamp"] == CONTEST_STAMP
    assert bond["contested_at"] == CONTESTED_AT
    assert bond["contest_outcome"] == ""
    assert "Anyone may now call adjudicate_contest" in result
    assert value_ledger.transfers == [], "filing a contest paid somebody"

    ledger = contract.get_ledger()
    assert ledger["contests_filed"] == "1"
    assert ledger["total_escrowed"] == str(bonds.DEFAULT_STAKE + CONTEST_BOND_WEI)


def test_a_contest_one_wei_short_is_refused_and_names_the_price(
        contract, direct_vm, value_ledger):
    """A payable refusal, so the shortfall has to be reported exactly rather than approximately.

    Two things are being checked and they are separable. The message carries the required amount, the
    basis points it came from, and what was actually sent, so a promisor can correct the figure without
    guessing. And the shortfall comes back: `contest_breach` is a refusal boundary, because on
    StudioNet a revert does not return the value of the call it reverted, and a promisor who mistyped
    an amount should not lose it.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)

    message = returned_refusal(
        contest(contract, direct_vm, value_ledger, bond_id, offer=CONTEST_BOND_WEI - 1))
    assert message.startswith("[EXPECTED]"), message
    assert "costs %d wei" % CONTEST_BOND_WEI in message
    assert "%d basis points" % CONTEST_BOND_BASIS_POINTS in message
    assert "this call carried %d" % (CONTEST_BOND_WEI - 1) in message
    assert contract.get_bond(bond_id)["state"] == ST_BREACH_CLAIMED
    assert contract.get_bond(bond_id)["contest_bond"] == "0"
    # The bond's own stake is still held and the refused offer is not. Stated as one number so that a
    # refund of the wrong amount fails here rather than looking like a rounding difference.
    assert value_ledger.paid_out == CONTEST_BOND_WEI - 1
    assert value_ledger.retained == bonds.DEFAULT_STAKE


def test_more_than_the_price_is_accepted_and_the_whole_offer_is_escrowed(
        contract, direct_vm, value_ledger):
    """Overpaying is not refused, and the surplus is not kept.

    The contest bond stored is what was sent, not what was owed, so the UPHELD path returns the whole
    offer. A contract that stored the required amount and kept the difference would leak wei on every
    contest filed with a rounded-up amount, which is what a wallet's own gas padding produces.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    contest(contract, direct_vm, value_ledger, bond_id, offer=CONTEST_BOND_WEI + 7)

    assert contract.get_bond(bond_id)["contest_bond"] == str(CONTEST_BOND_WEI + 7)
    adjudicate(contract, direct_vm, value_ledger, bond_id, answer=archive.holds())
    assert value_ledger.paid_to(contract.get_bond(bond_id)["promisor"]) == CONTEST_BOND_WEI + 7


def test_only_the_promisor_may_contest_a_breach(contract, direct_vm, value_ledger):
    """The payee, or any passer-by, contesting on the promisor's behalf is not a courtesy.

    It would let a third party spend the contest window on a citation of their own choosing and
    close the promisor's only route out.

    The refund goes to whoever sent the value, which here is the stranger and not the promisor. Worth
    asserting explicitly: a refund path that read the promisor off the bond instead of the sender off
    the message would pay the wrong party on exactly this call, and every other refusal test in this
    file is sent by the promisor and could not tell the difference.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    # The sender setter accepts raw bytes and wraps them, so a stranger can be named without
    # importing the SDK's `Address` into the host process.
    direct_vm.sender = bytes.fromhex("cc" * 20)

    message = returned_refusal(contest(contract, direct_vm, value_ledger, bond_id))
    assert message.startswith("[EXPECTED]"), message
    assert "only the promisor of bond %s may contest" % bond_id in message
    assert contract.get_bond(bond_id)["state"] == ST_BREACH_CLAIMED
    assert value_ledger.paid_to(direct_vm.sender) == CONTEST_BOND_WEI
    assert value_ledger.paid_to(contract.get_bond(bond_id)["promisor"]) == 0


def test_a_contest_filed_after_the_window_closed_is_refused(contract, direct_vm, value_ledger):
    bond_id = claim_breach(contract, direct_vm, value_ledger)

    message = returned_refusal(
        contest(contract, direct_vm, value_ledger, bond_id, at=CONTEST_DEADLINE))
    assert message.startswith("[EXPECTED]"), message
    assert "the contest window on bond %s closed at %s" % (bond_id, CONTEST_DEADLINE) in message
    assert value_ledger.retained == bonds.DEFAULT_STAKE


def test_only_a_claimed_bond_can_be_contested(contract, direct_vm, value_ledger):
    bond_id = bonds.place(contract, direct_vm, value_ledger)

    message = returned_refusal(contest(contract, direct_vm, value_ledger, bond_id))
    assert message.startswith("[EXPECTED]"), message
    assert "is %s; only a %s bond can be contested" % (ST_ACTIVE, ST_BREACH_CLAIMED) in message
    assert value_ledger.retained == bonds.DEFAULT_STAKE


def test_a_contest_citing_a_malformed_timestamp_is_refused_before_anything_is_escrowed(
        contract, direct_vm, value_ledger):
    bond_id = claim_breach(contract, direct_vm, value_ledger)

    message = returned_refusal(
        contest(contract, direct_vm, value_ledger, bond_id, stamp="2026-08-01"))
    assert message.startswith("[EXPECTED]"), message
    assert "evidence_timestamp" in message
    assert contract.get_bond(bond_id)["contest_bond"] == "0"
    assert contract.get_ledger()["total_escrowed"] == str(bonds.DEFAULT_STAKE)
    assert value_ledger.retained == bonds.DEFAULT_STAKE


# ----------------------------------------------------------------------------
# adjudicate_contest
# ----------------------------------------------------------------------------

def test_an_upheld_contest_returns_the_bond_restores_active_and_clears_every_breach_field(
        contract, direct_vm, value_ledger):
    """The route back. A promisor who can show the commitment still stands loses nothing.

    Clearing the run fields as well as the breach fields is the part worth checking. A restored bond
    that kept `run_length` at two would claim a breach again on the very next weakened capture, which
    would make an upheld contest worth one capture rather than a clean slate.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    contest(contract, direct_vm, value_ledger, bond_id)
    result = adjudicate(contract, direct_vm, value_ledger, bond_id, answer=archive.holds())

    bond = contract.get_bond(bond_id)
    assert bond["state"] == ST_ACTIVE
    assert bond["contest_outcome"] == "UPHELD"
    assert bond["contest_bond"] == "0"
    assert bond["returned_to_promisor"] == str(CONTEST_BOND_WEI)
    for field in ("claimed_at", "contest_deadline", "breach_first_timestamp",
                  "breach_first_digest", "breach_second_timestamp", "breach_second_digest",
                  "breach_excerpt", "breach_rationale", "run_first_timestamp"):
        assert bond[field] == "", "%s survived an upheld contest" % field
    assert bond["run_length"] == "0"
    assert "the claim is withdrawn" in result

    assert value_ledger.paid_to(bond["promisor"]) == CONTEST_BOND_WEI
    assert value_ledger.paid_to(bond["payee"]) == 0
    # The stake is still escrowed: the bond is live again, not settled.
    assert value_ledger.retained == bonds.DEFAULT_STAKE
    assert contract.get_ledger()["total_returned_to_promisors"] == str(CONTEST_BOND_WEI)
    assert contract.get_ledger()["total_paid_to_payees"] == "0"


def test_a_failed_contest_pays_the_stake_and_the_contest_bond_to_the_payee(
        contract, direct_vm, value_ledger):
    """Contesting is not free, and losing costs the bond that was posted to contest.

    Without that, filing is a free option: a promisor in breach would always contest, because a
    contest that costs nothing to lose delays settlement at no risk.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    contest(contract, direct_vm, value_ledger, bond_id)
    result = adjudicate(contract, direct_vm, value_ledger, bond_id, answer=ABSENT)

    bond = contract.get_bond(bond_id)
    payout = bonds.DEFAULT_STAKE + CONTEST_BOND_WEI
    assert bond["state"] == ST_BREACHED
    assert bond["contest_outcome"] == "FAILED"
    assert bond["contest_bond"] == "0"
    assert bond["settled"] is True
    assert bond["settled_at"] == ADJUDICATED_AT
    assert bond["paid_to_payee"] == str(payout)
    assert "the contest failed and %d wei went to the payee" % payout in result
    assert CL_ABSENT in result

    assert value_ledger.paid_to(bond["payee"]) == payout
    assert value_ledger.paid_to(bond["promisor"]) == 0
    assert value_ledger.retained == 0, "the contract kept wei on a settled bond"
    assert contract.get_ledger()["total_paid_to_payees"] == str(payout)
    assert contract.get_ledger()["fee_basis_points"] == "0"


def test_an_indeterminate_adjudication_reverts_transient_leaves_it_contested_and_pays_nobody(
        contract, direct_vm, value_ledger):
    """The honest stuck state, and the one place this contract chooses a visible failure.

    Forfeiting a stake because a model could not tell is the thing the whole design refuses, and
    paying the payee on ambiguity would do exactly that. So an unreadable adjudication reverts as
    TRANSIENT, the bond stays CONTESTED, and anyone may call again. That is a stuck state, it is
    documented as one in the contract, and it is asserted as one here rather than being written up as
    a resolution.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    contest(contract, direct_vm, value_ledger, bond_id)

    with pytest.raises(Exception) as caught:
        adjudicate(contract, direct_vm, value_ledger, bond_id, answer=UNREADABLE)
    message = user_error_message(caught.value)
    assert message.startswith("[TRANSIENT]"), message
    assert "stays %s" % ST_CONTESTED in message
    assert "Call again; nothing has moved." in message

    bond = contract.get_bond(bond_id)
    assert bond["state"] == ST_CONTESTED
    assert bond["contest_bond"] == str(CONTEST_BOND_WEI)
    assert bond["contest_outcome"] == ""
    assert value_ledger.transfers == []
    # And calling again resolves it, which is what makes the revert retryable rather than terminal.
    adjudicate(contract, direct_vm, value_ledger, bond_id, answer=archive.holds())
    assert contract.get_bond(bond_id)["state"] == ST_ACTIVE


def test_a_cited_capture_that_fails_the_gates_is_refused_external_and_pays_nobody(
        contract, direct_vm, value_ledger):
    """A contest has to cite an artefact that is structurally the document it claims to be.

    Otherwise the cheapest possible contest is a navigation shell: it retrieves cleanly, it contains
    none of the terms, and a model asked whether a commitment holds in 569 characters of chrome could
    answer almost anything.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    contest(contract, direct_vm, value_ledger, bond_id)

    with pytest.raises(Exception) as caught:
        adjudicate(contract, direct_vm, value_ledger, bond_id, answer=archive.holds(),
                   route="snap-github-tos-chrome-only")
    message = user_error_message(caught.value)
    assert message.startswith("[EXTERNAL]"), message
    assert "did not qualify: gate(s) C,D did not pass" in message
    assert "structurally the document it claims to be" in message
    assert contract.get_bond(bond_id)["state"] == ST_CONTESTED
    assert value_ledger.transfers == []


def test_the_cited_capture_is_judged_against_the_bonds_own_gate_specification(
        contract, direct_vm, value_ledger):
    """`_spec_for` rebuilds the specification from storage, and this is the empirical proof.

    The contest cites a different company's terms page. `snap-aws-terms-gzip` is 215,912 bytes of
    gzip and it is a real, complete terms document: gate B passes because the page contains its own
    anchor word, and gate C passes at two of three section hits on the `hits >= total - 1` margin.
    It fails gate D ALONE, because gate D looks for "governing law" — the terminal phrase THIS bond
    declared, over a page that does not contain it.

    That single failing gate is the measurement. If adjudication derived its specification from the
    evidence URL, the terminal would have come from somewhere else and gate D would have had no
    reason to be the one that failed. And it is the only demonstration in this project's fixture set
    that gate D does work the other gates do not: gate B passes on all eight captured payloads under
    this anchor, so gates C and D are the whole of the discrimination, and this is the one capture
    where C passes and D does not.
    """
    aws_url = "https://aws.amazon.com/service-terms/"
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    contest(contract, direct_vm, value_ledger, bond_id, url=aws_url)

    with pytest.raises(Exception) as caught:
        adjudicate(contract, direct_vm, value_ledger, bond_id, answer=archive.holds(),
                   url=aws_url, route="snap-aws-terms-gzip")
    message = user_error_message(caught.value)
    assert message.startswith("[EXTERNAL]"), message
    assert "gate(s) D did not pass" in message, message
    assert "gate(s) C" not in message, "gate C rejected a complete terms document: " + message
    assert contract.get_bond(bond_id)["anchor_terminal"] == bonds.ANCHOR_TERMINAL


def test_a_contest_the_model_answers_outside_the_four_words_fails_closed_as_an_llm_error(
        contract, direct_vm, value_ledger):
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    contest(contract, direct_vm, value_ledger, bond_id)

    with pytest.raises(Exception) as caught:
        adjudicate(contract, direct_vm, value_ledger, bond_id,
                   answer=json.dumps({"classification": "PROBABLY HOLDS", "excerpt": "",
                                      "rationale": "close enough"}))
    message = user_error_message(caught.value)
    assert message.startswith("[LLM_ERROR]"), message
    assert "which is not one of" in message
    for word in (CL_HOLDS, CL_WEAKENED, CL_ABSENT, CL_INDETERMINATE):
        assert word in message
    assert contract.get_bond(bond_id)["state"] == ST_CONTESTED
    assert value_ledger.transfers == []


def test_a_failed_contest_finding_whose_quote_is_not_in_the_cited_capture_moves_no_money(
        contract, direct_vm, value_ledger):
    """The quote requirement is a spend gate, not a formatting rule.

    An ABSENT finding on the cited capture is what sends the stake and the contest bond to the payee,
    so it is the single most expensive sentence a model can produce in this contract. Requiring the
    quote to be locatable in the document means a confident paraphrase cannot move a stake on its
    own.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    contest(contract, direct_vm, value_ledger, bond_id)

    with pytest.raises(Exception) as caught:
        adjudicate(contract, direct_vm, value_ledger, bond_id,
                   answer=archive.finding(CL_ABSENT, "we may change these terms whenever we like"))
    message = user_error_message(caught.value)
    assert message.startswith("[LLM_ERROR]"), message
    assert "quoted excerpt is not in the document" in message
    assert contract.get_bond(bond_id)["state"] == ST_CONTESTED
    assert value_ledger.transfers == []


def test_only_a_contested_bond_can_be_adjudicated(contract, direct_vm, value_ledger):
    bond_id = claim_breach(contract, direct_vm, value_ledger)

    with pytest.raises(Exception) as caught:
        adjudicate(contract, direct_vm, value_ledger, bond_id, answer=archive.holds())
    message = user_error_message(caught.value)
    assert message.startswith("[EXPECTED]"), message
    assert "is %s; only a %s bond can be adjudicated" % (ST_BREACH_CLAIMED, ST_CONTESTED) in message


def test_an_adjudication_records_the_cited_capture_in_the_history(
        contract, direct_vm, value_ledger):
    """A contest is evidence too, so it joins the same timeline rather than a separate one."""
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    contest(contract, direct_vm, value_ledger, bond_id)
    adjudicate(contract, direct_vm, value_ledger, bond_id,
               answer=archive.holds("governing law", "the twelve month notice clause is intact"))

    history = contract.bond_history(bond_id)
    assert [point["timestamp"] for point in history] == [
        bonds.BASELINE_STAMP, FIRST_STAMP, SECOND_STAMP, CONTEST_STAMP]
    cited = history[-1]
    assert cited["classification"] == CL_HOLDS
    assert cited["rationale"] == "the twelve month notice clause is intact"
    assert cited["observed_at"] == ADJUDICATED_AT
    assert contract.get_bond(bond_id)["points_recorded"] == "4"


# ----------------------------------------------------------------------------
# settle_breach
# ----------------------------------------------------------------------------

def test_settling_before_the_window_closes_is_refused_and_names_the_deadline(
        contract, direct_vm, value_ledger):
    bond_id = claim_breach(contract, direct_vm, value_ledger)

    with pytest.raises(Exception) as caught:
        settle(contract, direct_vm, value_ledger, bond_id, at="2026-09-02T08:59:59Z")
    message = user_error_message(caught.value)
    assert message.startswith("[EXPECTED]"), message
    assert "is open until %s" % CONTEST_DEADLINE in message
    assert value_ledger.transfers == []


def test_settlement_re_verifies_both_captures_and_pays_exactly_the_stake(
        contract, direct_vm, value_ledger):
    """The payout path, and the two things settlement deliberately does not do.

    It makes no fresh index call and it asks no model: `settle` above registers neither, so a build
    that started doing either would fail here with an unmocked request rather than pass. What it does
    do is re-fetch both cited captures and re-admit them against the digest and index length recorded
    at claim time. That is what makes the citation a claim about retrievable evidence rather than
    about a row the contract wrote down for itself, and it is the difference between a settlement that
    can be checked by anyone later and one that can only be taken on trust.

    Settled at the deadline exactly, because `_at_or_after` is inclusive and the boundary is where a
    fencepost error would live.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    result = settle(contract, direct_vm, value_ledger, bond_id)

    bond = contract.get_bond(bond_id)
    assert bond["state"] == ST_BREACHED
    assert bond["settled"] is True
    assert bond["settled_at"] == CONTEST_DEADLINE
    assert bond["paid_to_payee"] == str(bonds.DEFAULT_STAKE)
    assert bond["returned_to_promisor"] == "0"
    assert "both cited captures re-verified" in result
    assert "%d wei paid to the payee" % bonds.DEFAULT_STAKE in result

    # The payee gets the stake and nothing more: no contest bond was posted, and the fee is zero.
    assert value_ledger.transfers == [(bond["payee"].lower(), bonds.DEFAULT_STAKE)]
    assert value_ledger.retained == 0
    ledger = contract.get_ledger()
    assert ledger["total_paid_to_payees"] == str(bonds.DEFAULT_STAKE)
    assert ledger["total_escrowed"] == str(bonds.DEFAULT_STAKE)
    assert ledger["total_returned_to_promisors"] == "0"


def test_a_cited_capture_whose_bytes_changed_blocks_settlement_transiently(
        contract, direct_vm, value_ledger):
    """Re-verification against the content pin, demonstrated by serving something else entirely.

    WHICH GATE FIRES HERE IS THE WHOLE POINT, and it is not the one a reader would guess. Two
    different checks could catch a substituted payload, and only one of them can.

    The archive's published digest cannot. `retrieve_snapshot` does compare it, before it decodes
    anything, and on a capture that arrives still stored a mismatch refuses `[TRANSIENT]
    digest-mismatch` right there. But the bytes served here arrive already decoded, which is the only
    form GenVM's transport ever hands over for a `Content-Encoding: gzip` capture, and against a
    decoded body the published digest cannot agree even when nothing is wrong. So `classify_digest`
    records `transport-decoded` and passes, exactly as it does on an honest read.

    What catches it is `_require_stable_replay`, comparing `decoded_sha256` against the hash written
    onto the point when the breach was claimed. That pin does not need the archive's cooperation and
    it is answerable across calls, which the published digest never was. The refusal names the
    timestamp and both hashes, because the actionable fact is that one capture read two ways.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)

    with pytest.raises(Exception) as caught:
        settle(contract, direct_vm, value_ledger, bond_id,
               rows=[(FIRST_STAMP, "snap-openai-tou-identity"),
                     (SECOND_STAMP, "snap-github-tos-gzip")])
    message = user_error_message(caught.value)
    assert "[TRANSIENT]" in message, message
    assert "replay-changed" in message, message
    assert FIRST_STAMP in message, message

    bond = contract.get_bond(bond_id)
    assert bond["state"] == ST_BREACH_CLAIMED, "a failed re-verification settled the bond anyway"
    assert bond["settled"] is False
    assert value_ledger.transfers == []
    # And the honest consequence: a capture whose bytes no longer match cannot be settled against at
    # all. The stake stays escrowed until the term ends, which is a stuck state and is documented as
    # one rather than resolved by trusting the recorded row.
    assert contract.get_ledger()["total_paid_to_payees"] == "0"


def test_a_cited_capture_that_no_longer_qualifies_blocks_settlement_externally(
        contract, direct_vm, value_ledger):
    """Distinguished from the digest case on purpose: same bytes, different verdict.

    Here the payload is not swapped. The bond's own gate specification is what changes what qualifies,
    so this is exercised by settling a breach whose second cited capture is the chrome-only shell —
    a capture that was admitted as a blank frame and can never have been part of a run. Reaching the
    gate branch requires the digest to match first, which is why the same bytes are served back.
    """
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    # A run of two where the second capture is a shell is impossible through `check_commitment`, so
    # the claim is built from two qualifying captures and the SHELL is served at settlement under its
    # own recorded digest. That is a capture whose bytes are intact and whose content is not the
    # document, which is exactly the case the re-verification gate exists for.
    check(contract, direct_vm, value_ledger, bond_id,
          [(FIRST_STAMP, bonds.SNAPSHOT_ROUTE), (SECOND_STAMP, "snap-github-tos-gzip")],
          at=CHECKED_AT, answers=[(FIRST_STAMP, WEAKENED), (SECOND_STAMP, WEAKENED)])
    assert contract.get_bond(bond_id)["state"] == ST_BREACH_CLAIMED

    with pytest.raises(Exception) as caught:
        settle(contract, direct_vm, value_ledger, bond_id,
               rows=[(FIRST_STAMP, "snap-github-tos-chrome-only"),
                     (SECOND_STAMP, "snap-github-tos-gzip")])
    message = user_error_message(caught.value)
    # The digest is checked before the gates, so swapping the payload reports the digest. That is the
    # correct ordering and this assertion pins it: the gate branch is only reachable when the bytes
    # are the recorded ones and the gates have changed their mind about them, which cannot happen
    # while the specification is immutable. Recorded as a genuinely unreachable branch rather than
    # dressed up as a passing test.
    assert "[TRANSIENT]" in message, message
    assert "digest-mismatch" in message, message
    assert contract.get_bond(bond_id)["state"] == ST_BREACH_CLAIMED


def test_a_contested_bond_cannot_be_settled_behind_the_contest(
        contract, direct_vm, value_ledger):
    """Settlement requires an UNCONTESTED claim, or filing a contest would buy nothing."""
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    contest(contract, direct_vm, value_ledger, bond_id)

    with pytest.raises(Exception) as caught:
        settle(contract, direct_vm, value_ledger, bond_id)
    message = user_error_message(caught.value)
    assert message.startswith("[EXPECTED]"), message
    assert "is %s; only an uncontested %s bond can be settled" % (
        ST_CONTESTED, ST_BREACH_CLAIMED) in message
    assert value_ledger.transfers == []


def test_a_settled_bond_cannot_be_settled_twice(contract, direct_vm, value_ledger):
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    settle(contract, direct_vm, value_ledger, bond_id)

    with pytest.raises(Exception) as caught:
        settle(contract, direct_vm, value_ledger, bond_id, at="2026-09-03T09:00:00Z")
    message = user_error_message(caught.value)
    assert message.startswith("[EXPECTED]"), message
    assert "is %s" % ST_BREACHED in message
    assert value_ledger.paid_out == bonds.DEFAULT_STAKE, "the stake was paid out twice"


# ----------------------------------------------------------------------------
# expire_bond
# ----------------------------------------------------------------------------

def test_expiry_returns_the_whole_stake_to_the_promisor_and_asks_nothing_of_any_third_party(
        contract, direct_vm, value_ledger):
    """The ordinary ending, and it must not depend on the archive being reachable.

    A promisor whose stake could only be released by a call that fetches something has a stake held
    hostage by Wayback's uptime. So expiry is arithmetic over stored state: the mock table is empty
    here and the call succeeds.
    """
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    offline(direct_vm, value_ledger, EXPIRES_AT)
    result = contract.expire_bond(bond_id)

    bond = contract.get_bond(bond_id)
    assert bond["state"] == ST_RETURNED
    assert bond["settled"] is True
    assert bond["settled_at"] == EXPIRES_AT
    assert bond["returned_to_promisor"] == str(bonds.DEFAULT_STAKE)
    assert bond["paid_to_payee"] == "0"
    assert "the term ended at %s" % EXPIRES_AT in result
    assert "%d wei returned to the promisor" % bonds.DEFAULT_STAKE in result

    assert value_ledger.transfers == [(bond["promisor"].lower(), bonds.DEFAULT_STAKE)]
    assert value_ledger.retained == 0
    assert contract.get_ledger()["total_returned_to_promisors"] == str(bonds.DEFAULT_STAKE)
    assert contract.get_ledger()["total_paid_to_payees"] == "0"


def test_expiry_is_refused_one_second_before_the_term_ends(contract, direct_vm, value_ledger):
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    offline(direct_vm, value_ledger, "2027-01-29T02:46:07Z")

    with pytest.raises(Exception) as caught:
        contract.expire_bond(bond_id)
    message = user_error_message(caught.value)
    assert message.startswith("[EXPECTED]"), message
    assert "runs until %s" % EXPIRES_AT in message
    assert value_ledger.transfers == []


def test_a_claimed_breach_does_not_time_out_into_a_returned_stake(
        contract, direct_vm, value_ledger):
    """The one attack expiry has to be closed against.

    If a claimed breach could expire, a promisor in breach would simply wait: the contest window
    closes, nobody settles, the term ends, and the stake comes back. So expiry is ACTIVE-only, and a
    claim either settles or is contested. Neither is a timeout.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    offline(direct_vm, value_ledger, EXPIRES_AT)

    with pytest.raises(Exception) as caught:
        contract.expire_bond(bond_id)
    message = user_error_message(caught.value)
    assert message.startswith("[EXPECTED]"), message
    assert "only an %s bond expires" % ST_ACTIVE in message
    assert "neither is a timeout" in message
    assert value_ledger.transfers == []
    # And the claim is still settleable at that late date, so nothing was lost by waiting.
    settle(contract, direct_vm, value_ledger, bond_id, at=EXPIRES_AT)
    assert contract.get_bond(bond_id)["state"] == ST_BREACHED


def test_a_returned_bond_cannot_be_expired_twice(contract, direct_vm, value_ledger):
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    offline(direct_vm, value_ledger, EXPIRES_AT)
    contract.expire_bond(bond_id)

    with pytest.raises(Exception) as caught:
        contract.expire_bond(bond_id)
    message = user_error_message(caught.value)
    assert message.startswith("[EXPECTED]"), message
    assert "is %s" % ST_RETURNED in message
    assert value_ledger.paid_out == bonds.DEFAULT_STAKE, "the stake was returned twice"


def test_a_bond_that_survives_its_term_reports_the_checks_it_survived(
        contract, direct_vm, value_ledger):
    """Two, not one: the baseline reading at creation counts, and it should.

    A bond whose baseline capture was retrieved, gated and judged as making the commitment has been
    verified once before any check runs. Reporting that as zero would understate what the promisor
    actually demonstrated, and reporting the checks separately from the readings is why `checks_run`
    on the ledger and `checks_passed` on the bond are two different numbers.
    """
    bond_id = bonds.place(contract, direct_vm, value_ledger)
    check(contract, direct_vm, value_ledger, bond_id, [(FIRST_STAMP, bonds.SNAPSHOT_ROUTE)],
          at=CHECKED_AT, answers=[(FIRST_STAMP, archive.holds())])
    offline(direct_vm, value_ledger, EXPIRES_AT)
    result = contract.expire_bond(bond_id)

    assert "surviving 2 check(s)" in result, result
    assert contract.commitment_status(bond_id)["state"] == ST_RETURNED


# ----------------------------------------------------------------------------
# Conservation across a whole life
# ----------------------------------------------------------------------------

def test_across_a_contested_and_failed_life_every_wei_in_comes_back_out(
        contract, direct_vm, value_ledger):
    """The one property none of the four methods above may violate, checked end to end.

    Two payments in, one payment out, nothing retained, and the contract's own totals agreeing with
    the transfers it actually emitted. The fee is zero by construction, so "nothing retained" is
    exactly right rather than approximately: any wei left behind is a bug, not a margin.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    contest(contract, direct_vm, value_ledger, bond_id)
    adjudicate(contract, direct_vm, value_ledger, bond_id, answer=ABSENT)

    escrowed = bonds.DEFAULT_STAKE + CONTEST_BOND_WEI
    assert value_ledger.funded == escrowed
    assert value_ledger.paid_out == escrowed
    assert value_ledger.retained == 0
    assert len(value_ledger.transfers) == 1, "the payout was split into several transfers"

    ledger = contract.get_ledger()
    assert ledger["total_escrowed"] == str(escrowed)
    assert ledger["total_paid_to_payees"] == str(escrowed)
    assert ledger["total_returned_to_promisors"] == "0"
    assert int(ledger["total_escrowed"]) - int(ledger["total_paid_to_payees"]) - int(
        ledger["total_returned_to_promisors"]) == 0
    assert ledger["bonds_created"] == "1"
    assert ledger["checks_run"] == "1"
    assert ledger["breaches_claimed"] == "1"
    assert ledger["contests_filed"] == "1"


def test_across_an_upheld_contest_and_a_clean_expiry_both_parties_are_made_whole(
        contract, direct_vm, value_ledger):
    """The other complete life: a breach claimed, contested successfully, and the term run out.

    The promisor gets the contest bond back at adjudication and the stake back at expiry, in two
    separate transfers, and the payee gets nothing. That is the outcome a promisor who was wrongly
    claimed against should end up with, and it is the sequence with the most state to get wrong.
    """
    bond_id = claim_breach(contract, direct_vm, value_ledger)
    contest(contract, direct_vm, value_ledger, bond_id)
    adjudicate(contract, direct_vm, value_ledger, bond_id, answer=archive.holds())
    offline(direct_vm, value_ledger, EXPIRES_AT)
    contract.expire_bond(bond_id)

    bond = contract.get_bond(bond_id)
    escrowed = bonds.DEFAULT_STAKE + CONTEST_BOND_WEI
    assert bond["state"] == ST_RETURNED
    assert bond["contest_outcome"] == "UPHELD"
    assert bond["returned_to_promisor"] == str(escrowed)
    assert bond["paid_to_payee"] == "0"

    assert value_ledger.paid_to(bond["promisor"]) == escrowed
    assert value_ledger.paid_to(bond["payee"]) == 0
    assert value_ledger.retained == 0
    assert len(value_ledger.transfers) == 2, "the two returns were merged into one"

    ledger = contract.get_ledger()
    assert ledger["total_returned_to_promisors"] == str(escrowed)
    assert ledger["total_paid_to_payees"] == "0"
