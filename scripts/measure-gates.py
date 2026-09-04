#!/usr/bin/env python3
"""Build evidence/gate-measurements.json from the project's own captured/synthetic fixtures.

WHY THIS EXISTS. The contract's own comment at GATE_A_ENABLED_DEFAULT (contracts/Holdfast.py)
already says, honestly, that gate A is disabled after one measured false-rejection and that
gates B, C and D have no measured true positive against a real deficient capture: an earlier
version of that same comment claimed the opposite, and the claim was an artefact of a measuring
script that scored compressed gzip bytes as if they were the decoded page. This script is the
replacement for that artefact. It reuses the same `archive.admit_snapshot` the contract embeds
and the same `spec_for`/fixture loader the offline suite (`_build/holdfast-archive/test_archive.py`)
already tests against, rather than re-deriving gate specs by hand, so it cannot reintroduce that
exact bug: a gzip fixture fed through the real decode path decodes before any gate reads it.

This script never invents a "known-bad" capture. Every fixture it measures is one already
committed to `_build/holdfast-archive/artifacts/`, and it reports, per fixture, whether it is a
REAL CAPTURE (fetched from the live Wayback Machine and checked into the repo verbatim), a
SYNTHETIC negative (built by hand to be gate-B-passing and gate-C/D-failing, and labelled as
such in the fixture name), or a MALFORMED / CONTROL case (oversize, truncated, empty index,
inexact timestamp) that exercises a refusal path rather than a gate.

    python scripts/measure-gates.py            # writes evidence/gate-measurements.json
    python scripts/measure-gates.py --check     # verifies the file matches; exit 1 on drift
"""

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# _build/holdfast-archive/ is committed inside this repo, precisely so a fresh clone and CI can
# run this without a workspace this repo does not own. Matches SUITE_DIR in
# scripts/splice_archive.py.
SUITE_DIR = str(ROOT / "_build" / "holdfast-archive")
OUT = ROOT / "evidence" / "gate-measurements.json"


def load_suite():
    if SUITE_DIR not in sys.path:
        sys.path.insert(0, SUITE_DIR)
    for stale in ("archive", "test_archive"):
        sys.modules.pop(stale, None)
    import archive
    import test_archive
    return archive, test_archive


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def measure_payload(archive_mod, ta, name, timestamp, source_type, gate_declared=True):
    """One fixture through the real `admit_snapshot` path, as the contract would see it.

    `gate_declared=False` is snap-gcp-deprecation-incomplete.bin: no anchor, sections or
    terminal are declared anywhere in this project for that page, so it is decoded and
    digest-checked like every other capture but scored against a borrowed spec
    (GITHUB's, the same stand-in the offline suite itself uses) purely to exercise the
    decode path. Its gate fields are not a claim about that page and are marked as such.
    """
    raw = ta.fixture(name)
    spec = ta.spec_for(name) if gate_declared else ta.spec_for(ta.GITHUB)
    digest = archive_mod.cdx_digest(raw)
    # "n/a" marks a fixture with no real Wayback timestamp (the synthetic negative); the real
    # test suite omits the argument entirely for it rather than passing the literal string.
    admit_timestamp = None if timestamp == "n/a" else timestamp
    result = archive_mod.admit_snapshot(raw, digest, spec, timestamp=admit_timestamp)
    if archive_mod.is_refusal(result):
        return {
            "fixture": name, "source_type": source_type, "timestamp": timestamp,
            "raw_sha256": sha256_hex(raw), "raw_bytes": len(raw),
            "refused": True, "refusal_tag": result.tag, "refusal_reason": result.reason,
        }
    q = result.qualification
    entry = {
        "fixture": name,
        "source_type": source_type,
        "timestamp": timestamp,
        "raw_sha256": sha256_hex(raw),
        "raw_bytes": len(raw),
        "decoded_sha256": result.decoded_sha256,
        "decoded_bytes": len(result.decoded),
        "encoding": result.encoding,
        "digest_state": result.digest_state,
        "gate_declared": gate_declared,
        "gate_a": q.gate_a,
        "gate_a_ratio": q.gate_a_ratio,
        "gate_b": q.gate_b,
        "gate_c_hits": q.gate_c_hits,
        "gate_c_total": q.gate_c_total,
        "gate_c": q.gate_c,
        "gate_d": q.gate_d,
        "qualified": q.qualified,
        "text_len": q.text_len,
    }
    if not gate_declared:
        entry["note"] = (
            "No anchor/sections/terminal is declared for this page in this project. Scored "
            "against a borrowed spec purely to exercise decode and digest; gate_a/b/c/d and "
            "qualified above are not a claim about this page."
        )
    return entry


def measure_control(name, timestamp, disposition, note):
    """A refusal-path control that never reaches a gate: recorded for completeness, not scored."""
    return {
        "fixture": name, "source_type": "CONTROL", "timestamp": timestamp,
        "disposition": disposition, "note": note,
    }


def build():
    archive_mod, ta = load_suite()

    gated_real_captures = [
        (ta.GITHUB, ta.TS_GITHUB),
        (ta.AWS, ta.TS_AWS),
        (ta.GCP_TERMS, ta.TS_GCP_TERMS),
        (ta.OPENAI_GZIP, ta.TS_OPENAI_GZIP),
        (ta.OPENAI_IDENTITY, ta.TS_OPENAI_IDENTITY),
    ]
    fixtures = [measure_payload(archive_mod, ta, name, ts, "REAL CAPTURE")
                for name, ts in gated_real_captures]
    fixtures.append(measure_payload(archive_mod, ta, ta.GCP_DEPRECATION, ta.TS_GCP_DEPRECATION,
                                    "REAL CAPTURE", gate_declared=False))
    fixtures.append(measure_payload(archive_mod, ta, ta.CHROME_ONLY, "n/a", "SYNTHETIC"))
    fixtures.append(measure_control(
        ta.OVERSIZE, ta.TS_OVERSIZE, "REFUSED (cdx-length-cap)",
        "Real identity capture, admitted as a pinned baseline; refused when offered as a "
        "change point at its real CDX length (over the 250,000 byte index-length cap). "
        "Exercises the size-cap refusal path, not a gate."))
    fixtures.append(measure_control(
        "cdx-never-archived", "n/a", "REFUSED ([EXTERNAL] cdx-empty)",
        "A CDX index that answers 200 with an empty array: the URL was never archived. "
        "Exercises the missing-data refusal path, not a gate."))
    fixtures.append(measure_control(
        "snap-inexact-timestamp", ta.TS_INEXACT, "REFUSED ([EXTERNAL] redirect, not followed)",
        "A timestamp one second off a real capture, answered with a 302. The exact-timestamp "
        "rule refuses rather than following the redirect. Exercises the inexact-timestamp "
        "refusal path, not a gate."))

    scored = [f for f in fixtures if f.get("source_type") in ("REAL CAPTURE", "SYNTHETIC")
              and not f.get("refused") and f.get("gate_declared", True)]
    real_qualified = [f for f in scored if f["source_type"] == "REAL CAPTURE" and f["qualified"]]
    real_deficient_true_positives = [
        f for f in scored if f["source_type"] == "REAL CAPTURE" and not f["qualified"]
    ]
    synthetic_negatives = [f for f in scored if f["source_type"] == "SYNTHETIC" and not f["qualified"]]

    real_with_gate = [f for f in fixtures if f["source_type"] == "REAL CAPTURE"
                      and f.get("gate_declared", True) and not f.get("refused")]
    summary = {
        "realCapturesMeasured": len([f for f in fixtures if f["source_type"] == "REAL CAPTURE"]),
        "realCapturesWithADeclaredGate": len(real_with_gate),
        "realCapturesQualified": len(real_qualified),
        "realDeficientCaptureTruePositives": len(real_deficient_true_positives),
        "syntheticNegativesMeasured": len([f for f in fixtures if f["source_type"] == "SYNTHETIC"]),
        "syntheticNegativesCorrectlyRejected": len(synthetic_negatives),
        "controlsMeasured": len([f for f in fixtures if f["source_type"] == "CONTROL"]),
        "honestStatement": (
            "Every real capture in this project's fixture set qualifies once decoded. Gates B, "
            "C and D have 0 measured true positives against a real deficient archive capture: "
            "no such document has been captured. The one synthetic negative "
            "(snap-github-tos-chrome-only.bin) demonstrates that gate C and gate D can and do "
            "reject a document that passes gate B but lacks the required sections and terminal "
            "marker; it is not a claim about a real page. Gate A is disabled by default "
            "(GATE_A_ENABLED_DEFAULT = False in contracts/Holdfast.py) after one measured "
            "false-rejection: cloud.google.com/terms/deprecation went from 2,738 to 35,689 "
            "extracted characters, a 13x inflation from an SPA chrome rebuild with no policy "
            "change, which a length floor would have rejected as the faithful capture."
        ),
    }

    return {
        "$comment": (
            "Generated by scripts/measure-gates.py from the fixtures in "
            "_build/holdfast-archive/artifacts/, run through the same archive.admit_snapshot "
            "the contract embeds. Re-run with --check to verify this file has not drifted from "
            "the fixtures or the gate logic. No entry here is invented: every REAL CAPTURE was "
            "fetched from the live Wayback Machine and is byte-identical to what is committed; "
            "every SYNTHETIC entry is labelled and was built by hand as a negative control."
        ),
        "summary": summary,
        "fixtures": fixtures,
    }


def main():
    check = "--check" in sys.argv
    doc = build()
    rendered = json.dumps(doc, indent=2, sort_keys=False) + "\n"

    if check:
        if not OUT.exists():
            print("evidence/gate-measurements.json does not exist. Run without --check first.")
            return 1
        current_doc = json.loads(OUT.read_text(encoding="utf-8"))
        if json.dumps(current_doc, indent=2, sort_keys=False) + "\n" != rendered:
            print("evidence/gate-measurements.json is stale relative to the fixtures/gate logic.")
            print("Run: python scripts/measure-gates.py")
            return 1
        print("evidence/gate-measurements.json matches a fresh measurement.")
        print("  real captures qualified:            %d/%d (of those with a declared gate)"
              % (doc["summary"]["realCapturesQualified"],
                 doc["summary"]["realCapturesWithADeclaredGate"]))
        print("  real deficient-capture true positives: %d"
              % doc["summary"]["realDeficientCaptureTruePositives"])
        print("  synthetic negatives correctly rejected: %d/%d"
              % (doc["summary"]["syntheticNegativesCorrectlyRejected"],
                 doc["summary"]["syntheticNegativesMeasured"]))
        return 0

    OUT.write_text(rendered, encoding="utf-8")
    print("wrote %s" % OUT.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
