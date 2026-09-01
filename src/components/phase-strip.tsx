"use client";

/**
 * The five client phases, with the two that cost a signature marked as such.
 *
 * Marked before they happen rather than at the moment the wallet opens, because the point of the
 * mark is to let somebody decide whether to start.
 *
 * This lives in its own file because two writes use it and they are far apart: the bond actions on a
 * detail page, and the create form. Two copies of a progress indicator drift, and a strip that says
 * a different thing in two places about the same five phases is worse than no strip.
 */

import { CLIENT_PHASES } from "@/lib/lifecycle";

export function PhaseStrip({ phase }: { phase: string }) {
  const at = CLIENT_PHASES.findIndex((item) => item.key === phase);
  if (at < 0) return null;
  const current = CLIENT_PHASES[at];

  return (
    <div className="mt-5">
      <ul className="flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
        {CLIENT_PHASES.map((item, index) => (
          <li
            key={item.key}
            className="hf-record-sm"
            style={{ color: index <= at ? "var(--emulsion)" : "var(--emulsion-72)" }}
            aria-current={index === at ? "step" : undefined}
          >
            {item.label}
            {item.costsSignature ? " (signature)" : ""}
          </li>
        ))}
      </ul>
      <p className="hf-note mt-2 max-w-[74ch]">{current.detail}</p>
    </div>
  );
}
