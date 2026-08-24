import { HinaValidationError } from "./errors";
import { stableEdgeId, stableNodeId } from "./internal/graph";
import type {
  AttributeConflictStrategy,
  BipartiteConstructionOptions,
  HinaBuildResult,
  HinaDiagnostic,
  HinaEdge,
  HinaGraph,
  HinaNode,
  HinaPartition,
  JsonScalar,
  JsonValue,
  TabularRow,
  TripartiteConstructionOptions,
} from "./types";

interface MutableNode {
  readonly id: string;
  readonly label: string;
  readonly value: JsonValue;
  readonly rawValue?: JsonScalar;
  readonly components?: readonly {
    readonly partition: string;
    readonly value: JsonScalar;
  }[];
  readonly partition: string;
  readonly attributes: Record<string, JsonValue>;
}

interface MutableEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  weight: number;
  readonly attributes: Record<string, JsonValue>;
}

function requireColumnName(value: string, optionName: string): void {
  if (value.trim().length === 0) {
    throw new HinaValidationError(
      "INVALID_ARGUMENT",
      `${optionName} must be a non-empty column name.`,
      { option: optionName },
    );
  }
}

function assertDistinctColumns(columns: readonly string[]): void {
  if (new Set(columns).size !== columns.length) {
    throw new HinaValidationError(
      "INVALID_ARGUMENT",
      "Construction columns must be distinct.",
      { columns },
    );
  }
}

function assertColumnsExist(
  rows: readonly TabularRow[],
  columns: readonly string[],
): void {
  if (rows.length === 0) {
    return;
  }

  for (const column of columns) {
    if (!rows.some((row) => Object.prototype.hasOwnProperty.call(row, column))) {
      throw new HinaValidationError(
        "MISSING_COLUMN",
        `Input column not found: ${column}`,
        { column },
      );
    }
  }
}

function isMissing(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && Number.isNaN(value))
  );
}

function pythonString(value: unknown): string {
  if (isMissing(value)) {
    return "NA";
  }
  if (typeof value === "string") {
    return value.trim().length === 0 ? "NA" : value;
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function normalizeIndividualValue(
  value: unknown,
  rowIndex: number,
  column: string,
  diagnostics: HinaDiagnostic[],
): JsonScalar | undefined {
  if (isMissing(value)) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.trim().length === 0 ? undefined : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      diagnostics.push({
        code: "VALUE_COERCED_TO_STRING",
        severity: "warning",
        message: `A non-finite value in '${column}' was coerced to a string.`,
        details: { column, rowIndex, value: String(value) },
      });
      return String(value);
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = pythonString(value);
  diagnostics.push({
    code: "VALUE_COERCED_TO_STRING",
    severity: "warning",
    message: `A non-scalar value in '${column}' was coerced to a string.`,
    details: { column, rowIndex, value: normalized },
  });
  return normalized;
}

function normalizeObjectValue(
  value: unknown,
  rowIndex: number,
  column: string,
  diagnostics: HinaDiagnostic[],
): JsonScalar {
  if (isMissing(value)) {
    return null;
  }
  if (typeof value === "string") {
    return value.trim().length === 0 ? null : value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    const normalized = String(value);
    diagnostics.push({
      code: "VALUE_COERCED_TO_STRING",
      severity: "warning",
      message: `A non-finite value in '${column}' was coerced to a string.`,
      details: { column, rowIndex, value: normalized },
    });
    return normalized;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  const normalized = String(value);
  diagnostics.push({
    code: "VALUE_COERCED_TO_STRING",
    severity: "warning",
    message: `A non-scalar value in '${column}' was coerced to a string.`,
    details: { column, rowIndex, value: normalized },
  });
  return normalized;
}

function labelForScalar(value: JsonScalar): string {
  if (value === null) {
    return "NA";
  }
  return typeof value === "boolean" ? (value ? "True" : "False") : String(value);
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function setNodeAttribute(
  node: MutableNode,
  attribute: string,
  value: JsonValue,
  strategy: AttributeConflictStrategy,
  rowIndex: number,
  diagnostics: HinaDiagnostic[],
): void {
  const previous = node.attributes[attribute];
  if (previous === undefined || jsonEqual(previous, value)) {
    node.attributes[attribute] = value;
    return;
  }

  const resolution =
    strategy === "last"
      ? "incoming value retained"
      : strategy === "first"
        ? "existing value retained"
        : "error raised";
  const details = {
    nodeId: node.id,
    attribute,
    previous,
    incoming: value,
    rowIndex,
    strategy,
  } satisfies Readonly<Record<string, JsonValue>>;

  if (strategy === "error") {
    throw new HinaValidationError(
      "ATTRIBUTE_CONFLICT",
      `Conflicting '${attribute}' values for node '${node.label}'; ${resolution}.`,
      details,
    );
  }

  diagnostics.push({
    code: "ATTRIBUTE_CONFLICT",
    severity: "warning",
    message: `Conflicting '${attribute}' values for node '${node.label}'; ${resolution}.`,
    details,
  });

  if (strategy === "last") {
    node.attributes[attribute] = value;
  }
}

function addWeightedEdge(
  edges: Map<string, MutableEdge>,
  source: string,
  target: string,
): void {
  const id = stableEdgeId(source, target);
  const existing = edges.get(id);
  if (existing !== undefined) {
    existing.weight += 1;
    return;
  }

  edges.set(id, {
    id,
    source,
    target,
    weight: 1,
    attributes: {},
  });
}

function finalizeGraph(
  kind: HinaGraph["kind"],
  partitions: readonly HinaPartition[],
  nodes: ReadonlyMap<string, MutableNode>,
  edges: ReadonlyMap<string, MutableEdge>,
): HinaGraph {
  const finalizedNodes: HinaNode[] = [...nodes.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => ({
      id: node.id,
      label: node.label,
      value: node.value,
      ...(node.rawValue === undefined ? {} : { rawValue: node.rawValue }),
      ...(node.components === undefined
        ? {}
        : { components: node.components.map((component) => ({ ...component })) }),
      partition: node.partition,
      attributes: { ...node.attributes },
    }));

  const finalizedEdges: HinaEdge[] = [...edges.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
      attributes: { ...edge.attributes },
    }));

  return {
    kind,
    directed: false,
    multigraph: false,
    partitions: [...partitions],
    nodes: finalizedNodes,
    edges: finalizedEdges,
  };
}

function individualPartition(column: string): HinaPartition {
  return {
    id: column,
    label: column,
    role: "actor",
    sourceColumns: [column],
  };
}

/** Construct a Python-parity weighted bipartite network from tabular rows. */
export function createBipartiteGraph(
  rows: readonly TabularRow[],
  options: BipartiteConstructionOptions,
): HinaBuildResult {
  const {
    studentColumn,
    objectColumn,
    attributeColumn = null,
    groupColumn = null,
    conflictStrategy = "error",
  } = options;

  requireColumnName(studentColumn, "studentColumn");
  requireColumnName(objectColumn, "objectColumn");
  if (attributeColumn !== null) {
    requireColumnName(attributeColumn, "attributeColumn");
  }
  if (groupColumn !== null) {
    requireColumnName(groupColumn, "groupColumn");
  }

  const selectedColumns = [
    studentColumn,
    objectColumn,
    ...(attributeColumn === null ? [] : [attributeColumn]),
    ...(groupColumn === null ? [] : [groupColumn]),
  ];
  assertDistinctColumns(selectedColumns);
  assertColumnsExist(rows, selectedColumns);

  const objectPartition: HinaPartition = {
    id: objectColumn,
    label: objectColumn,
    role: "object",
    sourceColumns: [objectColumn],
  };
  const nodes = new Map<string, MutableNode>();
  const edges = new Map<string, MutableEdge>();
  const diagnostics: HinaDiagnostic[] = [];
  const removedRows: number[] = [];

  rows.forEach((row, rowIndex) => {
    const studentValue = normalizeIndividualValue(
      row[studentColumn],
      rowIndex,
      studentColumn,
      diagnostics,
    );
    if (studentValue === undefined) {
      removedRows.push(rowIndex);
      return;
    }

    const objectValue = normalizeObjectValue(
      row[objectColumn],
      rowIndex,
      objectColumn,
      diagnostics,
    );
    const studentId = stableNodeId(studentColumn, studentValue);
    const objectId = stableNodeId(objectPartition.id, objectValue);

    let studentNode = nodes.get(studentId);
    if (studentNode === undefined) {
      studentNode = {
        id: studentId,
        label: labelForScalar(studentValue),
        value: studentValue,
        rawValue: studentValue,
        partition: studentColumn,
        attributes: { bipartite: studentColumn },
      };
      nodes.set(studentId, studentNode);
    }

    let objectNode = nodes.get(objectId);
    if (objectNode === undefined) {
      objectNode = {
        id: objectId,
        label: labelForScalar(objectValue),
        value: objectValue,
        rawValue: objectValue,
        partition: objectPartition.id,
        attributes: { bipartite: objectPartition.id },
      };
      nodes.set(objectId, objectNode);
    }

    if (groupColumn !== null) {
      setNodeAttribute(
        studentNode,
        groupColumn,
        pythonString(row[groupColumn]),
        conflictStrategy,
        rowIndex,
        diagnostics,
      );
    }
    if (attributeColumn !== null) {
      setNodeAttribute(
        objectNode,
        attributeColumn,
        pythonString(row[attributeColumn]),
        conflictStrategy,
        rowIndex,
        diagnostics,
      );
    }

    addWeightedEdge(edges, studentId, objectId);
  });

  if (removedRows.length > 0) {
    diagnostics.unshift({
      code: "EMPTY_INDIVIDUAL_ROWS_REMOVED",
      severity: "warning",
      message: `${removedRows.length} rows with empty '${studentColumn}' values were removed.`,
      details: {
        column: studentColumn,
        count: removedRows.length,
        rowIndices: removedRows,
      },
      rows: removedRows,
    });
  }

  return {
    graph: finalizeGraph(
      "bipartite",
      [individualPartition(studentColumn), objectPartition],
      nodes,
      edges,
    ),
    diagnostics,
  };
}

/**
 * Construct the upstream-compatible student-to-composite-object representation of
 * a tripartite network. Joint values are structured internally, while `label`
 * retains the familiar `object1**object2` display representation.
 */
export function createTripartiteGraph(
  rows: readonly TabularRow[],
  options: TripartiteConstructionOptions,
): HinaBuildResult {
  const {
    studentColumn,
    object1Column,
    object2Column,
    groupColumn = null,
    conflictStrategy = "error",
  } = options;

  requireColumnName(studentColumn, "studentColumn");
  requireColumnName(object1Column, "object1Column");
  requireColumnName(object2Column, "object2Column");
  if (groupColumn !== null) {
    requireColumnName(groupColumn, "groupColumn");
  }

  const selectedColumns = [
    studentColumn,
    object1Column,
    object2Column,
    ...(groupColumn === null ? [] : [groupColumn]),
  ];
  assertDistinctColumns(selectedColumns);
  assertColumnsExist(rows, selectedColumns);

  const jointPartitionId = `(${object1Column},${object2Column})`;
  const jointPartition: HinaPartition = {
    id: jointPartitionId,
    label: jointPartitionId,
    role: "composite",
    sourceColumns: [object1Column, object2Column],
  };
  const nodes = new Map<string, MutableNode>();
  const edges = new Map<string, MutableEdge>();
  const diagnostics: HinaDiagnostic[] = [];
  const removedRows: number[] = [];

  rows.forEach((row, rowIndex) => {
    const studentValue = normalizeIndividualValue(
      row[studentColumn],
      rowIndex,
      studentColumn,
      diagnostics,
    );
    if (studentValue === undefined) {
      removedRows.push(rowIndex);
      return;
    }

    const object1Value = normalizeObjectValue(
      row[object1Column],
      rowIndex,
      object1Column,
      diagnostics,
    );
    const object2Value = normalizeObjectValue(
      row[object2Column],
      rowIndex,
      object2Column,
      diagnostics,
    );
    const jointValue = [object1Value, object2Value] as const;
    const studentId = stableNodeId(studentColumn, studentValue);
    const jointId = stableNodeId(jointPartitionId, jointValue);

    let studentNode = nodes.get(studentId);
    if (studentNode === undefined) {
      studentNode = {
        id: studentId,
        label: labelForScalar(studentValue),
        value: studentValue,
        rawValue: studentValue,
        partition: studentColumn,
        attributes: { bipartite: studentColumn },
      };
      nodes.set(studentId, studentNode);
    }

    if (!nodes.has(jointId)) {
      nodes.set(jointId, {
        id: jointId,
        label: `${labelForScalar(object1Value)}**${labelForScalar(object2Value)}`,
        value: jointValue,
        components: [
          { partition: object1Column, value: object1Value },
          { partition: object2Column, value: object2Value },
        ],
        partition: jointPartitionId,
        attributes: {
          bipartite: jointPartitionId,
          tripartite: true,
          joint: {
            columns: [object1Column, object2Column],
            values: jointValue,
          },
        },
      });
    }

    if (groupColumn !== null) {
      setNodeAttribute(
        studentNode,
        groupColumn,
        pythonString(row[groupColumn]),
        conflictStrategy,
        rowIndex,
        diagnostics,
      );
    }

    addWeightedEdge(edges, studentId, jointId);
  });

  if (removedRows.length > 0) {
    diagnostics.unshift({
      code: "EMPTY_INDIVIDUAL_ROWS_REMOVED",
      severity: "warning",
      message: `${removedRows.length} rows with empty '${studentColumn}' values were removed.`,
      details: {
        column: studentColumn,
        count: removedRows.length,
        rowIndices: removedRows,
      },
      rows: removedRows,
    });
  }

  return {
    graph: finalizeGraph(
      "tripartite",
      [individualPartition(studentColumn), jointPartition],
      nodes,
      edges,
    ),
    diagnostics,
  };
}
