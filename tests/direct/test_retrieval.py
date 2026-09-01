"""What the archive answers when it is not answering, under the real SDK.

WHAT THIS FILE CARRIES THAT THE OFFLINE SUITE DOES NOT. The 63 offline tests drive `parse_cdx`,
`fetch_bytes` and the three caps directly, with a hand-written fetch stub, so they can hand those
functions any argument at all. That is the right way to test a function and the wrong way to test a
contract, because it says nothing about whether the assembled contract can REACH those refusals.
Every refusal below is reached the way a caller reaches it: through `create_bond` or
`check_commitment`, through `strict_eq`, through the real `gl.nondet.web` mock layer. A refusal that
exists in the module and is unreachable from the interface is not a defence, and this file is what
tells the two apart.

THE FOUR RESPONSES THAT LOOK LIKE SUCCESS. All four are HTTP responses a naive contract accepts:

  200 with a 3-byte `[]` body    a URL the archive has never captured
  302 with a `location` header   a timestamp one second off a real capture
  200 with a `-` length column   a revisit record the index cannot size
  200 with an honest length      that understates its own payload by 7.84x

Not one of them is an error the status line reveals, and the first is the dangerous one: zero change
points read as "the document never changed" is the exact inversion that turns a page nobody archived
into a year of clean checks. `parse_cdx` refuses it `[EXTERNAL]` and the tests here prove the
refusal survives the trip out through `strict_eq` and the error taxonomy.

WHICH ROWS ARE FABRICATED, AND WHY EACH ONE IS. The captured payloads are real and are never
touched. Four tests build a CDX row by hand, and each fabricates exactly one column:

  the length column, set to `250000`   to lift cap 1 off the oversize capture so the payload can
                                       reach caps 2 and 3. Its real length, 260,662, sits 4.3
                                       percent over the cap, so with the real row the two later
                                       caps are never exercised and their independence is not
                                       demonstrated. Named here rather than buried.
  the length column, set to `-`        the revisit-record form, which the archive really emits and
                                       which none of the eight captures happens to carry
  the timestamp column, 15 digits      a malformed row, which the archive should never emit

Everything else in those rows, including every digest, is computed from the bytes the mock serves.

ONE TAXONOMY WRINKLE, RECORDED RATHER THAN SMOOTHED OVER. A malformed index row surfaces as
`[EXPECTED]`, because `require_exact_timestamp` was written for a caller-supplied timestamp and the
same function sees the row. `[EXPECTED]` is the one tag that means "a verdict about the caller", so
on that one path a third-party defect is reported as the caller's fault. The test below asserts what
the contract does and says so plainly; it is reachable only if Wayback returns a row that is not 14
digits, which is why it has not been changed rather than why it is right.

AND ONE THING THIS FILE FOUND THE HARD WAY. Six of these tests were written asserting that a refusal
message begins with its tag, and six of them failed. The contract refuses in two shapes: a sentence
it writes itself, tag first, and the repr of a `Refusal` that crossed `strict_eq`, tag eight
characters in. Both are correct. The consequence is that a reader has to FIND the tag, which the
frontend's dry-run classifier does and the check runner's classifier did not, and that is how a
`[TRANSIENT]` digest mismatch came to be displayed as a refusal the caller should accept. The two
tests under "the two shapes a refusal message comes in" pin the difference so the next reader meets
it as an assertion instead of as a bug.

AND ONE THING THE SHAPES DO NOT DEPEND ON. `create_bond` is payable, so it does not revert on a
refusal at all: it refunds the stake and RETURNS the sentence, because a GenVM revert undoes the
storage writes and does not undo the transfer that funded the call. `check_commitment` is not payable
and still raises. So the tests below reach the same sentences two ways, through `returned_refusal` and
through `user_error_message`, and `assert_refusal` reads either one, because the shape of the message
is a property of where the refusal came from and not of how it was delivered.
"""

from __future__ import annotations

import hashlib
import json

import pytest

import archive
import bonds
from conftest import (constant, numeric_constant, returned_refusal, set_block_time, str_constant,
                      user_error_message)

ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"

ST_ACTIVE = str_constant("ST_ACTIVE")

CDX_WARC_LENGTH_MAX = numeric_constant("CDX_WARC_LENGTH_MAX")
RAW_MAX_BYTES = numeric_constant("RAW_MAX_BYTES")
DECODED_MAX_BYTES = numeric_constant("DECODED_MAX_BYTES")
MIN_CHANGE_POINTS = numeric_constant("MIN_CHANGE_POINTS")

#: Read as text and floated rather than through `numeric_constant`, which rejects a decimal point on
#: purpose: it exists for the constants written as arithmetic and a float slipping through it would
#: be truncated to an int without complaint.
CDX_WORST_OBSERVED_EXPANSION = float(constant("CDX_WORST_OBSERVED_EXPANSION"))

#: The deprecation page, which is the only target with an oversize capture, and the timestamp that
#: capture was really taken at. Both read off the fixture's own URL rather than typed, so a re-capture
#: that lands on a different instant moves the tests with it.
OVERSIZE_URL = "https://cloud.google.com/terms/deprecation"
OVERSIZE_STAMP = archive.ROUTES[archive.OVERSIZE_ROUTE]["url"].split("/web/")[1].split("id_/")[0]

#: The redirect fixture: one second off a real capture at 20230320142124.
REDIRECT_ROUTE = "snap-inexact-timestamp"
REDIRECT_STAMP = archive.ROUTES[REDIRECT_ROUTE]["url"].split("/web/")[1].split("id_/")[0]

#: A target the archive has never captured. Synthetic and deliberately unresolvable, because the
#: thing being tested is the response and not the page.
NEVER_ARCHIVED_URL = "https://holdfast-never-archived.example/terms"

AT = "2026-08-25T11:00:00Z"

#: A section list and terminal that are absent from the deprecation page, kept identical to the one
#: the fixture set was measured under so `failed_gates` here can be compared to that measurement.
#: The anchor is NOT chosen: `_derive_anchor` takes it from the last path segment, so it is
#: "deprecation", which the deprecation page does contain. Gate B therefore passes, as it does on all
#: eight captures under every specification tried in this project, and gates C and D do the refusing.
SECTIONS = '["definitions", "payment", "confidential"]'
TERMINAL = "governing law"


def assert_refusal(message: str, tag: str, reason: str) -> None:
    """A refusal that crossed `strict_eq` arrives as a `Refusal` REPR, not as a tagged sentence.

    MEASURED, AND NOT WHAT THIS FILE ASSUMED ON ITS FIRST RUN. The contract refuses in two shapes and
    they are not interchangeable:

      `_reject` and the hand-written raises produce `"[EXTERNAL] the index answered with 1 row(s)…"`,
      with the tag at position 0.

      A refusal from the embedded region travels out of `strict_eq` as `refusal.message`, and
      `Refusal.message` is a property returning `repr(self)`, so `_raise_if_error` re-raises
      `"Refusal([EXTERNAL] cdx-empty: 200 with a 3 byte body…)"` verbatim, with the tag at position 8
      and a closing parenthesis on the end.

    `_raise_if_error` adding no wording of its own is deliberate and right: the refusal already says
    what happened and where, and rewrapping it would put the contract's paraphrase between the reader
    and the measurement. `_refund_and_report`, on the payable side, does the same thing for the same
    reason, which is why this one function reads a raised refusal and a returned one identically.
    The consequence is that anything parsing these messages has to find the tag rather than read it
    off the front, which is asserted here as a shape rather than left implicit.

    Matching the whole prefix including the reason and the colon, rather than testing `tag in
    message`, so that a refusal arriving with the right tag for the wrong reason fails.
    """
    assert message.startswith("Refusal(%s %s: " % (tag, reason)), message
    assert message.endswith(")"), message


def _oversize_rows(length: str) -> list[list[str]]:
    """A three-row baseline window over the deprecation page, pinned at the oversize capture.

    Three rows because `MIN_CHANGE_POINTS` is 3 and `create_bond` refuses a page the archive rarely
    captures. Only row 0 is ever fetched: `_cdx_anchored_block` hands back row 0's digest and length
    and the newest row's timestamp as the cursor, so the two later rows need to exist and nothing
    more. They are given digests that could not collide with a real one for that reason.

    Row 0's digest IS computed from the oversize bytes, so the index and the payload agree the way
    the archive's do. `length` is the one fabricated column and every caller passes it explicitly.
    """
    pinned = archive.cdx_digest(archive.raw(archive.OVERSIZE_ROUTE))
    rows = [
        [OVERSIZE_STAMP, pinned, length, "200"],
        ["20260401000000", "NEWERROWNEVERFETCHEDBYTHISTEST01", "1000", "200"],
        ["20260501000000", "NEWERROWNEVERFETCHEDBYTHISTEST02", "1000", "200"],
    ]
    assert len(rows) >= MIN_CHANGE_POINTS
    return rows


def _draft_over(url: str, stamp: str, **overrides) -> dict:
    """A `create_bond` draft aimed at a page other than the default bond's."""
    fields = {
        "bond_id": "retrieval-probe",
        "url": url,
        "baseline_timestamp": stamp,
        "anchor_words": SECTIONS,
        "anchor_terminal": TERMINAL,
    }
    fields.update(overrides)
    return bonds.draft(**fields)


# --------------------------------------------------------------------------------------------------
# 200 with a three byte body
# --------------------------------------------------------------------------------------------------


def test_a_page_the_archive_never_captured_is_refused_and_never_read_as_unchanged(
        contract, direct_vm, value_ledger, archive_server):
    """The inversion this whole retrieval layer exists to prevent.

    Wayback answers a URL it has never archived with HTTP 200 and the three bytes `[]`. A contract
    that reads a 200 and an empty row list as "no change points, therefore the document has not
    changed" would create this bond happily, and then every check for a year would find nothing
    changed and the bond would expire clean, paying nothing, having verified nothing, over a page
    that does not exist in the archive at all.

    So the refusal has to be `[EXTERNAL]`, and it has to name absence of DATA. Asserting on that
    phrasing is not style policing: `[EXPECTED]` would tell the frontend this is a verdict the
    caller should accept, and a verdict is precisely what an empty index is not.
    """
    archive_server.serve("cdx-never-archived")
    set_block_time(direct_vm, AT)
    value_ledger.fund(bonds.DEFAULT_STAKE)

    message = returned_refusal(
        contract.create_bond(**_draft_over(NEVER_ARCHIVED_URL, bonds.BASELINE_STAMP)))
    assert_refusal(message, ERROR_EXTERNAL, "cdx-empty")
    assert "absence of data, never absence of change" in message
    # The body length travels out with the refusal, which is what makes an empty index legible in a
    # transaction receipt rather than indistinguishable from a transport failure.
    assert "3 byte body" in message


def test_the_stake_behind_a_refusal_that_needed_the_network_comes_back_too(
        contract, direct_vm, value_ledger, archive_server):
    """The case that made the refusal boundary necessary, and the test that used to assert the bug.

    This refusal cannot be known without asking the archive. Nothing offline can catch it, so the
    frontend's zero-value simulation is the only thing that could have caught it before a stake was
    sent, and a simulation is not a guarantee: the archive can answer differently between the
    simulation and the signed call, and a promisor can skip the form and call the contract directly.

    An earlier version of this test asserted, correctly, that the stake did NOT come back. That was
    measured rather than inferred: transaction 0xc3a12dd2 sent 250,000,000,000,000,000 wei into
    `create_bond`, reached a refusal one network call in, resolved as a rollback, and the value stayed
    with the contract. A GenVM revert undoes the storage writes and does not undo the transfer that
    funded the call, so the method kept a stake it had just declined to escrow.

    `create_bond` is now a refusal boundary. It catches the refusal, emits the refund, and returns the
    sentence, so the assertions below are the same three lines with their arithmetic inverted, plus the
    one that says the money went back to the account that sent it rather than merely leaving.
    """
    archive_server.serve("cdx-never-archived")
    set_block_time(direct_vm, AT)
    value_ledger.fund(bonds.DEFAULT_STAKE)

    message = returned_refusal(
        contract.create_bond(**_draft_over(NEVER_ARCHIVED_URL, bonds.BASELINE_STAMP)))
    assert "cdx-empty" in message, message

    assert value_ledger.paid_to(direct_vm.sender) == bonds.DEFAULT_STAKE
    assert value_ledger.paid_out == bonds.DEFAULT_STAKE
    assert value_ledger.retained == 0, (
        "%d wei stayed with the contract, which is the failure transaction 0xc3a12dd2 measured on "
        "chain and this boundary exists to remove" % value_ledger.retained)
    # Exactly one transfer. A refund emitted per refusal check rather than once at the boundary would
    # send the stake more times than it was sent in.
    assert len(value_ledger.transfers) == 1, value_ledger.transfers

    # And nothing was written, so the returned stake bought no bond either.
    with pytest.raises(Exception) as caught:
        contract.get_bond("retrieval-probe")
    assert "no bond" in user_error_message(caught.value)


# --------------------------------------------------------------------------------------------------
# 302 with a location header
# --------------------------------------------------------------------------------------------------


def test_a_timestamp_one_second_off_a_real_capture_is_refused_and_the_redirect_is_not_followed(
        contract, direct_vm, value_ledger, archive_server):
    """A 302 to the neighbouring capture, which is a different document.

    This is the measured split `require_exact_timestamp` was written around, and it is subtler than
    it looks. A timestamp that is not 14 digits is caller error and is refused before any fetch. A
    timestamp that IS 14 digits but is one second off a real capture is syntactically perfect, so it
    gets fetched, and the archive answers 302 pointing at the capture it does have.

    Following that redirect would be the worst available behaviour: the contract would receive a real
    archived document, decode it, gate it, and judge a commitment against it, while the digest it
    verified against belongs to a capture one second away. `fetch_bytes` refuses 3xx outright and
    puts the unfollowed `location` in the refusal so the caller can see what it declined.

    The `location` is only visible because this route carries headers and `Archive._register` uses
    the full mock shape for it. The flat shape reports `headers: {}` for everything, so a test built
    on it would pass on a refusal that had lost the one detail worth reporting.
    """
    archive_server.serve_cdx(OVERSIZE_URL, REDIRECT_STAMP, [
        [REDIRECT_STAMP, "REDIRECTROWDIGESTNEVERVERIFIED01", "5000", "200"],
        ["20230401000000", "NEWERROWNEVERFETCHEDBYTHISTEST01", "5000", "200"],
        ["20230501000000", "NEWERROWNEVERFETCHEDBYTHISTEST02", "5000", "200"],
    ])
    archive_server.add(REDIRECT_ROUTE)
    set_block_time(direct_vm, AT)
    value_ledger.fund(bonds.DEFAULT_STAKE)

    message = returned_refusal(
        contract.create_bond(**_draft_over(OVERSIZE_URL, REDIRECT_STAMP)))
    assert_refusal(message, ERROR_EXTERNAL, "redirect")
    assert "http 302, not followed" in message
    # The capture the archive offered instead, named but declined.
    assert "20230320142124" in message
    assert archive.expectation(REDIRECT_ROUTE)["followed"] is False


def test_the_declined_redirect_leaves_the_digest_unverified_rather_than_verified_against_a_neighbour(
        contract, direct_vm, value_ledger, archive_server):
    """The refusal arrives before `verify_digest`, and the order is what makes it safe.

    Worth pinning separately from the refusal itself. `retrieve_snapshot` fetches, and only a
    `FetchResult` reaches `admit_snapshot`; a `Refusal` short-circuits. So a 302 never gets as far as
    a digest comparison, and the row's digest here is a string of letters that could not be the
    base32 sha1 of anything. If the redirect were ever followed, the fetched neighbour's real digest
    would not match this row and the failure would arrive as `[TRANSIENT] digest-mismatch`, which
    would be a retry instruction for a document that will never match.

    The assertion is therefore on what is ABSENT from the message.
    """
    archive_server.serve_cdx(OVERSIZE_URL, REDIRECT_STAMP, [
        [REDIRECT_STAMP, "REDIRECTROWDIGESTNEVERVERIFIED01", "5000", "200"],
        ["20230401000000", "NEWERROWNEVERFETCHEDBYTHISTEST01", "5000", "200"],
        ["20230501000000", "NEWERROWNEVERFETCHEDBYTHISTEST02", "5000", "200"],
    ])
    archive_server.add(REDIRECT_ROUTE)
    set_block_time(direct_vm, AT)
    value_ledger.fund(bonds.DEFAULT_STAKE)

    message = returned_refusal(
        contract.create_bond(**_draft_over(OVERSIZE_URL, REDIRECT_STAMP)))
    assert "digest-mismatch" not in message
    assert ERROR_TRANSIENT not in message
    assert "REDIRECTROWDIGESTNEVERVERIFIED01" not in message


# --------------------------------------------------------------------------------------------------
# The three size caps, over the one capture that exercises all of them
# --------------------------------------------------------------------------------------------------


def test_a_row_whose_declared_length_is_over_the_cap_is_refused_before_anything_is_fetched(
        contract, direct_vm, value_ledger, archive_server):
    """Cap 1, with the oversize capture's real CDX length, and no payload registered at all.

    The empty payload slot is the assertion. `_admit_block` runs `check_warc_length` before it calls
    `retrieve_snapshot`, so nothing is fetched and nothing needs to be mocked. If that order ever
    inverted, this test would not fail on a weaker assertion, it would fail with an unmocked-URL
    error naming the URL the contract tried to fetch. That is a much better failure than a passing
    test over a 2 MB download.

    The length here is not fabricated: 260,662 is what the archive's own index reports for this
    capture, read off the fixture rather than typed.
    """
    declared = int(archive.expectation(archive.OVERSIZE_ROUTE)["cdx_length"])
    assert declared > CDX_WARC_LENGTH_MAX

    archive_server.serve_cdx(OVERSIZE_URL, OVERSIZE_STAMP, _oversize_rows(str(declared)))
    set_block_time(direct_vm, AT)
    value_ledger.fund(bonds.DEFAULT_STAKE)

    message = returned_refusal(
        contract.create_bond(**_draft_over(OVERSIZE_URL, OVERSIZE_STAMP)))
    assert_refusal(message, ERROR_EXTERNAL, "cdx-length-cap")
    assert "%d > %d" % (declared, CDX_WARC_LENGTH_MAX) in message


def test_the_length_cap_catches_this_capture_by_four_percent_while_the_payload_is_seven_times_larger(
        contract, direct_vm, value_ledger, archive_server):
    """The honest framing of the pair above, and the reason two more caps exist below it.

    Cap 1 refuses this capture, so on this one row it looks like a sufficient size gate. It is not,
    and the margin is the evidence. The declared length exceeds the cap by four percent, which is
    the kind of margin a different capture would sit under, and the payload behind that length is
    seven and a half times larger than the length implies. A pre-flight built on the length alone
    would therefore admit a capture eight times bigger than it expected the moment one landed a few
    kilobytes lower.

    `CDX_WORST_OBSERVED_EXPANSION` is calibrated from exactly this pair, and it is the FLOOR of the
    real ratio rather than the ratio, so even the constant understates the discrepancy slightly. That
    is stated here because a constant that rounds toward the safe-looking direction is worth being
    explicit about.

    No contract call. This is arithmetic over the fixture's own measurements, and it is a test rather
    than a comment because a re-capture that changed either number would have to move the constant.
    """
    expect = archive.expectation(archive.OVERSIZE_ROUTE)
    declared = int(expect["cdx_length"])
    actual = int(expect["raw_bytes"])

    over_the_cap_by = (declared - CDX_WARC_LENGTH_MAX) / CDX_WARC_LENGTH_MAX
    assert 0.04 < over_the_cap_by < 0.05, over_the_cap_by

    ratio = actual / declared
    assert round(ratio, 2) == CDX_WORST_OBSERVED_EXPANSION
    # The floor, not the ratio: multiplying the declared length by the published constant still
    # falls short of the real payload.
    assert declared * CDX_WORST_OBSERVED_EXPANSION < actual

    # And the payload itself is nowhere near cap 2, so cap 1 is not standing in for cap 2 here.
    assert actual < RAW_MAX_BYTES


def test_with_the_length_gate_lifted_the_two_megabyte_payload_passes_both_size_caps(
        contract, direct_vm, value_ledger, archive_server):
    """Caps 2 and 3, reached by fabricating one column, which is named in the file docstring.

    The length column is set to the cap exactly, which passes because both checks are strict `>`.
    That lifts cap 1 off this capture and lets the real 2,044,592 bytes be fetched, digest-verified,
    and put through the decode. This is the only way to exercise caps 2 and 3 in this fixture set:
    the one capture large enough to matter is also the one whose declared length is over cap 1.

    What the caps then say is that the payload is fine. It is served identity rather than gzip, so
    raw equals decoded, both sit under their caps, and the capture is admitted. It is then refused on
    its CONTENT, by gates C and D, and the refusal carries the section count so the margin is
    visible. That is the point of the three caps being separate from the three gates: a document can
    be a perfectly reasonable size and still not be the document the bond names.
    """
    archive_server.serve_cdx(OVERSIZE_URL, OVERSIZE_STAMP,
                            _oversize_rows(str(CDX_WARC_LENGTH_MAX)))
    archive_server.add(archive.OVERSIZE_ROUTE)
    set_block_time(direct_vm, AT)
    direct_vm.mock_llm(bonds.JUDGE_HOOK, archive.holds())
    value_ledger.fund(bonds.DEFAULT_STAKE)

    message = returned_refusal(
        contract.create_bond(**_draft_over(OVERSIZE_URL, OVERSIZE_STAMP)))
    assert message.startswith(ERROR_EXTERNAL), message

    # Not a size refusal. Both later caps passed, and saying so by absence is the assertion.
    assert "raw-cap" not in message
    assert "decoded-cap" not in message
    assert "cdx-length-cap" not in message

    # Refused on content, by the two gates that do the work in this fixture set.
    assert "did not qualify" in message
    assert "gate(s) C,D did not pass" in message
    assert "0 of 3 sections found" in message


def test_the_caps_are_ordered_cheapest_first_and_the_oversize_capture_shows_why(
        contract, direct_vm, value_ledger, archive_server):
    """Each cap can only be reached by paying for the step before it, which is the design.

    Cap 1 costs nothing: it reads a column out of an index the contract already has. Cap 2 costs a
    fetch. Cap 3 costs an inflation, which is the only unbounded step in the pipeline and the reason
    `decode_checked` enforces cap 3 DURING inflation rather than after it. This capture is the
    argument for that ordering in one artefact: its index row is 260,662, its payload is 2,044,592,
    and had it been gzip at the ratio the other six captures average it would have inflated past
    cap 3 as well.

    Asserted as an ordering over the three constants and the fixture's own numbers, with no contract
    call, because the ordering is a property of the constants and not of any one run.
    """
    expect = archive.expectation(archive.OVERSIZE_ROUTE)
    declared = int(expect["cdx_length"])
    raw_bytes = int(expect["raw_bytes"])
    decoded_bytes = int(expect["decoded_bytes"])

    assert CDX_WARC_LENGTH_MAX < RAW_MAX_BYTES < DECODED_MAX_BYTES

    # Served identity, so this capture never enters the decode branch and its two byte counts are
    # the same number. That is what makes it the control for the cap ordering: the only thing
    # separating cap 2 from cap 3 on this row is the constants, not the content.
    assert expect["magic"] == "3c21"
    assert raw_bytes == decoded_bytes

    # Cap 1 refuses it, cap 2 and cap 3 would not have.
    assert declared > CDX_WARC_LENGTH_MAX
    assert raw_bytes < RAW_MAX_BYTES
    assert decoded_bytes < DECODED_MAX_BYTES

    # The counterfactual that justifies cap 3 existing at all, computed from the six gzip captures
    # rather than asserted from memory. The compressed side is read off the files rather than out of
    # the manifest: only four of the eight captures record a `raw_bytes` measurement, and the bytes on
    # disk are the honest source for a size in any case.
    gzipped = [route for route in archive.MANIFEST["routes"]
               if str(route.get("body", "")).endswith(".bin")
               and route.get("expect", {}).get("magic") == "1f8b"]
    assert len(gzipped) == 6
    ratios = [int(r["expect"]["decoded_bytes"]) / len(archive.raw(r["name"])) for r in gzipped]
    typical = sum(ratios) / len(ratios)
    assert raw_bytes * typical > DECODED_MAX_BYTES


# --------------------------------------------------------------------------------------------------
# The rows an index can hand back that are not usable
# --------------------------------------------------------------------------------------------------


def test_a_revisit_row_with_no_integer_length_is_skipped_rather_than_guessed_at(
        contract, direct_vm, value_ledger, archive_server, bonded):
    """CDX reports `-` for the length on revisit records, and cap 1 refuses that as unknown.

    Not a parse failure and not fatal to the response: `_as_int` lets the row through with
    `warc_length=None`, the block passes `-1` out through `strict_eq`, `_admit_block` turns that back
    into `None`, and cap 1 refuses it. Three representations of the same absence, which is what it
    takes to carry `None` across a boundary that only passes ints.

    The conservative reading is the one taken. A row whose size is unknown could be fetched anyway
    and checked against cap 2 afterwards, and that would work most of the time; it would also mean
    the contract downloads an unbounded body to find out how big it is. Refusing costs one skipped
    change point on a page's revisit records.

    No payload is registered, so this proves the same thing the cap-1 test does from the other
    direction: the refusal arrives before the fetch.
    """
    cursor = str(contract.get_bond(bonded)["cursor_timestamp"])
    archive_server.serve_cdx(bonds.BOND_URL, cursor, [
        [cursor, "CURSORROWDIGESTNOTFETCHED0000000", "1000", "200"],
        ["20260801000000", "REVISITROWWITHNOLENGTHATALL00001", "-", "200"],
    ])
    set_block_time(direct_vm, "2026-08-26T09:00:00Z")

    with pytest.raises(Exception) as caught:
        contract.check_commitment(bonded)

    message = user_error_message(caught.value)
    assert_refusal(message, ERROR_EXTERNAL, "cdx-length-unknown")
    assert "the pre-filter cannot pass it" in message


def test_a_malformed_index_row_is_refused_before_a_fetch_and_is_tagged_as_caller_error(
        contract, direct_vm, value_ledger, archive_server, bonded):
    """A timestamp that is not 14 digits, arriving from the index rather than from a caller.

    `require_exact_timestamp` runs first inside `retrieve_snapshot`, before the length check and
    before the fetch, so a malformed row costs nothing and the contract never builds a replay URL
    out of it. That much is right, and the empty payload slot proves it.

    THE TAG IS THE WRINKLE, AND IT IS RECORDED HERE RATHER THAN CORRECTED. This refusal is
    `[EXPECTED]`, because the function was written for the timestamp a caller supplies and the same
    function sees the row. `[EXPECTED]` is the only tag in this contract that means a verdict about
    the caller, so on this one path a defect in a third party's index is reported as the caller's
    fault. Nothing the caller could change would fix it.

    It is left alone for a reason worth stating: the path is reachable only if Wayback returns a row
    whose timestamp is not 14 digits, which has never been observed in any of the six captured
    indexes, and the alternative is a second timestamp validator differing from the first only in its
    tag. The test asserts the behaviour that exists and names the discrepancy, which is the honest
    version of leaving it.
    """
    cursor = str(contract.get_bond(bonded)["cursor_timestamp"])
    archive_server.serve_cdx(bonds.BOND_URL, cursor, [
        [cursor, "CURSORROWDIGESTNOTFETCHED0000000", "1000", "200"],
        ["202608010000000", "MALFORMEDROWFIFTEENDIGITSTAMP001", "5000", "200"],
    ])
    set_block_time(direct_vm, "2026-08-26T09:00:00Z")

    with pytest.raises(Exception) as caught:
        contract.check_commitment(bonded)

    message = user_error_message(caught.value)
    assert_refusal(message, ERROR_EXPECTED, "timestamp-not-14-digit")
    assert "len=15" in message
    # And it never got as far as a size decision, let alone a fetch.
    assert "cdx-length" not in message


def test_a_window_carrying_only_the_cursor_reports_that_it_examined_nothing(
        contract, direct_vm, value_ledger, archive_server, bonded):
    """`from=` is inclusive, so a page with no new captures answers with exactly one row.

    That response is not an error and not a verdict. The contract has to distinguish it from both:
    it is a successful call that examined no document, so it says so and writes nothing, leaving
    `last_checked_at` untouched so the next caller is not made to wait out a check interval for a
    check that never happened.

    Tagged `[EXTERNAL]` rather than `[EXPECTED]`, and that distinction is the substance of the test.
    `[EXPECTED]` would tell the frontend the caller did something wrong. The caller did nothing
    wrong; the archive simply has nothing new, which is a fact about a third party and is worth
    retrying tomorrow.
    """
    before = contract.get_bond(bonded)
    cursor = str(before["cursor_timestamp"])
    archive_server.serve_cdx(bonds.BOND_URL, cursor, [
        [cursor, "CURSORROWDIGESTNOTFETCHED0000000", "1000", "200"],
    ])
    set_block_time(direct_vm, "2026-08-26T09:00:00Z")

    with pytest.raises(Exception) as caught:
        contract.check_commitment(bonded)

    message = user_error_message(caught.value)
    assert message.startswith(ERROR_EXTERNAL), message
    assert "none is newer than the cursor" in message
    assert "reports nothing about the commitment" in message

    after = contract.get_bond(bonded)
    assert str(after["last_checked_at"]) == str(before["last_checked_at"])
    assert str(after["cursor_timestamp"]) == cursor
    assert int(after["checks_passed"]) == int(before["checks_passed"])
    assert int(after["points_recorded"]) == int(before["points_recorded"])


# --------------------------------------------------------------------------------------------------
# What the digest is computed over, reproduced outside the contract
# --------------------------------------------------------------------------------------------------


def test_the_recorded_hash_is_of_the_inflated_bytes_and_the_cdx_digest_is_of_the_compressed_ones(
        contract, direct_vm, value_ledger, archive_server, bonded):
    """Two hashes over one capture, one recomputed here with the standard library.

    This is the one assertion in the direct suite that the contract's own fields cannot satisfy by
    agreeing with each other. Everything else a bond stores is produced by the same pipeline, so a
    pipeline that decoded wrongly but consistently would store a self-consistent set of wrong values
    and pass. `decoded_sha256` recomputed out here, with `gzip` and `hashlib` from the standard
    library over the bytes on disk, is an independent implementation of the claim.

    The pair is also the project's thesis in two lines. `cdx_digest` is base32 of sha1 over the
    COMPRESSED bytes, because that is what the archive stored and what every validator receives.
    `decoded_sha256` is sha256 over what those bytes inflate to. A contract that skipped the
    inflation would still agree with every other validator on the first hash, unanimously, about
    89,652 bytes of binary noise.
    """
    import gzip

    raw_bytes = archive.raw(bonds.SNAPSHOT_ROUTE)
    expect = archive.expectation(bonds.SNAPSHOT_ROUTE)

    assert raw_bytes[:2].hex() == "1f8b"
    inflated = gzip.decompress(raw_bytes)
    assert len(inflated) == int(expect["decoded_bytes"])

    bond = contract.get_bond(bonded)
    assert str(bond["baseline_digest"]) == archive.cdx_digest(raw_bytes)
    assert str(bond["baseline_encoding"]) == "gzip"

    point = contract.bond_history(bonded)[0]
    assert str(point["decoded_sha256"]) == hashlib.sha256(inflated).hexdigest()
    # The compressed side, tied back to the file rather than to the manifest: `raw_len` is what the
    # contract counted over the wire, and it has to be the size of the bytes on disk. Only four of the
    # eight captures record a `raw_bytes` measurement in the manifest, and this is the better check in
    # any case, because it compares the contract's count against the artefact instead of against a
    # number written down beside it.
    assert int(point["raw_len"]) == len(raw_bytes)

    # And the two hashes are over different byte strings, which is the whole point.
    assert hashlib.sha256(raw_bytes).hexdigest() != hashlib.sha256(inflated).hexdigest()


def test_a_payload_whose_bytes_drifted_from_the_index_is_transient_and_never_a_verdict(
        contract, direct_vm, value_ledger, archive_server, bonded):
    """The digest is verified before the decode, so drifted bytes never reach the gates.

    Served by putting one capture's bytes behind another capture's index row, which is what a drifted
    replay looks like from inside the contract: the row promises one digest and the fetch returns
    something else. The refusal is `[TRANSIENT]`, meaning retry, which is the correct reading of a
    replay that disagrees with its own index.

    `[TRANSIENT]` rather than `[EXTERNAL]` matters here. `[EXTERNAL]` would say the archive gave a
    definite unusable answer; a digest mismatch on a replay is more often the archive being
    momentarily inconsistent than permanently wrong, and the contract's cursor does not move, so
    tomorrow's check re-examines the same row.
    """
    cursor = str(contract.get_bond(bonded)["cursor_timestamp"])
    stamp = "20260801000000"
    promised = archive.cdx_digest(archive.raw("snap-github-tos-gzip"))

    archive_server.serve_cdx(bonds.BOND_URL, cursor, [
        [cursor, "CURSORROWDIGESTNOTFETCHED0000000", "1000", "200"],
        [stamp, promised, str(len(archive.raw("snap-aws-terms-gzip"))), "200"],
    ])
    # The row promises the GitHub capture's digest; the replay serves the AWS capture's bytes.
    archive_server.add_snapshots(bonds.BOND_URL, [(stamp, "snap-aws-terms-gzip")])
    set_block_time(direct_vm, "2026-08-26T09:00:00Z")

    with pytest.raises(Exception) as caught:
        contract.check_commitment(bonded)

    message = user_error_message(caught.value)
    assert_refusal(message, ERROR_TRANSIENT, "digest-mismatch")
    assert promised in message
    # Verified over the bytes AS STORED, before any inflation, so the count in the message is the
    # compressed size and not the inflated one. The wording is "stored" rather than "raw" for a reason
    # this project measured the hard way: on a live GenVM the bytes a contract receives are already
    # inflated, because the host decompresses transparently and Wayback declares gzip regardless of
    # `Accept-Encoding`. "raw" would name the bytes the archive holds, which is not what was hashed.
    assert "over %d stored bytes" % len(archive.raw("snap-aws-terms-gzip")) in message
    assert "did not qualify" not in message


# --------------------------------------------------------------------------------------------------
# The two shapes a refusal message comes in
# --------------------------------------------------------------------------------------------------


def test_the_contract_refuses_in_two_message_shapes_and_the_tag_is_not_always_at_the_front(
        contract, direct_vm, value_ledger, archive_server, bonded):
    """Both shapes out of one method, so the difference is a measurement and not a claim.

    THIS IS WHY THE FILE EXISTS IN ITS CURRENT FORM. Twelve tests here were written asserting
    `message.startswith("[EXTERNAL]")` and six of them failed, not because the contract was wrong but
    because a refusal that crosses `strict_eq` is not shaped like a refusal raised beside the caller.
    `Refusal.message` is a property returning `repr(self)`, and `_raise_if_error` re-raises that
    string verbatim, so the tag ends up eight characters in with a parenthesis on the end.

    Both shapes are correct and neither should change. What has to be true is that anything reading
    these messages FINDS the tag rather than reading it off the front, and that is a property of the
    readers, so it is asserted here where both shapes are visible at once rather than left to be
    rediscovered by whichever reader gets it wrong. `dry-run.ts` classifies with `includes`, which is
    right on both. The check runner's classifier did not look at the tags at all when this test was
    written, which is how a `[TRANSIENT]` digest mismatch came to be shown as a refusal the caller
    should accept.

    Driven through `check_commitment`, which is not payable and therefore still raises. The payable
    methods return the identical strings, so nothing here is specific to the delivery: the shape is
    decided by where the refusal was constructed, and both shapes reach a caller both ways.

    Same method, same bond, same tag vocabulary, two positions.
    """
    cursor = str(contract.get_bond(bonded)["cursor_timestamp"])
    set_block_time(direct_vm, "2026-08-26T09:00:00Z")

    # Shape one: the contract's own sentence about a third party's answer, tag at position zero.
    archive_server.serve_cdx(bonds.BOND_URL, cursor, [
        [cursor, "CURSORROWDIGESTNOTFETCHED0000000", "1000", "200"],
    ])
    with pytest.raises(Exception) as caught:
        contract.check_commitment(bonded)
    sentence = user_error_message(caught.value)

    # Shape two: a refusal from the embedded region, carried out through `strict_eq` as its own repr.
    archive_server.serve_cdx(bonds.BOND_URL, cursor, [
        [cursor, "CURSORROWDIGESTNOTFETCHED0000000", "1000", "200"],
        ["202608010000000", "MALFORMEDROWFIFTEENDIGITSTAMP001", "5000", "200"],
    ])
    with pytest.raises(Exception) as caught:
        contract.check_commitment(bonded)
    refusal = user_error_message(caught.value)

    assert sentence.index(ERROR_EXTERNAL) == 0, sentence
    assert refusal.index(ERROR_EXPECTED) == len("Refusal("), refusal

    # The consequence, stated as the assertion a naive reader would fail. Not a hypothetical: this is
    # the exact expression six tests in this file were written with.
    assert not refusal.startswith(ERROR_EXPECTED)

    # And the property every reader must actually rely on, which holds for both.
    for message, tag in ((sentence, ERROR_EXTERNAL), (refusal, ERROR_EXPECTED)):
        assert tag in message
        # Exactly one tag per message, so finding one is unambiguous rather than first-wins.
        found = [t for t in (ERROR_EXPECTED, ERROR_EXTERNAL, ERROR_TRANSIENT) if t in message]
        assert found == [tag], found


def test_the_reason_extracted_from_a_refusal_repr_is_not_left_holding_a_stray_parenthesis(
        contract, direct_vm, value_ledger, archive_server, bonded):
    """What `dry-run.ts` puts on screen after the tag, checked against the shape it will really get.

    The frontend shows a caller the text following the tag. On a tagged sentence that is a sentence.
    On a `Refusal` repr the text after the tag is `reason: detail)`, closing parenthesis included,
    because the tag sits inside a repr whose last character belongs to the wrapper rather than to the
    message. Trailing punctuation from a data structure's repr is a small thing to put in front of a
    reader, and it is the kind of small thing that is only ever found by looking at the real string.

    Asserted here, at the source, so the TypeScript fix has a measurement behind it rather than a
    guess about what the contract emits.
    """
    cursor = str(contract.get_bond(bonded)["cursor_timestamp"])
    archive_server.serve_cdx(bonds.BOND_URL, cursor, [
        [cursor, "CURSORROWDIGESTNOTFETCHED0000000", "1000", "200"],
        ["20260801000000", "REVISITROWWITHNOLENGTHATALL00001", "-", "200"],
    ])
    set_block_time(direct_vm, "2026-08-26T09:00:00Z")

    with pytest.raises(Exception) as caught:
        contract.check_commitment(bonded)

    message = user_error_message(caught.value)
    after_tag = message[message.index(ERROR_EXTERNAL) + len(ERROR_EXTERNAL):].strip()

    assert after_tag.startswith("cdx-length-unknown: ")
    assert after_tag.endswith("cannot pass it)"), after_tag
    # The unbalanced parenthesis, which is the part a reader would see and the part worth stripping.
    assert after_tag.count(")") == after_tag.count("(") + 1


# --------------------------------------------------------------------------------------------------
# The measurement that must not be overstated
# --------------------------------------------------------------------------------------------------


def test_gate_b_passes_on_every_captured_payload_and_therefore_discriminates_nothing_here(
        contract, direct_vm, value_ledger, archive_server, bonded):
    """The honest limit of this fixture set, pinned so it cannot quietly be claimed otherwise.

    Three gates decide admissibility and it would be easy to write "three gates catch bad captures".
    In this fixture set that is false. Gate B is a substring test for the anchor derived from the
    URL's last path segment, and every capture here is of a terms page or a deprecation page, so the
    anchor is a word the document contains even when the document is a chrome-only shell of 569
    visible characters. Gate B passes on all eight. Gates C and D do all of the rejecting.

    That is not a defect in gate B, and the test is not an argument for removing it: a capture of a
    genuinely different page would fail it, and this fixture set contains no such capture because
    every payload was collected from the page it claims to be from. It is a statement about what has
    been MEASURED, which is that gate B has zero true positives here.

    Pinned by driving the shell through the contract and reading which gates the refusal names. If a
    future change made gate B fire on the shell, this test fails and the claim above has to be
    rewritten rather than silently becoming stale.
    """
    cursor = str(contract.get_bond(bonded)["cursor_timestamp"])
    stamp = "20260801000000"
    shell = "snap-github-tos-chrome-only"
    shell_bytes = archive.raw(shell)

    archive_server.serve_cdx(bonds.BOND_URL, cursor, [
        [cursor, "CURSORROWDIGESTNOTFETCHED0000000", "1000", "200"],
        [stamp, archive.cdx_digest(shell_bytes), str(len(shell_bytes)), "200"],
    ])
    archive_server.add_snapshots(bonds.BOND_URL, [(stamp, shell)])
    set_block_time(direct_vm, "2026-08-26T09:00:00Z")
    direct_vm.mock_llm(bonds.JUDGE_HOOK, archive.holds())

    contract.check_commitment(bonded)

    blank = contract.bond_history(bonded)[1]
    assert blank["qualified"] is False
    failed = str(blank["failed_gates"])
    assert failed == "C,D", failed
    assert "B" not in failed
    assert blank["gate_c_hits"] == "0"


def test_the_shell_that_fails_two_gates_is_recorded_as_a_blank_frame_and_not_as_a_loss(
        contract, direct_vm, value_ledger, archive_server, bonded):
    """A capture the contract cannot read is an unknown, and an unknown is not evidence.

    The counterpart to the gate measurement above, and the reason it is worth having. A defective
    capture that failed two gates could reasonably be treated three ways: as a breach, as a hold, or
    as an unknown. The first turns a broken archive capture into a forfeited stake, which is the
    failure this project measured across four companies. The second lets a promisor hide a real
    change behind a bad capture.

    So it is an unknown: recorded, run-breaking, and carrying no classification at all. The empty
    classification is the assertion.
    """
    cursor = str(contract.get_bond(bonded)["cursor_timestamp"])
    stamp = "20260801000000"
    shell = "snap-github-tos-chrome-only"
    shell_bytes = archive.raw(shell)

    archive_server.serve_cdx(bonds.BOND_URL, cursor, [
        [cursor, "CURSORROWDIGESTNOTFETCHED0000000", "1000", "200"],
        [stamp, archive.cdx_digest(shell_bytes), str(len(shell_bytes)), "200"],
    ])
    archive_server.add_snapshots(bonds.BOND_URL, [(stamp, shell)])
    set_block_time(direct_vm, "2026-08-26T09:00:00Z")
    direct_vm.mock_llm(bonds.JUDGE_HOOK, archive.holds())

    contract.check_commitment(bonded)

    bond = contract.get_bond(bonded)
    assert str(bond["state"]) == ST_ACTIVE
    assert int(bond["run_length"]) == 0

    blank = contract.bond_history(bonded)[1]
    assert str(blank["classification"]) == ""
    assert str(blank["excerpt"]) == ""
    assert str(blank["rationale"]) == ""

    # Counted as examined and as gate-rejected, and counted into no classification bucket at all.
    # That is what "recorded but not evidence" means in the numbers a reader is shown: the reading
    # happened, it is visible, and it moved neither side of the commitment.
    status = contract.commitment_status(bonded)
    assert status["examined"] == "2"
    assert status["qualified"] == "1"
    assert status["gate_rejected"] == "1"
    assert status["holds"] == "1"
    assert status["weakened"] == "0"
    assert status["absent"] == "0"
    assert status["indeterminate"] == "0"

    # The baseline is still the newest capture the contract managed to read. This field is on
    # `commitment_status` rather than on `get_bond`, because it is derived by walking the points
    # rather than stored on the bond.
    assert str(status["last_qualified_timestamp"]) == bonds.BASELINE_STAMP
    # And the cursor DID advance, so the unreadable capture is not re-fetched forever.
    assert str(bond["cursor_timestamp"]) == stamp
