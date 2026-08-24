import { writeFile } from "node:fs/promises";
import { extname } from "node:path";

import { HinaValidationError } from "./errors";
import type {
  ExportResultsXlsxOptions,
  HinaResultsBundle,
} from "./io";
import {
  serializeGraph,
  type GraphSerializationFormat,
} from "./serialization";
import type { HinaGraph } from "./types";

const FORMAT_BY_EXTENSION: Readonly<Record<string, GraphSerializationFormat>> = {
  ".json": "json",
  ".gml": "gml",
  ".gexf": "gexf",
  ".graphml": "graphml",
};

function inferFormat(filePath: string): GraphSerializationFormat {
  const extension = extname(filePath).toLowerCase();
  if (extension.length === 0) return "json";
  const format = FORMAT_BY_EXTENSION[extension];
  if (format === undefined) {
    throw new HinaValidationError(
      "UNSUPPORTED_FORMAT",
      `Cannot infer a graph format from extension ${extension}.`,
      { extension, filePath },
    );
  }
  return format;
}

/**
 * Serialize and write a graph using Node.js. When `format` is omitted, the
 * extension is used; extensionless paths default to JSON.
 */
export async function saveGraphFile(
  graph: HinaGraph,
  filePath: string,
  format?: GraphSerializationFormat,
): Promise<void> {
  if (filePath.trim().length === 0) {
    throw new HinaValidationError(
      "INVALID_ARGUMENT",
      "Graph output path must not be empty.",
    );
  }
  const resolvedFormat = format ?? inferFormat(filePath);
  await writeFile(filePath, serializeGraph(graph, resolvedFormat), "utf8");
}

/** Generate and save a complete HINA results workbook using Node.js. */
export async function saveResultsXlsxFile(
  bundle: HinaResultsBundle,
  filePath: string,
  options: ExportResultsXlsxOptions = {},
): Promise<void> {
  if (filePath.trim().length === 0) {
    throw new HinaValidationError(
      "INVALID_ARGUMENT",
      "XLSX output path must not be empty.",
    );
  }
  if (extname(filePath).toLowerCase() !== ".xlsx") {
    throw new HinaValidationError(
      "UNSUPPORTED_FILE",
      "Result workbooks must use the .xlsx extension.",
      { filePath },
    );
  }
  const { exportResultsXlsx } = await import("./io");
  const bytes = await exportResultsXlsx(bundle, options);
  await writeFile(filePath, new Uint8Array(bytes));
}

export type { GraphSerializationFormat } from "./serialization";
export type { ExportResultsXlsxOptions, HinaResultsBundle } from "./io";
