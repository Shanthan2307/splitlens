import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { languageNameEn, type LanguageTag } from "@/lib/languages";
import { normalizeReceipt, ReceiptFormatError, type NormalizedReceipt } from "@/lib/splits";
import { AUTO_LANGUAGE, receiptModelSchema, type ReceiptModelOutput } from "@/lib/validation/receipt";
import { RECEIPT_SYSTEM_PROMPT } from "./receipt-prompt";

export type ReceiptImage = { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" };

export type ReceiptParseInput = {
  image: ReceiptImage;
  sourceLanguage: LanguageTag | typeof AUTO_LANGUAGE;
  targetLanguage: LanguageTag;
  fallbackCurrency: string;
};

export type ReceiptParseOptions = {
  client: Anthropic;
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
};

export type ReceiptParseResult =
  | { ok: true; raw: ReceiptModelOutput; receipt: NormalizedReceipt; attempts: number; model: string }
  | {
      ok: false;
      code: "not_a_receipt" | "invalid_output" | "refusal" | "api_error";
      message: string;
      attempts: number;
      raw: ReceiptModelOutput | null;
    };

const MAX_ATTEMPTS = 2;

function settingsText(input: ReceiptParseInput) {
  const language =
    input.sourceLanguage === AUTO_LANGUAGE
      ? "Receipt language: detect it from the image."
      : `Receipt language: ${languageNameEn(input.sourceLanguage)} (${input.sourceLanguage}).`;
  return `${language}\nTranslate item names and warnings into: ${languageNameEn(input.targetLanguage)} (${input.targetLanguage}).\nExtract the receipt.`;
}

/**
 * Sends the receipt image to Claude with a strict structured-output schema, validates the
 * result (schema + money normalization), and retries once with the problems spelled out.
 */
export async function parseReceipt(input: ReceiptParseInput, options: ReceiptParseOptions): Promise<ReceiptParseResult> {
  let previousIssues: string[] = [];
  let lastRaw: ReceiptModelOutput | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      { type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.base64 } },
      { type: "text", text: settingsText(input) },
    ];
    if (previousIssues.length > 0) {
      content.push({
        type: "text",
        text: `A previous extraction of this receipt was rejected for these problems:\n- ${previousIssues.join("\n- ")}\nRead the receipt again carefully and return corrected JSON.`,
      });
    }

    let response;
    try {
      response = await options.client.beta.messages.parse({
        model: options.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: RECEIPT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
        output_config: {
          format: betaZodOutputFormat(receiptModelSchema),
          ...(options.effort ? { effort: options.effort } : {}),
        },
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        return { ok: false, code: "api_error", message: `Receipt service error (${error.status ?? "network"}).`, attempts: attempt, raw: lastRaw };
      }
      // The SDK raises this when the output doesn't validate against the schema; anything else
      // (e.g. missing credentials) is a real failure for the caller.
      if (error instanceof Error && error.message.startsWith("Failed to parse structured output")) {
        previousIssues = [`The response did not match the JSON schema: ${error.message}`];
        continue;
      }
      throw error;
    }

    if (response.stop_reason === "refusal") {
      return { ok: false, code: "refusal", message: "This image couldn't be processed.", attempts: attempt, raw: lastRaw };
    }
    if (response.stop_reason === "max_tokens") {
      previousIssues = ["The response was cut off before the JSON was complete. Be concise in warnings."];
      continue;
    }

    const raw = response.parsed_output;
    if (!raw) {
      previousIssues = ["The response was not JSON matching the schema."];
      continue;
    }
    lastRaw = raw;

    if (!raw.is_receipt) {
      return { ok: false, code: "not_a_receipt", message: "That doesn't look like a receipt.", attempts: attempt, raw };
    }

    try {
      return { ok: true, raw, receipt: normalizeReceipt(raw, input.fallbackCurrency), attempts: attempt, model: response.model };
    } catch (error) {
      if (!(error instanceof ReceiptFormatError)) throw error;
      previousIssues = error.issues;
    }
  }

  return {
    ok: false,
    code: "invalid_output",
    message: "Couldn't read this receipt reliably. Try a clearer, well-lit photo.",
    attempts: MAX_ATTEMPTS,
    raw: lastRaw,
  };
}
