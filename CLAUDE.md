# SplitLens

A full Splitwise clone with extra features (AI receipt scanning in any language, fast item-to-person assignment, Splitwise import/sync).

## Stack

Next.js 15 (App Router) · TypeScript (strict) · Tailwind v4 · shadcn/ui (radix) · Supabase (Postgres, Auth, Storage, Realtime) · Zod v4 · Vitest · Anthropic API (`claude-sonnet-5-5`, configurable via `ANTHROPIC_MODEL`) for receipt parsing · Vercel.

## Build order

1. Setup
2. Schema and auth
3. Split engine
4. Friends, groups, expenses
5. Balances, settle up, activity, comments
6. AI receipt scanning in any language
7. Fast item-to-person assignment UI
8. Deploy v1
9. Splitwise import and sync via OAuth
10. Recurring expenses, multi-currency conversion, notifications
11. Search, charts, CSV export
12. Final polish and redeploy

## Architecture rules

- **Money** is always integer minor units plus an ISO 4217 currency code. Never floats.
- **All split, balance, and debt math** lives in pure, tested functions in `lib/splits`. Components and routes never do money math.
- **All database access** goes through the data layer in `lib/db`. Use the generated Supabase types (`lib/db/database.types.ts`).
- **All inputs** (forms, server actions, API routes, AI output) are validated with Zod.
- **Mutations** use server actions; multi-row writes happen in a single Postgres function (RPC) so they're transactional.
- **Every table has Row Level Security.**
- **Secrets never reach the client bundle.** Server-only modules import `"server-only"`; only `NEXT_PUBLIC_*` vars are public.
- **End of each phase:** run lint, typecheck, and tests (`npm run check`), then update this file with what's done and any decisions made.

## Folder structure

```
app/                      Next.js App Router routes, layouts, server actions (thin: validate → call lib → render)
app/
  (app)/                  signed-in shell (sidebar + mobile bottom nav): dashboard, groups, friends, activity, account
    groups/[id](/settings) group page (expenses, balances) and settings (members, invites, default split, leave/delete)
    friends/[id]          friend detail: cross-group balance + shared expenses
    dashboard             totals (owe / owed / net per currency), per-person and per-group balances
    activity              activity feed (?group= filter, ?before= cursor pagination)
    expenses/[id]         expense detail: payers, shares, items, notes, attachments, comments (realtime), edit history
    settlements/[id]      payment detail: edit, delete/undo, comments, history
    invite/[token]        join a group via link (optionally claiming a placeholder), or accept a friend invite
    import/splitwise      Splitwise import wizard (connect, pick groups/friends, progress) + actions
  api/splitwise/          OAuth connect + callback route handlers (state cookie, token exchange)
    */actions.ts          server actions (Zod → lib/splits → lib/db), return ActionResult, never throw
  login/                  sign-in page + server actions (Google OAuth, magic link)
  auth/callback|confirm/  OAuth code exchange / magic-link token_hash verification
components/
  ui/                     shadcn/ui primitives (generated via `npx shadcn@latest add <name>`)
  shell/                  app shell (nav, user menu, page header)
  expenses/               expense form/dialog, list, history, attachments, context builders
    assign/               receipt review / item assignment (ItemAssigner, edit + shares dialogs, long-press hook)
  groups/ friends/        group/friend UI
  receipts/               scan dialog (photo → compress → upload → parse → review), language picker, compression
  user-prefs.tsx          preferred language / default currency for client components (set in app layout)
  settlements/            SettleUpDialog (+ Venmo/PayPal links), method mapping, server-side dialog defaults
  comments/               realtime comment thread
  activity/               describeActivity (payload → sentence + my impact), feed, group filter
  splitwise/              import wizard, Account card, disconnect, share (Web Share API → clipboard)
  soft-delete-button.tsx  delete with Undo toast / Restore, for expenses and payments
  <feature>/              feature components (no money math, no direct DB access)
lib/
  env.ts                  Zod-validated public env (NEXT_PUBLIC_*)
  env.server.ts           Zod-validated server secrets (server-only)
  supabase/
    client.ts             browser client (Client Components, Realtime)
    server.ts             per-request server client acting as the user (RLS applies)
    admin.ts              service-role client — bypasses RLS; trusted jobs only (server-only)
    middleware.ts         session refresh used by root middleware.ts
  auth.ts                 requireUser(): verified user + request client, or redirect to /login
  currencies.ts           ISO 4217 codes + minor-unit exponents
  languages.ts            supported BCP 47 language tags
  db/
    database.types.ts     GENERATED by `npm run db:types` — do not edit
    client.ts             DbClient type, Tables<> helpers, DbError
    <entity>.ts           data-layer functions (queries + RPC calls), one file per domain; take a DbClient
  splits/                 pure money/split/balance/debt functions + colocated *.test.ts (100% coverage enforced)
    money.ts              Minor type, parseMajor / toMajorString / formatMinor (no floats)
    allocate.ts           largest-remainder allocation (BigInt internally)
    split.ts              computeSplit: equal | exact | percentage | shares | adjustment | itemized
    itemized.ts           items + weighted assignments; tax/tip/service/fee/discount distribution
    payers.ts             validatePayers, expenseNet (paid − owed)
    balances.ts           netBalances, pairwiseDebts, remapDebts, friendBalances, totalBalance
    simplify.ts           simplifyDebts (minimum transfers)
    group-debts.ts        groupDebts(entries, { simplify })
    splitwise.ts          Splitwise decimal strings ↔ minor units, per-person rounding reconciliation
    index.ts              public API — import from "@/lib/splits"
  validation/             shared Zod schemas (+ result.ts ActionResult)
  categories.ts           expense categories (id, label, group, lucide icon name)
  payments/deep-links.ts  Venmo (USD only) and PayPal.me URL builders
  ai/                     anthropic.ts (client), receipt-prompt.ts (cached system prompt), receipt-parser.ts
                          (structured output + 1 retry), receipt-eval.ts (sample comparison)
  splitwise/              api.ts (OAuth + v3.0 client, 429/5xx backoff, 401 refresh), schemas.ts (Zod), crypto.ts
                          (AES-256-GCM tokens), session.ts (splitwiseFor: decrypt/refresh), mapping.ts (pure
                          Splitwise → RPC payloads), importer.ts (overview + paged import), post.ts (create_expense)
  rate-limit.ts           per-user receipt scan limits
  utils.ts                shadcn `cn` helper
supabase/
  config.toml             local Supabase stack config
  migrations/             SQL migrations (tables, RLS policies, RPC functions)
  tests/                  pgTAP tests (`npm run test:db`)
  templates/              auth email templates
scripts/
  gen-db-types.mjs        Supabase → TypeScript type generation
  eval-receipts.mts       runs the receipt parser over tests/receipts samples
tests/receipts/           sample receipt images + *.expected.json (see README there)
docs/DEPLOY.md            production deployment checklist (every dashboard setting)
test/                     test helpers/stubs (e.g. server-only stub for Vitest)
middleware.ts             refreshes Supabase auth cookies on each request
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Next dev server (Turbopack) |
| `npm run check` | lint + typecheck + tests (run at end of every phase) |
| `npm run lint` / `typecheck` / `test` | individually |
| `npm run test:coverage` | Vitest with v8 coverage over `lib/` |
| `npm run db:start` / `db:stop` / `db:reset` | local Supabase stack (needs Docker) |
| `npm run db:types` | regenerate types from hosted project (`SUPABASE_PROJECT_ID`) |
| `npm run db:types:local` | regenerate types from local stack |
| `npm run test:db` | pgTAP RLS + RPC tests against the local stack |
| `npm run check:bundle` | after `build`: fail if server secret names/values appear in client JS |
| `npm run db:push` | apply migrations to the linked (production) Supabase project |
| `npm run eval:receipts` | real receipt-parser run over `tests/receipts` (costs money; `-- --dry-run`, `-- --only name`) |

## Environment

Copy `.env.example` → `.env.local` (local values from `npx supabase status`). Google OAuth creds go in `supabase/.env` (read by the Supabase CLI). Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`. Server-only: `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (optional locally if signed in via `ant auth login`; required in prod), `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `RECEIPT_PARSER_EFFORT` (optional), `SPLITWISE_CLIENT_ID` / `SPLITWISE_CLIENT_SECRET` / `SPLITWISE_TOKEN_KEY` (optional; integration hidden until all set), `SPLITWISE_DEV_ORIGIN` (non-production only: point at a fake Splitwise for E2E tests). Tooling: `SUPABASE_PROJECT_ID`.

## Progress

### Phase 1 — Setup ✅

- Scaffolded Next.js 15.5 (App Router, TS strict, Tailwind v4, ESLint, Turbopack) with npm.
- shadcn/ui initialized (`radix-nova` style, neutral, lucide icons). Note: current shadcn uses the `cn` npm package for class merging, re-exported from `lib/utils.ts`.
- Installed `@supabase/supabase-js`, `@supabase/ssr`, `zod` (v4), `@anthropic-ai/sdk`, `server-only`; dev: `vitest`, `@vitest/coverage-v8`, `supabase` CLI.
- Supabase helpers: browser, server (cookie-based, per request), admin (service role, server-only), and middleware session refresh via `getClaims()`.
- Env vars validated with Zod (`lib/env.ts`, `lib/env.server.ts`); lazily parsed so `next build` doesn't require secrets.
- `lib/db/database.types.ts` is a placeholder with an empty `public` schema until phase 2 migrations exist.
- `supabase init` run; `supabase/config.toml` committed.

**Decisions**
- npm as package manager; Node ≥ 20.12 (type-gen script uses `process.loadEnvFile`).
- Type-gen script captures CLI output before writing so a failed run never truncates the types file.
- Vitest runs in `node` env, aliases `server-only` to a stub; tests colocated as `*.test.ts`.
- Middleware only refreshes the session for now; route protection comes in phase 2.

### Phase 2 — Schema and auth ✅

**Schema** (`supabase/migrations/`, covers all phases):
- `…0100_types_and_helpers`: `currency_code` / `language_tag` domains, enums (split_type, group_type, receipt_status, activity_action, …), `set_updated_at` trigger fn, `pg_trgm` (expense search).
- `…0200_core_tables`: profiles, friendships, groups, group_members, receipts, recurring_rules, expenses, expense_payers, expense_shares, expense_items, item_assignments, settlements, comments, activity_log, notifications, attachments, invite_links, notification_settings, splitwise_connections, exchange_rates. Indexes on every FK / hot query path.
- `…0300_rls`: RLS on every table; helper fns in `private` schema (`is_group_member`, `is_friend`, `can_see_profile`, `can_access_expense|settlement|receipt`); column-level UPDATE grants.
- `…0400_auth_storage_realtime`: new-user trigger (profile + notification_settings), email sync trigger, storage buckets + policies, realtime publication.
- `supabase/tests/rls.test.sql`: 23 pgTAP assertions on access rules.

**Auth**: Google OAuth (`/auth/callback`, PKCE) + email magic link (custom template → `/auth/confirm` with `token_hash`, so links work in any browser). Middleware redirects signed-out users to `/login?next=…`; `safeNextPath` blocks open redirects.

**App**: shell with sidebar (desktop) / bottom tabs (mobile): Dashboard, Groups, Friends, Activity, Account. Account page updates name, avatar (upload to `avatars/{uid}/avatar`), default currency, preferred language. Tested end-to-end locally.

**Decisions**
- **Participants**: payers/shares/item_assignments/settlements reference EITHER `member_id` (group expenses; supports placeholders with no account) OR `user_id` (friend-only expenses, `group_id` null). DB CHECK enforces exactly one. Cross-group per-user balances join member → user.
- Non-group participants must be real users. Phase 9 resolved this with friend invite links: Splitwise friends not on SplitLens are invited, and their balance is imported after they join.
- `expense_shares.owed_minor` is the final amount owed. `split_input` (bigint) records the raw input: minor units for exact/adjustment, basis points for percentage, shares ×10000. RPC must enforce sum(owed) = total = sum(paid).
- Weights are integers (`item_assignments.share_weight`, `group_members.default_split_weight`). Only `exchange_rates.rate` is `numeric(24,12)`; conversion math goes in lib/splits.
- Soft delete: `is_deleted` + `deleted_at` (CHECK keeps them consistent) on expenses/settlements; no DELETE policy on either. `groups.deleted_at` for groups.
- Identity/ownership columns (`created_by`, `user_id` on members, splitwise ids, invite `use_count`/`token`) are not client-updatable (column grants). Placeholder claiming, invite redemption, and multi-row expense writes will be security-definer / transactional RPCs (phase 4).
- `splitwise_connections`: clients can SELECT status columns only. Token columns are hidden via column grants; writes are service-role only. Tokens are encrypted app-side (AES-256-GCM; key env var added in phase 9).
- `exchange_rates`: readable by all signed-in users, written only by the service role.
- Splitwise ids (`*_splitwise_*_id`) are globally unique, so a shared Splitwise group imported by two users maps to the same rows.
- `activity_log.involved_user_ids uuid[]` (GIN-indexed) gives friend-only activity visibility without joins.
- Storage paths: `avatars/{uid}/…`, `group-covers/{group_id}/…`, `receipts/{uid}/…`, `attachments/{expense_id}/…`. `private.try_uuid` keeps malformed paths from raising inside policies.
- Data-layer functions take a `DbClient` argument (from `requireUser()` / `createClient()`) rather than creating their own.
- Generated types are formatted with Prettier by `scripts/gen-db-types.mjs`.
- Fonts: next/font variables are set on `<html>` because shadcn applies `font-sans` there.
- Zod v4 gotcha: `z.email().trim()` validates before trimming. Use `z.string().trim().pipe(z.email())`.

**Hosted-project TODOs (phase 8)**: paste `supabase/templates/magic_link.html` into Dashboard → Auth → Email Templates (magic link + confirm signup); set Site URL + redirect URLs; enable Google provider with prod redirect URI.

### Phase 3 — Split engine ✅

`lib/splits`: 7 test files, 124 tests incl. fast-check property tests; 100% statements/branches/functions/lines enforced via `vitest.config.mts` thresholds.

- **Rounding**: `allocate(total, weights)` uses largest remainder: parts always sum to the total, each is within 1 unit of exact, and zero weights get 0. Ties go to the earlier index (deterministic; callers control order). BigInt internally so `total × weight` never overflows.
- **Split types** (`computeSplit`): equal (selected people), exact (must sum), percentage (basis points, must total 10000), shares (integer weights; UI scales fractional shares), adjustment (equal split of total − adjustments, then +/−), itemized.
- **Itemized**: assigned lines are split by weight. Unassigned tax/tip/service/fee/discount lines are distributed per line, proportional to each person's item subtotal (or `distribution: "equal"`). Charges can also be assigned to specific people. Breakdown per person: items / charges / discounts / owed.
- **Signs/refunds**: a refund is an expense with a negative total. Every payer/share amount is zero or has the total's sign (`SIGN_MISMATCH` otherwise). Migration `…0500_signed_expense_amounts` relaxed the DB checks to `<> 0`; the phase 4 write RPC must enforce sign consistency against the parent total.
- **Currencies**: engine works purely in minor units, so JPY/KRW (0 decimals) and KWD (3) need no special casing. `parseMajor` rejects extra decimals per currency. `formatMinor` passes exact decimal strings to Intl.
- **Balances**: positive = is owed, negative = owes. Everything is keyed by currency and never mixed (conversion is phase 10). `pairwiseDebts` attributes each debtor to creditors proportionally to *remaining* credit, so per-creditor totals stay exact. `friendBalances` expects debts already in user ids: map member ids with `remapDebts` (placeholders are dropped).
- **Simplify**: exact minimum transfers = n − (max disjoint zero-sum subgroups), via subset DP for ≤ 16 non-zero balances per currency (`EXACT_SIMPLIFY_LIMIT`), greedy (≤ n−1) above that. Verified against a brute-force oracle in property tests.
- Errors: `SplitError` with a typed `code` (e.g. `SUM_MISMATCH`, `PERCENT_SUM`, `SIGN_MISMATCH`, `UNASSIGNED_ITEM`).
- Tooling: tsconfig `target` → ES2022 (BigInt literals); added `fast-check`, `prettier` (types formatting).
- Google OAuth: creds in `supabase/.env` (gitignored). The Google client must list `http://127.0.0.1:54321/auth/v1/callback` as an authorized redirect URI.

### Phase 4 — Friends, groups, expenses ✅

**DB** (`…0600_phase4_rpcs`): security-definer RPCs with explicit access checks: `send_friend_request`, `respond_friend_request`, `create_group`, `update_group` (incl. default split weights, validated), `add_group_member` (email → user, unknown email → placeholder auto-claimed at signup, or name-only placeholder), `remove_group_member`, `delete_group` (soft), `get_invite` / `redeem_invite` (claim placeholder), `save_expense` (expense + payers + shares + items + assignments in one transaction, edit replaces children, history snapshot), `set_expense_deleted` (soft delete / undo). Activity rows are written only by RPCs (client INSERT revoked). Only RLS helper fns in `private` are executable by users. `supabase/tests/rpc.test.sql` has 32 assertions.

**lib/splits additions** (still 100% covered): `buildExpense(draft)` turns the form's string draft into exact payers/shares/items with friendly messages ("€10.00 left", "Percentages add up to 90%"). It's used for the live preview on the client and authoritatively in the server action. Also `draftFromExpense` (round-trips for editing), `defaultSplitDraft`, `participantNet`, `userDebts` (all groups + friend-only → user-id debts), `parseScaled`/`formatScaled`/`parseBasisPoints`/`parseShareWeight`.

**UI** (mobile-first): add/edit expense dialog (full-screen sheet on phones): description + category icon, amount + currency, paid by one or multiple, all 6 split types with live per-person preview, date, notes, attachments, Scan receipt button. Group page: expenses by month, balances, who-owes-whom (simplified or pairwise). Group settings: name/type/currency/cover, simplify toggle, default split (equal / % / shares), members (add by email or name, remove, per-placeholder invite link), invite links (create/copy/revoke), leave/delete with confirmation. Friends: add by email, accept/decline/cancel, balances per friend per currency. Friend page: balance + shared expenses across groups. Expense page: payers, shares, items, notes, attachments (signed URLs), edit history with field diffs, delete with Undo toast / Restore.

**Decisions**
- Participant ids: group expenses use `group_members.id`, friend-only use user ids. `save_expense` rejects mixing, non-members, non-friends, duplicates, sums ≠ total, or wrong signs (integrity re-checks only; amounts come from lib/splits).
- Expenses can't move between groups/friend-only on edit (RPC rejects).
- Editing a group expense requires all participants to still be current members.
- Like Splitwise, people added to a group (or to a friend-only expense) automatically become accepted friends.
- Placeholder-specific invite links are single-use (revoked on claim); general links are reusable.
- Leaving/removing requires a zero balance in every currency. Checked in the server action with `netBalances`; balance UI shows per-currency, never converted.
- "Equal" tip/tax lines in itemized splits are stored as assignments to everyone (weight 1), so reloads reproduce the same result. Proportional charges are stored unassigned.
- Edit history = `activity_log` rows for the expense; payload has `before`/`after` snapshots (names captured at the time).
- Attachments (≤10 MB) upload after the expense saves via signed upload URLs: a server action signs (Storage checks the INSERT policy), the browser uploads bytes directly to Storage, and a second action records the row (path must be inside the expense's folder). This avoids server-action and Vercel body limits.
- Radix Select inside forms can emit `onValueChange("")`; every Select handler ignores empty values.
- `ScanReceiptButton` currently only explains the feature; phase 6 implements upload/parse and calls `onScanned(ScannedReceipt)`, which the form already handles (switches to itemized, sets lines/currency/date/merchant/receiptId).
- Dashboard and Activity pages are still placeholders (phase 5).

### Phase 5 — Balances, settle up, activity, comments ✅

**DB** (`…0700_phase5_settlements_comments`): `save_settlement` (create/edit; group payments use member ids, friend-only use user ids; caller must be a member, or one side and friends with the other), `set_settlement_deleted`, `add_comment` / `delete_comment` (own only, soft). All log to `activity_log` via `private.log_event` (adds settlement/comment ids). Client INSERT/UPDATE on settlements and comments revoked, so every change goes through an RPC. `profiles.venmo_username` / `paypal_username` (editable on Account), `settlements.external_provider` (venmo/paypal/other, only with method `external_app`). `supabase/tests/phase5.test.sql` has 17 assertions (72 DB tests total).

**lib/splits additions** (100% covered): `userDebts(..., { keepPlaceholders })`, `balancesBetween` (a pair's balance per group + outside groups), `balanceSummary` (owe/owed/net per currency), `participantBalance`, `parseSettlementAmount`.

**UI**
- Dashboard: Total balance / You owe / You are owed cards (per currency), "You owe" and "Owes you" lists (placeholders included, linked to their group's balances), groups with your balance, onboarding empty state.
- Group page: header Settle up (pre-filled with my most relevant suggested payment), list mixes expenses + payments, Balances tab with per-member balances and suggested payments (each with Settle), and a note when simplify debts would change the number of payments.
- Settle up dialog: payer ⇄ recipient (swap), amount/currency, Cash / Venmo / PayPal / Other app / Bank, date, notes. When you are paying and the recipient has a handle, it shows "Pay X on Venmo/PayPal" (Venmo only in USD), then you record the payment.
- Friend page: balance by group (and outside groups), each with Settle in its own context; shared list includes payments.
- Payment page: details, edit, delete/undo, comments, history.
- Activity: every create/edit/delete/restore of expenses and payments, comments, group and member events; "you owe / you get back / you paid / you received" impact from snapshots; group filter; Older/Newest pagination.
- Comments: live via Supabase Realtime `postgres_changes` (RLS-filtered), with a Live / paused indicator; posting/deleting own comments.
- States: `(app)/loading.tsx` skeleton (dashboard-specific skeleton too), `(app)/error.tsx` boundary with retry, `app/not-found.tsx`, empty states on every list.

**Decisions**
- Settling with a friend happens per context (a group or outside groups), because group balances are member-based. The friend page lists each context separately rather than one cross-group payment.
- Any group member can record a payment between any two members (as in Splitwise).
- Dashboard totals include debts with placeholders (kept under their member id); the Friends page excludes them (they aren't friends).
- Realtime: the browser client is a singleton and dev Strict Mode mounts twice, so each mount uses a unique channel topic and calls `realtime.setAuth(access_token)` before subscribing. Without that, postgres_changes silently never joined.
- Activity text is built from the payload snapshot (names at the time), so history stays readable after renames/leaves.
- Comments aren't revalidated server-side; the thread updates through Realtime plus the action's return value (deduped by id).
- Perf note for phase 12: dashboard/group first-load JS ~380 kB because the expense dialog ships with the page; consider `next/dynamic` for the form.

### Phase 6 — AI receipt scanning ✅

**Flow**: Scan receipt (in the expense form) → take/choose photo → client downscales to ≤2576 px long edge and re-encodes JPEG ≤3.5 MB (`components/receipts/compress.ts`, EXIF orientation applied) → `createReceiptUploadAction` issues a signed upload to `receipts/{uid}/{receiptId}.jpg` → browser uploads directly → `POST /api/receipts/parse` → review screen (merchant/date/currency/total, warnings, translated + original names) → "Use these items" switches the form to an itemized split with those lines, currency, date, merchant and `receiptId`.

**Settings**: "Receipt language" (Auto-detect or searchable list) and "Translate to" (defaults to the profile's preferred_language via `UserPrefsProvider`, falling back to English). `LANGUAGE_TAGS` expanded to ~75 languages.

**Route** (`app/api/receipts/parse`, `maxDuration` 60): auth → Zod body → path must be `{uid}/{receiptId}.*` → rate limit (10 / 10 min, 100 / day per user, counted from `receipts` rows; 429 + Retry-After) → download (RLS) → type/size checks → insert `receipts` row (processing) → parse → store `raw_model_json`, normalized `parsed`, merchant/date/currency/total, status parsed/failed.

**Parser** (`lib/ai/receipt-parser.ts`): `claude-sonnet-5-5` (from `ANTHROPIC_MODEL`) via `client.beta.messages.parse` with `betaZodOutputFormat(receiptModelSchema)` (structured outputs), system prompt as a cached block (`cache_control: ephemeral`, byte-stable; per-request language settings go in the user turn), image as base64, `max_tokens` 16000, refusal fallbacks on (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Retries **once** when output doesn't match the schema, is truncated, or fails money normalization, sending the specific problems back. No retry for refusals, API errors (SDK already retries 429/5xx) or non-receipts. Other errors (e.g. missing credentials) are rethrown, and the route answers 503.

**Schema** (`lib/validation/receipt.ts`): merchant, date, currency, detected_language, prices_include_tax, items (original_name, translated_name, quantity, unit_price, line_total, line_discount), discounts, taxes (name, rate, amount, inclusive), service_charge (inclusive flag), tip, subtotal, total, total_is_handwritten, warnings. Money is decimal **strings**, never JSON numbers.

**Normalization** (`lib/splits/receipt.ts`, 100% covered): strings → minor units for the receipt currency (unknown/invalid currency or unparseable amounts → `ReceiptFormatError` → retry). Lines: items net of line discounts (negative returns kept), receipt discounts as negative lines, **only tax-exclusive** taxes and service charges become lines (inclusive ones are informational), tip line. Warnings: qty × unit ≠ line total, items ≠ subtotal, lines ≠ total (missing/extra amount), missing total/currency, handwritten total, plus the model's own warnings.

**Prompt** (`lib/ai/receipt-prompt.ts`) covers regional conventions generically: tax-inclusive vs added (decided from the arithmetic), multiple rates, VAT/GST/CGST+SGST/消費税 etc., line vs receipt discounts, decimal comma / apostrophe / Indian grouping, zero- and three-decimal currencies, currency inference from context, non-Gregorian dates, non-Latin scripts (original kept verbatim), handwritten tips/totals, ignoring payment/change lines.

**DB**: `…0800_receipt_links`: a trigger drops an expense's `receipt_id` the user can't access (instead of failing the save), and a linked receipt is shared with the expense's group. Item `original_name` is saved through `save_expense`.

**Evals**: `tests/receipts/` has 4 generated samples (US tax-added + handwritten tip, DE VAT-inclusive with decimal commas + line discount, JP 内税 + Reiwa date, IN CGST/SGST + service) with `*.expected.json`, and `_generate.py` to regenerate them. `npm run eval:receipts` compares currency/date/merchant/total/item amounts/tax/tip/service lines/names/reconciliation and writes `tests/receipts/results/` (gitignored).

**Not yet verified against the live API**: no Anthropic credentials were configured during development. The parser is covered by unit tests with a mocked client, and the full UI flow was exercised with a stubbed route response. First thing to do with a key: `npm run eval:receipts`, then tune the prompt or `RECEIPT_PARSER_EFFORT` from real photos.

### Phase 7 — Receipt review / item assignment ✅

**Where**: the itemized split inside the add/edit expense sheet (full-screen on phones). Scanning a receipt lands here; editing an itemized expense reopens it. One save path: `save_expense` RPC writes expense, items (with quantity + unit price), assignments (weights), payers, shares and the receipt link in one transaction.

**UI** (`components/expenses/assign/item-assigner.tsx`):
- Sticky people bar (avatars with running totals). Select mode is primary: tap a person (You is active by default), tap their items; tapping an item someone else has makes it shared; tapping again removes. Digits 1–9 pick a person.
- Drag & drop (dnd-kit): drag an avatar onto an item, or an item's grip onto an avatar. Mouse activates after 6 px, touch after a 180 ms hold (so scrolling works), keyboard via KeyboardSensor.
- Shortcuts: "Assign remaining (n) to X", per-item menu "Split with everyone", long-press / right-click / menu → uneven shares dialog (integer weights 0–20).
- Item cards: translated name, original in small type, quantity × unit price, assignee chips (×weight), amber highlight + "Unassigned". Edit dialog: type, name, quantity, unit price (total recomputed exactly via `lineTotalFromUnit`), total, delete; add item/tax/tip/service/discount.
- Charges section: tax/tip/service/discount split proportionally by default, toggle to equal.
- Footer: live per-person totals (incl. proportional charges) from `previewItemized`, plus an "n unassigned · amount" chip that scrolls to the first one. Save is disabled while anything is unassigned (the RPC also rejects it).
- Split mode toggle (Equal / Exact / % / Shares / +/− / Itemized) as a 3×2 grid on phones.
- Keyboard/a11y: every control is a real button; item buttons announce name, amount, who's on it and what pressing does; avatar toggles use aria-pressed + aria-label; all actions reachable from the item menu.

**lib/splits additions** (100% covered): `previewItemized` (split over assigned items + unassigned count/total), `lineTotalFromUnit` (unit × quantity with 3-decimal quantities, BigInt, round half up), `DraftLine.quantity/unitPrice` → `BuiltItem.quantity/unitPrice`, receipts carry quantity/unit price into draft lines.

**DB** (`…0900_item_quantities`): `expense_items.quantity` is `numeric(12,3)` (weighed goods); `save_expense` stores quantity + unit price and rejects itemized expenses with unassigned items. 77 pgTAP assertions total.

**Decisions / gotchas**
- React events bubble through portals: a `<form>` inside a dialog rendered within the expense form must `stopPropagation()` on submit, or Enter also submits (and saves) the outer expense.
- Item identity is the array index (DraftLine has no id); fine for one editor session.
- Perf note for phase 12: first-load JS on group/expense pages is now ~417 kB (dnd-kit + assigner ship with the dialog). Lazy-load the expense dialog with `next/dynamic`.

### Phase 8 — Production prep ✅ / deploy ⏳ (waiting on accounts)

**RLS / privilege review** (`…1000_harden_privileges`): the audit found direct-write paths that bypassed RPC integrity checks. Fixed:
- `expenses`, `expense_payers`, `expense_shares`, `expense_items`, `item_assignments`: client INSERT/UPDATE/DELETE revoked (direct share edits could break sum = total and corrupt balances). Select-only policies; writes only via `save_expense` / `set_expense_deleted`.
- `groups`, `group_members`: client writes revoked. A creator's hard DELETE cascaded away everyone's expenses; direct member edits skipped balance checks and the activity log. RPCs only.
- `friendships`: insert/update via RPCs only; delete (cancel/decline/unfriend) stays direct.
- `activity_log`, `exchange_rates`, `profiles` insert/delete, etc.: no client writes.
- TRUNCATE/TRIGGER/REFERENCES revoked from `anon` and `authenticated` (RLS doesn't cover TRUNCATE), including default privileges for future tables.
- Attachments bucket restricted to images, PDF, text and CSV (no HTML/SVG served from Storage). `ATTACHMENT_MIME_TYPES` mirrors it client-side.
- Direct client writes that remain (RLS-checked): profiles (own, column-limited), friendships delete, invite_links, receipts, attachments, notifications (read), notification_settings, recurring_rules, splitwise_connections delete.
- `rls.test.sql` rewritten: fixtures via RPCs, plus assertions that every closed path is denied, anon has no grants, no TRUNCATE/TRIGGER/REFERENCES, every SECURITY DEFINER function pins `search_path`. 87 pgTAP assertions total.

**Client bundle**: `npm run check:bundle` scans `.next/static` for server secret names/values, the `sk-ant-` prefix and the receipt system prompt. Clean, and verified to catch a planted leak.

**Error handling**: `app/global-error.tsx` (root layout), `app/error.tsx` (login/auth/invite), and the existing `(app)/error.tsx`, `(app)/loading.tsx`, `not-found.tsx`.

**Production config**: security headers (nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, COOP), `poweredByHeader: false`. `serverActions.bodySizeLimit` raised to 6 MB (5 MB group covers previously exceeded the 3 MB limit).

**Auth redirects follow the deployment**: `lib/site-url.ts` derives the origin from the request (production domain, Vercel previews, localhost), falling back to `NEXT_PUBLIC_SITE_URL`; Supabase's redirect allow-list still applies. Magic-link email template now links to `{{ .RedirectTo }}&token_hash=…`, with `emailRedirectTo` = `<origin>/auth/confirm?next=…`. Local allow-list is `http://localhost:3000/auth/**`.

**Deploy status (2026-10-06)**: code pushed to https://github.com/Shanthan2307/splitlens (`main`, public repo; secret scan clean). Production Supabase `splitlens` (`lkbyryjwsxycsrtcivka`, us-west-2 → Vercel region pdx1) linked; all 10 migrations applied and verified (RLS on all 20 tables, no anon grants, buckets, realtime). Remaining: Auth URL config/SMTP/templates/Google provider, Vercel project + env vars + domain (docs/DEPLOY.md steps 2–7). Note: `supabase db push` works without the DB password (the CLI uses a temporary login role). Hosted type generation differs only cosmetically from local; keep the committed local-generated types.

Earlier status: not deployed. The Supabase and Vercel CLIs aren't logged in on this machine, there's no hosted Supabase project or Vercel project yet, and no git remote. `docs/DEPLOY.md` has the full step-by-step checklist (Supabase project + migrations, Auth URL config, SMTP, email templates, Google OAuth, Anthropic workspace key, Vercel env vars/region/domain, smoke test).

### Phase 9 — Splitwise import and sync ✅ (+ mobile pass)

Shipped in stages, each pushed to `main`: mobile/Android pass, connect, import wizard, post to Splitwise, onboarding. Migrations `20261007000100…0300` are applied to production. The integration is live once the three `SPLITWISE_*` env vars are set on Vercel (docs/DEPLOY.md step 4b).

**Connect** (`/api/splitwise/connect` → Splitwise → `/api/splitwise/callback`): random state in an httpOnly cookie (path `/api/splitwise`, 10 min, timing-safe compare), code exchange, then `get_current_user` with the new token, so the Splitwise id is verified. `splitwise_link_account` stores it on `profiles.splitwise_user_id` (one SplitLens account per Splitwise account) and claims placeholders imported for that id. Tokens are AES-256-GCM encrypted (`v1.<iv>.<tag>.<ct>`) in `splitwise_connections`. Splitwise access tokens normally don't expire. If `expires_in`/`refresh_token` ever come back, they're refreshed 60 s before expiry or on a 401; otherwise a 401 marks `sync_error = 'reconnect'` and the UI asks to reconnect. Disconnect deletes tokens and the verified id; imported data stays.

**Import** (`/import/splitwise`): the overview lists Splitwise groups and friends with who's already on SplitLens (verified Splitwise id, then email; admin lookup returns booleans only). The client drives one server action per step (group members, then pages of 40 expenses, or 20 with comments), so progress is live and each call stays well under the function time limit (`maxDuration` 60). Rate limits: the API client waits out `Retry-After` up to 20 s with up to 4 retries; longer waits come back as `{ rateLimited, retryAfter }` and the wizard shows a countdown, then repeats the same page.
- Groups: `splitwise_import_group` creates the group on first import (`groups.splitwise_group_id` is unique, so anyone else in that Splitwise group maps to the same SplitLens group and joins it). Members are matched by verified Splitwise id, then email; everyone else becomes a placeholder with `splitwise_user_id` (+ email). Placeholders are auto-claimed on signup with that email (existing trigger), on connecting Splitwise, or via an invite link. After import the wizard offers "Invite N people" (group link through the Web Share sheet).
- Friends: friend-only expenses need real accounts, so only friends already on SplitLens can be imported. Others get a **friend invite link** (`invite_links` with `group_id` null → `get_invite` kind `friend`, `redeem_friend_invite`); once they join, re-running the import brings the balance over. Expenses that include a third person not on SplitLens are skipped and reported as "unresolved".
- `splitwise_import_expenses` keys everything by Splitwise ids: re-runs report "already here", never duplicate; expenses deleted in Splitwise are soft-deleted here (tombstones are sent); payments become settlements (method `other`); comments are deduplicated by `splitwise_comment_id`, System comments are dropped, and authors not on SplitLens keep their name as a prefix. Imported expenses are `split_type = 'exact'` with `split_input` = owed minor units. One `splitwise_import_completed` activity per finished group/friend (not per expense).
- Money: `lib/splits/splitwise.ts` parses Splitwise decimal strings (lenient about trailing digits, half away from zero), drops zero shares, and absorbs up to 1 unit/person of rounding (largest first). Bigger mismatches skip the expense (`invalid`).

**Also post to Splitwise**: the expense form shows the toggle for new expenses when you're connected and the group has a `splitwise_group_id` (or it's friend-only → Splitwise `group_id` 0). It's disabled with a reason when someone isn't on Splitwise (`splitwise_participants`: member's imported id or linked account) or for refunds. The choice is remembered in localStorage. After `save_expense`, `create_expense` gets exact `paid_share`/`owed_share` per user (any split type works), and `splitwise_set_expense_id` stores the id. A Splitwise failure keeps the SplitLens expense and shows a warning toast.

**Onboarding**: the dashboard's first-run state leads with "Coming from Splitwise? Import" when configured.

**Mobile (Android)**: ≥40 px touch targets on coarse pointers (`pointer-coarse:min-h-10`, so explicit sizes never shrink; small icon buttons get an invisible `after:` hit area); viewport `interactive-widget=resizes-content` (Android keyboard resizes the layout, so 100dvh sheets keep Save visible), `viewport-fit=cover` with safe-area padding; web app manifest + icons (`app/manifest.ts`, `public/icon-*.png`); no pull-to-refresh inside open dialogs; `touch-action: manipulation`.

**Security decisions**
- Every import/link/set-id RPC is `service_role` only and impersonates the user (`private.as_user` sets `request.jwt.claim(s)` for the transaction, so `auth.uid()`-based helpers and activity attribution work). A client could otherwise pass a fabricated `splitwise_group_id` and join someone else's imported group. Data reaching these RPCs was fetched from Splitwise with the user's own token.
- Email matching auto-adds registered users to imported groups and befriends them, same as `add_group_member` (and Splitwise). No new consent surface.
- `/auth/confirm` also accepts `?code=` (PKCE) so Supabase's default email template works before custom SMTP is set up.

**Testing**: 41 pgTAP assertions in `supabase/tests/splitwise.test.sql` (128 DB tests in total). Unit tests cover the API client (backoff, refresh, errors), crypto, OAuth state, env and mappers. E2E was verified locally against a fake Splitwise (`SPLITWISE_DEV_ORIGIN`): connect, 47-expense group import with a forced 25 s rate limit, re-run idempotency, balances, friend invite, post to Splitwise. **Not yet verified against the real Splitwise API** (no app credentials during development). Do the DEPLOY.md step 7 Splitwise checks after setting the env vars.

**Receipt on the expense** (2026-10-09): the expense page shows the scanned photo ("Receipt" section: thumbnail, full-screen viewer with pinch-zoom, open original) via `getReceiptImage` (1-hour signed URL), and expense lists show a receipt icon. Scans were always stored (`receipts/{uid}/…` + `expenses.receipt_id`), so expenses scanned before this change show their receipt too (10 in production on 2026-10-09). Visibility needs no new rules: `can_access_receipt` already allows anyone who can see a linked expense, and the `receipts_read` storage policy follows it.

**Open items**: background/scheduled sync (re-running the wizard syncs for now); updating or deleting a posted expense on Splitwise (posting is create-only); Splitwise preview deployments (one callback URL per app).
