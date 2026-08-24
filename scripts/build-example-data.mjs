import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as XLSX from "@e965/xlsx";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const exampleDirectory = new URL("../examples/data/", import.meta.url);
const sourceCopyPath = new URL("Yu_ena_coded_data_0712.xlsx", exampleDirectory);
const localSourcePath = new URL("../Yu_ena_coded_data_0712.xlsx", import.meta.url);
const csvPath = new URL("yu-hina-long.csv", exampleDirectory);
const workbookPath = new URL("yu-hina-long.xlsx", exampleDirectory);

const EXPECTED_SOURCE_HASH =
  "f2132f8dc3e147609169472594a2031130be23eab4a2ac0fb9adcb6d9d667042";
const EXPECTED_HEADERS = [
  "Group",
  "Lesson",
  "Name",
  "EC",
  "ICT",
  "MCO",
  "NI",
  "SR",
  "SC",
  "ATT",
];
const CODE_COLUMNS = ["EC", "ICT", "MCO", "NI", "SR", "SC", "ATT"];
const OUTPUT_HEADERS = [
  "StudentId",
  "Name",
  "Group",
  "Lesson",
  "Code",
  "Value",
];
const EXPECTED_SOURCE_ROWS = 174;
const EXPECTED_INTERACTIONS = 391;
const EXPECTED_ALL_ZERO_ROWS = 12;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertContract(condition, message) {
  if (!condition) {
    throw new Error(`Example data contract failed: ${message}`);
  }
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const records = [OUTPUT_HEADERS, ...rows.map((row) => OUTPUT_HEADERS.map((key) => row[key]))];
  return `${records.map((record) => record.map(csvCell).join(",")).join("\n")}\n`;
}

function readSourceRows(bytes) {
  const workbook = XLSX.read(bytes, {
    cellDates: false,
    cellFormula: false,
    dense: false,
    raw: true,
    type: "buffer",
  });
  assertContract(
    workbook.SheetNames.length === 1 && workbook.SheetNames[0] === "Sheet1",
    "the source workbook must contain exactly one worksheet named Sheet1",
  );
  const sheet = workbook.Sheets.Sheet1;
  assertContract(sheet !== undefined, "Sheet1 must exist");
  assertContract(sheet["!ref"] === "A1:J175", "the source range must remain A1:J175");
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    blankrows: false,
    defval: null,
    header: 1,
    raw: true,
  });
  const headers = matrix[0] ?? [];
  assertContract(
    JSON.stringify(headers) === JSON.stringify(EXPECTED_HEADERS),
    `source headers changed: ${JSON.stringify(headers)}`,
  );
  assertContract(
    matrix.length - 1 === EXPECTED_SOURCE_ROWS,
    `expected ${EXPECTED_SOURCE_ROWS} source rows, received ${matrix.length - 1}`,
  );
  return matrix.slice(1).map((values) =>
    Object.fromEntries(EXPECTED_HEADERS.map((header, index) => [header, values[index]])),
  );
}

function transformRows(sourceRows) {
  const interactions = [];
  let allZeroRows = 0;

  sourceRows.forEach((row, index) => {
    const sourceRow = index + 2;
    const group = typeof row.Group === "string" ? row.Group : "";
    const name = typeof row.Name === "string" ? row.Name : "";
    const lesson = typeof row.Lesson === "string" ? row.Lesson.trim() : "";
    assertContract(group.length > 0, `row ${sourceRow} has an empty Group`);
    assertContract(name.length > 0, `row ${sourceRow} has an empty Name`);
    assertContract(lesson.length > 0, `row ${sourceRow} has an empty Lesson`);

    let positiveCount = 0;
    for (const code of CODE_COLUMNS) {
      const value = row[code];
      assertContract(
        value === 0 || value === 1,
        `row ${sourceRow}, column ${code} must be numeric 0 or 1`,
      );
      if (value === 1) {
        positiveCount += 1;
        interactions.push({
          StudentId: `${group}::${name}`,
          Name: name,
          Group: group,
          Lesson: lesson,
          Code: code,
          Value: 1,
        });
      }
    }
    if (positiveCount === 0) allZeroRows += 1;
  });

  assertContract(
    interactions.length === EXPECTED_INTERACTIONS,
    `expected ${EXPECTED_INTERACTIONS} interactions, received ${interactions.length}`,
  );
  assertContract(
    allZeroRows === EXPECTED_ALL_ZERO_ROWS,
    `expected ${EXPECTED_ALL_ZERO_ROWS} all-zero rows, received ${allZeroRows}`,
  );
  return { interactions, allZeroRows };
}

function makeWorkbook(interactions) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(interactions, {
    header: OUTPUT_HEADERS,
    skipHeader: false,
  });
  worksheet["!cols"] = [
    { wch: 34 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 10 },
    { wch: 10 },
  ];
  worksheet["!autofilter"] = { ref: `A1:F${interactions.length + 1}` };
  XLSX.utils.book_append_sheet(workbook, worksheet, "HINA Long");
  return workbook;
}

function assertDerivedWorkbook(bytes, expectedRows) {
  const workbook = XLSX.read(bytes, {
    cellFormula: false,
    raw: true,
    type: "buffer",
  });
  assertContract(
    workbook.SheetNames.length === 1 && workbook.SheetNames[0] === "HINA Long",
    "derived workbook must contain exactly one HINA Long worksheet",
  );
  const sheet = workbook.Sheets["HINA Long"];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  assertContract(rows.length === EXPECTED_INTERACTIONS, "derived workbook row count changed");
  assertContract(
    JSON.stringify(rows) === JSON.stringify(expectedRows),
    "derived workbook values do not match the deterministic transformation",
  );
}

const checkOnly = process.argv.includes("--check");
const sourceBytes = await readFile(sourceCopyPath);
assertContract(sha256(sourceBytes) === EXPECTED_SOURCE_HASH, "source SHA-256 changed");
const localSourceBytes = await readFile(localSourcePath).catch((error) => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
  throw error;
});
if (localSourceBytes !== null) {
  assertContract(
    Buffer.compare(sourceBytes, localSourceBytes) === 0,
    "published source copy is not byte-identical to the local original",
  );
}
const sourceRows = readSourceRows(sourceBytes);
const { interactions, allZeroRows } = transformRows(sourceRows);
const csv = toCsv(interactions);

if (checkOnly) {
  assertContract((await readFile(csvPath, "utf8")) === csv, "derived CSV is stale");
  assertDerivedWorkbook(await readFile(workbookPath), interactions);
} else {
  await writeFile(csvPath, csv, "utf8");
  const workbookBytes = XLSX.write(makeWorkbook(interactions), {
    bookType: "xlsx",
    compression: true,
    type: "buffer",
  });
  await writeFile(workbookPath, workbookBytes);
  assertDerivedWorkbook(workbookBytes, interactions);
}

console.log(
  JSON.stringify({
    checkOnly,
    projectRoot,
    sourceSha256: EXPECTED_SOURCE_HASH,
    localSourceVerified: localSourceBytes !== null,
    sourceRows: sourceRows.length,
    interactionRows: interactions.length,
    allZeroRows,
  }),
);
