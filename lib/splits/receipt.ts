import { isCurrencyCode } from "@/lib/currencies";
import type { ReceiptModelOutput } from "@/lib/validation/receipt";
import { SplitError } from "./errors";
import type { DraftLine } from "./expense-draft";
import type { ItemizedLineKind } from "./itemized";
import { formatMinor, parseMajor, parseScaled, sumMinor, toMajorString, type Minor } from "./money";

/*
 * Turns the model's receipt JSON (decimal strings) into exact minor-unit lines,
 * checks that everything adds up, and produces itemized expense draft lines.
 */

export type ReceiptLine = {
  kind: ItemizedLineKind;
  name: string;
  originalName: string | null;
  /** Items only: quantity as printed (decimal string) and unit price when printed. */
  quantity?: string;
  unitPrice?: Minor;
  /** Signed minor units; discounts are negative. */
  amount: Minor;
};

export type NormalizedReceipt = {
  currency: string;
  merchant: string | null;
  date: string | null;
  detectedLanguage: string;
  pricesIncludeTax: boolean | null;
  lines: ReceiptLine[];
  /** Total printed on the receipt (null if missing). */
  receiptTotal: Minor | null;
  /** Sum of the lines that will become the expense. */
  computedTotal: Minor;
  /** Tax already included in prices (informational). */
  inclusiveTax: Minor;
  warnings: string[];
};

/** The output can't be used (bad numbers, unknown currency). Triggers one retry with these issues. */
export class ReceiptFormatError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid receipt data: ${issues.join("; ")}`);
    this.name = "ReceiptFormatError";
  }
}

const QUANTITY_DECIMALS = 3;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null): string | null {
  if (!value || !DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

export function normalizeReceipt(output: ReceiptModelOutput, fallbackCurrency: string): NormalizedReceipt {
  const issues: string[] = [];
  const warnings = [...output.warnings.filter((w) => w.trim() !== "")];

  if (!output.is_receipt) throw new ReceiptFormatError(["The image does not look like a receipt"]);

  let currency = output.currency?.trim().toUpperCase() ?? null;
  if (currency && !isCurrencyCode(currency)) {
    issues.push(`currency "${output.currency}" is not an ISO 4217 code`);
    currency = null;
  }
  if (!currency) {
    if (issues.length === 0) warnings.push(`No currency shown on the receipt; assumed ${fallbackCurrency}.`);
    currency = fallbackCurrency;
  }
  const cur = currency;

  const money = (value: string | null, field: string, { allowNegative = false } = {}): Minor | null => {
    if (value === null) return null;
    try {
      const minor = parseMajor(value, cur);
      if (minor < 0 && !allowNegative) return -minor;
      return minor;
    } catch (error) {
      issues.push(`${field}: "${value}" is not a valid ${cur} amount (${(error as SplitError).message})`);
      return null;
    }
  };

  const lines: ReceiptLine[] = [];
  let itemsNet = 0;

  output.items.forEach((item, i) => {
    const label = `items[${i}]`;
    // Refunds/returns on a receipt are negative line totals; keep their sign.
    const total = money(item.line_total, `${label}.line_total`, { allowNegative: true });
    const discount = money(item.line_discount, `${label}.line_discount`) ?? 0;
    if (total === null) return;
    const net = total - discount;
    itemsNet += net;
    const name = item.translated_name.trim() || item.original_name.trim() || `Item ${i + 1}`;
    const unit = money(item.unit_price, `${label}.unit_price`);
    let quantity: number | null = null;
    try {
      quantity = parseScaled(item.quantity, QUANTITY_DECIMALS);
    } catch {
      warnings.push(`“${name}”: couldn't read the quantity “${item.quantity}”.`);
    }
    lines.push({
      kind: "item",
      name,
      originalName: item.original_name.trim() || null,
      amount: net,
      ...(quantity !== null && quantity > 0 ? { quantity: item.quantity.trim() } : {}),
      ...(unit !== null ? { unitPrice: unit } : {}),
    });
    if (unit !== null && quantity !== null && quantity > 0) {
      // unit × quantity (3-decimal fixed point), rounded half up, compared to the printed line total.
      const expected = Math.round((unit * quantity) / 10 ** QUANTITY_DECIMALS);
      if (Math.abs(expected - Math.abs(total)) > 1) {
        warnings.push(`“${name}”: ${item.quantity} × ${formatMinor(unit, cur)} doesn't match the line total ${formatMinor(total, cur)}.`);
      }
    }
  });

  for (const [i, d] of output.discounts.entries()) {
    const amount = money(d.amount, `discounts[${i}].amount`);
    if (amount === null || amount === 0) continue;
    lines.push({ kind: "discount", name: d.translated_name.trim() || "Discount", originalName: d.original_name.trim() || null, amount: -amount });
  }

  let inclusiveTax = 0;
  for (const [i, t] of output.taxes.entries()) {
    const amount = money(t.amount, `taxes[${i}].amount`);
    if (amount === null || amount === 0) continue;
    if (t.inclusive) inclusiveTax += amount;
    else lines.push({ kind: "tax", name: t.name.trim() || "Tax", originalName: null, amount });
  }

  if (output.service_charge) {
    const amount = money(output.service_charge.amount, "service_charge.amount");
    if (amount && !output.service_charge.inclusive) lines.push({ kind: "service", name: "Service charge", originalName: null, amount });
  }

  const tip = money(output.tip, "tip");
  if (tip) lines.push({ kind: "tip", name: "Tip", originalName: null, amount: tip });

  const subtotal = money(output.subtotal, "subtotal");
  const receiptTotal = money(output.total, "total", { allowNegative: true });

  if (issues.length > 0) throw new ReceiptFormatError(issues);
  if (lines.length === 0) warnings.push("No items were found. Add them manually.");

  const computedTotal = sumMinor(lines.map((l) => l.amount));
  if (subtotal !== null && subtotal !== itemsNet && subtotal !== itemsNet - inclusiveTax) {
    warnings.push(`Items add up to ${formatMinor(itemsNet, cur)} but the printed subtotal is ${formatMinor(subtotal, cur)}.`);
  }
  if (receiptTotal === null) {
    warnings.push("No total was found on the receipt; check the amounts.");
  } else if (receiptTotal !== computedTotal) {
    const diff = receiptTotal - computedTotal;
    warnings.push(
      `Lines add up to ${formatMinor(computedTotal, cur)} but the receipt total is ${formatMinor(receiptTotal, cur)} ` +
        `(${diff > 0 ? "missing" : "extra"} ${formatMinor(Math.abs(diff), cur)}).`,
    );
  }
  if (output.total_is_handwritten) warnings.push("The total is handwritten; double-check it.");

  return {
    currency: cur,
    merchant: output.merchant?.trim() || null,
    date: validDate(output.date),
    detectedLanguage: output.detected_language,
    pricesIncludeTax: output.prices_include_tax,
    lines,
    receiptTotal,
    computedTotal,
    inclusiveTax,
    warnings: [...new Set(warnings)],
  };
}

/** Itemized expense lines (major-unit strings) ready for the expense form; nothing assigned yet. */
export function receiptToDraftLines(receipt: Pick<NormalizedReceipt, "lines" | "currency">): DraftLine[] {
  return receipt.lines.map((l) => ({
    kind: l.kind,
    name: l.name,
    ...(l.originalName && l.originalName !== l.name ? { originalName: l.originalName } : {}),
    ...(l.quantity !== undefined ? { quantity: l.quantity } : {}),
    ...(l.unitPrice !== undefined ? { unitPrice: toMajorString(l.unitPrice, receipt.currency) } : {}),
    amount: toMajorString(l.amount, receipt.currency),
    assignments: [],
  }));
}
