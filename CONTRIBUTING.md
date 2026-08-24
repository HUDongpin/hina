# Contributing

## Local checks

Use Node.js `20.9`, `22`, or `24` and install from the lockfile:

```bash
npm ci
npm run data:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:package
npm run test:next
```

Do not update the scientific baseline implicitly. A baseline change requires a
separate reviewed change to the pinned commit in `UPSTREAM.md`, regenerated
fixtures, and an explanation of every changed result.

## Python oracle

Daily tests read committed JSON fixtures and do not require Python. To regenerate
them, use Python 3.11, SciPy, pandas, and NetworkX with the exact upstream commit
`f7bb3df3609aa6b0b6d5c98108e940f662053bb5`; follow `docs/PARITY.md`. Generate
under `PYTHONHASHSEED=0`, `1`, and `42`, normalize ordering and arbitrary cluster
labels, then review the fixture diff. Community parity is based on co-membership,
not the numeric label selected by Python.

## Changes to public data

The practice source workbook is an explicitly publishable exercise dataset.
Never replace or edit it silently. `npm run data:check` must continue to verify
its SHA-256, exact headers, exact range, 174 source rows, 391 positive
interactions, and 12 all-zero actor/lesson rows.

## Release gates

A release is allowed only when lint, strict type checking, parity/property/unit
tests, build, package boundary checks, a tarball-installed Next production build,
browser E2E, dependency/license audit, and secret scan all pass. The npm package
name must be queried again immediately before first publication.

Publishing requires the repository Owner to confirm GitHub and npm identities,
approve the protected `npm` environment, and complete npm 2FA. Workflows use
short-lived OpenID Connect trusted publishing after initial setup; no long-lived
registry token belongs in the repository.
