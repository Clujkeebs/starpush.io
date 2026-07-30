# starpush.io by clujkeebs 📍

A B2B local SEO & review automation platform for service businesses. Automate Google reviews, generate AI replies, and optimize your Google Business Profile.

## 🚀 Features

### Review Automation
- Send SMS review requests to customers (automatic, with a 3-day follow-up)
- Text a request from your phone without opening the dashboard —
  text `Jane 5551234567 furnace repair` to your Starpush number
- Generate professional AI replies powered by Claude
- Automatic activity feed tracking

> **What Starpush does not do:** it has no Google Business Profile API access, so
> it cannot detect new reviews or post replies for you. You paste a review in,
> and copy the generated reply into Google yourself. Review *requests* are fully
> automated; review *replies* are drafted, not posted.

### Review trend tracking
- Log your real Google review count and rating over time
- Charts the movement and reports reviews gained per month

### Compliance
- Every outbound message carries "Reply STOP to opt out"
- Platform-wide suppression list (all tenants share one sending number)
- Twilio webhook signature verification on inbound messages
- SMS consent attestation at signup; email verification gates sending

### GBP Starter (new)
- Guided, step-by-step setup helper for businesses creating their Google Business Profile from scratch
- Ordered, beginner-friendly launch steps (create → verify → categorize → describe → photos → first post → reviews)
- Copy-paste-ready category, description, services list, first Google Post, and starter Q&A
- Photo checklist and an interactive launch checklist
- Downloadable launch plan

### GBP Optimizer
- AI-powered Google Business Profile audit (for profiles that are already live)
- Optimized description generation (copy-paste ready)
- Category recommendations
- Photo checklist for optimal ranking
- Q&A templates pre-filled with local keywords
- 4-week content calendar

### Dashboard
- Real-time activity feed
- Conversation management
- Lead tracking
- Professional UI optimized for mobile

## 📋 Prerequisites

- Node.js 18+
- npm
- Anthropic API key (free trial available)
- (Optional) Twilio account for SMS

## ⚡ Quick Start

### Local Development
```bash
npm install
npm start
# Open http://localhost:3000
```

### Environment Variables
Create `.env` file:
```
ANTHROPIC_API_KEY=sk-ant-...
TWILIO_ACCOUNT_SID=ACxxxxxxx (optional)
TWILIO_AUTH_TOKEN=xxxxx (optional)
TWILIO_PHONE_NUMBER=+1xxxx (optional)
DEFAULT_REVIEW_LINK=https://g.page/... (optional)
PORT=3000
```

## 🌐 Deployment

### Option 1: Render (Recommended)
1. Create GitHub repo: `starpush`
2. Push code to GitHub
3. Go to https://dashboard.render.com
4. Click "New Web Service"
5. Connect your `starpush` repo
6. Set environment variables
7. Deploy!

### Option 2: Railway
```bash
railway link
railway up
```

### Option 3: Heroku
```bash
heroku create starpush
heroku config:set ANTHROPIC_API_KEY=sk-ant-...
git push heroku main
```

## 📡 API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | Landing page |
| GET | `/dashboard` | ✓ | Main dashboard |
| GET | `/signup` | — | Signup form |
| GET | `/starter` | ✓ | GBP Starter (guided setup) |
| GET | `/optimize` | ✓ | GBP Optimizer tool |
| GET | `/insights` | ✓ | AI Growth Coach |
| POST | `/api/auth/signup` | — | Create user account |
| POST | `/api/auth/login` | — | Log in |
| POST | `/api/gbp-starter` | — | Build a GBP launch plan (lead magnet, rate-limited) |
| POST | `/api/optimize` | — | Run GBP audit (lead magnet, rate-limited) |
| GET | `/api/trend` | ✓ | Review count/rating trend |
| POST | `/api/trend/snapshot` | ✓ | Log today's Google totals |
| GET | `/api/auth/verify-email` | — | Confirm email (unlocks SMS sending) |
| POST | `/api/send-request` | ✓ | Send review request SMS |
| POST | `/api/webhook/review` | ✓ | Receive review webhook |
| GET | `/api/feed` | ✓ | Activity feed |
| GET | `/api/leads` | `x-admin-key` | View lead summary (admin only) |
| POST | `/api/webhook/twilio-inbound` | Twilio webhook | Process STOP/START replies |
| GET | `/health` | — | Health check |

## 🔑 API Keys

**Anthropic**
- Get free trial: https://console.anthropic.com
- Keys limit: 5 requests/minute on free tier

Set `PROMO_CODE` in the server environment to enable the optional bounded
promotional trial; leave it unset to disable promo codes. Configure
`ANTHROPIC_MODEL_HAIKU` and `ANTHROPIC_MODEL_SONNET` to override the defaults.

Configure Twilio's inbound messaging webhook to:
`https://starpush.io/api/webhook/twilio-inbound`
- Defaults: `claude-sonnet-4-6` (GBP Optimizer), `claude-haiku-4-5-20251001` (replies)

**Twilio** (required for SMS)
- Get trial: https://console.twilio.com
- Phone number required for SMS
- **A2P 10DLC registration is required** for US traffic — register a Brand and
  a Campaign under Messaging → Regulatory Compliance. Sample messages must match
  what the app sends, including the "Reply STOP to opt out." suffix. Unregistered
  traffic gets filtered or blocked by carriers.
- Set the inbound messaging webhook to `/api/webhook/twilio-inbound`. Requests
  are verified against `TWILIO_AUTH_TOKEN`, so the token must be set or every
  inbound STOP is rejected.

**Required secrets**
- `JWT_SECRET` — falls back to a known dev string if unset; anyone can forge a
  session cookie. Generate with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `ADMIN_KEY` — guards the lead-export endpoints.
- `SMTP_*` — email verification gates SMS sending, so without SMTP a new signup
  can never send a text.

## 💾 Backups

The database is snapshotted to `DATA_DIR/backups/` on boot and once a day
(`VACUUM INTO`, last 7 kept). To restore, stop the service and copy a snapshot
over `starpush.db`.

## 💳 Stripe Setup (payments)

The payment flow is already built — **signup → 14-day free trial → `/upgrade` →
Stripe Checkout → webhook activates the subscription → billing portal to manage/cancel.**
You only need to plug in your keys.

1. **Create products** in the [Stripe Dashboard](https://dashboard.stripe.com/products) —
   one recurring price per tier (e.g. Starter $49, Growth $99, Pro $199 / month).
   Copy each **Price ID** (`price_...`).
2. **Get your Secret key** from Developers → API keys (`sk_live_...` or `sk_test_...`).
3. **Add a webhook** (Developers → Webhooks → Add endpoint):
   - URL: `https://YOUR_DOMAIN/api/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the **Signing secret** (`whsec_...`).
4. **Set these env vars** (Render dashboard or `.env`):
   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_STARTER_PRICE_ID=price_...
   STRIPE_GROWTH_PRICE_ID=price_...
   STRIPE_PRO_PRICE_ID=price_...
   APP_URL=https://YOUR_DOMAIN
   ```
5. Redeploy. The "Upgrade" buttons now open Stripe Checkout. Until these are set,
   the app runs in trial-only mode (no charges) and the upgrade page shows a
   friendly "payments not yet enabled" message.

> Test it first with `sk_test_...` keys and Stripe's test card `4242 4242 4242 4242`.

## 📊 Project Structure

```
├── server.js              # Express backend
├── package.json           # Dependencies
├── render.yaml            # Render deployment config
├── public/
│   ├── index.html         # Landing page
│   ├── dashboard.html     # Main dashboard
│   ├── signup.html        # Signup form
│   ├── starter.html       # GBP Starter (guided setup)
│   ├── optimize.html      # GBP Optimizer
│   ├── style.css          # Dashboard styles
│   ├── landing.css        # Landing styles
│   ├── signup.css         # Signup styles
│   ├── starter.css        # Starter styles
│   ├── starter.js         # Starter logic
│   ├── optimize.css       # Optimizer styles
│   └── optimize.js        # Optimizer logic
└── DEPLOY.md              # Detailed deployment guide
```

## 🎯 Roadmap

- [x] User authentication system
- [x] Database (SQLite via better-sqlite3)
- [ ] Multi-user teams
- [ ] Content calendar scheduling
- [ ] Analytics dashboard
- [ ] White-label option
- [ ] API for partners

## 📄 License

MIT

## 🆘 Support

Email: clujkeebs@aol.com  
Docs: See `DEPLOY.md` for deployment help
