/* ── Starpush AI Growth Coach ─────────────────────────────────────────────── */

/* ── Demo data shown when API key is not yet configured ─────────────────────── */
const DEMO_INSIGHTS = {
  growthScore: 62,
  scoreLabel: 'Growing',
  weeklyGoal: 'Send review requests to 10 customers this week — you\'re 14 reviews away from the #1 spot in your city.',
  projection: 'At this pace you\'ll hit 50 reviews by end of July.',
  rankingTip: 'Add "emergency plumbing Austin" and your top 3 neighbourhoods to your GBP description — businesses that mention exact suburbs rank 2× higher in the Local Pack.',
  coachMessage: 'You\'re on a solid trajectory — three more weeks of consistent sending and you\'ll start seeing real map pack movement. The businesses that win on Google Maps aren\'t the best; they\'re the most consistent. Keep going.',
  insights: [
    {
      type: 'win',
      icon: '📈',
      title: 'Review velocity is accelerating',
      body: 'You collected 8 reviews this week vs 5 last week — a 60% jump. Your average rating is holding strong at 4.8★, which is in the top 12% of local trades businesses.',
      cta: 'Keep the momentum — send requests same-day after every job',
    },
    {
      type: 'opportunity',
      icon: '💬',
      title: 'Your response rate is lagging',
      body: 'You\'ve replied to 3 of your last 10 reviews (30%). Google rewards businesses that respond to every review — aim for 100% within 24 hours to boost your ranking signals.',
      cta: 'Use the AI reply generator for every unanswered review',
    },
    {
      type: 'warning',
      icon: '🚨',
      title: '1 negative review needs attention',
      body: 'A 2-star review from last Tuesday hasn\'t been responded to yet. Every day without a reply reduces recovery chance by ~15%. Act now before it costs you more leads.',
      cta: 'Open Review Shield → Get recovery plan',
    },
    {
      type: 'tip',
      icon: '📍',
      title: 'Add service-area posts this week',
      body: 'Businesses that publish 1 Google Post per week rank 23% higher on average. Your profile has had no posts in 14 days — one post today could move the needle this week.',
      cta: 'Use GBP Optimizer to generate 4 posts in 30 seconds',
    },
  ],
};

const SCORE_COLOR = {
  'Needs Attention': '#ef4444',
  'Getting Traction': '#f59e0b',
  'Growing':         '#4f46e5',
  'Thriving':        '#10b981',
  'Dominating':      '#f59e0b',
};

const TYPE_LABELS = {
  win:         'Win 🏆',
  opportunity: 'Opportunity',
  warning:     'Watch Out',
  tip:         'Pro Tip',
};

function drawVelocityChart(weeklyData) {
  const canvas = document.getElementById('velocityChart');
  const empty  = document.getElementById('chartEmpty');
  if (!canvas) return;

  const total = weeklyData.reduce((s, w) => s + w.count, 0);
  if (total === 0) {
    canvas.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  canvas.classList.remove('hidden');
  empty.classList.add('hidden');

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth  || 700;
  const H   = 160;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const padL = 28, padR = 8, padT = 12, padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const maxVal = Math.max(...weeklyData.map(w => w.count), 1);

  const barGap  = 8;
  const barW    = (chartW - barGap * (weeklyData.length - 1)) / weeklyData.length;

  // Grid lines
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth   = 1;
  const gridLines = 3;
  for (let i = 0; i <= gridLines; i++) {
    const y = padT + chartH - (chartH * i / gridLines);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + chartW, y); ctx.stroke();
    if (i > 0) {
      const val = Math.round(maxVal * i / gridLines);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(val, padL - 4, y + 3);
    }
  }

  weeklyData.forEach((week, i) => {
    const x    = padL + i * (barW + barGap);
    const barH = week.count > 0 ? Math.max(4, (week.count / maxVal) * chartH) : 2;
    const y    = padT + chartH - barH;
    const isLast = i === weeklyData.length - 1;

    // Bar gradient
    const grad = ctx.createLinearGradient(0, y, 0, padT + chartH);
    grad.addColorStop(0, isLast ? 'rgba(79,70,229,0.9)' : 'rgba(79,70,229,0.55)');
    grad.addColorStop(1, isLast ? 'rgba(79,70,229,0.3)' : 'rgba(79,70,229,0.1)');
    ctx.fillStyle = grad;

    // Rounded top
    const r = Math.min(4, barW / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + barW - r, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
    ctx.lineTo(x + barW, padT + chartH);
    ctx.lineTo(x, padT + chartH);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    // Count label on bar
    if (week.count > 0) {
      ctx.fillStyle = isLast ? '#4f46e5' : '#64748b';
      ctx.font = `${isLast ? 'bold ' : ''}10px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(week.count, x + barW / 2, y - 4);
    }

    // Week label
    ctx.fillStyle = isLast ? '#0f172a' : '#94a3b8';
    ctx.font = `${isLast ? '600 ' : ''}9.5px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(week.label, x + barW / 2, H - padB + 14);
  });

  // "This week" pill
  const lastIdx = weeklyData.length - 1;
  const lx = padL + lastIdx * (barW + barGap) + barW / 2;
  ctx.fillStyle = '#4f46e5';
  const pillW = 46, pillH = 14, pillY = H - padB + 22;
  ctx.beginPath();
  ctx.roundRect(lx - pillW / 2, pillY, pillW, pillH, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 8px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('THIS WEEK', lx, pillY + 9.5);
}

async function loadInsights() {
  const refreshBtn  = document.getElementById('refreshBtn');
  const refreshIcon = document.getElementById('refreshIcon');
  const refreshTxt  = document.getElementById('refreshTxt');
  const loadingState  = document.getElementById('loadingState');
  const errorState    = document.getElementById('errorState');
  const insightContent = document.getElementById('insightContent');
  const scoreCard     = document.getElementById('scoreCard');

  // Reset UI
  loadingState.classList.remove('hidden');
  errorState.classList.add('hidden');
  insightContent.classList.add('hidden');
  scoreCard.classList.add('ig-score-skeleton');
  refreshBtn.disabled = true;
  refreshIcon.style.animation = 'spin .7s linear infinite';
  refreshTxt.textContent = 'Analysing…';

  // Animate score arc to 0
  animateScore(0, null, '#e2e8f0');

  try {
    const res  = await fetch('/api/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to load insights.');

    window._coachActionCounts = data.actionCounts || {};
    renderInsights(data.insights, data.weeklyReviews, data.weekSnapshot);

    loadingState.classList.add('hidden');
    insightContent.classList.remove('hidden');
    scoreCard.classList.remove('ig-score-skeleton');

  } catch (err) {
    loadingState.classList.add('hidden');
    scoreCard.classList.remove('ig-score-skeleton');

    // If API key isn't configured, show a rich demo instead of a bare error
    if (err.message && err.message.includes('not configured')) {
      // Generate demo weekly data that looks realistic for the chart
      const demoWeekly = [
        { label: 'Apr 7',  count: 1 },
        { label: 'Apr 14', count: 3 },
        { label: 'Apr 21', count: 2 },
        { label: 'Apr 28', count: 4 },
        { label: 'May 5',  count: 3 },
        { label: 'May 12', count: 5 },
        { label: 'May 19', count: 7 },
        { label: 'May 26', count: 8 },
      ];
      const demoSnap = { smsThisWeek: 12, smsLastWeek: 8, reviewsThisWeek: 8, reviewsLastWeek: 5 };
      renderInsights(DEMO_INSIGHTS, demoWeekly, demoSnap);
      insightContent.classList.remove('hidden');
      // Add a soft "demo mode" banner
      const demo = document.getElementById('insightContent');
      if (!document.getElementById('demo-banner')) {
        const banner = document.createElement('div');
        banner.id = 'demo-banner';
        banner.style.cssText = 'background:#fffbeb;border:1.5px solid #fde68a;border-radius:10px;padding:14px 20px;margin-bottom:28px;display:flex;align-items:center;gap:12px;font-size:13.5px;color:#78350f;font-weight:600;';
        banner.innerHTML = '<span style="font-size:20px">📊</span><span><strong>Sample Data</strong> — Send your first SMS review requests to unlock your real personalised insights.</span>';
        demo.insertBefore(banner, demo.firstChild);
      }
    } else {
      errorState.classList.remove('hidden');
      document.getElementById('errorMsg').textContent = err.message;
      document.getElementById('scoreLabel').textContent = 'Not loaded';
      document.getElementById('scoreLabel').style.background = '#64748b';
      document.getElementById('scoreLabel').style.color = '#fff';
      document.getElementById('scoreProjection').textContent = 'Could not load data — try again.';
    }
  } finally {
    refreshBtn.disabled = false;
    refreshIcon.style.animation = '';
    refreshTxt.textContent = 'Get Fresh Insights';
  }
}

function renderInsights(data, weeklyReviews, weekSnapshot) {
  // Score ring
  const scoreColor = SCORE_COLOR[data.scoreLabel] || '#4f46e5';
  animateScore(data.growthScore, data.scoreLabel, scoreColor);
  document.getElementById('scoreProjection').textContent = data.projection || '';

  // Mission
  document.getElementById('weeklyGoal').textContent = data.weeklyGoal || '';

  // Week at a Glance
  if (weekSnapshot) {
    const { smsThisWeek = 0, smsLastWeek = 0, reviewsThisWeek = 0, reviewsLastWeek = 0 } = weekSnapshot;
    const conv = smsThisWeek > 0 ? Math.round((reviewsThisWeek / smsThisWeek) * 100) : null;
    const convLast = smsLastWeek > 0 ? Math.round((reviewsLastWeek / smsLastWeek) * 100) : null;

    function delta(cur, prev, suffix = '') {
      if (prev === 0 && cur === 0) return '<span class="ig-delta-neu">—</span>';
      const diff = cur - prev;
      if (diff === 0) return '<span class="ig-delta-neu">→ same as last week</span>';
      const sign = diff > 0 ? '↑' : '↓';
      const cls  = diff > 0 ? 'ig-delta-up' : 'ig-delta-dn';
      return `<span class="${cls}">${sign}${Math.abs(diff)}${suffix} vs last week</span>`;
    }

    document.getElementById('wk-sms').textContent = smsThisWeek;
    document.getElementById('wk-reviews').textContent = reviewsThisWeek;
    document.getElementById('wk-conv').textContent = conv !== null ? conv + '%' : '–';
    document.getElementById('wk-sms-delta').innerHTML     = delta(smsThisWeek, smsLastWeek);
    document.getElementById('wk-reviews-delta').innerHTML = delta(reviewsThisWeek, reviewsLastWeek);
    document.getElementById('wk-conv-delta').innerHTML    = conv !== null && convLast !== null
      ? delta(conv, convLast, '%') : '<span class="ig-delta-neu">—</span>';
  }

  // Insights cards — insights carrying a known executable action get a
  // real button that makes the coach do the work (server-side allowlist).
  const ACTION_LABELS = {
    send_followups:         n => `⚡ Send ${n ? n + ' ' : ''}follow-up${n === 1 ? '' : 's'} now`,
    text_pending_customers: n => `⚡ Text ${n ? n + ' ' : ''}pending customer${n === 1 ? '' : 's'} now`,
  };
  const counts = window._coachActionCounts || {};
  const grid = document.getElementById('insightsGrid');
  grid.innerHTML = (data.insights || []).map(ins => {
    const runnable = ins.action && ACTION_LABELS[ins.action];
    return `
    <div class="ig-insight-card ig-type-${ins.type}">
      <div class="ig-insight-header">
        <span class="ig-insight-icon">${esc(ins.icon)}</span>
        <span class="ig-insight-type-label">${esc(TYPE_LABELS[ins.type] || ins.type)}</span>
      </div>
      <div class="ig-insight-title">${esc(ins.title)}</div>
      <div class="ig-insight-body">${esc(ins.body)}</div>
      <div class="ig-insight-cta">${esc(ins.cta)}</div>
      ${runnable ? `<button class="ig-do-btn" data-action="${esc(ins.action)}" style="margin-top:10px;width:100%;padding:9px 14px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">${esc(ACTION_LABELS[ins.action](counts[ins.action]))}</button>` : ''}
    </div>`;
  }).join('');

  // Wire the executable action buttons
  grid.querySelectorAll('.ig-do-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      if (!ACTION_LABELS[action]) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'Working…';
      try {
        const res  = await fetch('/api/coach/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const out = await res.json();
        if (res.ok) {
          btn.textContent = `✓ ${out.message || 'Done'}`;
          btn.style.background = '#059669';
        } else {
          btn.textContent = `⚠ ${out.error || 'Failed'}`;
          btn.style.background = '#dc2626';
          setTimeout(() => { btn.textContent = original; btn.style.background = '#4f46e5'; btn.disabled = false; }, 6000);
        }
      } catch {
        btn.textContent = '⚠ Network error — try again';
        btn.style.background = '#dc2626';
        setTimeout(() => { btn.textContent = original; btn.style.background = '#4f46e5'; btn.disabled = false; }, 6000);
      }
    });
  });

  // Ranking tip
  document.getElementById('rankingTipText').textContent = data.rankingTip || '';

  // Coach message
  document.getElementById('coachMsgText').textContent = data.coachMessage || '';

  // Timestamp
  const ts = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  document.getElementById('updatedAt').textContent = `Last updated ${ts}`;

  // Chart
  if (weeklyReviews && weeklyReviews.length) {
    requestAnimationFrame(() => drawVelocityChart(weeklyReviews));
  }
}

function animateScore(score, label, color) {
  const arc        = document.getElementById('scoreArc');
  const scoreNum   = document.getElementById('scoreNum');
  const scoreLabel = document.getElementById('scoreLabel');
  const circumference = 326.7; // 2π × 52

  // Animate number
  const start     = parseInt(scoreNum.textContent) || 0;
  const duration  = 1200;
  const startTime = performance.now();
  function tick(now) {
    const p = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    scoreNum.textContent = Math.round(start + (score - start) * ease);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Arc
  arc.style.stroke = color;
  arc.style.strokeDashoffset = circumference - (circumference * score / 100);

  // Label
  if (label) {
    scoreLabel.textContent = label;
    scoreLabel.style.background = color;
    scoreLabel.style.color = (color === '#f59e0b') ? '#0d2137' : '#fff';
  }
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mobile burger menu
(function() {
  const burger = document.getElementById('ig-burger');
  const menu   = document.getElementById('ig-mobile-menu');
  if (!burger || !menu) return;
  burger.addEventListener('click', () => {
    const open = menu.classList.toggle('ig-mm-open');
    burger.classList.toggle('ig-burger-active', open);
    burger.setAttribute('aria-expanded', open);
  });
  document.addEventListener('click', e => {
    if (!burger.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.remove('ig-mm-open');
      burger.classList.remove('ig-burger-active');
    }
  });
})();

// Refresh button
document.getElementById('refreshBtn').addEventListener('click', loadInsights);

/* ── Weekly Mission completion ──────────────────────────────────────────── */
(function() {
  const WEEK_KEY = () => {
    const d = new Date();
    const jan1 = new Date(d.getFullYear(), 0, 1);
    return `rp_mission_${d.getFullYear()}_w${Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7)}`;
  };
  const STREAK_KEY = 'rp_mission_streak';
  const STREAK_LAST_KEY = 'rp_mission_streak_last';

  const btn        = document.getElementById('missionDoneBtn');
  const doneState  = document.getElementById('missionDoneState');
  const banner     = document.getElementById('missionBanner');
  const icon       = document.getElementById('missionIcon');
  const streakNote = document.getElementById('missionStreakNote');

  function getStreak() { return parseInt(localStorage.getItem(STREAK_KEY) || '0', 10); }

  function applyDoneState() {
    banner.classList.add('ig-mission-done');
    btn.classList.add('ig-mission-done-btn-done');
    btn.querySelector('#missionDoneIcon').textContent = '✓';
    btn.querySelector('#missionDoneTxt').textContent  = 'Completed!';
    btn.disabled = true;
    icon.textContent = '🏆';
    doneState.classList.remove('hidden');
    const streak = getStreak();
    streakNote.textContent = streak > 1
      ? ` You've completed ${streak} missions in a row!`
      : ' Great work — keep the streak going!';
  }

  function checkDone() {
    if (localStorage.getItem(WEEK_KEY())) applyDoneState();
  }

  btn.addEventListener('click', () => {
    const key = WEEK_KEY();
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');

    // Update streak
    const lastKey = localStorage.getItem(STREAK_LAST_KEY);
    const d = new Date();
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const thisWeek = `${d.getFullYear()}_w${Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7)}`;
    const lastWeek = (() => {
      const lw = new Date(d); lw.setDate(d.getDate() - 7);
      const lj = new Date(lw.getFullYear(), 0, 1);
      return `${lw.getFullYear()}_w${Math.ceil(((lw - lj) / 86400000 + lj.getDay() + 1) / 7)}`;
    })();
    const streak = (lastKey === lastWeek) ? getStreak() + 1 : 1;
    localStorage.setItem(STREAK_KEY, streak);
    localStorage.setItem(STREAK_LAST_KEY, thisWeek);

    applyDoneState();
  });

  checkDone();
})();

// Load on page ready
loadInsights();

/* ── Google Post Generator ───────────────────────────────────────────────── */
(function() {
  const btn     = document.getElementById('gpost-btn');
  const ico     = document.getElementById('gpost-ico');
  const txt     = document.getElementById('gpost-txt');
  const spinner = document.getElementById('gpost-spinner');
  const output  = document.getElementById('gpost-output');
  const tradeEl = document.getElementById('gpost-trade');
  const cityEl  = document.getElementById('gpost-city');
  if (!btn) return;

  // Pre-fill from account if available
  fetch('/api/auth/me').then(r => r.json()).then(u => {
    if (u && u.trade && tradeEl && !tradeEl.value) tradeEl.value = u.trade;
    if (u && u.city  && cityEl  && !cityEl.value)  cityEl.value  = u.city;
  }).catch(() => {});

  btn.addEventListener('click', async () => {
    const trade = tradeEl?.value.trim();
    const city  = cityEl?.value.trim();
    if (!trade) { tradeEl?.focus(); tradeEl?.classList.add('gpost-inp-err'); setTimeout(() => tradeEl?.classList.remove('gpost-inp-err'), 2000); return; }
    if (!city)  { cityEl?.focus();  cityEl?.classList.add('gpost-inp-err');  setTimeout(() => cityEl?.classList.remove('gpost-inp-err'),  2000); return; }

    btn.disabled = true;
    ico.textContent = '';
    spinner.classList.remove('hidden');
    txt.textContent = 'Generating posts…';
    output.classList.add('hidden');
    output.innerHTML = '';

    try {
      const res  = await fetch('/api/generate-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade, city }),
      });
      const data = await res.json();

      if (!res.ok || !data.posts) {
        output.innerHTML = `<div class="gpost-err">⚠ ${data.error || 'Failed to generate posts'}</div>`;
        output.classList.remove('hidden');
        return;
      }

      output.innerHTML = data.posts.map((p, i) => `
        <div class="gpost-card">
          <div class="gpost-card-hd">
            <span class="gpost-card-emoji">${p.emoji || '📝'}</span>
            <span class="gpost-card-title">${escG(p.title)}</span>
            <span class="gpost-card-num">Post ${i + 1}</span>
          </div>
          <div class="gpost-card-body" id="gpost-body-${i}">${escG(p.body)}</div>
          <div class="gpost-card-actions">
            <button class="gpost-copy-btn" data-idx="${i}">⎘ Copy Post</button>
            <span class="gpost-chars">${p.body.length} chars</span>
          </div>
        </div>
      `).join('');

      output.classList.remove('hidden');

      // Wire copy buttons
      output.querySelectorAll('.gpost-copy-btn').forEach(copyBtn => {
        copyBtn.addEventListener('click', () => {
          const idx  = Number(copyBtn.dataset.idx);
          const body = document.getElementById(`gpost-body-${idx}`)?.textContent || '';
          navigator.clipboard.writeText(body).then(() => {
            copyBtn.textContent = '✓ Copied!';
            setTimeout(() => { copyBtn.textContent = '⎘ Copy Post'; }, 2200);
          });
        });
      });

    } catch (err) {
      output.innerHTML = `<div class="gpost-err">⚠ Network error — check your connection</div>`;
      output.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      ico.textContent = '✨';
      spinner.classList.add('hidden');
      txt.textContent = 'Generate 3 Posts';
    }
  });

  function escG(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
})();
