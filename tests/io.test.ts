import * as xlsx from "@e965/xlsx";
import { describe, expect, it, vi } from "vitest";

import packageManifest from "../package.json";
import { createBipartiteGraph } from "../src/construction";
import type { PruneEdgesResult } from "../src/dyad";
import { HinaValidationError } from "../src/errors";
import { analyzeIndividuals } from "../src/individual";
import {
  exportResultsXlsx,
  parseCsv,
  parseXlsx,
  type HinaResultsBundle,
} from "../src/io";
import type { CommunityResult } from "../src/mesoscale";

function workbookBytes(): ArrayBuffer {
  const workbook = xlsx.utils.book_new();
  const data = xlsx.utils.aoa_to_sheet([
    [" student ", "object", "identifier", "count", "active", "empty", "cached"],
    ["Alice", "Ask", "0007", 2, true, null, 42],
    ["Bob", "Explain", "0010", 3, false, "", 9],
  ]);
  data["G2"] = { f: "40+2", t: "n", v: 42 };
  xlsx.utils.book_append_sheet(workbook, data, "Data");
  xlsx.utils.book_append_sheet(
    workbook,
    xlsx.utils.aoa_to_sheet([
      ["student", "object"],
      ["Charlie", "Reflect"],
    ]),
    "Other",
  );
  return xlsx.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

describe("parseCsv", () => {
  it("parses UTF-8 CSV locally without coercing identifier-like cells", () => {
    const input = "\uFEFF student , object ,identifier\r\nAlice,Ask,00123\r\nBob,Explain,00007\r\n";
    const parsed = parseCsv(input, { name: "local.csv" });

    expect(parsed).toEqual({
      name: "local.csv",
      columns: ["student", "object", "identifier"],
      rows: [
        { student: "Alice", object: "Ask", identifier: "00123" },
        { student: "Bob", object: "Explain", identifier: "00007" },
      ],
      diagnostics: [],
    });
    expect(input).toContain("00123");
  });

  it("honors an explicit delimiter and rejects malformed row shapes", () => {
    expect(
      parseCsv("student;object\nAlice;Ask", { delimiter: ";" }).rows,
    ).toEqual([{ student: "Alice", object: "Ask" }]);

    expect(() => parseCsv("student,object\nAlice,Ask,extra")).toThrowError(
      HinaValidationError,
    );
    let emptyCsvError: unknown;
    try {
      parseCsv("");
    } catch (error) {
      emptyCsvError = error;
    }
    expect(emptyCsvError).toBeInstanceOf(HinaValidationError);
    expect(emptyCsvError).toMatchObject({ code: "UNSUPPORTED_FILE" });
  });
});

describe("parseXlsx", () => {
  it("reads selected local worksheets, cached values, and typed cells", async () => {
    const bytes = workbookBytes();
    const localFile = {
      arrayBuffer: vi.fn(() => Promise.resolve(bytes)),
    };
    const parsed = await parseXlsx(localFile, {
      sheetNames: ["Other", "Data"],
    });

    expect(localFile.arrayBuffer).toHaveBeenCalledOnce();
    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(["Other", "Data"]);
    expect(parsed.sheets[0]).toMatchObject({
      columns: ["student", "object"],
      rows: [{ student: "Charlie", object: "Reflect" }],
    });
    expect(parsed.sheets[1]).toMatchObject({
      columns: [
        "student",
        "object",
        "identifier",
        "count",
        "active",
        "empty",
        "cached",
      ],
      rows: [
        {
          student: "Alice",
          object: "Ask",
          identifier: "0007",
          count: 2,
          active: true,
          empty: null,
          cached: 42,
        },
        {
          student: "Bob",
          object: "Explain",
          identifier: "0010",
          count: 3,
          active: false,
          empty: "",
          cached: 9,
        },
      ],
    });
  });

  it("reports missing worksheet names as a structured validation error", async () => {
    await expect(
      parseXlsx(workbookBytes(), { sheetNames: ["Missing"] }),
    ).rejects.toMatchObject({
      name: "HinaValidationError",
      code: "UNSUPPORTED_FILE",
      details: { missingSheets: ["Missing"] },
    });
  });
});

describe("exportResultsXlsx", () => {
  it("exports all available result families as a readable workbook", async () => {
    const build = createBipartiteGraph(
      [
        { student: "Alice", object: "Ask", group: "A", category: "question" },
        { student: "Alice", object: "Explain", group: "A", category: "explanation" },
        { student: "Bob", object: "Ask", group: "B", category: "question" },
      ],
      {
        studentColumn: "student",
        objectColumn: "object",
        groupColumn: "group",
        attributeColumn: "category",
      },
    );
    const individuals = analyzeIndividuals(build.graph, {
      attribute: "category",
      diversityAttribute: "category",
      group: "group",
    });
    const actorIds = build.graph.nodes
      .filter((node) => node.partition === "student")
      .map((node) => node.id);
    const pruning: PruneEdgesResult = {
      graph: build.graph,
      significantEdges: build.graph.edges.slice(0, 1),
      removedEdges: build.graph.edges.slice(1),
      thresholds: [],
      diagnostics: [],
    };
    const communities: CommunityResult = {
      communityCount: 1,
      nodeCommunities: actorIds.map((nodeId) => ({ nodeId, community: 0 })),
      communities: [{ id: 0, members: actorIds }],
      compressionRatio: 0.5,
      descriptionLength: 12.25,
      graph: build.graph,
      subgraphs: [],
      diagnostics: [],
    };
    const bundle: HinaResultsBundle = {
      graph: build.graph,
      individuals,
      pruning,
      communities,
      diagnostics: [
        {
          code: "TEST_DIAGNOSTIC",
          severity: "info",
          message: "Exported diagnostic",
          details: { source: "test" },
        },
      ],
      metadata: { dataset: "sample", revision: 7 },
    };
    const graphBeforeExport = structuredClone(build.graph);

    const bytes = await exportResultsXlsx(bundle, {
      generatedAt: "2026-08-24T00:00:00.000Z",
    });
    const exported = xlsx.read(bytes, { type: "array" });

    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect(exported.SheetNames).toEqual([
      "Metadata",
      "Quantity",
      "Diversity",
      "Normalized Quantity",
      "Quantity by Category",
      "Normalized by Group",
      "Significant Edges",
      "Cluster Labels",
      "Community Summary",
      "Diagnostics",
    ]);
    expect(
      xlsx.utils.sheet_to_json(exported.Sheets["Metadata"]!),
    ).toEqual(expect.arrayContaining([
      { key: "package", value: "hina-js" },
      { key: "version", value: packageManifest.version },
      { key: "generatedAt", value: "2026-08-24T00:00:00.000Z" },
      { key: "dataset", value: "sample" },
      { key: "nodeCount", value: build.graph.nodes.length },
    ]));
    expect(
      xlsx.utils.sheet_to_json(exported.Sheets["Quantity"]!),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Alice", quantity: 2 }),
      expect.objectContaining({ label: "Bob", quantity: 1 }),
    ]));
    expect(
      xlsx.utils.sheet_to_json(exported.Sheets["Quantity by Category"]!),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Alice", category: "explanation", quantity: 1 }),
      expect.objectContaining({ label: "Alice", category: "question", quantity: 1 }),
    ]));
    expect(
      xlsx.utils.sheet_to_json(exported.Sheets["Diagnostics"]!),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "TEST_DIAGNOSTIC",
        message: "Exported diagnostic",
        details: '{"source":"test"}',
      }),
    ]));
    expect(build.graph).toEqual(graphBeforeExport);
  });
});
