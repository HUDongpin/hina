# Changelog

All notable changes to `hina-js` are documented in this file. The project uses
[Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-08-24

Published artifacts: [GitHub Release](https://github.com/HUDongpin/hina/releases/tag/v0.1.1)
and [npm](https://www.npmjs.com/package/hina-js/v/0.1.1).

### Changed

- Removed the one-time `NPM_TOKEN` bootstrap bridge from the release workflow
  and deleted its local publish wrapper.
- Restricted all subsequent npm releases to GitHub Actions OIDC Trusted
  Publishing with npm provenance.
- Made the release preflight fail closed: only an explicit npm `E404` proves
  that an exact version is unpublished; network, authentication, and Registry
  failures now stop the release.
- Updated package, citation, workbook metadata, English and Chinese
  documentation, and package verification for version `0.1.1`.

### Fixed

- Kept browser-export Blob URLs alive until downloads have started, improving
  JSON, PNG, and XLSX export reliability in Chromium and other browsers.

### Security

- Recorded that the `v0.1.0` bootstrap token was removed from the protected
  GitHub Environment and revoked at npm after Trusted Publishing was enabled.
- Kept the protected `npm` Environment and GitHub-hosted runner as mandatory
  release boundaries; no long-lived npm credential is accepted by the
  workflow.

## [0.1.0] - 2026-08-24

- Initial public TypeScript release of HINA, pinned to upstream commit
  `f7bb3df3609aa6b0b6d5c98108e940f662053bb5`.
- Added JSON-safe bipartite and tripartite construction, individual metrics,
  significant-edge pruning, deterministic MDL communities, cosine projection,
  deterministic layouts, CSV/XLSX I/O, serialization, and the React workbench.
- Added Python oracle fixtures, scientific parity tests, package boundaries,
  Next.js 16 integration, and real Chromium E2E coverage.

[0.1.1]: https://github.com/HUDongpin/hina/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/HUDongpin/hina/releases/tag/v0.1.0
