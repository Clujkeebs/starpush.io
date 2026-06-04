# starpush.io by clujkeebs 📍

A B2B local SEO & review automation platform for service businesses. Automate Google reviews, generate AI replies, and optimize your Google Business Profile.

## 🚀 Features

### Review Automation
- Send SMS review requests to customers
- Generate professional AI replies powered by Claude
- Automatic activity feed tracking

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
| POST | `/api/gbp-starter` | ✓ | Build a GBP launch plan |
| POST | `/api/optimize` | — | Run GBP audit |
| POST | `/api/send-request` | ✓ | Send review request SMS |
| POST | `/api/webhook/review` | ✓ | Receive review webhook |
| GET | `/api/feed` | ✓ | Activity feed |
| GET | `/api/leads` | — | View all leads |
| GET | `/health` | — | Health check |

## 🔑 API Keys

**Anthropic**
- Get free trial: https://console.anthropic.com
- Keys limit: 5 requests/minute on free tier
- Model: claude-sonnet-4-6 (GBP Optimizer), claude-haiku-4-5 (replies)

**Twilio** (Optional)
- Get trial: https://console.twilio.com
- Phone number required for SMS

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
