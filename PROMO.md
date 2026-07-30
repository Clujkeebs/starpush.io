# Promo code — owner-controlled complimentary trial

Set the `PROMO_CODE` environment variable to enable a single promotional signup
code. **Leave it unset and promo codes are disabled entirely** — the signup
endpoint ignores any code supplied.

> Don't write the live code into this file or anywhere else in the repo. It
> lives in the environment so it can be rotated without a deploy, and so a
> public repo doesn't hand out free accounts. The comparison is timing-safe
> (`crypto.timingSafeEqual`) and case-insensitive.

## What it does

A signup with a matching code gets a **90-day complimentary trial** instead of
the standard 14 days — full access, no Stripe checkout, no card. These accounts
are marked in the database with `promo_code = 'promo'` (the literal code itself
is never stored).

## Ending a complimentary trial

Access is gated by `hasActiveAccess()`, so setting the trial end date to the
past is enough. **No data is deleted** — customers, activity, and settings stay
intact; the user simply sees "Your free trial has ended — upgrade to keep
going" and protected pages redirect to `/upgrade?expired=1`.

```js
// Node REPL / one-off script, run from the project root:
const db = require('./db');
const u = db.getUserByEmail('their@email.com');
db.updateUser(u.id, {
  trialEndsAt: new Date(Date.now() - 1000).toISOString(),
  subscriptionStatus: 'expired',
});
```

Reversing it is the same call with a future `trialEndsAt`.

## Listing complimentary accounts

```js
require('./db').getAllUsers().filter(u => u.promoCode === 'promo')
  .forEach(u => console.log(u.email, u.trialEndsAt, u.subscriptionStatus));
```
