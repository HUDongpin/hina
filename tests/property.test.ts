import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createBipartiteGraph } from "../src/construction";
import { pruneEdges } from "../src/dyad";
import { analyzeDiversity, analyzeQuantity } from "../src/individual";
import {
  detectCommunities,
  type CommunityResult,
} from "../src/mesoscale";
import type { HinaGraph, TabularRow } from "../src/types";
import { projectGraph } from "../src/visualization";

interface SyntheticRow extends TabularRow {
  readonly student: string;
  readonly object: string;
  readonly group: string;
  readonly category: string;
}

const interactionRows = fc
  .array(
    fc.record({
      studentIndex: fc.integer({ min: 0, max: 6 }),
      objectIndex: fc.integer({ min: 0, max: 5 }),
    }),
    { minLength: 1, maxLength: 30 },
  )
  .map((records): readonly SyntheticRow[] =>
    records.map(({ studentIndex, objectIndex }) => ({
      student: `student-${studentIndex}`,
      object: `object-${objectIndex}`,
      group: `group-${studentIndex % 2}`,
      category: `category-${objectIndex % 3}`,
    })),
  );

const connectedRows = fc
  .record({
    actorCount: fc.integer({ min: 2, max: 5 }),
    objectCount: fc.integer({ min: 2, max: 5 }),
    extraPairs: fc.array(
      fc.tuple(fc.nat({ max: 30 }), fc.nat({ max: 30 })),
      { maxLength: 16 },
    ),
  })
  .map(({ actorCount, objectCount, extraPairs }): readonly SyntheticRow[] => {
    const pairs: Array<readonly [number, number]> = [];
    for (let actor = 0; actor < actorCount; actor += 1) {
      pairs.push([actor, actor % objectCount]);
    }
    for (let object = 0; object < objectCount; object += 1) {
      pairs.push([object % actorCount, object]);
    }
    for (const [actor, object] of extraPairs) {
      pairs.push([actor % actorCount, object % objectCount]);
    }
    return pairs.map(([studentIndex, objectIndex]) => ({
      student: `student-${studentIndex}`,
      object: `object-${objectIndex}`,
      group: `group-${studentIndex % 2}`,
      category: `category-${objectIndex % 3}`,
    }));
  });

function build(rows: readonly SyntheticRow[]): HinaGraph {
  return createBipartiteGraph(rows, {
    studentColumn: "student",
    objectColumn: "object",
    groupColumn: "group",
    attributeColumn: "category",
  }).graph;
}

function sorted(values: Iterable<string>): readonly string[] {
  return [...values].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function coMembership(result: CommunityResult): readonly string[] {
  const pairs: string[] = [];
  for (const community of result.communities) {
    const members = sorted(community.members);
    for (let left = 0; left < members.length; left += 1) {
      for (let right = left + 1; right < members.length; right += 1) {
        pairs.push(JSON.stringify([members[left], members[right]]));
      }
    }
  }
  return sorted(pairs);
}

describe("fast-check graph invariants", () => {
  it("aggregates duplicate rows without depending on input order", () => {
    fc.assert(
      fc.property(interactionRows, (rows) => {
        const before = structuredClone(rows);
        const forward = build(rows);
        const reverse = build([...rows].reverse());

        expect(rows).toEqual(before);
        expect(reverse).toEqual(forward);
        expect(
          forward.edges.reduce((sum, edge) => sum + edge.weight, 0),
        ).toBe(rows.length);
        expect(forward.edges.every((edge) => Number.isSafeInteger(edge.weight))).toBe(
          true,
        );
        expect(forward.edges.every((edge) => edge.weight > 0)).toBe(true);
        expect(JSON.parse(JSON.stringify(forward))).toEqual(forward);
      }),
      { numRuns: 80, seed: 20_260_824 },
    );
  });

  it("keeps quantity, diversity and cosine projection within their domains", () => {
    fc.assert(
      fc.property(interactionRows, (rows) => {
        const graph = build(rows);
        const quantity = analyzeQuantity(graph, { group: "group" });
        const diversity = analyzeDiversity(graph, { attribute: "category" });
        const projection = projectGraph(graph, { targetPartition: "object" });
        const objectCount = graph.nodes.filter(
          (node) => node.partition === "object",
        ).length;

        expect(quantity.totalWeight).toBe(rows.length);
        expect(
          Object.values(quantity.quantity).reduce(
            (sum, value) => sum + value,
            0,
          ),
        ).toBe(rows.length);
        expect(
          Object.values(quantity.normalizedQuantity).reduce(
            (sum, value) => sum + value,
            0,
          ),
        ).toBeCloseTo(1, 12);
        expect(
          Object.values(quantity.normalizedQuantityByGroup ?? {}).every(
            (value) => Number.isFinite(value) && value >= 0 && value <= 1,
          ),
        ).toBe(true);
        expect(
          Object.values(diversity.diversity).every(
            (value) =>
              Number.isFinite(value) && value >= 0 && value <= 1 + 1e-12,
          ),
        ).toBe(true);
        expect(projection.similarities).toHaveLength(
          (objectCount * (objectCount - 1)) / 2,
        );
        expect(
          projection.similarities.every(
            ({ similarity }) =>
              Number.isFinite(similarity) &&
              similarity >= 0 &&
              similarity <= 1,
          ),
        ).toBe(true);
      }),
      { numRuns: 80, seed: 20_260_824 },
    );
  });

  it("partitions pruning output exactly and never mutates its input", () => {
    fc.assert(
      fc.property(
        interactionRows,
        fc.constantFrom(0, 0.01, 0.05, 0.5, 1),
        fc.boolean(),
        (rows, alpha, fixActors) => {
          const graph = build(rows);
          const before = structuredClone(graph);
          const result = pruneEdges(graph, {
            alpha,
            fixedPartition: fixActors ? "student" : null,
          });
          const inputIds = sorted(graph.edges.map((edge) => edge.id));
          const significantIds = sorted(
            result.significantEdges.map((edge) => edge.id),
          );
          const removedIds = sorted(result.removedEdges.map((edge) => edge.id));

          expect(graph).toEqual(before);
          expect(sorted([...significantIds, ...removedIds])).toEqual(inputIds);
          expect(
            significantIds.some((edgeId) => removedIds.includes(edgeId)),
          ).toBe(false);
          expect(sorted(result.graph.edges.map((edge) => edge.id))).toEqual(
            significantIds,
          );
          expect(
            result.thresholds.every(
              (threshold) =>
                Number.isSafeInteger(threshold.trials) &&
                Number.isInteger(threshold.threshold) &&
                threshold.probability >= 0 &&
                threshold.probability <= 1,
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 60, seed: 20_260_824 },
    );
  });

  it("keeps fixed-B co-membership stable across rows and edge orientation", () => {
    fc.assert(
      fc.property(connectedRows, (rows) => {
        const graph = build(rows);
        const before = structuredClone(graph);
        const fromRows = detectCommunities(graph, { fixedCommunityCount: 2 });
        const fromReversedRows = detectCommunities(build([...rows].reverse()), {
          fixedCommunityCount: 2,
        });
        const reversedEdges: HinaGraph = {
          ...graph,
          edges: graph.edges.map((edge) => ({
            ...edge,
            source: edge.target,
            target: edge.source,
          })),
        };
        const fromReversedEdges = detectCommunities(reversedEdges, {
          fixedCommunityCount: 2,
        });
        const actorIds = sorted(
          graph.nodes
            .filter((node) => node.partition === "student")
            .map((node) => node.id),
        );

        expect(graph).toEqual(before);
        expect(fromRows.communityCount).toBe(2);
        expect(
          sorted(fromRows.nodeCommunities.map(({ nodeId }) => nodeId)),
        ).toEqual(actorIds);
        expect(
          sorted(fromRows.communities.map(({ id }) => String(id))),
        ).toEqual(["0", "1"]);
        expect(coMembership(fromReversedRows)).toEqual(coMembership(fromRows));
        expect(coMembership(fromReversedEdges)).toEqual(coMembership(fromRows));
        expect(Number.isFinite(fromRows.descriptionLength)).toBe(true);
        expect(Number.isFinite(fromRows.compressionRatio)).toBe(true);
      }),
      { numRuns: 35, seed: 20_260_824 },
    );
  });
});
