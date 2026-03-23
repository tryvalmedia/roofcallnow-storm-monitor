// api/refresh-pages.js
// Call this endpoint to re-render all existing storm pages with correct active/recent status
// Use after storms have passed to switch pages from "Active Alert" to "Recent Activity" mode

const STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
  CO:'Colorado', CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia',
  HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas',
  KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts',
  MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana',
  NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico',
  NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma',
  OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina',
  SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont',
  VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming'
};

// ─── FETCH ALL STORM PAGES FROM GITHUB ────────────────────────────────────────
async function fetchStormPages() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return [];

  try {
    // Get all files in the repo root
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!res.ok) return [];
    const files = await res.json();

    // Filter to storm alert pages only
    return files
      .filter(f => f.name.startsWith('storm-alert-') && f.name.endsWith('.html'))
      .map(f => ({ name: f.name, sha: f.sha, downloadUrl: f.download_url }));
  } catch (e) {
    console.log('Error fetching file list:', e.message);
    return [];
  }
}

// ─── FETCH PAGE CONTENT AND EXTRACT HISTORY ───────────────────────────────────
async function fetchPageHistory(file) {
  try {
    const res = await fetch(file.downloadUrl);
    const content = await res.text();
    const match = content.match(/<!--STORM_HISTORY:(.*?)-->/s);
    if (match) {
      return JSON.parse(match[1]);
    }
    return null;
  } catch (e) {
    console.log(`Error fetching ${file.name}:`, e.message);
    return null;
  }
}

// ─── REGENERATE PAGE WITH CORRECT STATUS ──────────────────────────────────────
function regeneratePage(historyData) {
  const { stateName, state: stateCode, entries } = historyData;
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Filter entries older than 7 days
  const validEntries = entries.filter(e => new Date(e.dateISO) > sevenDaysAgo);

  if (validEntries.length === 0) {
    // No events in last 7 days — page should be removed or marked as no activity
    return null;
  }

  // Determine active vs recent
  const mostRecent = new Date(validEntries[0].dateISO);
  const hoursSince = (now - mostRecent) / (1000 * 60 * 60);
  const isActive = hoursSince < 24;

  const lastUpdatedStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const updatedHistory = {
    ...historyData,
    entries: validEntries,
    lastUpdated: now.toISOString()
  };

  const alertBarText = isActive
    ? `⚠️ ACTIVE STORM ALERT — ${stateName} — Roof damage may have occurred in your area`
    : `📋 RECENT STORM ACTIVITY — ${stateName} — Storm damage reported in the last 7 days`;

  const alertBarBg = isActive ? '#dc2626' : '#92400e';
  const heroBg = isActive
    ? 'linear-gradient(135deg,#1a0a0a 0%,#2d1515 60%,#1a0a0a 100%)'
    : 'linear-gradient(135deg,#0f1f2e 0%,#1a3a52 60%,#0f2a3e 100%)';

  const headline = isActive
    ? validEntries[0].events.some(e => e.type === 'tornado')
      ? `Tornado Reported in ${stateName} — Check Your Roof Now`
      : validEntries[0].events.some(e => e.type === 'hail')
      ? `Hail Reported in ${stateName} — Get Your Roof Inspected`
      : `Severe Wind Damage Reported in ${stateName}`
    : `Recent Storm Damage in ${stateName} — Get Your Roof Inspected`;

  const statusBadge = isActive
    ? `<div class="storm-badge">🌩️ Active Storm Alert</div>`
    : `<div class="storm-badge" style="background:rgba(146,64,14,0.2);border-color:rgba(146,64,14,0.5);color:#fcd34d;">📋 Recent Storm Activity</div>`;

  const urgencyContent = isActive
    ? `<h3>Why You Need to Act Within 48 Hours</h3>
       <p>Insurance claims for storm damage must typically be filed within 12 months — but the documentation window is now. A licensed inspector can identify damage, photograph it, and help you file a claim before evidence degrades.</p>`
    : `<h3>Don't Wait — Storm Damage Gets Worse Over Time</h3>
       <p>Even if the storm was a few days ago, roof damage from hail and wind can worsen quickly — especially with rain. Insurance claims are still valid for recent storms. A free inspection costs nothing and could save you thousands.</p>`;

  const historyHTML = validEntries.map((entry, idx) => {
    const isToday = idx === 0 && isActive && entry.date === now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return `
    <div style="margin-bottom:32px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <div style="background:${isToday ? 'rgba(220,38,38,0.2)' : 'rgba(201,146,42,0.15)'};
          border:1px solid ${isToday ? 'rgba(220,38,38,0.4)' : 'rgba(201,146,42,0.3)'};
          color:${isToday ? '#fca5a5' : '#e8b84b'};
          padding:4px 12px;border-radius:100px;font-size:12px;font-weight:600;">
          ${isToday ? '🔴 Today — ' : '📅 '}${entry.date}
        </div>
        <span style="font-size:12px;color:rgba(247,242,235,0.4);">
          ${entry.events.length} event${entry.events.length !== 1 ? 's' : ''} reported
        </span>
      </div>
      <div class="storm-grid">
        ${entry.events.slice(0, 6).map(e => `
        <div class="storm-card ${e.severity || ''}">
          <div class="storm-type ${e.type}">${e.type.toUpperCase()}</div>
          <div class="storm-location">${e.location || 'Reported Location'}</div>
          <div class="storm-detail">${e.description} · ${e.time || ''}</div>
        </div>`).join('')}
        ${entry.events.length > 6 ? `<div class="storm-card" style="display:flex;align-items:center;justify-content:center;color:rgba(247,242,235,0.5);font-size:13px;">+${entry.events.length - 6} more events</div>` : ''}
      </div>
    </div>`;
  }).join('');

  const totalEvents = validEntries.reduce((sum, e) => sum + e.events.length, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${isActive ? 'Active Storm Alert' : 'Recent Storm Damage'} — ${stateName} Roofing | RoofCallNow</title>
<meta name="description" content="${isActive ? 'Active storm damage reported in' : 'Recent storm activity in'} ${stateName}. Get a free roof inspection from a licensed local contractor. Call (866) 466-9261.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500;600&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"></noscript>
<style>
  :root { --navy:#0f1f2e; --gold:#c9922a; --gold-light:#e8b84b; --cream:#f7f2eb; --rust:#b94a2c; --white:#fff; --gray:#6b7280; --red:#dc2626; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'DM Sans',sans-serif; background:var(--cream); color:var(--navy); }
  .alert-bar { background:${alertBarBg}; color:white; text-align:center; padding:12px 20px; font-size:14px; font-weight:600; ${isActive ? 'animation:pulse 2s infinite;' : ''} }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.85} }
  .hero { background:${heroBg}; padding:60px 40px; }
  .hero-inner { max-width:900px; margin:0 auto; }
  .storm-badge { display:inline-flex; align-items:center; gap:8px; background:rgba(220,38,38,0.2); border:1px solid rgba(220,38,38,0.5); color:#fca5a5; padding:6px 14px; border-radius:100px; font-size:13px; font-weight:600; margin-bottom:20px; }
  .last-updated { display:inline-block; background:rgba(201,146,42,0.15); border:1px solid rgba(201,146,42,0.3); color:var(--gold-light); padding:5px 12px; border-radius:100px; font-size:12px; margin-bottom:16px; margin-left:10px; }
  h1 { font-family:'Playfair Display',serif; font-size:clamp(28px,4vw,50px); font-weight:900; color:var(--white); line-height:1.1; margin-bottom:16px; }
  h1 em { font-style:normal; color:${isActive ? '#fca5a5' : 'var(--gold-light)'}; }
  .hero-sub { font-size:16px; color:rgba(247,242,235,0.75); line-height:1.7; margin-bottom:32px; max-width:600px; }
  .call-btn { display:inline-flex; align-items:center; gap:10px; background:linear-gradient(135deg,var(--gold),var(--gold-light)); color:var(--navy); padding:18px 36px; border-radius:12px; font-size:18px; font-weight:700; text-decoration:none; transition:transform 0.15s; }
  .call-btn:hover { transform:translateY(-2px); }
  .content { max-width:900px; margin:0 auto; padding:60px 40px; }
  .section-label { font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--gold); margin-bottom:10px; }
  h2 { font-family:'Playfair Display',serif; font-size:28px; font-weight:900; color:var(--navy); margin-bottom:20px; }
  p { font-size:15px; line-height:1.8; color:#374151; margin-bottom:16px; }
  .storm-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px; margin-bottom:8px; }
  .storm-card { background:white; border-radius:14px; border:1px solid #e9e4da; padding:18px; }
  .storm-card.severe { border-color:#fca5a5; background:#fff5f5; }
  .storm-card.extreme { border-color:var(--red); background:#fff0f0; }
  .storm-type { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; margin-bottom:8px; }
  .storm-type.hail { color:var(--gold); }
  .storm-type.wind { color:#3b82f6; }
  .storm-type.tornado { color:var(--red); }
  .storm-location { font-weight:700; font-size:15px; color:var(--navy); margin-bottom:4px; }
  .storm-detail { font-size:13px; color:var(--gray); }
  .urgency-box { background:var(--navy); border-radius:16px; padding:32px; margin:40px 0; text-align:center; }
  .urgency-box h3 { font-family:'Playfair Display',serif; font-size:24px; color:var(--white); margin-bottom:12px; }
  .urgency-box p { color:rgba(247,242,235,0.7); margin-bottom:24px; font-size:15px; }
  .steps { display:grid; grid-template-columns:repeat(3,1fr); gap:20px; margin:32px 0; }
  .step { background:white; border-radius:14px; padding:22px; border:1px solid #e9e4da; }
  .step-num { width:34px; height:34px; background:var(--navy); color:var(--gold-light); border-radius:10px; display:flex; align-items:center; justify-content:center; font-family:'Playfair Display',serif; font-size:17px; font-weight:900; margin-bottom:12px; }
  .step h4 { font-size:14px; font-weight:700; margin-bottom:6px; }
  .step p { font-size:13px; margin:0; }
  .stats-strip { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin:32px 0; }
  .stat-box { background:white; border-radius:12px; border:1px solid #e9e4da; padding:20px; text-align:center; }
  .stat-num { font-family:'Playfair Display',serif; font-size:28px; font-weight:900; color:var(--navy); }
  .stat-label { font-size:12px; color:var(--gray); margin-top:4px; }
  .bottom-cta { background:${isActive ? 'linear-gradient(135deg,#dc2626,#991b1b)' : 'linear-gradient(135deg,var(--gold),var(--gold-light))'}; padding:50px 40px; text-align:center; }
  .bottom-cta h2 { font-family:'Playfair Display',serif; font-size:clamp(24px,3vw,38px); color:${isActive ? 'white' : 'var(--navy)'}; margin-bottom:10px; }
  .bottom-cta p { color:${isActive ? 'rgba(255,255,255,0.75)' : 'rgba(15,31,46,0.7)'}; margin-bottom:28px; }
  footer { background:var(--navy); padding:20px 40px; text-align:center; font-size:12px; color:rgba(247,242,235,0.35); }
  footer a { color:rgba(247,242,235,0.4); text-decoration:none; }
  @media(max-width:768px) { .steps{grid-template-columns:1fr;} .stats-strip{grid-template-columns:1fr 1fr;} .content{padding:40px 24px;} .hero{padding:40px 24px;} }
</style>
</head>
<body>

<!--STORM_HISTORY:${JSON.stringify(updatedHistory)}-->

<div class="alert-bar">${alertBarText}</div>

<div class="hero">
  <div class="hero-inner">
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
      ${statusBadge}
      <div class="last-updated">Last updated: ${lastUpdatedStr}</div>
    </div>
    <h1>${headline.replace(stateName, `<em>${stateName}</em>`)}</h1>
    <p class="hero-sub">${isActive
      ? `NOAA storm reports show significant weather activity in ${stateName} today. Hail, high winds, and severe storms can cause serious roof damage that isn't visible from the ground.`
      : `Storm activity has been reported in ${stateName} recently. Roof damage from storms may not be visible but can worsen quickly — especially with additional rain.`
    }</p>
    <a href="tel:+18664669261" class="call-btn">📞 Call (866) 466-9261 — Free Inspection</a>
  </div>
</div>

<div class="content">
  <div class="stats-strip">
    <div class="stat-box">
      <div class="stat-num">${totalEvents}</div>
      <div class="stat-label">Storm Events (7 days)</div>
    </div>
    <div class="stat-box">
      <div class="stat-num">${validEntries.length}</div>
      <div class="stat-label">Days With Activity</div>
    </div>
    <div class="stat-box">
      <div class="stat-num">${isActive ? 'Active' : 'Recent'}</div>
      <div class="stat-label">Alert Status</div>
    </div>
  </div>

  <div class="section-label">Storm History — ${stateName} — Last 7 Days</div>
  <h2>${isActive ? "Today's Storm Reports + Recent History" : "Recent Storm Activity"}</h2>
  <p>The following storm events were recorded by NOAA's Storm Prediction Center in ${stateName}.</p>

  ${historyHTML}

  <div class="urgency-box">
    ${urgencyContent}
    <a href="tel:+18664669261" class="call-btn" style="display:inline-flex;">📞 Get a Free Inspection Now</a>
  </div>

  <div class="section-label">How It Works</div>
  <h2>Get Your ${stateName} Roof Inspected Today</h2>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><h4>Call Us Now</h4><p>Call (866) 466-9261 — we'll connect you with an available ${stateName} contractor immediately.</p></div>
    <div class="step"><div class="step-num">2</div><h4>Free Inspection</h4><p>A licensed contractor inspects your roof at no charge and documents any storm damage found.</p></div>
    <div class="step"><div class="step-num">3</div><h4>Insurance Help</h4><p>Your contractor helps you understand your claim options. Most storm repairs cost nothing out of pocket.</p></div>
  </div>
</div>

<div class="bottom-cta">
  <h2>${isActive ? "Don't Wait — Storm Damage Gets Worse" : "Recent Storm? Get a Free Inspection"}</h2>
  <p>Free inspection · Licensed & insured contractors · No obligation</p>
  <a href="tel:+18664669261" class="call-btn" style="background:${isActive ? 'white' : 'var(--navy)'};color:${isActive ? 'var(--navy)' : 'white'};">📞 Call (866) 466-9261</a>
</div>

<footer>
  © 2026 RoofCallNow LLC · Wyoming ·
  <a href="index.html">Home</a> ·
  <a href="privacy-policy.html">Privacy Policy</a> ·
  <a href="terms.html">Terms of Service</a>
  <br><br>Storm data sourced from NOAA Storm Prediction Center. Updated hourly.
</footer>

</body>
</html>`;
}

// ─── PUSH TO GITHUB ────────────────────────────────────────────────────────────
async function pushToGitHub(filename, content, existingSha) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  const apiUrl = `https://api.github.com/repos/${repo}/contents/${filename}`;
  const body = {
    message: `Refresh storm page status: ${filename} — ${new Date().toISOString()}`,
    content: Buffer.from(content).toString('base64'),
    ...(existingSha ? { sha: existingSha } : {})
  };

  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return res.ok;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  console.log('Refresh pages running:', new Date().toISOString());

  try {
    const stormPages = await fetchStormPages();
    console.log(`Found ${stormPages.length} existing storm pages`);

    if (stormPages.length === 0) {
      return res.status(200).json({ message: 'No storm pages found to refresh', pages: 0 });
    }

    const results = [];

    for (const file of stormPages) {
      const history = await fetchPageHistory(file);

      if (!history) {
        console.log(`${file.name} — no history data found, skipping`);
        results.push({ file: file.name, status: 'skipped — no history' });
        continue;
      }

      const newHtml = regeneratePage(history);

      if (!newHtml) {
        console.log(`${file.name} — all events older than 7 days, marking as expired`);
        results.push({ file: file.name, status: 'expired — no recent events' });
        continue;
      }

      const pushed = await pushToGitHub(file.name, newHtml, file.sha);
      const now = new Date();
      const mostRecent = new Date(history.entries[0]?.dateISO);
      const hoursSince = (now - mostRecent) / (1000 * 60 * 60);
      const status = hoursSince < 24 ? 'active' : 'recent';

      console.log(`${file.name} — refreshed as ${status}`);
      results.push({ file: file.name, status: pushed ? `refreshed — ${status}` : 'push failed' });
    }

    return res.status(200).json({
      success: true,
      pagesProcessed: stormPages.length,
      results,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ error: err.message });
  }
}
