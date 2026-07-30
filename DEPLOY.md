# Starpush — Deployment & Launch Guide

Everything needed to take Starpush from code to a live, paying product.
This is the single deployment doc; `README.md` covers what the product does and
how to run it locally.

---

## 1. Environment variables

### Required — the app is unsafe or broken without these

```
ANTHROPIC_API_KEY   = sk-ant-...           Powers every AI feature
JWT_SECRET          = <64+ random chars>   See warning below
ADMIN_KEY           = <random string>      Guards the lead-export endpoints
APP_URL             = https://starpush.io  Stripe redirects, reset + verify links
NODE_ENV            = production           Makes auth cookies Secure (HTTPS-only)
```

> **`JWT_SECRET` is not optional.** It falls back to a hardcoded development
> string that is committed to this repo. If you deploy without setting it,
> anyone who can read the source can forge a session cookie and sign in as any
> user. Generate one with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

### Required for SMS (the core feature)

```
TWILIO_ACCOUNT_SID  = AC...
TWILIO_AUTH_TOKEN   = ...       Also verifies inbound webhook signatures
TWILIO_PHONE_NUMBER = +1...
```

### Required for email

```
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM
```

> Email verification gates SMS sending. **With no SMTP configured, a new signup
> can never send a text** — the verification link never arrives. AOL and Gmail
> both need an app-specific password, not your account password.

### Required for payments

```
STRIPE_SECRET_KEY       = sk_live_...
STRIPE_WEBHOOK_SECRET   = whsec_...
STRIPE_STARTER_PRICE_ID = price_...
STRIPE_GROWTH_PRICE_ID  = price_...
STRIPE_PRO_PRICE_ID     = price_...
```

Until these are set the app runs in trial-only mode and the upgrade page shows a
"payments not yet enabled" message.

### Optional

```
PROMO_CODE            Enables the complimentary-trial code (see PROMO.md).
                      Leave unset to disable promo codes entirely.
DEFAULT_REVIEW_LINK   Fallback review link. Prefer per-user links in Account Settings.
ANTHROPIC_MODEL_HAIKU / ANTHROPIC_MODEL_SONNET   Override default models.
DATA_DIR              Where starpush.db and backups/ live. Defaults to ./data.
```

---

## 2. Twilio — A2P 10DLC registration (required before real traffic)

US carriers filter or block unregistered application-to-person SMS. Registration
is not optional if you want messages to actually arrive.

1. Twilio Console → **Messaging → Regulatory Compliance → A2P 10DLC**.
2. Register a **Brand** (your business details).
3. Register a **Campaign** — use case *Customer Care* or *Low Volume Mixed*.
4. **Sample messages must match what the app really sends**, including the
   `Reply STOP to opt out.` suffix. Copy one from the dashboard SMS preview.
5. Set the inbound webhook: Console → your number → Messaging →
   *A message comes in* → `https://starpush.io/api/webhook/twilio-inbound`.

> Inbound requests are verified against `TWILIO_AUTH_TOKEN`. If the token is
> missing or wrong, **every inbound STOP is rejected with a 403** — customers
> who try to opt out won't be recorded. Check the logs for
> `[Twilio Inbound] rejected: bad or missing signature` after deploying.

### Known limitation: one shared sending number

Every business on the platform sends from the same Twilio number. Two
consequences worth understanding:

- Recipients see a number registered to Starpush asking for a review on behalf
  of *their* plumber, which reads as a brand mismatch to carriers and raises
  filtering risk.
- A `STOP` reply suppresses that number **platform-wide** (Twilio enforces
  opt-out per number pair), so one tenant's opt-out blocks every tenant. The app
  tracks this in `sms_suppressions` and explains it rather than failing opaquely.

Moving to per-tenant numbers or Twilio subaccounts (~$1.15/number/month) is the
fix once you have more than a handful of customers.

---

## 3. Render (hosting)

1. Render Dashboard → **New + → Web Service** → connect this repo.
2. Set the environment variables from section 1.
3. **Attach a persistent disk** mounted at `/opt/render/project/src/data`.
   The SQLite database lives at `data/starpush.db`. On an ephemeral disk it is
   **wiped on every deploy** — you would lose every user, their customers, and
   the Stripe IDs that map subscriptions to accounts.
4. Confirm the health check path is `/health`.
5. Rename the service from Render's random auto-name to `starpush` (cosmetic —
   only changes the `*.onrender.com` URL).

### Backups

The app snapshots the database to `DATA_DIR/backups/` on boot and once every 24
hours (`VACUUM INTO`, last 7 retained). Look for `[Backup] wrote …` in the logs.

To restore: stop the service, copy the chosen snapshot over
`data/starpush.db`, delete any `-wal`/`-shm` siblings, restart. Verify a
snapshot before trusting it:

```bash
sqlite3 backups/starpush-<stamp>.db "PRAGMA integrity_check; SELECT COUNT(*) FROM users;"
```

Snapshots live on the same disk as the database, so they survive a bad deploy
but not a disk loss. Copy them off-box before you have revenue worth protecting.

---

## 4. Stripe

1. Create one recurring price per tier in the Stripe Dashboard → Products.
   Copy each **Price ID** (`price_...`) into the env vars above.
2. Developers → API keys → copy the **Secret key**.
3. Developers → Webhooks → **Add endpoint**:
   - URL: `https://starpush.io/api/stripe/webhook`
   - Events: `checkout.session.completed`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the **Signing secret** (`whsec_...`).
4. Test with `sk_test_...` keys and card `4242 4242 4242 4242` first.

> The pricing page and the README have disagreed on the Pro tier ($149 vs $199).
> Pick one and make the Stripe price match before taking payments.

---

## 5. Domain (Porkbun → Render)

1. Render → your service → **Settings → Custom Domains** → add `starpush.io`
   and `www.starpush.io`. Render shows the DNS records it wants.
2. Porkbun → `starpush.io` → DNS:
   - **Apex:** Porkbun supports `ALIAS` at the apex — point it at the target
     Render gives you (`your-service.onrender.com`).
   - **www:** `CNAME` → `your-service.onrender.com`.
   - Delete Porkbun's default parking records first so they don't conflict.
3. Back in Render, click **Verify**. SSL is issued automatically once DNS
   resolves (15 minutes to a few hours).
4. Set `APP_URL=https://starpush.io` so Stripe redirects, password-reset links,
   and email-verification links use the real domain.

---

## 6. Post-deploy smoke test

- [ ] `https://starpush.io/health` returns `{"status":"ok"}`.
- [ ] Sign up a fresh account — the consent checkbox is required, and you land
      on `/dashboard?welcome=1`.
- [ ] The verification email arrives; clicking it redirects to
      `/dashboard?verify=ok`.
- [ ] **Before verifying**, a send attempt is refused with a "confirm your
      email" message. That is the anti-abuse gate working.
- [ ] Saving a junk review link is rejected; a real `g.page/r/...` link saves.
- [ ] Send one review request to your own phone. Confirm the received text ends
      with `Reply STOP to opt out.`
- [ ] Reply `STOP` from that phone, then try sending to it again — expect a
      clear refusal, and a row in `sms_suppressions`.
- [ ] Text `Jane 5551234567 test repair` from the business phone on the account
      → you should get a confirmation text back.
- [ ] Run the GBP Optimizer and GBP Starter **logged out** — both are public
      lead magnets and should work without an account.
- [ ] Log a review count on the dashboard trend card; log a second one later and
      confirm the chart and "+N new reviews" appear.
- [ ] Do a live Stripe checkout on the cheapest plan; confirm the account flips
      to active and the billing portal opens.
- [ ] Confirm `[Backup] wrote …` appears in the logs on boot.

---

## 7. Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

Set `DATA_DIR` to keep test data out of the repo:

```bash
DATA_DIR=/tmp/starpush-dev JWT_SECRET=dev-only npm run dev
```

With no `ANTHROPIC_API_KEY`, `TWILIO_*`, or SMTP configured the app still boots —
those features fail gracefully and log a warning at startup.
