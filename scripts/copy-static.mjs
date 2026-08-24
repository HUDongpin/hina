import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const target = new URL("../dist/react/", import.meta.url);
await mkdir(target, { recursive: true });
await copyFile(new URL("../src/react/styles.css", import.meta.url), new URL("styles.css", target));

// Bundlers are allowed to discard source directives during chunk generation.
// Reinstate the Next.js Client Component boundary as the first statement in
// both public JavaScript formats and verify it at package-test time.
for (const fileName of ["index.js", "index.cjs"]) {
  const output = new URL(fileName, target);
  const source = await readFile(output, "utf8");
  if (!source.startsWith('"use client";')) {
    await writeFile(output, `"use client";\n${source}`, "utf8");
  }
}
