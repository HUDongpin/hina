import binomialQuantile from "@stdlib/stats-base-dists-binomial-quantile";

import { HinaValidationError } from "./errors";
import { assertValidGraph, buildNodeIndex } from "./internal/graph";
import type {
  HinaDiagnostic,
  HinaEdge,
  HinaGraph,
  JsonObject,
} from "./types";

export interface PruneEdgesOptions {
  readonly alpha?: number;
  readonly fixedPartition?: string | null;
}

export interface PruningThreshold {
  /** `global` for the unconstrained model; otherwise the fixed node ID. */
  readonly scope: string;
  readonly trials: number;
  readonly probability: number;
  readonly threshold: number;
}

export interface PruneEdgesResult {
  readonly graph: HinaGraph;
  readonly significantEdges: readonly HinaEdge[];
  readonly removedEdges: readonly HinaEdge[];
  readonly thresholds: readonly PruningThreshold[];
  readonly diagnostics: readonly HinaDiagnostic[];
}

function cloneAttributes(attributes: JsonObject): JsonObject {
  return { ...attributes };
}

function cloneEdge(edge: HinaEdge): HinaEdge {
  return { ...edge, attributes: cloneAttributes(edge.attributes) };
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

function graphWithEdges(graph: HinaGraph, edges: readonly HinaEdge[]): HinaGraph {
  return {
    ...graph,
    partitions: graph.partitions.map((partition) => ({
      ...partition,
      sourceColumns: [...partition.sourceColumns],
    })),
    nodes: graph.nodes
      .map((node) => ({
        ...node,
        attributes: cloneAttributes(node.attributes),
      }))
      .sort((left, right) => compareStrings(left.id, right.id)),
    edges: edges.map(cloneEdge),
  };
}

function assertPruningWeight(edge: HinaEdge): void {
  if (!Number.isSafeInteger(edge.weight) || edge.weight < 0) {
    throw new HinaValidationError(
      "INVALID_WEIGHT",
      "Binomial edge pruning requires non-negative safe-integer weights.",
      { edgeId: edge.id, weight: String(edge.weight) },
    );
  }
}

/**
 * SciPy-compatible binomial quantile for HINA's pruning domain.
 *
 * stdlib matches SciPy for 0 < q <= 1. At q=0, SciPy's discrete PPF returns
 * the lower support minus one, while stdlib returns the lower support itself.
 */
function binomialPpf(
  quantile: number,
  trials: number,
  probability: number,
): number {
  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
    throw new HinaValidationError(
      "INVALID_ARGUMENT",
      "The binomial quantile must be finite and in [0, 1].",
      { quantile: String(quantile) },
    );
  }
  if (!Number.isSafeInteger(trials) || trials < 0) {
    throw new HinaValidationError(
      "INVALID_WEIGHT",
      "Binomial trials must be a non-negative safe integer.",
      { trials: String(trials) },
    );
  }
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new HinaValidationError(
      "NUMERICAL_ERROR",
      "The binomial success probability must be finite and in [0, 1].",
      { probability: String(probability) },
    );
  }

  return quantile === 0
    ? -1
    : binomialQuantile(quantile, trials, probability);
}

function resolveAlpha(options: PruneEdgesOptions): number {
  const alpha = options.alpha ?? 0.05;
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new HinaValidationError(
      "INVALID_ALPHA",
      "alpha must be a finite number in [0, 1].",
      { alpha: String(alpha) },
    );
  }
  return alpha;
}

function compareEdges(left: HinaEdge, right: HinaEdge): number {
  return compareStrings(left.id, right.id);
}

/**
 * Retain edges significant under HINA's binomial null model.
 *
 * The result shape is deliberately uniform for empty, singleton and general
 * graphs. The input graph and its nested node/edge attribute objects are never
 * modified.
 */
export function pruneEdges(
  graph: HinaGraph,
  options: PruneEdgesOptions = {},
): PruneEdgesResult {
  assertValidGraph(graph);
  if (graph.partitions.length !== 2) {
    throw new HinaValidationError(
      "INVALID_GRAPH",
      "Binomial edge pruning requires exactly two graph partitions.",
      { partitionCount: graph.partitions.length },
    );
  }
  const alpha = resolveAlpha(options);
  const fixedPartition = options.fixedPartition ?? null;
  const nodes = buildNodeIndex(graph);
  const partitionIds = new Set(graph.partitions.map((partition) => partition.id));

  if (fixedPartition !== null && !partitionIds.has(fixedPartition)) {
    throw new HinaValidationError(
      "INVALID_PARTITION",
      `Unknown fixed partition: ${fixedPartition}`,
      { partitionId: fixedPartition },
    );
  }

  for (const edge of graph.edges) {
    assertPruningWeight(edge);
    const sourcePartition = nodes.get(edge.source)!.partition;
    const targetPartition = nodes.get(edge.target)!.partition;
    if (sourcePartition === targetPartition) {
      throw new HinaValidationError(
        "INVALID_GRAPH",
        "Binomial edge pruning requires edges between distinct partitions.",
        { edgeId: edge.id, partitionId: sourcePartition },
      );
    }
  }

  const inputEdges = graph.edges.map(cloneEdge).sort(compareEdges);
  const diagnostics: HinaDiagnostic[] = [];

  if (inputEdges.length === 0) {
    return {
      graph: graphWithEdges(graph, []),
      significantEdges: [],
      removedEdges: [],
      thresholds: [],
      diagnostics,
    };
  }

  // Preserve the upstream HINA rule: a singleton edge is significant without
  // evaluating a null distribution, including at alpha=0.
  if (inputEdges.length === 1) {
    diagnostics.push({
      code: "SINGLE_EDGE_ALWAYS_SIGNIFICANT",
      severity: "info",
      message: "A singleton edge is significant by definition.",
      details: { edgeId: inputEdges[0]!.id },
    });
    return {
      graph: graphWithEdges(graph, inputEdges),
      significantEdges: inputEdges,
      removedEdges: [],
      thresholds: [],
      diagnostics,
    };
  }

  const significant: HinaEdge[] = [];
  const thresholds: PruningThreshold[] = [];

  if (fixedPartition === null) {
    const activeNodesByPartition = new Map<string, Set<string>>();
    for (const edge of inputEdges) {
      const sourcePartition = nodes.get(edge.source)!.partition;
      const targetPartition = nodes.get(edge.target)!.partition;
      const sourceNodes = activeNodesByPartition.get(sourcePartition) ?? new Set<string>();
      const targetNodes = activeNodesByPartition.get(targetPartition) ?? new Set<string>();
      sourceNodes.add(edge.source);
      targetNodes.add(edge.target);
      activeNodesByPartition.set(sourcePartition, sourceNodes);
      activeNodesByPartition.set(targetPartition, targetNodes);
    }

    if (activeNodesByPartition.size !== 2) {
      throw new HinaValidationError(
        "INVALID_GRAPH",
        "Unconstrained binomial pruning requires exactly two active partitions.",
        { activePartitionCount: activeNodesByPartition.size },
      );
    }

    const activeSizes = [...activeNodesByPartition.values()].map((set) => set.size);
    const possibleEdgeCount = activeSizes[0]! * activeSizes[1]!;
    const trials = inputEdges.reduce((sum, edge) => sum + edge.weight, 0);
    if (!Number.isSafeInteger(trials)) {
      throw new HinaValidationError(
        "INVALID_WEIGHT",
        "The total edge weight exceeds the safe-integer range.",
        { totalWeight: String(trials) },
      );
    }

    const probability = 1 / possibleEdgeCount;
    const threshold = binomialPpf(1 - alpha, trials, probability);
    thresholds.push({ scope: "global", trials, probability, threshold });
    for (const edge of inputEdges) {
      if (edge.weight >= threshold) {
        significant.push(edge);
      }
    }

    if (trials === 0) {
      diagnostics.push({
        code: "ZERO_TOTAL_WEIGHT",
        severity: "warning",
        message: "All edge weights are zero; the null model is degenerate.",
        details: {},
      });
    }
  } else {
    const fixedNodes = graph.nodes
      .filter((node) => node.partition === fixedPartition)
      .sort((left, right) => compareStrings(left.id, right.id));
    const otherNodeCount = graph.nodes.length - fixedNodes.length;
    if (fixedNodes.length === 0 || otherNodeCount === 0) {
      throw new HinaValidationError(
        "INVALID_GRAPH",
        "Fixed-degree pruning requires nodes on both sides of the graph.",
        { partitionId: fixedPartition },
      );
    }

    const weightedDegrees = new Map(fixedNodes.map((node) => [node.id, 0]));
    for (const edge of inputEdges) {
      const sourceIsFixed = nodes.get(edge.source)!.partition === fixedPartition;
      const targetIsFixed = nodes.get(edge.target)!.partition === fixedPartition;
      if (sourceIsFixed === targetIsFixed) {
        throw new HinaValidationError(
          "INVALID_GRAPH",
          "Every edge must have exactly one endpoint in the fixed partition.",
          { edgeId: edge.id, partitionId: fixedPartition },
        );
      }
      const fixedNodeId = sourceIsFixed ? edge.source : edge.target;
      const degree = weightedDegrees.get(fixedNodeId)! + edge.weight;
      if (!Number.isSafeInteger(degree)) {
        throw new HinaValidationError(
          "INVALID_WEIGHT",
          "A fixed node's weighted degree exceeds the safe-integer range.",
          { nodeId: fixedNodeId, weightedDegree: String(degree) },
        );
      }
      weightedDegrees.set(fixedNodeId, degree);
    }

    const probability = 1 / otherNodeCount;
    const thresholdByNode = new Map<string, number>();
    for (const node of fixedNodes) {
      const trials = weightedDegrees.get(node.id)!;
      // Isolates do not participate in an edge test and therefore do not add a
      // threshold record, matching the edge-scoped upstream calculation.
      if (trials === 0) {
        continue;
      }
      const threshold = binomialPpf(1 - alpha, trials, probability);
      thresholdByNode.set(node.id, threshold);
      thresholds.push({
        scope: node.id,
        trials,
        probability,
        threshold,
      });
    }

    for (const edge of inputEdges) {
      const fixedNodeId =
        nodes.get(edge.source)!.partition === fixedPartition
          ? edge.source
          : edge.target;
      if (edge.weight >= thresholdByNode.get(fixedNodeId)!) {
        significant.push(edge);
      }
    }
  }

  const significantIds = new Set(significant.map((edge) => edge.id));
  const removed = inputEdges.filter((edge) => !significantIds.has(edge.id));
  const stableSignificant = significant.sort(compareEdges);

  return {
    graph: graphWithEdges(graph, stableSignificant),
    significantEdges: stableSignificant,
    removedEdges: removed,
    thresholds,
    diagnostics,
  };
}
