/**
 * Finding the taxonomy tag in a refusal message, whichever of the two shapes it arrived in.
 *
 * THE CONTRACT REFUSES IN TWO SHAPES, AND THIS IS THE MEASUREMENT. Both were observed through the
 * real GenVM SDK in `tests/direct/test_retrieval.py`:
 *
 *   [EXTERNAL] the index answered with 1 row(s) for https://... and none is newer than the cursor
 *   Refusal([TRANSIENT] digest-mismatch: want FO4FOH... got 4MTV3W... over 215912 stored bytes)
 *
 * The first is a sentence the contract writes itself. The second is the repr of a `Refusal` that
 * crossed `gl.eq_principle.strict_eq`: `Refusal.message` is a property returning `repr(self)`, and
 * `_raise_if_error` re-raises that string verbatim rather than wrapping it in wording of its own.
 * Not adding wording is the right call, because the refusal already names what happened and where.
 * The consequence is that the tag is at index 0 in one shape and index 8 in the other.
 *
 * AND THE SHAPES DO NOT DEPEND ON THE DELIVERY. The two payable methods do not raise their refusals
 * at all: `create_bond` and `contest_breach` refund the value and RETURN the sentence, because a
 * GenVM revert undoes the storage writes and does not undo the transfer that funded the call. That
 * cost a real stake before it was fixed, in transaction 0xc3a12dd2. `_refund_and_report` hands the
 * message back verbatim, so both shapes arrive by return as well as by throw and this one function
 * reads all four combinations.
 *
 * WHY THIS MODULE EXISTS RATHER THAN A CHECK AT EACH SITE. Two readers need the tag and they had
 * drifted apart: `dry-run.ts` searched for it with `includes` and got both shapes right, while the
 * write runner sorted messages by matching lowercase English words like "archive" and "cdx" and
 * never looked at the tags at all. That worked by luck on the `cdx-*` refusals, whose reason string
 * happens to contain "cdx", and failed on `Refusal([TRANSIENT] digest-mismatch: ...)`, which matched
 * nothing and fell through to the class that tells the reader not to retry. A digest mismatch is the
 * one refusal where retrying is exactly right. One place, one measurement, one behaviour.
 *
 * There is now a third reader, `genlayer/returned-value.ts`, and it is the reason the count matters:
 * it decides whether a FINALIZED transaction carrying GenVM SUCCESS was an acceptance or a refund.
 * A tag rule that lived at each site would have had to be got right there too, on the one path where
 * getting it wrong shows someone a bond that does not exist.
 *
 * The tag vocabulary is not restated here. It is read out of `OUTCOMES`, which already carries each
 * tag beside the copy shown for it, so a fifth outcome class cannot be added without appearing here.
 */

import { OUTCOMES, type OutcomeClass } from "./lifecycle.ts";

/** The four classes a tagged revert can be. `finding` is a verdict and is never an error. */
export type ErrorClass = Exclude<OutcomeClass, "finding">;

export type TaggedRefusal = {
  /** The tag as it appears in the message, e.g. `[EXTERNAL]`. */
  tag: string;
  outcome: ErrorClass;
  /** Everything after the tag, with the `Refusal(` wrapper's closing parenthesis removed. */
  reason: string;
};

/**
 * Derived from the copy table rather than typed a second time.
 *
 * `OUTCOMES` is a `Record` keyed by exactly the four error classes, so its runtime keys are
 * exhaustive by construction: a class added to `OutcomeClass` forces an `OUTCOMES` entry, which
 * appears here without anyone remembering to add it.
 */
const TAGGED = Object.entries(OUTCOMES) as [ErrorClass, { tag: string }][];

function occurrences(text: string, character: string): number {
  return text.split(character).length - 1;
}

/**
 * Drops the closing parenthesis that belongs to a repr rather than to the message.
 *
 * Only ever removes an UNBALANCED one, which is what keeps it from eating punctuation the contract
 * meant. `the index answered with 1 row(s) for ...` is balanced and survives untouched;
 * `cdx-empty: 200 with a 3 byte body ...)` is not and loses its last character. The loop handles a
 * repr nested more than once, which has not been observed and costs nothing to be right about.
 */
function withoutReprWrapper(text: string): string {
  let out = text;
  while (out.endsWith(")") && occurrences(out, ")") > occurrences(out, "(")) {
    out = out.slice(0, -1).trimEnd();
  }
  return out;
}

/**
 * The tag in `message`, or null when there is none.
 *
 * An untagged message is not a contract refusal at all: it is the wallet, the node, the network, or
 * the receipt of a call that was ACCEPTED, and callers handle those cases themselves rather than
 * being handed a default tag that would put words in the contract's mouth. That last case is why
 * `returned-value.ts` can use this as its acceptance test: a successful `create_bond` returns a
 * receipt sentence naming the url, the stake and the timestamps, and carries no tag at all.
 *
 * Searching in the order `OUTCOMES` declares is safe because a message carries exactly one tag,
 * which `test_the_contract_refuses_in_two_message_shapes_and_the_tag_is_not_always_at_the_front`
 * asserts against the deployed vocabulary rather than assuming. The one message that carries a tag
 * twice, the gate-specification refusal, carries the SAME tag twice, and
 * `test_every_gate_spec_refusal_is_expected_which_is_what_makes_the_doubled_tag_safe` reads the
 * source to prove that cannot change quietly.
 */
export function findRefusal(message: string): TaggedRefusal | null {
  for (const [outcome, { tag }] of TAGGED) {
    const at = message.indexOf(tag);
    if (at !== -1) {
      return {
        tag,
        outcome,
        reason: withoutReprWrapper(message.slice(at + tag.length).trim()),
      };
    }
  }
  return null;
}

/**
 * The reason text after a specific tag, for callers that already know which tag they matched.
 *
 * Returns the whole message when the tag is absent, rather than an empty string: a caller that
 * mismatched should show the reader everything it has, not nothing.
 */
export function reasonAfterTag(message: string, tag: string): string {
  const at = message.indexOf(tag);
  if (at === -1) {
    return message.trim();
  }
  return withoutReprWrapper(message.slice(at + tag.length).trim());
}
