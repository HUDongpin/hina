import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const publintCli = path.join(projectRoot, "node_modules", "publint", "src", "cli.js");
const attwCli = path.join(
  projectRoot,
  "node_modules",
  "@arethetypeswrong",
  "cli",
  "dist",
  "index.js",
);
const keepTemporaryFiles = process.env.HINA_KEEP_VERIFY_TEMP === "1";

const REQUIRED_EXPORTS = [
  ".",
  "./construction",
  "./individual",
  "./dyad",
  "./mesoscale",
  "./visualization",
  "./io",
  "./react",
  "./react/styles.css",
  "./node",
  "./package.json",
];

const ATTW_ENTRYPOINTS = [
  ".",
  "./construction",
  "./individual",
  "./dyad",
  "./mesoscale",
  "./visualization",
  "./io",
  "./react",
  "./node",
];

const REQUIRED_PACKAGE_FILE_ENTRIES = [
  "dist",
  "examples/data",
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "LICENSE.upstream",
  "NOTICE.md",
  "SECURITY.md",
  "CITATION.cff",
  "UPSTREAM.md",
  "docs/PARITY.md",
];

const REQUIRED_PACKAGE_FILES = [
  "package.json",
  "LICENSE",
  "LICENSE.upstream",
  "NOTICE.md",
  "SECURITY.md",
  "README.md",
  "README.zh-CN.md",
  "CITATION.cff",
  "UPSTREAM.md",
  "docs/PARITY.md",
  "examples/data/TRANSFORM.md",
  "examples/data/Yu_ena_coded_data_0712.xlsx",
  "examples/data/yu-hina-long.csv",
  "examples/data/yu-hina-long.xlsx",
];

const ALLOWED_STATIC_PACKAGE_FILES = new Set(REQUIRED_PACKAGE_FILES);

const FORBIDDEN_PACKAGE_PREFIXES = [
  ".git/",
  ".github/",
  ".npm-cache/",
  "examples/next-app/",
  "node_modules/",
  "output/",
  "outputs/",
  "scripts/",
  "src/",
  "tests/",
];

function isAllowedPackedPath(packedPath) {
  if (ALLOWED_STATIC_PACKAGE_FILES.has(packedPath)) return true;
  return packedPath.startsWith("dist/")
    && /\.(?:c?js(?:\.map)?|d\.(?:cts|ts)|css)$/.test(packedPath);
}

function verificationEnvironment(cacheRoot) {
  return {
    ...process.env,
    CI: process.env.CI ?? "1",
    npm_config_cache: process.env.npm_config_cache ?? path.join(projectRoot, ".npm-cache"),
    npm_config_logs_dir: process.env.npm_config_logs_dir ?? path.join(cacheRoot, "npm-logs"),
    TMPDIR: process.env.TMPDIR ?? cacheRoot,
  };
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: options.cwd ?? projectRoot,
      env: options.env ?? process.env,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\n${stdout}${stderr}`,
      { cause: error },
    );
  }
}

async function installedVersion(packageName) {
  const manifestPath = path.join(
    projectRoot,
    "node_modules",
    ...packageName.split("/"),
    "package.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(typeof manifest.version, "string");
  return manifest.version;
}

function exportTargets(exportValue) {
  if (typeof exportValue === "string") return [exportValue];
  assert.ok(
    exportValue !== null && typeof exportValue === "object",
    "Every package export must be a string or condition object.",
  );
  return Object.values(exportValue).flatMap((value) => exportTargets(value));
}

async function assertPackManifest(packResult, sourceManifest) {
  assert.equal(packResult.name, sourceManifest.name);
  assert.equal(packResult.version, sourceManifest.version);
  assert.ok(Array.isArray(packResult.files), "npm pack did not return a file manifest.");

  const packedPaths = new Set(packResult.files.map((file) => file.path));
  for (const requiredPath of REQUIRED_PACKAGE_FILES) {
    assert.ok(packedPaths.has(requiredPath), `Packed tarball is missing '${requiredPath}'.`);
  }

  for (const [subpath, exportValue] of Object.entries(sourceManifest.exports)) {
    for (const target of exportTargets(exportValue)) {
      const packedTarget = target.replace(/^\.\//, "");
      assert.ok(
        packedPaths.has(packedTarget),
        `Export '${subpath}' points to missing packed file '${packedTarget}'.`,
      );
    }
  }

  for (const packedPath of packedPaths) {
    assert.ok(
      isAllowedPackedPath(packedPath),
      `Tarball allowlist rejected unexpected path '${packedPath}'.`,
    );
    assert.ok(
      !FORBIDDEN_PACKAGE_PREFIXES.some((prefix) => packedPath.startsWith(prefix)),
      `Development-only path leaked into the tarball: '${packedPath}'.`,
    );
    const isTypeScriptSource = /\.(?:cts|mts|ts|tsx)$/.test(packedPath)
      && !/\.d\.(?:cts|mts|ts)$/.test(packedPath);
    assert.ok(!isTypeScriptSource, `TypeScript source leaked into the tarball: '${packedPath}'.`);
    assert.notEqual(packedPath, ".DS_Store", "macOS metadata leaked into the tarball.");
  }

  return packedPaths;
}

async function writeConsumerFixture(consumerRoot, tarballPath) {
  const [react, reactDom, typescript, typesNode, typesReact, typesReactDom] = await Promise.all([
    installedVersion("react"),
    installedVersion("react-dom"),
    installedVersion("typescript"),
    installedVersion("@types/node"),
    installedVersion("@types/react"),
    installedVersion("@types/react-dom"),
  ]);

  const manifest = {
    name: "hina-js-package-verification",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: {
      "hina-js": `file:${tarballPath}`,
      react,
      "react-dom": reactDom,
    },
    devDependencies: {
      "@types/node": typesNode,
      "@types/react": typesReact,
      "@types/react-dom": typesReactDom,
      typescript,
    },
  };

  const esmSmoke = String.raw`
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as root from "hina-js";

const require = createRequire(import.meta.url);

const subpaths = new Map([
  ["hina-js/construction", "createBipartiteGraph"],
  ["hina-js/individual", "analyzeQuantity"],
  ["hina-js/dyad", "pruneEdges"],
  ["hina-js/mesoscale", "detectCommunities"],
  ["hina-js/visualization", "layoutGraph"],
  ["hina-js/io", "parseCsv"],
  ["hina-js/react", "HinaWorkbench"],
  ["hina-js/node", "saveGraphFile"],
]);

for (const [specifier, expectedExport] of subpaths) {
  const module = await import(specifier);
  assert.equal(typeof module[expectedExport], "function", specifier + " did not expose " + expectedExport);
}

for (const forbiddenRootExport of ["parseCsv", "parseXlsx", "exportResultsXlsx", "HinaWorkbench", "HinaNetwork", "saveGraphFile"]) {
  assert.equal(forbiddenRootExport in root, false, forbiddenRootExport + " leaked through the root entrypoint");
}

const build = root.createBipartiteGraph(
  [
    { actor: "Ada", object: "Evidence" },
    { actor: "Ada", object: "Model" },
    { actor: "Bo", object: "Evidence" },
  ],
  { studentColumn: "actor", objectColumn: "object" },
);
assert.equal(build.graph.nodes.length, 4);
assert.equal(build.graph.edges.length, 3);
assert.equal(Object.keys(root.layoutGraph(build.graph, { type: "circular", seed: 17 }).positions).length, 4);
assert.equal(JSON.parse(root.serializeGraph(build.graph, "json")).kind, "bipartite");

assert.equal(require("hina-js/package.json").name, "hina-js");
console.log("ESM package smoke passed");
`;

  const cjsSmoke = String.raw`
"use strict";
const assert = require("node:assert/strict");
const root = require("hina-js");

const subpaths = new Map([
  ["hina-js/construction", "createBipartiteGraph"],
  ["hina-js/individual", "analyzeQuantity"],
  ["hina-js/dyad", "pruneEdges"],
  ["hina-js/mesoscale", "detectCommunities"],
  ["hina-js/visualization", "layoutGraph"],
  ["hina-js/io", "parseCsv"],
  ["hina-js/react", "HinaWorkbench"],
  ["hina-js/node", "saveGraphFile"],
]);

for (const [specifier, expectedExport] of subpaths) {
  const module = require(specifier);
  assert.equal(typeof module[expectedExport], "function", specifier + " did not expose " + expectedExport);
}

for (const forbiddenRootExport of ["parseCsv", "parseXlsx", "exportResultsXlsx", "HinaWorkbench", "HinaNetwork", "saveGraphFile"]) {
  assert.equal(forbiddenRootExport in root, false, forbiddenRootExport + " leaked through the root entrypoint");
}

const build = root.createBipartiteGraph(
  [{ actor: "Ada", object: "Evidence" }, { actor: "Bo", object: "Model" }],
  { studentColumn: "actor", objectColumn: "object" },
);
assert.equal(build.graph.nodes.length, 4);
assert.ok(require.resolve("hina-js/react/styles.css").endsWith("styles.css"));
assert.equal(require("hina-js/package.json").name, "hina-js");
console.log("CommonJS package smoke passed");
`;

  const typeSmoke = String.raw`
import {
  createBipartiteGraph,
  layoutGraph,
  serializeGraph,
  type HinaGraph,
  type TabularRow,
} from "hina-js";
import { createTripartiteGraph } from "hina-js/construction";
import { analyzeQuantity } from "hina-js/individual";
import { pruneEdges, type PruneEdgesResult } from "hina-js/dyad";
import { detectCommunities, type CommunityResult } from "hina-js/mesoscale";
import { projectGraph, type ProjectionResult } from "hina-js/visualization";
import { parseCsv, type ParsedDataset } from "hina-js/io";
import { HinaWorkbench, type HinaWorkbenchProps } from "hina-js/react";
import { saveGraphFile, type GraphSerializationFormat } from "hina-js/node";

// @ts-expect-error Node-only APIs must not be available from the portable root entrypoint.
import { saveGraphFile as forbiddenNodeExport } from "hina-js";
// @ts-expect-error Browser I/O APIs must stay behind the explicit io subpath.
import { parseCsv as forbiddenIoExport } from "hina-js";
// @ts-expect-error React APIs must stay behind the explicit react subpath.
import { HinaWorkbench as forbiddenReactExport } from "hina-js";

const rows: readonly TabularRow[] = [
  { actor: "Ada", object: "Evidence", object2: "Claim" },
  { actor: "Bo", object: "Model", object2: "Claim" },
];
const graph: HinaGraph = createBipartiteGraph(rows, {
  studentColumn: "actor",
  objectColumn: "object",
}).graph;
createTripartiteGraph(rows, {
  studentColumn: "actor",
  object1Column: "object",
  object2Column: "object2",
});
analyzeQuantity(graph);
const pruning: PruneEdgesResult = pruneEdges(graph);
const communities: CommunityResult = detectCommunities(graph, { targetPartition: "actor" });
const projection: ProjectionResult = projectGraph(graph, { targetPartition: "actor" });
layoutGraph(graph, { type: "cluster", communities });
serializeGraph(pruning.graph, "graphml");

const dataset: ParsedDataset = parseCsv("actor,object\nAda,Evidence", { name: "inline.csv" });
const props: HinaWorkbenchProps = { defaultDataset: dataset };
const workbench = <HinaWorkbench {...props} />;
const format: GraphSerializationFormat = "gexf";
const pendingSave: Promise<void> = saveGraphFile(projection.graph, "projection.gexf", format);

void workbench;
void pendingSave;
void forbiddenNodeExport;
void forbiddenIoExport;
void forbiddenReactExport;
`;

  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      skipLibCheck: false,
    },
    include: ["types-smoke.tsx"],
  };

  await Promise.all([
    writeFile(path.join(consumerRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(path.join(consumerRoot, "esm-smoke.mjs"), esmSmoke.trimStart()),
    writeFile(path.join(consumerRoot, "cjs-smoke.cjs"), cjsSmoke.trimStart()),
    writeFile(path.join(consumerRoot, "types-smoke.tsx"), typeSmoke.trimStart()),
    writeFile(path.join(consumerRoot, "tsconfig.json"), `${JSON.stringify(tsconfig, null, 2)}\n`),
  ]);
}

async function main() {
  const cacheBase = process.env.HINA_VERIFY_TEMP_ROOT
    ? path.resolve(process.env.HINA_VERIFY_TEMP_ROOT)
    : path.join(projectRoot, "output", "hina-js-verification");
  await mkdir(cacheBase, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(cacheBase, "package-"));
  const packDirectory = path.join(temporaryRoot, "pack");
  const consumerRoot = path.join(temporaryRoot, "consumer");
  await Promise.all([
    mkdir(packDirectory, { recursive: true }),
    mkdir(consumerRoot, { recursive: true }),
  ]);
  const environment = verificationEnvironment(temporaryRoot);

  try {
    const sourceManifest = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
    assert.equal(sourceManifest.name, "hina-js");
    assert.deepEqual(Object.keys(sourceManifest.exports), REQUIRED_EXPORTS);
    assert.deepEqual(sourceManifest.files, REQUIRED_PACKAGE_FILE_ENTRIES);

    console.log("Building distributable package...");
    await run(npmCommand, ["run", "build"], { env: environment });

    console.log("Creating npm tarball...");
    const packed = await run(
      npmCommand,
      ["pack", "--json", "--ignore-scripts", "--pack-destination", packDirectory],
      { env: environment },
    );
    const packResults = JSON.parse(packed.stdout);
    assert.equal(packResults.length, 1, "npm pack returned an unexpected number of tarballs.");
    const packResult = packResults[0];
    const packedPaths = await assertPackManifest(packResult, sourceManifest);
    const tarballPath = path.join(packDirectory, packResult.filename);
    await access(tarballPath);

    console.log("Checking package metadata with publint and Are The Types Wrong...");
    await run(process.execPath, [publintCli, "run", tarballPath, "--strict"], {
      env: environment,
    });
    await run(
      process.execPath,
      [
        attwCli,
        tarballPath,
        "--profile",
        "node16",
        "--no-definitely-typed",
        "--no-color",
        "--no-emoji",
        "--entrypoints",
        ...ATTW_ENTRYPOINTS,
      ],
      { env: environment },
    );

    await writeConsumerFixture(consumerRoot, tarballPath);
    console.log("Installing the real tarball into an isolated consumer...");
    await run(
      npmCommand,
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        "--prefer-offline",
      ],
      { cwd: consumerRoot, env: environment },
    );

    const installedManifest = JSON.parse(
      await readFile(path.join(consumerRoot, "node_modules", "hina-js", "package.json"), "utf8"),
    );
    assert.equal(installedManifest.version, sourceManifest.version);
    assert.deepEqual(Object.keys(installedManifest.exports), REQUIRED_EXPORTS);
    const installedPackageRoot = path.join(consumerRoot, "node_modules", "hina-js");
    const [rootEsm, rootCjs, reactEsm, reactCjs] = await Promise.all([
      readFile(path.join(installedPackageRoot, "dist", "index.js"), "utf8"),
      readFile(path.join(installedPackageRoot, "dist", "index.cjs"), "utf8"),
      readFile(path.join(installedPackageRoot, "dist", "react", "index.js"), "utf8"),
      readFile(path.join(installedPackageRoot, "dist", "react", "index.cjs"), "utf8"),
    ]);
    assert.doesNotMatch(rootEsm, /["']node:[^"']+["']/, "Portable root ESM references a Node.js builtin.");
    assert.doesNotMatch(rootCjs, /["']node:[^"']+["']/, "Portable root CommonJS references a Node.js builtin.");
    assert.ok(reactEsm.startsWith('"use client";'), "React ESM must begin with the Client Component directive.");
    assert.ok(reactCjs.startsWith('"use client";'), "React CommonJS must begin with the Client Component directive.");

    console.log("Checking ESM, CommonJS, subpath exports, and root boundaries...");
    await run(process.execPath, ["esm-smoke.mjs"], { cwd: consumerRoot, env: environment });
    await run(process.execPath, ["cjs-smoke.cjs"], { cwd: consumerRoot, env: environment });

    console.log("Checking published TypeScript declarations...");
    await run(
      process.execPath,
      [path.join(consumerRoot, "node_modules", "typescript", "bin", "tsc"), "--project", "tsconfig.json"],
      { cwd: consumerRoot, env: environment },
    );

    console.log(JSON.stringify({
      status: "PACKAGE_VERIFICATION_OK",
      package: `${sourceManifest.name}@${sourceManifest.version}`,
      tarball: packResult.filename,
      packedFileCount: packedPaths.size,
      verifiedExports: REQUIRED_EXPORTS,
      runtimeModes: ["esm", "cjs"],
      declarations: "strict-consumer-pass",
      rootBoundary: "portable-only",
      rootNodeBuiltins: "absent",
      reactBoundary: "use-client-first-statement",
      packageLint: ["publint-strict", "attw-node16"],
      tarballAllowlist: "exact-static-files-and-dist-artifacts",
    }, null, 2));
  } catch (error) {
    console.error(`Package verification failed. Temporary root: ${temporaryRoot}`);
    throw error;
  } finally {
    if (!keepTemporaryFiles) {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
    }
  }
}

await main();
