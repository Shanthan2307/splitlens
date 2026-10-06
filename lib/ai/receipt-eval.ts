import { z } from "zod";
import { LANGUAGE_TAGS } from "@/lib/languages";
import { parseMajor, type NormalizedReceipt } from "@/lib/splits";

/** Schema of tests/receipts/<name>.expected.json (see tests/receipts/README.md). */
export const expectedReceiptSchema = z.object({
  description: z.string().optional(),
  sourceLanguage: z.union([z.literal("auto"), z.enum(LANGUAGE_TAGS)]).default("auto"),
  targetLanguage: z.enum(LANGUAGE_TAGS).default("en"),
  fallbackCurrency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  expect: z.object({
    merchantIncludes: z.string().optional(),
    date: z.string().optional(),
    currency: z.string().optional(),
    detectedLanguage: z.string().optional(),
    total: z.string().optional(),
    itemAmounts: z.array(z.string()).optional(),
    lineAmounts: z.partialRecord(z.enum(["tax", "tip", "service", "fee", "discount"]), z.array(z.string())).optional(),
    itemNamesInclude: z.array(z.string()).optional(),
    reconciles: z.boolean().optional(),
  }),
});

export type ExpectedReceipt = z.infer<typeof expectedReceiptSchema>;

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const same = (a: number[], b: number[]) => a.length === b.length && sorted(a).every((x, i) => x === sorted(b)[i]);

/** Compares a parsed receipt with expectations; returns human-readable failures (empty = pass). */
export function compareReceipt(expected: ExpectedReceipt["expect"], actual: NormalizedReceipt): string[] {
  const failures: string[] = [];
  const minor = (v: string) => parseMajor(v, actual.currency);
  const check = (ok: boolean, message: string) => {
    if (!ok) failures.push(message);
  };

  if (expected.currency !== undefined) check(actual.currency === expected.currency, `currency: expected ${expected.currency}, got ${actual.currency}`);
  if (failures.length > 0) return failures; // amounts can't be compared in the wrong currency

  if (expected.merchantIncludes !== undefined) {
    check(
      (actual.merchant ?? "").toLowerCase().includes(expected.merchantIncludes.toLowerCase()),
      `merchant: expected to include "${expected.merchantIncludes}", got "${actual.merchant}"`,
    );
  }
  if (expected.date !== undefined) check(actual.date === expected.date, `date: expected ${expected.date}, got ${actual.date}`);
  if (expected.detectedLanguage !== undefined) {
    check(
      actual.detectedLanguage.toLowerCase().startsWith(expected.detectedLanguage.toLowerCase()),
      `language: expected ${expected.detectedLanguage}, got ${actual.detectedLanguage}`,
    );
  }
  if (expected.total !== undefined) {
    check(actual.receiptTotal === minor(expected.total), `total: expected ${expected.total}, got ${actual.receiptTotal} (minor units)`);
  }

  const amountsOf = (kind: string) => actual.lines.filter((l) => l.kind === kind).map((l) => l.amount);
  if (expected.itemAmounts !== undefined) {
    const want = expected.itemAmounts.map(minor);
    check(same(amountsOf("item"), want), `items: expected [${want.join(", ")}], got [${amountsOf("item").join(", ")}]`);
  }
  for (const [kind, values] of Object.entries(expected.lineAmounts ?? {})) {
    const want = values.map(minor);
    check(same(amountsOf(kind), want), `${kind}: expected [${want.join(", ")}], got [${amountsOf(kind).join(", ")}]`);
  }
  for (const needle of expected.itemNamesInclude ?? []) {
    check(
      actual.lines.some((l) => l.kind === "item" && l.name.toLowerCase().includes(needle.toLowerCase())),
      `item names: none include "${needle}"`,
    );
  }
  if (expected.reconciles !== undefined) {
    const reconciles = actual.receiptTotal === actual.computedTotal;
    check(reconciles === expected.reconciles, `reconciles: expected ${expected.reconciles}, got ${reconciles}`);
  }
  return failures;
}
