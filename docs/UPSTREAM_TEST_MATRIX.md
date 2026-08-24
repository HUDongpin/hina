# Upstream test coverage matrix

This matrix audits every pytest test item in the fixed scientific baseline,
[SHF-NAILResearchGroup/HINA at `f7bb3df3609aa6b0b6d5c98108e940f662053bb5`](https://github.com/SHF-NAILResearchGroup/HINA/tree/f7bb3df3609aa6b0b6d5c98108e940f662053bb5),
against the `hina-js` test and integration gates.

## Count and interpretation

The pinned tree contains exactly nine `test_*.py` files and 47 top-level
`test_*` functions. There are no `pytest.mark.parametrize` decorators, so the
static function count is also the normal pytest item count. Several functions
exercise more than one branch—for example four quantity return modes, four
layouts, or both extreme alpha values—so 47 is the executable test-item count,
not the number of individual `assert` statements.

| Upstream area | Files | pytest items |
| --- | ---: | ---: |
| Construction | 1 | 4 |
| Individual quantity/diversity | 2 | 5 |
| Dyadic pruning | 1 | 10 |
| Mesoscale communities | 1 | 5 |
| Graph saving utilities | 1 | 4 |
| Matplotlib visualization | 1 | 7 |
| Dashboard utility layer | 1 | 7 |
| FastAPI endpoint layer | 1 | 5 |
| **Total** | **9** | **47** |

Statuses in the matrix mean:

- **DIRECT** — the corresponding scientific or portable behavior has a direct
  Vitest/golden/property assertion.
- **REPLACED** — the upstream dashboard or Matplotlib surface is intentionally
  replaced by local I/O, Cytoscape/React, package, Playwright, or Next.js
  integration tests that assert the same user outcome.
- **DIFFERENCE** — the Python behavior is intentionally not copied; an explicit
  test asserts the safer TypeScript contract.

The final classification is 30 DIRECT, 13 REPLACED, four DIFFERENCE, and zero
unclassified or uncovered upstream items.

## Construction — 4/4

| # | Upstream pytest item | Behavior | `hina-js` evidence | Status |
| ---: | --- | --- | --- | --- |
| 1 | [`test_get_bipartite`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/construction/tests/test_network_construct.py#L8) | Bipartite nodes, partitions, group/object attributes and unit edges | [`construction.test.ts`](../tests/construction.test.ts), “builds the upstream weighted graph…”; complete 391-row graph in [`sample-data.test.ts`](../tests/sample-data.test.ts) | DIRECT |
| 2 | [`test_get_tripartite`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/construction/tests/test_network_construct.py#L50) | Student-to-joint-object graph, group metadata and edge weights | `construction.test.ts`, “uses structured joint values while retaining the legacy display label”; full tripartite golden graph | DIRECT |
| 3 | [`test_bipartite_edges`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/construction/tests/test_network_construct.py#L93) | Drop empty/NaN students, warn, convert missing object to the `NA` display value | `construction.test.ts`, “drops empty individuals and normalizes other missing cells to NA” | DIRECT |
| 4 | [`test_tripartite_edges`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/construction/tests/test_network_construct.py#L110) | Mixed numeric/string/boolean components, missing component, empty student | `construction.test.ts`, “preserves mixed scalar components and normalizes missing values” | DIRECT |

The TypeScript graph retains typed scalar values internally. Thus a missing
tripartite component is `null` in `node.value` and displays as `NA`; booleans
remain booleans and display with Python-compatible `True`/`False`. This is a
stronger, JSON-safe representation of the same visible construction result.

## Individual analysis — 5/5

| # | Upstream pytest item | Behavior | `hina-js` evidence | Status |
| ---: | --- | --- | --- | --- |
| 5 | [`test_quantity`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/individual/tests/test_quantity.py#L32) | Raw/global-normalized/category/group-normalized quantities | [`individual.test.ts`](../tests/individual.test.ts), “matches the upstream raw, normalized, category and group values”; 391-row oracle comparison | DIRECT |
| 6 | [`test_quantity_return_types`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/individual/tests/test_quantity.py#L61) | Four string-selected partial return dictionaries | `individual.test.ts` verifies all fields in the uniform `QuantityResult`; `analyzeIndividuals` verifies the combined table form | DIFFERENCE |
| 7 | [`test_diversity`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/individual/tests/test_diversity.py#L32) | Attribute-based normalized Shannon entropy and actor coverage | `individual.test.ts`, “matches normalized Shannon entropy by object attribute” | DIRECT |
| 8 | [`test_diversity_without_attr`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/individual/tests/test_diversity.py#L47) | Object nodes themselves form the diversity universe | `individual.test.ts`, “uses the global object-node count when no attribute is selected” | DIRECT |
| 9 | [`test_diversity_with_zero_weight_edges`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/individual/tests/test_diversity.py#L66) | Zero-weight actor remains present with diversity zero | `individual.test.ts`, “keeps zero-weight and one-category results finite” | DIRECT |

`hina-js` does not expose Python's `return_type` string switch. One stable
JSON-safe result contains every requested metric, and consumers select the
field they need. This avoids call-dependent return shapes without changing any
quantity value.

## Dyadic pruning — 10/10

| # | Upstream pytest item | Behavior | `hina-js` evidence | Status |
| ---: | --- | --- | --- | --- |
| 10 | [`test_prune_edges_no_fixing`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/dyad/tests/test_significant_edges.py#L30) | Unconstrained binomial null model and full significant set | [`dyad.test.ts`](../tests/dyad.test.ts), “matches the upstream unconstrained and fixed-degree examples” | DIRECT |
| 11 | [`test_prune_edges_fix_student`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/dyad/tests/test_significant_edges.py#L54) | Degree-fixed actor partition | Same direct dyad test; fixed-actor 391-row SciPy fixture | DIRECT |
| 12 | [`test_prune_edges_fix_object`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/dyad/tests/test_significant_edges.py#L77) | Degree-fixed object partition | Same direct dyad test verifies all edges and per-object thresholds | DIRECT |
| 13 | [`test_prune_edges_stricter_alpha`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/dyad/tests/test_significant_edges.py#L99) | `alpha=0.01` is accepted and cannot add non-significant edges | [`property.test.ts`](../tests/property.test.ts), pruning property includes `alpha=0.01`; exact endpoint cases remain in dyad tests | DIRECT |
| 14 | [`test_prune_edges_custom_weights`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/dyad/tests/test_significant_edges.py#L108) | Duplicate rows create weight 2 and weighted pruning retains it | Construction duplicate aggregation property plus weighted 391-row pruning golden set | DIRECT |
| 15 | [`test_prune_edges_empty_graph`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/dyad/tests/test_significant_edges.py#L140) | Declared nodes but no edges | `dyad.test.ts`, “uses one stable result shape for empty and singleton graphs” | DIRECT |
| 16 | [`test_prune_edges_single_edge`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/dyad/tests/test_significant_edges.py#L149) | Singleton is always significant, even at strict alpha | Same direct dyad test, including diagnostic and uniform result | DIRECT |
| 17 | [`test_prune_edges_no_nodes`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/dyad/tests/test_significant_edges.py#L162) | No nodes and no edges | Same direct dyad test now covers an empty node/edge array with two declared partitions | DIRECT |
| 18 | [`test_prune_edges_invalid_fix_deg`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/dyad/tests/test_significant_edges.py#L168) | Python silently returns an empty significant set for an unknown partition | `dyad.test.ts`, “rejects invalid options…” expects `HinaValidationError` | DIFFERENCE |
| 19 | [`test_prune_edges_extreme_alpha`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/dyad/tests/test_significant_edges.py#L178) | SciPy `alpha=0`/`1` endpoints | `dyad.test.ts`, “implements SciPy endpoint behavior for alpha zero and one” | DIRECT |

Unlike Python, empty, singleton and general inputs always return a
`PruneEdgesResult`. A graph with no nodes must still declare its two partitions,
because partitions are part of the portable schema. Unknown fixed partitions
are rejected instead of being mistaken for a valid model with zero results.

## Mesoscale communities — 5/5

| # | Upstream pytest item | Behavior | `hina-js` evidence | Status |
| ---: | --- | --- | --- | --- |
| 20 | [`test_hina_communities`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/mesoscale/tests/test_clustering.py#L39) | Automatic MDL result, assignments, ratio, graph and subgraphs | [`mesoscale.test.ts`](../tests/mesoscale.test.ts), automatic optimum and fixed result-shape assertions | DIRECT |
| 21 | [`test_hina_communities_from_df`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/mesoscale/tests/test_clustering.py#L62) | Constructed graph assigns every student | Mesoscale unit tests plus complete 86-actor sample-data partition | DIRECT |
| 22 | [`test_hina_communities_fixed`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/mesoscale/tests/test_clustering.py#L81) | Fixed `B=2`, two subgraphs, Bob/Charlie co-membership | `mesoscale.test.ts`, “matches the upstream fixed-B partition and returns canonical labels” | DIRECT |
| 23 | [`test_compression_ratio`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/mesoscale/tests/test_clustering.py#L113) | Automatic MDL is no worse than forced `B=2` | `mesoscale.test.ts`, “selects an automatic MDL optimum no worse than any forced count” | DIRECT |
| 24 | [`test_hina_communities_tripartite`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/mesoscale/tests/test_clustering.py#L129) | Fixed tripartite actor partition and object projections | Structured-metadata projection unit test plus 391-row tripartite partition/object-projection golden fixture | DIRECT |

Numeric community labels are deliberately canonical in TypeScript but are not
used as parity evidence. [`sample-data.test.ts`](../tests/sample-data.test.ts)
compares partition/co-membership and MDL tolerances. The Python oracle was also
audited at `PYTHONHASHSEED=0`, `1` and `42`; this fixture's partitions and object
projection edge sets were identical across all three seeds.

## Graph saving utilities — 4/4

| # | Upstream pytest item | Behavior | `hina-js` evidence | Status |
| ---: | --- | --- | --- | --- |
| 25 | [`test_save_network_gml`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/utils/tests/test_graph_tools.py#L5) | Write a GML graph file | [`serialization.test.ts`](../tests/serialization.test.ts), serializer content checks and “infers every portable graph format…” disk check | DIRECT |
| 26 | [`test_save_network_gexf`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/utils/tests/test_graph_tools.py#L11) | Write a GEXF graph file | Same direct serialization and disk test | DIRECT |
| 27 | [`test_save_network_graphml`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/utils/tests/test_graph_tools.py#L17) | Write a GraphML graph file | Same direct serialization and disk test | DIRECT |
| 28 | [`test_save_network_unsupported_format`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/utils/tests/test_graph_tools.py#L23) | Reject an unsupported format | `serialization.test.ts`, unsupported runtime format and unknown-extension tests | DIRECT |

The Node API accepts a complete `HinaGraph` and writes the exact requested path;
it does not accept a bare edge-list or append an extension behind the caller's
back. GML, GEXF and GraphML outputs retain typed metadata, stable IDs and all
zero-weight edges, which is stronger than the upstream existence assertions.

## Visualization — 7/7

| # | Upstream pytest item | Behavior | `hina-js` evidence | Status |
| ---: | --- | --- | --- | --- |
| 29 | [`test_plot_hina_basic`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/visualization/tests/test_network_visualization.py#L30) | Default visualization does not throw | [`visualization.test.ts`](../tests/visualization.test.ts) default deterministic bipartite layout; [`react.test.tsx`](../tests/react.test.tsx) mounts and destroys Cytoscape | REPLACED |
| 30 | [`test_plot_hina_with_layout`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/visualization/tests/test_network_visualization.py#L39) | Bipartite, spring and circular layouts; reject unknown layout | `visualization.test.ts`, deterministic bipartite/circular/seeded-spring checks and explicit unsupported-layout error | DIRECT |
| 31 | [`test_plot_hina_with_group_filtering`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/visualization/tests/test_network_visualization.py#L64) | All groups and selected-group view | `react.test.tsx`, “filters actors by group without reintroducing them…”; Playwright group-B accessible-network assertion | REPLACED |
| 32 | [`test_plot_hina_with_pruning`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/visualization/tests/test_network_visualization.py#L78) | Visualize a pruned graph | Dyad unit tests and [`workbench.spec.ts`](../e2e/workbench.spec.ts), pruned fixed-B analysis with three rendered significant edges | REPLACED |
| 33 | [`test_plot_hina_with_networkx_kwargs`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/visualization/tests/test_network_visualization.py#L88) | Forward arbitrary Matplotlib/NetworkX drawing kwargs | Typed Cytoscape controls are tested in React/Playwright; no `NetworkX_kwargs` escape hatch exists | DIFFERENCE |
| 34 | [`test_plot_bipartite_clusters`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/visualization/tests/test_network_visualization.py#L97) | Detect and render clustered bipartite graph | Deterministic cluster layout, `HinaNetwork`, cluster result tabs, and Playwright fixed-B rendering | REPLACED |
| 35 | [`test_plot_bipartite_clusters_options`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/visualization/tests/test_network_visualization.py#L105) | Matplotlib flags for degree scaling and encoded/node/edge labels | React tests cover node-size/color controls; Playwright proves node-label toggling, zoom/reset and PNG export; the exact Matplotlib flags are not public | DIFFERENCE |

Matplotlib figures are not pixel-compared. `hina-js` exposes deterministic
JSON positions and Cytoscape elements, while the React component owns
interactive styling. Arbitrary NetworkX drawing kwargs and Matplotlib-only edge
label flags are intentionally absent from the portable API.

## Dashboard utility layer — 7/7

| # | Upstream pytest item | Behavior | `hina-js` evidence | Status |
| ---: | --- | --- | --- | --- |
| 36 | [`test_parse_contents`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/app/tests/test_utils.py#L8) | Decode base64 CSV into a table | [`io.test.ts`](../tests/io.test.ts) UTF-8 CSV parser; React and Playwright load a real local `File` without upload | REPLACED |
| 37 | [`test_parse_excel_contents`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/app/tests/test_utils.py#L15) | Decode base64 XLSX into a table | `io.test.ts` typed/cached multi-sheet XLSX parser; Playwright single- and multi-sheet local workbooks | REPLACED |
| 38 | [`test_build_hina_network`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/app/tests/test_utils.py#L26) | Group filter, bi/tripartite build, optional pruning and layout | `HinaWorkbench` component tests plus pruned/group-filtered Playwright flow | REPLACED |
| 39 | [`test_build_clustered_network`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/app/tests/test_utils.py#L92) | Combined build, community labels, ratio and optional object graphs | Mesoscale unit/golden tests and fixed-B workbench result tables | REPLACED |
| 40 | [`test_cy_elements_from_graph`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/app/tests/test_utils.py#L113) | Cytoscape node/edge element counts, IDs and positions | `visualization.test.ts`, “returns stable node-first elements with optional positions” | DIRECT |
| 41 | [`test_get_bipartite`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/app/tests/test_utils.py#L133) | Dashboard wrapper delegates bipartite construction | Construction unit/property/golden tests call the public function directly | DIRECT |
| 42 | [`test_get_tripartite`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/app/tests/test_utils.py#L154) | Dashboard wrapper delegates tripartite construction and combined nodes | Construction unit/golden tests call the public function directly | DIRECT |

Base64 was a Dash/FastAPI transport convention, not a scientific requirement.
The JavaScript API receives decoded strings/bytes or browser `File` objects and
performs no server upload. CSV identifiers are kept as strings, XLSX formulas
are never executed, and workbook selection is explicit.

## FastAPI endpoint layer — 5/5

| # | Upstream pytest item | Behavior | `hina-js` evidence | Status |
| ---: | --- | --- | --- | --- |
| 43 | [`test_upload_file`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/app/tests/test_api.py#L6) | Server upload returns columns, rows, upload ID, timestamp and filename | React/Playwright local-file loading returns filename/columns/rows and explicitly performs no upload; upload ID/timestamp are unnecessary | REPLACED |
| 44 | [`test_build_hina_network_endpoint`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/app/tests/test_api.py#L24) | HTTP build across layouts, including upstream's HTTP-200 invalid-layout fallback | Workbench Playwright analysis plus [`verify-next.mjs`](../scripts/verify-next.mjs) Node/Edge route analysis; core invalid layout is explicitly rejected | REPLACED |
| 45 | [`test_build_cluster_network_endpoint`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/app/tests/test_api.py#L74) | HTTP fixed-cluster result with elements, labels, ratio, projections and pruning | Playwright fixed-B/pruning/tables and React result-panel assertions | REPLACED |
| 46 | [`test_build_object_network_endpoint`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/app/tests/test_api.py#L110) | Render a selected tripartite community's object graph | Mesoscale structured projection test and complete two-community object-projection golden fixture | REPLACED |
| 47 | [`test_quantity_diversity_endpoint`](https://github.com/SHF-NAILResearchGroup/HINA/blob/f7bb3df3609aa6b0b6d5c98108e940f662053bb5/hina/app/tests/test_api.py#L163) | Quantity/diversity response with and without an attribute | Individual direct tests, `HinaResultsPanel` tables and end-to-end workbook analysis | REPLACED |

No HINA website or Python-compatible FastAPI server is part of the npm package.
The requested Next.js fit is supplied by portable core modules, optional React
components and an isolated real-tarball Next.js 16 verification. The Next gate
checks TypeScript declarations, a Turbopack production build/start, a client
workbench, a Server Component import, and both Node.js and Edge route runtimes.

## Intentional differences summarized

The four DIFFERENCE rows above are deliberate API decisions:

1. `analyzeQuantity` returns one uniform typed object rather than a
   `return_type`-dependent dictionary.
2. An unknown fixed pruning partition raises `HinaValidationError` rather than
   silently returning an empty result.
3. Cytoscape rendering does not accept arbitrary NetworkX/Matplotlib kwargs.
4. Matplotlib-only cluster label flags are replaced by typed React/Cytoscape
   controls; there is no direct `edge_labels` compatibility switch.

The REPLACED rows are architectural, not missing scientific behavior: local
browser parsing replaces base64/server uploads; React/Cytoscape replaces
Matplotlib; typed functions and Next route examples replace the Python
dashboard's orchestration endpoints. Other project-wide intentional differences
(partition-aware typed IDs, structured joint values, finite one-category
diversity, uniform pruning results, canonical communities and no input mutation)
are detailed in [`PARITY.md`](./PARITY.md) and [`UPSTREAM.md`](../UPSTREAM.md).

Some upstream assertions are deliberately weak: basic plotting only checks
that no exception is raised; its invalid-layout endpoint expects HTTP 200; its
object-network endpoint can skip; and empty pruning changes return type. The
mapped TypeScript tests assert stable schemas, exact topology or real browser
outcomes instead of preserving those weaknesses.

## Audit additions

This audit found four behaviors that were previously covered only indirectly.
They now have direct assertions, without any source change:

- tripartite mixed numeric/boolean components, a missing component and an empty
  actor in `construction.test.ts`;
- a no-node/no-edge graph with declared partitions in `dyad.test.ts`;
- actual GML, GEXF and GraphML disk writes in `serialization.test.ts`; and
- the default layout and runtime rejection of an unsupported layout in
  `visualization.test.ts`.

## Verification commands

Verify the upstream checkout and exact test count:

```bash
git -C output/upstream-hina-f7 rev-parse HEAD
find output/upstream-hina-f7/hina -path '*/tests/test_*.py' -type f | wc -l
rg -n '^def test_' output/upstream-hina-f7/hina -g 'test_*.py' | wc -l
rg -n 'pytest\.mark\.parametrize|@parametrize' \
  output/upstream-hina-f7/hina -g 'test_*.py'
```

Expected evidence is commit
`f7bb3df3609aa6b0b6d5c98108e940f662053bb5`, nine files, 47 functions and no
parameterization matches.

Run the portable unit/property/golden suite and static gates:

```bash
npm test
npm run lint
npm run typecheck
```

Run the publication and framework gates:

```bash
npm run build
npm run test:package
npm run test:next
npm run test:e2e
```

`npm run test:next` and `npm run test:e2e` are explicit framework/release gates;
they are not currently included in the aggregate `npm run check` command. The
Playwright suite contains three serial real-browser items: the complete pruned
fixed-B CSV workbench flow, single-sheet XLSX, and multi-sheet
bipartite-to-tripartite switching.
