/**
 * What the contract will do, named step by step, before anybody signs anything.
 *
 * Every row declares its kind, and that is the point of the table rather than a decoration on it.
 * Two of the eleven steps in a check are a reading of text and the other nine are arithmetic on
 * bytes the contract already holds or a fetch agreed byte for byte across validators. A progress
 * spinner asserts none of that. This table is what makes the boundary between counted bytes and
 * read meaning visible on the screen instead of in a footnote.
 *
 * `programFor` returns undefined for a method it does not know, and this component renders that as
 * a refusal to describe the call. The earlier default returned the settlement steps for anything
 * unrecognised, which printed a confident and wrong account of what was about to happen.
 */

import type { ProgramStep, StepKind } from "@/lib/lifecycle";
import { STEP_KIND_TEXT, programFor } from "@/lib/lifecycle";

const KIND_LABEL: Record<StepKind, string> = {
  deterministic: "arithmetic",
  network: "fetch",
  inference: "reading",
};

export function ProgramTable({
  functionName,
  heading,
}: {
  functionName: string;
  heading?: string;
}) {
  const steps: ProgramStep[] | undefined = programFor(functionName);

  if (!steps) {
    return (
      <div className="border p-4" style={{ borderColor: "var(--rule-strong)" }}>
        <p className="hf-note max-w-[72ch]">
          <span className="hf-record hf-tag hf-tag-open">NO PROGRAM</span> There is no recorded
          program of work for <span className="hf-record">{functionName}</span>, so this interface
          will not describe what it does. A plausible description of a call nobody verified is worse
          than no description.
        </p>
      </div>
    );
  }

  const readings = steps.filter((step) => step.kind === "inference").length;
  const fetches = steps.filter((step) => step.kind === "network").length;

  return (
    <div>
      <h3 className="hf-heading">{heading ?? "What this call does"}</h3>
      <p className="hf-note mt-2 max-w-[76ch]">
        {steps.length} steps: {steps.length - readings - fetches} arithmetic, {fetches}{" "}
        {fetches === 1 ? "fetch" : "fetches"}, {readings}{" "}
        {readings === 1 ? "reading" : "readings"} of text. Each row names its own source.
      </p>

      <ol className="mt-4 list-none p-0">
        {steps.map((step, index) => (
          <li key={step.key} className="border-t py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="hf-record-sm" style={{ color: "var(--emulsion-72)" }}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="hf-body">{step.label}</span>
              <span className="hf-record hf-tag" title={STEP_KIND_TEXT[step.kind]}>
                {KIND_LABEL[step.kind]}
              </span>
            </div>
            <p className="hf-note mt-1 max-w-[76ch]">{step.detail}</p>
            <p className="hf-record-sm mt-1" style={{ color: "var(--emulsion-72)" }}>
              source: {step.source}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
