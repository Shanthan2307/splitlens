import { z } from "zod";
import { LANGUAGE_TAGS } from "@/lib/languages";

/*
 * Schema the model must return (also sent as the structured-output format).
 * Money is decimal *strings* in major units ("1234.50") so nothing passes through floats;
 * lib/splits/receipt.ts converts them to minor units for the receipt's currency.
 */
const decimal = z
  .string()
  .describe('Plain decimal in major units: "." as decimal separator, no thousands separators or symbols, e.g. "1234.50".');

export const receiptItemSchema = z.object({
  original_name: z.string().describe("Item name exactly as printed, in the receipt's language and script."),
  translated_name: z.string().describe("Item name translated into the target language; concise, human-friendly."),
  quantity: decimal.describe('Quantity as a decimal, "1" if not printed. Weights allowed, e.g. "0.452".'),
  unit_price: decimal.nullable().describe("Price per unit if printed, else null."),
  line_total: decimal.describe("Amount printed for this line BEFORE any line discount."),
  line_discount: decimal
    .nullable()
    .describe("Positive amount of a discount applying only to this line (coupon, markdown), else null."),
});

export const receiptModelSchema = z.object({
  is_receipt: z.boolean().describe("false if the image is not a receipt/bill/invoice."),
  merchant: z.string().nullable(),
  date: z.string().nullable().describe("Purchase date as YYYY-MM-DD, or null if not printed."),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. EUR, JPY, INR. null if it cannot be determined."),
  detected_language: z.string().describe("BCP 47 tag of the receipt's main language, e.g. ja, de, pt-BR, zh-Hant."),
  prices_include_tax: z
    .boolean()
    .nullable()
    .describe("true if item prices already include tax (VAT/GST-inclusive), false if tax is added on top, null if unclear."),
  items: z.array(receiptItemSchema),
  discounts: z
    .array(z.object({ original_name: z.string(), translated_name: z.string(), amount: decimal.describe("Positive amount.") }))
    .describe("Receipt-level discounts not tied to one line."),
  taxes: z.array(
    z.object({
      name: z.string().describe('As printed, e.g. "VAT 20%", "CGST 9%", "消費税".'),
      rate_percent: decimal.nullable(),
      amount: decimal,
      inclusive: z.boolean().describe("true if this tax is already included in item prices (shown for information only)."),
    }),
  ),
  service_charge: z
    .object({ amount: decimal, rate_percent: decimal.nullable(), inclusive: z.boolean() })
    .nullable(),
  tip: decimal.nullable().describe("Tip/gratuity amount if written or printed, else null."),
  subtotal: decimal.nullable(),
  total: decimal.nullable().describe("Final amount paid/due. If a handwritten total exists, use it."),
  total_is_handwritten: z.boolean(),
  warnings: z.array(z.string()).describe("Short notes about anything uncertain, illegible, or unusual, in the target language."),
});

export type ReceiptModelOutput = z.infer<typeof receiptModelSchema>;

export const AUTO_LANGUAGE = "auto";

export const scanRequestSchema = z.object({
  receiptId: z.uuid(),
  path: z.string().max(400),
  sourceLanguage: z.union([z.literal(AUTO_LANGUAGE), z.enum(LANGUAGE_TAGS)]),
  targetLanguage: z.enum(LANGUAGE_TAGS),
  /** Used when the receipt doesn't show a currency. */
  fallbackCurrency: z.string().regex(/^[A-Z]{3}$/),
});

export type ScanRequest = z.infer<typeof scanRequestSchema>;

export const RECEIPT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
/** Claude accepts images up to 5 MB; the client compresses well below this. */
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
/** Long-edge pixels; higher resolutions are downscaled by the API anyway. */
export const RECEIPT_MAX_EDGE = 2576;
