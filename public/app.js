/* ── Config ──────────────────────────────────────────────────────────────── */
const API = '';   // same origin – Express serves both

/* ── State ───────────────────────────────────────────────────────────────── */
let knownIds      = new Set();
let selectedRating = 5;
const copyMap     = new Map();   // itemId → aiReply text (avoids HTML-encoding issues)

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const smsForm    = document.getElementById('sms-form');
const smsBtnTxt  = document.getElementById('sms-btn-txt');
const smsSpinner = document.getElementById('sms-spinner');
const smsBtn     = document.getElementById('sms-btn');

const simBtn     = document.getElementById('sim-btn');
const simBtnTxt  = document.getElementById('sim-btn-txt');
const simSpinner = document.getElementById('sim-spinner');

const feedBody   = document.getElementById('feed-body');
const emptyState = document.getElementById('empty-state');
const feedCount  = document.getElementById('feed-count');
const clearBtn   = document.getElementById('clear-btn');

const statSMS     = document.getElementById('stat-sms');
const statReviews = document.getElementById('stat-reviews');
const statRating  = document.getElementById('stat-rating');
const statReplies = document.getElementById('stat-replies');

/* ── Service quick-picks ─────────────────────────────────────────────────── */
(function initQuickPicks() {
  const TRADE_PICKS = {
    hvac:       ['AC Repair', 'Heating Repair', 'AC Install', 'Duct Cleaning', 'Tune-Up'],
    plumbing:   ['Drain Repair', 'Pipe Repair', 'Water Heater', 'Leak Fix', 'Emergency'],
    roofing:    ['Roof Repair', 'Full Replacement', 'Gutter Install', 'Inspection', 'Storm Damage'],
    electrical: ['Panel Upgrade', 'Wiring', 'Outlet Install', 'Safety Inspection', 'Emergency'],
    cleaning:   ['Deep Clean', 'Move-Out Clean', 'Regular Clean', 'Window Clean', 'Carpet Clean'],
    landscaping:['Lawn Mow', 'Tree Trim', 'Landscaping', 'Leaf Removal', 'Irrigation'],
    painting:   ['Interior Paint', 'Exterior Paint', 'Cabinet Refinish', 'Deck Stain', 'Touch-Up'],
  };
  const DEFAULT_PICKS = ['HVAC Repair', 'Plumbing', 'Roof Repair', 'Electrical', 'Deep Clean'];

  function getPicksForTrade(trade) {
    if (!trade) return DEFAULT_PICKS;
    const t = trade.toLowerCase();
    for (const [key, picks] of Object.entries(TRADE_PICKS)) {
      if (t.includes(key)) return picks;
    }
    return DEFAULT_PICKS;
  }

  function renderPicks(trade) {
    const wrap = document.getElementById('service-quickpicks');
    if (!wrap) return;
    const picks = getPicksForTrade(trade);
    wrap.innerHTML = picks.map(p =>
      `<button type="button" class="svc-pick" data-svc="${p}">${p}</button>`
    ).join('');
    wrap.querySelectorAll('.svc-pick').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = document.getElementById('service');
        if (inp) {
          inp.value = btn.dataset.svc;
          inp.dispatchEvent(new Event('input'));
          inp.focus();
        }
        // Highlight selected
        wrap.querySelectorAll('.svc-pick').forEach(b => b.classList.remove('svc-pick-active'));
        btn.classList.add('svc-pick-active');
      });
    });
  }

  // Render with current user's trade when account loads
  renderPicks(null);
  // Re-render once user account is loaded
  const origMe = window._currentUser;
  Object.defineProperty(window, '_currentUser', {
    set(val) {
      window.__currentUser = val;
      if (val?.trade) renderPicks(val.trade);
      // Business name & saved review link arrive with the user — refresh preview
      try { updateSMSPreview(); } catch {}
      // Inject "Custom" template chip if user has a saved custom template
      const chips = document.getElementById('tpl-chips');
      if (chips) {
        const existing = chips.querySelector('[data-tpl="custom"]');
        if (val?.smsTemplate && !existing) {
          const btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'tpl-chip'; btn.dataset.tpl = 'custom';
          btn.textContent = 'Custom ✏️';
          btn.addEventListener('click', () => {
            activeTpl = 'custom'; localStorage.setItem('rp_tpl', 'custom');
            chips.querySelectorAll('.tpl-chip').forEach(c => c.classList.toggle('active', c.dataset.tpl === 'custom'));
            updateSMSPreview();
          });
          chips.appendChild(btn);
        } else if (!val?.smsTemplate && existing) {
          existing.remove();
          if (activeTpl === 'custom') { activeTpl = 'standard'; localStorage.setItem('rp_tpl', 'standard'); }
        }
      }
    },
    get() { return window.__currentUser; },
    configurable: true,
  });
})();

/* ── Review link test button ─────────────────────────────────────────────── */
(function initLinkTest() {
  const linkInp = document.getElementById('reviewLink');
  const testBtn = document.getElementById('test-link-btn');
  if (!linkInp || !testBtn) return;
  linkInp.addEventListener('input', () => {
    const val = linkInp.value.trim();
    testBtn.classList.toggle('hidden', !val);
  });
  testBtn.addEventListener('click', () => {
    const url = linkInp.value.trim();
    if (url) window.open(url, '_blank', 'noopener');
  });
})();

/* ── Star rating ─────────────────────────────────────────────────────────── */
document.querySelectorAll('.star').forEach(star => {
  star.addEventListener('mouseenter', () => paintStars(Number(star.dataset.v)));
  star.addEventListener('mouseleave', () => paintStars(selectedRating));
  star.addEventListener('click', () => {
    selectedRating = Number(star.dataset.v);
    document.getElementById('ratingVal').value = selectedRating;
    paintStars(selectedRating);
  });
});

function paintStars(n) {
  document.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('active', i < n));
}

/* ── SMS Templates ───────────────────────────────────────────────────────── */
// Mirrors buildSMSFromTemplate in server.js — keep in sync so the preview
// matches what the customer actually receives.
function bizName() { return (window._currentUser?.businessName || '').trim(); }
const SMS_TEMPLATES = {
  standard: (name, service, link) =>
    `Hi ${name}, thanks for choosing ${bizName() || 'us'} for your ${service}! Could you leave us a quick Google review? It only takes 30 seconds: ${link}`,
  brief: (name, service, link) =>
    `Hi ${name}! Quick favour — could you leave ${bizName() || 'us'} a Google review for your ${service}? ${link} Takes 30 secs, means the world 🙏`,
  personal: (name, service, link) =>
    `Hey ${name}! It was a pleasure working on your ${service} today. If you're happy with the work, an honest Google review would help ${bizName() ? `us at ${bizName()}` : 'us'} enormously: ${link} — thanks so much!`,
  custom: (name, service, link) => {
    const tpl = window._currentUser?.smsTemplate;
    if (!tpl) return SMS_TEMPLATES.standard(name, service, link);
    return tpl.replace(/\{name\}/gi, name).replace(/\{service\}/gi, service)
              .replace(/\{business\}/gi, bizName() || 'our team')
              .replace(/\{reviewLink\}/gi, link).replace(/\{link\}/gi, link);
  },
};

let activeTpl = localStorage.getItem('rp_tpl') || 'standard';

(function initTemplatePicker() {
  document.querySelectorAll('.tpl-chip').forEach(chip => {
    if (chip.dataset.tpl === activeTpl) chip.classList.add('active');
    else chip.classList.remove('active');
    chip.addEventListener('click', () => {
      activeTpl = chip.dataset.tpl;
      localStorage.setItem('rp_tpl', activeTpl);
      document.querySelectorAll('.tpl-chip').forEach(c => c.classList.toggle('active', c.dataset.tpl === activeTpl));
      updateSMSPreview();
    });
  });
})();

function buildSMSBody(name, service, link) {
  const tpl = SMS_TEMPLATES[activeTpl] || SMS_TEMPLATES.standard;
  return tpl(name, service, link);
}

/* ── SMS preview: update as user types ──────────────────────────────────── */
function updateSMSPreview() {
  const name    = (smsForm.customerName?.value || '').trim() || '[customer name]';
  const service = (smsForm.service?.value || '').trim() || '[service]';
  const link    = (smsForm.reviewLink?.value || '').trim() ||
                  window._currentUser?.googleReviewLink ||
                  'https://g.page/r/your-review-link';
  const msg = buildSMSBody(name, service, link);
  const preview  = document.getElementById('sms-preview-text');
  const chars    = document.getElementById('sms-char-count');
  const previewEl = document.getElementById('sms-preview');
  if (preview) preview.textContent = msg;
  if (chars) {
    chars.textContent = `${msg.length} chars`;
    chars.style.color = msg.length > 160 ? '#dc2626' : '#6b7280';
  }
  if (previewEl) previewEl.classList.toggle('sms-preview-active',
    !!(smsForm.customerName?.value.trim() || smsForm.service?.value.trim()));
}
['customerName', 'service', 'reviewLink'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', updateSMSPreview);
});
updateSMSPreview();

/* ── Auto-save SMS form to localStorage ─────────────────────────────────── */
const SMS_SAVE_KEY = 'rp_sms_draft';
const SAVE_FIELDS  = ['city', 'service', 'reviewLink'];
function saveSMSDraft() {
  const draft = {};
  SAVE_FIELDS.forEach(id => { draft[id] = document.getElementById(id)?.value || ''; });
  localStorage.setItem(SMS_SAVE_KEY, JSON.stringify(draft));
}
function restoreSMSDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(SMS_SAVE_KEY) || '{}');
    SAVE_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && draft[id]) { el.value = draft[id]; el.dispatchEvent(new Event('input')); }
    });
  } catch {}
}
SAVE_FIELDS.forEach(id => { document.getElementById(id)?.addEventListener('input', saveSMSDraft); });
restoreSMSDraft();

/* ── Duplicate phone detection ───────────────────────────────────────────── */
(function initDupCheck() {
  const phoneEl = document.getElementById('phone');
  const warnEl  = document.getElementById('phone-dup-warn');
  if (!phoneEl || !warnEl) return;

  // Normalise a phone number down to digits only for comparison
  const norm = p => (p || '').replace(/\D/g, '');

  let _customers = [];
  // Lazy-load customers once and cache
  async function getCustomers() {
    if (_customers.length) return _customers;
    try {
      const r = await fetch('/api/customers');
      _customers = r.ok ? await r.json() : [];
    } catch {}
    return _customers;
  }

  phoneEl.addEventListener('blur', async () => {
    const entered = norm(phoneEl.value);
    if (entered.length < 7) { warnEl.classList.add('hidden'); warnEl.innerHTML = ''; return; }
    const list = await getCustomers();
    const match = list.find(c => norm(c.phone).endsWith(entered.slice(-7)));
    if (match) {
      const daysAgo = match.lastSmsAt
        ? Math.floor((Date.now() - new Date(match.lastSmsAt)) / 86400000)
        : null;
      const when = daysAgo !== null ? `${daysAgo}d ago` : 'previously';
      warnEl.innerHTML = `⚠️ <strong>${match.name}</strong> is already in your list (sent ${when}, status: <em>${match.status}</em>). Consider using <strong>Send Follow-up</strong> instead.`;
      warnEl.classList.remove('hidden');
    } else {
      warnEl.classList.add('hidden');
      warnEl.innerHTML = '';
    }
  });

  // Clear warning when user starts editing the phone field
  phoneEl.addEventListener('input', () => {
    warnEl.classList.add('hidden');
    warnEl.innerHTML = '';
  });
})();

/* ── Copy Message button ─────────────────────────────────────────────────── */
document.getElementById('copy-msg-btn')?.addEventListener('click', () => {
  const txt  = document.getElementById('sms-preview-text')?.textContent || '';
  const real = txt === 'Fill in the form above to preview your message.' ? null : txt;
  if (!real) {
    toast('warn', '⚠️ Fill in customer name and service first.');
    return;
  }
  navigator.clipboard.writeText(real).then(() => {
    const ico = document.getElementById('copy-msg-ico');
    const lbl = document.getElementById('copy-msg-txt');
    if (ico) ico.textContent = '✓';
    if (lbl) lbl.textContent = 'Copied!';
    setTimeout(() => {
      if (ico) ico.textContent = '⎘';
      if (lbl) lbl.textContent = 'Copy';
    }, 2500);
    toast('ok', '📋 Message copied — paste it in your SMS app!');
  });
});

/* ── Auto-mirror service/city into simulate fields ───────────────────────── */
document.getElementById('service').addEventListener('input', e => {
  const el = document.getElementById('simService');
  if (!el.dataset.touched) el.value = e.target.value;
});
document.getElementById('city').addEventListener('input', e => {
  const el = document.getElementById('simCity');
  if (!el.dataset.touched) el.value = e.target.value;
});
['simService', 'simCity'].forEach(id => {
  document.getElementById(id).addEventListener('input', e => { e.target.dataset.touched = '1'; });
});

/* ── QR Code: auto-generate when review link is entered ─────────────────── */
const reviewLinkInp = document.getElementById('reviewLink');
if (reviewLinkInp) {
  reviewLinkInp.addEventListener('input', debounce(e => {
    const url = e.target.value.trim();
    updateQR(url);
  }, 600));
}

function updateQR(url) {
  const qrImg       = document.getElementById('qr-img');
  const qrPlaceholder = document.getElementById('qr-placeholder');
  const qrActions   = document.getElementById('qr-actions');
  const qrDownload  = document.getElementById('qr-download');
  const qrUrlLabel  = document.getElementById('qr-url-label');
  if (!qrImg) return;

  if (!url || !url.startsWith('http')) {
    qrImg.style.display       = 'none';
    qrUrlLabel.style.display  = 'none';
    qrActions.classList.add('hidden');
    qrPlaceholder.style.display = 'block';
    return;
  }

  const encoded = encodeURIComponent(url);
  const qrSrc   = `https://api.qrserver.com/v1/create-qr-code/?data=${encoded}&size=320x320&margin=8&color=0d2137`;
  qrImg.src = qrSrc;
  qrImg.style.display       = 'block';
  qrUrlLabel.style.display  = 'block';
  qrUrlLabel.textContent    = url.length > 50 ? url.substring(0, 47) + '…' : url;
  qrActions.classList.remove('hidden');
  qrPlaceholder.style.display = 'none';
  if (qrDownload) qrDownload.href = qrSrc;
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ── SMS form submit ─────────────────────────────────────────────────────── */
smsForm.addEventListener('submit', async e => {
  e.preventDefault();

  const customerName = smsForm.customerName.value.trim();
  const phone        = smsForm.phone.value.trim();
  const service      = smsForm.service.value.trim();

  // Basic validation
  if (!customerName || !phone || !service) {
    if (!customerName) shake(smsForm.customerName);
    if (!phone)        shake(smsForm.phone);
    if (!service)      shake(smsForm.service);
    return;
  }

  setBusy(smsBtn, smsSpinner, smsBtnTxt, true, 'Sending…');

  const payload = {
    customerName,
    phone,
    service,
    city:        smsForm.city.value.trim(),
    reviewLink:  smsForm.reviewLink.value.trim(),
    template:    activeTpl,
  };

  try {
    const res  = await fetch(`${API}/api/send-request`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.entry) insertItem(data.entry);

    if (res.ok) {
      toast('ok', `✅ SMS sent to ${customerName}`);
      smsForm.reset();
      localStorage.removeItem(SMS_SAVE_KEY);
    } else {
      toast('err', `⚠️ ${data.error}`);
    }
  } catch (err) {
    toast('err', `Network error: ${err.message}`);
  } finally {
    setBusy(smsBtn, smsSpinner, smsBtnTxt, false, 'Send via SMS');
    syncFeed();
  }
});

/* ── AI Reply Generator ──────────────────────────────────────────────────── */
simBtn.addEventListener('click', async () => {
  const reviewText = document.getElementById('reviewText').value.trim();
  if (!reviewText) { shake(document.getElementById('reviewText')); return; }

  setBusy(simBtn, simSpinner, simBtnTxt, true, 'Generating…');

  // Hide previous reply output
  const replyOut  = document.getElementById('sim-reply-out');
  const replyText = document.getElementById('sim-reply-text');
  if (replyOut) replyOut.classList.add('hidden');

  const payload = {
    reviewText,
    reviewerName: document.getElementById('reviewerName').value.trim(),
    service:      document.getElementById('simService').value.trim(),
    city:         document.getElementById('simCity').value.trim(),
    rating:       selectedRating,
  };

  try {
    const res  = await fetch(`${API}/api/webhook/review`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.ok && data.entry) {
      insertItem(data.entry);
      // Also show inline reply output so user can copy without scrolling to feed
      if (data.entry.aiReply && replyOut && replyText) {
        replyText.textContent = data.entry.aiReply;
        replyOut.classList.remove('hidden');
        window._lastSimReply = data.entry.aiReply;
      }
      toast('ok', '🤖 AI reply ready — copy it below!');
    } else {
      toast('err', `AI error: ${data.error}`);
    }
  } catch (err) {
    toast('err', `Network error: ${err.message}`);
  } finally {
    setBusy(simBtn, simSpinner, simBtnTxt, false, '✨ Generate AI Reply');
  }
});

// Wire the inline copy button for sim reply
(function() {
  const copyBtn = document.getElementById('sim-copy-btn');
  if (!copyBtn) return;
  copyBtn.addEventListener('click', () => {
    const text = window._lastSimReply || document.getElementById('sim-reply-text')?.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = '✓ Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => { copyBtn.textContent = '⎘'; copyBtn.classList.remove('copied'); }, 2200);
    });
  });
})();

/* ── Clear feed ──────────────────────────────────────────────────────────── */
clearBtn.addEventListener('click', () => {
  feedBody.querySelectorAll('.fi').forEach(el => el.remove());
  knownIds.clear();
  copyMap.clear();
  shieldFeedMap.clear();
  checkEmpty();
  toast('info', 'Feed cleared.');
});

/* ── Feed polling (4-second interval) ───────────────────────────────────── */
async function syncFeed() {
  try {
    const res  = await fetch(`${API}/api/feed`);
    if (!res.ok) return;
    const feed = await res.json();
    // Insert any items the server has that we don't (e.g. from other sessions)
    feed.forEach(item => {
      if (!knownIds.has(item.id)) insertItem(item, false);
    });
  } catch (_) { /* network hiccup – ignore */ }
}

setInterval(syncFeed, 4000);
syncFeed();   // immediate first load

/* ── Render: insert a feed item ──────────────────────────────────────────── */
function insertItem(item, animate = true) {
  if (knownIds.has(item.id)) return;
  knownIds.add(item.id);

  const isNew = animate; // only typewrite on freshly-generated items

  if (item.type === 'review_received') {
    if (item.aiReply) copyMap.set(item.id, item.aiReply);
    shieldFeedMap.set(item.id, item);   // needed by Review Shield
  }

  const el    = document.createElement('div');
  el.className = 'fi';
  el.dataset.type = item.type;
  if (!animate) el.style.animation = 'none';
  el.id       = `fi-${item.id}`;

  // For new review items, render with empty ai-text for typewriter effect
  if (item.type === 'review_received' && isNew && item.aiReply) {
    const itemWithBlank = Object.assign({}, item, { aiReply: '' });
    el.innerHTML = renderReview(itemWithBlank);
  } else {
    el.innerHTML = item.type === 'sms_sent' ? renderSMS(item) : renderReview(item);
  }

  // Remove empty state if present
  if (emptyState.parentNode === feedBody) emptyState.remove();

  feedBody.prepend(el);
  checkEmpty();

  // Typewrite AI reply for fresh items
  if (item.type === 'review_received' && isNew && item.aiReply) {
    const textEl = el.querySelector('.fi-ai-text');
    if (textEl) typewrite(textEl, item.aiReply, 18);
  }

  // Wire copy button
  const copyBtn = el.querySelector('[data-cid]');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = copyMap.get(Number(copyBtn.dataset.cid));
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '✓';
        copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.textContent = '⎘'; copyBtn.classList.remove('copied'); }, 2200);
      });
    });
  }

  // Wire inline "✓ Reviewed" button on SMS items
  const reviewedBtn = el.querySelector('.fi-mark-reviewed-btn');
  if (reviewedBtn) {
    reviewedBtn.addEventListener('click', async () => {
      const cid = reviewedBtn.dataset.custId;
      if (!cid) return;
      reviewedBtn.disabled = true;
      reviewedBtn.textContent = 'Saving…';
      try {
        await fetch(`/api/customers/${cid}/mark-reviewed`, { method: 'POST' });
        reviewedBtn.textContent = '⭐ Reviewed!';
        reviewedBtn.classList.add('fi-mark-reviewed-done');
        toast('ok', '⭐ Marked as reviewed — great work!');
        // Refresh customers list and stats
        if (typeof loadCustomers === 'function') setTimeout(loadCustomers, 500);
        if (typeof loadStats === 'function') setTimeout(loadStats, 600);
      } catch {
        reviewedBtn.disabled = false;
        reviewedBtn.textContent = '✓ Reviewed';
      }
    });
  }
}

/* ── Typewriter helper ───────────────────────────────────────────────────── */
function typewrite(el, text, speed = 16) {
  el.textContent = '';
  el.classList.add('typewriting');
  let i = 0;
  function tick() {
    if (i < text.length) {
      el.textContent += text[i++];
      setTimeout(tick, speed);
    } else {
      el.classList.remove('typewriting');
    }
  }
  tick();
}

/* ── SMS item template ───────────────────────────────────────────────────── */
function renderSMS(item) {
  const ok       = item.status === 'delivered';
  const badgeCls = ok ? 'badge-ok' : 'badge-err';
  const badgeTxt = ok ? '✓ Sent' : '✗ Failed';
  const sub      = [item.phone, item.service, item.city].filter(Boolean).join(' · ');

  // Inline "Mark as Reviewed" — only for delivered SMS with a linked customer
  const reviewedBtn = ok && item.customerId
    ? `<button class="fi-mark-reviewed-btn" data-cust-id="${esc(item.customerId)}" title="Mark ${esc(item.customerName)} as reviewed">✓ Reviewed</button>`
    : '';

  return `
    <div class="fi-row">
      <div class="fi-ico">📱</div>
      <div class="fi-meta">
        <div class="fi-top">
          <span class="fi-name">${esc(item.customerName)}</span>
          <span class="fi-time">${relTime(item.timestamp)}</span>
        </div>
        <div class="fi-sub">${esc(sub)}</div>
      </div>
      <span class="badge ${badgeCls}">${badgeTxt}</span>
    </div>
    <div class="fi-msg">${esc(item.message)}</div>
    ${reviewedBtn}
    ${item.error ? `<div class="fi-err">⚠ ${esc(item.error)}</div>` : ''}
  `;
}

/* ── Review item template ────────────────────────────────────────────────── */
function renderReview(item) {
  const filledStars = '★'.repeat(item.rating);
  const emptyStars  = '☆'.repeat(5 - item.rating);
  const sub         = [item.service, item.city].filter(Boolean).join(' · ');
  const isNegative  = item.rating <= 2;

  const shieldBanner = isNegative ? `
    <div class="fi-shield-alert">
      <span class="fi-shield-icon">🚨</span>
      <div class="fi-shield-body">
        <strong>Negative Review Alert</strong>
        <span>Act within 24 hours to maximise recovery chance.</span>
      </div>
      <button class="fi-shield-btn" onclick="openShield(${item.id})">Get Recovery Plan →</button>
    </div>
  ` : '';

  return `
    ${shieldBanner}
    <div class="fi-row">
      <div class="fi-ico">${isNegative ? '⚠️' : '⭐'}</div>
      <div class="fi-meta">
        <div class="fi-top">
          <span class="fi-name">${esc(item.reviewerName)}</span>
          <span class="fi-time">${relTime(item.timestamp)}</span>
        </div>
        <div class="fi-sub">${esc(sub)}</div>
      </div>
      <span class="badge ${isNegative ? 'badge-err' : 'badge-review'}">${isNegative ? '⚠ Low Rating' : 'New Review'}</span>
    </div>
    <div class="fi-stars" title="${item.rating} out of 5 stars">${filledStars}<span style="opacity:.35">${emptyStars}</span></div>
    <div class="fi-quote">${esc(item.reviewText)}</div>
    <div class="fi-ai">
      <div class="fi-ai-lbl">
        <span class="fi-ai-lbl-left">
          <span>🤖</span>
          <span>${isNegative ? 'AI Damage-Control Reply · SEO Optimised' : 'AI-Generated Reply · Ready to post'}</span>
        </span>
        <button class="copy-btn" data-cid="${item.id}" title="Copy reply to clipboard">⎘</button>
      </div>
      <div class="fi-ai-text">${esc(item.aiReply)}</div>
    </div>
  `;
}

/* ── Review Shield: open modal ───────────────────────────────────────────── */
const shieldFeedMap = new Map(); // id → full item

function openShield(itemId) {
  const item = shieldFeedMap.get(itemId);
  if (!item) return;
  const modal = document.getElementById('shield-modal');
  modal.style.display = 'flex';

  // Reset
  document.getElementById('shield-loading').style.display = 'block';
  document.getElementById('shield-content').style.display = 'none';
  document.getElementById('shield-error').style.display   = 'none';

  fetch('/api/recovery-script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewText:   item.reviewText,
      reviewerName: item.reviewerName,
      service:      item.service,
      city:         item.city,
      rating:       item.rating,
    }),
  })
    .then(r => r.json())
    .then(data => {
      if (!data.success) throw new Error(data.error || 'Failed to generate plan.');
      const s = data.script;
      document.getElementById('shield-reply-text').textContent = s.publicReply || '';
      document.getElementById('shield-call-text').textContent  = s.callScript || '';
      document.getElementById('shield-offer').textContent      = s.resolutionOffer || '';
      document.getElementById('shield-chance').textContent     = s.recoveryChance || '';
      document.getElementById('shield-tip').textContent        = s.recoveryTip || '';
      document.getElementById('shield-loading').style.display = 'none';
      document.getElementById('shield-content').style.display = 'block';
      // Store for copy
      window._shieldReply = s.publicReply;
    })
    .catch(err => {
      document.getElementById('shield-loading').style.display = 'none';
      document.getElementById('shield-error').style.display = 'block';
      document.getElementById('shield-error').textContent = err.message;
    });
}

function closeShield() {
  document.getElementById('shield-modal').style.display = 'none';
}

function copyShieldReply() {
  if (!window._shieldReply) return;
  navigator.clipboard.writeText(window._shieldReply).then(() => toast('ok', '✅ Reply copied to clipboard!'));
}

// Close on backdrop click
document.getElementById('shield-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeShield();
});

/* ── Stats ───────────────────────────────────────────────────────────────── */
function updateStats(feed) {
  const smsSent  = feed.filter(i => i.type === 'sms_sent' && i.status === 'delivered').length;
  const reviews  = feed.filter(i => i.type === 'review_received');
  const avg      = reviews.length
    ? (reviews.reduce((s, i) => s + i.rating, 0) / reviews.length).toFixed(1)
    : '–';

  statSMS.textContent     = smsSent;
  statReviews.textContent = reviews.length;
  statRating.textContent  = avg;
  statReplies.textContent = reviews.length;
}

function renderTrend(delta) {
  if (delta === 0 || delta == null) return '';
  const up  = delta > 0;
  const col = up ? '#059669' : '#dc2626';
  const arrow = up ? '↑' : '↓';
  return `<span style="font-size:10px;font-weight:700;color:${col};margin-left:4px">${arrow}${Math.abs(delta)}</span>`;
}

/* ── Feed filters ────────────────────────────────────────────────────────── */
let activeFilter = 'all';
document.querySelectorAll('.feed-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.feed-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    applyFeedFilter();
  });
});

function applyFeedFilter() {
  const items = feedBody.querySelectorAll('.fi');
  let visible = 0;
  items.forEach(el => {
    const type = el.dataset.type || '';
    const show = activeFilter === 'all' || type === activeFilter;
    el.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  feedCount.textContent = `${visible} item${visible !== 1 ? 's' : ''}`;
  const hasAny = feedBody.querySelectorAll('.fi').length > 0;
  if (!hasAny) feedBody.appendChild(emptyState);
  else if (emptyState.parentNode === feedBody && visible > 0) emptyState.remove();
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function checkEmpty() {
  const items = feedBody.querySelectorAll('.fi');
  const total = items.length;
  feedCount.textContent = `${total} item${total !== 1 ? 's' : ''}`;
  if (total === 0) feedBody.appendChild(emptyState);
  else applyFeedFilter();
}

function setBusy(btn, spinner, label, busy, txt) {
  btn.disabled = busy;
  spinner.classList.toggle('hidden', !busy);
  label.textContent = txt;
}

function relTime(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 10)   return 'just now';
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// XSS-safe escape for innerHTML
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shake(el) {
  el.classList.add('error');
  el.animate([
    { transform: 'translateX(0)' },
    { transform: 'translateX(-5px)' },
    { transform: 'translateX(5px)' },
    { transform: 'translateX(-4px)' },
    { transform: 'translateX(4px)' },
    { transform: 'translateX(0)' },
  ], { duration: 300, easing: 'ease' });
  el.addEventListener('input', () => el.classList.remove('error'), { once: true });
}

function toast(type, msg, duration) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  }, duration || 3600);
}

// ── Welcome on redirect from signup ──────────────────────────────────────────
// Note: the full onboarding modal is now rendered in dashboard.html and consumes
// the ?welcome=1 query param. This handler only covers the "returning" case.
(function handleWelcome() {
  const p = new URLSearchParams(window.location.search);
  const w = p.get('welcome');
  if (w === 'returning') {
    setTimeout(() => toast('info', '👋 Welcome back! Your dashboard is ready.'), 500);
    window.history.replaceState({}, '', '/dashboard');
  }
  if (p.get('upgraded') === '1') {
    setTimeout(() => toast('ok', '🎉 You\'re upgraded! Your plan is active — everything is unlocked. Thanks for going pro!', 6000), 500);
    window.history.replaceState({}, '', '/dashboard');
  }
})();

// ── Phone auto-format ────────────────────────────────────────────────────────
// Tradespeople type "(555) 123-4567" — show them the normalized number on blur
// so they know exactly what will be dialed, and catch typos before sending.
(function initPhoneFormat() {
  const el = document.getElementById('phone');
  const warn = document.getElementById('phone-dup-warn');
  if (!el) return;
  el.addEventListener('blur', () => {
    const raw = el.value.trim();
    if (!raw) return;
    const digits = raw.replace(/\D/g, '');
    let norm = null;
    if (raw.startsWith('+') && digits.length >= 11 && digits.length <= 15) norm = '+' + digits;
    else if (digits.length === 10) norm = '+1' + digits;
    else if (digits.length === 11 && digits.startsWith('1')) norm = '+' + digits;
    if (norm) {
      el.value = norm;
      el.style.borderColor = '';
    } else if (warn && !warn.textContent) {
      el.style.borderColor = '#f59e0b';
      el.title = 'Expected a 10-digit US number, e.g. (555) 123-4567';
    }
  });
  el.addEventListener('input', () => { el.style.borderColor = ''; el.title = ''; });
})();
