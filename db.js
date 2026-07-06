'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

// ── Ensure data directory exists ─────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'starpush.db');
const sqlite  = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// ── Schema ───────────────────────────────────────────────────────────────────

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    email                 TEXT UNIQUE NOT NULL,
    password_hash         TEXT NOT NULL,
    business_name         TEXT,
    trade                 TEXT,
    phone                 TEXT,
    plan                  TEXT DEFAULT 'trial',
    trial_ends_at         TEXT,
    subscription_status   TEXT DEFAULT 'trialing',
    stripe_customer_id    TEXT,
    stripe_subscription_id TEXT,
    reset_token           TEXT,
    reset_expires         TEXT,
    created_at            TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL,
    service     TEXT NOT NULL,
    city        TEXT,
    added_at    TEXT DEFAULT (datetime('now')),
    status      TEXT DEFAULT 'pending',
    last_sms_at TEXT,
    followup_at TEXT,
    sms_count   INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS activity_feed (
    id        INTEGER PRIMARY KEY,
    user_id   TEXT,
    type      TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now')),
    data      TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_leads (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT,
    business_name TEXT,
    category      TEXT,
    city          TEXT,
    services      TEXT,
    website       TEXT,
    gbp_url       TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );
`);

// ── Schema migrations (add columns if upgrading from older version) ─────────
try { sqlite.exec('ALTER TABLE users ADD COLUMN reset_token TEXT'); } catch {}
try { sqlite.exec('ALTER TABLE users ADD COLUMN reset_expires TEXT'); } catch {}
try { sqlite.exec('ALTER TABLE users ADD COLUMN google_review_link TEXT'); } catch {}
try { sqlite.exec('ALTER TABLE users ADD COLUMN sms_template TEXT'); } catch {}
try { sqlite.exec('ALTER TABLE users ADD COLUMN promo_code TEXT'); } catch {}
try { sqlite.exec('ALTER TABLE customers ADD COLUMN notes TEXT'); } catch {}

// ── Indexes ──────────────────────────────────────────────────────────────────

sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_email             ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_stripe_customer   ON users(stripe_customer_id);
  CREATE INDEX IF NOT EXISTS idx_users_stripe_sub        ON users(stripe_subscription_id);
  CREATE INDEX IF NOT EXISTS idx_customers_user_id       ON customers(user_id);
  CREATE INDEX IF NOT EXISTS idx_activity_user_ts        ON activity_feed(user_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_leads_email       ON audit_leads(email);
`);

// ── Case conversion helpers ──────────────────────────────────────────────────

const SNAKE_TO_CAMEL = {
  password_hash:          'passwordHash',
  business_name:          'businessName',
  trial_ends_at:          'trialEndsAt',
  subscription_status:    'subscriptionStatus',
  stripe_customer_id:     'stripeCustomerId',
  stripe_subscription_id: 'stripeSubscriptionId',
  reset_token:            'resetToken',
  reset_expires:          'resetExpires',
  google_review_link:     'googleReviewLink',
  sms_template:           'smsTemplate',
  promo_code:             'promoCode',
  created_at:             'createdAt',
  user_id:                'userId',
  added_at:               'addedAt',
  last_sms_at:            'lastSmsAt',
  followup_at:            'followUpAt',
  sms_count:              'smsCount',
  gbp_url:                'gbpUrl',
};

const CAMEL_TO_SNAKE = {};
for (const [snake, camel] of Object.entries(SNAKE_TO_CAMEL)) {
  CAMEL_TO_SNAKE[camel] = snake;
}

function rowToCamel(row) {
  if (!row) return null;
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    const camelKey = SNAKE_TO_CAMEL[key] || key;
    out[camelKey] = val;
  }
  return out;
}

function camelToSnake(key) {
  return CAMEL_TO_SNAKE[key] || key;
}

// ── Prepared statements ──────────────────────────────────────────────────────

const stmts = {
  // Users
  getUserById:         sqlite.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByEmail:      sqlite.prepare('SELECT * FROM users WHERE email = ?'),
  getUserByResetToken:       sqlite.prepare('SELECT * FROM users WHERE reset_token = ?'),
  getUserByStripeCustomerId: sqlite.prepare('SELECT * FROM users WHERE stripe_customer_id = ?'),
  getAllUsers:     sqlite.prepare('SELECT * FROM users ORDER BY created_at DESC'),
  insertUser:     sqlite.prepare(`
    INSERT INTO users (id, name, email, password_hash, business_name, trade, phone,
                       plan, trial_ends_at, subscription_status,
                       stripe_customer_id, stripe_subscription_id,
                       reset_token, reset_expires, promo_code, created_at)
    VALUES (@id, @name, @email, @password_hash, @business_name, @trade, @phone,
            @plan, @trial_ends_at, @subscription_status,
            @stripe_customer_id, @stripe_subscription_id,
            @reset_token, @reset_expires, @promo_code, @created_at)
  `),
  deleteUser: sqlite.prepare('DELETE FROM users WHERE id = ?'),

  // Customers
  getCustomersByUser: sqlite.prepare('SELECT * FROM customers WHERE user_id = ? ORDER BY added_at DESC'),
  getCustomerById:    sqlite.prepare('SELECT * FROM customers WHERE id = ?'),
  insertCustomer:     sqlite.prepare(`
    INSERT INTO customers (id, user_id, name, phone, service, city,
                           added_at, status, last_sms_at, followup_at, sms_count)
    VALUES (@id, @user_id, @name, @phone, @service, @city,
            @added_at, @status, @last_sms_at, @followup_at, @sms_count)
  `),
  deleteCustomer:       sqlite.prepare('DELETE FROM customers WHERE id = ?'),
  deleteCustomersByUser: sqlite.prepare('DELETE FROM customers WHERE user_id = ?'),
  getFollowUpDue:       sqlite.prepare(`
    SELECT * FROM customers
    WHERE status = 'sent'
      AND sms_count < 2
      AND last_sms_at IS NOT NULL
      AND datetime(last_sms_at) <= datetime('now', '-3 days')
  `),

  // Activity feed
  insertFeed:  sqlite.prepare(`
    INSERT INTO activity_feed (user_id, type, timestamp, data)
    VALUES (@user_id, @type, @timestamp, @data)
  `),
  getFeedByUser: sqlite.prepare('SELECT * FROM activity_feed WHERE user_id = ? ORDER BY timestamp DESC'),
  getFeedAll:    sqlite.prepare('SELECT * FROM activity_feed ORDER BY timestamp DESC'),
  clearFeed:     sqlite.prepare('DELETE FROM activity_feed'),

  // Audit leads
  insertAuditLead: sqlite.prepare(`
    INSERT INTO audit_leads (email, business_name, category, city, services, website, gbp_url, created_at)
    VALUES (@email, @business_name, @category, @city, @services, @website, @gbp_url, @created_at)
  `),
  getAuditLeads: sqlite.prepare('SELECT * FROM audit_leads ORDER BY created_at DESC'),
};

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTED API
// ══════════════════════════════════════════════════════════════════════════════

const db = {};

// ── Users ────────────────────────────────────────────────────────────────────

db.getUser = function getUser(id) {
  return rowToCamel(stmts.getUserById.get(id));
};

db.getUserByEmail = function getUserByEmail(email) {
  return rowToCamel(stmts.getUserByEmail.get(email));
};

db.getUserByResetToken = function getUserByResetToken(token) {
  return rowToCamel(stmts.getUserByResetToken.get(token));
};

db.getUserByStripeCustomerId = function getUserByStripeCustomerId(customerId) {
  return rowToCamel(stmts.getUserByStripeCustomerId.get(customerId));
};

db.createUser = function createUser(data) {
  const params = {
    id:                      data.id,
    name:                    data.name,
    email:                   data.email,
    password_hash:           data.passwordHash,
    business_name:           data.businessName  || null,
    trade:                   data.trade         || null,
    phone:                   data.phone         || null,
    plan:                    data.plan          || 'trial',
    trial_ends_at:           data.trialEndsAt   || null,
    subscription_status:     data.subscriptionStatus || 'trialing',
    stripe_customer_id:      data.stripeCustomerId   || null,
    stripe_subscription_id:  data.stripeSubscriptionId || null,
    reset_token:             data.resetToken    || null,
    reset_expires:           data.resetExpires  || null,
    promo_code:              data.promoCode     || null,
    created_at:              data.createdAt     || new Date().toISOString(),
  };
  stmts.insertUser.run(params);
  return db.getUser(params.id);
};

db.updateUser = function updateUser(id, fields) {
  const sets = [];
  const values = {};
  for (const [key, val] of Object.entries(fields)) {
    const col = camelToSnake(key);
    sets.push(`${col} = @${col}`);
    values[col] = val;
  }
  if (sets.length === 0) return db.getUser(id);
  values.id = id;
  sqlite.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run(values);
  return db.getUser(id);
};

db.deleteUser = function deleteUser(id) {
  stmts.deleteCustomersByUser.run(id);
  stmts.deleteUser.run(id);
};

db.getAllUsers = function getAllUsers() {
  return stmts.getAllUsers.all().map(rowToCamel);
};

// ── Customers ────────────────────────────────────────────────────────────────

db.getCustomers = function getCustomers(userId) {
  return stmts.getCustomersByUser.all(userId).map(rowToCamel);
};

db.getCustomer = function getCustomer(id) {
  return rowToCamel(stmts.getCustomerById.get(id));
};

db.createCustomer = function createCustomer(data) {
  const params = {
    id:          data.id,
    user_id:     data.userId,
    name:        data.name,
    phone:       data.phone,
    service:     data.service,
    city:        data.city       || null,
    added_at:    data.addedAt    || new Date().toISOString(),
    status:      data.status     || 'pending',
    last_sms_at: data.lastSmsAt  || null,
    followup_at: data.followUpAt || null,
    sms_count:   data.smsCount   || 0,
  };
  stmts.insertCustomer.run(params);
  return db.getCustomer(params.id);
};

db.updateCustomer = function updateCustomer(id, fields) {
  const sets = [];
  const values = {};
  for (const [key, val] of Object.entries(fields)) {
    const col = camelToSnake(key);
    sets.push(`${col} = @${col}`);
    values[col] = val;
  }
  if (sets.length === 0) return db.getCustomer(id);
  values.id = id;
  sqlite.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = @id`).run(values);
  return db.getCustomer(id);
};

db.deleteCustomer = function deleteCustomer(id) {
  stmts.deleteCustomer.run(id);
};

db.getFollowUpDue = function getFollowUpDue() {
  return stmts.getFollowUpDue.all().map(rowToCamel);
};

// ── Activity Feed ────────────────────────────────────────────────────────────

db.addFeedEntry = function addFeedEntry(entry) {
  const userId = entry.userId || entry.user_id || null;
  const type   = entry.type;
  const ts     = entry.timestamp || new Date().toISOString();

  // Everything except userId, type, and timestamp goes into the JSON data blob
  const rest = Object.assign({}, entry);
  delete rest.userId;
  delete rest.user_id;
  delete rest.type;
  delete rest.timestamp;

  const params = {
    user_id:   userId,
    type:      type,
    timestamp: ts,
    data:      JSON.stringify(rest),
  };
  const info = stmts.insertFeed.run(params);
  return Object.assign({ id: Number(info.lastInsertRowid) }, entry, { timestamp: ts });
};

db.getFeed = function getFeed(userId) {
  const rows = userId ? stmts.getFeedByUser.all(userId) : stmts.getFeedAll.all();
  return rows.map(function (row) {
    const base = {
      id:        row.id,
      userId:    row.user_id,
      type:      row.type,
      timestamp: row.timestamp,
    };
    if (row.data) {
      try { Object.assign(base, JSON.parse(row.data)); }
      catch { /* ignore malformed JSON */ }
    }
    return base;
  });
};

db.clearFeed = function clearFeed() {
  stmts.clearFeed.run();
};

// ── Audit Leads ──────────────────────────────────────────────────────────────

db.addAuditLead = function addAuditLead(data) {
  const params = {
    email:         data.email         || null,
    business_name: data.businessName  || null,
    category:      data.category      || null,
    city:          data.city          || null,
    services:      data.services      || null,
    website:       data.website       || null,
    gbp_url:       data.gbpUrl        || null,
    created_at:    data.createdAt || data.ts || new Date().toISOString(),
  };
  const info = stmts.insertAuditLead.run(params);
  return Object.assign({ id: Number(info.lastInsertRowid) }, rowToCamel(
    sqlite.prepare('SELECT * FROM audit_leads WHERE id = ?').get(Number(info.lastInsertRowid))
  ));
};

db.getAuditLeads = function getAuditLeads() {
  return stmts.getAuditLeads.all().map(rowToCamel);
};

// ══════════════════════════════════════════════════════════════════════════════
// JSON MIGRATION
// ══════════════════════════════════════════════════════════════════════════════

db.migrateFromJSON = function migrateFromJSON() {
  const USERS_FILE      = path.join(DATA_DIR, 'users.json');
  const CUSTOMERS_FILE  = path.join(DATA_DIR, 'customers.json');
  const AUDIT_FILE      = path.join(DATA_DIR, 'audit-leads.json');

  // Only migrate if at least one JSON file exists
  const hasUsers     = fs.existsSync(USERS_FILE);
  const hasCustomers = fs.existsSync(CUSTOMERS_FILE);
  const hasAudit     = fs.existsSync(AUDIT_FILE);

  if (!hasUsers && !hasCustomers && !hasAudit) return;

  console.log('[db] Starting JSON → SQLite migration...');

  const migrate = sqlite.transaction(function () {
    // ── Users ──────────────────────────────────────────────────────────────
    if (hasUsers) {
      try {
        const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        let count = 0;
        for (const u of users) {
          // Skip if user already exists (idempotent migration)
          const existing = stmts.getUserById.get(u.id);
          if (existing) continue;
          stmts.insertUser.run({
            id:                      u.id,
            name:                    u.name,
            email:                   u.email,
            password_hash:           u.passwordHash,
            business_name:           u.businessName  || null,
            trade:                   u.trade         || null,
            phone:                   u.phone         || null,
            plan:                    u.plan          || 'trial',
            trial_ends_at:           u.trialEndsAt   || null,
            subscription_status:     u.subscriptionStatus || 'trialing',
            stripe_customer_id:      u.stripeCustomerId   || null,
            reset_token:             u.resetToken    || null,
            reset_expires:           u.resetExpires  || null,
            stripe_subscription_id:  u.stripeSubscriptionId || null,
            created_at:              u.createdAt     || new Date().toISOString(),
          });
          count++;
        }
        console.log(`[db]   Migrated ${count} user(s) from users.json`);
      } catch (err) {
        console.error('[db]   Failed to migrate users.json:', err.message);
      }
    }

    // ── Customers ──────────────────────────────────────────────────────────
    if (hasCustomers) {
      try {
        const customers = JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf8'));
        let count = 0;
        for (const c of customers) {
          const existing = stmts.getCustomerById.get(c.id);
          if (existing) continue;
          stmts.insertCustomer.run({
            id:          c.id,
            user_id:     c.userId,
            name:        c.name,
            phone:       c.phone,
            service:     c.service,
            city:        c.city       || null,
            added_at:    c.addedAt    || new Date().toISOString(),
            status:      c.status     || 'pending',
            last_sms_at: c.lastSmsAt  || null,
            followup_at: c.followUpAt || null,
            sms_count:   c.smsCount   || 0,
          });
          count++;
        }
        console.log(`[db]   Migrated ${count} customer(s) from customers.json`);
      } catch (err) {
        console.error('[db]   Failed to migrate customers.json:', err.message);
      }
    }

    // ── Audit leads ────────────────────────────────────────────────────────
    if (hasAudit) {
      try {
        const leads = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
        let count = 0;
        for (const l of leads) {
          stmts.insertAuditLead.run({
            email:         l.email         || null,
            business_name: l.businessName  || null,
            category:      l.category      || null,
            city:          l.city          || null,
            services:      l.services      || null,
            website:       l.website       || null,
            gbp_url:       l.gbpUrl        || null,
            created_at:    l.createdAt || l.ts || new Date().toISOString(),
          });
          count++;
        }
        console.log(`[db]   Migrated ${count} audit lead(s) from audit-leads.json`);
      } catch (err) {
        console.error('[db]   Failed to migrate audit-leads.json:', err.message);
      }
    }
  });

  // Run the transaction
  migrate();

  // Rename old files to .bak
  if (hasUsers) {
    fs.renameSync(USERS_FILE, USERS_FILE + '.bak');
    console.log('[db]   Renamed users.json → users.json.bak');
  }
  if (hasCustomers) {
    fs.renameSync(CUSTOMERS_FILE, CUSTOMERS_FILE + '.bak');
    console.log('[db]   Renamed customers.json → customers.json.bak');
  }
  if (hasAudit) {
    fs.renameSync(AUDIT_FILE, AUDIT_FILE + '.bak');
    console.log('[db]   Renamed audit-leads.json → audit-leads.json.bak');
  }

  console.log('[db] Migration complete.');
};

// ── Auto-run migration on first require ──────────────────────────────────────
db.migrateFromJSON();

module.exports = db;
