import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const fixtureRoot = path.join(projectRoot, "examples", "next-app");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const keepTemporaryFiles = process.env.HINA_KEEP_VERIFY_TEMP === "1";

function verificationEnvironment(cacheRoot) {
  return {
    ...process.env,
    CI: process.env.CI ?? "1",
    NEXT_TELEMETRY_DISABLED: "1",
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
      maxBuffer: 64 * 1024 * 1024,
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

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
  return port;
}

async function waitForUrl(url, processExited, timeoutMilliseconds = 45_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    const exit = await Promise.race([
      processExited.then((result) => ({ exited: true, result })),
      delay(200, { exited: false }),
    ]);
    if (exit.exited) {
      throw new Error(`Next.js exited before becoming ready (code ${exit.result.code}, signal ${exit.result.signal}).`);
    }
    try {
      const response = await globalThis.fetch(url, {
        signal: globalThis.AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
      lastError = new Error(`Readiness probe returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Next.js did not become ready within ${timeoutMilliseconds}ms.`, { cause: lastError });
}

async function stopProcess(child, processExited) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    processExited.then(() => true),
    delay(5_000, false),
  ]);
  if (!stopped) child.kill("SIGKILL");
  await processExited;
}

async function main() {
  const cacheBase = process.env.HINA_VERIFY_TEMP_ROOT
    ? path.resolve(process.env.HINA_VERIFY_TEMP_ROOT)
    : path.join(projectRoot, "output", "hina-js-verification");
  await mkdir(cacheBase, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(cacheBase, "next-"));
  const packDirectory = path.join(temporaryRoot, "pack");
  const consumerRoot = path.join(temporaryRoot, "next-app");
  await mkdir(packDirectory, { recursive: true });
  const environment = verificationEnvironment(temporaryRoot);
  let child;
  let processExited;
  let serverOutput = "";

  try {
    console.log("Building and packing hina-js...");
    await run(npmCommand, ["run", "build"], { env: environment });
    const packed = await run(
      npmCommand,
      ["pack", "--json", "--ignore-scripts", "--pack-destination", packDirectory],
      { env: environment },
    );
    const packResults = JSON.parse(packed.stdout);
    assert.equal(packResults.length, 1, "npm pack returned an unexpected number of tarballs.");
    const packResult = packResults[0];
    const tarballPath = path.join(packDirectory, packResult.filename);

    await cp(fixtureRoot, consumerRoot, {
      recursive: true,
      filter: (source) => ![".next", "node_modules", "package-lock.json"].includes(path.basename(source)),
    });

    console.log("Installing the real tarball into the isolated Next.js 16 fixture...");
    await run(
      npmCommand,
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        "--no-save",
        "--prefer-offline",
        tarballPath,
      ],
      { cwd: consumerRoot, env: environment },
    );

    const [fixtureManifest, installedManifest, nextManifest] = await Promise.all([
      readFile(path.join(consumerRoot, "package.json"), "utf8").then(JSON.parse),
      readFile(path.join(consumerRoot, "node_modules", "hina-js", "package.json"), "utf8").then(JSON.parse),
      readFile(path.join(consumerRoot, "node_modules", "next", "package.json"), "utf8").then(JSON.parse),
    ]);
    assert.equal(installedManifest.name, "hina-js");
    assert.match(nextManifest.version, /^16\./, "The fixture must run on Next.js 16.");
    assert.equal(fixtureManifest.dependencies["hina-js"], undefined, "The committed fixture must not bypass the real tarball install.");

    console.log("Type-checking the fixture against published declarations...");
    await run(npmCommand, ["run", "typecheck"], { cwd: consumerRoot, env: environment });

    console.log("Building the production application with Turbopack...");
    const build = await run(npmCommand, ["run", "build"], { cwd: consumerRoot, env: environment });
    const buildOutput = `${build.stdout}\n${build.stderr}`;
    assert.match(buildOutput, /Turbopack/i, "Next.js build did not report the Turbopack compiler.");

    const port = await reservePort();
    const nextBin = path.join(consumerRoot, "node_modules", "next", "dist", "bin", "next");
    child = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: consumerRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { serverOutput += chunk; });
    child.stderr.on("data", (chunk) => { serverOutput += chunk; });
    processExited = new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForUrl(baseUrl, processExited);

    const [pageResponse, serverResponse, edgeResponse] = await Promise.all([
      globalThis.fetch(baseUrl, { signal: globalThis.AbortSignal.timeout(10_000) }),
      globalThis.fetch(`${baseUrl}/api/server-analysis`, { signal: globalThis.AbortSignal.timeout(10_000) }),
      globalThis.fetch(`${baseUrl}/api/edge-analysis`, { signal: globalThis.AbortSignal.timeout(10_000) }),
    ]);
    assert.equal(pageResponse.status, 200);
    assert.equal(serverResponse.status, 200);
    assert.equal(edgeResponse.status, 200);

    const [html, serverAnalysis, edgeAnalysis] = await Promise.all([
      pageResponse.text(),
      serverResponse.json(),
      edgeResponse.json(),
    ]);
    assert.match(html, /data-next-fixture="hina-js"/);
    assert.match(html, /data-server-import="ready"/);
    assert.match(html, /positioned (?:<!-- -->)?4(?:<!-- -->)? nodes/);
    assert.match(html, /data-client-workbench="ready"/);
    assert.match(html, /HINA Workbench/);
    assert.deepEqual(serverAnalysis, {
      runtime: "nodejs",
      graphKind: "bipartite",
      nodes: 4,
      edges: 3,
      totalWeight: 3,
    });
    assert.deepEqual(edgeAnalysis, {
      runtime: "edge",
      graphKind: "bipartite",
      nodes: 4,
      edges: 3,
      positionedNodes: 4,
    });

    console.log(JSON.stringify({
      status: "NEXT_VERIFICATION_OK",
      package: `${installedManifest.name}@${installedManifest.version}`,
      tarball: packResult.filename,
      next: nextManifest.version,
      compiler: "Turbopack",
      checks: [
        "server-component-import",
        "client-workbench-render",
        "nodejs-route-runtime",
        "edge-route-runtime",
        "production-build-and-start",
      ],
    }, null, 2));
  } catch (error) {
    console.error(`Next.js verification failed. Temporary root: ${temporaryRoot}`);
    if (child !== undefined) console.error(`Next.js output:\n${serverOutput}`);
    throw error;
  } finally {
    if (child !== undefined && processExited !== undefined) await stopProcess(child, processExited);
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
