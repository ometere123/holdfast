/**
 * Which call is offered on a bond, and the sentence shown when it is not.
 *
 * Two rules are tested here rather than the shape of the objects. The first is the design system's:
 * an idle state offers the next valid action as a verb, or disables it with the reason stated, never
 * a dead button with nothing beside it. The second is the product's: every action except
 * `contest_breach` is callable by a stranger, which is the whole claim being made. A permissionless
 * flag that drifted true on the contest, or false on the check, would misdescribe the contract to
 * the one reader who came to find out whether they are needed.
 *
 * Nothing in `actions.ts` is a literal. The bounds arrive from `get_limits()` through
 * `resolveLimits`, so the last test drives it with limits that disagree with the client defaults and
 * reads the numbers back out of the sentences.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { actionFor, bondActions, nextAction } from "../src/lib/actions.ts";
import { resolveLimits } from "../src/lib/contract-types.ts";

const NOW = "2026-08-25T11:00:00Z";
const STAKE = "250000000000000000000";

/** A live bond with room left on its term and no check yet, so the check is the offered action. */
function bond(overrides = {}) {
  return {
    bond_id: "acme-customer-terms-2026",
    promisor: "0x1234567890AbcdEF1234567890abCDef12345678",
    payee: "0x81b6C8b2f7F0a1C3d4E5f60718293a4B5c6D7e8F",
    url: "https://acme.example.com/legal/customer-terms",
    commitment: "We will not sell your personal data to any third party.",
    commitment_sha256: "0".repeat(64),
    anchor: "customer terms",
    anchor_words: '["limitation of liability","acceptable use","governing law"]',
    anchor_terminal: "last revised in march of this year",
    baseline_timestamp: "20260822123203",
    baseline_digest: "BASEDIGEST00000000000000000000AA",
    baseline_encoding: "gzip",
    stake: STAKE,
    term_days: "365",
    created_at: "2026-08-22T12:40:00Z",
    expires_at: "2027-08-22T12:40:00Z",
    state: "ACTIVE",
    cursor_timestamp: "20260822123203",
    last_checked_at: "",
    checks_passed: "0",
    points_recorded: "0",
    run_length: "0",
    run_first_timestamp: "",
    breach_first_timestamp: "",
    breach_first_digest: "",
    breach_second_timestamp: "",
    breach_second_digest: "",
    breach_excerpt: "",
    breach_rationale: "",
    claimed_at: "",
    contest_deadline: "",
    contest_url: "",
    contest_timestamp: "",
    contest_bond: "0",
    contest_outcome: "",
    contested_at: "",
    settled_at: "",
    settled: false,
    paid_to_payee: "0",
    returned_to_promisor: "0",
    ...overrides,
  };
}

/** A claim with the contest window still open. */
const CLAIM_OPEN = {
  state: "BREACH_CLAIMED",
  claimed_at: "2026-08-24T11:00:00Z",
  contest_deadline: "2026-08-30T11:00:00Z",
};

/** The same claim after the window closed. */
const CLAIM_CLOSED = {
  state: "BREACH_CLAIMED",
  claimed_at: "2026-08-14T11:00:00Z",
  contest_deadline: "2026-08-20T11:00:00Z",
};

/**
 * The claim after the promisor filed against it.
 *
 * Written out rather than spread over `CLAIM_OPEN` at the call site. Two tests failed first because
 * `bond({state: "CONTESTED", ...CLAIM_OPEN})` puts the spread last, so `CLAIM_OPEN`'s own
 * BREACH_CLAIMED quietly won and the fixture was never contested at all. `state` goes last here.
 */
const CONTESTED = {
  ...CLAIM_OPEN,
  contest_url: "https://acme.example.com/legal/customer-terms",
  contest_timestamp: "20260610090000",
  contest_bond: "25000000000000000000",
  contested_at: "2026-08-24T18:00:00Z",
  state: "CONTESTED",
};

const EXPIRED = { expires_at: "2026-08-01T00:00:00Z" };

function keyed(bondValue, nowIso = NOW) {
  const actions = bondActions(bondValue, nowIso);
  return Object.fromEntries(actions.map((action) => [action.key, action]));
}

/* ------------------------------------------------------------------------- *
 * The write surface
 * ------------------------------------------------------------------------- */

test("five actions are offered, in a fixed order, and none of them is a renewal", () => {
  const actions = bondActions(bond(), NOW);
  assert.deepEqual(actions.map((action) => action.key), [
    "check_commitment",
    "contest_breach",
    "adjudicate_contest",
    "settle_breach",
    "expire_bond",
  ]);
  // An earlier version offered `renew_bond`, which the contract has no method for. A button for a
  // method that does not exist fails at the node after the wallet has already opened.
  assert.ok(!actions.some((action) => action.key.includes("renew")));
  assert.ok(!actions.some((action) => action.method.includes("renew")));
  // The key and the method are the same string, because the method name is what gets signed.
  for (const action of actions) assert.equal(action.method, action.key);
});

test("every action but the contest is callable by a stranger, which is the product's whole claim", () => {
  for (const action of bondActions(bond(), NOW)) {
    const expected = action.key !== "contest_breach";
    assert.equal(action.permissionless, expected, action.key);
    assert.equal(action.caller, expected ? "anyone" : "promisor", action.key);
  }
});

test("every action carries a verb and an effect, so no button is ever unlabelled", () => {
  for (const action of bondActions(bond(), NOW)) {
    assert.ok(action.verb.length > 0, action.key);
    assert.ok(action.effect.length > 0, action.key);
    assert.ok(action.cost.length > 0, action.key);
  }
});

/* ------------------------------------------------------------------------- *
 * The rule that availability and its reason are produced together
 * ------------------------------------------------------------------------- */

test("an unavailable action always states why, and an available one never explains itself", () => {
  // The design system's rule, checked across every state and both term positions rather than on one
  // bond. `available` and `reason` are computed separately for two of the five actions, so this is a
  // real invariant and not a restatement.
  const bonds = [
    bond(),
    bond({ last_checked_at: "2026-08-25T01:00:00Z" }),
    bond(EXPIRED),
    bond(CLAIM_OPEN),
    bond(CLAIM_CLOSED),
    bond(CONTESTED),
    bond({ state: "BREACHED", settled: true }),
    bond({ state: "RETURNED", settled: true }),
  ];
  for (const value of bonds) {
    for (const action of bondActions(value, NOW)) {
      assert.equal(
        action.available,
        action.reason === "",
        `${value.state} ${action.key}: available=${action.available} reason=${JSON.stringify(action.reason)}`,
      );
      if (!action.available) assert.ok(action.reason.length > 20, `${value.state} ${action.key}`);
    }
  }
});

/* ------------------------------------------------------------------------- *
 * The check
 * ------------------------------------------------------------------------- */

test("the check is offered on a fresh active bond and names the interval when it is too soon", () => {
  assert.equal(keyed(bond()).check_commitment.available, true);

  const early = keyed(bond({ last_checked_at: "2026-08-25T01:00:00Z" })).check_commitment;
  assert.equal(early.available, false);
  // The reason has to carry both halves: how long ago, and how long until it opens. A bare "too
  // soon" leaves the reader with nothing to do but retry.
  assert.match(early.reason, /last read 10 hours ago/);
  assert.match(early.reason, /interval is 24 hours/);
  assert.match(early.reason, /opens in 14 hours/);

  assert.equal(keyed(bond({ last_checked_at: "2026-08-23T11:00:00Z" })).check_commitment.available, true);
});

test("a check is refused on a terminal bond and names the state it is in, in words", () => {
  const breached = keyed(bond({ state: "BREACH_CLAIMED", ...CLAIM_OPEN })).check_commitment;
  assert.equal(breached.available, false);
  // The underscore is replaced, because "breach_claimed" is a storage value and not a sentence.
  assert.match(breached.reason, /this one is breach claimed\./);
  assert.ok(!breached.reason.includes("_"));
  assert.match(keyed(bond({ state: "RETURNED" })).check_commitment.reason, /this one is returned\./);
});

test("an expired term is not checked again, it is expired, and the reason says which", () => {
  const actions = keyed(bond(EXPIRED));
  assert.equal(actions.check_commitment.available, false);
  assert.match(actions.check_commitment.reason, /released by expiring the bond, not by checking it again/);
  assert.equal(actions.expire_bond.available, true);
});

/* ------------------------------------------------------------------------- *
 * The claim, the contest and the settlement
 * ------------------------------------------------------------------------- */

test("while the window is open the promisor may contest and nobody may settle", () => {
  const actions = keyed(bond(CLAIM_OPEN));
  assert.equal(actions.contest_breach.available, true);
  assert.equal(actions.settle_breach.available, false);
  assert.match(actions.settle_breach.reason, /still open for 5 more days/);
  assert.match(actions.settle_breach.reason, /remove the promisor's only defence/);
});

test("once the window closes anyone may settle and nobody may contest", () => {
  const actions = keyed(bond(CLAIM_CLOSED));
  assert.equal(actions.settle_breach.available, true);
  assert.equal(actions.contest_breach.available, false);
  assert.match(actions.contest_breach.reason, /window has closed/);
});

test("a contest costs a tenth of the stake and says on which condition it comes back", () => {
  const contest = keyed(bond(CLAIM_OPEN)).contest_breach;
  assert.match(contest.cost, /^25 GEN contest bond/);
  assert.match(contest.cost, /returned if the cited capture reads as holding/);
  // And what happens when it does not, because a bond described only by its upside is mispriced.
  assert.match(contest.cost, /goes to the payee with the stake/);
  // Filing decides nothing: the citation is judged by a separate permissionless call.
  assert.match(contest.effect, /Filing decides nothing/);
});

test("settlement moves the whole stake and says it re-verifies before it does", () => {
  const settle = keyed(bond(CLAIM_CLOSED)).settle_breach;
  assert.equal(settle.cost, "250 GEN moves to the payee.");
  assert.match(settle.effect, /Re-verifies both cited captures/);
  // The withdrawal case is the one that makes the digest recorded at creation load bearing.
  assert.match(settle.effect, /withdrawn from the archive since the claim cannot be settled against/);
});

test("adjudication is available exactly in CONTESTED, and is callable by anyone", () => {
  for (const state of ["ACTIVE", "BREACH_CLAIMED", "BREACHED", "RETURNED"]) {
    const action = keyed(bond(state === "BREACH_CLAIMED" ? CLAIM_OPEN : { state })).adjudicate_contest;
    assert.equal(action.available, false, state);
    assert.match(action.reason, /nothing to adjudicate/);
  }
  assert.equal(CONTESTED.state, "CONTESTED");
  const contested = keyed(bond(CONTESTED)).adjudicate_contest;
  assert.equal(contested.available, true);
  assert.equal(contested.permissionless, true);
  assert.match(contested.effect, /asks one question of it/);
});

/* ------------------------------------------------------------------------- *
 * Expiry
 * ------------------------------------------------------------------------- */

test("expiry needs an active bond AND an expired term, and the two failures read differently", () => {
  const early = keyed(bond()).expire_bond;
  assert.equal(early.available, false);
  assert.match(early.reason, /more days/);
  assert.match(early.reason, /cannot be closed early by a stranger/);

  const terminal = keyed(bond({ state: "BREACHED", ...EXPIRED })).expire_bond;
  assert.equal(terminal.available, false);
  assert.match(terminal.reason, /already reached a terminal state/);

  const ready = keyed(bond(EXPIRED)).expire_bond;
  assert.equal(ready.available, true);
  assert.equal(ready.cost, "250 GEN returns to the promisor.");
});

test("a term with hours left is not expired, because the day count floors rather than rounds", () => {
  // Six hours before expiry the gap floors to 0, which is not less than 0, so the bond is live and
  // the sentence says zero days rather than claiming the term has run out.
  const action = keyed(bond({ expires_at: "2026-08-25T17:00:00Z" })).expire_bond;
  assert.equal(action.available, false);
  assert.match(action.reason, /runs for 0 more days/);
});

/* ------------------------------------------------------------------------- *
 * What to lead with
 * ------------------------------------------------------------------------- */

test("the lead action follows the lifecycle's order and not the array's", () => {
  const cases = [
    [bond(CONTESTED), "adjudicate_contest"],
    [bond(CLAIM_CLOSED), "settle_breach"],
    [bond(CLAIM_OPEN), "contest_breach"],
    [bond(EXPIRED), "expire_bond"],
    [bond(), "check_commitment"],
  ];
  for (const [value, expected] of cases) {
    const action = nextAction(value, NOW);
    assert.equal(action?.key, expected, value.state);
    assert.equal(action?.available, true, expected);
  }
});

test("the lead action falls back to the check with its reason, rather than to nothing at all", () => {
  // Nothing is available on this bond: active, checked an hour ago, term still running. The page
  // still has to show a verb, so the fallback is the check, disabled, carrying its own sentence.
  const idle = nextAction(bond({ last_checked_at: "2026-08-25T10:00:00Z" }), NOW);
  assert.equal(idle?.key, "check_commitment");
  assert.equal(idle?.available, false);
  assert.match(idle?.reason ?? "", /opens in 23 hours/);

  // Terminal states have nothing available either, and still lead with a verb and a reason.
  for (const state of ["BREACHED", "RETURNED"]) {
    const action = nextAction(bond({ state, settled: true }), NOW);
    assert.equal(action?.key, "check_commitment", state);
    assert.ok((action?.reason ?? "").length > 0, state);
  }
});

/* ------------------------------------------------------------------------- *
 * Lookup
 * ------------------------------------------------------------------------- */

test("looking up a known action returns it and an unknown one throws by name", () => {
  assert.equal(actionFor(bond(), NOW, "expire_bond").key, "expire_bond");
  assert.throws(() => actionFor(bond(), NOW, "renew_bond"), /Unknown bond action: renew_bond/);
});

/* ------------------------------------------------------------------------- *
 * The bounds come from the contract
 * ------------------------------------------------------------------------- */

test("the interval, the batch size and the contest percentage are read from limits, not written in", () => {
  // A contract whose constants moved must move the sentences. Driving the module with limits that
  // disagree with the client defaults is the only way to tell a threaded value from a coincidence.
  const wider = { ...resolveLimits(), checkIntervalHours: 72, maxPointsPerCheck: 3, contestBondPct: 20 };

  const early = bondActions(bond({ last_checked_at: "2026-08-24T11:00:00Z" }), NOW, wider);
  const check = early.find((action) => action.key === "check_commitment");
  assert.equal(check?.available, false);
  assert.match(check?.reason ?? "", /interval is 72 hours/);
  assert.match(check?.reason ?? "", /opens in 48 hours/);
  assert.match(check?.effect ?? "", /up to 3 captures after the cursor/);

  const contest = bondActions(bond(CLAIM_OPEN), NOW, wider).find((action) => action.key === "contest_breach");
  assert.match(contest?.cost ?? "", /^50 GEN contest bond/);

  // And the same call under the client defaults disagrees, which is what makes the above a test.
  const defaulted = bondActions(bond({ last_checked_at: "2026-08-24T11:00:00Z" }), NOW);
  assert.equal(defaulted.find((action) => action.key === "check_commitment")?.available, true);
});
