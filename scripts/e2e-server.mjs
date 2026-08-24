import { execFile, spawn } from "node:child_process";
import { access, cp, copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const fixtureRoot = path.join(projectRoot, "examples", "next-app");
const outputRoot = path.join(projectRoot, "output", "e2e-next");
const applicationRoot = path.join(outputRoot, "app");
const packageRoot = path.join(outputRoot, "package");
const packageSourceRoot = path.join(outputRoot, "package-source");
const temporaryRoot = path.join(outputRoot, "tmp");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const portText = process.env.HINA_E2E_PORT ?? "4173";
const port = Number.parseInt(portText, 10);

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("HINA_E2E_PORT must be an integer between 1 and 65535.");
}

const relativeOutput = path.relative(projectRoot, outputRoot);
if (
  relativeOutput.length === 0 ||
  relativeOutput.startsWith(`..${path.sep}`) ||
  path.isAbsolute(relativeOutput)
) {
  throw new Error(`Refusing to prepare an unsafe E2E output path: ${outputRoot}`);
}

async function run(command, args, options = {}) {
  console.log(`[e2e-server] ${command} ${args.join(" ")}`);
  const result = await execFileAsync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stdout.trim().length > 0) console.log(result.stdout.trim());
  if (result.stderr.trim().length > 0) console.error(result.stderr.trim());
  return result;
}

await rm(outputRoot, {
  force: true,
  recursive: true,
  maxRetries: 5,
  retryDelay: 200,
});
await Promise.all([
  mkdir(applicationRoot, { recursive: true }),
  mkdir(packageRoot, { recursive: true }),
  mkdir(packageSourceRoot, { recursive: true }),
  mkdir(temporaryRoot, { recursive: true }),
]);

const environment = {
  ...process.env,
  CI: process.env.CI ?? "1",
  NEXT_TELEMETRY_DISABLED: "1",
  TMPDIR: temporaryRoot,
  npm_config_cache: process.env.npm_config_cache ?? path.join(projectRoot, ".npm-cache"),
  npm_config_logs_dir: path.join(outputRoot, "npm-logs"),
};

await run(npmCommand, ["run", "build"], { env: environment });

// Snapshot the freshly built publication payload before packing. This keeps the
// E2E consumer isolated from concurrent build-clean cycles in the source tree.
await mkdir(path.join(packageSourceRoot, "docs"), { recursive: true });
await Promise.all([
  cp(path.join(projectRoot, "dist"), path.join(packageSourceRoot, "dist"), {
    recursive: true,
  }),
  cp(
    path.join(projectRoot, "examples", "data"),
    path.join(packageSourceRoot, "examples", "data"),
    { recursive: true },
  ),
  ...[
    "package.json",
    "README.md",
    "README.zh-CN.md",
    "CHANGELOG.md",
    "LICENSE",
    "LICENSE.upstream",
    "NOTICE.md",
    "SECURITY.md",
    "CITATION.cff",
    "UPSTREAM.md",
  ].map((fileName) =>
    copyFile(
      path.join(projectRoot, fileName),
      path.join(packageSourceRoot, fileName),
    ),
  ),
  copyFile(
    path.join(projectRoot, "docs", "PARITY.md"),
    path.join(packageSourceRoot, "docs", "PARITY.md"),
  ),
]);
await Promise.all([
  access(path.join(packageSourceRoot, "dist", "index.js")),
  access(path.join(packageSourceRoot, "dist", "react", "index.js")),
  access(path.join(packageSourceRoot, "dist", "react", "styles.css")),
]);

const packed = await run(
  npmCommand,
  [
    "pack",
    packageSourceRoot,
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    packageRoot,
  ],
  { env: environment },
);
const packResults = JSON.parse(packed.stdout);
if (!Array.isArray(packResults) || packResults.length !== 1) {
  throw new Error("npm pack did not return exactly one package tarball.");
}
const packageFileName = packResults[0]?.filename;
if (typeof packageFileName !== "string" || packageFileName.length === 0) {
  throw new Error("npm pack returned a result without a tarball filename.");
}
const tarballPath = path.join(packageRoot, packageFileName);

await cp(fixtureRoot, applicationRoot, {
  recursive: true,
  filter: (source) => ![
    ".next",
    "node_modules",
    "package-lock.json",
  ].includes(path.basename(source)),
});

await run(
  npmCommand,
  [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-save",
    "--package-lock=false",
    "--prefer-offline",
    tarballPath,
  ],
  { cwd: applicationRoot, env: environment },
);

const [sourceManifest, installedManifest] = await Promise.all([
  readFile(path.join(projectRoot, "package.json"), "utf8").then(JSON.parse),
  readFile(
    path.join(applicationRoot, "node_modules", "hina-js", "package.json"),
    "utf8",
  ).then(JSON.parse),
]);
if (
  installedManifest.name !== "hina-js" ||
  installedManifest.version !== sourceManifest.version
) {
  throw new Error("The Next.js E2E fixture did not install the freshly packed hina-js tarball.");
}

await run(npmCommand, ["run", "build"], {
  cwd: applicationRoot,
  env: environment,
});

const nextBinary = path.join(
  applicationRoot,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
console.log(
  `[e2e-server] Starting ${installedManifest.name}@${installedManifest.version} from ${packageFileName} on http://127.0.0.1:${port}`,
);
const child = spawn(
  process.execPath,
  [nextBinary, "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: applicationRoot,
    env: environment,
    stdio: "inherit",
  },
);

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
};
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

const exit = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve({ code, signal }));
});
if (!stopping && exit.code !== 0) {
  throw new Error(
    `Next.js E2E server exited unexpectedly (code ${String(exit.code)}, signal ${String(exit.signal)}).`,
  );
}
