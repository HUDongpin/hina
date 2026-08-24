import { HinaValidationError } from "./errors";
import {
  assertValidGraph,
  buildAdjacency,
  buildNodeIndex,
  stableEdgeId,
  stableNodeId,
} from "./internal/graph";
import { logChoose, logGamma, logMultiset } from "./internal/math";
import type {
  HinaDiagnostic,
  HinaEdge,
  HinaGraph,
  HinaNode,
  HinaPartition,
  JsonObject,
  JsonValue,
} from "./types";

const OBJECTIVE_TIE_TOLERANCE = 1e-12;

export interface CommunityOptions {
  readonly fixedCommunityCount?: number;
  readonly targetPartition?: string;
}

export interface NodeCommunity {
  readonly nodeId: string;
  readonly community: number;
}

export interface Community {
  readonly id: number;
  readonly members: readonly string[];
}

export interface CommunityGraph {
  readonly community: number;
  readonly graph: HinaGraph;
}

export interface CommunityResult {
  readonly communityCount: number;
  readonly nodeCommunities: readonly NodeCommunity[];
  readonly communities: readonly Community[];
  readonly compressionRatio: number;
  readonly descriptionLength: number;
  readonly graph: HinaGraph;
  readonly subgraphs: readonly CommunityGraph[];
  readonly objectProjections?: readonly CommunityGraph[];
  readonly diagnostics: readonly HinaDiagnostic[];
}

interface Cluster {
  readonly members: readonly string[];
  readonly weights: ReadonlyMap<string, number>;
}

interface PartitionSnapshot {
  readonly communityCount: number;
  readonly descriptionLength: number;
  readonly clusters: readonly Cluster[];
}

interface MergeCandidate {
  readonly delta: number;
  readonly leftKey: string;
  readonly rightKey: string;
}

interface JointMetadata {
  readonly columns: readonly [string, string];
  readonly values: readonly [JsonValue, JsonValue];
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareEdges(left: HinaEdge, right: HinaEdge): number {
  return compareStrings(left.id, right.id);
}

function clusterKey(cluster: Cluster): string {
  return JSON.stringify(cluster.members);
}

function cloneAttributes(attributes: JsonObject): JsonObject {
  return { ...attributes };
}

function cloneNode(node: HinaNode): HinaNode {
  return { ...node, attributes: cloneAttributes(node.attributes) };
}

function cloneEdge(edge: HinaEdge): HinaEdge {
  return { ...edge, attributes: cloneAttributes(edge.attributes) };
}

function clonePartition(partition: HinaPartition): HinaPartition {
  return { ...partition, sourceColumns: [...partition.sourceColumns] };
}

function cloneCluster(cluster: Cluster): Cluster {
  return {
    members: [...cluster.members],
    weights: new Map(cluster.weights),
  };
}

function objectiveTolerance(left: number, right: number): number {
  return (
    OBJECTIVE_TIE_TOLERANCE * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function isObjectiveLower(candidate: number, incumbent: number): boolean {
  return candidate < incumbent - objectiveTolerance(candidate, incumbent);
}

function assertSafeCount(value: number, message: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HinaValidationError("INVALID_WEIGHT", message, {
      value: String(value),
    });
  }
}

function mergeWeights(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  const merged = new Map(left);
  for (const [nodeId, weight] of right) {
    const combined = (merged.get(nodeId) ?? 0) + weight;
    assertSafeCount(
      combined,
      "A merged community weight exceeds the safe-integer range.",
    );
    merged.set(nodeId, combined);
  }
  return merged;
}

function mergeClusters(left: Cluster, right: Cluster): Cluster {
  return {
    members: [...left.members, ...right.members].sort(compareStrings),
    weights: mergeWeights(left.weights, right.weights),
  };
}

function clusterDescriptionLength(cluster: Cluster): number {
  const size = cluster.members.length;
  let result = -logGamma(size);
  for (const weight of cluster.weights.values()) {
    result += logMultiset(size, weight);
  }
  return result;
}

function mergeDelta(left: Cluster, right: Cluster): number {
  return (
    clusterDescriptionLength(mergeClusters(left, right)) -
    clusterDescriptionLength(left) -
    clusterDescriptionLength(right)
  );
}

function mergeCandidate(left: Cluster, right: Cluster): MergeCandidate {
  const leftKey = clusterKey(left);
  const rightKey = clusterKey(right);
  const leftComesFirst = compareStrings(leftKey, rightKey) <= 0;
  const ordered = leftComesFirst
    ? ([leftKey, rightKey] as const)
    : ([rightKey, leftKey] as const);
  return {
    delta: leftComesFirst
      ? mergeDelta(left, right)
      : mergeDelta(right, left),
    leftKey: ordered[0],
    rightKey: ordered[1],
  };
}

function compareMergeCandidates(
  left: MergeCandidate,
  right: MergeCandidate,
): number {
  if (left.delta < right.delta) {
    return -1;
  }
  if (left.delta > right.delta) {
    return 1;
  }
  const leftComparison = compareStrings(left.leftKey, right.leftKey);
  return leftComparison === 0
    ? compareStrings(left.rightKey, right.rightKey)
    : leftComparison;
}

class MergeCandidateHeap {
  private readonly values: MergeCandidate[] = [];

  public push(candidate: MergeCandidate): void {
    if (!Number.isFinite(candidate.delta)) {
      throw new HinaValidationError(
        "NUMERICAL_ERROR",
        "An MDL merge delta is not finite.",
        { leftCluster: candidate.leftKey, rightCluster: candidate.rightKey },
      );
    }
    this.values.push(candidate);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (
        compareMergeCandidates(this.values[parent]!, this.values[index]!) <= 0
      ) {
        break;
      }
      [this.values[parent], this.values[index]] = [
        this.values[index]!,
        this.values[parent]!,
      ];
      index = parent;
    }
  }

  public pop(): MergeCandidate | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (first === undefined || last === undefined) {
      return first;
    }
    if (this.values.length === 0) {
      return first;
    }

    this.values[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (
        left < this.values.length &&
        compareMergeCandidates(this.values[left]!, this.values[smallest]!) < 0
      ) {
        smallest = left;
      }
      if (
        right < this.values.length &&
        compareMergeCandidates(this.values[right]!, this.values[smallest]!) < 0
      ) {
        smallest = right;
      }
      if (smallest === index) {
        break;
      }
      [this.values[index], this.values[smallest]] = [
        this.values[smallest]!,
        this.values[index]!,
      ];
      index = smallest;
    }
    return first;
  }
}

function resolveTargetPartition(
  graph: HinaGraph,
  requested: string | undefined,
): string {
  if (requested !== undefined) {
    if (!graph.partitions.some((partition) => partition.id === requested)) {
      throw new HinaValidationError(
        "INVALID_PARTITION",
        `Unknown target partition: ${requested}`,
        { partitionId: requested },
      );
    }
    return requested;
  }

  const individualPartitions = graph.partitions.filter(
    (partition) => partition.role === "actor",
  );
  if (individualPartitions.length === 1) {
    return individualPartitions[0]!.id;
  }
  if (individualPartitions.length > 1) {
    throw new HinaValidationError(
      "INVALID_PARTITION",
      "Multiple individual partitions exist; targetPartition is required.",
      { partitionCount: individualPartitions.length },
    );
  }
  throw new HinaValidationError(
    "INVALID_PARTITION",
    "No individual partition exists; targetPartition is required.",
  );
}

function validateFixedCommunityCount(
  fixedCommunityCount: number | undefined,
  nodeCount: number,
): void {
  if (fixedCommunityCount === undefined) {
    return;
  }
  if (
    !Number.isSafeInteger(fixedCommunityCount) ||
    fixedCommunityCount < 1 ||
    fixedCommunityCount > nodeCount
  ) {
    throw new HinaValidationError(
      "INVALID_COMMUNITY_COUNT",
      `fixedCommunityCount must be an integer in [1, ${nodeCount}].`,
      { fixedCommunityCount },
    );
  }
}

function graphSubset(
  graph: HinaGraph,
  includedNodeIds: ReadonlySet<string>,
  includedEdges: readonly HinaEdge[],
): HinaGraph {
  return {
    ...graph,
    partitions: graph.partitions.map(clonePartition),
    nodes: graph.nodes
      .filter((node) => includedNodeIds.has(node.id))
      .map(cloneNode)
      .sort((left, right) => compareStrings(left.id, right.id)),
    edges: includedEdges.map(cloneEdge).sort(compareEdges),
  };
}

function labelForValue(value: JsonValue): string {
  if (value === null) {
    return "NA";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

function readJointMetadata(node: HinaNode): JointMetadata | null {
  const candidate = node.attributes["joint"];
  if (
    candidate === null ||
    Array.isArray(candidate) ||
    typeof candidate !== "object"
  ) {
    return null;
  }

  const joint = candidate as Readonly<Record<string, JsonValue>>;
  const columns = joint["columns"];
  const values = joint["values"];
  if (
    !Array.isArray(columns) ||
    columns.length !== 2 ||
    typeof columns[0] !== "string" ||
    typeof columns[1] !== "string" ||
    !Array.isArray(values) ||
    values.length !== 2 ||
    !isJsonValue(values[0]) ||
    !isJsonValue(values[1])
  ) {
    return null;
  }

  return {
    columns: [columns[0], columns[1]],
    values: [values[0], values[1]],
  };
}

function createObjectProjection(
  community: number,
  subgraph: HinaGraph,
  diagnostics: HinaDiagnostic[],
): HinaGraph {
  const jointPartition = subgraph.partitions.find(
    (partition) => partition.role === "composite",
  );
  if (jointPartition === undefined) {
    throw new HinaValidationError(
      "INVALID_GRAPH",
      "A tripartite graph must contain a composite partition.",
    );
  }

  const fallbackColumns: readonly [string, string] = [
    jointPartition.sourceColumns[0] ?? "object1",
    jointPartition.sourceColumns[1] ?? "object2",
  ];
  let columns = fallbackColumns;
  for (const node of subgraph.nodes) {
    if (node.partition !== jointPartition.id) {
      continue;
    }
    const metadata = readJointMetadata(node);
    if (metadata !== null) {
      columns = metadata.columns;
      break;
    }
  }

  const leftPartition: HinaPartition = {
    id: `projection:${jointPartition.id}:0`,
    label: columns[0],
    role: "projection",
    sourceColumns: [columns[0]],
  };
  const rightPartition: HinaPartition = {
    id: `projection:${jointPartition.id}:1`,
    label: columns[1],
    role: "projection",
    sourceColumns: [columns[1]],
  };

  const subgraphNodeIndex = buildNodeIndex(subgraph);
  const projectedNodes = new Map<string, HinaNode>();
  const projectedWeights = new Map<string, number>();
  const projectedEndpoints = new Map<string, readonly [string, string]>();

  for (const edge of subgraph.edges) {
    const source = subgraphNodeIndex.get(edge.source)!;
    const target = subgraphNodeIndex.get(edge.target)!;
    const jointNode =
      source.partition === jointPartition.id
        ? source
        : target.partition === jointPartition.id
          ? target
          : null;
    if (jointNode === null) {
      continue;
    }

    const metadata = readJointMetadata(jointNode);
    if (metadata === null) {
      diagnostics.push({
        code: "MALFORMED_JOINT_NODE",
        severity: "warning",
        message: "A composite node was omitted from object projection.",
        details: { community, nodeId: jointNode.id },
      });
      continue;
    }
    if (metadata.values[0] === "NA" || metadata.values[1] === "NA") {
      continue;
    }

    const leftId = stableNodeId(leftPartition.id, metadata.values[0]);
    const rightId = stableNodeId(rightPartition.id, metadata.values[1]);
    if (!projectedNodes.has(leftId)) {
      projectedNodes.set(leftId, {
        id: leftId,
        label: labelForValue(metadata.values[0]),
        value: metadata.values[0],
        partition: leftPartition.id,
        attributes: { sourceColumn: metadata.columns[0] },
      });
    }
    if (!projectedNodes.has(rightId)) {
      projectedNodes.set(rightId, {
        id: rightId,
        label: labelForValue(metadata.values[1]),
        value: metadata.values[1],
        partition: rightPartition.id,
        attributes: { sourceColumn: metadata.columns[1] },
      });
    }

    const projectedEdgeId = stableEdgeId(leftId, rightId);
    const combinedWeight = (projectedWeights.get(projectedEdgeId) ?? 0) + edge.weight;
    assertSafeCount(
      combinedWeight,
      "An object-projection edge weight exceeds the safe-integer range.",
    );
    projectedWeights.set(projectedEdgeId, combinedWeight);
    projectedEndpoints.set(projectedEdgeId, [leftId, rightId]);
  }

  const edges = [...projectedWeights.entries()]
    .map(([edgeId, weight]): HinaEdge => {
      const endpoints = projectedEndpoints.get(edgeId)!;
      return {
        id: edgeId,
        source: endpoints[0],
        target: endpoints[1],
        weight,
        attributes: { community },
      };
    })
    .sort(compareEdges);

  return {
    kind: "projection",
    directed: false,
    multigraph: false,
    partitions: [leftPartition, rightPartition],
    nodes: [...projectedNodes.values()].sort((left, right) =>
      compareStrings(left.id, right.id),
    ),
    edges,
  };
}

/**
 * Detect HINA communities using deterministic greedy MDL agglomeration.
 *
 * Merge ties are resolved from canonical member IDs, community labels are
 * normalized after selection, and the input graph is never mutated.
 */
export function detectCommunities(
  graph: HinaGraph,
  options: CommunityOptions = {},
): CommunityResult {
  assertValidGraph(graph);
  if (graph.partitions.length !== 2) {
    throw new HinaValidationError(
      "INVALID_GRAPH",
      "HINA community detection requires exactly two graph partitions.",
      { partitionCount: graph.partitions.length },
    );
  }
  const targetPartition = resolveTargetPartition(graph, options.targetPartition);
  const nodeIndex = buildNodeIndex(graph);
  const adjacency = buildAdjacency(graph);
  const targetNodes = graph.nodes
    .filter((node) => node.partition === targetPartition)
    .sort((left, right) => compareStrings(left.id, right.id));

  if (targetNodes.length === 0) {
    throw new HinaValidationError(
      "INVALID_PARTITION",
      "The target partition contains no nodes.",
      { partitionId: targetPartition },
    );
  }
  validateFixedCommunityCount(options.fixedCommunityCount, targetNodes.length);

  const targetIds = new Set(targetNodes.map((node) => node.id));
  const oppositeNodeIds = new Set<string>();
  let totalWeight = 0;
  for (const edge of graph.edges) {
    if (!Number.isSafeInteger(edge.weight) || edge.weight < 0) {
      throw new HinaValidationError(
        "INVALID_WEIGHT",
        "MDL community detection requires non-negative safe-integer weights.",
        { edgeId: edge.id, weight: String(edge.weight) },
      );
    }

    const sourceIsTarget = targetIds.has(edge.source);
    const targetIsTarget = targetIds.has(edge.target);
    if (sourceIsTarget === targetIsTarget) {
      throw new HinaValidationError(
        "INVALID_GRAPH",
        "Every analyzed edge must have exactly one endpoint in the target partition.",
        { edgeId: edge.id, partitionId: targetPartition },
      );
    }
    oppositeNodeIds.add(sourceIsTarget ? edge.target : edge.source);
    totalWeight += edge.weight;
    assertSafeCount(
      totalWeight,
      "The total graph weight exceeds the safe-integer range.",
    );
  }

  if (graph.edges.length === 0 || oppositeNodeIds.size === 0 || totalWeight === 0) {
    throw new HinaValidationError(
      "INVALID_GRAPH",
      "MDL community detection requires at least one positive-weight edge.",
      { edgeCount: graph.edges.length, totalWeight },
    );
  }

  const diagnostics: HinaDiagnostic[] = [];
  for (const node of targetNodes) {
    if (adjacency.get(node.id)!.length === 0) {
      diagnostics.push({
        code: "ISOLATED_TARGET_NODE",
        severity: "warning",
        message: "An isolated target node participates with an all-zero profile.",
        details: { nodeId: node.id, partitionId: targetPartition },
      });
    }
  }

  const initialClusters: Cluster[] = targetNodes.map((node) => {
    const weights = new Map<string, number>();
    for (const adjacent of adjacency.get(node.id)!) {
      const opposite = nodeIndex.get(adjacent.nodeId)!;
      if (opposite.partition === targetPartition) {
        throw new HinaValidationError(
          "INVALID_GRAPH",
          "Target-partition nodes must not be adjacent to each other.",
          { edgeId: adjacent.edge.id, partitionId: targetPartition },
        );
      }
      const combined = (weights.get(opposite.id) ?? 0) + adjacent.edge.weight;
      assertSafeCount(
        combined,
        "A node interaction profile exceeds the safe-integer range.",
      );
      weights.set(opposite.id, combined);
    }
    return { members: [node.id], weights };
  });

  const nodeCount = initialClusters.length;
  const oppositeNodeCount = oppositeNodeIds.size;
  const constant = (communityCount: number): number => {
    const multisetTypes = oppositeNodeCount * communityCount;
    assertSafeCount(
      multisetTypes,
      "The MDL state space exceeds the safe-integer range.",
    );
    return (
      Math.log(nodeCount) +
      logChoose(nodeCount - 1, communityCount - 1) +
      logGamma(nodeCount) +
      logMultiset(multisetTypes, totalWeight)
    );
  };

  const sortedInitialClusters = initialClusters.sort((left, right) =>
    compareStrings(clusterKey(left), clusterKey(right)),
  );
  const activeClusters = new Map(
    sortedInitialClusters.map((cluster) => [clusterKey(cluster), cluster]),
  );
  const mergeHeap = new MergeCandidateHeap();
  for (let left = 0; left < sortedInitialClusters.length; left += 1) {
    for (
      let right = left + 1;
      right < sortedInitialClusters.length;
      right += 1
    ) {
      mergeHeap.push(
        mergeCandidate(sortedInitialClusters[left]!, sortedInitialClusters[right]!),
      );
    }
  }

  let descriptionLength =
    constant(nodeCount) +
    sortedInitialClusters.reduce(
      (sum, cluster) => sum + clusterDescriptionLength(cluster),
      0,
    );
  const snapshots: PartitionSnapshot[] = [
    {
      communityCount: nodeCount,
      descriptionLength,
      clusters: sortedInitialClusters.map(cloneCluster),
    },
  ];

  while (activeClusters.size > 1) {
    const previousCount = activeClusters.size;
    let candidate: MergeCandidate | undefined;
    while (candidate === undefined) {
      const popped = mergeHeap.pop();
      if (popped === undefined) {
        throw new HinaValidationError(
          "NUMERICAL_ERROR",
          "The MDL merge queue was exhausted before one community remained.",
        );
      }
      if (
        activeClusters.has(popped.leftKey) &&
        activeClusters.has(popped.rightKey)
      ) {
        candidate = popped;
      }
    }

    const left = activeClusters.get(candidate.leftKey)!;
    const right = activeClusters.get(candidate.rightKey)!;
    const merged = mergeClusters(left, right);
    const mergedKey = clusterKey(merged);
    activeClusters.delete(candidate.leftKey);
    activeClusters.delete(candidate.rightKey);
    activeClusters.set(mergedKey, merged);

    for (const [otherKey, other] of [...activeClusters.entries()].sort(
      ([leftKey], [rightKey]) => compareStrings(leftKey, rightKey),
    )) {
      if (otherKey !== mergedKey) {
        mergeHeap.push(mergeCandidate(merged, other));
      }
    }

    const clusters = [...activeClusters.values()]
      .sort((left, right) => compareStrings(clusterKey(left), clusterKey(right)));

    descriptionLength +=
      candidate.delta + constant(previousCount - 1) - constant(previousCount);
    if (!Number.isFinite(descriptionLength)) {
      throw new HinaValidationError(
        "NUMERICAL_ERROR",
        "The MDL description length became non-finite.",
        { communityCount: clusters.length },
      );
    }
    snapshots.push({
      communityCount: clusters.length,
      descriptionLength,
      clusters: clusters.map(cloneCluster),
    });
  }

  let selected: PartitionSnapshot;
  if (options.fixedCommunityCount !== undefined) {
    selected = snapshots.find(
      (snapshot) => snapshot.communityCount === options.fixedCommunityCount,
    )!;
  } else {
    selected = snapshots[0]!;
    for (const candidate of snapshots.slice(1)) {
      // Preserve the first (larger-B) optimum on a numerical tie, matching
      // numpy.argmin while keeping merge tie-breaking deterministic.
      if (isObjectiveLower(candidate.descriptionLength, selected.descriptionLength)) {
        selected = candidate;
      }
    }
  }

  const canonicalClusters = selected.clusters
    .map(cloneCluster)
    .sort((left, right) => compareStrings(clusterKey(left), clusterKey(right)));
  const communityByNode = new Map<string, number>();
  const communities: Community[] = canonicalClusters.map((cluster, id) => {
    const members = [...cluster.members].sort(compareStrings);
    for (const nodeId of members) {
      communityByNode.set(nodeId, id);
    }
    return { id, members };
  });
  const nodeCommunities: NodeCommunity[] = [...communityByNode.entries()]
    .map(([nodeId, community]) => ({ nodeId, community }))
    .sort((left, right) => compareStrings(left.nodeId, right.nodeId));

  const resultGraph: HinaGraph = {
    ...graph,
    partitions: graph.partitions.map(clonePartition),
    nodes: graph.nodes
      .map((node) => {
        const community = communityByNode.get(node.id);
        return {
          ...node,
          attributes:
            community === undefined
              ? cloneAttributes(node.attributes)
              : { ...node.attributes, community },
        };
      })
      .sort((left, right) => compareStrings(left.id, right.id)),
    edges: graph.edges.map(cloneEdge).sort(compareEdges),
  };

  const resultNodeIndex = buildNodeIndex(resultGraph);
  const subgraphs: CommunityGraph[] = communities.map((community) => {
    const memberIds = new Set(community.members);
    const edges = resultGraph.edges.filter(
      (edge) => memberIds.has(edge.source) || memberIds.has(edge.target),
    );
    const includedNodeIds = new Set(community.members);
    for (const edge of edges) {
      includedNodeIds.add(edge.source);
      includedNodeIds.add(edge.target);
    }
    // Ensure an isolated member is sourced from the cloned result graph.
    for (const nodeId of community.members) {
      if (!resultNodeIndex.has(nodeId)) {
        throw new HinaValidationError(
          "INVALID_GRAPH",
          "A selected community refers to a missing graph node.",
          { nodeId },
        );
      }
    }
    return {
      community: community.id,
      graph: graphSubset(resultGraph, includedNodeIds, edges),
    };
  });

  const baseline = snapshots[snapshots.length - 1]!.descriptionLength;
  const compressionRatio =
    baseline === 0
      ? selected.descriptionLength === 0
        ? 1
        : Number.POSITIVE_INFINITY
      : selected.descriptionLength / baseline;
  if (!Number.isFinite(compressionRatio)) {
    throw new HinaValidationError(
      "NUMERICAL_ERROR",
      "The MDL compression ratio is not finite.",
      { baseline, descriptionLength: selected.descriptionLength },
    );
  }

  const baseResult = {
    communityCount: communities.length,
    nodeCommunities,
    communities,
    compressionRatio,
    descriptionLength: selected.descriptionLength,
    graph: resultGraph,
    subgraphs,
    diagnostics,
  };

  if (graph.kind !== "tripartite") {
    return baseResult;
  }

  const objectProjections = subgraphs.map(({ community, graph: subgraph }) => ({
    community,
    graph: createObjectProjection(community, subgraph, diagnostics),
  }));
  return { ...baseResult, objectProjections };
}
