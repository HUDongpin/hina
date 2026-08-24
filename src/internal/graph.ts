import { HinaValidationError } from "../errors";
import type {
  HinaEdge,
  HinaGraph,
  HinaNode,
  HinaPartition,
  JsonValue,
} from "../types";

export interface HinaAdjacentEdge {
  readonly nodeId: string;
  readonly edge: HinaEdge;
}

function canonicalJson(value: JsonValue): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new HinaValidationError(
        "INVALID_ARGUMENT",
        "Stable graph identifiers require finite numeric values.",
        { value: String(value) },
      );
    }
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value as readonly JsonValue[];
    return `[${items.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const objectValue = value as Readonly<Record<string, JsonValue>>;
  const members = Object.keys(objectValue)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key]!)}`);
  return `{${members.join(",")}}`;
}

/**
 * Create a collision-resistant node ID from its partition and normalized value.
 * Type information is retained (`1` and `"1"` are distinct), and object keys
 * are sorted so structurally equal JSON values produce the same ID.
 */
export function stableNodeId(partitionId: string, value: JsonValue): string {
  if (partitionId.length === 0) {
    throw new HinaValidationError(
      "INVALID_PARTITION",
      "A partition ID must not be empty.",
    );
  }

  const serializedValue = canonicalJson(value);
  const valueType = value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value === "object"
        ? "object"
        : typeof value;
  return [
    "hina:node",
    `partition:${partitionId.length}:${partitionId}`,
    `value:${valueType}:${serializedValue.length}:${serializedValue}`,
  ].join(":");
}

/** Create a deterministic ID for an undirected edge. */
export function stableEdgeId(source: string, target: string): string {
  const endpoints = [source, target].sort((left, right) =>
    left.localeCompare(right),
  );
  return `hina:edge:${canonicalJson(endpoints)}`;
}

/** Return a node lookup and reject duplicate IDs. */
export function buildNodeIndex(
  graph: HinaGraph,
): ReadonlyMap<string, HinaNode> {
  const nodes = new Map<string, HinaNode>();

  for (const node of graph.nodes) {
    if (nodes.has(node.id)) {
      throw new HinaValidationError(
        "INVALID_GRAPH",
        `Duplicate graph node ID: ${node.id}`,
        { nodeId: node.id },
      );
    }
    nodes.set(node.id, node);
  }

  return nodes;
}

/** Return a partition lookup and reject duplicate IDs. */
export function buildPartitionIndex(
  graph: HinaGraph,
): ReadonlyMap<string, HinaPartition> {
  const partitions = new Map<string, HinaPartition>();

  for (const partition of graph.partitions) {
    if (partitions.has(partition.id)) {
      throw new HinaValidationError(
        "INVALID_GRAPH",
        `Duplicate graph partition ID: ${partition.id}`,
        { partitionId: partition.id },
      );
    }
    partitions.set(partition.id, partition);
  }

  return partitions;
}

/**
 * Build an undirected adjacency map. Isolated nodes are represented by an empty
 * list, and malformed endpoints/weights fail early with structured errors.
 */
export function buildAdjacency(
  graph: HinaGraph,
): ReadonlyMap<string, readonly HinaAdjacentEdge[]> {
  const nodeIndex = buildNodeIndex(graph);
  const mutable = new Map<string, HinaAdjacentEdge[]>();

  for (const node of graph.nodes) {
    mutable.set(node.id, []);
  }

  for (const edge of graph.edges) {
    if (!nodeIndex.has(edge.source) || !nodeIndex.has(edge.target)) {
      throw new HinaValidationError(
        "INVALID_GRAPH",
        `Edge ${edge.id} refers to a missing endpoint.`,
        {
          edgeId: edge.id,
          source: edge.source,
          target: edge.target,
        },
      );
    }
    if (!Number.isFinite(edge.weight) || edge.weight < 0) {
      throw new HinaValidationError(
        "INVALID_WEIGHT",
        `Edge ${edge.id} has an invalid weight.`,
        { edgeId: edge.id, weight: String(edge.weight) },
      );
    }

    mutable.get(edge.source)!.push({ nodeId: edge.target, edge });
    if (edge.source !== edge.target) {
      mutable.get(edge.target)!.push({ nodeId: edge.source, edge });
    }
  }

  for (const adjacent of mutable.values()) {
    adjacent.sort((left, right) => left.edge.id.localeCompare(right.edge.id));
  }

  return mutable;
}

/** Return nodes in a partition in stable ID order. */
export function nodesInPartition(
  graph: HinaGraph,
  partitionId: string,
): readonly HinaNode[] {
  return graph.nodes
    .filter((node) => node.partition === partitionId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Return the endpoint opposite `nodeId`, rejecting non-incident edges. */
export function oppositeEndpoint(edge: HinaEdge, nodeId: string): string {
  if (edge.source === nodeId) {
    return edge.target;
  }
  if (edge.target === nodeId) {
    return edge.source;
  }

  throw new HinaValidationError(
    "INVALID_GRAPH",
    `Node ${nodeId} is not incident to edge ${edge.id}.`,
    { edgeId: edge.id, nodeId },
  );
}

/** Validate graph partitions, node membership, endpoints and edge IDs. */
export function assertValidGraph(graph: HinaGraph): void {
  const partitions = buildPartitionIndex(graph);
  const nodes = buildNodeIndex(graph);
  const edgeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (!partitions.has(node.partition)) {
      throw new HinaValidationError(
        "INVALID_GRAPH",
        `Node ${node.id} belongs to an unknown partition.`,
        { nodeId: node.id, partitionId: node.partition },
      );
    }
    if (stableNodeId(node.partition, node.value) !== node.id) {
      throw new HinaValidationError(
        "INVALID_GRAPH",
        `Node ${node.id} does not match its stable partition/value ID.`,
        { nodeId: node.id },
      );
    }
  }

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      throw new HinaValidationError(
        "INVALID_GRAPH",
        `Duplicate graph edge ID: ${edge.id}`,
        { edgeId: edge.id },
      );
    }
    edgeIds.add(edge.id);

    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      throw new HinaValidationError(
        "INVALID_GRAPH",
        `Edge ${edge.id} refers to a missing endpoint.`,
        { edgeId: edge.id, source: edge.source, target: edge.target },
      );
    }
    if (stableEdgeId(edge.source, edge.target) !== edge.id) {
      throw new HinaValidationError(
        "INVALID_GRAPH",
        `Edge ${edge.id} does not match its stable endpoint ID.`,
        { edgeId: edge.id },
      );
    }
    if (!Number.isFinite(edge.weight) || edge.weight < 0) {
      throw new HinaValidationError(
        "INVALID_WEIGHT",
        `Edge ${edge.id} has an invalid weight.`,
        { edgeId: edge.id, weight: String(edge.weight) },
      );
    }
  }
}
