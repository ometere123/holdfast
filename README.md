# Holdfast

Archived-web commitment bonds. The promisor stakes their own published promise.

Built on GenLayer as a single Intelligent Contract plus a Next.js client. There is no
backend, no database, no indexer and no scheduled worker: every piece of evidence is
fetched inside consensus by the contract itself, and every state transition is a button
anyone may press.

Submission record: [`docs/SUBMISSION.md`](docs/SUBMISSION.md)

## Status

Current status: the Holdfast contract, fixture archive reader, lifecycle rail, injected wallet
controls, bond creation/contest/settlement flows, direct/frontend regression suites, and served-build
browser checks are wired. Canonical StudioNet deployment:
`0x0D656F1A319Dad705eeE9CF25045CF22a05776B9` (finalized, GenVM SUCCESS, source/schema parity
recorded). Representative payable live exercises remain explicitly limited in the evidence record.
Live app: https://holdfast-o8fxw1xzl-delealufejoel-4184s-projects.vercel.app

## Layout

```
contracts/Holdfast.py     the whole product
src/app                     Next.js routes
src/components              interface
src/lib/genlayer            client plumbing, shared across the three builds
tests/direct                contract tests, run with pytest on gltest
tests/e2e                   Playwright, run against a served production build (or E2E_BASE_URL)
```

## Verify

```
npm run verify
```

Runs frontend tests, Direct Mode, fixture checks, typecheck, lint and the production build.
Browser checks are run separately with `npm run test:e2e` after a production build.

The repository is self-contained; Direct Mode and the archive corpus live under `tests/` and do
not require a workspace sibling.
