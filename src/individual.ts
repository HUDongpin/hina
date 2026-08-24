import { HinaValidationError } from "./errors";
import {
  assertValidGraph,
  buildAdjacency,
  buildNodeIndex,
  nodesInPartition,
} from "./internal/graph";
import type {
  DiversityOptions,
  DiversityResult,
  DiversityRow,
  HinaDiagnostic,
  HinaGraph,
  HinaNode,
  IndividualOptions,
  IndividualResult,
  IndividualRow,
  JsonValue,
  QuantityOptions,
  QuantityResult,
  QuantityRow,
} from "./types";

function resolveIndividualPartition(
  graph: HinaGraph,
  requested: string | undefined,
): string {
  if (requested !== undefined) {
    if (!graph.partitions.some((partition) => partition.id === requested)) {
      throw new HinaValidationError(
        "INVALID_PARTITION",
        `Unknown individual partition: ${requested}`,
        { partitionId: requested },
      );
    }
    return requested;
  }

  const candidates = graph.partitions.filter(
    (partition) => partition.role === "actor",
  );
  if (candidates.length === 0) {
    throw new HinaValidationError(
      "INVALID_PARTITION",
      "The graph does not declare an individual partition.",
    );
  }
  if (candidates.length > 1) {
    throw new HinaValidationError(
      "INVALID_PARTITION",
      "Multiple individual partitions exist; individualPartition is required.",
      { partitionCount: candidates.length },
    );
  }
  return candidates[0]!.id;
}

function keyForJsonValue(value: JsonValue): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

function requiredAttribute(
  node: HinaNode,
  attribute: string,
): JsonValue {
  const value = node.attributes[attribute];
  if (value === undefined) {
    throw new HinaValidationError(
      "MISSING_NODE_ATTRIBUTE",
      `Node '${node.label}' is missing required attribute '${attribute}'.`,
      { nodeId: node.id, attribute },
    );
  }
  return value;
}

function mapToRecord(
  values: ReadonlyMap<string, number>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    [...values.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function nestedMapToRecord(
  values: ReadonlyMap<string, ReadonlyMap<string, number>>,
): Readonly<Record<string, Readonly<Record<string, number>>>> {
  return Object.fromEntries(
    [...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([nodeId, categories]) => [nodeId, mapToRecord(categories)]),
  );
}

function optionValue(value: string | null | undefined): string | undefined {
  return value === null || value === undefined || value.length === 0
    ? undefined
    : value;
}

/**
 * Compute upstream-compatible raw, global-normalized, category and within-group
 * quantities. Results are keyed by globally stable node IDs.
 */
export function analyzeQuantity(
  graph: HinaGraph,
  options: QuantityOptions = {},
): QuantityResult {
  assertValidGraph(graph);
  const individualPartition = resolveIndividualPartition(
    graph,
    options.individualPartition,
  );
  const attribute = optionValue(options.attribute);
  const group = optionValue(options.group);
  const adjacency = buildAdjacency(graph);
  const nodes = buildNodeIndex(graph);
  const individualNodes = nodesInPartition(graph, individualPartition).filter(
    (node) => (adjacency.get(node.id)?.length ?? 0) > 0,
  );
  const totalWeight = graph.edges.reduce(
    (sum, edge) => sum + edge.weight,
    0,
  );
  const diagnostics: HinaDiagnostic[] = [];

  if (individualNodes.length > 0 && totalWeight === 0) {
    diagnostics.push({
      code: "ZERO_TOTAL_WEIGHT",
      severity: "warning",
      message:
        "The graph has incident edges but zero total weight; normalized quantities were set to 0.",
      details: { individualPartition },
    });
  }

  const raw = new Map<string, number>();
  const normalized = new Map<string, number>();
  const categories = new Map<string, Map<string, number>>();
  const nodeGroups = new Map<string, string>();
  const groupSums = new Map<string, number>();

  for (const node of individualNodes) {
    let nodeQuantity = 0;
    const categoryQuantities = new Map<string, number>();

    for (const adjacent of adjacency.get(node.id) ?? []) {
      const opposite = nodes.get(adjacent.nodeId)!;
      if (opposite.partition === individualPartition) {
        throw new HinaValidationError(
          "INVALID_GRAPH",
          "Individual analysis requires edges between distinct partitions.",
          { edgeId: adjacent.edge.id, partitionId: individualPartition },
        );
      }
      nodeQuantity += adjacent.edge.weight;
      if (attribute !== undefined) {
        const category = keyForJsonValue(
          requiredAttribute(opposite, attribute),
        );
        categoryQuantities.set(
          category,
          (categoryQuantities.get(category) ?? 0) + adjacent.edge.weight,
        );
      }
    }

    raw.set(node.id, nodeQuantity);
    normalized.set(
      node.id,
      totalWeight === 0 ? 0 : nodeQuantity / totalWeight,
    );
    if (attribute !== undefined) {
      categories.set(node.id, categoryQuantities);
    }

    if (group !== undefined) {
      const groupKey = keyForJsonValue(requiredAttribute(node, group));
      nodeGroups.set(node.id, groupKey);
      groupSums.set(groupKey, (groupSums.get(groupKey) ?? 0) + nodeQuantity);
    }
  }

  const normalizedByGroup = new Map<string, number>();
  if (group !== undefined) {
    for (const node of individualNodes) {
      const groupKey = nodeGroups.get(node.id)!;
      const denominator = groupSums.get(groupKey) ?? 0;
      normalizedByGroup.set(
        node.id,
        denominator === 0 ? 0 : raw.get(node.id)! / denominator,
      );
    }
  }

  const rows: QuantityRow[] = individualNodes.map((node) => {
    const base = {
      nodeId: node.id,
      label: node.label,
      quantity: raw.get(node.id)!,
      normalizedQuantity: normalized.get(node.id)!,
    };

    if (attribute !== undefined && group !== undefined) {
      return {
        ...base,
        quantityByCategory: mapToRecord(categories.get(node.id)!),
        normalizedQuantityByGroup: normalizedByGroup.get(node.id)!,
      };
    }
    if (attribute !== undefined) {
      return {
        ...base,
        quantityByCategory: mapToRecord(categories.get(node.id)!),
      };
    }
    if (group !== undefined) {
      return {
        ...base,
        normalizedQuantityByGroup: normalizedByGroup.get(node.id)!,
      };
    }
    return base;
  });

  const baseResult = {
    quantity: mapToRecord(raw),
    normalizedQuantity: mapToRecord(normalized),
    totalWeight,
    rows,
    diagnostics,
  };

  if (attribute !== undefined && group !== undefined) {
    return {
      ...baseResult,
      quantityByCategory: nestedMapToRecord(categories),
      normalizedQuantityByGroup: mapToRecord(normalizedByGroup),
    };
  }
  if (attribute !== undefined) {
    return {
      ...baseResult,
      quantityByCategory: nestedMapToRecord(categories),
    };
  }
  if (group !== undefined) {
    return {
      ...baseResult,
      normalizedQuantityByGroup: mapToRecord(normalizedByGroup),
    };
  }
  return baseResult;
}

/**
 * Compute normalized Shannon entropy over object nodes or an object attribute.
 * A one-category graph has diversity 0 (the finite JSON-safe limit) and emits a
 * diagnostic instead of returning NumPy's legacy NaN.
 */
export function analyzeDiversity(
  graph: HinaGraph,
  options: DiversityOptions = {},
): DiversityResult {
  assertValidGraph(graph);
  const individualPartition = resolveIndividualPartition(
    graph,
    options.individualPartition,
  );
  const attribute = optionValue(options.attribute);
  const adjacency = buildAdjacency(graph);
  const nodes = buildNodeIndex(graph);
  const individualNodes = nodesInPartition(graph, individualPartition).filter(
    (node) => (adjacency.get(node.id)?.length ?? 0) > 0,
  );
  const categoryUniverse = new Set<string>();

  if (attribute !== undefined) {
    for (const node of graph.nodes) {
      if (node.partition !== individualPartition) {
        categoryUniverse.add(
          keyForJsonValue(requiredAttribute(node, attribute)),
        );
      }
    }
  } else {
    for (const node of individualNodes) {
      for (const adjacent of adjacency.get(node.id) ?? []) {
        categoryUniverse.add(adjacent.nodeId);
      }
    }
  }

  const categoryCount = categoryUniverse.size;
  const diagnostics: HinaDiagnostic[] = [];
  if (individualNodes.length > 0 && categoryCount <= 1) {
    diagnostics.push({
      code: "SINGLE_CATEGORY_DIVERSITY",
      severity: "info",
      message:
        "Diversity was set to 0 because the graph contains at most one category.",
      details: { categoryCount, individualPartition },
    });
  }

  const values = new Map<string, number>();
  for (const node of individualNodes) {
    const byCategory = new Map<string, number>();

    for (const adjacent of adjacency.get(node.id) ?? []) {
      const opposite = nodes.get(adjacent.nodeId)!;
      if (opposite.partition === individualPartition) {
        throw new HinaValidationError(
          "INVALID_GRAPH",
          "Individual analysis requires edges between distinct partitions.",
          { edgeId: adjacent.edge.id, partitionId: individualPartition },
        );
      }
      const category =
        attribute === undefined
          ? opposite.id
          : keyForJsonValue(requiredAttribute(opposite, attribute));
      byCategory.set(
        category,
        (byCategory.get(category) ?? 0) + adjacent.edge.weight,
      );
    }

    const nodeWeight = [...byCategory.values()].reduce(
      (sum, weight) => sum + weight,
      0,
    );
    if (nodeWeight <= 0 || categoryCount <= 1) {
      values.set(node.id, 0);
      continue;
    }

    let entropy = 0;
    for (const weight of byCategory.values()) {
      if (weight > 0) {
        const probability = weight / nodeWeight;
        entropy -= probability * Math.log(probability);
      }
    }
    values.set(node.id, entropy / Math.log(categoryCount));
  }

  const rows: DiversityRow[] = individualNodes.map((node) => ({
    nodeId: node.id,
    label: node.label,
    diversity: values.get(node.id)!,
  }));

  return {
    diversity: mapToRecord(values),
    categoryCount,
    rows,
    diagnostics,
  };
}

/** Compute quantity and diversity in one stable, table-oriented result. */
export function analyzeIndividuals(
  graph: HinaGraph,
  options: IndividualOptions = {},
): IndividualResult {
  const quantityResult = analyzeQuantity(graph, options);
  const diversityOptions: DiversityOptions = {};
  const mutableDiversityOptions = diversityOptions as {
    individualPartition?: string;
    attribute?: string | null;
  };

  if (options.individualPartition !== undefined) {
    mutableDiversityOptions.individualPartition = options.individualPartition;
  }
  const diversityAttribute =
    options.diversityAttribute === undefined
      ? options.attribute
      : options.diversityAttribute;
  if (diversityAttribute !== undefined) {
    mutableDiversityOptions.attribute = diversityAttribute;
  }

  const diversityResult = analyzeDiversity(graph, diversityOptions);
  const rows: IndividualRow[] = quantityResult.rows.map((row) => ({
    ...row,
    diversity: diversityResult.diversity[row.nodeId] ?? 0,
  }));
  const diagnostics = [...quantityResult.diagnostics];
  const seen = new Set(
    diagnostics.map((diagnostic) => JSON.stringify(diagnostic)),
  );
  for (const diagnostic of diversityResult.diagnostics) {
    const key = JSON.stringify(diagnostic);
    if (!seen.has(key)) {
      diagnostics.push(diagnostic);
      seen.add(key);
    }
  }

  return {
    quantity: quantityResult,
    diversity: diversityResult,
    rows,
    diagnostics,
  };
}
