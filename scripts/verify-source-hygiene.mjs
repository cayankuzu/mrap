#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const selfPath = toPortablePath(path.relative(repositoryRoot, scriptPath));
const deprecatedBrandPattern = new RegExp(`\\b${["map", "wrap"].join("")}\\b`, "i");

const sourceDirectories = ["src", "docs", "scripts", "supabase", "config", ".github"];
const textExtensions = new Set([
  ".cjs",
  ".conf",
  ".css",
  ".cts",
  ".env",
  ".gql",
  ".graphql",
  ".htm",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".less",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".ps1",
  ".sass",
  ".scss",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const excludedDirectoryNames = new Set([
  "__fixtures__",
  "__mocks__",
  "__tests__",
  "fixture",
  "fixtures",
  "mock",
  "mocks",
  "test",
  "test-data",
  "testdata",
  "tests",
]);
const rootTextFilePatterns = [
  /^README(?:\..+)?$/i,
  /^CHANGELOG(?:\..+)?$/i,
  /^package(?:-lock)?\.json$/i,
  /^\.env(?:\..+)?$/i,
  /^(?:eslint|next|playwright|vitest)\.config\.[cm]?[jt]s$/i,
  /^tsconfig(?:\..+)?\.json$/i,
  /^vercel\.json$/i,
];

const mojibakeFragments = [
  "\u00c3\u00a7",
  "\u00c3\u2021",
  "\u00c3\u00b6",
  "\u00c3\u2013",
  "\u00c3\u00bc",
  "\u00c3\u0153",
  "\u00c4\u00b0",
  "\u00c4\u00b1",
  "\u00c4\u0178",
  "\u00c4\u017e",
  "\u00c5\u0178",
  "\u00c5\u017e",
  "\u00e2\u20ac",
  "\u00c2\u00a0",
];

const secretPatterns = [
  ["private-key", /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["google-api-key", /\bAIza[A-Za-z0-9_-]{30,}\b/],
  ["openai-api-key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/],
  ["npm-token", /\bnpm_[A-Za-z0-9]{30,}\b/],
  ["gitlab-token", /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ["stripe-live-secret", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["supabase-secret", /\bsb_secret_[A-Za-z0-9_-]{16,}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/],
  [
    "credential-url",
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:'"`]+:[^@\s/'"`]{4,}@[^\s'"`]+/i,
  ],
];
const secretAssignmentPattern =
  /\b(?:api[_-]?key|client[_-]?secret|secret|access[_-]?token|auth[_-]?token|password)\b\s*[:=]\s*["'`]([^"'`\r\n]{16,})["'`]/i;
const placeholderFragments = [
  "change-me",
  "changeme",
  "dummy",
  "example",
  "fake",
  "not-a-secret",
  "placeholder",
  "replace-me",
  "replace_with",
  "sample",
  "test-only",
  "your-",
  "your_",
];

function toPortablePath(value) {
  return value.split(path.sep).join("/");
}

function isExcludedTestOrFixture(relativePath) {
  const portablePath = toPortablePath(relativePath).toLowerCase();
  const segments = portablePath.split("/");
  const basename = segments.at(-1) ?? "";

  if (segments.some((segment) => excludedDirectoryNames.has(segment)))
    return true;
  return (
    /\.(?:fixture|spec|test)\.[^.]+$/.test(basename) ||
    /\.(?:snap|snapshot)$/.test(basename)
  );
}

function isSupportedTextFile(filePath) {
  const basename = path.basename(filePath);
  return (
    textExtensions.has(path.extname(basename).toLowerCase()) ||
    /^\.env(?:\..+)?$/i.test(basename)
  );
}

async function collectDirectoryFiles(directoryPath, files) {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(directoryPath, entry.name);
    const relativePath = path.relative(repositoryRoot, absolutePath);

    if (entry.isDirectory()) {
      if (!excludedDirectoryNames.has(entry.name.toLowerCase())) {
        await collectDirectoryFiles(absolutePath, files);
      }
      continue;
    }

    if (!entry.isFile() || !isSupportedTextFile(absolutePath)) continue;
    const portablePath = toPortablePath(relativePath);
    if (portablePath === selfPath || isExcludedTestOrFixture(relativePath))
      continue;
    files.add(absolutePath);
  }
}

async function collectFiles() {
  const files = new Set();

  for (const directory of sourceDirectories) {
    await collectDirectoryFiles(path.join(repositoryRoot, directory), files);
  }

  const rootEntries = await readdir(repositoryRoot, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (
      !entry.isFile() ||
      !rootTextFilePatterns.some((pattern) => pattern.test(entry.name))
    )
      continue;
    files.add(path.join(repositoryRoot, entry.name));
  }

  return [...files].sort((left, right) =>
    toPortablePath(left).localeCompare(toPortablePath(right), "en"),
  );
}

function isPlaceholderSecret(value) {
  const normalized = value.toLowerCase();
  return (
    value.includes("${") ||
    value.includes("<") ||
    value.includes(">") ||
    placeholderFragments.some((fragment) => normalized.includes(fragment))
  );
}

function addFinding(findings, file, line, rule, excerpt, redact = false) {
  findings.push({
    file,
    line,
    rule,
    excerpt: redact
      ? "<gizlendi>"
      : excerpt.trim().replace(/\s+/g, " ").slice(0, 180),
  });
}

function scanText(relativePath, text, findings) {
  const lines = text.split(/\r?\n/);
  const isProductionSource = relativePath.startsWith("src/");

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;

    if (deprecatedBrandPattern.test(line)) {
      addFinding(findings, relativePath, lineNumber, "eski-marka", line);
    }
    if (/\b(?:TODO|FIXME|HACK)\b/.test(line)) {
      addFinding(findings, relativePath, lineNumber, "bitmemis-is", line);
    }
    if (
      line.includes("\uFFFD") ||
      mojibakeFragments.some((fragment) => line.includes(fragment))
    ) {
      addFinding(findings, relativePath, lineNumber, "mojibake", line);
    }
    if (
      isProductionSource &&
      /\bconsole\s*(?:(?:\?\.|\.)\s*(?:log|debug)|\[\s*["'](?:log|debug)["']\s*\])\s*\(/.test(
        line,
      )
    ) {
      addFinding(findings, relativePath, lineNumber, "production-debug", line);
    }
    if (isProductionSource && /\bdebugger\s*;/.test(line)) {
      addFinding(
        findings,
        relativePath,
        lineNumber,
        "production-debugger",
        line,
      );
    }

    for (const [rule, pattern] of secretPatterns) {
      if (pattern.test(line))
        addFinding(findings, relativePath, lineNumber, rule, line, true);
    }

    const assignmentMatch = line.match(secretAssignmentPattern);
    if (assignmentMatch && !isPlaceholderSecret(assignmentMatch[1])) {
      addFinding(
        findings,
        relativePath,
        lineNumber,
        "literal-secret-assignment",
        line,
        true,
      );
    }
  }
}

async function main() {
  const files = await collectFiles();
  const findings = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });

  for (const absolutePath of files) {
    const relativePath = toPortablePath(
      path.relative(repositoryRoot, absolutePath),
    );
    let text;
    try {
      text = decoder.decode(await readFile(absolutePath));
    } catch (error) {
      addFinding(
        findings,
        relativePath,
        1,
        "gecersiz-utf8-veya-okuma-hatasi",
        String(error?.message ?? error),
      );
      continue;
    }
    scanText(relativePath, text, findings);
  }

  if (findings.length === 0) {
    console.log(`Kaynak hijyeni temiz: ${files.length} metin dosyasi tarandi.`);
    return;
  }

  console.error(`Kaynak hijyeni basarisiz: ${findings.length} bulgu.`);
  for (const finding of findings) {
    console.error(
      `- ${finding.file}:${finding.line} [${finding.rule}] ${finding.excerpt}`,
    );
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    `Kaynak hijyeni taramasi calistirilamadi: ${error?.stack ?? error}`,
  );
  process.exitCode = 1;
});
