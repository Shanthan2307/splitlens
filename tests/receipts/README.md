# Receipt parser samples

Drop receipt photos here with an expected-results file next to each, then run:

```bash
npm run eval:receipts                 # all samples (calls the Claude API: costs money)
npm run eval:receipts -- --only jp-ramen
npm run eval:receipts -- --dry-run    # validate the sample files without calling the API
```

Each sample is a pair:

- `name.jpg` / `.jpeg` / `.png` / `.webp` (max 5 MB; resize large phone photos first)
- `name.expected.json`:

```jsonc
{
  "description": "What this receipt tests",
  "sourceLanguage": "auto",          // or a language tag, as chosen in the scan screen
  "targetLanguage": "en",
  "fallbackCurrency": "USD",         // optional; used if the receipt shows no currency
  "expect": {                        // every field is optional; only listed fields are checked
    "merchantIncludes": "corner diner",          // case-insensitive substring
    "date": "2026-09-14",
    "currency": "USD",
    "detectedLanguage": "en",                    // prefix match ("zh" matches "zh-Hant")
    "total": "52.09",                            // printed total, major units
    "itemAmounts": ["14.50", "11.00"],           // net item line amounts, any order
    "lineAmounts": { "tax": ["3.59"], "tip": ["8.00"], "service": [], "discount": [] },
    "itemNamesInclude": ["burger", "salad"],     // substrings of translated names
    "reconciles": true                           // lines add up to the printed total
  }
}
```

Results (raw model JSON + normalized lines + failures) are written to `results/` (gitignored).
The script exits non-zero if any check fails.

`_generate.py` regenerates the four synthetic receipts (US tax-added with handwritten tip,
German VAT-inclusive with decimal commas, Japanese tax-inclusive with a Reiwa date, Indian
CGST/SGST with service charge). Add real photos for anything you care about: real-world
lighting, crumples and fonts are what break parsers.

Credentials: set `ANTHROPIC_API_KEY` in `.env.local` (or sign in with `ant auth login`).
The model comes from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`); `RECEIPT_PARSER_EFFORT`
optionally overrides effort so you can compare cost/latency against accuracy here.
