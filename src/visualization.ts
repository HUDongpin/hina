import { HinaValidationError } from "./errors";
import {
  assertValidGraph,
  buildAdjacency,
  buildNodeIndex,
  buildPartitionIndex,
  stableEdgeId,
} from "./internal/graph";
import type {
  HinaEdge,
  HinaGraph,
  HinaNode,
  JsonObject,
} from "./types";

export type LayoutType = "bipartite" | "circular" | "spring" | "cluster";

export interface CommunityAssignmentRow {
  readonly nodeId: string;
  readonly community: string | number;
}

/**
 * A full CommunityResult is structurally compatible with the object branch of
 * this type. Accepting rows as well keeps the layout independent of mesoscale.
 */
export type CommunityAssignments =
  | readonly CommunityAssignmentRow[]
  | {
      readonly nodeCommunities: readonly CommunityAssignmentRow[];
    };

export interface LayoutOptions {
  readonly type?: LayoutType;
  readonly seed?: number;
  readonly width?: number;
  readonly height?: number;
  readonly communities?: CommunityAssignments;
}

export interface LayoutPosition {
  readonly x: number;
  readonly y: number;
}

export interface LayoutResult {
  readonly type: LayoutType;
  readonly seed: number;
  readonly positions: Readonly<Record<string, LayoutPosition>>;
}

export interface ProjectionOptions {
  readonly targetPartition: string;
  /** Preserve zero-similarity pairs by default, matching the Python plot. */
  readonly includeZeroSimilarity?: boolean;
}

export interface ProjectionSimilarity {
  readonly source: string;
  readonly target: string;
  readonly similarity: number;
}

export interface ProjectionResult {
  readonly graph: HinaGraph;
  readonly targetPartition: string;
  readonly metric: "cosine-l2";
  readonly similarities: readonly ProjectionSimilarity[];
}

export interface CytoscapeViewOptions {
  /** Precomputed positions take precedence over asking this function to layout. */
  readonly positions?: Readonly<Record<string, LayoutPosition>>;
  readonly layout?: LayoutOptions | LayoutResult;
}

export interface CytoscapeNodeElement {
  readonly group: "nodes";
  readonly data: JsonObject & {
    readonly id: string;
    readonly label: string;
    readonly partition: string;
  };
  readonly position?: LayoutPosition;
}

export interface CytoscapeEdgeElement {
  readonly group: "edges";
  readonly data: JsonObject & {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly weight: number;
  };
}

export type CytoscapeElement = CytoscapeNodeElement | CytoscapeEdgeElement;

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const DEFAULT_SEED = 0;
const SPRING_ITERATIONS = 80;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortedNodes(graph: HinaGraph): readonly HinaNode[] {
  return [...graph.nodes].sort((left, right) =>
    compareText(left.id, right.id),
  );
}

function sortedEdges(graph: HinaGraph): readonly HinaEdge[] {
  return [...graph.edges].sort((left, right) =>
    compareText(left.id, right.id),
  );
}

function finitePositiveDimension(
  value: number | undefined,
  fallback: number,
  name: "width" | "height",
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new HinaValidationError(
      "INVALID_ARGUMENT",
      `Layout ${name} must be a finite number greater than zero.`,
      { [name]: String(resolved) },
    );
  }
  return resolved;
}

function normalizedSeed(seed: number | undefined): number {
  const resolved = seed ?? DEFAULT_SEED;
  if (!Number.isSafeInteger(resolved)) {
    throw new HinaValidationError(
      "INVALID_ARGUMENT",
      "Layout seed must be a safe integer.",
      { seed: String(resolved) },
    );
  }
  return resolved;
}

function roundCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    throw new HinaValidationError(
      "NUMERICAL_ERROR",
      "A layout calculation produced a non-finite coordinate.",
      { value: String(value) },
    );
  }
  const rounded = Number(value.toFixed(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function position(x: number, y: number): LayoutPosition {
  return { x: roundCoordinate(x), y: roundCoordinate(y) };
}

function positionRecord(
  entries: readonly (readonly [string, LayoutPosition])[],
): Readonly<Record<string, LayoutPosition>> {
  return Object.fromEntries(
    [...entries].sort(([left], [right]) => compareText(left, right)),
  );
}

function plotBounds(width: number, height: number): {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly centerX: number;
  readonly centerY: number;
} {
  const padding = Math.min(width, height) * 0.1;
  return {
    left: padding,
    right: width - padding,
    top: padding,
    bottom: height - padding,
    centerX: width / 2,
    centerY: height / 2,
  };
}

function evenlySpaced(index: number, count: number, start: number, end: number) {
  if (count <= 1) return (start + end) / 2;
  return start + (index / (count - 1)) * (end - start);
}

/** Position each graph partition in its own deterministic vertical column. */
export function bipartiteLayout(
  graph: HinaGraph,
  options: Pick<LayoutOptions, "width" | "height"> = {},
): Readonly<Record<string, LayoutPosition>> {
  assertValidGraph(graph);
  const width = finitePositiveDimension(options.width, DEFAULT_WIDTH, "width");
  const height = finitePositiveDimension(
    options.height,
    DEFAULT_HEIGHT,
    "height",
  );
  const bounds = plotBounds(width, height);

  const declaredPartitionIds = graph.partitions.map((item) => item.id);
  const undeclaredPartitionIds = [...new Set(graph.nodes.map((node) => node.partition))]
    .filter((partitionId) => !declaredPartitionIds.includes(partitionId))
    .sort(compareText);
  const partitionIds = [...declaredPartitionIds, ...undeclaredPartitionIds];
  const entries: Array<readonly [string, LayoutPosition]> = [];

  partitionIds.forEach((partitionId, partitionIndex) => {
    const nodes = graph.nodes
      .filter((node) => node.partition === partitionId)
      .sort((left, right) => compareText(left.id, right.id));
    const x = evenlySpaced(
      partitionIndex,
      partitionIds.length,
      bounds.left,
      bounds.right,
    );
    nodes.forEach((node, nodeIndex) => {
      const y = evenlySpaced(
        nodeIndex,
        nodes.length,
        bounds.top,
        bounds.bottom,
      );
      entries.push([node.id, position(x, y)]);
    });
  });

  return positionRecord(entries);
}

/** Position nodes on a deterministic circle, sorted by stable node ID. */
export function circularLayout(
  graph: HinaGraph,
  options: Pick<LayoutOptions, "width" | "height"> = {},
): Readonly<Record<string, LayoutPosition>> {
  assertValidGraph(graph);
  const width = finitePositiveDimension(options.width, DEFAULT_WIDTH, "width");
  const height = finitePositiveDimension(
    options.height,
    DEFAULT_HEIGHT,
    "height",
  );
  const bounds = plotBounds(width, height);
  const nodes = sortedNodes(graph);
  if (nodes.length === 0) return {};
  if (nodes.length === 1) {
    return { [nodes[0]!.id]: position(bounds.centerX, bounds.centerY) };
  }

  const radius = Math.min(
    (bounds.right - bounds.left) / 2,
    (bounds.bottom - bounds.top) / 2,
  );
  const entries = nodes.map((node, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / nodes.length;
    return [
      node.id,
      position(
        bounds.centerX + radius * Math.cos(angle),
        bounds.centerY + radius * Math.sin(angle),
      ),
    ] as const;
  });
  return positionRecord(entries);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Deterministic Fruchterman-Reingold layout. Edge weights scale attraction;
 * zero-weight edges remain in the graph but exert no attractive force.
 */
export function springLayout(
  graph: HinaGraph,
  options: Pick<LayoutOptions, "seed" | "width" | "height"> = {},
): Readonly<Record<string, LayoutPosition>> {
  assertValidGraph(graph);
  const width = finitePositiveDimension(options.width, DEFAULT_WIDTH, "width");
  const height = finitePositiveDimension(
    options.height,
    DEFAULT_HEIGHT,
    "height",
  );
  const seed = normalizedSeed(options.seed);
  const nodes = sortedNodes(graph);
  if (nodes.length === 0) return {};
  if (nodes.length === 1) {
    return { [nodes[0]!.id]: position(width / 2, height / 2) };
  }

  const bounds = plotBounds(width, height);
  const innerWidth = bounds.right - bounds.left;
  const innerHeight = bounds.bottom - bounds.top;
  const area = innerWidth * innerHeight;
  const idealDistance = Math.sqrt(area / nodes.length);
  const random = mulberry32(seed);
  const mutable = new Map<string, { x: number; y: number }>();

  for (const node of nodes) {
    mutable.set(node.id, {
      x: bounds.left + random() * innerWidth,
      y: bounds.top + random() * innerHeight,
    });
  }

  const edges = sortedEdges(graph);
  const maximumWeight = Math.max(0, ...edges.map((edge) => edge.weight));
  let temperature = Math.min(innerWidth, innerHeight) / 8;

  for (let iteration = 0; iteration < SPRING_ITERATIONS; iteration += 1) {
    const displacement = new Map<string, { x: number; y: number }>(
      nodes.map((node) => [node.id, { x: 0, y: 0 }]),
    );

    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < nodes.length;
        rightIndex += 1
      ) {
        const leftNode = nodes[leftIndex]!;
        const rightNode = nodes[rightIndex]!;
        const leftPosition = mutable.get(leftNode.id)!;
        const rightPosition = mutable.get(rightNode.id)!;
        let dx = leftPosition.x - rightPosition.x;
        let dy = leftPosition.y - rightPosition.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 1e-9) {
          const angle = ((leftIndex + 1) * (rightIndex + 1) * 2.3999632297) %
            (2 * Math.PI);
          dx = Math.cos(angle) * 1e-6;
          dy = Math.sin(angle) * 1e-6;
          distance = 1e-6;
        }
        const force = (idealDistance * idealDistance) / distance;
        const forceX = (dx / distance) * force;
        const forceY = (dy / distance) * force;
        const leftDisplacement = displacement.get(leftNode.id)!;
        const rightDisplacement = displacement.get(rightNode.id)!;
        leftDisplacement.x += forceX;
        leftDisplacement.y += forceY;
        rightDisplacement.x -= forceX;
        rightDisplacement.y -= forceY;
      }
    }

    for (const edge of edges) {
      if (edge.weight === 0 || maximumWeight === 0) continue;
      const sourcePosition = mutable.get(edge.source)!;
      const targetPosition = mutable.get(edge.target)!;
      let dx = sourcePosition.x - targetPosition.x;
      let dy = sourcePosition.y - targetPosition.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 1e-9) {
        dx = 1e-6;
        dy = 0;
        distance = 1e-6;
      }
      const normalizedWeight = edge.weight / maximumWeight;
      const force = ((distance * distance) / idealDistance) * normalizedWeight;
      const forceX = (dx / distance) * force;
      const forceY = (dy / distance) * force;
      const sourceDisplacement = displacement.get(edge.source)!;
      const targetDisplacement = displacement.get(edge.target)!;
      sourceDisplacement.x -= forceX;
      sourceDisplacement.y -= forceY;
      targetDisplacement.x += forceX;
      targetDisplacement.y += forceY;
    }

    for (const node of nodes) {
      const current = mutable.get(node.id)!;
      const delta = displacement.get(node.id)!;
      const magnitude = Math.hypot(delta.x, delta.y);
      if (magnitude > 0) {
        const step = Math.min(magnitude, temperature);
        current.x += (delta.x / magnitude) * step;
        current.y += (delta.y / magnitude) * step;
      }
      current.x = Math.max(bounds.left, Math.min(bounds.right, current.x));
      current.y = Math.max(bounds.top, Math.min(bounds.bottom, current.y));
    }
    temperature *= 1 - (iteration + 1) / (SPRING_ITERATIONS + 1);
  }

  return positionRecord(
    nodes.map((node) => {
      const finalPosition = mutable.get(node.id)!;
      return [node.id, position(finalPosition.x, finalPosition.y)] as const;
    }),
  );
}

function communityKey(value: string | number): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new HinaValidationError(
        "INVALID_ARGUMENT",
        "Community identifiers must be finite numbers or strings.",
        { community: String(value) },
      );
    }
    return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
  }
  return `string:${value}`;
}

function communityAssignments(
  graph: HinaGraph,
  input: CommunityAssignments | undefined,
): ReadonlyMap<string, string> {
  const nodeIndex = buildNodeIndex(graph);
  const assignments = new Map<string, string>();
  const rows =
    input === undefined
      ? undefined
      : "nodeCommunities" in input
        ? input.nodeCommunities
        : input;

  if (rows !== undefined) {
    for (const row of rows) {
      if (!nodeIndex.has(row.nodeId)) {
        throw new HinaValidationError(
          "INVALID_ARGUMENT",
          `Community assignment refers to unknown node ${row.nodeId}.`,
          { nodeId: row.nodeId },
        );
      }
      assignments.set(row.nodeId, communityKey(row.community));
    }
    return assignments;
  }

  for (const node of graph.nodes) {
    const candidate =
      node.attributes["community"] ??
      node.attributes["communities"] ??
      node.attributes["cluster"];
    if (typeof candidate === "string" || typeof candidate === "number") {
      assignments.set(node.id, communityKey(candidate));
    }
  }
  return assignments;
}

/** Place assigned communities around an outer ring and other nodes inside it. */
export function clusterLayout(
  graph: HinaGraph,
  options: Pick<
    LayoutOptions,
    "seed" | "width" | "height" | "communities"
  > = {},
): Readonly<Record<string, LayoutPosition>> {
  assertValidGraph(graph);
  const width = finitePositiveDimension(options.width, DEFAULT_WIDTH, "width");
  const height = finitePositiveDimension(
    options.height,
    DEFAULT_HEIGHT,
    "height",
  );
  const seed = normalizedSeed(options.seed);
  const nodes = sortedNodes(graph);
  if (nodes.length === 0) return {};

  const assignments = communityAssignments(graph, options.communities);
  if (assignments.size === 0) {
    return circularLayout(graph, { width, height });
  }

  const bounds = plotBounds(width, height);
  const random = mulberry32(seed);
  const offset = random() * 2 * Math.PI;
  const grouped = new Map<string, HinaNode[]>();
  const unassigned: HinaNode[] = [];
  for (const node of nodes) {
    const key = assignments.get(node.id);
    if (key === undefined) {
      unassigned.push(node);
      continue;
    }
    const group = grouped.get(key) ?? [];
    group.push(node);
    grouped.set(key, group);
  }

  const communityKeys = [...grouped.keys()].sort(compareText);
  const outerRadius = Math.min(
    (bounds.right - bounds.left) * 0.36,
    (bounds.bottom - bounds.top) * 0.36,
  );
  const memberRadius = Math.min(width, height) * 0.055;
  const entries: Array<readonly [string, LayoutPosition]> = [];

  communityKeys.forEach((key, communityIndex) => {
    const angle = offset + (2 * Math.PI * communityIndex) / communityKeys.length;
    const centerX = bounds.centerX + outerRadius * Math.cos(angle);
    const centerY = bounds.centerY + outerRadius * Math.sin(angle);
    const members = grouped.get(key)!.sort((left, right) =>
      compareText(left.id, right.id),
    );
    members.forEach((node, memberIndex) => {
      if (members.length === 1) {
        entries.push([node.id, position(centerX, centerY)]);
        return;
      }
      const memberAngle =
        offset + (2 * Math.PI * memberIndex) / members.length;
      entries.push([
        node.id,
        position(
          centerX + memberRadius * Math.cos(memberAngle),
          centerY + memberRadius * Math.sin(memberAngle),
        ),
      ]);
    });
  });

  const innerRadius = Math.min(width, height) * 0.18;
  unassigned.forEach((node, index) => {
    if (unassigned.length === 1) {
      entries.push([node.id, position(bounds.centerX, bounds.centerY)]);
      return;
    }
    const angle = offset + (2 * Math.PI * index) / unassigned.length;
    entries.push([
      node.id,
      position(
        bounds.centerX + innerRadius * Math.cos(angle),
        bounds.centerY + innerRadius * Math.sin(angle),
      ),
    ]);
  });

  return positionRecord(entries);
}

/** Compute a deterministic, JSON-safe layout suitable for Cytoscape or D3. */
export function layoutGraph(
  graph: HinaGraph,
  options: LayoutOptions = {},
): LayoutResult {
  const type = options.type ?? "bipartite";
  const seed = normalizedSeed(options.seed);
  let positions: Readonly<Record<string, LayoutPosition>>;

  switch (type) {
    case "bipartite":
      positions = bipartiteLayout(graph, options);
      break;
    case "circular":
      positions = circularLayout(graph, options);
      break;
    case "spring":
      positions = springLayout(graph, options);
      break;
    case "cluster":
      positions = clusterLayout(graph, options);
      break;
    default: {
      const unreachable: never = type;
      throw new HinaValidationError(
        "INVALID_ARGUMENT",
        `Unsupported layout type: ${String(unreachable)}`,
        { type: String(unreachable) },
      );
    }
  }

  return { type, seed, positions };
}

function cosineSimilarity(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): number {
  let leftNormSquared = 0;
  let rightNormSquared = 0;
  for (const weight of left.values()) leftNormSquared += weight * weight;
  for (const weight of right.values()) rightNormSquared += weight * weight;
  if (leftNormSquared === 0 || rightNormSquared === 0) return 0;

  const [smaller, larger] =
    left.size <= right.size ? [left, right] : [right, left];
  let dotProduct = 0;
  for (const [neighborId, weight] of smaller) {
    dotProduct += weight * (larger.get(neighborId) ?? 0);
  }
  const raw = dotProduct / Math.sqrt(leftNormSquared * rightNormSquared);
  if (!Number.isFinite(raw)) {
    throw new HinaValidationError(
      "NUMERICAL_ERROR",
      "Cosine projection produced a non-finite similarity.",
    );
  }
  const clamped = Math.max(-1, Math.min(1, raw));
  return Object.is(clamped, -0) ? 0 : clamped;
}

/**
 * Project one partition by L2-normalized cosine similarity. Every node pair is
 * represented by default, including pairs whose similarity is exactly zero.
 */
export function projectGraph(
  graph: HinaGraph,
  options: ProjectionOptions,
): ProjectionResult {
  assertValidGraph(graph);
  const partitions = buildPartitionIndex(graph);
  const targetPartition = partitions.get(options.targetPartition);
  if (targetPartition === undefined) {
    throw new HinaValidationError(
      "INVALID_PARTITION",
      `Unknown projection partition: ${options.targetPartition}`,
      { partitionId: options.targetPartition },
    );
  }

  const includeZeroSimilarity = options.includeZeroSimilarity ?? true;
  const targetNodes = graph.nodes
    .filter((node) => node.partition === options.targetPartition)
    .sort((left, right) => compareText(left.id, right.id));
  const targetIds = new Set(targetNodes.map((node) => node.id));
  const adjacency = buildAdjacency(graph);
  const vectors = new Map<string, Map<string, number>>();

  for (const node of targetNodes) {
    const vector = new Map<string, number>();
    for (const adjacent of adjacency.get(node.id) ?? []) {
      if (targetIds.has(adjacent.nodeId)) continue;
      vector.set(
        adjacent.nodeId,
        (vector.get(adjacent.nodeId) ?? 0) + adjacent.edge.weight,
      );
    }
    vectors.set(node.id, vector);
  }

  const edges: HinaEdge[] = [];
  const similarities: ProjectionSimilarity[] = [];
  for (let leftIndex = 0; leftIndex < targetNodes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < targetNodes.length;
      rightIndex += 1
    ) {
      const source = targetNodes[leftIndex]!;
      const target = targetNodes[rightIndex]!;
      const similarity = cosineSimilarity(
        vectors.get(source.id)!,
        vectors.get(target.id)!,
      );
      if (!includeZeroSimilarity && similarity === 0) continue;
      const attributes: JsonObject = { metric: "cosine-l2" };
      edges.push({
        id: stableEdgeId(source.id, target.id),
        source: source.id,
        target: target.id,
        weight: similarity,
        attributes,
      });
      similarities.push({ source: source.id, target: target.id, similarity });
    }
  }

  const projectedGraph: HinaGraph = {
    kind: "projection",
    directed: false,
    multigraph: false,
    partitions: [
      {
        ...targetPartition,
        role: "projection",
      },
    ],
    nodes: targetNodes,
    edges,
  };
  assertValidGraph(projectedGraph);

  return {
    graph: projectedGraph,
    targetPartition: options.targetPartition,
    metric: "cosine-l2",
    similarities,
  };
}

function resolvedViewPositions(
  graph: HinaGraph,
  options: CytoscapeViewOptions,
): Readonly<Record<string, LayoutPosition>> | undefined {
  if (options.positions !== undefined && options.layout !== undefined) {
    throw new HinaValidationError(
      "INVALID_ARGUMENT",
      "Provide either Cytoscape positions or a layout, not both.",
    );
  }
  if (options.positions !== undefined) return options.positions;
  if (options.layout === undefined) return undefined;
  if ("positions" in options.layout) return options.layout.positions;
  return layoutGraph(graph, options.layout).positions;
}

function validatedPosition(
  nodeId: string,
  candidate: LayoutPosition | undefined,
): LayoutPosition | undefined {
  if (candidate === undefined) return undefined;
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
    throw new HinaValidationError(
      "INVALID_ARGUMENT",
      `Cytoscape position for ${nodeId} must be finite.`,
      { nodeId, x: String(candidate.x), y: String(candidate.y) },
    );
  }
  return position(candidate.x, candidate.y);
}

/** Convert a graph and optional view positions to Cytoscape element objects. */
export function toCytoscapeElements(
  graph: HinaGraph,
  viewOptions: CytoscapeViewOptions = {},
): CytoscapeElement[] {
  assertValidGraph(graph);
  const positions = resolvedViewPositions(graph, viewOptions);
  const elements: CytoscapeElement[] = [];

  for (const node of sortedNodes(graph)) {
    const nodePosition = validatedPosition(node.id, positions?.[node.id]);
    const sourceShape: JsonObject = {
      ...(node.rawValue === undefined ? {} : { rawValue: node.rawValue }),
      ...(node.components === undefined
        ? {}
        : { components: node.components }),
    };
    const data: JsonObject & {
      readonly id: string;
      readonly label: string;
      readonly partition: string;
    } = {
      ...node.attributes,
      id: node.id,
      label: node.label,
      value: node.value,
      ...sourceShape,
      partition: node.partition,
      attributes: node.attributes,
    };
    elements.push(
      nodePosition === undefined
        ? { group: "nodes", data }
        : { group: "nodes", data, position: nodePosition },
    );
  }

  for (const edge of sortedEdges(graph)) {
    const data: JsonObject & {
      readonly id: string;
      readonly source: string;
      readonly target: string;
      readonly weight: number;
    } = {
      ...edge.attributes,
      id: edge.id,
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
      attributes: edge.attributes,
    };
    elements.push({ group: "edges", data });
  }

  return elements;
}
