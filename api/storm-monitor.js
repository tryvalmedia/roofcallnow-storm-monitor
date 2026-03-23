// api/storm-monitor.js
// Vercel Cron Job — runs every hour automatically
// Pulls real storm data from NOAA SPC and alerts you by email

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
const CONFIG = {
  alertEmail: process.env.ALERT_EMAIL,           // Your email — set in Vercel env vars
  fromEmail: process.env.FROM_EMAIL,             // Sendgrid verified sender email
  sendgridKey: process.env.SENDGRID_API_KEY,     // Free Sendgrid API key
  siteUrl: 'https://roofcallnow.com',
  phone: '(866) 466-9261',

  // Minimum severity thresholds
  minHailSize: 0.75,    // inches — 0.75" = penny size, causes roof damage
  minWindSpeed: 50,     // mph
  stormTypes: ['hail', 'wind', 'tornado', 'hurricane']
};

// ─── NOAA SPC DATA SOURCES (all free, no API key) ─────────────────────────────
// SPC publishes storm reports daily in CSV format
const NOAA_SOURCES = {
  hail: 'https://www.spc.noaa.gov/climo/reports/today_hail.csv',
  wind: 'https://www.spc.noaa.gov/climo/reports/today_wind.csv',
  tornado: 'https://www.spc.noaa.gov/climo/reports/today_torn.csv'
};

// State code to full name mapping
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

// ─── PARSE NOAA CSV ────────────────────────────────────────────────────────────
function parseNoaaCSV(csv, type) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const events = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 6) continue;

    try {
      if (type === 'hail') {
        const size = parseFloat(cols[5]) || 0;
        if (size >= CONFIG.minHailSize) {
          events.push({
            type: 'hail',
            time: cols[0]?.trim(),
            state: cols[4]?.trim(),
            location: cols[2]?.trim(),
            size: size,
            description: `${size}" hail`,
            severity: size >= 2.0 ? 'extreme' : size >= 1.0 ? 'severe' : 'moderate',
            lat: parseFloat(cols[5]) || null,
            lon: parseFloat(cols[6]) || null
          });
        }
      } else if (type === 'wind') {
        const speed = parseInt(cols[1]) || 0;
        if (speed >= CONFIG.minWindSpeed) {
          events.push({
            type: 'wind',
            time: cols[0]?.trim(),
            state: cols[4]?.trim(),
            location: cols[2]?.trim(),
            speed: speed,
            description: `${speed} mph winds`,
            severity: speed >= 75 ? 'extreme' : speed >= 65 ? 'severe' : 'moderate',
            lat: parseFloat(cols[5]) || null,
            lon: parseFloat(cols[6]) || null
          });
        }
      } else if (type === 'tornado') {
        events.push({
          type: 'tornado',
          time: cols[0]?.trim(),
          state: cols[4]?.trim(),
          location: cols[2]?.trim(),
          fscale: cols[1]?.trim(),
          description: `${cols[1]?.trim() || 'EF?'} tornado`,
          severity: 'extreme',
          lat: parseFloat(cols[5]) || null,
          lon: parseFloat(cols[6]) || null
        });
      }
    } catch (e) {
      continue;
    }
  }

  return events;
}

// ─── GROUP EVENTS BY STATE ─────────────────────────────────────────────────────
function groupByState(events) {
  const byState = {};
  events.forEach(e => {
    if (!e.state) return;
    if (!byState[e.state]) byState[e.state] = [];
    byState[e.state].push(e);
  });
  return byState;
}

// ─── FETCH EXISTING PAGE DATA FROM GITHUB ─────────────────────────────────────
async function fetchExistingPageData(filename) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return null;

  try {
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${filename}`;
    const res = await fetch(apiUrl, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Decode existing content and extract storm history JSON from it
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    const match = content.match(/<!--STORM_HISTORY:(.*?)-->/s);
    if (match) {
      return JSON.parse(match[1]);
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ─── GENERATE STORM ALERT PAGE WITH ROLLING HISTORY ───────────────────────────
function generateStormPage(stateName, stateCode, newEvents, existingHistory) {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const nowISO = now.toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Build updated history — merge today's events with existing, drop entries older than 7 days
  const todayEntry = {
    date: todayStr,
    dateISO: nowISO,
    events: newEvents
  };

  let history = existingHistory ? existingHistory.entries || [] : [];

  // Remove entries older than 7 days
  history = history.filter(entry => new Date(entry.dateISO) > sevenDaysAgo);

  // Remove today's entry if it exists (we'll replace with fresh data)
  history = history.filter(entry => entry.date !== todayStr);

  // Add today's entry at the front
  history.unshift(todayEntry);

  const historyData = { entries: history, lastUpdated: nowISO, state: stateCode, stateName };

  // Determine active vs archive status
  const mostRecentEntry = history[0];
  const mostRecentDate = new Date(mostRecentEntry.dateISO);
  const hoursSinceLastStorm = (now - mostRecentDate) / (1000 * 60 * 60);
  const isActive = hoursSinceLastStorm < 24;

  // Build headline based on most recent event types
  const allNewEvents = newEvents;
  const hailEvents = allNewEvents.filter(e => e.type === 'hail');
  const tornadoEvents = allNewEvents.filter(e => e.type === 'tornado');

  const headline = isActive
    ? tornadoEvents.length > 0
      ? `Tornado Reported in ${stateName} — Check Your Roof Now`
      : hailEvents.length > 0
      ? `Hail Reported in ${stateName} — Get Your Roof Inspected`
      : `Severe Wind Damage Reported in ${stateName}`
    : `Recent Storm Damage in ${stateName} — Get Your Roof Inspected`;

  const alertBarText = isActive
    ? `⚠️ ACTIVE STORM ALERT — ${stateName} — Roof damage may have occurred in your area`
    : `📋 RECENT STORM ACTIVITY — ${stateName} — Storm damage reported in the last 7 days`;

  const alertBarBg = isActive ? '#dc2626' : '#92400e';

  const heroBg = isActive
    ? 'linear-gradient(135deg,#1a0a0a 0%,#2d1515 60%,#1a0a0a 100%)'
    : 'linear-gradient(135deg,#0f1f2e 0%,#1a3a52 60%,#0f2a3e 100%)';

  const statusBadge = isActive
    ? `<div class="storm-badge">🌩️ Active Storm Alert</div>`
    : `<div class="storm-badge" style="background:rgba(146,64,14,0.2);border-color:rgba(146,64,14,0.5);color:#fcd34d;">📋 Recent Storm Activity</div>`;

  const urgencyBoxContent = isActive
    ? `<h3>Why You Need to Act Within 48 Hours</h3>
       <p>Insurance claims for storm damage must typically be filed within 12 months — but the documentation window is now. A licensed inspector can identify damage, photograph it, and help you file a claim before evidence degrades. Most homeowner's insurance policies cover hail and wind damage with no out-of-pocket cost beyond your deductible.</p>`
    : `<h3>Don't Wait — Storm Damage Gets Worse Over Time</h3>
       <p>Even if the storm was a few days ago, roof damage from hail and wind can worsen quickly — especially with rain. Insurance claims are still valid for recent storms. A free inspection costs nothing and could save you thousands if damage is found.</p>`;

  // Generate event cards for all history entries
  const historyHTML = history.map((entry, idx) => {
    const isToday = idx === 0 && isActive;
    const entryHail = entry.events.filter(e => e.type === 'hail');
    const entryWind = entry.events.filter(e => e.type === 'wind');
    const entryTorn = entry.events.filter(e => e.type === 'tornado');

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
        <div class="storm-card ${e.severity}">
          <div class="storm-type ${e.type}">${e.type.toUpperCase()}</div>
          <div class="storm-location">${e.location || 'Reported Location'}</div>
          <div class="storm-detail">${e.description} · ${e.time || 'Today'}</div>
        </div>`).join('')}
        ${entry.events.length > 6 ? `<div class="storm-card" style="display:flex;align-items:center;justify-content:center;color:rgba(247,242,235,0.5);font-size:13px;">+${entry.events.length - 6} more events</div>` : ''}
      </div>
    </div>`;
  }).join('');

  const totalEvents = history.reduce((sum, e) => sum + e.events.length, 0);

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

<!--STORM_HISTORY:${JSON.stringify(historyData)}-->

<div class="alert-bar">${alertBarText}</div>

<div class="hero">
  <div class="hero-inner">
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
      ${statusBadge}
      <div class="last-updated">Last updated: ${todayStr} at ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</div>
    </div>
    <h1>${headline.replace(stateName, `<em>${stateName}</em>`)}</h1>
    <p class="hero-sub">${isActive
      ? `NOAA storm reports show significant weather activity in ${stateName} today. Hail, high winds, and severe storms can cause serious roof damage that isn\'t visible from the ground.`
      : `Storm activity has been reported in ${stateName} over the past 7 days. Roof damage from recent storms may not be visible but can worsen quickly — especially with additional rain.`
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
      <div class="stat-num">${history.length}</div>
      <div class="stat-label">Days With Activity</div>
    </div>
    <div class="stat-box">
      <div class="stat-num">${isActive ? 'Active' : 'Recent'}</div>
      <div class="stat-label">Alert Status</div>
    </div>
  </div>

  <div class="section-label">Storm History — ${stateName} — Last 7 Days</div>
  <h2>${isActive ? "Today's Storm Reports + Recent History" : "Recent Storm Activity"}</h2>
  <p>The following storm events were recorded by NOAA's Storm Prediction Center in ${stateName}. Each of these events is capable of causing significant roof damage.</p>

  ${historyHTML}

  <div class="urgency-box">
    ${urgencyBoxContent}
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

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  console.log('Storm monitor running:', new Date().toISOString());

  try {
    const [hailRes, windRes, tornRes] = await Promise.all([
      fetch(NOAA_SOURCES.hail),
      fetch(NOAA_SOURCES.wind),
      fetch(NOAA_SOURCES.tornado)
    ]);

    const [hailCsv, windCsv, tornCsv] = await Promise.all([
      hailRes.text(),
      windRes.text(),
      tornRes.text()
    ]);

    const allEvents = [
      ...parseNoaaCSV(hailCsv, 'hail'),
      ...parseNoaaCSV(windCsv, 'wind'),
      ...parseNoaaCSV(tornCsv, 'tornado')
    ];

    console.log(`Found ${allEvents.length} qualifying storm events`);

    if (allEvents.length === 0) {
      return res.status(200).json({ message: 'No significant storms today', events: 0 });
    }

    const byState = groupByState(allEvents);
    const affectedStates = Object.keys(byState);

    console.log(`Affected states: ${affectedStates.join(', ')}`);

    const pagesPushed = [];
    for (const stateCode of affectedStates) {
      const stateName = STATE_NAMES[stateCode] || stateCode;
      const events = byState[stateCode];
      const filename = `storm-alert-${stateCode.toLowerCase()}.html`;

      // Fetch existing history for this state page
      const existingHistory = await fetchExistingPageData(filename);

      // Generate page with rolling history
      const html = generateStormPage(stateName, stateCode, events, existingHistory);
      await pushToGitHub(filename, html);
      pagesPushed.push(filename);
    }

    await sendEmailAlert(byState);

    return res.status(200).json({
      success: true,
      eventsFound: allEvents.length,
      statesAffected: affectedStates.length,
      pagesPushed,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('Storm monitor error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ─── SEND EMAIL ALERT VIA SENDGRID ────────────────────────────────────────────
async function sendEmailAlert(stormSummary) {
  if (!CONFIG.sendgridKey || !CONFIG.alertEmail) {
    console.log('SendGrid not configured — skipping email');
    return;
  }

  const stateList = Object.keys(stormSummary).map(state => {
    const events = stormSummary[state];
    const types = [...new Set(events.map(e => e.type))].join(', ');
    const slug = `storm-alert-${state.toLowerCase()}.html`;
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">${STATE_NAMES[state] || state}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${types}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${events.length} events</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;"><a href="${CONFIG.siteUrl}/${slug}">View Alert Page</a></td>
    </tr>`;
  }).join('');

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#0f1f2e;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="color:#e8b84b;font-size:20px;margin:0;">⚡ RoofCallNow Storm Alert</h1>
        <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">${new Date().toLocaleString()}</p>
      </div>
      <div style="background:white;padding:24px;border:1px solid #eee;">
        <p style="font-size:15px;color:#374151;">NOAA has reported significant storm activity in <strong>${Object.keys(stormSummary).length} states</strong> today. Storm alert pages have been generated for each affected state.</p>
        <h2 style="font-size:16px;margin:24px 0 12px;">Affected States</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #eee;">State</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #eee;">Storm Types</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #eee;">Events</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #eee;">Alert Page</th>
            </tr>
          </thead>
          <tbody>${stateList}</tbody>
        </table>
        <div style="margin-top:24px;padding:16px;background:#fefce8;border-radius:8px;border:1px solid #fde68a;">
          <p style="margin:0;font-size:14px;color:#92400e;"><strong>Action recommended:</strong> Consider boosting Google/Facebook ads in affected states today — this is your highest-intent window.</p>
        </div>
      </div>
      <div style="background:#f9fafb;padding:16px 24px;border-radius:0 0 8px 8px;font-size:12px;color:#9ca3af;">
        RoofCallNow LLC · Storm monitoring powered by NOAA SPC
      </div>
    </div>`;

  await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.sendgridKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: CONFIG.alertEmail }] }],
      from: { email: CONFIG.fromEmail || CONFIG.alertEmail, name: 'RoofCallNow Alerts' },
      subject: `⚡ Storm Alert — ${Object.keys(stormSummary).length} states affected — ${new Date().toLocaleDateString()}`,
      content: [{ type: 'text/html', value: html }]
    })
  });
}

// ─── GITHUB PAGES UPDATER ─────────────────────────────────────────────────────
// Pushes generated storm pages directly to your GitHub repo
async function pushToGitHub(filename, content) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    console.log('GitHub not configured — skipping page push');
    return { error: 'not configured' };
  }

  console.log(`Pushing ${filename} to ${repo}...`);
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${filename}`;

  // Check if file exists to get SHA for update
  let sha;
  try {
    const check = await fetch(apiUrl, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    console.log(`SHA check status: ${check.status}`);
    if (check.ok) {
      const data = await check.json();
      sha = data.sha;
      console.log(`File exists, SHA: ${sha}`);
    }
  } catch (e) {
    console.log(`SHA check error: ${e.message}`);
  }

  const body = {
    message: `Storm alert: ${filename} — ${new Date().toISOString()}`,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {})
  };

  try {
    const pushRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const pushData = await pushRes.json();
    if (pushRes.ok) {
      console.log(`✅ Successfully pushed ${filename}`);
      return { success: true };
    } else {
      console.log(`❌ Push failed for ${filename}: ${pushRes.status} — ${JSON.stringify(pushData)}`);
      return { error: pushData.message };
    }
  } catch (e) {
    console.log(`❌ Push exception for ${filename}: ${e.message}`);
    return { error: e.message };
  }
}
