# Release runbook

This runbook applies to `v0.1.1` and every later release. The completed `v0.1.0`
bootstrap is recorded separately at the end and is not a reusable publishing
procedure.

## Authentication boundary

Current and future npm publication uses only GitHub Actions OpenID Connect (OIDC)
Trusted Publishing. The npm Trusted Publisher identity must exactly match:

- provider: GitHub Actions;
- organization or user: `HUDongpin`;
- repository: `hina`;
- workflow filename: `release.yml` (filename only);
- environment: `npm`; and
- allowed action: `npm publish`.

The protected `npm` GitHub Environment requires Owner review and is limited to
release tags matching `v*`. Its former `NPM_TOKEN` secret has been deleted, and
the corresponding bootstrap token has been revoked at npm. The release workflow
must not accept a registry token, OTP, or recovery code. npm account 2FA remains
an Owner-side protection for interactive npm administration; GitHub Environment
approval and npm 2FA are separate controls, neither of which is a credential to
place in workflow input or logs.

The release job runs on GitHub-hosted Ubuntu with Node 24 and npm 11.16.0. It
grants only `contents: read` and `id-token: write`, disables dependency caching,
pins every third-party Action to a complete commit SHA, and publishes with
provenance. Do not replace it with a self-hosted runner.

## Prepare `v<version>`

1. Confirm the intended `<version>`, a clean `main`, and that the public GitHub
   repository is the source named in `package.json`.
2. Confirm the version agrees across `package.json`, both root version entries in
   `package-lock.json`, `CITATION.cff`, exported workbook metadata,
   `CHANGELOG.md`, and the proposed `v<version>` tag. Confirm `CITATION.cff` has
   the intended release date.
3. Confirm `CHANGELOG.md` and the release mapping in `UPSTREAM.md` state whether
   the scientific baseline changed. A baseline change additionally requires
   reviewed fixture regeneration and numerical-difference evidence.
4. Run `npm ci`, `npm run data:check`, `npm run check`, `npm run test:next`, and
   browser E2E on the exact proposed release commit.
5. Run the release preflight for `v<version>`. Only an explicit npm Registry
   `E404` proves that `hina-js@<version>` is unpublished. Authentication,
   authorization, network, timeout, malformed-response, or other Registry errors
   must fail closed.
6. Inspect `npm pack --json`, `publint`, and Are The Types Wrong output. Verify
   the tarball against this exact public allowlist:

   - `package.json`, `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `LICENSE`,
     `LICENSE.upstream`, `NOTICE.md`, `SECURITY.md`, `CITATION.cff`,
     `UPSTREAM.md`, and `docs/PARITY.md`;
   - the four reviewed files under `examples/data/`; and
   - generated `.js`, `.cjs`, source-map, declaration, and CSS artifacts under
     `dist/`.

   No Python environment, site fixture, credential, screenshot, cache, source,
   test, script, CI configuration, release runbook, or unrelated large file may
   be present. `scripts/verify-package.mjs` enforces this list against the real
   tarball.
7. Push the reviewed commit and wait for every required branch-protection check.
   Create `v<version>` from that exact `main` commit, then publish the GitHub
   Release for that tag. Do not move or recreate a release tag.

## OIDC publication

Publishing the GitHub Release triggers `release.yml`. The protected job must:

1. check out the immutable release tag;
2. verify the tag, package identity, synchronized version, changelog, and exact
   npm-version availability;
3. repeat the scientific, package, Next.js, browser, license, audit, and secret
   gates; and
4. call `npm publish --access public --provenance` using only the OIDC identity.

The workflow must not contain a token fallback. A prompt for npm OTP, an `EOTP`
failure, a missing OIDC claim, or an npm authorization error means publication
failed. Do not switch to a token or manually promote the GitHub run as green.

## Post-publication proof

From a new temporary directory, install `hina-js@<version>` from the public
registry and repeat ESM, CommonJS, declaration, browser, Edge, and Next
production-build smoke tests. Confirm:

- GitHub `main`, tag `v<version>`, and the GitHub Release resolve to the same
  commit.
- `npm view hina-js@<version>` returns the intended version, repository, license,
  engines, exports, and declaration links.
- npm displays valid GitHub Actions provenance for the public package.
- `npm audit signatures` verifies registry signatures and provenance.
- Registry tarball shasum/integrity and contents match the reviewed release
  artifact and public allowlist.
- The npm version and GitHub Release are linked from `CHANGELOG.md`.

If any identity, scientific, package, Next, browser, provenance, hash, or
licensing check fails, do not promote the release. Preserve the evidence and
prepare a new version; npm versions and Git tags are immutable.

## Historical receipt: `v0.1.0`

`hina-js@0.1.0` was the initial public name claim on 2026-08-24. GitHub `main`,
tag `v0.1.0`, and the
[GitHub Release](https://github.com/HUDongpin/hina/releases/tag/v0.1.0) resolve to
commit `06905a995b6a8a2c85345e54668ff8e6364c1bb0`; the package is public on
[npm](https://www.npmjs.com/package/hina-js/v/0.1.0).

The final GitHub Actions release attempt for `v0.1.0` ended red with npm `EOTP`.
It is a failed token-authenticated workflow attempt, not evidence that Trusted
Publishing succeeded. The subsequently public package was checked against the
same reviewed `v0.1.0` source/artifact, and npm exposes valid GitHub Actions
provenance for that public artifact. Artifact and provenance consistency does
not retroactively turn the red Actions run into a successful Trusted Publisher
run.

After the bootstrap, the `NPM_TOKEN` GitHub Environment secret was deleted and
the token was revoked at npm. The fallback was retired rather than carried into
`v0.1.1`. Therefore `v0.1.1` and later releases must establish their own green,
OIDC-only Trusted Publishing evidence; they cannot inherit a success claim from
the red `v0.1.0` run.

## Authoritative references

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance generation and verification](https://docs.npmjs.com/generating-provenance-statements/)
- [GitHub Actions secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use)
