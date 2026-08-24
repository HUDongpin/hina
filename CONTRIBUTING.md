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
browser E2E, dependency/license audit, and secret scan all pass. The release
version must agree across `package.json`, the root entries in `package-lock.json`,
`CITATION.cff`, exported workbook metadata, the Git tag, and the corresponding
[CHANGELOG.md](./CHANGELOG.md) entry. The changelog and `UPSTREAM.md` must state
whether the scientific baseline changed.

Immediately before publication, the release preflight must query the exact npm
version. Only an explicit Registry `E404` proves that the version is unpublished;
authentication, authorization, network, timeout, or other Registry failures stop
the release.

Publishing requires the repository Owner to confirm GitHub and npm identities and
approve the protected `npm` environment. npm account 2FA protects the Owner's
interactive npm administration; it is not an OTP input to the workflow. Current
and future releases authenticate only through short-lived GitHub Actions OpenID
Connect Trusted Publishing. Do not provide the workflow with `NPM_TOKEN`, an OTP,
or a recovery code, and do not add a long-lived registry credential to the
repository or protected environment. Follow [docs/RELEASE.md](./docs/RELEASE.md)
for the parameterized release procedure and the separately labeled `v0.1.0`
historical receipt.
