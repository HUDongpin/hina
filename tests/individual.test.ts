import { describe, expect, it } from "vitest";

import { createBipartiteGraph } from "../src/construction";
import { HinaValidationError } from "../src/errors";
import { stableEdgeId, stableNodeId } from "../src/internal/graph";
import {
  analyzeIndividuals,
  analyzeDiversity,
  analyzeQuantity,
} from "../src/individual";
import type { HinaGraph } from "../src/types";

function createGraph(): HinaGraph {
  return createBipartiteGraph(
    [
      {
        student: "Alice",
        object: "ask questions",
        group: "A",
        attr: "cognitive",
      },
      {
        student: "Bob",
        object: "answer questions",
        group: "B",
        attr: "cognitive",
      },
      {
        student: "Alice",
        object: "evaluating",
        group: "A",
        attr: "metacognitive",
      },
      {
        student: "Charlie",
        object: "monitoring",
        group: "B",
        attr: "metacognitive",
      },
    ],
    {
      studentColumn: "student",
      objectColumn: "object",
      attributeColumn: "attr",
      groupColumn: "group",
    },
  ).graph;
}

describe("analyzeQuantity", () => {
  it("matches the upstream raw, normalized, category and group values", () => {
    const graph = createGraph();
    const before = structuredClone(graph);
    const result = analyzeQuantity(graph, { attribute: "attr", group: "group" });
    const alice = stableNodeId("student", "Alice");
    const bob = stableNodeId("student", "Bob");
    const charlie = stableNodeId("student", "Charlie");

    expect(graph).toEqual(before);
    expect(result.totalWeight).toBe(4);
    expect(result.quantity).toMatchObject({
      [alice]: 2,
      [bob]: 1,
      [charlie]: 1,
    });
    expect(result.normalizedQuantity).toMatchObject({
      [alice]: 0.5,
      [bob]: 0.25,
      [charlie]: 0.25,
    });
    expect(result.quantityByCategory?.[alice]).toEqual({
      cognitive: 1,
      metacognitive: 1,
    });
    expect(result.quantityByCategory?.[bob]).toEqual({ cognitive: 1 });
    expect(result.quantityByCategory?.[charlie]).toEqual({
      metacognitive: 1,
    });
    expect(result.normalizedQuantityByGroup).toMatchObject({
      [alice]: 1,
      [bob]: 0.5,
      [charlie]: 0.5,
    });
    expect(result.rows.map((row) => row.label).sort()).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("is partition-aware and does not rely on edge endpoint orientation", () => {
    const graph = createGraph();
    const reversed: HinaGraph = {
      ...graph,
      edges: graph.edges.map((edge) => ({
        ...edge,
        id: stableEdgeId(edge.target, edge.source),
        source: edge.target,
        target: edge.source,
      })),
    };

    expect(analyzeQuantity(reversed, { attribute: "attr", group: "group" })).toEqual(
      analyzeQuantity(graph, { attribute: "attr", group: "group" }),
    );
  });

  it("excludes isolated nodes just like the Python edge-iteration result", () => {
    const graph = createGraph();
    const isolatedId = stableNodeId("student", "Isolated");
    const withIsolate: HinaGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: isolatedId,
          label: "Isolated",
          value: "Isolated",
          partition: "student",
          attributes: { bipartite: "student", group: "A" },
        },
      ],
    };

    const result = analyzeQuantity(withIsolate, { group: "group" });
    expect(result.quantity[isolatedId]).toBeUndefined();
    expect(result.rows.some((row) => row.nodeId === isolatedId)).toBe(false);
  });

  it("reports a finite zero normalization when total edge weight is zero", () => {
    const graph = createGraph();
    const zeroGraph: HinaGraph = {
      ...graph,
      edges: graph.edges.map((edge) => ({ ...edge, weight: 0 })),
    };
    const result = analyzeQuantity(zeroGraph);

    expect(Object.values(result.normalizedQuantity)).toEqual([0, 0, 0]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ZERO_TOTAL_WEIGHT" }),
    );
    expect(JSON.stringify(result)).not.toContain("NaN");
  });

  it("throws a structured error when a requested attribute is absent", () => {
    const graph = createGraph();
    expect(() => analyzeQuantity(graph, { attribute: "missing" })).toThrowError(
      HinaValidationError,
    );
  });
});

describe("analyzeDiversity", () => {
  it("matches normalized Shannon entropy by object attribute", () => {
    const result = analyzeDiversity(createGraph(), { attribute: "attr" });
    const alice = stableNodeId("student", "Alice");
    const bob = stableNodeId("student", "Bob");
    const charlie = stableNodeId("student", "Charlie");

    expect(result.categoryCount).toBe(2);
    expect(result.diversity[alice]).toBeCloseTo(1, 12);
    expect(result.diversity[bob]).toBeCloseTo(0, 12);
    expect(result.diversity[charlie]).toBeCloseTo(0, 12);
  });

  it("uses the global object-node count when no attribute is selected", () => {
    const result = analyzeDiversity(createGraph());
    const alice = stableNodeId("student", "Alice");

    expect(result.categoryCount).toBe(4);
    expect(result.diversity[alice]).toBeCloseTo(0.5, 12);
  });

  it("keeps zero-weight and one-category results finite", () => {
    const graph = createBipartiteGraph(
      [
        { student: "Alice", object: "ask", attr: "only" },
        { student: "Bob", object: "ask", attr: "only" },
      ],
      {
        studentColumn: "student",
        objectColumn: "object",
        attributeColumn: "attr",
      },
    ).graph;
    const zeroGraph: HinaGraph = {
      ...graph,
      edges: graph.edges.map((edge) => ({ ...edge, weight: 0 })),
    };
    const result = analyzeDiversity(zeroGraph, { attribute: "attr" });

    expect(Object.values(result.diversity)).toEqual([0, 0]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SINGLE_CATEGORY_DIVERSITY" }),
    );
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe("analyzeIndividuals", () => {
  it("combines quantity and diversity into stable table rows", () => {
    const graph = createGraph();
    const result = analyzeIndividuals(graph, {
      attribute: "attr",
      group: "group",
    });
    const aliceRow = result.rows.find((row) => row.label === "Alice");

    expect(aliceRow).toMatchObject({
      quantity: 2,
      normalizedQuantity: 0.5,
      normalizedQuantityByGroup: 1,
      diversity: 1,
      quantityByCategory: {
        cognitive: 1,
        metacognitive: 1,
      },
    });
    expect(result.quantity.rows).toHaveLength(3);
    expect(result.diversity.rows).toHaveLength(3);
  });
});
