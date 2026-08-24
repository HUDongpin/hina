# Release runbook

## Fail-closed preflight

1. Confirm the intended version, a clean `main`, and that the GitHub repository
   is public. npm provenance for a public package requires a public source
   repository.
2. Re-authenticate GitHub CLI and npm as the `HUDongpin` Owner, and complete
   required 2FA or protected-environment approval.
3. Query `hina-js` again. If another owner has claimed the name, stop; do not
   publish under a substitute name without an explicit product decision.
4. Run `npm ci`, `npm run data:check`, `npm run check`, `npm run test:next`, and
   browser E2E on the exact release commit.
5. Inspect `npm pack --json`, `publint`, and Are The Types Wrong output. Verify
   the tarball against this exact public allowlist:

   - `package.json`, `README.md`, `README.zh-CN.md`, `LICENSE`,
     `LICENSE.upstream`, `NOTICE.md`, `SECURITY.md`, `CITATION.cff`,
     `UPSTREAM.md`, and `docs/PARITY.md`;
   - the four reviewed files under `examples/data/`; and
   - generated `.js`, `.cjs`, source-map, declaration, and CSS artifacts under
     `dist/`.

   No Python environment, site fixture, credential, screenshot, cache, source,
   test, script, CI configuration, release runbook, or unrelated large file may
   be present. `scripts/verify-package.mjs` enforces this list against the real
   tarball.

## Trusted-publisher configuration

The protected release job runs on GitHub-hosted Ubuntu with Node 24 and npm
11.16.0 (newer than npm's minimum trusted-publishing requirement of 11.5.1).
It grants only `contents: read` and `id-token: write`, disables dependency
caching for the release job, pins every third-party Action to a complete commit
SHA, and publishes with provenance.

After the first npm name-claim, configure the `hina-js` Trusted Publisher with
values that exactly match the repository and workflow:

- provider: GitHub Actions;
- organization or user: `HUDongpin`;
- repository: `hina`;
- workflow filename: `release.yml` (filename only);
- environment: `npm`; and
- allowed action: `npm publish`.

Then delete the protected environment's `NPM_TOKEN`, revoke the npm automation
token, and set npm package publishing access to require 2FA while disallowing
tokens. Subsequent releases must authenticate only through the short-lived OIDC
identity. Do not replace the GitHub-hosted runner with a self-hosted runner.

## First release

The Owner creates the public `HUDongpin/hina` repository, enables required
status checks and branch protection, and approves the protected `npm`
environment. A one-time minimal npm granular token may be used only to establish
the first package publication with `--access public --provenance`; delete it
immediately after configuring GitHub Actions as the package's Trusted Publisher.
The workflow can read that fallback secret only for the `v0.1.0` tag; later
release tags receive an empty token even if the secret was mistakenly retained.

Create `v0.1.0` from the same commit as GitHub `main`. The release workflow must
verify that the tag and `package.json` version match before npm publication. Do
not create the GitHub Release until CI has passed for that exact commit.

## Post-publication proof

From a new temporary directory, install `hina-js@0.1.0` from the public registry
and repeat ESM, CommonJS, declaration, browser, Edge, and Next production-build
smoke tests. Confirm:

- GitHub default branch and Release resolve to the same commit.
- npm provenance, repository URL, license, version, and declaration links.
- `npm view hina-js@0.1.0` returns the expected metadata.
- `npm audit signatures` verifies registry signatures and provenance.
- The public tarball allowlist is identical to the reviewed local package.

If any identity, scientific, package, Next, browser, provenance, hash, or
licensing check fails, do not publish or promote the release.

## Authoritative references

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance generation and verification](https://docs.npmjs.com/generating-provenance-statements/)
- [GitHub Actions secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use)
