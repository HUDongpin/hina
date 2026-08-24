import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import {
  analyzeIndividuals,
  createBipartiteGraph,
  detectCommunities,
  projectGraph,
  pruneEdges,
} from "../dist/index.js";
import { parseCsv } from "../dist/io.js";

function timed(label, operation) {
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const value = operation();
  const elapsedMs = performance.now() - started;
  const after = process.memoryUsage().heapUsed;
  return {
    value,
    measurement: {
      label,
      elapsedMs,
      heapDeltaBytes: after - before,
    },
  };
}

function benchmarkDataset(name, rows, fixedCommunityCount) {
  const measurements = [];
  const built = timed(`${name}:construction`, () =>
    createBipartiteGraph(rows, {
      studentColumn: "StudentId",
      objectColumn: "Code",
      groupColumn: "Group",
    }),
  );
  measurements.push(built.measurement);
  const graph = built.value.graph;
  const individuals = timed(`${name}:individuals`, () =>
    analyzeIndividuals(graph, { group: "Group" }),
  );
  measurements.push(individuals.measurement);
  const pruning = timed(`${name}:pruning`, () => pruneEdges(graph, { alpha: 0.05 }));
  measurements.push(pruning.measurement);
  const communities = timed(`${name}:communities`, () =>
    detectCommunities(graph, {
      fixedCommunityCount,
      targetPartition: "StudentId",
    }),
  );
  measurements.push(communities.measurement);
  const projection = timed(`${name}:projection`, () =>
    projectGraph(graph, {
      includeZeroSimilarity: true,
      targetPartition: "StudentId",
    }),
  );
  measurements.push(projection.measurement);

  return {
    name,
    inputRows: rows.length,
    graphNodes: graph.nodes.length,
    graphEdges: graph.edges.length,
    significantEdges: pruning.value.significantEdges.length,
    communities: communities.value.communityCount,
    projectionEdges: projection.value.graph.edges.length,
    measurements,
  };
}

const practiceCsv = await readFile(
  new URL("../examples/data/yu-hina-long.csv", import.meta.url),
  "utf8",
);
const practiceRows = parseCsv(practiceCsv, { name: "yu-hina-long.csv" }).rows;
const syntheticRows = Array.from({ length: 10_000 }, (_, index) => ({
  StudentId: `Synthetic::Actor ${String(index % 200).padStart(3, "0")}`,
  Group: `Group ${index % 4}`,
  Code: `Code ${String((index * 17 + Math.floor(index / 200)) % 40).padStart(2, "0")}`,
  Value: 1,
}));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  nonBlocking: true,
  datasets: [
    benchmarkDataset("practice", practiceRows, 2),
    benchmarkDataset("synthetic-10000", syntheticRows, 4),
  ],
};

const outputDirectory = new URL("../output/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  new URL("performance.json", outputDirectory),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(report, null, 2));
