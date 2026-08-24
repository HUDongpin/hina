# Notices and attribution

`hina-js` is an independent TypeScript port of the Heterogeneous Interaction
Network Analysis (HINA) software. It is not an official JavaScript release of
the SHF-NAILResearchGroup and does not imply endorsement by the original
authors.

The scientific behavior was ported from:

- Repository: <https://github.com/SHF-NAILResearchGroup/HINA>
- Pinned source commit: `f7bb3df3609aa6b0b6d5c98108e940f662053bb5`
- Authors: Shihui Feng, Baiyue He, and Alec Kirkley
- Software archive DOI: <https://doi.org/10.5281/zenodo.15940278>
- JOSS article DOI: <https://doi.org/10.21105/joss.08299>

The upstream license is preserved verbatim in `LICENSE.upstream`. The
TypeScript implementation and documentation added in this repository are
licensed under the repository's `LICENSE` file.

The port intentionally replaces Python-specific container shapes and
non-deterministic ordering with immutable-by-contract, JSON-safe objects and
stable tie-breaking. See `UPSTREAM.md` for the complete compatibility policy.
