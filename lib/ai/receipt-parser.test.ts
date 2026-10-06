import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { ReceiptModelOutput } from "@/lib/validation/receipt";
import { parseReceipt, type ReceiptParseInput } from "./receipt-parser";
import { RECEIPT_SYSTEM_PROMPT } from "./receipt-prompt";

const good: ReceiptModelOutput = {
  is_receipt: true,
  merchant: "Café Central",
  date: "2026-10-01",
  currency: "EUR",
  detected_language: "de",
  prices_include_tax: true,
  items: [{ original_name: "Melange", translated_name: "Melange coffee", quantity: "2", unit_price: "4.90", line_total: "9.80", line_discount: null }],
  discounts: [],
  taxes: [{ name: "USt 10%", rate_percent: "10", amount: "0.89", inclusive: true }],
  service_charge: null,
  tip: null,
  subtotal: null,
  total: "9.80",
  total_is_handwritten: false,
  warnings: [],
};

const input: ReceiptParseInput = {
  image: { base64: "aGVsbG8=", mediaType: "image/jpeg" },
  sourceLanguage: "auto",
  targetLanguage: "en",
  fallbackCurrency: "USD",
};

function fakeClient(...responses: Array<Partial<{ stop_reason: string; parsed_output: unknown; model: string }> | Error>) {
  const parse = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) parse.mockRejectedValueOnce(r);
    else parse.mockResolvedValueOnce({ stop_reason: "end_turn", model: "claude-sonnet-5-5", ...r });
  }
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

const options = (client: Anthropic) => ({ client, model: "claude-sonnet-5-5" });

describe("parseReceipt", () => {
  it("returns a normalized receipt on the first valid response", async () => {
    const { client, parse } = fakeClient({ parsed_output: good });
    const result = await parseReceipt(input, options(client));
    expect(result).toMatchObject({ ok: true, attempts: 1, model: "claude-sonnet-5-5" });
    if (result.ok) expect(result.receipt.lines).toEqual([
      { kind: "item", name: "Melange coffee", originalName: "Melange", amount: 980, quantity: "2", unitPrice: 490 },
    ]);

    const request = parse.mock.calls[0][0];
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.fallbacks).toBe("default");
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(request.system).toEqual([{ type: "text", text: RECEIPT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
    expect(request.output_config.effort).toBeUndefined();
    expect(request.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" } });
    expect(request.messages[0].content[1].text).toContain("detect it from the image");
    expect(request.messages[0].content[1].text).toContain("English (en)");
  });

  it("passes an explicit receipt language and effort", async () => {
    const { client, parse } = fakeClient({ parsed_output: good });
    await parseReceipt({ ...input, sourceLanguage: "ja", targetLanguage: "de" }, { ...options(client), effort: "medium" });
    const request = parse.mock.calls[0][0];
    expect(request.messages[0].content[1].text).toContain("Receipt language: Japanese (ja).");
    expect(request.messages[0].content[1].text).toContain("German (de)");
    expect(request.output_config.effort).toBe("medium");
  });

  it("retries once with the validation problems, then succeeds", async () => {
    const bad = { ...good, items: [{ ...good.items[0], line_total: "9,80" }] };
    const { client, parse } = fakeClient({ parsed_output: bad }, { parsed_output: good });
    const result = await parseReceipt(input, options(client));
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    const retryText = parse.mock.calls[1][0].messages[0].content[2].text as string;
    expect(retryText).toContain('items[0].line_total: "9,80"');
  });

  it("retries on schema failures, null output and truncation", async () => {
    const schemaFail = fakeClient(new Error("Failed to parse structured output"), { parsed_output: good });
    expect(await parseReceipt(input, options(schemaFail.client))).toMatchObject({ ok: true, attempts: 2 });
    expect(schemaFail.parse.mock.calls[1][0].messages[0].content[2].text).toContain("did not match the JSON schema");

    const nullThenTruncated = fakeClient({ parsed_output: null }, { stop_reason: "max_tokens", parsed_output: null });
    expect(await parseReceipt(input, options(nullThenTruncated.client))).toEqual({
      ok: false,
      code: "invalid_output",
      message: "Couldn't read this receipt reliably. Try a clearer, well-lit photo.",
      attempts: 2,
      raw: null,
    });
  });

  it("gives up after two invalid outputs and returns the last raw output", async () => {
    const bad = { ...good, currency: "EURO" };
    const { client } = fakeClient({ parsed_output: bad }, { parsed_output: bad });
    const result = await parseReceipt(input, options(client));
    expect(result).toMatchObject({ ok: false, code: "invalid_output", attempts: 2, raw: bad });
  });

  it("does not retry refusals, API errors or non-receipts", async () => {
    const refusal = fakeClient({ stop_reason: "refusal", parsed_output: null });
    expect(await parseReceipt(input, options(refusal.client))).toMatchObject({ ok: false, code: "refusal", attempts: 1 });

    const apiError = new Anthropic.APIError(500, { type: "error" }, "boom", new Headers());
    const failing = fakeClient(apiError);
    expect(await parseReceipt(input, options(failing.client))).toMatchObject({ ok: false, code: "api_error", attempts: 1 });
    expect(failing.parse).toHaveBeenCalledTimes(1);

    const notReceipt = fakeClient({ parsed_output: { ...good, is_receipt: false } });
    expect(await parseReceipt(input, options(notReceipt.client))).toMatchObject({ ok: false, code: "not_a_receipt", attempts: 1 });
  });

  it("rethrows non-API, non-schema errors (e.g. missing credentials)", async () => {
    const { client } = fakeClient(new Error("Could not resolve authentication method"));
    await expect(parseReceipt(input, options(client))).rejects.toThrow("authentication");
  });

  it("rethrows unexpected errors from normalization", async () => {
    const weird = { ...good, items: null } as unknown as ReceiptModelOutput;
    const { client } = fakeClient({ parsed_output: weird });
    await expect(parseReceipt(input, options(client))).rejects.toThrow(TypeError);
  });
});
