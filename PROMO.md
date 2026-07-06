# Promo code: `dro` — owner-controlled complimentary trial

Entering the promo code **`dro`** (lowercase) on the signup page gives a user a
**complimentary free trial**: full access to the app, presented as a normal free
trial, with the trial clock set to the year 2099 so it never runs out on its own.

These accounts are marked in the database with `promo_code = 'dro'`.

## How it looks to the user

- The signup form shows a green **FREE TRIAL ✓** badge and "your free trial is on us!"
- They get full access, exactly like a paying customer, for as long as you allow it.
- No Stripe checkout, no card required.

## Ending a complimentary trial (when the owner decides)

When you want to end someone's free trial, their access is switched off and they
see **"Your free trial has ended — upgrade to keep going,"** and must pay to
continue. **Their data is never deleted** — customers, activity, settings all stay
intact; only access is gated.

To end a specific user's trial, set their trial end date to the past:

```js
// Node REPL / one-off script, run from the project root:
const db = require('./db');
const u = db.getUserByEmail('their@email.com');
db.updateUser(u.id, {
  trialEndsAt: new Date(Date.now() - 1000).toISOString(),
  subscriptionStatus: 'expired',
});
```

After this, `hasActiveAccess()` returns false for that user, so protected pages
redirect to `/upgrade?expired=1` and the API returns the "free trial has ended"
message. Nothing is deleted — reversing it is just as easy (set `trialEndsAt`
back to a future date).

To list all complimentary accounts:

```js
require('./db').getAllUsers().filter(u => u.promoCode === 'dro')
  .forEach(u => console.log(u.email, u.trialEndsAt, u.subscriptionStatus));
```
