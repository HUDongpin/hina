import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import * as XLSX from "@e965/xlsx";

import { HinaValidationError } from "../src/errors";
import { stableEdgeId, stableNodeId } from "../src/internal/graph";
import { saveGraphFile, saveResultsXlsxFile } from "../src/node";
import { serializeGraph } from "../src/serialization";
import type { HinaGraph, HinaNode, HinaPartition } from "../src/types";

const STUDENTS: HinaPartition = {
  id: "student",
  label: "Student",
  role: "actor",
  sourceColumns: ["student"],
};
const OBJECTS: HinaPartition = {
  id: "object",
  label: "Object",
  role: "object",
  sourceColumns: ["object"],
};

function node(
  partition: HinaPartition,
  value: string,
  attributes: HinaNode["attributes"],
): HinaNode {
  return {
    id: stableNodeId(partition.id, value),
    label: value,
    value,
    rawValue: value,
    partition: partition.id,
    attributes,
  };
}

function sampleGraph(): HinaGraph {
  const student = node(STUDENTS, 'Alice <& "A"', {
    group: "A&B",
    nested: { z: 2, a: true },
  });
  const object = node(OBJECTS, "Ask > why", { category: "cognitive" });
  return {
    kind: "bipartite",
    directed: false,
    multigraph: false,
    partitions: [OBJECTS, STUDENTS],
    nodes: [object, student],
    edges: [
      {
        id: stableEdgeId(student.id, object.id),
        source: student.id,
        target: object.id,
        weight: 0,
        attributes: { note: "zero & retained" },
      },
    ],
  };
}

describe("serializeGraph", () => {
  it("writes canonical JSON without mutating the graph", () => {
    const graph = sampleGraph();
    const before = structuredClone(graph);
    const serialized = serializeGraph(graph, "json");
    const parsed = JSON.parse(serialized) as HinaGraph;

    expect(graph).toEqual(before);
    expect(parsed.kind).toBe("bipartite");
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0]?.weight).toBe(0);
    expect(parsed.nodes.every((entry) => entry.rawValue === entry.value)).toBe(
      true,
    );
    expect(parsed.nodes.map((entry) => entry.id)).toEqual(
      [...parsed.nodes.map((entry) => entry.id)].sort(),
    );
    expect(parsed.partitions.map((entry) => entry.id)).toEqual([
      "object",
      "student",
    ]);
  });

  it("is invariant to undirected endpoint and input-array order", () => {
    const graph = sampleGraph();
    const edge = graph.edges[0]!;
    const permuted: HinaGraph = {
      ...graph,
      partitions: [...graph.partitions].reverse(),
      nodes: [...graph.nodes].reverse(),
      edges: [{ ...edge, source: edge.target, target: edge.source }],
    };

    expect(serializeGraph(permuted, "json")).toBe(
      serializeGraph(graph, "json"),
    );
    expect(serializeGraph(permuted, "graphml")).toBe(
      serializeGraph(graph, "graphml"),
    );
  });

  it("emits GML with stable IDs, attributes, escaped quotes, and zero edges", () => {
    const output = serializeGraph(sampleGraph(), "gml");
    expect(output).toContain('Creator "hina-js"');
    expect(output).toContain('label "Alice <& \\"A\\""');
    expect(output).toContain("weight 0");
    expect(output).toContain("attributes_json");
    expect((output.match(/ {2}node \[/g) ?? [])).toHaveLength(2);
    expect((output.match(/ {2}edge \[/g) ?? [])).toHaveLength(1);
  });

  it("emits escaped GEXF and GraphML while preserving all edges", () => {
    const gexf = serializeGraph(sampleGraph(), "gexf");
    expect(gexf).toContain('xmlns="http://gexf.net/1.3"');
    expect(gexf).toContain('label="Alice &lt;&amp; &quot;A&quot;"');
    expect(gexf).toContain('weight="0"');
    expect((gexf.match(/ {6}<edge /g) ?? [])).toHaveLength(1);

    const graphml = serializeGraph(sampleGraph(), "graphml");
    expect(graphml).toContain(
      'xmlns="http://graphml.graphdrawing.org/xmlns"',
    );
    expect(graphml).toContain("Alice &lt;&amp; &quot;A&quot;");
    expect(graphml).toContain('<data key="e_weight">0</data>');
    expect((graphml.match(/ {4}<edge /g) ?? [])).toHaveLength(1);
  });

  it("rejects unsupported runtime formats", () => {
    expect(() =>
      serializeGraph(sampleGraph(), "csv" as never),
    ).toThrowError(HinaValidationError);
  });
});

describe("saveGraphFile", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directory) => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it("infers every portable graph format and writes the exact serialization", async () => {
    const graph = sampleGraph();
    const directory = await mkdtemp(join(tmpdir(), "hina-js-serialization-"));
    temporaryDirectories.push(directory);
    const formats = ["gml", "gexf", "graphml"] as const;

    for (const format of formats) {
      const outputPath = join(directory, `network.${format}`);
      await saveGraphFile(graph, outputPath);
      expect(await readFile(outputPath, "utf8")).toBe(
        serializeGraph(graph, format),
      );
    }
  });

  it("defaults extensionless paths to JSON and rejects unknown extensions", async () => {
    const graph = sampleGraph();
    const directory = await mkdtemp(join(tmpdir(), "hina-js-serialization-"));
    temporaryDirectories.push(directory);
    const extensionlessPath = join(directory, "network");

    await saveGraphFile(graph, extensionlessPath);
    expect(await readFile(extensionlessPath, "utf8")).toBe(
      serializeGraph(graph, "json"),
    );
    await expect(
      saveGraphFile(graph, join(directory, "network.csv")),
    ).rejects.toBeInstanceOf(HinaValidationError);
  });

  it("writes complete XLSX result workbooks from the Node-only entry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hina-js-results-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "hina-results.xlsx");

    await saveResultsXlsxFile({ graph: sampleGraph() }, outputPath, {
      generatedAt: "2026-08-24T00:00:00.000Z",
    });
    const workbook = XLSX.read(await readFile(outputPath), { type: "buffer" });
    expect(workbook.SheetNames).toEqual([
      "Metadata",
      "Quantity",
      "Diversity",
      "Normalized Quantity",
      "Quantity by Category",
      "Normalized by Group",
      "Significant Edges",
      "Cluster Labels",
      "Community Summary",
      "Diagnostics",
    ]);
    await expect(
      saveResultsXlsxFile({}, join(directory, "results.csv")),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
  });
});
