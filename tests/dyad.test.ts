import { describe, expect, it } from "vitest";

import { pruneEdges } from "../src/dyad";
import { HinaValidationError } from "../src/errors";
import { stableEdgeId, stableNodeId } from "../src/internal/graph";
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

function node(partition: HinaPartition, value: string): HinaNode {
  return {
    id: stableNodeId(partition.id, value),
    label: value,
    value,
    partition: partition.id,
    attributes: { bipartite: partition.id },
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
      edge(alice, ask, 1),
      edge(alice, evaluating, 1),
      edge(bob, answer, 1),
      edge(charlie, monitoring, 1),
    ],
  };
}

function labelsForEdges(
  graph: HinaGraph,
  edges: readonly HinaEdge[],
): readonly string[] {
  const labels = new Map(graph.nodes.map((entry) => [entry.id, entry.label]));
  return edges
    .map((entry) =>
      [labels.get(entry.source)!, labels.get(entry.target)!].sort().join("--"),
    )
    .sort();
}

describe("pruneEdges", () => {
  it("matches the upstream unconstrained and fixed-degree examples", () => {
    const graph = sampleGraph();

    const unconstrained = pruneEdges(graph);
    expect(unconstrained.significantEdges).toHaveLength(4);
    expect(unconstrained.removedEdges).toHaveLength(0);
    expect(unconstrained.thresholds).toEqual([
      {
        scope: "global",
        trials: 4,
        probability: 1 / 12,
        threshold: 1,
      },
    ]);

    const fixedStudents = pruneEdges(graph, { fixedPartition: "student" });
    expect(labelsForEdges(graph, fixedStudents.significantEdges)).toEqual([
      "Bob--answer questions",
      "Charlie--monitoring",
    ]);
    expect(labelsForEdges(graph, fixedStudents.removedEdges)).toEqual([
      "Alice--ask questions",
      "Alice--evaluating",
    ]);

    const fixedObjects = pruneEdges(graph, { fixedPartition: "object" });
    expect(fixedObjects.significantEdges).toHaveLength(4);
    expect(fixedObjects.thresholds).toHaveLength(4);
  });

  it("implements SciPy endpoint behavior for alpha zero and one", () => {
    const graph = sampleGraph();

    const strict = pruneEdges(graph, { alpha: 0 });
    expect(strict.significantEdges).toHaveLength(0);
    expect(strict.removedEdges).toHaveLength(4);
    expect(strict.thresholds[0]?.threshold).toBe(4);

    const permissive = pruneEdges(graph, { alpha: 1 });
    expect(permissive.significantEdges).toHaveLength(4);
    expect(permissive.removedEdges).toHaveLength(0);
    expect(permissive.thresholds[0]?.threshold).toBe(-1);
  });

  it("uses one stable result shape for empty and singleton graphs", () => {
    const graph = sampleGraph();
    const empty = { ...graph, edges: [] } satisfies HinaGraph;
    const emptyResult = pruneEdges(empty);
    expect(emptyResult).toMatchObject({
      significantEdges: [],
      removedEdges: [],
      thresholds: [],
      diagnostics: [],
    });
    expect(emptyResult.graph.edges).toEqual([]);

    const noNodes = { ...graph, nodes: [], edges: [] } satisfies HinaGraph;
    expect(pruneEdges(noNodes)).toMatchObject({
      graph: { nodes: [], edges: [] },
      significantEdges: [],
      removedEdges: [],
      thresholds: [],
      diagnostics: [],
    });

    const singleton = { ...graph, edges: [graph.edges[0]!] } satisfies HinaGraph;
    const singletonResult = pruneEdges(singleton, { alpha: 0 });
    expect(singletonResult.significantEdges).toHaveLength(1);
    expect(singletonResult.removedEdges).toEqual([]);
    expect(singletonResult.thresholds).toEqual([]);
    expect(singletonResult.diagnostics[0]?.code).toBe(
      "SINGLE_EDGE_ALWAYS_SIGNIFICANT",
    );
  });

  it("is independent of undirected edge endpoint orientation", () => {
    const graph = sampleGraph();
    const reversed = {
      ...graph,
      edges: graph.edges.map((entry) => ({
        ...entry,
        source: entry.target,
        target: entry.source,
      })),
    } satisfies HinaGraph;

    expect(
      labelsForEdges(
        reversed,
        pruneEdges(reversed, { fixedPartition: "student" }).significantEdges,
      ),
    ).toEqual(["Bob--answer questions", "Charlie--monitoring"]);
  });

  it("does not mutate the input and returns detached node/edge records", () => {
    const graph = sampleGraph();
    const before = structuredClone(graph);
    const result = pruneEdges(graph, { fixedPartition: "student" });

    expect(graph).toEqual(before);
    expect(result.graph).not.toBe(graph);
    expect(result.graph.nodes[0]).not.toBe(graph.nodes[0]);
    expect(result.graph.edges[0]).not.toBe(graph.edges[0]);
  });

  it("rejects invalid options and non-integer binomial weights", () => {
    const graph = sampleGraph();
    expect(() => pruneEdges(graph, { alpha: Number.NaN })).toThrowError(
      HinaValidationError,
    );
    expect(() =>
      pruneEdges(graph, { fixedPartition: "missing" }),
    ).toThrowError(HinaValidationError);

    const fractional = {
      ...graph,
      edges: [{ ...graph.edges[0]!, weight: 0.5 }, ...graph.edges.slice(1)],
    } satisfies HinaGraph;
    expect(() => pruneEdges(fractional)).toThrowError(HinaValidationError);
  });
});
