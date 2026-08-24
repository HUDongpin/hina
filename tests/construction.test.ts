import { describe, expect, it } from "vitest";

import {
  createBipartiteGraph,
  createTripartiteGraph,
} from "../src/construction";
import { HinaValidationError } from "../src/errors";
import { stableNodeId } from "../src/internal/graph";
import type { TabularRow } from "../src/types";

const sampleRows = [
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
    object: "ask questions",
    group: "A",
    attr: "cognitive",
  },
  {
    student: "Alice",
    object: "evaluating",
    group: "A",
    attr: "metacognitive",
  },
] as const satisfies readonly TabularRow[];

describe("createBipartiteGraph", () => {
  it("builds the upstream weighted graph without mutating input rows", () => {
    const before = structuredClone(sampleRows);
    const result = createBipartiteGraph(sampleRows, {
      studentColumn: "student",
      objectColumn: "object",
      attributeColumn: "attr",
      groupColumn: "group",
    });

    expect(sampleRows).toEqual(before);
    expect(result.diagnostics).toEqual([]);
    expect(result.graph).toMatchObject({
      kind: "bipartite",
      directed: false,
      multigraph: false,
    });
    expect(result.graph.partitions).toEqual([
      {
        id: "student",
        label: "student",
        role: "actor",
        sourceColumns: ["student"],
      },
      {
        id: "object",
        label: "object",
        role: "object",
        sourceColumns: ["object"],
      },
    ]);

    const aliceId = stableNodeId("student", "Alice");
    const askId = stableNodeId("object", "ask questions");
    const alice = result.graph.nodes.find((node) => node.id === aliceId);
    const ask = result.graph.nodes.find((node) => node.id === askId);
    expect(alice).toMatchObject({
      label: "Alice",
      partition: "student",
      attributes: { bipartite: "student", group: "A" },
    });
    expect(ask).toMatchObject({
      label: "ask questions",
      partition: "object",
      attributes: { bipartite: "object", attr: "cognitive" },
    });
    expect(
      result.graph.edges.find(
        (edge) =>
          [edge.source, edge.target].includes(aliceId) &&
          [edge.source, edge.target].includes(askId),
      )?.weight,
    ).toBe(2);
    expect(result.graph.edges).toHaveLength(3);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("drops empty individuals and normalizes other missing cells to NA", () => {
    const rows = [
      { student: "Alice", object: "ask" },
      { student: "", object: 123 },
      { student: null, object: "evaluate" },
      { student: "Bob", object: null },
      { student: "Charlie", object: "   " },
      { student: Number.NaN, object: "ask" },
    ] satisfies readonly TabularRow[];

    const result = createBipartiteGraph(rows, {
      studentColumn: "student",
      objectColumn: "object",
    });

    expect(result.diagnostics[0]).toMatchObject({
      code: "EMPTY_INDIVIDUAL_ROWS_REMOVED",
      details: { count: 3, rowIndices: [1, 2, 5] },
    });
    expect(
      result.graph.nodes
        .filter((node) => node.partition === "object")
        .map((node) => node.label)
        .sort(),
    ).toEqual(["NA", "ask"]);
  });

  it("uses typed partition-aware IDs even when labels collide", () => {
    const result = createBipartiteGraph(
      [
        { student: 1, object: "1" },
        { student: "1", object: "1" },
      ],
      { studentColumn: "student", objectColumn: "object" },
    );

    const oneLabels = result.graph.nodes.filter((node) => node.label === "1");
    expect(oneLabels).toHaveLength(3);
    expect(new Set(oneLabels.map((node) => node.id)).size).toBe(3);
    expect(stableNodeId("student", 1)).not.toBe(
      stableNodeId("student", "1"),
    );
    expect(stableNodeId("student", "1")).not.toBe(
      stableNodeId("object", "1"),
    );
  });

  it("preserves scalar types for object IDs as well as actor IDs", () => {
    const result = createBipartiteGraph(
      [
        { student: "a", object: 1 },
        { student: "b", object: "1" },
        { student: "c", object: "01" },
        { student: "d", object: true },
      ],
      { studentColumn: "student", objectColumn: "object" },
    );
    const objects = result.graph.nodes.filter(
      (node) => node.partition === "object",
    );

    expect(objects).toHaveLength(4);
    expect(new Set(objects.map((node) => node.id)).size).toBe(4);
    expect(objects.map((node) => node.rawValue)).toEqual(
      expect.arrayContaining([1, "1", "01", true]),
    );
  });

  it("reports attribute conflicts and honors each conflict strategy", () => {
    const rows = [
      { student: "Alice", object: "ask", group: "A" },
      { student: "Alice", object: "ask", group: "B" },
    ];
    expect(() =>
      createBipartiteGraph(rows, {
        studentColumn: "student",
        objectColumn: "object",
        groupColumn: "group",
      }),
    ).toThrowError(HinaValidationError);

    const lastResult = createBipartiteGraph(rows, {
      studentColumn: "student",
      objectColumn: "object",
      groupColumn: "group",
      conflictStrategy: "last",
    });
    expect(lastResult.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ATTRIBUTE_CONFLICT" }),
    );
    expect(
      lastResult.graph.nodes.find(
        (node) => node.id === stableNodeId("student", "Alice"),
      )?.attributes["group"],
    ).toBe("B");

    const firstResult = createBipartiteGraph(rows, {
      studentColumn: "student",
      objectColumn: "object",
      groupColumn: "group",
      conflictStrategy: "first",
    });
    expect(
      firstResult.graph.nodes.find(
        (node) => node.id === stableNodeId("student", "Alice"),
      )?.attributes["group"],
    ).toBe("A");

    expect(() =>
      createBipartiteGraph(rows, {
        studentColumn: "student",
        objectColumn: "object",
        groupColumn: "group",
        conflictStrategy: "error",
      }),
    ).toThrowError(HinaValidationError);
  });

  it("rejects unknown or overlapping construction columns", () => {
    expect(() =>
      createBipartiteGraph([{ student: "Alice" }], {
        studentColumn: "student",
        objectColumn: "missing",
      }),
    ).toThrowError(/Input column not found/);

    expect(() =>
      createBipartiteGraph([{ value: "Alice" }], {
        studentColumn: "value",
        objectColumn: "value",
      }),
    ).toThrowError(/must be distinct/);
  });
});

describe("createTripartiteGraph", () => {
  it("uses structured joint values while retaining the legacy display label", () => {
    const rows = [
      {
        student: "Alice",
        object1: "ask questions",
        object2: "tilt head",
        group: "A",
      },
      {
        student: "Alice",
        object1: "ask questions",
        object2: "tilt head",
        group: "A",
      },
      {
        student: "Bob",
        object1: "answer questions",
        object2: null,
        group: "B",
      },
    ] as const satisfies readonly TabularRow[];
    const before = structuredClone(rows);
    const result = createTripartiteGraph(rows, {
      studentColumn: "student",
      object1Column: "object1",
      object2Column: "object2",
      groupColumn: "group",
    });

    expect(rows).toEqual(before);
    expect(result.graph.kind).toBe("tripartite");
    const joint = result.graph.nodes.find(
      (node) => node.label === "ask questions**tilt head",
    );
    expect(joint).toMatchObject({
      value: ["ask questions", "tilt head"],
      partition: "(object1,object2)",
      attributes: {
        bipartite: "(object1,object2)",
        tripartite: true,
        joint: {
          columns: ["object1", "object2"],
          values: ["ask questions", "tilt head"],
        },
      },
    });
    expect(
      result.graph.edges.find((edge) =>
        [edge.source, edge.target].includes(joint!.id),
      )?.weight,
    ).toBe(2);
    expect(result.graph.nodes.some((node) => node.label === "answer questions**NA"))
      .toBe(true);
  });

  it("does not collide when legacy delimiter labels are ambiguous", () => {
    const result = createTripartiteGraph(
      [
        { student: "Alice", object1: "A**B", object2: "C" },
        { student: "Bob", object1: "A", object2: "B**C" },
      ],
      {
        studentColumn: "student",
        object1Column: "object1",
        object2Column: "object2",
      },
    );
    const jointNodes = result.graph.nodes.filter(
      (node) => node.partition === "(object1,object2)",
    );

    expect(jointNodes.map((node) => node.label)).toEqual([
      "A**B**C",
      "A**B**C",
    ]);
    expect(new Set(jointNodes.map((node) => node.id)).size).toBe(2);
    expect(jointNodes.map((node) => node.value)).toEqual(
      expect.arrayContaining([
        ["A**B", "C"],
        ["A", "B**C"],
      ]),
    );
  });

  it("preserves mixed scalar components and normalizes missing values", () => {
    const result = createTripartiteGraph(
      [
        { student: 1, object1: "ask", object2: true },
        { student: 2, object1: 123, object2: "shake" },
        { student: "Alice", object1: "evaluate", object2: null },
        { student: null, object1: "ignored", object2: "nod" },
      ],
      {
        studentColumn: "student",
        object1Column: "object1",
        object2Column: "object2",
      },
    );
    const actors = result.graph.nodes.filter(
      (node) => node.partition === "student",
    );
    const jointNodes = result.graph.nodes.filter(
      (node) => node.partition === "(object1,object2)",
    );

    expect(actors.map((node) => node.rawValue)).toEqual(
      expect.arrayContaining([1, 2, "Alice"]),
    );
    expect(jointNodes.map((node) => node.value)).toEqual(
      expect.arrayContaining([
        ["ask", true],
        [123, "shake"],
        ["evaluate", null],
      ]),
    );
    expect(jointNodes.map((node) => node.label)).toEqual(
      expect.arrayContaining(["ask**True", "123**shake", "evaluate**NA"]),
    );
    expect(result.graph.edges).toHaveLength(3);
    const removalDiagnostic = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "EMPTY_INDIVIDUAL_ROWS_REMOVED",
    );
    expect(removalDiagnostic?.details).toMatchObject({
      count: 1,
      rowIndices: [3],
    });
  });
});
