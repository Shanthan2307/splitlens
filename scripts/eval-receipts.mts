/**
 * Runs the receipt parser against tests/receipts/* and compares with *.expected.json.
 *   npm run eval:receipts [-- --only <name>] [-- --dry-run]
 * Calls the Claude API for each sample (costs money) unless --dry-run.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { getAnthropic } from "@/lib/ai/anthropic";
import { compareReceipt, expectedReceiptSchema } from "@/lib/ai/receipt-eval";
import { parseReceipt, type ReceiptImage } from "@/lib/ai/receipt-parser";
import { serverEnv } from "@/lib/env.server";
import { RECEIPT_MAX_BYTES } from "@/lib/validation/receipt";

const DIR = path.resolve("tests/receipts");
const RESULTS = path.join(DIR, "results");
const TYPES: Record<string, ReceiptImage["mediaType"]> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = args.includes("--only")
  ? args[args.indexOf("--only") + 1]
  : undefined;

const images = readdirSync(DIR).filter(
  (f) => TYPES[path.extname(f).toLowerCase()],
);
const samples = images
  .map((file) => ({ file, name: path.basename(file, path.extname(file)) }))
  .filter((s) => !only || s.name === only);

let problems = 0;
const rows: string[] = [];

for (const { file, name } of samples) {
  const expectedPath = path.join(DIR, `${name}.expected.json`);
  if (!existsSync(expectedPath)) {
    console.warn(`⚠ ${file}: no ${name}.expected.json, skipped`);
    continue;
  }
  const expected = expectedReceiptSchema.safeParse(
    JSON.parse(readFileSync(expectedPath, "utf8")),
  );
  if (!expected.success) {
    problems++;
    console.error(
      `✗ ${name}.expected.json is invalid: ${expected.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
    continue;
  }
  const bytes = readFileSync(path.join(DIR, file));
  if (bytes.length > RECEIPT_MAX_BYTES) {
    problems++;
    console.error(
      `✗ ${file} is ${(bytes.length / 1048576).toFixed(1)} MB; resize it below 5 MB`,
    );
    continue;
  }
  if (dryRun) {
    rows.push(`✓ ${name.padEnd(20)} valid sample`);
    continue;
  }

  const started = Date.now();
  const env = serverEnv();
  let result: Awaited<ReturnType<typeof parseReceipt>>;
  try {
    result = await parseReceipt(
      {
        image: {
          base64: bytes.toString("base64"),
          mediaType: TYPES[path.extname(file).toLowerCase()],
        },
        sourceLanguage: expected.data.sourceLanguage,
        targetLanguage: expected.data.targetLanguage,
        fallbackCurrency: expected.data.fallbackCurrency,
      },
      {
        client: getAnthropic(),
        model: env.ANTHROPIC_MODEL,
        effort: env.RECEIPT_PARSER_EFFORT,
      },
    );
  } catch (error) {
    problems++;
    rows.push(
      `✗ ${name.padEnd(20)} error: ${error instanceof Error ? error.message : String(error)}`,
    );
    continue;
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const failures = result.ok
    ? compareReceipt(expected.data.expect, result.receipt)
    : [`parse failed: ${result.code}: ${result.message}`];
  if (failures.length) problems++;

  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(
    path.join(RESULTS, `${name}.json`),
    JSON.stringify({ result, failures }, null, 2),
  );
  rows.push(
    `${failures.length ? "✗" : "✓"} ${name.padEnd(20)} ${seconds.padStart(5)}s  attempts=${result.attempts}` +
      (result.ok ? `  warnings=${result.receipt.warnings.length}` : "") +
      failures.map((f) => `\n    - ${f}`).join(""),
  );
}

console.log(rows.join("\n") || "No samples found.");
console.log(
  `\n${samples.length - problems}/${samples.length} passed${dryRun ? " (dry run, no API calls)" : ""}`,
);
process.exitCode = problems ? 1 : 0;
