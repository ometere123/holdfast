"""The two rules the client reimplements, asserted to agree with the contract case by case.

WHAT IS AT STAKE, LITERALLY. `create_bond` is payable, and until the refusal boundary was added a
refusal cost the promisor the whole stake: a GenVM revert undoes the storage writes and does not undo
the transfer that funded the call, measured on chain in transaction 0xc3a12dd2. The stake now comes
back, so a rule the client gets wrong costs a transaction rather than 250 GEN. That is a much smaller
number and it is not zero, and it is still the wrong answer shown to someone who typed a correct
draft. `src/lib/validate.ts` stays load bearing: the frontend's zero-value simulation is what lets a
promisor learn the answer without signing anything at all.

WHICH TWO RULES, AND WHY THESE. Most of the contract's checks are bounds the client can copy from
`get_limits()` and get right by construction. Two cannot be:

  - gate B's anchor is DERIVED from the URL and never supplied, so the form has to derive it to be
    able to show it, and a URL whose last path segment normalizes to under three characters is
    unbondable for a reason no form field displays;
  - gate D's independence rule compares NORMALIZED forms of strings the promisor never sees, in both
    directions, by substring as well as by equality. It is the rule least likely to be guessed and it
    sits behind the stake.

Both are mirrored in TypeScript. `tests/parity-cases.json` holds the cases and the expected answers,
`tests/parity.test.mjs` runs it against `src/lib`, and this file runs it against the contract. One
table, two readers, so a change to either implementation breaks the other's suite.

TWO INSTRUMENTS, AND THE SECOND IS WHAT MAKES THE FIRST HONEST. Most of these cases have no public
method that echoes the answer: `normalize_text` has no caller that returns its output, and
`_derive_anchor`'s result is only ever visible inside a refusal. So the whole table runs through
`contract_source`, which extracts those two functions from `contracts/Holdfast.py` and executes them
verbatim. On its own that would only prove the extract agrees with TypeScript. So a second pass
drives the same cases through the real SDK by simulating `create_bond`, using two refusal messages
that quote the values back:

  [EXPECTED] the last path segment of 'https://example.com/v1.2' normalizes to 'v1', under the 3 ...
  [EXPECTED] the gate specification is not usable: Refusal([EXPECTED] gate-spec-terminal-not-independent: ...)

The second of those is A THIRD REFUSAL MESSAGE SHAPE, found here. `_reject` writes a sentence with the
tag at index 0, a `Refusal` crossing `strict_eq` arrives as a repr with the tag at index 9, and this
one is a sentence with a repr embedded in it, carrying `[EXPECTED]` TWICE. It is classified correctly
only because the inner tag can never disagree with the outer one, which
`test_every_gate_spec_refusal_is_expected_which_is_what_makes_the_doubled_tag_safe` asserts against
the source rather than assuming.

All three shapes are now delivered two ways, which changes nothing about reading them: the payable
methods return the sentence and the rest raise it. The tag is still the first token either way, so
`findRefusal` in the client and `returned_refusal` here take the same string.

AND ONE MEASURED DIVERGENCE. The client's section loop skips an entry that normalizes to empty; the
contract's does not, and the empty string is a substring of everything, so such a section would make
EVERY terminal marker overlap. The two would disagree on every draft carrying one. It is unreachable
because both languages refuse the section list first, and the last test here is that check rather
than a comment claiming it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import bonds
import contract_source
from conftest import numeric_constant, returned_refusal

CASES = json.loads((Path(__file__).resolve().parents[1] / "parity-cases.json").read_text("ascii"))

MIN_DERIVED_ANCHOR_CHARS = numeric_constant("MIN_DERIVED_ANCHOR_CHARS")
MIN_ANCHOR_WORD_CHARS = numeric_constant("MIN_ANCHOR_WORD_CHARS")
MAX_ANCHOR_WORD_CHARS = numeric_constant("MAX_ANCHOR_WORD_CHARS")

NO_VALUE = "[EXPECTED] a bond needs a stake; this call carried no value"

#: Every mismatch is collected and reported together rather than failing on the first one. A parity
#: failure is a class of disagreement and not an incident: seeing one of fourteen tells the reader
#: almost nothing about whether the rule drifted or a single case was mistyped.
def report(mismatches: list[str], total: int) -> None:
    assert not mismatches, "%d of %d cases disagree:\n%s" % (
        len(mismatches), total, "\n".join("  " + line for line in mismatches))


# ---------------------------------------------------------------------------
# The shared table against the contract's own source, executed here
# ---------------------------------------------------------------------------

def test_the_normalization_agrees_with_the_shared_table():
    """All four steps, in order, including the two consequences of the order.

    The interesting rows are the invisible ones. A no-break space is whitespace to both languages
    and collapses; a byte order mark is whitespace to JavaScript and not to Python, so under the
    contract's rule it is STRIPPED and joins its neighbours into one word. The client writes
    Python's class out longhand instead of using `\\s` for exactly this reason, and these rows are
    what would catch someone simplifying it back.
    """
    cases = CASES["normalize"]["cases"]
    mismatches = []
    for case in cases:
        got = contract_source.normalize_text(case["input"])
        if got != case["expect"]:
            mismatches.append("normalize(%r) = %r, table says %r  [%s]"
                              % (case["input"], got, case["expect"], case["why"]))
    report(mismatches, len(cases))


def test_the_derived_anchor_agrees_with_the_shared_table():
    """The anchor, and the normalized form the independence rule compares.

    Both are asserted because they can drift apart: `terms.longer` keeps its dot in the anchor and
    loses it in the normalized form, where it JOINS the two words into `termslonger`. A client that
    derived the anchor correctly and normalized it differently would still show the wrong overlap.
    """
    cases = CASES["anchor"]["cases"]
    mismatches = []
    for case in cases:
        anchor = contract_source.derive_anchor(case["url"])
        normalized = contract_source.normalize_text(anchor)
        if anchor != case["expect"]:
            mismatches.append("anchor(%s) = %r, table says %r  [%s]"
                              % (case["url"], anchor, case["expect"], case["why"]))
        elif normalized != case["normalized"]:
            mismatches.append("normalized anchor(%s) = %r, table says %r  [%s]"
                              % (case["url"], normalized, case["normalized"], case["why"]))
    report(mismatches, len(cases))


def test_the_table_agrees_with_the_contract_about_which_urls_can_be_bonded_at_all():
    """`bondable` is not an extra fact; it is the floor applied to the normalized anchor.

    Derived from the constant rather than restated, so a floor that moves in the contract makes this
    fail rather than making the table quietly wrong.
    """
    cases = CASES["anchor"]["cases"]
    mismatches = []
    for case in cases:
        reaches = len(case["normalized"]) >= MIN_DERIVED_ANCHOR_CHARS
        if reaches != case["bondable"]:
            mismatches.append("%s normalizes to %r, %d chars, but the table calls it bondable=%s"
                              % (case["url"], case["normalized"], len(case["normalized"]),
                                 case["bondable"]))
    report(mismatches, len(cases))


# ---------------------------------------------------------------------------
# The same cases through the real SDK, which is what proves the extract is live code
# ---------------------------------------------------------------------------

def test_an_unbondable_url_is_refused_by_the_deployed_contract_with_its_anchor_quoted(
        contract, direct_vm, value_ledger):
    """The four URLs the table calls unbondable, refused by the contract, quoting what it derived.

    This is the case with no form field of its own. The promisor typed a URL; the refusal is about a
    string derived from it that they never saw. The message carries both, which is the only reason
    the create form can explain the refusal at all.
    """
    cases = [c for c in CASES["anchor"]["cases"] if not c["bondable"]]
    assert cases, "the table no longer carries an unbondable URL"
    mismatches = []
    for case in cases:
        message = returned_refusal(
            bonds.simulate(contract, direct_vm, value_ledger, url=case["url"]))
        want = "the last path segment of %r normalizes to %r" % (case["url"], case["normalized"])
        if want not in message:
            mismatches.append("%s: wanted %r in the refusal, got %r" % (case["url"], want, message))
    report(mismatches, len(cases))


def test_a_bondable_url_derives_the_anchor_the_table_says_on_chain(
        contract, direct_vm, value_ledger):
    """The positive half, through the SDK, using gate D's own refusal as the readout.

    There is no view that returns the derived anchor before a bond exists, and creating one costs a
    staged archive and a stake. So this asks for the overlap refusal on purpose: pass the derived
    anchor back in as the terminal marker and `GateSpec.validate` quotes the anchor it compared
    against. Reaching that refusal at all is itself an assertion, because the mock table is empty
    and any network call would fail with an unmocked URL instead.
    """
    cases = [c for c in CASES["anchor"]["cases"] if c["bondable"]]
    mismatches = []
    for case in cases:
        message = returned_refusal(bonds.simulate(
            contract, direct_vm, value_ledger, url=case["url"], anchor_terminal=case["expect"]))
        want = "overlaps anchor %r" % case["expect"]
        if want not in message:
            mismatches.append("%s: wanted %r in the refusal, got %r" % (case["url"], want, message))
    report(mismatches, len(cases))


def test_the_independence_rule_agrees_with_the_shared_table_on_chain(
        contract, direct_vm, value_ledger):
    """Twelve specs, and which field each one collided with, read off the contract.

    A case the table calls independent has to reach the STAKE refusal, and that is the strongest
    available form of the assertion: the value check is deliberately the last deterministic check, so
    arriving there means every other check passed, and the empty mock table means it arrived without
    touching the network. A weaker test could only say "it did not refuse for this reason".
    """
    cases = CASES["independence"]["cases"]
    mismatches = []
    for case in cases:
        message = returned_refusal(bonds.simulate(
            contract, direct_vm, value_ledger,
            url=case["url"],
            anchor_words=json.dumps(case["sections"]),
            anchor_terminal=case["terminal"]))
        label = "%r over %s" % (case["terminal"], case["sections"])

        if case["overlaps"] is None:
            if message != NO_VALUE:
                mismatches.append("%s: the table calls this usable, but got %r" % (label, message))
            continue

        if "gate-spec-terminal-not-independent" not in message:
            mismatches.append("%s: the table calls this an overlap, but got %r" % (label, message))
        elif ("overlaps %s " % case["overlaps"]) not in message:
            mismatches.append("%s: the table says it overlaps the %s, got %r"
                              % (label, case["overlaps"], message))
    report(mismatches, len(cases))


def test_an_empty_normalizing_section_is_refused_before_the_two_rules_can_disagree(
        contract, direct_vm, value_ledger):
    """The one measured divergence, and the check that stops it being reachable.

    The client's section loop does `if (!section) continue`. The contract's does not, and asks
    `terminal in other or other in terminal` where `other` is the normalized section. The empty
    string is a substring of every string, so a section normalizing to empty would make the contract
    refuse EVERY terminal marker while the client accepted them all. That is a real disagreement, and
    the only reason it is not a defect is that `_require_anchor_words` runs first and refuses the
    section list outright.

    Asserted here rather than described, because it is load bearing: if the word-length floor were
    ever relaxed to zero, this test is what says the two implementations have just diverged.
    """
    case = CASES["unreachable"]["empty_normalizing_section"]
    empty = [s for s in case["sections"] if contract_source.normalize_text(s) == ""]
    assert empty, "the case no longer carries a section that normalizes to empty"

    message = returned_refusal(bonds.simulate(
        contract, direct_vm, value_ledger,
        anchor_words=json.dumps(case["sections"]),
        anchor_terminal=case["terminal"]))

    # Refused for the length of the section, which is the check that runs first, and NOT for the
    # overlap. A message about gate D here would mean the guard had moved and the divergence was live.
    assert "normalizes to 0 characters, outside %d to %d" % (
        MIN_ANCHOR_WORD_CHARS, MAX_ANCHOR_WORD_CHARS) in message, message
    assert "gate-spec-terminal-not-independent" not in message, message
    assert MIN_ANCHOR_WORD_CHARS >= 1, (
        "with a floor of zero the contract and the client disagree on every draft carrying an "
        "empty-normalizing section, and this test is the guard")


# ---------------------------------------------------------------------------
# The third refusal message shape, found while writing the above
# ---------------------------------------------------------------------------

def test_the_gate_specification_refusal_carries_its_tag_twice(
        contract, direct_vm, value_ledger):
    """A THIRD SHAPE, and the reason the frontend still classifies it correctly.

    `_open_bond` reports a bad spec with `self._reject("... : %s" % bad.message)`, and `bad.message`
    is `repr(Refusal(...))`, which already begins with a tag. So the message is a tagged sentence
    with a tagged repr inside it and `[EXPECTED]` appears twice. `findRefusal` in the client takes the
    first tag it finds, which is right here only because the two tags always agree.

    The parentheses matter too. `withoutReprWrapper` strips a trailing `)` only when it is
    unbalanced, and this message's are balanced: the `Refusal(` that opens is closed inside the
    sentence. So the reason text survives whole, which the last assertion pins.
    """
    message = returned_refusal(
        bonds.simulate(contract, direct_vm, value_ledger, anchor_terminal="terms"))

    assert message.startswith("[EXPECTED] the gate specification is not usable: "), message
    assert message.count("[EXPECTED]") == 2, message
    assert "Refusal([EXPECTED] gate-spec-terminal-not-independent: " in message, message
    for tag in ("[EXTERNAL]", "[TRANSIENT]", "[LLM_ERROR]"):
        assert tag not in message, message
    assert message.count("(") == message.count(")"), message


def test_every_gate_spec_refusal_is_expected_which_is_what_makes_the_doubled_tag_safe():
    """The invariant the doubled tag rests on, read out of the source.

    Taking the first tag in a message is only correct if a `_reject` sentence can never embed a
    refusal tagged differently from itself. `GateSpec.validate` is the only place that happens, and
    every refusal it returns is `EXPECTED`. A branch added with `EXTERNAL` or `TRANSIENT` would put
    an outer `[EXPECTED]` in front of it and the client would show the wrong outcome class with the
    wrong retry advice, so this asserts the property rather than trusting it.
    """
    block = contract_source.source_block("validate", indent=4)
    assert "gate-spec-terminal-not-independent" in block, (
        "source_block found some other validate(); this test is reading the wrong function")

    tags = re.findall(r"Refusal\(\s*([A-Z_]+)", block)
    assert tags, block
    assert set(tags) == {"EXPECTED"}, (
        "GateSpec.validate now returns %s, so `create_bond`'s outer [EXPECTED] can disagree with "
        "the tag inside it and the client's first-tag rule stops being correct" % sorted(set(tags)))
