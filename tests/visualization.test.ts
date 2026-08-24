import { describe, expect, it } from "vitest";

import { HinaValidationError } from "../src/errors";
import { stableEdgeId, stableNodeId } from "../src/internal/graph";
import type { HinaEdge, HinaGraph, HinaNode, HinaPartition } from "../src/types";
import {
  layoutGraph,
  projectGraph,
  toCytoscapeElements,
} from "../src/visualization";

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
  attributes: HinaNode["attributes"] = {},
): HinaNode {
  return {
    id: stableNodeId(partition.id, value),
    label: value,
    value,
    partition: partition.id,
    attributes,
  };
}

function edge(source: HinaNode, target: HinaNode, weight: number): HinaEdge {
  return {
    id: stableEdgeId(source.id, target.id),
    source: source.id,
    target: target.id,
    weight,
    attributes: { observed: true },
  };
}

function sampleGraph(): HinaGraph {
  const alice = node(STUDENTS, "Alice", { group: "A" });
  const bob = node(STUDENTS, "Bob", { group: "B" });
  const charlie = node(STUDENTS, "Charlie", { group: "A" });
  const ask = node(OBJECTS, "Ask");
  const answer = node(OBJECTS, "Answer");
  const reflect = node(OBJECTS, "Reflect");
  return {
    kind: "bipartite",
    directed: false,
    multigraph: false,
    partitions: [STUDENTS, OBJECTS],
    nodes: [charlie, answer, alice, reflect, bob, ask],
    edges: [
      edge(alice, ask, 3),
      edge(alice, answer, 4),
      edge(bob, answer, 5),
      edge(charlie, reflect, 2),
    ],
  };
}

describe("layoutGraph", () => {
  it("builds deterministic partition columns independent of input order", () => {
    const graph = sampleGraph();
    expect(layoutGraph(graph).type).toBe("bipartite");
    const original = layoutGraph(graph, {
      type: "bipartite",
      width: 1000,
      height: 500,
    });
    const permuted: HinaGraph = {
      ...graph,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    };
    const repeated = layoutGraph(permuted, {
      type: "bipartite",
      width: 1000,
      height: 500,
    });

    expect(repeated).toEqual(original);
    expect(original.type).toBe("bipartite");
    const studentXs = new Set(
      graph.nodes
        .filter((entry) => entry.partition === "student")
        .map((entry) => original.positions[entry.id]!.x),
    );
    const objectXs = new Set(
      graph.nodes
        .filter((entry) => entry.partition === "object")
        .map((entry) => original.positions[entry.id]!.x),
    );
    expect(studentXs.size).toBe(1);
    expect(objectXs.size).toBe(1);
    expect([...studentXs][0]).not.toBe([...objectXs][0]);
  });

  it("supports circular and reproducibly seeded spring layouts", () => {
    const graph = sampleGraph();
    const circular = layoutGraph(graph, {
      type: "circular",
      width: 640,
      height: 480,
    });
    expect(Object.keys(circular.positions)).toHaveLength(graph.nodes.length);
    expect(
      Object.values(circular.positions).every(
        ({ x, y }) => x >= 0 && x <= 640 && y >= 0 && y <= 480,
      ),
    ).toBe(true);

    const first = layoutGraph(graph, { type: "spring", seed: 73 });
    const second = layoutGraph(graph, { type: "spring", seed: 73 });
    const differentSeed = layoutGraph(graph, { type: "spring", seed: 74 });
    expect(second).toEqual(first);
    expect(differentSeed.positions).not.toEqual(first.positions);
    expect(
      Object.values(first.positions).every(
        ({ x, y }) => Number.isFinite(x) && Number.isFinite(y),
      ),
    ).toBe(true);
  });

  it("accepts node-community rows for a deterministic cluster layout", () => {
    const graph = sampleGraph();
    const students = graph.nodes
      .filter((entry) => entry.partition === "student")
      .sort((left, right) => left.label.localeCompare(right.label));
    const communities = [
      { nodeId: students[0]!.id, community: 0 },
      { nodeId: students[1]!.id, community: 1 },
      { nodeId: students[2]!.id, community: 0 },
    ];
    const first = layoutGraph(graph, {
      type: "cluster",
      seed: 11,
      communities,
    });
    const second = layoutGraph(graph, {
      type: "cluster",
      seed: 11,
      communities: { nodeCommunities: communities },
    });

    expect(second).toEqual(first);
    expect(Object.keys(first.positions)).toHaveLength(graph.nodes.length);
  });

  it("rejects invalid dimensions and unknown community nodes", () => {
    const graph = sampleGraph();
    expect(() => layoutGraph(graph, { width: 0 })).toThrowError(
      HinaValidationError,
    );
    expect(() =>
      layoutGraph(graph, {
        type: "cluster",
        communities: [{ nodeId: "missing", community: 0 }],
      }),
    ).toThrowError(HinaValidationError);
    expect(() =>
      layoutGraph(graph, { type: "unsupported" as never }),
    ).toThrowError(HinaValidationError);
  });
});

describe("projectGraph", () => {
  it("computes L2 cosine similarity and preserves zero edges by default", () => {
    const graph = sampleGraph();
    const before = structuredClone(graph);
    const result = projectGraph(graph, { targetPartition: "student" });
    const nodeIdByLabel = new Map(
      result.graph.nodes.map((entry) => [entry.label, entry.id]),
    );
    const aliceId = nodeIdByLabel.get("Alice")!;
    const bobId = nodeIdByLabel.get("Bob")!;
    const charlieId = nodeIdByLabel.get("Charlie")!;
    const byPair = new Map(
      result.similarities.map((entry) => [
        [entry.source, entry.target].sort().join("|"),
        entry.similarity,
      ]),
    );

    expect(graph).toEqual(before);
    expect(result.metric).toBe("cosine-l2");
    expect(result.graph.kind).toBe("projection");
    expect(result.graph.partitions).toMatchObject([{ role: "projection" }]);
    expect(result.graph.edges).toHaveLength(3);
    expect(byPair.get([aliceId, bobId].sort().join("|"))).toBeCloseTo(0.8, 12);
    expect(byPair.get([aliceId, charlieId].sort().join("|"))).toBe(0);
    expect(byPair.get([bobId, charlieId].sort().join("|"))).toBe(0);
  });

  it("can omit zero-similarity pairs and rejects unknown partitions", () => {
    const graph = sampleGraph();
    const sparse = projectGraph(graph, {
      targetPartition: "student",
      includeZeroSimilarity: false,
    });
    expect(sparse.graph.edges).toHaveLength(1);
    expect(sparse.similarities).toHaveLength(1);
    expect(() =>
      projectGraph(graph, { targetPartition: "missing" }),
    ).toThrowError(HinaValidationError);
  });
});

describe("toCytoscapeElements", () => {
  it("returns stable node-first elements with optional positions", () => {
    const graph = sampleGraph();
    const layout = layoutGraph(graph, { type: "circular" });
    const elements = toCytoscapeElements(graph, { layout });
    const nodeElements = elements.filter((entry) => entry.group === "nodes");
    const edgeElements = elements.filter((entry) => entry.group === "edges");

    expect(nodeElements).toHaveLength(graph.nodes.length);
    expect(edgeElements).toHaveLength(graph.edges.length);
    expect(elements.slice(0, graph.nodes.length).every((entry) => entry.group === "nodes"))
      .toBe(true);
    expect(nodeElements.every((entry) => entry.position !== undefined)).toBe(true);
    expect(nodeElements.find((entry) => entry.data["label"] === "Alice")?.data)
      .toMatchObject({ group: "A", partition: "student" });
    const firstEdgeData = edgeElements[0]!.data;
    expect(typeof firstEdgeData.id).toBe("string");
    expect(typeof firstEdgeData.source).toBe("string");
    expect(typeof firstEdgeData.target).toBe("string");
    expect(typeof firstEdgeData.weight).toBe("number");
  });
});
