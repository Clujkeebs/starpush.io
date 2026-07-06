require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const cookieParser = require('cookie-parser');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const db           = require('./db');
const mailer       = require('./mailer');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'starpush-dev-secret-change-in-production';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET must be set in production — anyone could forge login tokens with the default secret.');
  process.exit(1);
}

// ── Stripe setup ──────────────────────────────────────────────────────────────
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(cookieParser());
// Raw body for Stripe webhooks BEFORE json parser
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── App URL helper — uses APP_URL env unless it's a localhost/render URL ───────
function getAppUrl(req) {
  const configured = process.env.APP_URL || '';
  const isPlaceholder = !configured || configured.includes('localhost') || configured.includes('onrender.com');
  if (!isPlaceholder) return configured;
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}
function getUser(req) {
  try {
    const token = req.cookies.rp_token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET);
    return db.getUser(decoded.id);
  } catch { return null; }
}
function requireAuth(req, res, next) {
  const user = getUser(req);
  if (!user) {
    // API callers need JSON — a redirect would hand fetch() the login page HTML
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Your session has expired — please log in again.', login: '/login' });
    return res.redirect('/login?next=' + encodeURIComponent(req.path));
  }
  req.user = user;
  next();
}
function hasActiveAccess(user) {
  if (!user) return false;
  const trialEnd = new Date(user.trialEndsAt);
  if (user.subscriptionStatus === 'active') return true;
  // 'trialing' status only counts while the trial clock is still running
  return trialEnd > new Date();
}
function requireSubscription(req, res, next) {
  if (hasActiveAccess(req.user)) return next();
  return res.redirect('/upgrade?expired=1');
}
// API variant — returns JSON instead of redirecting, so fetch() callers get a
// clear error rather than silently following a redirect to an HTML page.
function requireActiveAPI(req, res, next) {
  if (hasActiveAccess(req.user)) return next();
  return res.status(402).json({ error: 'Your free trial has ended. Upgrade to keep sending review requests.', upgrade: '/upgrade' });
}

// ── Twilio SMS ────────────────────────────────────────────────────────────────
// Twilio requires E.164 (+15551234567). Tradespeople type local formats like
// (555) 123-4567 — accept those and normalize. Returns null if unusable.
function normalizePhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+') && digits.length >= 11 && digits.length <= 15) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

async function sendTwilioSMS(toNumber, messageBody) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) throw new Error('Twilio credentials not configured.');
  const url         = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: toNumber, From: fromNumber, Body: messageBody }).toString(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(friendlyTwilioError(data, response.status));
  return data;
}

// Twilio's raw errors are written for developers ("The number +1XXX is
// unverified. Trial accounts cannot..."). Translate the common ones into
// plain-English guidance a business owner can act on.
function friendlyTwilioError(data, httpStatus) {
  const code = data && data.code;
  if (code === 21608) return 'Texting is in test mode: the SMS account (Twilio) is still a free trial, which can only text pre-verified numbers. Fix: upgrade the Twilio account at twilio.com (add billing) — then texts will send to any number.';
  if (code === 21211) return 'That phone number isn\'t a valid mobile number. Double-check the digits and try again.';
  if (code === 21610) return 'This customer previously replied STOP and unsubscribed — Twilio blocks further texts to them.';
  if (code === 21614) return 'That number can\'t receive SMS (it may be a landline). Try a mobile number.';
  if (code === 20003) return 'SMS service authentication failed — the Twilio credentials on the server are wrong or expired.';
  if (code === 21606 || code === 21659) return 'The sending phone number isn\'t valid for this Twilio account — check TWILIO_PHONE_NUMBER on the server.';
  return (data && data.message) || `Twilio error HTTP ${httpStatus}`;
}

// ── Anthropic AI reply (SEO-Turbo) ───────────────────────────────────────────
async function generateAIReply(reviewText, service, city, rating) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Anthropic API key not configured.');
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const isNegative = Number(rating) <= 2;

  const system = isNegative
    ? `You are a reputation management expert for a local ${service || 'service'} business in ${city || 'our area'}. Write a professional, empathetic public reply to this negative review. Rules: (1) apologise sincerely without admitting legal fault, (2) invite the reviewer to contact you directly to make it right, (3) naturally include the service type and city once for local SEO. Keep it to 2-3 sentences. Never be defensive.`
    : `You are a local SEO specialist writing Google Business Profile review replies for a ${service || 'local service'} business in ${city || 'our area'}. Write a warm, genuine 2-3 sentence reply that: (1) thanks the customer, ideally by first name if mentioned, (2) works in the specific service (${service || 'our work'}) and city (${city || 'the local area'}) naturally — this boosts Google Maps ranking, (3) ends with a forward-looking sentence. Sound human. Never use "We appreciate your feedback" or robotic openers.`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 280,
    system,
    messages: [{ role: 'user', content: `Write a reply to this ${rating}-star Google review:\n\n"${reviewText}"` }],
  });
  return message.content[0].text;
}

// ── Friendly error converter for Anthropic/AI errors ─────────────────────────
function friendlyAIError(err) {
  const msg = err.message || '';
  // Our own guard for a totally missing key — check first so it isn't masked below.
  if (msg.includes('not configured'))
    return msg; // already friendly
  // A key was sent but rejected by Anthropic (wrong, expired, or revoked).
  if (msg.includes('authentication_error') || msg.includes('invalid x-api-key'))
    return 'AI key was rejected. Double-check your ANTHROPIC_API_KEY is correct and active.';
  if (msg.includes('rate_limit'))
    return 'AI service is busy right now — please try again in a moment.';
  if (msg.includes('overloaded'))
    return 'AI service is temporarily overloaded. Try again in 30 seconds.';
  return 'AI service returned an unexpected error. Please try again.';
}

// ── AI Growth Coach (Insights Agent) ─────────────────────────────────────────
// Helpers shared by the coach report and coach action execution: who's due a
// follow-up text and who was added but never texted.
function coachDueFollowups(userId) {
  const cutoff = Date.now() - 3 * 86400000;
  return db.getCustomers(userId).filter(c =>
    c.status === 'sent' && (c.smsCount || 0) < 2 && c.lastSmsAt && new Date(c.lastSmsAt).getTime() <= cutoff);
}
function coachPendingCustomers(userId) {
  return db.getCustomers(userId).filter(c => c.status === 'pending');
}

async function generateAIInsights({ user, feedData, customers, memory }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Anthropic API key not configured.');
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const reviews  = feedData.filter(f => f.type === 'review_received');
  const smsSent  = feedData.filter(f => f.type === 'sms_sent' && f.status === 'delivered');
  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : 0;

  const now = Date.now();
  const week1 = reviews.filter(r => now - new Date(r.timestamp) < 7  * 86400000).length;
  const week2 = reviews.filter(r => { const a = now - new Date(r.timestamp); return a >= 7*86400000 && a < 14*86400000; }).length;

  // The coach sees everything the app knows about this business — profile
  // setup state, the customer pipeline, and its own notes from past sessions.
  const dueFollowups     = coachDueFollowups(user.id);
  const pendingCustomers = coachPendingCustomers(user.id);
  const ctx = {
    businessName:     user.businessName || 'Your Business',
    ownerFirstName:   (user.name || '').split(' ')[0] || null,
    trade:            user.trade || 'local service',
    totalSMSSent:     smsSent.length,
    totalReviews:     reviews.length,
    avgRating,
    customerCount:    (customers || []).length,
    reviewsThisWeek:  week1,
    reviewsLastWeek:  week2,
    negativeReviews:  reviews.filter(r => r.rating <= 2).length,
    recentCities:     [...new Set([...reviews.slice(0,10), ...(customers || []).slice(0,15)].map(r=>r.city).filter(Boolean))].slice(0,3),
    recentServices:   [...new Set([...reviews.slice(0,10), ...(customers || []).slice(0,15)].map(r=>r.service).filter(Boolean))].slice(0,4),
    customersDueFollowup:   dueFollowups.length,
    customersNeverTexted:   pendingCustomers.length,
    hasGoogleReviewLink:    !!user.googleReviewLink,
    hasCustomSmsTemplate:   !!user.smsTemplate,
    previousCoachNotes:     memory || 'None yet — this is your first session with this business.',
  };

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 1800,
    system: `You are a brutally honest AI growth coach for local service businesses. You work with this business week after week: "previousCoachNotes" is what you learned about them in past sessions — build on it, don't start from scratch. Analyse this business data and return a personalised weekly growth report. Return ONLY valid JSON — no markdown, no code fences.

Required structure (follow exactly):
{
  "growthScore": <0-100 integer>,
  "scoreLabel": "<Needs Attention|Getting Traction|Growing|Thriving|Dominating>",
  "weeklyGoal": "<one specific, measurable goal for this week>",
  "insights": [
    {
      "type": "<win|opportunity|warning|tip>",
      "icon": "<single emoji>",
      "title": "<5-8 word title>",
      "body": "<2 sentences using their actual numbers>",
      "cta": "<specific action to take right now>",
      "action": <"send_followups"|"text_pending_customers"|null>
    }
  ],
  "projection": "<e.g. At this pace you'll reach 50 reviews by April>",
  "rankingTip": "<one hyper-specific Google Maps ranking tip for their exact trade and city>",
  "coachMessage": "<2-sentence direct, personal message to the business owner — use their first name if available>",
  "businessMemory": "<your UPDATED private notes about this business, max 500 chars: trade, market, momentum, habits, what worked, what to watch next session. Carry forward the useful parts of previousCoachNotes.>"
}

Rules: Always generate 3-5 insights. Use real numbers. Be specific not generic. If they have 0 reviews, focus on getting started. If low ratings, address that. Always include at least one 'win' if there's anything positive.
Action buttons: "action" makes the insight EXECUTABLE — the app sends real SMS when the owner clicks it. Set "send_followups" ONLY if customersDueFollowup > 0 (texts a review reminder to those customers). Set "text_pending_customers" ONLY if customersNeverTexted > 0 (sends the first review request to customers who were added but never texted). Use each action at most once; otherwise use null.`,
    messages: [{ role: 'user', content: JSON.stringify(ctx) }],
  });

  const raw   = message.content[0].text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI returned unexpected format.');
  return JSON.parse(match[0]);
}

// ── Review Shield: Recovery Script ───────────────────────────────────────────
async function generateRecoveryScript({ reviewText, reviewerName, service, city, rating }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Anthropic API key not configured.');
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 700,
    system: `You are a customer recovery expert for local trades businesses. Generate a tactical recovery plan for a negative Google review. Return ONLY valid JSON:
{
  "publicReply": "<empathetic 2-3 sentence public reply that naturally includes service + city for SEO>",
  "callScript": "<what to say when calling the customer — 3-4 conversational sentences, no jargon>",
  "resolutionOffer": "<a specific, generous offer to make it right — be concrete>",
  "recoveryChance": "<High (80%+)|Medium (50-80%)|Low (<50%)>",
  "recoveryTip": "<one pro tip for turning this reviewer into a loyal advocate>"
}`,
    messages: [{ role: 'user', content: `${rating}-star review from ${reviewerName || 'a customer'} for ${service || 'our service'} in ${city || 'our area'}:\n\n"${reviewText}"` }],
  });

  const raw   = message.content[0].text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI returned unexpected format.');
  return JSON.parse(match[0]);
}

// ── GBP Optimization ─────────────────────────────────────────────────────────
async function generateGBPOptimization({ businessName, category, city, services, currentDescription, website, gbpUrl }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Anthropic API key not configured.');
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const userMsg   = [`Google Business Profile URL: ${gbpUrl || 'Not provided'}`, `Business Name: ${businessName}`, `Trade / GBP Category: ${category}`, `City: ${city}`, `Services Offered: ${services || 'Not specified — infer the 6-10 most common services this trade offers in this market and base the report on those'}`, `Current GBP Description: ${currentDescription || 'None provided'}`, `Website: ${website || 'Not provided'}`].join('\n');
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 4096,
    system: `You are a Google Business Profile (GBP) optimization expert and local SEO specialist with 10+ years of experience helping local service businesses rank #1 on Google Maps.\n\nAnalyze the business and return a comprehensive, specific, actionable optimization report.\n\nRULES:\n- Be specific — use the actual city, trade name, and service names in every recommendation\n- Use real, exact GBP category names as Google lists them\n- Every Q&A answer must mention the city and service naturally for local SEO\n- Google Posts must be 80-100 words, conversational, keyword-rich\n- Score based on what they told you: no description = low description score, etc.\n- If services were not specified, infer the most common services for the trade and city and use them everywhere a service name is needed — do NOT lower any score just because services were inferred\n- Return ONLY valid JSON — no markdown, no code fences, no text outside the JSON\n\nRequired JSON structure (follow exactly):\n{\n  "score": { "overall": <0-100>, "description": <0-100>, "categories": <0-100>, "photos": <0-100>, "posts": <0-100>, "qanda": <0-100>, "verdict": "<2 sentences>" },\n  "optimizedDescription": "<250-300 char description>",\n  "descriptionKeywords": ["<kw>","<kw>","<kw>","<kw>","<kw>"],\n  "categories": { "primary": "<exact GBP category>", "additional": ["<cat>","<cat>","<cat>","<cat>"] },\n  "photoChecklist": [{"photo":"<desc>","priority":"Critical","why":"<why>"},{"photo":"<photo>","priority":"High","why":"<why>"},{"photo":"<photo>","priority":"High","why":"<why>"},{"photo":"<photo>","priority":"Medium","why":"<why>"},{"photo":"<photo>","priority":"Medium","why":"<why>"},{"photo":"<photo>","priority":"Medium","why":"<why>"}],\n  "qaTemplates": [{"question":"<q>","answer":"<a>"},{"question":"<q>","answer":"<a>"},{"question":"<q>","answer":"<a>"},{"question":"<q>","answer":"<a>"},{"question":"<q>","answer":"<a>"}],\n  "contentCalendar": [{"week":"Week 1","postType":"Offer","title":"<title>","body":"<80-100 word body>","cta":"<cta>"},{"week":"Week 2","postType":"Update","title":"<title>","body":"<body>","cta":"<cta>"},{"week":"Week 3","postType":"Tip","title":"<title>","body":"<body>","cta":"<cta>"},{"week":"Week 4","postType":"Highlight","title":"<title>","body":"<body>","cta":"<cta>"}],\n  "keywords": { "primary": ["<kw>","<kw>","<kw>"], "longTail": ["<kw>","<kw>","<kw>","<kw>"], "avoidTerms": ["<term>","<term>","<term>"], "replyTip": "<tip>" },\n  "completenessItems": [{"item":"<item>","priority":"Critical","howTo":"<howto>"},{"item":"<item>","priority":"High","howTo":"<howto>"},{"item":"<item>","priority":"High","howTo":"<howto>"},{"item":"<item>","priority":"High","howTo":"<howto>"},{"item":"<item>","priority":"Medium","howTo":"<howto>"},{"item":"<item>","priority":"Medium","howTo":"<howto>"},{"item":"<item>","priority":"Medium","howTo":"<howto>"}],\n  "quickWins": [{"action":"<action>","impact":"High","time":"5 min","why":"<why>"},{"action":"<action>","impact":"High","time":"<time>","why":"<why>"},{"action":"<action>","impact":"High","time":"<time>","why":"<why>"},{"action":"<action>","impact":"Medium","time":"<time>","why":"<why>"},{"action":"<action>","impact":"Medium","time":"<time>","why":"<why>"}]\n}`,
    messages: [{ role: 'user', content: userMsg }],
  });
  const raw   = message.content[0].text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI returned unexpected format. Please try again.');
  return JSON.parse(match[0]);
}

// ── GBP Starter (guided launch helper for brand-new profiles) ─────────────────
async function generateGBPStarter({ businessName, category, city, services, hasProfile, ownerName }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Anthropic API key not configured.');
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const userMsg   = [
    `Business Name: ${businessName}`,
    `Trade / GBP Category: ${category}`,
    `City: ${city}`,
    `Services Offered: ${services || 'Not specified'}`,
    `Already has a Google Business Profile: ${hasProfile ? 'Yes — needs help finishing setup' : 'No — starting from scratch'}`,
    `Owner First Name: ${ownerName || 'Not provided'}`,
  ].join('\n');

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 3500,
    system: `You are a Google Business Profile onboarding specialist. Your job is to walk a brand-new local service business through setting up their Google Business Profile (GBP) from zero, in plain, friendly, jargon-free language.

This is a STARTER program — assume the owner has never done this before. Be encouraging and concrete. Give them everything they need to copy-paste so they can finish setup in one sitting.

RULES:
- Use the actual business name, city, and trade in every recommendation.
- Use real, exact GBP category names as Google lists them.
- Steps must be ordered, beginner-friendly, and reference the real Google flow (create at business.google.com, verify by postcard/phone/video, etc.).
- The first Google Post body must be 80-100 words, warm and welcoming since they are brand new.
- Each Q&A answer must mention the city and a service naturally for local SEO.
- Return ONLY valid JSON — no markdown, no code fences, no text outside the JSON.

Required JSON structure (follow exactly):
{
  "intro": "<2 friendly sentences welcoming them by business name and city, setting expectations>",
  "estimatedTime": "<e.g. About 30 minutes>",
  "readiness": ["<thing to have ready before starting>","<thing>","<thing>"],
  "steps": [
    { "num": 1, "icon": "<single emoji>", "title": "<short step title>", "detail": "<2-4 sentence plain-language how-to>", "tip": "<one short pro tip>" }
  ],
  "assets": {
    "primaryCategory": "<exact GBP category>",
    "additionalCategories": ["<cat>","<cat>","<cat>"],
    "description": "<250-300 character copy-paste GBP description>",
    "services": ["<service>","<service>","<service>","<service>","<service>","<service>"],
    "firstPost": { "title": "<title>", "body": "<80-100 word welcome post>", "cta": "<call to action>" },
    "firstQA": [
      { "question": "<q>", "answer": "<a>" },
      { "question": "<q>", "answer": "<a>" },
      { "question": "<q>", "answer": "<a>" }
    ],
    "photoChecklist": [
      { "photo": "<photo to take>", "priority": "Critical", "why": "<why>" },
      { "photo": "<photo>", "priority": "High", "why": "<why>" },
      { "photo": "<photo>", "priority": "High", "why": "<why>" },
      { "photo": "<photo>", "priority": "Medium", "why": "<why>" },
      { "photo": "<photo>", "priority": "Medium", "why": "<why>" }
    ]
  },
  "launchChecklist": ["<concrete task>","<task>","<task>","<task>","<task>","<task>","<task>"]
}

Generate 6-8 steps covering at minimum: create the profile, verify it, set the primary category, add the description, list services, upload photos, publish a first post, and start collecting reviews.`,
    messages: [{ role: 'user', content: userMsg }],
  });
  const raw   = message.content[0].text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI returned unexpected format. Please try again.');
  return JSON.parse(match[0]);
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════════════════════

// POST /api/auth/signup
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, businessName, trade, phone, promoCode } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  if (db.getUserByEmail(email.toLowerCase().trim())) {
    return res.status(409).json({ error: 'An account with that email already exists. Please log in.' });
  }

  // Promo code 'dro' grants an owner-controlled complimentary free trial:
  // full access, framed as a normal trial, with the trial clock set far in the
  // future. The owner can end it at any time (see PROMO.md) by setting the
  // user's trialEndsAt to the past — that flips them to "free trial expired"
  // and gates features behind payment WITHOUT deleting any of their data.
  const hasPromo = (promoCode || '').trim().toLowerCase() === 'dro';
  const hash = await bcrypt.hash(password, 10);
  const standardTrialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const promoTrialEnd    = new Date('2099-12-31T23:59:59.000Z').toISOString();
  const user = db.createUser({
    id: 'u_' + Date.now(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash: hash,
    businessName: (businessName || '').trim(),
    trade: (trade || '').trim(),
    phone: (phone || '').trim(),
    plan: 'trial',
    trialEndsAt: hasPromo ? promoTrialEnd : standardTrialEnd,
    subscriptionStatus: 'trialing',
    promoCode: hasPromo ? 'dro' : null,
  });

  console.log(`[Signup] ${user.name} | ${user.email} | ${user.businessName}${hasPromo ? ' | promo:dro (complimentary trial)' : ''}`);
  mailer.sendWelcome(user.email, user.name).catch(() => {});

  const token = signToken(user);
  res.cookie('rp_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });

  // If Stripe configured, create checkout session (skip for complimentary promo users)
  if (!hasPromo && stripe && req.body.plan && req.body.plan !== 'trial') {
    const priceIds = {
      starter: process.env.STRIPE_STARTER_PRICE_ID,
      growth:  process.env.STRIPE_GROWTH_PRICE_ID,
      pro:     process.env.STRIPE_PRO_PRICE_ID,
    };
    const priceId = priceIds[req.body.plan];
    if (priceId) {
      try {
        const session = await stripe.checkout.sessions.create({
          mode: 'subscription',
          payment_method_types: ['card'],
          customer_email: user.email,
          line_items: [{ price: priceId, quantity: 1 }],
          subscription_data: { trial_period_days: 14 },
          success_url: `${getAppUrl(req)}/dashboard?welcome=1`,
          cancel_url:  `${getAppUrl(req)}/dashboard?welcome=1`,
          metadata: { userId: user.id, plan: req.body.plan },
        });
        return res.json({ success: true, stripeUrl: session.url });
      } catch (err) {
        console.error('[Stripe]', err.message);
      }
    }
  }

  res.json({ success: true, redirect: '/dashboard?welcome=1' });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const user = db.getUserByEmail(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'No account found with that email.' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Incorrect password.' });

  const token = signToken(user);
  res.cookie('rp_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  const next = req.body.next;
  const redirect = (next && /^\/[^/]/.test(next)) ? next : '/dashboard';
  res.json({ success: true, redirect });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('rp_token');
  res.json({ success: true, redirect: '/' });
});

// GET /api/auth/me
app.get('/api/auth/me', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { passwordHash, resetToken, resetExpires, ...safe } = user;
  res.json(safe);
});

// PATCH /api/auth/me — update profile
app.patch('/api/auth/me', requireAuth, (req, res) => {
  const fields = {};
  const { name, businessName, trade, phone, googleReviewLink, smsTemplate } = req.body;
  if (typeof name === 'string')              fields.name = name.trim();
  if (typeof businessName === 'string')      fields.businessName = businessName.trim();
  if (typeof trade === 'string')             fields.trade = trade.trim();
  if (typeof phone === 'string')             fields.phone = phone.trim();
  if (typeof googleReviewLink === 'string')  fields.googleReviewLink = googleReviewLink.trim();
  if (typeof smsTemplate === 'string')       fields.smsTemplate = smsTemplate.trim();
  const user = db.updateUser(req.user.id, fields);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { passwordHash, ...safe } = user;
  res.json({ success: true, user: safe });
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required.' });
  if (newPassword.length < 8)            return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const user = db.getUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });
  db.updateUser(req.user.id, { passwordHash: await bcrypt.hash(newPassword, 10) });
  res.json({ success: true });
});

// POST /api/auth/delete-account
app.post('/api/auth/delete-account', requireAuth, (req, res) => {
  db.deleteUser(req.user.id);
  res.clearCookie('rp_token');
  res.json({ success: true, redirect: '/' });
});

// POST /api/auth/forgot-password
app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const user = db.getUserByEmail(email.toLowerCase().trim());
  if (user) {
    const token = require('crypto').randomBytes(32).toString('hex');
    db.updateUser(user.id, { resetToken: token, resetExpires: String(Date.now() + 60 * 60 * 1000) });
    const url = `${getAppUrl(req)}/reset-password?token=${token}`;
    console.log(`[Password Reset] ${user.email} → ${url}`);
    mailer.sendPasswordReset(user.email, url).catch(() => {});
  }
  // Always respond success so we don't leak whether the email exists
  res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
});

// POST /api/auth/reset-password
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required.' });
  if (newPassword.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const user = db.getUserByResetToken(token);
  if (!user || Number(user.resetExpires) <= Date.now()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }
  db.updateUser(user.id, {
    passwordHash: await bcrypt.hash(newPassword, 10),
    resetToken: null,
    resetExpires: null,
  });
  res.json({ success: true, redirect: '/login' });
});

// ════════════════════════════════════════════════════════════════════════════
// STRIPE ROUTES
// ════════════════════════════════════════════════════════════════════════════

// POST /api/stripe/create-checkout
app.post('/api/stripe/create-checkout', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
  const { plan } = req.body;
  const priceIds = {
    starter: process.env.STRIPE_STARTER_PRICE_ID,
    growth:  process.env.STRIPE_GROWTH_PRICE_ID,
    pro:     process.env.STRIPE_PRO_PRICE_ID,
  };
  const priceId = priceIds[plan];
  if (!priceId) return res.status(400).json({ error: 'Invalid plan.' });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: req.user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      success_url: `${getAppUrl(req)}/dashboard?upgraded=1`,
      cancel_url:  `${getAppUrl(req)}/upgrade`,
      metadata: { userId: req.user.id, plan },
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stripe/webhook
app.post('/api/stripe/webhook', (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.sendStatus(200);
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe Webhook]', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.metadata?.userId) {
      const update = {
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
        subscriptionStatus: 'active',
      };
      if (session.metadata.plan) update.plan = session.metadata.plan;
      db.updateUser(session.metadata.userId, update);
    }
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const user = db.getUserByStripeCustomerId(sub.customer);
    if (user) {
      db.updateUser(user.id, { subscriptionStatus: sub.status });
    }
  }
  res.sendStatus(200);
});

// GET /api/stripe/portal
app.get('/api/stripe/portal', requireAuth, async (req, res) => {
  if (!stripe || !req.user.stripeCustomerId) return res.redirect('/upgrade');
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.stripeCustomerId,
      return_url: `${getAppUrl(req)}/dashboard`,
    });
    res.redirect(session.url);
  } catch (err) {
    res.redirect('/dashboard');
  }
});

// ════════════════════════════════════════════════════════════════════════════
// EXISTING API ROUTES
// ════════════════════════════════════════════════════════════════════════════

// POST /api/send-request
// ── Template builder (shared by send-request and send-bulk) ───────────────
// Texts arrive from an unrecognized number — leading with the business name is
// the difference between "oh, my plumber" and "spam, delete".
function buildSMSFromTemplate(tpl, name, service, link, customTemplate, businessName) {
  const biz = (businessName || '').trim();
  if (tpl === 'custom' && customTemplate) {
    const msg = customTemplate
      .replace(/\{name\}/gi, name)
      .replace(/\{service\}/gi, service)
      .replace(/\{business\}/gi, biz || 'our team')
      .replace(/\{reviewLink\}/gi, link)
      .replace(/\{link\}/gi, link);
    // A review request without the review link is a wasted text — if the
    // custom template forgot the {link} placeholder, tack the link on.
    return msg.includes(link) ? msg : `${msg} ${link}`;
  }
  if (tpl === 'brief')
    return `Hi ${name}! Quick favour — could you leave ${biz || 'us'} a Google review for your ${service}? ${link} Takes 30 secs, means the world 🙏`;
  if (tpl === 'personal')
    return `Hey ${name}! It was a pleasure working on your ${service} today. If you're happy with the work, an honest Google review would help ${biz ? `us at ${biz}` : 'us'} enormously: ${link} — thanks so much!`;
  return `Hi ${name}, thanks for choosing ${biz || 'us'} for your ${service}! Could you leave us a quick Google review? It only takes 30 seconds: ${link}`;
}

app.post('/api/send-request', requireAuth, requireActiveAPI, async (req, res) => {
  const { customerName, phone, service, city, reviewLink, template } = req.body;
  if (!customerName || !phone || !service) return res.status(400).json({ error: 'customerName, phone, and service are required.' });

  const normPhone = normalizePhone(phone);
  if (!normPhone) return res.status(400).json({ error: 'That phone number doesn\'t look right — please enter a 10-digit US number, e.g. (555) 123-4567.' });

  const link = (reviewLink || '').trim() || req.user.googleReviewLink || process.env.DEFAULT_REVIEW_LINK || 'https://g.page/r/your-review-link';
  const smsBody = buildSMSFromTemplate(template, customerName.trim(), service.trim(), link, req.user.smsTemplate, req.user.businessName);

  const custId = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  const entry = { type: 'sms_sent', customerName: customerName.trim(), phone: normPhone, service: service.trim(), city: (city || '').trim(), message: smsBody, status: 'pending', twilioSid: null, error: null, customerId: custId };

  let twilioOk = false;
  try {
    const result    = await sendTwilioSMS(normPhone, smsBody);
    entry.status    = 'delivered';
    entry.twilioSid = result.sid;
    twilioOk = true;
  } catch (err) {
    entry.status = 'failed';
    entry.error  = err.message;
    console.error('[Twilio]', err.message);
  }

  db.addFeedEntry({ userId: req.user.id, type: entry.type, ...entry });

  // Persist as a customer record for this user
  try {
    db.createCustomer({
      id: custId,
      userId: req.user.id,
      name: customerName.trim(),
      phone: normPhone,
      service: service.trim(),
      city: (city || '').trim(),
      status: twilioOk ? 'sent' : 'pending',
      lastSmsAt: twilioOk ? new Date().toISOString() : null,
      smsCount: twilioOk ? 1 : 0,
    });
  } catch (err) {
    console.error('[Customers] failed to persist customer:', err.message);
  }

  if (twilioOk) return res.json({ success: true, entry });
  return res.status(502).json({ error: entry.error, entry });
});

// ════════════════════════════════════════════════════════════════════════════
// BULK SEND API  — send review requests to multiple customers at once
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/send-bulk', requireAuth, requireActiveAPI, async (req, res) => {
  const { customers, service, city, reviewLink, template } = req.body;
  if (!Array.isArray(customers) || customers.length === 0)
    return res.status(400).json({ error: 'customers array is required.' });
  if (!service)
    return res.status(400).json({ error: 'service is required.' });

  const link = (reviewLink || '').trim() || req.user.googleReviewLink || process.env.DEFAULT_REVIEW_LINK || 'https://g.page/r/your-review-link';
  const results = [];

  for (const c of customers) {
    const name  = (c.name  || '').trim();
    const phone = normalizePhone(c.phone);
    if (!name || !c.phone) { results.push({ name, phone: c.phone, status: 'skipped', error: 'missing name or phone' }); continue; }
    if (!phone) { results.push({ name, phone: c.phone, status: 'skipped', error: 'invalid phone number' }); continue; }

    const smsBody = buildSMSFromTemplate(template, name, service.trim(), link, req.user.smsTemplate, req.user.businessName);
    const bulkCustId = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    let twilioOk = false, twilioSid = null, errorMsg = null;

    try {
      const r = await sendTwilioSMS(phone, smsBody);
      twilioOk = true; twilioSid = r.sid;
    } catch (err) {
      errorMsg = err.message;
    }

    db.addFeedEntry({ userId: req.user.id, type: 'sms_sent', customerName: name, phone, service: service.trim(), city: (city || '').trim(), message: smsBody, status: twilioOk ? 'delivered' : 'failed', twilioSid, error: errorMsg, customerId: bulkCustId });

    try {
      db.createCustomer({ id: bulkCustId, userId: req.user.id, name, phone, service: service.trim(), city: (city || '').trim(), status: twilioOk ? 'sent' : 'pending', lastSmsAt: twilioOk ? new Date().toISOString() : null, smsCount: twilioOk ? 1 : 0 });
    } catch (e) { console.error('[Bulk] customer save:', e.message); }

    results.push({ name, phone, status: twilioOk ? 'sent' : 'failed', error: errorMsg });
  }

  const sent = results.filter(r => r.status === 'sent').length;
  res.json({ success: true, sent, total: results.length, results });
});

// ════════════════════════════════════════════════════════════════════════════
// CLIENT UPLOAD + SCHEDULED SENDS
// Upload today's new clients in one go; review requests go out automatically
// at the chosen time (default: noon tomorrow, owner's local time — the client
// computes the timestamp so timezones just work).
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/customers/upload', requireAuth, requireActiveAPI, (req, res) => {
  const { customers, sendAt } = req.body;
  if (!Array.isArray(customers) || customers.length === 0)
    return res.status(400).json({ error: 'customers array is required.' });
  if (customers.length > 200)
    return res.status(400).json({ error: 'Maximum 200 customers per upload.' });

  // sendAt: ISO timestamp. Must parse, be in the future (small grace), and
  // within 30 days — protects against typos scheduling texts for next year.
  const when = new Date(sendAt);
  if (!sendAt || isNaN(when.getTime()))
    return res.status(400).json({ error: 'sendAt must be a valid date/time.' });
  if (when.getTime() < Date.now() - 60000)
    return res.status(400).json({ error: 'The send time is in the past — pick a future time.' });
  if (when.getTime() > Date.now() + 30 * 86400000)
    return res.status(400).json({ error: 'The send time is more than 30 days away — pick a closer date.' });

  // Never double-text: skip numbers already in this user's list
  const existingPhones = new Set(db.getCustomers(req.user.id).map(c => (c.phone || '').replace(/\D/g, '')));

  let added = 0;
  const skipped = [];
  for (const c of customers) {
    const name  = (c.name || '').trim();
    const rawPh = (c.phone || '').trim();
    if (!name || !rawPh) { skipped.push({ name: name || '(no name)', reason: 'missing name or phone' }); continue; }
    const normPhone = normalizePhone(rawPh);
    if (!normPhone) { skipped.push({ name, reason: `invalid phone "${rawPh}"` }); continue; }
    if (existingPhones.has(normPhone.replace(/\D/g, ''))) { skipped.push({ name, reason: 'already in your customer list' }); continue; }
    existingPhones.add(normPhone.replace(/\D/g, ''));

    db.createCustomer({
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      userId: req.user.id,
      name,
      phone: normPhone,
      service: (c.service || '').trim() || (req.user.trade || 'service'),
      city: (c.city || '').trim(),
      status: 'scheduled',
      sendAt: when.toISOString(),
      smsCount: 0,
    });
    added++;
  }

  console.log(`[Upload] ${req.user.email}: ${added} scheduled for ${when.toISOString()}, ${skipped.length} skipped`);
  res.json({ success: true, added, skipped, sendAt: when.toISOString() });
});

// Scheduled-send worker — every 2 minutes, send any due scheduled texts.
setInterval(async () => {
  try {
    const due = db.getScheduledDue();
    if (!due.length) return;
    let sentTotal = 0;
    for (const c of due.slice(0, 100)) {
      try {
        const user = db.getUser(c.userId);
        if (!user) continue;
        if (!hasActiveAccess(user)) continue; // access gating applies to scheduled sends too
        const normPhone = normalizePhone(c.phone);
        if (!normPhone) {
          db.updateCustomer(c.id, { status: 'pending', sendAt: null });
          console.warn(`[Scheduled Send] ${c.name}: invalid phone — moved to Not sent`);
          continue;
        }
        const link = user.googleReviewLink || process.env.DEFAULT_REVIEW_LINK || 'https://g.page/r/your-review-link';
        const body = buildSMSFromTemplate(user.smsTemplate ? 'custom' : 'standard', c.name, c.service, link, user.smsTemplate, user.businessName);
        await sendTwilioSMS(normPhone, body);
        db.updateCustomer(c.id, { status: 'sent', lastSmsAt: new Date().toISOString(), smsCount: (c.smsCount || 0) + 1, sendAt: null });
        db.addFeedEntry({ userId: c.userId, type: 'sms_sent', customerName: c.name, phone: normPhone, service: c.service, city: c.city || '', message: body, status: 'delivered', twilioSid: null, error: null, customerId: c.id });
        sentTotal++;
      } catch (err) {
        // Twilio failed — move to 'pending' (Not sent) so the owner can retry
        // manually instead of the worker hammering a broken send every 2 min.
        db.updateCustomer(c.id, { status: 'pending', sendAt: null });
        db.addFeedEntry({ userId: c.userId, type: 'sms_sent', customerName: c.name, phone: c.phone, service: c.service, city: c.city || '', message: '', status: 'failed', twilioSid: null, error: err.message, customerId: c.id });
        console.error('[Scheduled Send] failed for', c.name, '—', err.message);
      }
    }
    if (sentTotal) console.log(`[Scheduled Send] sent ${sentTotal} queued review request(s)`);
  } catch (err) { console.error('[Scheduled Send] worker error:', err.message); }
}, 2 * 60 * 1000);

// ════════════════════════════════════════════════════════════════════════════
// CUSTOMERS API
// ════════════════════════════════════════════════════════════════════════════

// POST /api/customers — add a new customer (auto-sends initial SMS)
app.post('/api/customers', requireAuth, requireActiveAPI, async (req, res) => {
  const { name, phone, service, city } = req.body;
  if (!name || !phone || !service) return res.status(400).json({ error: 'name, phone, and service are required.' });
  const normPhone = normalizePhone(phone);
  if (!normPhone) return res.status(400).json({ error: 'That phone number doesn\'t look right — please enter a 10-digit US number, e.g. (555) 123-4567.' });

  const custData = {
    id: 'c_' + Date.now(),
    userId: req.user.id,
    name: name.trim(),
    phone: normPhone,
    service: service.trim(),
    city: (city || '').trim(),
    status: 'pending',
    smsCount: 0,
  };

  // Attempt initial SMS — gracefully no-op if Twilio isn't configured
  const link    = req.user.googleReviewLink || process.env.DEFAULT_REVIEW_LINK || 'https://g.page/r/your-review-link';
  const smsBody = buildSMSFromTemplate('standard', custData.name, custData.service, link, null, req.user.businessName);
  try {
    await sendTwilioSMS(custData.phone, smsBody);
    custData.status    = 'sent';
    custData.lastSmsAt = new Date().toISOString();
    custData.smsCount  = 1;
  } catch (err) {
    console.warn('[Customers] initial SMS skipped:', err.message);
  }

  const customer = db.createCustomer(custData);
  res.json({ success: true, customer });
});

// GET /api/customers — list current user's customers
app.get('/api/customers', requireAuth, (req, res) => {
  const mine = db.getCustomers(req.user.id);
  res.json(mine);
});

// GET /api/customers/export — download customer list as CSV
app.get('/api/customers/export', requireAuth, (req, res) => {
  const mine = db.getCustomers(req.user.id);
  const escape = v => `"${String(v || '').replace(/"/g, '""')}"`;
  const headers = ['Name', 'Phone', 'Service', 'City', 'Status', 'Last SMS', 'Notes', 'Added'];
  const rows = mine.map(c => [
    escape(c.name),
    escape(c.phone),
    escape(c.service),
    escape(c.city || ''),
    escape(c.status),
    escape(c.lastSmsAt ? new Date(c.lastSmsAt).toLocaleDateString() : ''),
    escape(c.notes || ''),
    escape(c.addedAt ? new Date(c.addedAt).toLocaleDateString() : ''),
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\r\n');
  const filename = `starpush-customers-${new Date().toISOString().slice(0,10)}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// POST /api/customers/:id/send-followup
app.post('/api/customers/:id/send-followup', requireAuth, requireActiveAPI, async (req, res) => {
  let customer = db.getCustomer(req.params.id);
  if (!customer || customer.userId !== req.user.id) return res.status(404).json({ error: 'Customer not found.' });
  const normPhone = normalizePhone(customer.phone);
  if (!normPhone) return res.status(400).json({ error: 'This customer\'s phone number is invalid — edit it and try again.' });
  const link = req.user.googleReviewLink || process.env.DEFAULT_REVIEW_LINK || 'https://g.page/r/your-review-link';
  const biz  = (req.user.businessName || '').trim();
  const body = `Hi ${customer.name}, just a friendly reminder${biz ? ` from ${biz}` : ''} — we'd love a quick Google review for the ${customer.service} we did. Takes 30 seconds: ${link}. Thanks!`;
  try {
    await sendTwilioSMS(normPhone, body);
    customer = db.updateCustomer(customer.id, {
      lastSmsAt: new Date().toISOString(),
      smsCount: (customer.smsCount || 0) + 1,
      status: 'followup_sent',
    });
    res.json({ success: true, customer });
  } catch (err) {
    console.error('[Customer Followup]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// DELETE /api/customers/:id
app.delete('/api/customers/:id', requireAuth, (req, res) => {
  const customer = db.getCustomer(req.params.id);
  if (!customer || customer.userId !== req.user.id) return res.status(404).json({ error: 'Customer not found.' });
  db.deleteCustomer(req.params.id);
  res.json({ success: true });
});

// POST /api/customers/:id/mark-reviewed
app.post('/api/customers/:id/mark-reviewed', requireAuth, (req, res) => {
  let customer = db.getCustomer(req.params.id);
  if (!customer || customer.userId !== req.user.id) return res.status(404).json({ error: 'Customer not found.' });
  customer = db.updateCustomer(req.params.id, { status: 'reviewed' });
  res.json({ success: true, customer });
});

// POST /api/customers/:id/mark-declined
app.post('/api/customers/:id/mark-declined', requireAuth, (req, res) => {
  let customer = db.getCustomer(req.params.id);
  if (!customer || customer.userId !== req.user.id) return res.status(404).json({ error: 'Customer not found.' });
  customer = db.updateCustomer(req.params.id, { status: 'declined' });
  res.json({ success: true, customer });
});

// PATCH /api/customers/:id/notes — save job notes for a customer
app.patch('/api/customers/:id/notes', requireAuth, (req, res) => {
  const customer = db.getCustomer(req.params.id);
  if (!customer || customer.userId !== req.user.id) return res.status(404).json({ error: 'Customer not found.' });
  db.updateCustomer(req.params.id, { notes: req.body.notes || null });
  res.json({ success: true });
});

// GET /api/stats — real dashboard stats for current user
app.get('/api/stats', requireAuth, (req, res) => {
  const mine = db.getCustomers(req.user.id);
  const smsSent = mine.filter(c => c.status === 'sent' || c.status === 'followup_sent' || c.status === 'reviewed' || c.status === 'completed').length;
  const reviews = mine.filter(c => c.status === 'reviewed' || c.status === 'completed').length;
  const feed = db.getFeed(req.user.id);
  const reviewEntries = feed.filter(i => i.type === 'review_received');
  const avgRating = reviewEntries.length
    ? (reviewEntries.reduce((s, i) => s + (Number(i.rating) || 0), 0) / reviewEntries.length).toFixed(1)
    : null;
  const replies = reviewEntries.length;

  // Week-over-week deltas
  const now = Date.now();
  const W7  = 7 * 86400000;
  const W14 = 14 * 86400000;
  const reviewsThisWeek = reviewEntries.filter(r => now - new Date(r.timestamp) < W7).length;
  const reviewsLastWeek = reviewEntries.filter(r => { const a = now - new Date(r.timestamp); return a >= W7 && a < W14; }).length;
  const smsThisWeek = feed.filter(i => i.type === 'sms_sent' && now - new Date(i.timestamp) < W7).length;
  const smsLastWeek = feed.filter(i => i.type === 'sms_sent' && (() => { const a = now - new Date(i.timestamp); return a >= W7 && a < W14; })()).length;

  const conversionRate = smsSent > 0 ? Math.round((reviews / smsSent) * 100) : null;

  // Streak: count consecutive calendar days with at least one sms_sent
  const smsDays = new Set(
    feed.filter(i => i.type === 'sms_sent')
        .map(i => new Date(i.timestamp).toDateString())
  );
  let streak = 0;
  const today = new Date();
  for (let d = 0; d <= 365; d++) {
    const day = new Date(today);
    day.setDate(today.getDate() - d);
    if (smsDays.has(day.toDateString())) streak++;
    else if (d > 0) break;
  }

  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
  const smsThisMonth = feed.filter(i => i.type === 'sms_sent' && new Date(i.timestamp) >= startOfMonth).length;
  const planLimits = { trial: 150, starter: 150, growth: 600, pro: Infinity };
  const smsLimit = planLimits[req.user.plan] ?? 150;

  res.json({ smsSent, reviews, avgRating, replies, reviewsThisWeek, reviewsLastWeek, smsThisWeek, smsLastWeek, conversionRate, streak, smsThisMonth, smsLimit });
});

// POST /api/webhook/review
app.post('/api/webhook/review', requireAuth, requireActiveAPI, async (req, res) => {
  const { reviewText, reviewerName, service, city, rating } = req.body;
  if (!reviewText || !reviewText.trim()) return res.status(400).json({ error: 'reviewText is required.' });
  const numericRating = Math.min(5, Math.max(1, Number(rating) || 5));
  try {
    const aiReply = await generateAIReply(reviewText.trim(), (service || '').trim(), (city || '').trim(), numericRating);
    const entry = db.addFeedEntry({
      userId: req.user.id,
      type: 'review_received',
      reviewerName: (reviewerName || 'Anonymous').trim(),
      service: (service || 'General Service').trim(),
      city: (city || '').trim(),
      rating: numericRating,
      reviewText: reviewText.trim(),
      aiReply,
    });
    return res.json({ success: true, entry });
  } catch (err) {
    console.error('[AI Reply]', err.message);
    return res.status(502).json({ error: friendlyAIError(err) });
  }
});

// GET /api/feed
app.get('/api/feed', requireAuth, (req, res) => { res.json(db.getFeed(req.user.id)); });

// POST /api/insights — AI Growth Coach
app.post('/api/insights', requireAuth, requireActiveAPI, async (req, res) => {
  try {
    const feedData      = db.getFeed(req.user.id);
    const customers     = db.getCustomers(req.user.id);
    const memory        = db.getCoachMemory(req.user.id);
    const insights      = await generateAIInsights({ user: req.user, feedData, customers, memory });

    // Persist the coach's updated notes so next session builds on this one
    if (insights.businessMemory) {
      try { db.setCoachMemory(req.user.id, String(insights.businessMemory).slice(0, 2000)); } catch {}
    }

    // Compute weekly review + SMS counts (last 8 weeks) to power the chart
    const now = Date.now();
    const reviews = feedData.filter(f => f.type === 'review_received');
    const smsFeed = feedData.filter(f => f.type === 'sms_sent' && f.status === 'delivered');
    const weeklyReviews = Array.from({ length: 8 }, (_, i) => {
      const weekStart = now - (7 - i) * 7 * 86400000;
      const weekEnd   = weekStart + 7 * 86400000;
      const count = reviews.filter(r => {
        const t = new Date(r.timestamp).getTime();
        return t >= weekStart && t < weekEnd;
      }).length;
      const label = new Date(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return { label, count };
    });

    // Week-over-week snapshot (current + previous week)
    const thisWeekStart = now - 7 * 86400000;
    const lastWeekStart = now - 14 * 86400000;
    const weekSnapshot = {
      reviewsThisWeek: reviews.filter(r => new Date(r.timestamp).getTime() >= thisWeekStart).length,
      reviewsLastWeek: reviews.filter(r => { const t = new Date(r.timestamp).getTime(); return t >= lastWeekStart && t < thisWeekStart; }).length,
      smsThisWeek:     smsFeed.filter(r => new Date(r.timestamp).getTime() >= thisWeekStart).length,
      smsLastWeek:     smsFeed.filter(r => { const t = new Date(r.timestamp).getTime(); return t >= lastWeekStart && t < thisWeekStart; }).length,
    };

    // Counts for the executable action buttons ("Send 4 follow-ups now")
    const actionCounts = {
      send_followups:         coachDueFollowups(req.user.id).length,
      text_pending_customers: coachPendingCustomers(req.user.id).length,
    };

    return res.json({ success: true, insights, weeklyReviews, weekSnapshot, actionCounts });
  } catch (err) {
    console.error('[Insights]', err.message);
    const friendly = friendlyAIError(err);
    return res.status(502).json({ error: friendly });
  }
});

// POST /api/coach/execute — the Growth Coach actually does the task.
// Strict allowlist: each action maps to a concrete, bounded in-app operation.
app.post('/api/coach/execute', requireAuth, requireActiveAPI, async (req, res) => {
  const { action } = req.body;
  const CAP  = 25; // safety cap per click — no runaway blasts
  const link = req.user.googleReviewLink || process.env.DEFAULT_REVIEW_LINK || 'https://g.page/r/your-review-link';
  const biz  = (req.user.businessName || '').trim();

  if (action === 'send_followups') {
    const due = coachDueFollowups(req.user.id).slice(0, CAP);
    if (!due.length) return res.json({ success: true, sent: 0, failed: 0, message: 'No customers are due a follow-up right now.' });
    let sent = 0, failed = 0, lastError = null;
    for (const c of due) {
      const normPhone = normalizePhone(c.phone);
      if (!normPhone) { failed++; continue; }
      const body = `Hi ${c.name}, just a friendly reminder${biz ? ` from ${biz}` : ''} — we'd love a quick Google review for the ${c.service} we did. Takes 30 seconds: ${link}. Thanks!`;
      try {
        const r = await sendTwilioSMS(normPhone, body);
        db.updateCustomer(c.id, { lastSmsAt: new Date().toISOString(), smsCount: (c.smsCount || 0) + 1, status: 'followup_sent' });
        db.addFeedEntry({ userId: req.user.id, type: 'sms_sent', customerName: c.name, phone: normPhone, service: c.service, city: c.city || '', message: body, status: 'delivered', twilioSid: r.sid, error: null, customerId: c.id });
        sent++;
      } catch (err) { failed++; lastError = err.message; }
    }
    console.log(`[Coach] ${req.user.email} executed send_followups: ${sent} sent, ${failed} failed`);
    if (!sent && lastError) return res.status(502).json({ error: lastError });
    return res.json({ success: true, sent, failed, message: `Sent follow-ups to ${sent} customer${sent === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}.` });
  }

  if (action === 'text_pending_customers') {
    const pending = coachPendingCustomers(req.user.id).slice(0, CAP);
    if (!pending.length) return res.json({ success: true, sent: 0, failed: 0, message: 'No pending customers to text.' });
    let sent = 0, failed = 0, lastError = null;
    for (const c of pending) {
      const normPhone = normalizePhone(c.phone);
      if (!normPhone) { failed++; continue; }
      const body = buildSMSFromTemplate(req.user.smsTemplate ? 'custom' : 'standard', c.name, c.service, link, req.user.smsTemplate, biz);
      try {
        const r = await sendTwilioSMS(normPhone, body);
        db.updateCustomer(c.id, { lastSmsAt: new Date().toISOString(), smsCount: (c.smsCount || 0) + 1, status: 'sent' });
        db.addFeedEntry({ userId: req.user.id, type: 'sms_sent', customerName: c.name, phone: normPhone, service: c.service, city: c.city || '', message: body, status: 'delivered', twilioSid: r.sid, error: null, customerId: c.id });
        sent++;
      } catch (err) { failed++; lastError = err.message; }
    }
    console.log(`[Coach] ${req.user.email} executed text_pending_customers: ${sent} sent, ${failed} failed`);
    if (!sent && lastError) return res.status(502).json({ error: lastError });
    return res.json({ success: true, sent, failed, message: `Sent review requests to ${sent} customer${sent === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}.` });
  }

  return res.status(400).json({ error: 'Unknown coach action.' });
});

// POST /api/recovery-script — Review Shield recovery plan
app.post('/api/recovery-script', requireAuth, requireActiveAPI, async (req, res) => {
  const { reviewText, reviewerName, service, city, rating } = req.body;
  if (!reviewText) return res.status(400).json({ error: 'reviewText is required.' });
  try {
    const script = await generateRecoveryScript({ reviewText, reviewerName, service, city, rating });
    return res.json({ success: true, script });
  } catch (err) {
    console.error('[RecoveryScript]', err.message);
    const friendly = friendlyAIError(err);
    return res.status(502).json({ error: friendly });
  }
});

// POST /api/generate-posts — AI Google Business Profile post generator
app.post('/api/generate-posts', requireAuth, requireActiveAPI, async (req, res) => {
  const { trade, city } = req.body;
  if (!trade || !city) return res.status(400).json({ error: 'trade and city are required.' });

  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('Anthropic API key not configured.');
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: `You are a local SEO expert helping a ${trade} business in ${city} write Google Business Profile posts to rank higher on Google Maps.

Write exactly 3 short Google Business Profile posts. Each should be:
- 60-100 words
- Conversational and professional
- Include the city name (${city}) and service type (${trade}) naturally for local SEO
- Include a soft call to action (e.g. "Call us today", "Book online", "Get a free quote")
- Sound like a real local business owner, not robotic marketing copy
- Different themes: one about a recent job/win, one about a tip/advice, one about availability/promotion

Format your response as JSON array like this:
[{"title":"Post title","body":"Full post text...","emoji":"🔧"},{"title":"...","body":"...","emoji":"..."},{"title":"...","body":"...","emoji":"..."}]

Only output the JSON array, no other text.`,
      }],
    });

    const raw = msg.content[0]?.text?.trim() || '[]';
    let posts;
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      posts = JSON.parse(match ? match[0] : raw);
    } catch { posts = []; }
    if (!Array.isArray(posts) || posts.length === 0)
      return res.status(502).json({ error: 'Could not generate posts right now — please try again.' });
    res.json({ success: true, posts });
  } catch (err) {
    console.error('[GeneratePosts]', err.message);
    res.status(502).json({ error: friendlyAIError(err) });
  }
});

// GET /api/leads (admin — requires ADMIN_KEY header)
app.get('/api/leads', (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey || req.headers['x-admin-key'] !== adminKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const allUsers = db.getAllUsers();
  const safe = allUsers.map(({ passwordHash, resetToken, resetExpires, ...u }) => u);
  res.json({ count: safe.length, leads: safe });
});

// GET /api/audit-leads (admin — requires ADMIN_KEY header)
app.get('/api/audit-leads', (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey || req.headers['x-admin-key'] !== adminKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const leads = db.getAuditLeads();
  res.json({ count: leads.length, leads });
});

// POST /api/demo-reply (public — landing page Try It Live)
const _demoRateMap = new Map();
app.post('/api/demo-reply', async (req, res) => {
  const minute = Math.floor(Date.now() / 60000);
  const count  = _demoRateMap.get(minute) || 0;
  if (count >= 50) return res.status(429).json({ error: 'Too many requests — please try again in a moment.' });
  _demoRateMap.set(minute, count + 1);
  for (const [k] of _demoRateMap) if (k < minute - 2) _demoRateMap.delete(k);

  const { trade, city, reviewText, rating } = req.body;
  if (!trade || !city || !reviewText) return res.status(400).json({ error: 'Trade, city, and reviewText are required.' });
  if (reviewText.length > 600) return res.status(400).json({ error: 'Review text too long.' });

  try {
    const reply = await generateAIReply(reviewText.trim(), trade, city, rating || 5);
    res.json({ reply });
  } catch (err) {
    console.error('[DemoReply]', err.message);
    res.status(502).json({ error: 'AI service is temporarily unavailable — please try again in a moment.' });
  }
});

// Light per-IP rate limit for the public optimizer — it calls the Anthropic
// API on your dime, so bots hammering it would cost real money.
const optimizeHits = new Map(); // ip -> [timestamps]
function optimizeRateLimit(req, res, next) {
  if (getUser(req)) return next(); // signed-in users aren't limited
  const ip  = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
  const now = Date.now();
  const hits = (optimizeHits.get(ip) || []).filter(t => now - t < 60 * 60 * 1000);
  if (hits.length >= 5) return res.status(429).json({ error: 'You\'ve reached the free audit limit for now — create a free account for unlimited audits.' });
  hits.push(now);
  optimizeHits.set(ip, hits);
  if (optimizeHits.size > 5000) optimizeHits.clear(); // crude memory guard
  next();
}

// POST /api/optimize
app.post('/api/optimize', optimizeRateLimit, async (req, res) => {
  const { businessName, category, city, services, currentDescription, website, email, gbpUrl } = req.body;
  // Services are optional — the AI infers the typical service list for the
  // trade when the owner doesn't spell it out.
  if (!businessName || !category || !city) return res.status(400).json({ error: 'businessName, category, and city are required.' });

  // Track lead if email provided (from free ranking calculator)
  if (email && email.includes('@')) {
    try {
      db.addAuditLead({ email, businessName, category, city, services, website, gbpUrl });
      console.log(`[Lead] Captured: ${email} — ${businessName} in ${city}`);
    } catch (e) { console.error('[Lead] save failed:', e.message); }
  }

  try {
    const analysis = await generateGBPOptimization({ businessName, category, city, services, currentDescription, website, gbpUrl });
    console.log(`[GBP Optimize] ${businessName} in ${city} — score ${analysis.score?.overall}`);
    return res.json({ success: true, analysis });
  } catch (err) {
    console.error('[GBP Optimize]', err.message);
    return res.status(502).json({ error: friendlyAIError(err) });
  }
});

// POST /api/gbp-starter — guided launch plan for new/unfinished profiles
app.post('/api/gbp-starter', requireAuth, requireActiveAPI, async (req, res) => {
  const { businessName, category, city, services, hasProfile } = req.body;
  if (!businessName || !category || !city) {
    return res.status(400).json({ error: 'businessName, category, and city are required.' });
  }
  try {
    const plan = await generateGBPStarter({
      businessName, category, city, services,
      hasProfile: !!hasProfile,
      ownerName: (req.user.name || '').split(' ')[0],
    });
    console.log(`[GBP Starter] ${businessName} in ${city} — ${plan.steps?.length || 0} steps`);
    return res.json({ success: true, plan });
  } catch (err) {
    console.error('[GBP Starter]', err.message);
    return res.status(502).json({ error: friendlyAIError(err) });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PAGE ROUTES
// ════════════════════════════════════════════════════════════════════════════

app.get('/',                    (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// Already-signed-in users go straight to the dashboard instead of a login form
app.get('/login',               (req, res) => getUser(req) ? res.redirect('/dashboard') : res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/signup',              (req, res) => getUser(req) ? res.redirect('/dashboard') : res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/pricing',             (_req, res) => res.redirect('/#pricing'));
app.get('/upgrade',             requireAuth, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'upgrade.html')));
app.get('/ranking-calculator',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'ranking-calculator.html')));
app.get('/dashboard',           requireAuth, requireSubscription, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/optimize',            requireAuth, requireSubscription, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'optimize.html')));
app.get('/starter',             requireAuth, requireSubscription, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'starter.html')));
app.get('/account',             requireAuth, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'account.html')));
app.get('/insights',            requireAuth, requireSubscription, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'insights.html')));
app.get('/reset-password',      (_req, res) => res.sendFile(path.join(__dirname, 'public', 'reset-password.html')));
app.get('/terms',               (_req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/privacy',             (_req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/health',              (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── 404 catch-all ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Page Not Found — Starpush</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"/><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',system-ui,sans-serif;background:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.wrap{text-align:center;max-width:440px}.ico{font-size:64px;margin-bottom:16px}h1{font-size:28px;font-weight:800;color:#0f2340;margin-bottom:8px}p{font-size:15px;color:#6b7280;line-height:1.6;margin-bottom:24px}a{display:inline-block;padding:12px 28px;background:#0f2340;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;transition:background .15s}a:hover{background:#163352}</style></head><body><div class="wrap"><div class="ico">🚀</div><h1>Page not found</h1><p>The page you're looking for doesn't exist or has been moved. Let's get you back on track.</p><a href="/">← Back to Starpush</a></div></body></html>`);
});

// ── Keep-alive ping (prevents Render free-tier cold starts) ──────────────────
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    fetch(`http://localhost:${PORT}/health`).catch(() => {});
  }, 10 * 60 * 1000); // every 10 minutes
}

// ── Automated follow-up scheduler ─────────────────────────────────────────────
// Every 5 minutes: send a single follow-up SMS to customers who got the initial
// SMS at least 3 days ago and haven't reviewed yet (max 2 total SMS per customer).
setInterval(async () => {
  try {
    const due = db.getFollowUpDue();
    for (const c of due) {
      try {
        const user = db.getUser(c.userId);
        if (!user) continue;
        // Don't keep texting on behalf of accounts whose trial/subscription
        // has ended — access gating applies to automation too.
        if (!hasActiveAccess(user)) continue;
        const normPhone = normalizePhone(c.phone);
        if (!normPhone) { console.warn(`[Auto-Followup] skipping ${c.name}: invalid phone`); continue; }
        const reviewLink = user.googleReviewLink || process.env.DEFAULT_REVIEW_LINK || 'https://g.page/r/your-link';
        const biz = (user.businessName || '').trim();
        const body = `Hi ${c.name}, just a friendly reminder${biz ? ` from ${biz}` : ''} — we'd love a quick Google review for the ${c.service} we did. Takes 30 seconds: ${reviewLink}. Thanks!`;
        db.updateCustomer(c.id, {
          lastSmsAt: new Date().toISOString(),
          smsCount: (c.smsCount || 1) + 1,
          status: 'followup_sent',
        });
        await sendTwilioSMS(normPhone, body);
        console.log(`[Auto-Followup] sent to ${c.name} (${c.phone})`);
      } catch (err) { console.error('[Auto-Followup] customer error:', err.message); }
    }
  } catch (err) { console.error('[Auto-Followup] scheduler error:', err.message); }
}, 5 * 60 * 1000);

// ── Trial reminder emails (runs every 6 hours) ───────────────────────────────
// Sends a reminder at exactly 7 days left and 1 day left.
// Uses a 6-hour window so restarts don't cause duplicates.
setInterval(async () => {
  try {
    const users = db.getAllUsers();
    const now = Date.now();
    for (const u of users) {
      if (u.subscriptionStatus === 'active' || u.plan !== 'trial') continue;
      const msLeft = new Date(u.trialEndsAt).getTime() - now;
      if (msLeft <= 0) continue;
      const hoursLeft = msLeft / (60 * 60 * 1000);
      // Fire the 7-day reminder in the window 7d to 7d+6h after trial start
      const is7Day = hoursLeft > 6 * 24 && hoursLeft <= 7 * 24;
      // Fire the 1-day reminder in the window 0d+6h to 1d
      const is1Day = hoursLeft > 6 && hoursLeft <= 24;
      if (is7Day) {
        mailer.sendTrialReminder(u.email, u.name, 7).catch(() => {});
        console.log(`[Trial Reminder] 7d reminder → ${u.email}`);
      } else if (is1Day) {
        mailer.sendTrialReminder(u.email, u.name, 1).catch(() => {});
        console.log(`[Trial Reminder] 1d reminder → ${u.email}`);
      }
    }
  } catch (err) { console.error('[Trial Reminder] scheduler error:', err.message); }
}, 6 * 60 * 60 * 1000);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  🚀 Starpush running → http://localhost:${PORT}\n`);
  if (!process.env.TWILIO_ACCOUNT_SID) console.log('  ⚠  Twilio credentials not set — SMS will fail gracefully.');
  if (!process.env.ANTHROPIC_API_KEY)  console.log('  ⚠  Anthropic API key not set — AI features will fail gracefully.');
  if (!process.env.STRIPE_SECRET_KEY)  console.log('  ⚠  Stripe not configured — payments disabled (trial access only).');
  console.log();
});
