# 🚀 Starpush.io — Launch Checklist

Everything you need to take Starpush from code → live, paying product.
Work top to bottom. Each section is self-contained.

---

## 1. Stripe (payments) — MOSTLY DONE ✅

Account: **Starpush.io** (`acct_1TdhodLNuEWYNrVe`)

Products & prices are already created and live:

| Plan    | Price    | Price ID                              | Product ID            |
|---------|----------|---------------------------------------|-----------------------|
| Starter | $49/mo   | `price_1TdhzgLNuEWYNrVePMX7MKP6`      | `prod_UcxvuMSWToyAkl` |
| Growth  | $99/mo   | `price_1TdhzmLNuEWYNrVeZkUdvKs2`      | `prod_UcxvqKLccUVXxF` |
| Pro     | $199/mo  | `price_1TdhzpLNuEWYNrVep7jQu09w`      | `prod_UcxvK9lqQrl7gZ` |

### Remaining Stripe steps:

- [ ] **Get your API keys** — Dashboard → Developers → API keys
  - Copy **Secret key** (`sk_live_...`) → goes in Render as `STRIPE_SECRET_KEY`
  - (Publishable key `pk_live_...` is optional — only needed if you add Stripe.js client-side)
- [ ] **Create the webhook endpoint** — Dashboard → Developers → Webhooks → "Add endpoint"
  - **Endpoint URL:** `https://starpush.io/api/stripe/webhook`
  - **Events to send** (select these 3):
    - `checkout.session.completed`
    - `customer.subscription.updated`
    - `customer.subscription.deleted`
  - After saving, copy the **Signing secret** (`whsec_...`) → goes in Render as `STRIPE_WEBHOOK_SECRET`
- [ ] **Test mode first (recommended):** flip the dashboard to Test mode, repeat the above with test keys,
      run one fake checkout (card `4242 4242 4242 4242`), confirm the account unlocks, then switch to live.

> The webhook is what flips a user from "trialing" to "active" after they pay.
> Without it, payments succeed but accounts never unlock. It is NOT optional.

---

## 2. Render (hosting) — env vars + service name

### Environment variables to set (Render → your service → Environment):

```
ANTHROPIC_API_KEY      = sk-ant-...        (required — powers all AI features)
JWT_SECRET             = <64+ random chars> (required — generate a fresh one)
ADMIN_KEY              = <random string>    (protects /api/leads admin endpoint)
APP_URL                = https://starpush.io
STRIPE_SECRET_KEY      = sk_live_...        (from step 1)
STRIPE_WEBHOOK_SECRET  = whsec_...          (from step 1)
STRIPE_STARTER_PRICE_ID= price_1TdhzgLNuEWYNrVePMX7MKP6
STRIPE_GROWTH_PRICE_ID = price_1TdhzmLNuEWYNrVeZkUdvKs2
STRIPE_PRO_PRICE_ID    = price_1TdhzpLNuEWYNrVep7jQu09w
```

Optional (enable when ready):
```
TWILIO_ACCOUNT_SID     = AC...     (SMS review requests)
TWILIO_AUTH_TOKEN      = ...
TWILIO_PHONE_NUMBER    = +1...
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM   (password-reset + welcome emails)
```

### Other Render tasks:
- [ ] **Rename the service** — Render → Settings → Name → change `squishy-supply-house` (Render's random
      auto-name) to `starpush`. This is cosmetic; it does NOT affect the code or the live site. It only
      changes the `*.onrender.com` URL and the dashboard label.
- [ ] **Persistent disk** — the SQLite DB lives at `data/starpush.db`. On Render's free tier the disk is
      ephemeral (wiped on every deploy/restart), so **all users would be lost on redeploy**. Attach a
      **persistent disk** mounted at `/opt/render/project/src/data` (or upgrade to a paid instance), OR
      migrate to Postgres before taking real signups. See section 5.
- [ ] Confirm **health check path** is `/health` (already returns `{status:"ok"}`).

---

## 3. Porkbun (domain) — point starpush.io at Render

- [ ] **Buy / confirm** `starpush.io` is in your Porkbun account.
- [ ] In Render → your service → **Settings → Custom Domains** → add `starpush.io` and `www.starpush.io`.
      Render will show you the DNS records it needs.
- [ ] In **Porkbun → starpush.io → DNS**:
  - **Apex (`starpush.io`):** Render gives you either an `A` record (an IP) or asks for an `ALIAS`/`CNAME`.
    Porkbun supports `ALIAS` at the apex — use the target Render provides
    (looks like `your-service.onrender.com`).
  - **www:** add a `CNAME` record → `your-service.onrender.com`.
  - Delete Porkbun's default parking records first so they don't conflict.
- [ ] Back in Render, click **Verify**. SSL (Let's Encrypt) is issued automatically once DNS resolves
      (can take 15 min–a few hours to propagate).
- [ ] Once live, set `APP_URL=https://starpush.io` in Render (step 2) so Stripe redirects + reset links
      use the real domain.

---

## 4. Deploy + smoke test (post-launch)

- [ ] Push code to the repo and confirm Render auto-deploys (check the deploy log for
      `🚀 Starpush running`).
- [ ] Visit `https://starpush.io/health` → should return `{"status":"ok"}`.
- [ ] Sign up for a fresh account → should land on `/dashboard?welcome=1` (14-day trial).
- [ ] Run the **GBP Starter** and **GBP Optimizer** → confirm AI returns a real plan (needs `ANTHROPIC_API_KEY`).
- [ ] Do a **live Stripe checkout** with a real card on the cheapest plan → confirm the account flips to
      `active` (this proves the webhook works) → then refund yourself from the Stripe dashboard.
- [ ] (If Twilio configured) send one review-request SMS to your own phone.

---

## 5. Before serious traffic (important, not blocking launch)

- [ ] **Database durability.** `better-sqlite3` + a single file is fine for early users *only if* the
      `data/` directory is on a persistent disk. For real scale, migrate to Postgres (Render offers a
      managed Postgres add-on). Until then, **back up `data/starpush.db` regularly.**
- [ ] **Rotate `JWT_SECRET`** to a fresh 64-char random value in production (don't reuse any dev value).
      Note: rotating it logs out all existing users.
- [ ] **Set `NODE_ENV=production`** so auth cookies are sent `Secure` (HTTPS-only).
- [ ] Review **Twilio compliance** (A2P 10DLC registration is required in the US to send business SMS).

---

## Quick reference — what's already done vs. what's on you

**Done in code/Stripe:**
- ✅ Full app: auth, trials, dashboard, GBP Starter, GBP Optimizer, Insights, Review Shield, SMS, CSV export
- ✅ Stripe products + prices created on the Starpush.io account
- ✅ Stripe checkout + webhook + billing portal wired in `server.js`
- ✅ Branding: "starpush.io by clujkeebs" across all pages, clujkeebs → clujkeebs.com
- ✅ Subscription gating (expired trials redirect to /upgrade)
- ✅ Graceful AI error handling on every endpoint

**On you (dashboards only — no code needed):**
- ⬜ Stripe: grab secret key, create webhook, grab signing secret
- ⬜ Render: set env vars, rename service, attach persistent disk
- ⬜ Porkbun: point starpush.io DNS at Render
- ⬜ Smoke-test the live site end to end
