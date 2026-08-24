import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import * as xlsx from "@e965/xlsx";

const outputRoot = path.join(process.cwd(), "output", "e2e-next");
const fixtureRoot = path.join(outputRoot, "fixtures");
const downloadRoot = path.join(outputRoot, "downloads");
const csvPath = path.join(fixtureRoot, "workbench.csv");
const singleSheetPath = path.join(fixtureRoot, "single-sheet.xlsx");
const multiSheetPath = path.join(fixtureRoot, "multi-sheet.xlsx");

const sourceRows: readonly (readonly [string, string, string, string, string])[] = [
  ...Array.from({ length: 12 }, () => ["Alice", "Ask", "Forum", "A", "Reasoning"] as const),
  ...Array.from({ length: 2 }, () => ["Alice", "Model", "Essay", "A", "Representation"] as const),
  ...Array.from({ length: 12 }, () => ["Bob", "Explain", "Forum", "B", "Reasoning"] as const),
  ...Array.from({ length: 12 }, () => ["Cara", "Reflect", "Essay", "B", "Reflection"] as const),
];

function workbookBuffer(
  sheets: readonly {
    readonly name: string;
    readonly rows: readonly (readonly unknown[])[];
  }[],
): Uint8Array {
  const workbook = xlsx.utils.book_new();
  for (const sheet of sheets) {
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.aoa_to_sheet(sheet.rows.map((row) => [...row])),
      sheet.name,
    );
  }
  const bytes = xlsx.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer | Uint8Array;
  return bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
}

async function nextPaint(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }),
  );
}

async function runAnalysis(page: Page): Promise<void> {
  const canvases = page.locator(".hina-network__canvas canvas");
  const previousCanvas = await canvases.count() > 0
    ? await canvases.first().elementHandle()
    : null;
  await page.getByRole("button", { name: "Run HINA", exact: true }).click();

  if (previousCanvas !== null) {
    await expect.poll(
      () => previousCanvas.evaluate((canvas) => canvas.isConnected),
      { message: "the previous Cytoscape instance should be replaced" },
    ).toBe(false);
  }
  await expect(page.locator(".hina-error[role=\"alert\"]")).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "HINA results" })).toBeVisible();
  await expect(page.locator(".hina-network__canvas canvas").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run HINA", exact: true })).toBeEnabled();
}

async function waitForNetworkRefresh(
  page: Page,
  change: () => Promise<unknown>,
): Promise<void> {
  const previousCanvas = await page
    .locator(".hina-network__canvas canvas")
    .first()
    .elementHandle();
  await change();
  if (previousCanvas !== null) {
    await expect.poll(
      () => previousCanvas.evaluate((canvas) => canvas.isConnected),
      { message: "the Cytoscape canvas should refresh after a display change" },
    ).toBe(false);
  }
  await expect(page.locator(".hina-network__canvas canvas").first()).toBeVisible();
  await nextPaint(page);
}

async function saveDownload(
  page: Page,
  buttonName: string,
  targetName: string,
): Promise<string> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const download = await downloadPromise;
  const targetPath = path.join(downloadRoot, targetName);
  await download.saveAs(targetPath);
  expect(await download.failure()).toBeNull();
  return targetPath;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await Promise.all([
    mkdir(fixtureRoot, { recursive: true }),
    mkdir(downloadRoot, { recursive: true }),
  ]);

  const csv = [
    "actor,object,context,group,category",
    ...sourceRows.map((row) => row.join(",")),
  ].join("\n");
  await writeFile(csvPath, `\uFEFF${csv}\n`, "utf8");

  const header = ["actor", "object", "context", "group", "category"] as const;
  await writeFile(
    singleSheetPath,
    workbookBuffer([{ name: "Only", rows: [header, ...sourceRows.slice(0, 6)] }]),
  );
  await writeFile(
    multiSheetPath,
    workbookBuffer([
      { name: "Bipartite", rows: [header, ...sourceRows.slice(0, 8)] },
      { name: "Tripartite", rows: [header, ...sourceRows] },
    ]),
  );
});

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-next-fixture="hina-js"]')).toBeVisible();
  await expect(page.locator('[data-server-import="ready"]')).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Client-side HINA workbench" }),
  ).toBeVisible();
});

test("runs a pruned fixed-B CSV analysis and exercises controls, filters, downloads, and keyboard tabs", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.getByLabel("Choose CSV/XLSX").setInputFiles(csvPath);
  await expect(page.getByRole("status")).toHaveText(
    "workbench.csv: 38 rows · 5 columns",
  );
  await expect(page.getByRole("combobox", { name: "Object1 / actor" })).toHaveValue("actor");
  await expect(page.getByRole("combobox", { name: "Object2", exact: true })).toHaveValue("object");
  await expect(page.getByRole("combobox", { name: "Object3" })).toHaveValue("");

  await page.getByRole("combobox", { name: "Object1 attribute" }).selectOption("group");
  await page.getByRole("combobox", { name: "Object2 attribute" }).selectOption("category");
  await page.getByRole("spinbutton", { name: "Fixed communities" }).fill("2");
  await page.getByRole("checkbox", { name: "Prune insignificant edges" }).check();
  await expect(page.getByRole("spinbutton", { name: "Alpha" })).toHaveValue("0.05");

  await runAnalysis(page);
  await expect(
    page.getByRole("img", { name: "HINA network with 7 nodes and 3 edges" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Significant Edges" }).click();
  await expect(page.getByRole("table", { name: "Significant Edges" }).locator("tbody tr")).toHaveCount(3);
  await page.getByRole("tab", { name: "Cluster Labels" }).click();
  await expect(page.getByRole("table", { name: "Cluster Labels" }).locator("tbody tr")).toHaveCount(3);
  await page.getByRole("tab", { name: "Community Summary" }).click();
  await expect(page.getByRole("table", { name: "Community Summary" }).locator("tbody tr")).toHaveCount(2);

  const quantityTab = page.getByRole("tab", { name: "Quantity", exact: true });
  await quantityTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Diversity" })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Diversity" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Community Summary" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(quantityTab).toBeFocused();

  const network = page.locator(".hina-network__canvas");
  const labelled = await network.screenshot();
  const nodeLabels = page.getByRole("checkbox", { name: "Node labels" });
  await expect(nodeLabels).toBeChecked();
  await waitForNetworkRefresh(page, () => nodeLabels.uncheck());
  const unlabelled = await network.screenshot();
  expect(unlabelled.equals(labelled)).toBe(false);
  await waitForNetworkRefresh(page, () => nodeLabels.check());

  const beforeZoom = await network.screenshot();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await nextPaint(page);
  const afterZoom = await network.screenshot();
  expect(afterZoom.equals(beforeZoom)).toBe(false);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await nextPaint(page);
  await page.getByRole("button", { name: "Reset view" }).click();
  await nextPaint(page);
  const afterReset = await network.screenshot();
  expect(afterReset.equals(afterZoom)).toBe(false);

  await waitForNetworkRefresh(page, () =>
    page.getByRole("combobox", { name: "Group", exact: true }).selectOption("B"),
  );
  await expect(
    page.getByRole("img", { name: "HINA network with 4 nodes and 2 edges" }),
  ).toBeVisible();
  const accessibleNetwork = page.locator(".hina-network__accessible-list");
  await expect(accessibleNetwork).toContainText("Bob — actor");
  await expect(accessibleNetwork).toContainText("Cara — actor");
  await expect(accessibleNetwork).not.toContainText("Alice — actor");

  const jsonPath = await saveDownload(page, "Export JSON", "bipartite-network.json");
  const graph = JSON.parse(await readFile(jsonPath, "utf8"));
  expect(graph).toMatchObject({
    kind: "bipartite",
    directed: false,
    multigraph: false,
  });
  expect(graph.nodes).toHaveLength(7);
  expect(graph.edges).toHaveLength(4);

  const pngPath = await saveDownload(page, "Export PNG", "filtered-network.png");
  const png = await readFile(pngPath);
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(png.byteLength).toBeGreaterThan(1_000);

  const xlsxPath = await saveDownload(page, "Export XLSX", "analysis-results.xlsx");
  const exportedWorkbook = xlsx.read(await readFile(xlsxPath), { type: "buffer" });
  expect(exportedWorkbook.SheetNames).toEqual([
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
  expect(pageErrors).toEqual([]);
});

test("loads a single-sheet XLSX without presenting a worksheet switcher", async ({ page }) => {
  await page.getByLabel("Choose CSV/XLSX").setInputFiles(singleSheetPath);

  await expect(page.getByRole("status")).toHaveText("Only: 6 rows · 5 columns");
  await expect(page.getByRole("combobox", { name: "Worksheet" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Object1 attribute" }).selectOption("group");
  await page.getByRole("combobox", { name: "Object2 attribute" }).selectOption("category");
  await runAnalysis(page);
  await expect(page.getByRole("table", { name: "Quantity" })).toBeVisible();
  await expect(page.locator(".hina-network__accessible-list")).toContainText("Alice — actor");
});

test("switches a multi-sheet XLSX from bipartite to tripartite analysis", async ({ page }) => {
  await page.getByLabel("Choose CSV/XLSX").setInputFiles(multiSheetPath);

  const worksheet = page.getByRole("combobox", { name: "Worksheet" });
  await expect(worksheet).toBeVisible();
  await expect(worksheet).toHaveValue("Bipartite");
  await expect(page.getByRole("status")).toHaveText("Bipartite: 8 rows · 5 columns");
  await page.getByRole("combobox", { name: "Object1 attribute" }).selectOption("group");
  await page.getByRole("combobox", { name: "Object2 attribute" }).selectOption("category");
  await runAnalysis(page);

  const bipartitePath = await saveDownload(page, "Export JSON", "workbook-bipartite.json");
  expect(JSON.parse(await readFile(bipartitePath, "utf8"))).toMatchObject({
    kind: "bipartite",
  });

  await worksheet.selectOption("Tripartite");
  await expect(page.getByRole("status")).toHaveText("Tripartite: 38 rows · 5 columns");
  await page.getByRole("combobox", { name: "Object3" }).selectOption("context");
  await page.getByRole("combobox", { name: "Object2 attribute" }).selectOption("");
  await runAnalysis(page);

  const tripartitePath = await saveDownload(page, "Export JSON", "workbook-tripartite.json");
  const tripartite = JSON.parse(await readFile(tripartitePath, "utf8"));
  expect(tripartite).toMatchObject({
    kind: "tripartite",
    directed: false,
    multigraph: false,
  });
  expect(tripartite.partitions).toHaveLength(2);
  expect(tripartite.partitions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: "actor" }),
      expect.objectContaining({ role: "composite" }),
    ]),
  );
  await expect(page.locator(".hina-network__accessible-list")).toContainText("Ask**Forum");
});
