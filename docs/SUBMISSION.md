# Holdfast submission record

## Thesis and boundary

Holdfast lets a promisor bond a precise claim against a dated archived web capture. GenLayer is
necessary because archive retrieval and document interpretation are external facts. Deterministic
code owns byte limits, archive-index admission, digest/length gates, deadlines, contests,
settlement and bond accounting. Consensus fetches the cited archive records and, only after the
contract admits the bytes, may interpret the bounded text. Archive availability is not treated as
a breach.

## Repository and deployment status

Live app: https://holdfast-o8fxw1xzl-delealufejoel-4184s-projects.vercel.app

The fixture corpus is self-contained under `tests/fixtures/holdfast/`; `scripts/verify_fixtures.py`
re-derives its manifest from those bytes. Any address in `DEPLOYMENT.json` is canonical only when
its finalized receipt, schema and byte-for-byte source parity match the final Git commit. The
canonical deployment is `0x0D656F1A319Dad705eeE9CF25045CF22a05776B9`, transaction
`0x19543305c177b30e8fd5308d26256eb24416d6994e1bde659fa68037bb17f07e`; payable live exercises
remain limited and are labelled in the evidence record.

## Verification

```text
npm ci
npm run verify
python scripts/verify_fixtures.py
python -m pytest tests/direct -q
npm run verify:deployment
npm run verify:schema
```

The direct state machine, archive failure gates, malformed captures and value branches are
**PROVEN DIRECT**. Bond creation, admission, contest, expiry and settlement are **PROVEN LIVE**
only when listed with finalized transaction identifiers and stored state in the evidence record.
The invariant is `total_bonded = open obligations + settled payouts + refunded payouts` and the
contract has no hidden sweep authority.

## Reviewer walkthrough

1. Run the fixture verifier and inspect the manifest/byte checks.
2. Read `contracts/Holdfast.py` around the strict archive blocks and settlement paths.
3. Run frontend and Direct Mode suites from a clean clone.
4. Run deployment, schema and evidence verification; retain **NOT PROVEN** labels for any branch
   requiring a naturally occurring real-world breach.
