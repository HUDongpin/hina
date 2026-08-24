# Upstream scientific baseline

## Fixed source

- Project: [SHF-NAILResearchGroup/HINA](https://github.com/SHF-NAILResearchGroup/HINA)
- Commit: [`f7bb3df3609aa6b0b6d5c98108e940f662053bb5`](https://github.com/SHF-NAILResearchGroup/HINA/tree/f7bb3df3609aa6b0b6d5c98108e940f662053bb5)
- Python package version in `setup.py`: `0.7.2`
- Version in upstream `CITATION.cff`: `1.4`

The pinned source code, its tests, and the cited HINA equations are the
scientific baseline. The live `main` branch and the live HINA website are not
used as unpinned CI dependencies.

## API mapping

| Python | TypeScript |
| --- | --- |
| `get_bipartite` | `createBipartiteGraph` |
| `get_tripartite` | `createTripartiteGraph` |
| `quantity` | `analyzeQuantity` |
| `diversity` | `analyzeDiversity` |
| `prune_edges` | `pruneEdges` |
| `hina_communities` | `detectCommunities` |
| `plot_hina` | `layoutGraph` and `HinaNetwork` |
| `plot_hina_projection` | `projectGraph` and `HinaNetwork` |
| `plot_bipartite_clusters` | `detectCommunities` and `HinaNetwork` |
| `save_network` | `serializeGraph` or `hina-js/node` |

Only the camelCase TypeScript names are public API. Python names are shown for
migration guidance and are not exported as aliases.

## Compatibility policy

For valid, unambiguous input, numerical results follow the pinned Python
implementation. TypeScript intentionally changes the following Python-specific
or unsafe behaviors:

- Public graphs and results are JSON-safe objects and arrays, never NetworkX,
  pandas, `Map`, `Set`, tuple-key dictionaries, or cyclic objects.
- Node IDs include partition and scalar type, preventing cross-partition and
  numeric/string collisions.
- Tripartite composite nodes use structured components instead of `**` as an
  internal delimiter. The legacy joined string remains a display label only.
- Attribute conflicts fail by default; callers can explicitly request `first`
  or `last` compatibility behavior.
- Empty and single-edge pruning return the same result type as all other
  inputs.
- Invalid partitions and parameter ranges raise `HinaValidationError` rather
  than silently returning an empty answer.
- Diversity is defined as zero when there are zero or one categories.
- Community tie-breaking and labels are deterministic.
- Analyses do not mutate their input graph.
- Randomized layouts use an explicit seed and a fixed default.

## Numerical comparison rules

- Nodes, edges, integer counts, binomial thresholds and pruned edge sets:
  exact equality.
- Normalized quantity, diversity and cosine similarity:
  `abs(actual-reference) <= 1e-12 + 1e-10 * abs(reference)`.
- MDL description lengths and compression ratios: absolute error at most
  `1e-10` and relative error at most `1e-9`.
- Communities are compared by co-membership rather than arbitrary numeric
  labels.
- Layouts are checked for finite coordinates, invariant topology and exact
  repeatability for the same seed; they are not pixel-compared to Matplotlib.
