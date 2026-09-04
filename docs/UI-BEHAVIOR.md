# Expected UI behavior, per outcome

What the interface shows for each class of result a write can produce. Every sentence below is
copied from (or paraphrases) the actual strings in `src/lib/lifecycle.ts`,
`src/lib/contract-types.ts` and the components that render them, not invented for this document,
so a reviewer can grep the quoted fragment and find where it comes from.

## Refusals (the call reverted; nothing moved)

Every refusal carries one of the contract's four tags, and the frontend renders each tag as a
distinct card via `OUTCOMES` in `src/lib/lifecycle.ts`. None of them is styled as an error in the
generic sense: each names what actually happened and whether trying again is the right next step.

| Tag | Headline shown | What the user is told | Retry advised? |
| --- | --- | --- | --- |
| `[EXPECTED]` | "The request was refused" | The contract declined this call on its own terms. Input unchanged, no stake moved, no archive touched. | No |
| `[EXTERNAL]` (archive refusal) | "The archive could not be read" | A capture the index named could not be retrieved, or the index answered with nothing newer than the cursor. No document was examined; the bond is untouched. An unreachable archive is never reported as an intact commitment or a broken one. | Yes |
| `[TRANSIENT]` (validator disagreement) | "Validators fetched different bytes" | The digests did not agree across validators, so they did not read the same capture. The call reverted rather than resolving a disagreement into a result. | Yes |
| `[LLM_ERROR]` | "The reading failed closed" | Either the model's output could not be parsed, or it cited an excerpt not present in the decoded bytes. A finding that cannot be quoted from the document is not a finding. | Yes |

**Archive refusal, specifically** (`[EXTERNAL]`): this is the case named in this pass's brief. The
UI must never render "the commitment failed" or a blank/weakened frame for this outcome, because
the distinguishing property is that no document was ever examined, so nothing about the commitment is
claimed in either direction. `check_commitment`'s docstring is explicit that an empty or
unreachable index "reverts `[EXTERNAL]` and writes nothing at all."

**Transient disagreement, specifically** (`[TRANSIENT]`): the same principle applies to a
disagreement between validators' fetched bytes. It is recorded as "validators fetched different
bytes," never as evidence the page changed or the commitment weakened. Nothing is written to the
bond; the cursor does not advance; running the check again is the expected and safe next step,
which is why `retry: true` is set for this class in `OUTCOMES`.

## Blank frames (the call succeeded; a capture was read and rejected by a gate)

Distinct from every refusal above, because this is the *one* failure the contract actually
records. `BLANK_FRAME_MEANING` in `src/lib/lifecycle.ts`:

> "A blank frame is a capture that arrived and verified, then failed a gate. It is the only
> failure written down, and it is never counted as the commitment weakening."

A blank frame **breaks a run** rather than counting as a loss or a hold: two genuine weakenings on
either side of one blank frame are not read as consecutive, because the contract does not know
what the document said at the blank instant.

## Held (checks ran; commitment intact)

Rendered via `heldHeadline()`:

- 1 capture: "The commitment was unchanged across 1 archived capture."
- N captures: "The commitment was unchanged across N archived captures."
- Always paired with the limit: "This does not mean the promise was kept in practice, only that
  the published wording did not weaken," plus the exact `checks passed` count from the contract.

## Contest

Surfaced through `BondActions` (`src/components/bond-actions.tsx`) as the verb "Contest the claim,"
calling `contest_breach`, and through the bond state text in `contract-types.ts`:

- **CONTESTED** (in progress): "The promisor cited archived evidence against the claim and posted
  a contest bond." Limit shown alongside it: "The contest is read against the archive only. Intent
  and materiality are out of scope."
- **UPHELD**: "The cited capture carried a commitment at least as strong, so the bond returned to
  active." Limit: "The contest bond was returned. The earlier breach claim is recorded, not
  erased."
- **FAILED**: "The cited capture did not carry a commitment at least as strong, so the claim
  stood." Limit: "The contest bond was forfeited along with the stake. The reading is quoted from
  the capture."

`contest_breach` is the one call in this contract that is *not* permissionless: only the named
promisor may call it (see `src/lib/actions.ts`'s header comment), because it is the promisor's
defence and not an obligation open to a stranger.

## Settlement (breach claimed, contest window closed without a successful contest)

- **BREACH_CLAIMED**: "Two consecutive qualified captures read as weakened. The stake is held and
  the contest window is open." Limit: "Nothing has been paid out. The promisor may still show the
  commitment moved."
- **BREACHED** (after settlement): "The claim survived the window or the contest failed. The stake
  went to the payee." Limit, carried on every bond state: "The finding is a reading of archived
  text, quoted from it, not a legal determination."

The bond detail page (`src/app/bonds/[id]/page.tsx`) shows the two weakened captures that
triggered a breach claim side by side, each labelled "Read as weakened" with the quoted archived
text, and states the exact number of consecutive captures a breach needs
(`status.breach_run_needed`) so a reader never has to infer the threshold.

## Expiry / refund (term ran out; commitment never weakened)

- **RETURNED**: "The term ran out with the commitment intact across every qualified capture, and
  the stake went back." This is the `expire_bond` outcome, callable by anyone once
  `bond.expires_at` has passed and the bond is still ACTIVE (not claimed, not contested).

## Payout (money actually moves)

There are exactly two places a bond's stake goes anywhere other than back to the promisor's own
control, and the UI names the direction every time, never just a verdict word:

- **To the payee**: only after BREACHED. The state text says so directly ("The stake went to the
  payee") rather than a generic "resolved" or a checkmark.
- **To the promisor**: after RETURNED (term expired, commitment intact) or after a contest is
  UPHELD (contest bond returned, breach claim stays on record but stake stays put/active again).

No payout is ever described as a legal or moral verdict. `BOND_STATE_TEXT`'s `limit` field is
present on every single state for this reason, most pointedly on BREACHED: "The finding is a
reading of archived text, quoted from it, not a legal determination."

## What must never happen (regression bar for this document)

- An `[EXTERNAL]` (archive refusal) or `[TRANSIENT]` (validator disagreement) outcome must never
  be rendered with weakened/breach language, a blank frame, or any visual state that implies the
  commitment was examined and found wanting. The archive not answering, or two validators not
  agreeing, is not evidence about the page.
- A blank frame must never be counted toward or against a breach run on its own; it breaks the run
  and is shown as neither a hold nor a weakening.
- No payout state may be shown without also showing the exact destination address's role (payee vs
  promisor) and the "not a legal determination" limit text.
