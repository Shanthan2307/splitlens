// Fails if server-only secrets (names or values) appear in the client JavaScript.
// Run after `next build`: npm run check:bundle
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const STATIC = ".next/static";
if (!existsSync(STATIC)) {
  console.error("No .next/static: run `npm run build` first.");
  process.exit(1);
}
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const SECRET_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "SPLITWISE_CLIENT_SECRET", "SPLITWISE_TOKEN_KEY"];
const needles = [
  ...SECRET_NAMES,
  ...SECRET_NAMES.map((n) => process.env[n]).filter((v) => v && v.length >= 16),
  "sk-ant-", // Anthropic key prefix
  "You extract structured data from photos", // server-only receipt system prompt
];

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(js|mjs|css|json|map)$/.test(entry)) files.push(full);
  }
})(STATIC);

let leaks = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const needle of needles) {
    if (text.includes(needle)) {
      leaks++;
      const label = SECRET_NAMES.includes(needle) || needle.length < 40 ? needle : `${needle.slice(0, 6)}… (value of a secret env var)`;
      console.error(`✗ ${file} contains ${label}`);
    }
  }
}
console.log(leaks ? `\n${leaks} leak(s) found` : `✓ ${files.length} client files checked, no server secrets found`);
process.exit(leaks ? 1 : 0);
