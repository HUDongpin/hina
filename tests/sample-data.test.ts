import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createBipartiteGraph,
  createTripartiteGraph,
} from "../src/construction";
import { pruneEdges, type PruningThreshold } from "../src/dyad";
import { analyzeIndividuals } from "../src/individual";
import {
  detectCommunities,
  type CommunityResult,
} from "../src/mesoscale";
import { parseCsv } from "../src/io";
import type { HinaEdge, HinaGraph } from "../src/types";
import { projectGraph } from "../src/visualization";

interface GoldenEdge {
  readonly source: string;
  readonly target: string;
  readonly weight: number;
}

interface GoldenGraph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly totalWeight: number;
  readonly actorCount: number;
  readonly objectCount: number;
  readonly actors: readonly string[];
  readonly objects: readonly string[];
  readonly edges: readonly GoldenEdge[];
}

interface GoldenIndividualRow {
  readonly actor: string;
  readonly quantity: number;
  readonly normalizedQuantity: number;
  readonly normalizedQuantityByGroup: number;
  readonly diversity: number;
}

interface GoldenIndividual {
  readonly categoryCount: number;
  readonly rows: readonly GoldenIndividualRow[];
}

interface GoldenPruning {
  readonly alpha: number;
  readonly fixedPartition: string | null;
  readonly thresholds: readonly {
    readonly scope: string;
    readonly trials: number;
    readonly probability: number;
    readonly threshold: number;
  }[];
  readonly significantEdges: readonly GoldenEdge[];
}

interface GoldenObjectProjection {
  readonly community: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly totalWeight: number;
  readonly edges: readonly GoldenEdge[];
}

interface GoldenCommunities {
  readonly fixedCommunityCount: number;
  readonly communityCount: number;
  readonly partition: readonly (readonly string[])[];
  readonly compressionRatio: number;
  readonly descriptionLength: number;
  readonly baselineDescriptionLength: number;
  readonly objectProjections?: readonly GoldenObjectProjection[];
}

interface GoldenProjection {
  readonly targetPartition: string;
  readonly metric: "cosine-l2";
  readonly similarities: readonly {
    readonly source: string;
    readonly target: string;
    readonly similarity: number;
  }[];
}

interface GoldenFixture {
  readonly schemaVersion: number;
  readonly provenance: {
    readonly upstreamRepository: string;
    readonly upstreamCommit: string;
    readonly upstreamVersion: string;
    readonly pythonHashSeed: string;
    readonly generator: string;
  };
  readonly dataset: {
    readonly source: string;
    readonly sha256: string;
    readonly rowCount: number;
    readonly columns: readonly string[];
    readonly uniqueStudents: number;
    readonly uniqueCodes: number;
    readonly uniqueLessons: number;
  };
  readonly bipartite: {
    readonly graph: GoldenGraph;
    readonly individual: GoldenIndividual;
    readonly pruning: {
      readonly global: GoldenPruning;
      readonly fixedActor: GoldenPruning;
    };
    readonly communities: GoldenCommunities;
    readonly projection: GoldenProjection;
  };
  readonly tripartite: {
    readonly graph: GoldenGraph;
    readonly individual: GoldenIndividual;
    readonly communities: GoldenCommunities;
  };
}

const csvPath = new URL("../examples/data/yu-hina-long.csv", import.meta.url);
const fixturePath = new URL(
  "./fixtures/upstream-f7bb3df/yu-hina-long.golden.json",
  import.meta.url,
);
const csvText = readFileSync(csvPath, "utf8");
const golden = JSON.parse(readFileSync(fixturePath, "utf8")) as GoldenFixture;
const dataset = parseCsv(csvText, { name: "yu-hina-long.csv" });
const bipartite = createBipartiteGraph(dataset.rows, {
  studentColumn: "StudentId",
  objectColumn: "Code",
  groupColumn: "Group",
}).graph;
const tripartite = createTripartiteGraph(dataset.rows, {
  studentColumn: "StudentId",
  object1Column: "Code",
  object2Column: "Lesson",
  groupColumn: "Group",
}).graph;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sorted(values: Iterable<string>): readonly string[] {
  return [...values].sort(compareText);
}

function canonicalEdges(
  graph: HinaGraph,
  actorPartition: string | null,
  edges: readonly HinaEdge[] = graph.edges,
): readonly GoldenEdge[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return edges
    .map((edge): GoldenEdge => {
      const sourceNode = nodes.get(edge.source)!;
      const targetNode = nodes.get(edge.target)!;
      let source = sourceNode.label;
      let target = targetNode.label;
      if (actorPartition !== null) {
        const sourceIsActor = sourceNode.partition === actorPartition;
        const targetIsActor = targetNode.partition === actorPartition;
        expect(sourceIsActor).not.toBe(targetIsActor);
        if (targetIsActor) {
          [source, target] = [target, source];
        }
      } else if (compareText(target, source) < 0) {
        [source, target] = [target, source];
      }
      return { source, target, weight: edge.weight };
    })
    .sort((left, right) =>
      compareText(left.source, right.source) ||
      compareText(left.target, right.target),
    );
}

function expectScientificClose(actual: number, reference: number): void {
  expect(Math.abs(actual - reference)).toBeLessThanOrEqual(
    1e-12 + 1e-10 * Math.abs(reference),
  );
}

function expectMdlClose(actual: number, reference: number): void {
  expect(Math.abs(actual - reference)).toBeLessThanOrEqual(
    1e-10 + 1e-9 * Math.abs(reference),
  );
}

function expectGraphParity(
  graph: HinaGraph,
  actorPartition: string,
  reference: GoldenGraph,
): void {
  const actorLabels = sorted(
    graph.nodes
      .filter((node) => node.partition === actorPartition)
      .map((node) => node.label),
  );
  const objectLabels = sorted(
    graph.nodes
      .filter((node) => node.partition !== actorPartition)
      .map((node) => node.label),
  );

  expect(graph.nodes).toHaveLength(reference.nodeCount);
  expect(graph.edges).toHaveLength(reference.edgeCount);
  expect(graph.edges.reduce((sum, edge) => sum + edge.weight, 0)).toBe(
    reference.totalWeight,
  );
  expect(actorLabels).toHaveLength(reference.actorCount);
  expect(objectLabels).toHaveLength(reference.objectCount);
  expect(actorLabels).toEqual(reference.actors);
  expect(objectLabels).toEqual(reference.objects);
  expect(canonicalEdges(graph, actorPartition)).toEqual(reference.edges);
}

function expectIndividualParity(
  graph: HinaGraph,
  reference: GoldenIndividual,
): void {
  const before = structuredClone(graph);
  const result = analyzeIndividuals(graph, { group: "Group" });
  const actualRows = new Map(result.rows.map((row) => [row.label, row]));

  expect(graph).toEqual(before);
  expect(result.diversity.categoryCount).toBe(reference.categoryCount);
  expect(actualRows.size).toBe(reference.rows.length);
  for (const expected of reference.rows) {
    const actual = actualRows.get(expected.actor)!;
    expect(actual.quantity).toBe(expected.quantity);
    expectScientificClose(
      actual.normalizedQuantity,
      expected.normalizedQuantity,
    );
    expectScientificClose(
      actual.normalizedQuantityByGroup!,
      expected.normalizedQuantityByGroup,
    );
    expectScientificClose(actual.diversity, expected.diversity);
  }
}

function canonicalThresholds(
  graph: HinaGraph,
  thresholds: readonly PruningThreshold[],
): GoldenPruning["thresholds"] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return thresholds
    .map((threshold) => ({
      scope:
        threshold.scope === "global"
          ? "global"
          : nodes.get(threshold.scope)!.label,
      trials: threshold.trials,
      probability: threshold.probability,
      threshold: threshold.threshold,
    }))
    .sort((left, right) => compareText(left.scope, right.scope));
}

function expectPruningParity(
  graph: HinaGraph,
  reference: GoldenPruning,
): void {
  const before = structuredClone(graph);
  const result = pruneEdges(graph, {
    alpha: reference.alpha,
    fixedPartition:
      reference.fixedPartition === null ? null : "StudentId",
  });
  const actualThresholds = canonicalThresholds(graph, result.thresholds);

  expect(graph).toEqual(before);
  expect(canonicalEdges(graph, "StudentId", result.significantEdges)).toEqual(
    reference.significantEdges,
  );
  expect(result.graph.edges).toHaveLength(reference.significantEdges.length);
  expect(result.removedEdges).toHaveLength(
    graph.edges.length - reference.significantEdges.length,
  );
  expect(actualThresholds).toHaveLength(reference.thresholds.length);
  for (let index = 0; index < reference.thresholds.length; index += 1) {
    const actual = actualThresholds[index]!;
    const expected = reference.thresholds[index]!;
    expect(actual.scope).toBe(expected.scope);
    expect(actual.trials).toBe(expected.trials);
    expect(actual.threshold).toBe(expected.threshold);
    expectScientificClose(actual.probability, expected.probability);
  }
}

function canonicalPartition(
  result: CommunityResult,
  graph: HinaGraph,
): {
  readonly partition: readonly (readonly string[])[];
  readonly communityMap: ReadonlyMap<number, number>;
} {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const communities = result.communities
    .map((community) => ({
      sourceId: community.id,
      members: sorted(
        community.members.map((nodeId) => nodes.get(nodeId)!.label),
      ),
    }))
    .sort((left, right) =>
      compareText(JSON.stringify(left.members), JSON.stringify(right.members)),
    );
  return {
    partition: communities.map(({ members }) => members),
    communityMap: new Map(
      communities.map(({ sourceId }, canonicalId) => [sourceId, canonicalId]),
    ),
  };
}

function coMembership(
  partition: readonly (readonly string[])[],
): readonly string[] {
  const pairs: string[] = [];
  for (const members of partition) {
    for (let left = 0; left < members.length; left += 1) {
      for (let right = left + 1; right < members.length; right += 1) {
        pairs.push(JSON.stringify([members[left], members[right]]));
      }
    }
  }
  return sorted(pairs);
}

function expectCommunityParity(
  graph: HinaGraph,
  reference: GoldenCommunities,
): CommunityResult {
  const before = structuredClone(graph);
  const result = detectCommunities(graph, {
    fixedCommunityCount: reference.fixedCommunityCount,
  });
  const actual = canonicalPartition(result, graph);

  expect(graph).toEqual(before);
  expect(result.communityCount).toBe(reference.communityCount);
  expect(
    sorted(actual.partition.flat()),
  ).toEqual(sorted(reference.partition.flat()));
  expect(coMembership(actual.partition)).toEqual(
    coMembership(reference.partition),
  );
  expectMdlClose(result.compressionRatio, reference.compressionRatio);
  expectMdlClose(result.descriptionLength, reference.descriptionLength);
  expect(result.subgraphs).toHaveLength(reference.communityCount);
  return result;
}

function canonicalObjectProjections(
  result: CommunityResult,
  sourceGraph: HinaGraph,
): readonly GoldenObjectProjection[] {
  const { communityMap } = canonicalPartition(result, sourceGraph);
  return (result.objectProjections ?? [])
    .map(({ community, graph }) => ({
      community: communityMap.get(community)!,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      totalWeight: graph.edges.reduce((sum, edge) => sum + edge.weight, 0),
      edges: canonicalEdges(graph, null),
    }))
    .sort((left, right) => left.community - right.community);
}

describe("391-row Yu HINA parity fixture", () => {
  it("pins the source bytes and upstream oracle provenance", () => {
    expect(golden.schemaVersion).toBe(1);
    expect(golden.provenance).toMatchObject({
      upstreamRepository: "https://github.com/SHF-NAILResearchGroup/HINA",
      upstreamCommit: "f7bb3df3609aa6b0b6d5c98108e940f662053bb5",
      upstreamVersion: "0.7.2",
      pythonVersion: "3.11.16",
      pythonHashSeed: "0",
      generator: "scripts/python-oracle.py",
    });
    expect(createHash("sha256").update(csvText).digest("hex")).toBe(
      golden.dataset.sha256,
    );
    expect(dataset.rows).toHaveLength(391);
    expect(dataset.rows).toHaveLength(golden.dataset.rowCount);
    expect(dataset.columns).toEqual(golden.dataset.columns);
    expect(golden.dataset).toMatchObject({
      source: "examples/data/yu-hina-long.csv",
      uniqueStudents: 86,
      uniqueCodes: 7,
      uniqueLessons: 2,
    });
  });

  it("matches the complete weighted bipartite and tripartite graphs", () => {
    expect(bipartite.kind).toBe("bipartite");
    expect(bipartite.partitions.map(({ id }) => id)).toEqual([
      "StudentId",
      "Code",
    ]);
    expectGraphParity(bipartite, "StudentId", golden.bipartite.graph);

    expect(tripartite.kind).toBe("tripartite");
    expect(tripartite.partitions.map(({ id }) => id)).toEqual([
      "StudentId",
      "(Code,Lesson)",
    ]);
    expectGraphParity(tripartite, "StudentId", golden.tripartite.graph);
    expect(
      tripartite.nodes
        .filter((node) => node.partition === "(Code,Lesson)")
        .every(
          (node) =>
            Array.isArray(node.value) &&
            typeof node.attributes["joint"] === "object",
        ),
    ).toBe(true);
  });

  it("matches individual quantity, group normalization and diversity", () => {
    expectIndividualParity(bipartite, golden.bipartite.individual);
    expectIndividualParity(tripartite, golden.tripartite.individual);
  });

  it("matches global and fixed-actor SciPy binomial pruning", () => {
    expectPruningParity(bipartite, golden.bipartite.pruning.global);
    expectPruningParity(bipartite, golden.bipartite.pruning.fixedActor);
  });

  it("matches fixed-B community co-membership and MDL values", () => {
    expectCommunityParity(bipartite, golden.bipartite.communities);
    expectCommunityParity(tripartite, golden.tripartite.communities);
  });

  it("matches cosine and tripartite community object projections", () => {
    const projected = projectGraph(bipartite, { targetPartition: "Code" });
    const nodeLabels = new Map(
      bipartite.nodes.map((node) => [node.id, node.label]),
    );
    const similarities = projected.similarities
      .map(({ source, target, similarity }) => {
        let sourceLabel = nodeLabels.get(source)!;
        let targetLabel = nodeLabels.get(target)!;
        if (compareText(targetLabel, sourceLabel) < 0) {
          [sourceLabel, targetLabel] = [targetLabel, sourceLabel];
        }
        return { source: sourceLabel, target: targetLabel, similarity };
      })
      .sort((left, right) =>
        compareText(left.source, right.source) ||
        compareText(left.target, right.target),
      );
    expect(projected.metric).toBe(golden.bipartite.projection.metric);
    expect(similarities).toHaveLength(
      golden.bipartite.projection.similarities.length,
    );
    for (let index = 0; index < similarities.length; index += 1) {
      const actual = similarities[index]!;
      const expected = golden.bipartite.projection.similarities[index]!;
      expect(actual.source).toBe(expected.source);
      expect(actual.target).toBe(expected.target);
      expectScientificClose(actual.similarity, expected.similarity);
    }

    const communities = expectCommunityParity(
      tripartite,
      golden.tripartite.communities,
    );
    expect(canonicalObjectProjections(communities, tripartite)).toEqual(
      golden.tripartite.communities.objectProjections,
    );
  });
});
