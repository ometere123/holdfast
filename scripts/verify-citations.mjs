/**
 * Resolve every `Holdfast.py:N` citation in this repository and print the line it lands on.
 *
 * The comments in `src/lib` cite the contract by line number, which is the most useful form to
 * read and the easiest to break: re-splicing the embedded archive module shifted every line below
 * it by fifteen, and four citations written before that splice silently pointed fifteen lines above
 * what they claimed. A citation that resolves to the wrong line is worse than no citation, because
 * a reader who checks it is shown something plausible and concludes the comment was right.
 *
 * What this proves and what it does not. It proves the cited line exists and is not blank, and it
 * prints the line so a reader can judge the match themselves. It does not prove the line says what
 * the comment claims: no script can, because the claim is prose. The print is the point. Run it
 * after any change to the contract, read the right-hand column, and fix what has drifted.
 *
 * `--quiet` prints only failures and the summary, for use inside `npm run verify`.
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const CONTRACT = join(ROOT, "contracts", "Holdfast.py");
const QUIET = process.argv.includes("--quiet");

const SEARCH_DIRS = ["src", "scripts", "docs", "tests"];
const SEARCH_FILES = ["README.md"];
const SEARCH_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js", ".py", ".md", ".json"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "test-results", "playwright-report", "__pycache__"]);

const CITATION = /Holdfast\.py:(\d+)(?:-(\d+))?/g;

/**
 * A bare backtick-quoted line number, which is how four broken citations avoided the check above.
 *
 * A parenthesised (:2001) reads perfectly well in a paragraph that has already named the file, and
 * it is invisible to a search for the filename. Rather than teach the scanner to track which file a
 * paragraph is talking about, these are refused outright: write the filename every time. The
 * example in this sentence is deliberately unquoted so that this comment does not fail its own rule.
 */
const BARE_CITATION = /`:(\d+)`/g;

const contractLines = readFileSync(CONTRACT, "utf8").split(/\r?\n/);

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await walk(full)));
      continue;
    }
    if (SEARCH_EXTENSIONS.has(extname(entry.name))) out.push(full);
  }
  return out;
}

const files = [
  ...(await Promise.all(SEARCH_DIRS.map((dir) => walk(join(ROOT, dir))))).flat(),
  ...SEARCH_FILES.map((name) => join(ROOT, name)),
];

let total = 0;
const failures = [];
const rows = [];

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!text.includes("Holdfast.py:") && !BARE_CITATION.test(text)) continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(BARE_CITATION)) {
      failures.push(
        `${relative(ROOT, file)}:${index + 1} cites ${match[0]} without naming a file. Write \`Holdfast.py:${match[1]}\` so the citation can be resolved from where it is read.`,
      );
    }
    for (const match of line.matchAll(CITATION)) {
      total += 1;
      const cited = Number(match[1]);
      const where = `${relative(ROOT, file)}:${index + 1}`;
      const target = contractLines[cited - 1];
      if (target === undefined) {
        failures.push(`${where} cites ${match[0]}, but the contract has ${contractLines.length} lines.`);
        continue;
      }
      if (target.trim() === "") {
        failures.push(`${where} cites ${match[0]}, which is a blank line.`);
        continue;
      }
      const end = match[2] ? Number(match[2]) : 0;
      if (end && (contractLines[end - 1] === undefined || end < cited)) {
        failures.push(`${where} cites the range ${match[0]}, which does not resolve.`);
        continue;
      }
      rows.push([where, match[0], target.trim().slice(0, 84)]);
    }
  });
}

if (!QUIET) {
  const widest = rows.reduce((max, row) => Math.max(max, row[0].length), 0);
  for (const [where, citation, target] of rows) {
    console.log(`${where.padEnd(widest)}  ${citation.padEnd(22)}  ${target}`);
  }
  console.log("");
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  console.error(`${failures.length} of ${total} citations do not resolve.`);
  process.exit(1);
}

console.log(`${total} citations of Holdfast.py resolve to a line that exists and is not blank.`);
