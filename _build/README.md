# `_build/`: scratch and evidence, not a source of truth

Everything in this directory is a working artifact from development: raw CLI transcripts,
probe scripts, and the standalone `holdfast-archive/` module Holdfast's contract embeds. None
of it is authoritative for what is currently deployed.

## HISTORICAL / SUPERSEDED DEPLOYMENT ARTIFACTS

The following files are raw, unedited CLI transcripts captured against an earlier,
**superseded** deployment at `0x4Acdca77b8270488AF0CDdf50D13Ba86a19B690C`:

- `hf-deploy.txt`
- `hf-verify-deploy.txt`
- `hf-bond-1.txt`
- `hf-sim-zero.txt`

That address is not the canonical deployment and is not referenced anywhere in the live
application. These files are kept, unedited, as raw provenance of that earlier deployment
existing and behaving as described at the time, the same reason superseded entries are kept
in `DEPLOYMENT.json`'s own history rather than deleted. They are not rewritten here, so that
their value as a raw, unedited transcript is preserved.

**Canonical deployment is defined only by `DEPLOYMENT.json`** (repository root), independently
verifiable with `npm run verify:deployment` and `npm run verify:schema`. If any file under
`_build/` disagrees with `DEPLOYMENT.json` about which address is current, `DEPLOYMENT.json` is
correct and the file under `_build/` is outdated scratch output.
