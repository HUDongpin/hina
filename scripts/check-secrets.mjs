import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

const patterns = [
  { name: "GitHub personal access token", expression: /\bgh[opusr]_[A-Za-z0-9_]{30,}\b/u },
  { name: "npm access token", expression: /\bnpm_[A-Za-z0-9]{30,}\b/u },
  { name: "AWS access key", expression: /\bAKIA[0-9A-Z]{16}\b/u },
  { name: "private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
];
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: new URL("../", import.meta.url), encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const findings = [];

for (const file of files) {
  const fileUrl = new URL(`../${file}`, import.meta.url);
  const metadata = await stat(fileUrl);
  if (metadata.size > 5_000_000) continue;
  const bytes = await readFile(fileUrl);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  for (const pattern of patterns) {
    if (pattern.expression.test(text)) findings.push({ file, type: pattern.name });
  }
}

if (findings.length > 0) {
  console.error(JSON.stringify({ findings }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ scannedFiles: files.length, findings: 0 }));
}
