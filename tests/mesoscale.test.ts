import { describe, expect, it } from "vitest";

import { HinaValidationError } from "../src/errors";
import { stableEdgeId, stableNodeId } from "../src/internal/graph";
import { logChoose, logGamma, logMultiset } from "../src/internal/math";
import { detectCommunities } from "../src/mesoscale";
import type { HinaEdge, HinaGraph, HinaNode, HinaPartition } from "../src/types";

const STUDENT_PARTITION: HinaPartition = {
  id: "student",
  label: "Student",
  role: "actor",
  sourceColumns: ["student"],
};
const OBJECT_PARTITION: HinaPartition = {
  id: "object",
  label: "Object",
  role: "object",
  sourceColumns: ["object"],
};

function node(
  partition: HinaPartition,
  value: string | readonly [string, string],
  attributes: HinaNode["attributes"] = {},
): HinaNode {
  return {
    id: stableNodeId(partition.id, value),
    label: typeof value === "string" ? value : value.join("**"),
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
    attributes: {},
  };
}

function sampleGraph(): HinaGraph {
  const alice = node(STUDENT_PARTITION, "Alice");
  const bob = node(STUDENT_PARTITION, "Bob");
  const charlie = node(STUDENT_PARTITION, "Charlie");
  const ask = node(OBJECT_PARTITION, "ask questions");
  const answer = node(OBJECT_PARTITION, "answer questions");
  const evaluating = node(OBJECT_PARTITION, "evaluating");
  const monitoring = node(OBJECT_PARTITION, "monitoring");

  return {
    kind: "bipartite",
    directed: false,
    multigraph: false,
    partitions: [STUDENT_PARTITION, OBJECT_PARTITION],
    nodes: [alice, bob, charlie, ask, answer, evaluating, monitoring],
    edges: [
      edge(alice, ask, 2),
      edge(alice, evaluating, 1),
      edge(bob, answer, 3),
      edge(charlie, monitoring, 1),
    ],
  };
}

function communityByLabel(graph: HinaGraph, fixedCommunityCount = 2) {
  const labels = new Map(graph.nodes.map((entry) => [entry.id, entry.label]));
  return Object.fromEntries(
    detectCommunities(graph, { fixedCommunityCount }).nodeCommunities.map(
      ({ nodeId, community }) => [labels.get(nodeId)!, community],
    ),
  );
}

describe("Lanczos MDL math", () => {
  it("matches exact small combinatorial reference values", () => {
    expect(logGamma(1)).toBeCloseTo(0, 14);
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 13);
    expect(logChoose(5, 2)).toBeCloseTo(Math.log(10), 13);
    expect(logMultiset(3, 2)).toBeCloseTo(Math.log(6), 13);
  });
});

describe("detectCommunities", () => {
  it("matches the upstream fixed-B partition and returns canonical labels", () => {
    const graph = sampleGraph();
    const result = detectCommunities(graph, { fixedCommunityCount: 2 });
    const byLabel = communityByLabel(graph);

    expect(result.communityCount).toBe(2);
    expect(byLabel["Bob"]).toBe(byLabel["Charlie"]);
    expect(byLabel["Alice"]).not.toBe(byLabel["Bob"]);
    expect(result.communities.map((community) => community.id)).toEqual([0, 1]);
    for (const community of result.communities) {
      expect(community.members).toEqual([...community.members].sort());
    }
    expect(result.subgraphs).toHaveLength(2);
    expect(result.descriptionLength).toBeTypeOf("number");
    expect(Number.isFinite(result.compressionRatio)).toBe(true);
  });

  it("selects an automatic MDL optimum no worse than any forced count", () => {
    const graph = sampleGraph();
    const automatic = detectCommunities(graph);
    const forced = [1, 2, 3].map(
      (fixedCommunityCount) =>
        detectCommunities(graph, { fixedCommunityCount }).descriptionLength,
    );

    expect(automatic.descriptionLength).toBeLessThanOrEqual(
      Math.min(...forced) + 1e-10,
    );
    expect(automatic.communityCount).toBeGreaterThanOrEqual(1);
    expect(automatic.communityCount).toBeLessThanOrEqual(3);
  });

  it("is deterministic under node and edge input permutations", () => {
    const graph = sampleGraph();
    const permuted = {
      ...graph,
      partitions: [...graph.partitions].reverse(),
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges]
        .reverse()
        .map((entry) => ({ ...entry, source: entry.target, target: entry.source })),
    } satisfies HinaGraph;

    const originalResult = detectCommunities(graph, { fixedCommunityCount: 2 });
    const permutedResult = detectCommunities(permuted, {
      fixedCommunityCount: 2,
    });
    expect(permutedResult.nodeCommunities).toEqual(originalResult.nodeCommunities);
    expect(permutedResult.communities).toEqual(originalResult.communities);
    expect(permutedResult.descriptionLength).toBeCloseTo(
      originalResult.descriptionLength,
      12,
    );
  });

  it("does not mutate the input graph", () => {
    const graph = sampleGraph();
    const before = structuredClone(graph);
    const result = detectCommunities(graph, { fixedCommunityCount: 2 });

    expect(graph).toEqual(before);
    expect(result.graph).not.toBe(graph);
    expect(result.graph.nodes[0]).not.toBe(graph.nodes[0]);
    const assigned = result.graph.nodes.filter(
      (entry) => entry.partition === "student",
    );
    expect(assigned.every((entry) => "community" in entry.attributes)).toBe(true);
  });

  it("builds tripartite object projections from structured joint metadata", () => {
    const jointPartition: HinaPartition = {
      id: "joint",
      label: "(behavior, gesture)",
      role: "composite",
      sourceColumns: ["behavior", "gesture"],
    };
    const alice = node(STUDENT_PARTITION, "Alice");
    const bob = node(STUDENT_PARTITION, "Bob");
    const askNod = node(jointPartition, ["ask**inside-value", "nod"], {
      bipartite: "joint",
      tripartite: true,
      joint: {
        columns: ["behavior", "gesture"],
        values: ["ask**inside-value", "nod"],
      },
    });
    const answerShake = node(jointPartition, ["answer", "shake"], {
      bipartite: "joint",
      tripartite: true,
      joint: {
        columns: ["behavior", "gesture"],
        values: ["answer", "shake"],
      },
    });
    const graph: HinaGraph = {
      kind: "tripartite",
      directed: false,
      multigraph: false,
      partitions: [STUDENT_PARTITION, jointPartition],
      nodes: [alice, bob, askNod, answerShake],
      edges: [
        edge(alice, askNod, 2),
        edge(bob, askNod, 1),
        edge(bob, answerShake, 1),
      ],
    };

    const result = detectCommunities(graph, { fixedCommunityCount: 1 });
    expect(result.objectProjections).toHaveLength(1);
    const projection = result.objectProjections![0]!.graph;
    expect(projection.kind).toBe("projection");
    expect(projection.partitions.map((partition) => partition.label)).toEqual([
      "behavior",
      "gesture",
    ]);
    expect(projection.edges.map((entry) => entry.weight).sort()).toEqual([1, 3]);
    expect(projection.nodes.some((entry) => entry.label === "ask**inside-value")).toBe(
      true,
    );
  });

  it("rejects invalid community counts and non-integer MDL weights", () => {
    const graph = sampleGraph();
    expect(() =>
      detectCommunities(graph, { fixedCommunityCount: 0 }),
    ).toThrowError(HinaValidationError);
    expect(() =>
      detectCommunities(graph, { fixedCommunityCount: 4 }),
    ).toThrowError(HinaValidationError);
    expect(() =>
      detectCommunities(graph, { targetPartition: "missing" }),
    ).toThrowError(HinaValidationError);

    const fractional = {
      ...graph,
      edges: [{ ...graph.edges[0]!, weight: 1.5 }, ...graph.edges.slice(1)],
    } satisfies HinaGraph;
    expect(() => detectCommunities(fractional)).toThrowError(
      HinaValidationError,
    );
  });
});
