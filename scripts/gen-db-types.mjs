// Generates lib/db/database.types.ts from the Supabase schema.
//   npm run db:types         -> hosted project (SUPABASE_PROJECT_ID from env or .env.local)
//   npm run db:types:local   -> local stack started with `npx supabase start`
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { format } from "prettier";

const OUT = "lib/db/database.types.ts";
const local = process.argv.includes("--local");

if (!local && existsSync(".env.local")) process.loadEnvFile(".env.local");

const target = local ? ["--local"] : ["--project-id", process.env.SUPABASE_PROJECT_ID ?? ""];
if (!local && !process.env.SUPABASE_PROJECT_ID) {
  console.error("SUPABASE_PROJECT_ID is not set (env or .env.local). Use `npm run db:types:local` for the local stack.");
  process.exit(1);
}

// Capture first, write after: a failed run must not truncate the existing types file.
const types = execFileSync("npx", ["supabase", "gen", "types", "typescript", ...target, "--schema", "public"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
writeFileSync(OUT, await format(types, { parser: "typescript", printWidth: 100 }));
console.log(`Wrote ${OUT}`);
