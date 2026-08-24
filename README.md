# hina-js

Deterministic, JSON-safe Heterogeneous Interaction Network Analysis (HINA) for
TypeScript, JavaScript, React, and Next.js.

`hina-js` is an independent TypeScript port of the scientific behavior in the
[HINA Python project](https://github.com/SHF-NAILResearchGroup/HINA), fixed to
upstream commit
[`f7bb3df3609aa6b0b6d5c98108e940f662053bb5`](https://github.com/SHF-NAILResearchGroup/HINA/tree/f7bb3df3609aa6b0b6d5c98108e940f662053bb5).
It is not an official JavaScript release of the original research group.

The package has no Python runtime, server, account, telemetry, native extension,
or upload requirement. Its core graph and analysis results contain only plain,
JSON-safe objects and arrays, so they can cross Next.js Server/Client boundaries
and be moved to a Web Worker by a host application.

> Status: the source tree targets `0.1.0`. Install from npm only after the
> release badge and registry command below are live; until then, use `npm pack`
> from this repository.

## Features

- Weighted bipartite and structured tripartite HINA construction.
- Quantity, normalized quantity, category quantity, group normalization, and
  normalized Shannon diversity.
- Binomial significant-edge pruning with SciPy-compatible discrete quantiles.
- Deterministic MDL community detection with fixed or automatically selected
  community counts.
- L2 cosine projection, deterministic layouts, and Cytoscape elements.
- CSV and multi-sheet XLSX input; complete XLSX analysis export.
- GML, GEXF, GraphML, and JSON serialization; Node-only file helpers.
- A client-only React workbench designed for Next.js App Router integration.

## Requirements and installation

- Node.js `20.9` or later for Node consumers.
- React and React DOM `>=18.2 <20` only when using `hina-js/react`.

```bash
npm install hina-js
```

The package emits ESM, CommonJS, source maps, and TypeScript declarations. Core
imports do not load React, the DOM, `node:fs`, or the XLSX implementation.

## Five-minute core example

```ts
import {
  analyzeIndividuals,
  createBipartiteGraph,
  detectCommunities,
  layoutGraph,
  projectGraph,
  pruneEdges,
} from "hina-js";

const rows = [
  { StudentId: "A::01", Group: "A", Code: "EC" },
  { StudentId: "A::01", Group: "A", Code: "EC" },
  { StudentId: "A::01", Group: "A", Code: "ICT" },
  { StudentId: "B::01", Group: "B", Code: "ICT" },
];

const { graph, diagnostics } = createBipartiteGraph(rows, {
  studentColumn: "StudentId",
  objectColumn: "Code",
  groupColumn: "Group",
});

// The duplicate A::01–EC record is represented by one edge of weight 2.
const individuals = analyzeIndividuals(graph, { group: "Group" });
const pruning = pruneEdges(graph, { alpha: 0.05 });
const communities = detectCommunities(graph, {
  fixedCommunityCount: 2,
  targetPartition: "StudentId",
});
const projection = projectGraph(graph, {
  targetPartition: "StudentId",
});
const layout = layoutGraph(graph, { type: "spring", seed: 42 });

console.log({ diagnostics, individuals, pruning, communities, projection, layout });
```

Every result can be passed through `JSON.stringify`, `JSON.parse`, and
`structuredClone`. Analyses treat inputs as immutable.

## Construction semantics

```ts
import {
  createBipartiteGraph,
  createTripartiteGraph,
} from "hina-js/construction";
```

For bipartite graphs, duplicate `(actor, object)` rows become an integer edge
weight. Empty actor rows are removed with row-number diagnostics. Missing object,
attribute, and group values use the display value `"NA"`.

Tripartite construction represents an actor interacting with a structured
`(object1, object2)` composite. A label such as `"EC**Lesson 1"` is display text
only: the ID stores typed components, so input values containing `"**"` cannot
collide.

Node IDs include the partition, scalar type, and canonical value. Consequently,
actor `"1"`, object `"1"`, number `1`, string `"01"`, and boolean `true` remain
distinct. Conflicting attributes throw `HinaValidationError` by default; select
`conflictStrategy: "first"` or `"last"` only for explicit compatibility behavior.

## Scientific definitions

For actor \(i\), quantity is weighted degree:

\[
q_i = \sum_j w_{ij}.
\]

Global normalized quantity is \(q_i / \sum_{uv} w_{uv}\). Group-normalized
quantity divides \(q_i\) by the total quantity of actors sharing the selected
group. Zero denominators return `0`, never `NaN`.

Diversity is normalized Shannon entropy over the global object/category
universe of size \(N\):

\[
D_i = -\frac{\sum_c p_{ic}\log p_{ic}}{\log N}.
\]

`D_i` is explicitly `0` when \(N \le 1\) or the actor has zero total weight.

Significant-edge pruning uses the pinned Python HINA binomial PPF rule. `alpha`
must be in `[0, 1]`; counts and threshold comparisons are exact integers. MDL
community detection ports `logGamma`, `logChoose`, and `logMultiset` to pure
TypeScript and resolves equal-cost merges by canonical node ID. Community labels
are normalized to consecutive integers `0..B-1`.

Projection is L2 cosine similarity. Zero-similarity pairs are retained by
default to preserve upstream semantics; use
`includeZeroSimilarity: false` only as an explicit view/data choice.

The committed parity policy and intentional fixes are documented in
[UPSTREAM.md](./UPSTREAM.md) and [docs/PARITY.md](./docs/PARITY.md).

## CSV and XLSX

```ts
import {
  exportResultsXlsx,
  parseCsv,
  parseXlsx,
} from "hina-js/io";

const csv = parseCsv("Actor,Code\n01,EC\n1,ICT\n");
// `01` and `1` remain different strings.

const workbook = await parseXlsx(await file.arrayBuffer());
const selectedSheet = workbook.sheets[0];

const resultBytes = await exportResultsXlsx({
  graph,
  individuals,
  pruning,
  communities,
});
```

Papa Parse automatic typing is disabled. XLSX is dynamically loaded only from
`hina-js/io` or the React workbench; formulas are not evaluated, and only cached
cell values are read. Result workbooks include metadata, individual metrics,
significant edges, communities, and diagnostics as separate worksheets.

## Network export

```ts
import { serializeGraph } from "hina-js";

const graphml = serializeGraph(graph, "graphml");
const gexf = serializeGraph(graph, "gexf");
```

In Node.js only:

```ts
import { saveGraphFile, saveResultsXlsxFile } from "hina-js/node";

await saveGraphFile(graph, "analysis.graphml");
await saveResultsXlsxFile({ graph, individuals }, "hina-results.xlsx");
```

## React workbench

The React entry is a Client Component and exports `HinaWorkbench`,
`HinaNetwork`, `HinaResultsPanel`, and `useHinaAnalysis`.

```tsx
"use client";

import { HinaWorkbench } from "hina-js/react";
import "hina-js/react/styles.css";

export default function AnalysisClient() {
  return (
    <HinaWorkbench
      defaultConfig={{
        actorColumn: "StudentId",
        objectColumn: "Code",
        actorAttribute: "Group",
        fixedCommunityCount: 2,
      }}
      onAnalysisComplete={(result) => console.log(result)}
      onError={(error) => console.error(error)}
    />
  );
}
```

Files are parsed locally in the browser and are not uploaded. The workbench
supports CSV/XLSX and worksheet selection, two- and three-object mapping,
pruning, fixed/automatic communities, projection, layouts, filters, accessible
status and result tables, and JSON/PNG/XLSX downloads. Default styling is neutral
and controlled through `--hina-*` CSS variables.

### Next.js App Router boundaries

A Server Component or Edge route may import only core entries:

```tsx
// app/page.tsx — Server Component
import { createBipartiteGraph } from "hina-js";

export default function Page() {
  const count = createBipartiteGraph(
    [{ actor: "a", object: "x" }],
    { studentColumn: "actor", objectColumn: "object" },
  ).graph.edges.length;
  return <main>Edges: {count}</main>;
}
```

```ts
// app/api/analysis/route.ts
import { analyzeQuantity, createBipartiteGraph } from "hina-js";

export const runtime = "edge";

export function GET() {
  const graph = createBipartiteGraph(
    [{ actor: "a", object: "x" }],
    { studentColumn: "actor", objectColumn: "object" },
  ).graph;
  return Response.json(analyzeQuantity(graph));
}
```

Keep the workbench behind a file containing `"use client"`. The repository's
`examples/next-app` fixture is tested against a packed `hina-js-0.1.0.tgz`, not a
workspace symlink, so package exports, CSS, declarations, Server Components,
Client Components, Edge code, and the production bundler are checked together.

## Practice dataset

`examples/data` contains the user's non-private practice workbook byte-for-byte
and a deterministic long-form derivative. The transformation trims `Lesson`,
creates `StudentId = Group + "::" + Name`, unpivots seven `0/1` code columns,
and retains only positive interactions. It produces exactly 391 interaction
rows; 12 all-zero actor/lesson rows remain available in the original workbook.

```bash
npm run data:check  # verify source hash and committed derivatives
npm run data:build  # deterministically rebuild CSV and XLSX derivatives
```

See [examples/data/TRANSFORM.md](./examples/data/TRANSFORM.md) for provenance,
hashes, fields, and recommended bipartite/tripartite mappings.

## Python-to-TypeScript API map

| Python HINA | `hina-js` |
| --- | --- |
| `get_bipartite` | `createBipartiteGraph` |
| `get_tripartite` | `createTripartiteGraph` |
| `quantity` | `analyzeQuantity` |
| `diversity` | `analyzeDiversity` |
| `prune_edges` | `pruneEdges` |
| `hina_communities` | `detectCommunities` |
| `plot_hina` | `layoutGraph` + `HinaNetwork` |
| `plot_hina_projection` | `projectGraph` + `HinaNetwork` |
| `plot_bipartite_clusters` | `detectCommunities` + `HinaNetwork` |
| `save_network` | `serializeGraph` or `saveGraphFile` |

Python snake_case names are not exported as aliases.

## Package entry points

| Entry | Purpose | Runtime |
| --- | --- | --- |
| `hina-js` | Types, construction, analysis, projection, layout, serialization | Browser, Node, Edge |
| `hina-js/construction` | Bipartite/tripartite construction | Browser, Node, Edge |
| `hina-js/individual` | Quantity and diversity | Browser, Node, Edge |
| `hina-js/dyad` | Significant-edge pruning | Browser, Node, Edge |
| `hina-js/mesoscale` | MDL communities | Browser, Node, Edge |
| `hina-js/visualization` | Layout, projection, Cytoscape elements | Browser, Node, Edge |
| `hina-js/io` | CSV/XLSX read and XLSX results | Browser, Node |
| `hina-js/react` | React workbench and components | React Client Component |
| `hina-js/react/styles.css` | Optional default styles | Browser |
| `hina-js/node` | File writing | Node only |

## Errors and diagnostics

Recoverable issues are returned as `HinaDiagnostic[]`; the library never calls
`console.warn`. Unrecoverable input raises a JSON-safe `HinaValidationError`.
Stable codes include `MISSING_COLUMN`, `INVALID_ALPHA`, `INVALID_PARTITION`,
`INVALID_COMMUNITY_COUNT`, `ATTRIBUTE_CONFLICT`, `INVALID_WEIGHT`, and
`UNSUPPORTED_FILE`.

```ts
import { HinaValidationError } from "hina-js";

try {
  pruneEdges(graph, { alpha: 2 });
} catch (error) {
  if (error instanceof HinaValidationError) {
    console.error(error.toJSON());
  }
}
```

## Performance and non-goals

Construction and individual metrics are linear in interaction count. Projection
is quadratic in the projected node count. Deterministic greedy MDL community
detection is intentionally aimed at research-sized networks and may dominate
runtime and memory for large actor sets. The release process records the bundled
practice dataset and a 10,000-interaction synthetic benchmark, but `0.1.0` makes
no unlimited-scale, streaming, or real-time guarantee.

This package does not provide a hosted website, authentication, database, upload
service, API server, CLI, Python/WASM runtime, or cloud deployment.

## Development and verification

```bash
npm ci
npm run data:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:package
npm run test:next
npm run test:e2e
npm run check:licenses
npm run check:secrets
```

CI covers Node `20.9`, `22`, and `24`. Scientific fixtures are committed, so
ordinary CI does not install Python or fetch the upstream repository. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the oracle regeneration and release
gates. The fixed upstream suite's 47 pytest items are mapped one by one in the
[upstream test matrix](https://github.com/HUDongpin/hina/blob/main/docs/UPSTREAM_TEST_MATRIX.md).

## Citation, license, and attribution

If this port is useful in research, cite both `hina-js` and the original paper:

> Feng, S., He, B., & Kirkley, A. (2025). HINA: A Learning Analytics Tool for
> Heterogenous Interaction Network Analysis in Python. *Journal of Open Source
> Software*. <https://doi.org/10.21105/joss.08299>

New TypeScript code is MIT licensed, copyright 2026 HUDongpin contributors. The
upstream license is preserved verbatim in [LICENSE.upstream](./LICENSE.upstream).
See [NOTICE.md](./NOTICE.md) and [CITATION.cff](./CITATION.cff).
