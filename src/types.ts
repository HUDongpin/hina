/** A scalar value that survives a JSON round-trip unchanged. */
export type JsonScalar = string | number | boolean | null;

/** A recursively JSON-serializable value. */
export type JsonValue =
  | JsonScalar
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A JSON object used for graph attributes and structured diagnostics. */
export type JsonObject = Readonly<Record<string, JsonValue>>;

/**
 * One input record. Inputs are intentionally `unknown`: construction validates
 * and normalizes cell values before anything is copied into a JSON-safe graph.
 */
export type TabularRow = Readonly<Record<string, unknown>>;

export type HinaGraphKind = "bipartite" | "tripartite" | "projection";

export type HinaPartitionRole =
  | "actor"
  | "object"
  | "composite"
  | "projection";

/** Metadata describing one independently addressable graph partition. */
export interface HinaPartition {
  readonly id: string;
  readonly label: string;
  readonly role: HinaPartitionRole;
  readonly sourceColumns: readonly string[];
}

/** A globally addressable, JSON-safe graph node. */
export interface HinaNode {
  /** Stable ID derived from both `partition` and `value`. */
  readonly id: string;
  /** Human-readable representation of the source value. */
  readonly label: string;
  /** Original normalized value; composite values are structured arrays. */
  readonly value: JsonValue;
  /** Original scalar value for non-composite nodes. */
  readonly rawValue?: JsonScalar;
  /** Typed source components for composite nodes. */
  readonly components?: readonly {
    readonly partition: string;
    readonly value: JsonScalar;
  }[];
  /** ID of the partition to which this node belongs. */
  readonly partition: string;
  readonly attributes: JsonObject;
}

/** A weighted undirected edge. */
export interface HinaEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly weight: number;
  readonly attributes: JsonObject;
}

/**
 * Portable graph representation shared by browser, Node.js and Edge runtimes.
 * It deliberately contains no Map, Set, class instance, DOM value or Node API.
 */
export interface HinaGraph {
  readonly kind: HinaGraphKind;
  readonly directed: false;
  readonly multigraph: false;
  readonly partitions: readonly HinaPartition[];
  readonly nodes: readonly HinaNode[];
  readonly edges: readonly HinaEdge[];
}

export type HinaDiagnosticSeverity = "info" | "warning";

export type HinaDiagnosticCode =
  | "EMPTY_INDIVIDUAL_ROWS_REMOVED"
  | "VALUE_COERCED_TO_STRING"
  | "ZERO_TOTAL_WEIGHT"
  | "SINGLE_CATEGORY_DIVERSITY"
  | (string & {});

/** A non-fatal, machine-readable observation produced during an operation. */
export interface HinaDiagnostic {
  readonly code: HinaDiagnosticCode;
  readonly severity: HinaDiagnosticSeverity;
  readonly message: string;
  readonly details: JsonObject;
  readonly rows?: readonly number[];
}

/** A graph plus all non-fatal normalization/conflict diagnostics. */
export interface HinaBuildResult {
  readonly graph: HinaGraph;
  readonly diagnostics: readonly HinaDiagnostic[];
}

export type AttributeConflictStrategy =
  | "last"
  | "first"
  | "error";

interface BaseConstructionOptions {
  readonly studentColumn: string;
  readonly groupColumn?: string | null;
  /** Safe default is `error`; `first` and `last` are explicit compatibility modes. */
  readonly conflictStrategy?: AttributeConflictStrategy;
}

export interface BipartiteConstructionOptions
  extends BaseConstructionOptions {
  readonly objectColumn: string;
  readonly attributeColumn?: string | null;
}

export interface TripartiteConstructionOptions
  extends BaseConstructionOptions {
  readonly object1Column: string;
  readonly object2Column: string;
}

export interface QuantityOptions {
  /** Defaults to the partition whose role is `actor`. */
  readonly individualPartition?: string;
  /** Object-node attribute used to aggregate category quantities. */
  readonly attribute?: string | null;
  /** Individual-node attribute used for within-group normalization. */
  readonly group?: string | null;
}

export interface QuantityRow {
  readonly nodeId: string;
  readonly label: string;
  readonly quantity: number;
  readonly normalizedQuantity: number;
  readonly quantityByCategory?: Readonly<Record<string, number>>;
  readonly normalizedQuantityByGroup?: number;
}

export interface QuantityResult {
  /** Values are keyed by stable node ID, not display label. */
  readonly quantity: Readonly<Record<string, number>>;
  readonly normalizedQuantity: Readonly<Record<string, number>>;
  readonly quantityByCategory?: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
  readonly normalizedQuantityByGroup?: Readonly<Record<string, number>>;
  readonly totalWeight: number;
  readonly rows: readonly QuantityRow[];
  readonly diagnostics: readonly HinaDiagnostic[];
}

export interface DiversityOptions {
  /** Defaults to the partition whose role is `actor`. */
  readonly individualPartition?: string;
  /** Object-node attribute used as the entropy category. */
  readonly attribute?: string | null;
}

export interface DiversityRow {
  readonly nodeId: string;
  readonly label: string;
  readonly diversity: number;
}

export interface DiversityResult {
  /** Values are keyed by stable node ID, not display label. */
  readonly diversity: Readonly<Record<string, number>>;
  readonly categoryCount: number;
  readonly rows: readonly DiversityRow[];
  readonly diagnostics: readonly HinaDiagnostic[];
}

export interface IndividualOptions extends QuantityOptions {
  /** Uses the same object-node category attribute as quantity by default. */
  readonly diversityAttribute?: string | null;
}

export interface IndividualRow extends QuantityRow {
  readonly diversity: number;
}

export interface IndividualResult {
  readonly quantity: QuantityResult;
  readonly diversity: DiversityResult;
  readonly rows: readonly IndividualRow[];
  readonly diagnostics: readonly HinaDiagnostic[];
}

export type HinaErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_ALPHA"
  | "INVALID_COLUMN"
  | "MISSING_COLUMN"
  | "INVALID_GRAPH"
  | "INVALID_COMMUNITY_COUNT"
  | "INVALID_PARTITION"
  | "INVALID_WEIGHT"
  | "ATTRIBUTE_CONFLICT"
  | "MISSING_NODE_ATTRIBUTE"
  | "NUMERICAL_ERROR"
  | "UNSUPPORTED_FILE"
  | "UNSUPPORTED_FORMAT"
  | (string & {});
