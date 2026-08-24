import Papa from "papaparse";

import type { PruneEdgesResult } from "./dyad";
import { HinaValidationError } from "./errors";
import type { CommunityResult } from "./mesoscale";
import type {
  HinaDiagnostic,
  HinaGraph,
  IndividualResult,
  JsonScalar,
  TabularRow,
} from "./types";

export interface ParsedDataset {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly TabularRow[];
  readonly diagnostics: readonly HinaDiagnostic[];
}

export interface ParsedWorkbook {
  readonly sheets: readonly ParsedDataset[];
  readonly diagnostics: readonly HinaDiagnostic[];
}

export interface ParseCsvOptions {
  readonly name?: string;
  readonly delimiter?: string;
  readonly skipEmptyLines?: boolean;
}

export interface ParseXlsxOptions {
  readonly sheetNames?: readonly string[];
}

export interface HinaResultsBundle {
  readonly graph?: HinaGraph;
  readonly individuals?: IndividualResult;
  readonly pruning?: PruneEdgesResult;
  readonly communities?: CommunityResult;
  readonly diagnostics?: readonly HinaDiagnostic[];
  readonly metadata?: Readonly<Record<string, JsonScalar>>;
}

export interface ExportResultsXlsxOptions {
  readonly generatedAt?: string;
}

function uniqueColumns(rows: readonly TabularRow[]): readonly string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

/** Parse a CSV string without coercing identifiers or other cell values. */
export function parseCsv(
  input: string,
  options: ParseCsvOptions = {},
): ParsedDataset {
  if (typeof input !== "string") {
    throw new HinaValidationError(
      "UNSUPPORTED_FILE",
      "CSV input must be a UTF-8 string.",
      { inputType: typeof input },
    );
  }

  const parsed = Papa.parse<Record<string, string>>(input, {
    delimiter: options.delimiter ?? "",
    dynamicTyping: false,
    header: true,
    skipEmptyLines: options.skipEmptyLines ?? "greedy",
    transformHeader: (header) => header.trim(),
  });

  const fatalErrors = parsed.errors.filter(
    (error) => error.code !== "UndetectableDelimiter",
  );
  if (fatalErrors.length > 0) {
    throw new HinaValidationError(
      "UNSUPPORTED_FILE",
      "The CSV file could not be parsed.",
      {
        errors: fatalErrors.map((error) => ({
          code: error.code,
          message: error.message,
          row: error.row ?? null,
        })),
      },
    );
  }

  const rows = parsed.data.map((row) => ({ ...row }));
  const columns = parsed.meta.fields ?? uniqueColumns(rows);
  if (columns.length === 0) {
    throw new HinaValidationError(
      "UNSUPPORTED_FILE",
      "The CSV file does not contain a header row.",
    );
  }

  return {
    name: options.name ?? "CSV",
    columns,
    rows,
    diagnostics: [],
  };
}

function isBlobLike(value: unknown): value is { arrayBuffer(): Promise<ArrayBuffer> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function"
  );
}

async function xlsxBytes(
  input: ArrayBuffer | Uint8Array | { arrayBuffer(): Promise<ArrayBuffer> },
): Promise<ArrayBuffer | Uint8Array> {
  return isBlobLike(input) ? input.arrayBuffer() : input;
}

function jsonSafeCell(value: unknown): JsonScalar {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol") {
    return value.description ?? "Symbol";
  }
  if (typeof value === "function") {
    return value.name.length > 0 ? `[Function ${value.name}]` : "[Function]";
  }
  try {
    return JSON.stringify(value) ?? Object.prototype.toString.call(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/** Read cached XLSX values locally; workbook formulas are never executed. */
export async function parseXlsx(
  input: ArrayBuffer | Uint8Array | { arrayBuffer(): Promise<ArrayBuffer> },
  options: ParseXlsxOptions = {},
): Promise<ParsedWorkbook> {
  const xlsx = await import("@e965/xlsx");
  let workbook: ReturnType<typeof xlsx.read>;
  try {
    workbook = xlsx.read(await xlsxBytes(input), {
      cellDates: false,
      cellFormula: false,
      dense: false,
      type: "array",
    });
  } catch (error) {
    throw new HinaValidationError(
      "UNSUPPORTED_FILE",
      "The XLSX workbook could not be parsed.",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  const requested = options.sheetNames ?? workbook.SheetNames;
  const missing = requested.filter((name) => workbook.Sheets[name] === undefined);
  if (missing.length > 0) {
    throw new HinaValidationError(
      "UNSUPPORTED_FILE",
      "One or more requested worksheets do not exist.",
      { missingSheets: missing },
    );
  }

  const sheets = requested.map((name) => {
    const sheet = workbook.Sheets[name]!;
    const rawRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      blankrows: false,
      defval: null,
      raw: true,
    });
    const rows: TabularRow[] = rawRows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key.trim(), jsonSafeCell(value)]),
      ),
    );
    return {
      name,
      columns: uniqueColumns(rows),
      rows,
      diagnostics: [],
    } satisfies ParsedDataset;
  });

  return { sheets, diagnostics: [] };
}

function categoryRows(result: IndividualResult): Record<string, JsonScalar>[] {
  const rows: Record<string, JsonScalar>[] = [];
  for (const row of result.rows) {
    for (const [category, quantity] of Object.entries(
      row.quantityByCategory ?? {},
    )) {
      rows.push({
        nodeId: row.nodeId,
        label: row.label,
        category,
        quantity,
      });
    }
  }
  return rows;
}

function allDiagnostics(bundle: HinaResultsBundle): readonly HinaDiagnostic[] {
  const combined = [
    ...(bundle.diagnostics ?? []),
    ...(bundle.individuals?.diagnostics ?? []),
    ...(bundle.pruning?.diagnostics ?? []),
    ...(bundle.communities?.diagnostics ?? []),
  ];
  const seen = new Set<string>();
  return combined.filter((diagnostic) => {
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Export every available analysis table into one deterministic workbook. */
export async function exportResultsXlsx(
  bundle: HinaResultsBundle,
  options: ExportResultsXlsxOptions = {},
): Promise<ArrayBuffer> {
  const xlsx = await import("@e965/xlsx");
  const workbook = xlsx.utils.book_new();
  const addSheet = (
    name: string,
    rows: readonly Record<string, unknown>[],
    emptyHeaders: readonly string[],
  ): void => {
    const normalized = rows.length > 0
      ? rows
      : [Object.fromEntries(emptyHeaders.map((header) => [header, null]))];
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.json_to_sheet([...normalized], { skipHeader: false }),
      name,
    );
  };

  const metadata = {
    package: "hina-js",
    version: "0.1.1",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    graphKind: bundle.graph?.kind ?? null,
    nodeCount: bundle.graph?.nodes.length ?? null,
    edgeCount: bundle.graph?.edges.length ?? null,
    ...(bundle.metadata ?? {}),
  } satisfies Record<string, JsonScalar>;
  addSheet(
    "Metadata",
    Object.entries(metadata).map(([key, value]) => ({ key, value })),
    ["key", "value"],
  );

  const individualRows = bundle.individuals?.rows ?? [];
  addSheet(
    "Quantity",
    individualRows.map((row) => ({
      nodeId: row.nodeId,
      label: row.label,
      quantity: row.quantity,
    })),
    ["nodeId", "label", "quantity"],
  );
  addSheet(
    "Diversity",
    individualRows.map((row) => ({
      nodeId: row.nodeId,
      label: row.label,
      diversity: row.diversity,
    })),
    ["nodeId", "label", "diversity"],
  );
  addSheet(
    "Normalized Quantity",
    individualRows.map((row) => ({
      nodeId: row.nodeId,
      label: row.label,
      normalizedQuantity: row.normalizedQuantity,
    })),
    ["nodeId", "label", "normalizedQuantity"],
  );
  addSheet(
    "Quantity by Category",
    bundle.individuals === undefined ? [] : categoryRows(bundle.individuals),
    ["nodeId", "label", "category", "quantity"],
  );
  addSheet(
    "Normalized by Group",
    individualRows.map((row) => ({
      nodeId: row.nodeId,
      label: row.label,
      normalizedQuantityByGroup: row.normalizedQuantityByGroup ?? null,
    })),
    ["nodeId", "label", "normalizedQuantityByGroup"],
  );

  addSheet(
    "Significant Edges",
    (bundle.pruning?.significantEdges ?? []).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
    })),
    ["id", "source", "target", "weight"],
  );

  addSheet(
    "Cluster Labels",
    (bundle.communities?.nodeCommunities ?? []).map((row) => ({ ...row })),
    ["nodeId", "community"],
  );
  addSheet(
    "Community Summary",
    (bundle.communities?.communities ?? []).map((community) => ({
      community: community.id,
      memberCount: community.members.length,
      members: community.members.join(" | "),
      compressionRatio: bundle.communities?.compressionRatio ?? null,
      descriptionLength: bundle.communities?.descriptionLength ?? null,
    })),
    [
      "community",
      "memberCount",
      "members",
      "compressionRatio",
      "descriptionLength",
    ],
  );

  addSheet(
    "Diagnostics",
    allDiagnostics(bundle).map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      details: JSON.stringify(diagnostic.details),
    })),
    ["severity", "code", "message", "details"],
  );

  const bytes = xlsx.write(workbook, {
    bookType: "xlsx",
    compression: true,
    type: "array",
  }) as ArrayBuffer | Uint8Array;
  if (bytes instanceof ArrayBuffer) {
    return bytes.slice(0);
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
