# Holdfast

Archived-web commitment bonds. The promisor stakes their own published promise.

Built on GenLayer as a single Intelligent Contract plus a Next.js client. There is no
backend, no database, no indexer and no scheduled worker: every piece of evidence is
fetched inside consensus by the contract itself, and every state transition is a button
anyone may press.

Specification: `../genlayer-prds/06-holdfast.md`
Design system: `../genlayer-prds/design-systems.md`

## Status

Release candidate surface: the Holdfast contract, fixture archive reader, lifecycle rail, injected
wallet controls, bond creation/contest/settlement flows, and direct/frontend regression suites are
wired. Live deployment checks remain environment-bound until a contract address is configured.

## Layout

```
contracts/Holdfast.py     the whole product
src/app                     Next.js routes
src/components              interface
src/lib/genlayer            client plumbing, shared across the three builds
tests/direct                contract tests, run with pytest on gltest
tests/e2e                   Playwright, run against the deployed origin
```

## Verify

```
npm run verify
```

Runs the frontend unit tests, the contract tests, the em dash check, the type check, the
linter and the production build, in that order.

There is a second, faster test layer that does not run in CI. `_build/harness/` in the parent
workspace loads the contract against a stub SDK and replays captured HTTP responses off disk,
so a consensus path can be exercised in milliseconds without a node. It lives outside this
repository because it is shared by every build in the set.

```
python ../_build/harness/run.py holdfast
```
