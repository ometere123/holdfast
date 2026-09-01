/**
 * Which contract call is valid on this bond right now, and if none is, why not.
 *
 * The rule from the design system is that an idle state shows the next valid action as a
 * verb, enabled, or disabled with the reason stated. Never a dead button with no
 * explanation. So availability and the sentence explaining unavailability are produced
 * together here, from the bond's own stored fields, and the same function feeds both the
 * button and the preflight that refuses the write for free.
 *
 * Five actions, which is the contract's whole write surface after `create_bond`. There is no
 * renewal: an earlier version of this file offered one, and the contract has no such method. A
 * button for a method that does not exist fails at the node with an unreadable error after the
 * wallet has already opened, which is the worst place to discover it. A term that has run out is
 * expired and a fresh bond is created against a fresh baseline, which is also the honest shape,
 * because extending a term without re-qualifying a baseline would carry an old reading forward
 * into a new promise.
 *
 * Every one of these is callable by a stranger except `contest_breach`. That is the product:
 * nobody has to be trusted to run the check, and the one call reserved to the promisor is the
 * one that is their defence rather than their obligation.
 *
 * The bounds come from `get_limits()` through `resolveLimits`. Nothing here is a literal.
 */

import type { Bond, ResolvedLimits } from "./contract-types.ts";
import { resolveLimits } from "./contract-types.ts";
import { daysBetween, formatGen, hoursBetween, percentOfWei } from "./format.ts";

export type ActionKey =
  | "check_commitment"
  | "contest_breach"
  | "adjudicate_contest"
  | "settle_breach"
  | "expire_bond";

export type BondAction = {
  key: ActionKey;
  /** The label on the button. A verb, in the archival register. */
  verb: string;
  method: string;
  /** True when anyone may call it. False when the contract checks the caller. */
  permissionless: boolean;
  caller: "anyone" | "promisor";
  available: boolean;
  /** Empty when available. Otherwise the reason, as a full sentence. */
  reason: string;
  /** What it costs beyond gas. Printed next to the verb before any signature. */
  cost: string;
  /** What it does, in one line, for the row under the button. */
  effect: string;
};

const HELD = "The stake stays escrowed.";

export function bondActions(
  bond: Bond,
  nowIso: string,
  limits: ResolvedLimits = resolveLimits(),
): BondAction[] {
  const sinceCheck = hoursBetween(bond.last_checked_at, nowIso);
  const untilExpiry = daysBetween(nowIso, bond.expires_at);
  const untilContestClose = hoursBetween(nowIso, bond.contest_deadline);
  const expired = untilExpiry !== undefined && untilExpiry < 0;
  const contestOpen = untilContestClose !== undefined && untilContestClose > 0;

  const checkReason = () => {
    if (bond.state !== "ACTIVE") {
      return `Captures are only examined while a bond is active, and this one is ${bond.state.toLowerCase().replace("_", " ")}.`;
    }
    if (expired) {
      return "The term has run out. The stake is released by expiring the bond, not by checking it again.";
    }
    if (sinceCheck !== undefined && sinceCheck < limits.checkIntervalHours) {
      const wait = limits.checkIntervalHours - sinceCheck;
      return `The archive was last read ${sinceCheck} hours ago. The interval is ${limits.checkIntervalHours} hours, so the next check opens in ${wait} hours.`;
    }
    return "";
  };

  const contestReason = () => {
    if (bond.state !== "BREACH_CLAIMED") {
      return "A contest answers an open claim, and there is no open claim on this bond.";
    }
    if (!contestOpen) {
      return "The contest window has closed. Evidence filed now would arrive after the bond can be settled.";
    }
    return "";
  };

  const settleReason = () => {
    if (bond.state !== "BREACH_CLAIMED") {
      return "Settlement follows an uncontested claim, and there is no open uncontested claim here.";
    }
    if (contestOpen) {
      const days = daysBetween(nowIso, bond.contest_deadline) ?? 0;
      return `The contest window is still open for ${days} more days. Settling before it closes would remove the promisor's only defence.`;
    }
    return "";
  };

  return [
    {
      key: "check_commitment",
      verb: "Advance the reel",
      method: "check_commitment",
      permissionless: true,
      caller: "anyone",
      available: checkReason() === "",
      reason: checkReason(),
      cost: `Gas only. ${HELD}`,
      effect: `Reads up to ${limits.maxPointsPerCheck} captures after the cursor, admits the ones that pass the gates, and asks whether the commitment still holds in each.`,
    },
    {
      key: "contest_breach",
      verb: "Contest the claim",
      method: "contest_breach",
      permissionless: false,
      caller: "promisor",
      available: contestReason() === "",
      reason: contestReason(),
      cost: `${formatGen(percentOfWei(bond.stake, limits.contestBondPct))} contest bond, returned if the cited capture reads as holding. If it does not, the contest bond goes to the payee with the stake.`,
      effect:
        "Cites an archived capture where the commitment does hold. Filing decides nothing: the citation is judged when anyone calls the adjudication.",
    },
    {
      key: "adjudicate_contest",
      verb: "Adjudicate the contest",
      method: "adjudicate_contest",
      permissionless: true,
      caller: "anyone",
      available: bond.state === "CONTESTED",
      reason:
        bond.state === "CONTESTED"
          ? ""
          : "There is no filed contest on this bond, so there is nothing to adjudicate.",
      cost: `Gas only. ${HELD}`,
      effect:
        "Reads the promisor's cited capture and asks one question of it: is a commitment at least as strong present there.",
    },
    {
      key: "settle_breach",
      verb: "Settle the claim",
      method: "settle_breach",
      permissionless: true,
      caller: "anyone",
      available: settleReason() === "",
      reason: settleReason(),
      cost: `${formatGen(bond.stake)} moves to the payee.`,
      effect:
        "Re-verifies both cited captures, then transfers the stake. A capture withdrawn from the archive since the claim cannot be settled against.",
    },
    {
      key: "expire_bond",
      verb: "Expire the bond",
      method: "expire_bond",
      permissionless: true,
      caller: "anyone",
      available: bond.state === "ACTIVE" && expired,
      reason:
        bond.state !== "ACTIVE"
          ? "Only an active bond expires. This one has already reached a terminal state."
          : expired
            ? ""
            : `The term runs for ${untilExpiry ?? 0} more days. A bond cannot be closed early by a stranger.`,
      cost: `${formatGen(bond.stake)} returns to the promisor.`,
      effect:
        "Closes the term with the commitment intact across every capture that qualified, and releases the stake.",
    },
  ];
}

/** The single action to lead with. Availability first, then the order the lifecycle runs in. */
export function nextAction(
  bond: Bond,
  nowIso: string,
  limits: ResolvedLimits = resolveLimits(),
): BondAction | undefined {
  const actions = bondActions(bond, nowIso, limits);
  const order: ActionKey[] = [
    "adjudicate_contest",
    "settle_breach",
    "contest_breach",
    "expire_bond",
    "check_commitment",
  ];
  for (const key of order) {
    const action = actions.find((item) => item.key === key);
    if (action?.available) return action;
  }
  return actions.find((action) => action.key === "check_commitment");
}

export function actionFor(
  bond: Bond,
  nowIso: string,
  key: ActionKey,
  limits: ResolvedLimits = resolveLimits(),
): BondAction {
  const found = bondActions(bond, nowIso, limits).find((action) => action.key === key);
  if (!found) throw new Error(`Unknown bond action: ${key}`);
  return found;
}
