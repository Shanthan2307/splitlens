# Deploying SplitLens v1

Work through the sections in order. Every box is something to click, paste, or run.
Replace `<ref>` with your Supabase project ref, `<domain>` with your production domain
(e.g. `splitlens.app`), and `<team>` with your Vercel team slug.

Keep secrets out of chat, tickets and git. Paste them only into the dashboards named below
or a password manager.

---

## 0. Before you start

- [ ] Accounts: Supabase, Vercel, Google Cloud, Anthropic Console, a transactional email provider (Resend, Postmark, or SES), and access to your domain's DNS.
- [ ] Locally, everything is green:
  ```bash
  npm run check && npm run test:db && npm run build && npm run check:bundle
  ```
- [ ] Code is on GitHub (for Vercel's Git integration and preview deployments):
  ```bash
  git add -A && git commit -m "SplitLens v1"
  gh repo create splitlens --private --source . --push
  ```

## 1. Supabase project

**Dashboard → New project**
- [ ] Name `splitlens-prod`, a strong database password (save it in your password manager).
- [ ] Region close to your users. Note it; the Vercel function region in step 6 must match (e.g. `us-east-1` → `iad1`, `eu-central-1` → `fra1`).
- [ ] Plan: Pro is recommended for production (daily backups, no project pausing).

**Settings → API Keys**: note these for step 6
- [ ] Project URL `https://<ref>.supabase.co`
- [ ] `anon` / publishable key (public)
- [ ] `service_role` / secret key (server-only, never in client code)

**Apply the schema** (from the repo root). Run these one at a time; zsh doesn't treat
pasted `# …` text as comments, so the commands below deliberately have none:
```bash
npx supabase login
```
```bash
npx supabase link --project-ref <ref>
```
```bash
npx supabase db push --dry-run
```
The dry run should list 10 migrations. Then:
```bash
npm run db:push
```
To compare production types with local, generate them and inspect the diff. Expect only
generator-version noise (`PostgrestVersion`, `Json` vs `NonNullable<Json>`, line wrapping);
then restore the committed file:
```bash
SUPABASE_PROJECT_ID=<ref> npm run db:types && git diff --stat lib/db/database.types.ts
```
```bash
git checkout -- lib/db/database.types.ts
```

> **Status (2026-10-06):** done for `splitlens` (`lkbyryjwsxycsrtcivka`, us-west-2). All 10 migrations
> applied and verified: 20 tables, all RLS-enabled, no `anon` grants, no TRUNCATE/TRIGGER/REFERENCES,
> 4 buckets (avatars/group-covers public, receipts/attachments private), 10 realtime tables.
> Vercel Function Region for us-west-2: **pdx1** (Portland).

**Verify in the dashboard**
- [ ] Table Editor: all 20 `public` tables show **RLS enabled**.
- [ ] Storage: buckets `avatars` (public), `group-covers` (public), `receipts` (private), `attachments` (private).
- [ ] Database → Publications → `supabase_realtime` includes `comments`, `expenses`, `settlements`, `activity_log`, `notifications`, ….
- [ ] Advisors → **Security Advisor**: no errors. Review any warnings.
- [ ] Advisors → **Performance Advisor**: review.
- [ ] Database → Backups: confirm daily backups. Optionally enable PITR.

## 2. Supabase Auth

**Authentication → URL Configuration**
- [ ] Site URL: `https://<domain>`
- [ ] Redirect URLs (add each):
  - `https://<domain>/auth/**`
  - `https://*-<team>.vercel.app/auth/**` (preview deployments; skip if you don't want logins on previews)

**Authentication → Sign In / Providers**
- [ ] Email: **enabled** (magic links). "Allow new users to sign up": on.
- [ ] Email OTP expiration: `3600` seconds. OTP length: `6`.
- [ ] Google: **enabled**. Paste Client ID and Client Secret (from step 3). "Skip nonce check": **off**. The callback URL shown here is `https://<ref>.supabase.co/auth/v1/callback`.

**Authentication → Emails → SMTP Settings**: required for real users
- [ ] Enable custom SMTP with your provider (host, port, user, password). Sender `no-reply@<domain>`, name `SplitLens`.
- [ ] At your email provider: verify `<domain>` (SPF, DKIM, DMARC DNS records).
  Without custom SMTP, Supabase's built-in mailer only delivers to your project's team members and is heavily rate-limited.

**Authentication → Emails → Templates**
- [ ] **Magic Link**: Subject `Your SplitLens sign-in link`. Body: paste `supabase/templates/magic_link.html`.
- [ ] **Confirm signup**: same subject and body (new users get this email instead of Magic Link).
  The link uses `{{ .RedirectTo }}`, so it returns to the domain the user signed in from.

**Authentication → Rate Limits**
- [ ] After SMTP is configured, raise "emails sent per hour" (e.g. 100). Keep OTP/verification limits at defaults.

**Authentication → Attack Protection** (optional for v1)
- [ ] CAPTCHA needs a frontend widget, which isn't built yet. Leave off for now, and revisit if you see abuse.

## 3. Google Cloud Console

**APIs & Services → Credentials → your OAuth 2.0 Client (Web application)**
- [ ] Authorized JavaScript origins: `https://<domain>`
- [ ] Authorized redirect URIs: `https://<ref>.supabase.co/auth/v1/callback` (keep `http://127.0.0.1:54321/auth/v1/callback` for local dev)

**APIs & Services → OAuth consent screen (Branding / Audience)**
- [ ] App name `SplitLens`, support email, logo.
- [ ] Authorized domains: `<domain>` and `supabase.co`.
- [ ] Privacy policy and terms URLs (required to publish).
- [ ] Scopes: `openid`, `email`, `profile` only.
- [ ] Publishing status: **In production**. In "Testing" only listed test users can sign in, and their tokens expire after 7 days.

## 4. Anthropic Console

- [ ] Create a workspace `splitlens-prod` (keeps billing and limits separate).
- [ ] Create an API key in it. Copy it straight into Vercel (step 6), don't store it anywhere else.
- [ ] Set a monthly spend limit for the workspace. The app also caps each user at 10 scans per 10 minutes and 100 per day.
- [ ] Optional: run the receipt evals once against the real model (costs a few cents). Put the key
  in `.env.local` as `ANTHROPIC_API_KEY=…` (gitignored), then:
  ```bash
  npm run eval:receipts
  ```

## 5. Email provider

- [ ] Verify the sending domain (DNS records from the provider).
- [ ] Create SMTP credentials and use them in step 2.

## 6. Vercel

**Add New → Project → Import the GitHub repo**
- [ ] Framework preset: Next.js (auto). Install `npm ci`, build `npm run build` (defaults).
- [ ] Settings → General → Node.js Version: **22.x** (needs ≥ 20.12).
- [ ] Settings → Functions → Function Region: match the Supabase region (step 1).

**Settings → Environment Variables**

| Name | Value | Environments | Sensitive |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Production, Preview | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key | Production, Preview | no |
| `NEXT_PUBLIC_SITE_URL` | `https://<domain>` | Production | no |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | Production (+ Preview only if you need it) | **yes** |
| `ANTHROPIC_API_KEY` | key from step 4 | Production (a separate key for Preview if wanted) | **yes** |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Production, Preview | no |
| `RECEIPT_PARSER_EFFORT` | leave unset (or `medium` for faster scans) | — | no |

- [ ] Don't add `SUPABASE_PROJECT_ID` (local tooling only) or any Google/Splitwise secrets (those live in Supabase).
- [ ] Settings → Deployment Protection: Vercel Authentication on for Previews (recommended).

**Settings → Domains**
- [ ] Add `<domain>` (and `www.<domain>` redirecting to it). Create the DNS records Vercel shows. HTTPS is automatic.

**Deploy**
- [ ] Push to `main` (Git integration), or from the repo: `vercel link && vercel --prod`.
- [ ] Deployment logs: build passes. Optionally add `npm run check:bundle` after `next build` in the Build Command (`npm run build && npm run check:bundle`) so a leaked secret fails the deploy.

## 7. Smoke test on production

- [ ] `https://<domain>` redirects to `/login`. Response headers include `X-Frame-Options: DENY`.
- [ ] Magic link: email arrives from your domain; the link signs you in and lands on the dashboard.
- [ ] Google sign-in works for an account that isn't a Google Cloud test user.
- [ ] Account: change name, avatar, currency, language, Venmo/PayPal handle.
- [ ] Create a group; add a second real account by email; that person sees the group.
- [ ] Add an expense with a photo attachment; edit it; delete + Undo.
- [ ] Scan a real receipt; assign items; save. In Supabase, `receipts` has a `parsed` row.
- [ ] Comment from two browsers at once; comments appear live.
- [ ] Settle up; the dashboard and the activity feed update.
- [ ] Invite link in a private window → sign in → join (claim a placeholder).
- [ ] Supabase → Logs (API, Auth, Postgres) and Vercel → Logs: no errors.

## 8. After launch

- [ ] Rotate any key that was ever pasted somewhere other than the dashboards above.
- [ ] Watch Anthropic spend and Supabase usage for the first week.
- [ ] Schema changes from now on: new migration → `npm run test:db` locally → `npm run db:push` → deploy.
