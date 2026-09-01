"""The six views, under the real SDK, and the mirror the frontend keeps of the contract's limits.

WHAT THIS FILE IS ACTUALLY CHECKING. The frontend reads this contract through six views and makes
three assumptions about them that no amount of TypeScript can verify: that a missing bond reverts
with a message it can recognise rather than returning an empty object, that `get_limits()` publishes
the numbers its own client-side form is built out of, and that every numeric field arrives as a
decimal string because `u256` does not survive JSON. All three are properties of the deployed
contract, so all three are tested here against the deployed contract.

THE LIMITS TEST IS THE ONE THAT EARNS ITS KEEP. `contract-types.ts` carries `CLIENT_LIMITS`, a
hand-written mirror of these constants, so that the create form can refuse a bad draft with no
network round trip. A mirror is a liability the moment the two sides disagree: the form would accept
a draft the contract rejects, and because `create_bond` refuses by reverting, the stake would
already be attached. `limitsDrift` reports a disagreement at runtime, which covers a deployed
contract whose constants moved. It does not cover a mirror that was wrong when it was typed. That is
what the test below covers, by parsing the numbers out of both files and pairing them.
"""

import re
from pathlib import Path

import pytest

from conftest import numeric_constant, str_constant, user_error_message

TYPES_PATH = Path(__file__).resolve().parents[2] / "src" / "lib" / "contract-types.ts"
TYPES_SOURCE = TYPES_PATH.read_text(encoding="utf-8")

ST_ACTIVE = str_constant("ST_ACTIVE")
FEE_BASIS_POINTS = numeric_constant("FEE_BASIS_POINTS")


def client_limits() -> dict:
    """`CLIENT_LIMITS` from `contract-types.ts`, parsed out of the TypeScript.

    Read rather than restated, and read from the file the browser actually bundles. Restating the
    nineteen numbers here would produce a test that agrees with whatever was typed on the day and
    says nothing about the two files it sits between.
    """
    match = re.search(r"CLIENT_LIMITS\s*=\s*\{(.*?)\n\}\s*as const", TYPES_SOURCE, re.S)
    assert match, "contract-types.ts no longer declares CLIENT_LIMITS as a const object"
    out = {}
    for field, value in re.findall(r"^\s*(\w+):\s*([0-9_]+),", match.group(1), re.M):
        out[field] = int(value.replace("_", ""))
    assert out, "CLIENT_LIMITS parsed empty, so the shape of the declaration changed"
    return out


#: The three fields the client keeps in human units and the contract publishes in machine ones,
#: with the divisor between them. `resolveLimits` performs exactly these three divisions, so a
#: fourth converted field added on one side and not the other shows up as a missing key here.
CONVERTED = {
    "checkIntervalHours": ("check_interval_seconds", 3600),
    "contestWindowDays": ("contest_window_seconds", 86400),
    "contestBondPct": ("contest_bond_basis_points", 100),
}

#: Client-side only. These four bound a draft before it is signed and have no contract constant to
#: disagree with, which is why `limitsDrift` compares fifteen pairs and not nineteen.
CLIENT_ONLY = {"anchorWordMin", "anchorWordMax", "termDaysDefault", "consensusEnvelope"}

#: Everything else, client name to contract name.
DIRECT = {
    "commitmentMin": "min_commitment_chars",
    "commitmentMax": "max_commitment_chars",
    "anchorWordsMin": "min_anchor_words",
    "anchorWordsMax": "max_anchor_words",
    "termDaysMin": "min_term_days",
    "termDaysMax": "max_term_days",
    "breachRunLength": "breach_run_length",
    "minChangePoints": "min_change_points",
    "maxPointsPerCheck": "max_points_per_check",
    "cdxLengthCap": "cdx_warc_length_max",
    "rawCap": "raw_max_bytes",
    "decodedCap": "decoded_max_bytes",
}


# ---------------------------------------------------------------------------
# get_limits, against the frontend's mirror of it
# ---------------------------------------------------------------------------


def test_every_published_limit_is_a_decimal_string_except_the_one_boolean(contract):
    """`u256` does not survive JSON, so every number crosses as text. Except the gate flag."""
    limits = contract.get_limits()
    assert isinstance(limits["gate_a_enabled"], bool)
    for field, value in limits.items():
        if field == "gate_a_enabled":
            continue
        assert isinstance(value, str), f"{field} crossed as {type(value).__name__}"
        assert re.fullmatch(r"[0-9]+", value), f"{field} is {value!r}"


def test_the_client_mirror_agrees_with_the_contract_on_all_fifteen_shared_limits(contract):
    """The test the runtime drift check cannot be: both sides read off disk, paired by name.

    `limitsDrift` compares the mirror against whatever a deployed contract published, so it catches
    a contract that moved. Nothing at runtime catches a mirror that was mistyped, because the
    mistyped value is what both the form and the drift check believe. This does.
    """
    published = contract.get_limits()
    mirror = client_limits()

    for client_field, contract_field in DIRECT.items():
        assert client_field in mirror, f"{client_field} is gone from CLIENT_LIMITS"
        assert int(published[contract_field]) == mirror[client_field], (
            f"{client_field}: the form uses {mirror[client_field]}, "
            f"the contract published {published[contract_field]}"
        )

    for client_field, (contract_field, divisor) in CONVERTED.items():
        raw = int(published[contract_field])
        assert raw % divisor == 0, (
            f"{contract_field} is {raw}, which is not a whole number of "
            f"{'hours' if divisor == 3600 else 'days' if divisor == 86400 else 'percent'}"
        )
        assert raw // divisor == mirror[client_field], (
            f"{client_field}: the form uses {mirror[client_field]}, "
            f"the contract published {raw} ({raw // divisor} after conversion)"
        )


def test_the_mirror_holds_exactly_the_fifteen_shared_fields_plus_four_client_only_ones(contract):
    """Nineteen fields, and every one of them is accounted for as shared or as client-side.

    A twentieth field added to the mirror without a pairing decision is the failure this catches. It
    would be silently unchecked: `limitsDrift` would not compare it, and no test would notice that
    the form is now bounded by a number nothing verifies.
    """
    mirror = set(client_limits())
    accounted = set(DIRECT) | set(CONVERTED) | CLIENT_ONLY
    assert mirror == accounted, (
        f"unpaired in the mirror: {sorted(mirror - accounted)}; "
        f"named here but gone: {sorted(accounted - mirror)}"
    )
    assert len(mirror) == 19


def test_the_client_only_fields_are_not_things_the_contract_publishes(contract):
    """The four have no contract constant, which is why they are exempt rather than missing.

    Stated as a test because the exemption list is the sort of thing that grows to cover a genuine
    omission. `consensusEnvelope` is a measured payload size, `termDaysDefault` is a form default,
    and the two per-word bounds are the client's own reading of what a usable anchor word is.
    """
    published = set(contract.get_limits())
    for field in CLIENT_ONLY:
        snake = re.sub(r"(?<!^)(?=[A-Z])", "_", field).lower()
        assert snake not in published, f"the contract does publish {snake}, so pair it"


def test_the_fee_is_zero_and_the_ledger_says_so_rather_than_omitting_it(contract):
    """A fee field that is absent reads as unknown. Zero has to be published to be checkable."""
    ledger = contract.get_ledger()
    assert ledger["fee_basis_points"] == "0"
    assert FEE_BASIS_POINTS == 0


# ---------------------------------------------------------------------------
# The empty contract
# ---------------------------------------------------------------------------


def test_a_fresh_contract_lists_nothing_and_holds_nothing(contract):
    """Every counter at zero, and an empty list rather than a revert.

    The distinction the home page depends on: no bonds is a read that succeeded and found nothing,
    and it is drawn differently from a read that failed.
    """
    assert contract.list_bonds() == []
    ledger = contract.get_ledger()
    for field in ("total_escrowed", "total_paid_to_payees", "total_returned_to_promisors",
                  "bonds_created", "checks_run", "breaches_claimed", "contests_filed"):
        assert ledger[field] == "0", field


@pytest.mark.parametrize("view", ["get_bond", "bond_history", "commitment_status"])
def test_every_keyed_view_refuses_an_unknown_bond_with_the_prefix_the_frontend_matches(
        contract, view):
    """`live-contract.ts` decides "not found" by looking for `no bond` in the message.

    Three views take a bond id and all three go through `_require_bond`, so the frontend matches one
    substring. If any of them started reverting with different wording, or returning an empty dict,
    a stale link would render as a bond with every field blank instead of as a missing bond.
    """
    with pytest.raises(Exception) as caught:
        getattr(contract, view)("does-not-exist")
    message = user_error_message(caught.value)
    assert "[EXPECTED]" in message, message
    assert "no bond" in message, message
    # The id is quoted back, so the reader can see which id was looked up rather than guessing.
    assert "does-not-exist" in message, message


def test_the_refusal_truncates_a_long_id_rather_than_echoing_it_whole(contract):
    """64 characters of the id, and no more. An unbounded echo is a free amplifier in a revert."""
    with pytest.raises(Exception) as caught:
        contract.get_bond("z" * 400)
    message = user_error_message(caught.value)
    assert "z" * 64 in message
    assert "z" * 65 not in message


def test_a_missing_bond_is_an_expected_refusal_and_not_an_external_one(contract):
    """The tag decides whether the interface offers a retry button.

    `[EXTERNAL]` means the archive was unreachable and the call is worth repeating. A bond id that
    does not exist will not start existing on a retry, so it has to carry `[EXPECTED]`.
    """
    with pytest.raises(Exception) as caught:
        contract.commitment_status("")
    message = user_error_message(caught.value)
    assert message.startswith("[EXPECTED]"), message
    for tag in ("[EXTERNAL]", "[TRANSIENT]", "[LLM_ERROR]"):
        assert tag not in message, message


# ---------------------------------------------------------------------------
# The shapes the frontend destructures
# ---------------------------------------------------------------------------


def test_get_bond_returns_every_field_the_typescript_bond_type_declares(contract, bonded):
    """The `Bond` type in `contract-types.ts`, field for field, against the real view.

    A field the type declares and the view omits arrives as `undefined` and renders as an empty
    cell, which on this interface is a meaningful state: a blank frame means a capture arrived and
    failed a gate. So a missing field would not read as missing, it would read as a finding.
    """
    match = re.search(r"export type Bond = \{(.*?)\n\};", TYPES_SOURCE, re.S)
    assert match, "contract-types.ts no longer declares `export type Bond`"
    declared = set(re.findall(r"^\s*(\w+):", match.group(1), re.M))
    returned = set(contract.get_bond(bonded))
    assert declared == returned, (
        f"declared but not returned: {sorted(declared - returned)}; "
        f"returned but not declared: {sorted(returned - declared)}"
    )


def test_the_two_addresses_come_back_as_checksummed_hex_and_not_as_a_repr(contract, bonded):
    """`as_hex` on both, because `f"{address}"` yields `Address("0x…")` and would cross as that.

    The frontend compares the connected wallet against `promisor` to decide whether to offer the
    contest, and `sameAddress` lowercases both sides precisely because this is EIP-55 mixed case.
    """
    bond = contract.get_bond(bonded)
    for field in ("promisor", "payee"):
        value = bond[field]
        assert re.fullmatch(r"0x[0-9a-fA-F]{40}", value), f"{field} is {value!r}"
        assert "Address(" not in value


def test_a_new_bond_starts_active_with_one_examined_point_and_a_cursor_past_its_baseline(
        contract, bonded):
    """The baseline counts as an examined change point, and the cursor moves past it.

    Both halves are decisions rather than incidentals. Counting the baseline is what makes
    `checks_passed` and `points_recorded` start at 1 rather than 0, so a bond with no later capture
    still shows the frame it was created from. Advancing the cursor is what stops the first check
    from re-examining a capture already known to qualify and hold.
    """
    bond = contract.get_bond(bonded)
    assert bond["state"] == ST_ACTIVE
    assert bond["checks_passed"] == "1"
    assert bond["points_recorded"] == "1"
    assert bond["last_checked_at"] == ""
    assert bond["cursor_timestamp"] >= bond["baseline_timestamp"]
    assert bond["settled"] is False
    assert bond["paid_to_payee"] == "0"
    assert bond["returned_to_promisor"] == "0"


def test_the_history_holds_the_baseline_capture_and_records_how_it_was_decoded(contract, bonded):
    """One point, qualified, classified HOLDS, with the encoding it arrived in written down.

    `encoding` is on the record because the whole project is about it. A capture the contract read
    as `gzip` is one it decompressed; a capture it read as `identity` is one it did not need to. A
    history that recorded only the text would leave a reader unable to tell which happened.
    """
    history = contract.bond_history(bonded)
    assert len(history) == 1
    point = history[0]
    assert point["qualified"] is True
    assert point["classification"] == "HOLDS"
    assert point["failed_gates"] == ""
    assert point["encoding"] in ("gzip", "zlib", "identity")
    assert re.fullmatch(r"[0-9a-f]{64}", point["decoded_sha256"])
    assert int(point["raw_len"]) > 0
    assert int(point["text_len"]) > 0


def test_the_status_view_counts_the_baseline_and_publishes_the_run_length_a_breach_needs(
        contract, bonded):
    """The reader is told how many consecutive weakenings a claim takes, not left to infer it."""
    status = contract.commitment_status(bonded)
    assert status["examined"] == "1"
    assert status["qualified"] == "1"
    assert status["gate_rejected"] == "0"
    assert status["holds"] == "1"
    assert status["weakened"] == "0"
    assert status["run_length"] == "0"
    assert int(status["breach_run_needed"]) >= 2
    assert status["last_qualified_timestamp"] == status["baseline_timestamp"]


def test_the_list_view_carries_only_what_the_index_page_draws(contract, bonded):
    """Eight fields per row. The list is fetched for every bond, so it stays narrow deliberately."""
    rows = contract.list_bonds()
    assert len(rows) == 1
    assert set(rows[0]) == {"bond_id", "url", "state", "stake", "expires_at",
                            "cursor_timestamp", "checks_passed", "points_recorded"}
    assert rows[0]["bond_id"] == bonded
