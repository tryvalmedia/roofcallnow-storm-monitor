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
            state: cols[3]?.trim(),
            location: cols[4]?.trim(),
            size: size,
            description: `${size}" hail`,
            severity: size >= 2.0 ? 'extreme' : size >= 1.0 ? 'severe' : 'moderate',
            lat: parseFloat(cols[6]) || null,
            lon: parseFloat(cols[7]) || null
          });
        }
      } else if (type === 'wind') {
        const speed = parseInt(cols[5]) || 0;
        if (speed >= CONFIG.minWindSpeed) {
          events.push({
            type: 'wind',
            time: cols[0]?.trim(),
            state: cols[3]?.trim(),
            location: cols[4]?.trim(),
            speed: speed,
            description: `${speed} mph winds`,
            severity: speed >= 75 ? 'extreme' : speed >= 65 ? 'severe' : 'moderate',
            lat: parseFloat(cols[6]) || null,
            lon: parseFloat(cols[7]) || null
          });
        }
      } else if (type === 'tornado') {
        events.push({
          type: 'tornado',
          time: cols[0]?.trim(),
          state: cols[3]?.trim(),
          location: cols[4]?.trim(),
          fscale: cols[5]?.trim(),
          description: `${cols[5]?.trim() || 'EF?'} tornado`,
          severity: 'extreme',
          lat: parseFloat(cols[6]) || null,
          lon: parseFloat(cols[7]) || null
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

// ─── GENERATE STORM ALERT PAGE HTML ───────────────────────────────────────────
function generateStormPage(stateName, stateCode, events) {
  const hailEvents = events.filter(e => e.type === 'hail');
  const windEvents = events.filter(e => e.type === 'wind');
  const tornadoEvents = events.filter(e => e.type === 'tornado');
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const headline = tornadoEvents.length > 0
    ? `Tornado Reported in ${stateName} — Check Your Roof Now`
    : hailEvents.length > 0
    ? `Hail Reported in ${stateName} — Get Your Roof Inspected`
    : `Severe Wind Damage Reported in ${stateName}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Storm Damage Roofing Help — ${stateName} | RoofCallNow</title>
<meta name="description" content="Storm damage reported in ${stateName} on ${today}. Get a free roof inspection from a licensed local contractor. Call (866) 466-9261 now.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500;600&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"></noscript>
<style>
  :root { --navy:#0f1f2e; --gold:#c9922a; --gold-light:#e8b84b; --cream:#f7f2eb; --rust:#b94a2c; --white:#fff; --gray:#6b7280; --red:#dc2626; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'DM Sans',sans-serif; background:var(--cream); color:var(--navy); }
  .alert-bar { background:var(--red); color:white; text-align:center; padding:12px 20px; font-size:14px; font-weight:600; letter-spacing:0.02em; animation:pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.85} }
  .hero { background:linear-gradient(135deg,#1a0a0a 0%,#2d1515 60%,#1a0a0a 100%); padding:60px 40px; }
  .hero-inner { max-width:900px; margin:0 auto; }
  .storm-badge { display:inline-flex; align-items:center; gap:8px; background:rgba(220,38,38,0.2); border:1px solid rgba(220,38,38,0.5); color:#fca5a5; padding:6px 14px; border-radius:100px; font-size:13px; font-weight:600; margin-bottom:20px; }
  .date-pill { display:inline-block; background:rgba(201,146,42,0.15); border:1px solid rgba(201,146,42,0.3); color:var(--gold-light); padding:5px 12px; border-radius:100px; font-size:12px; margin-bottom:16px; margin-left:10px; }
  h1 { font-family:'Playfair Display',serif; font-size:clamp(28px,4vw,50px); font-weight:900; color:var(--white); line-height:1.1; margin-bottom:16px; }
  h1 em { font-style:normal; color:#fca5a5; }
  .hero-sub { font-size:16px; color:rgba(247,242,235,0.75); line-height:1.7; margin-bottom:32px; max-width:600px; }
  .call-btn { display:inline-flex; align-items:center; gap:10px; background:linear-gradient(135deg,var(--gold),var(--gold-light)); color:var(--navy); padding:18px 36px; border-radius:12px; font-size:18px; font-weight:700; text-decoration:none; transition:transform 0.15s; }
  .call-btn:hover { transform:translateY(-2px); }
  .content { max-width:900px; margin:0 auto; padding:60px 40px; }
  .section-label { font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--gold); margin-bottom:10px; }
  h2 { font-family:'Playfair Display',serif; font-size:28px; font-weight:900; color:var(--navy); margin-bottom:20px; }
  p { font-size:15px; line-height:1.8; color:#374151; margin-bottom:16px; }
  .storm-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; margin:28px 0; }
  .storm-card { background:white; border-radius:14px; border:1px solid #e9e4da; padding:20px; }
  .storm-card.severe { border-color:#fca5a5; background:#fff5f5; }
  .storm-card.extreme { border-color:var(--red); background:#fff0f0; }
  .storm-type { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; margin-bottom:8px; }
  .storm-type.hail { color:var(--gold); }
  .storm-type.wind { color:#3b82f6; }
  .storm-type.tornado { color:var(--red); }
  .storm-location { font-weight:700; font-size:16px; color:var(--navy); margin-bottom:4px; }
  .storm-detail { font-size:13px; color:var(--gray); }
  .urgency-box { background:var(--navy); border-radius:16px; padding:32px; margin:40px 0; text-align:center; }
  .urgency-box h3 { font-family:'Playfair Display',serif; font-size:24px; color:var(--white); margin-bottom:12px; }
  .urgency-box p { color:rgba(247,242,235,0.7); margin-bottom:24px; font-size:15px; }
  .steps { display:grid; grid-template-columns:repeat(3,1fr); gap:20px; margin:32px 0; }
  .step { background:white; border-radius:14px; padding:22px; border:1px solid #e9e4da; }
  .step-num { width:34px; height:34px; background:var(--navy); color:var(--gold-light); border-radius:10px; display:flex; align-items:center; justify-content:center; font-family:'Playfair Display',serif; font-size:17px; font-weight:900; margin-bottom:12px; }
  .step h4 { font-size:14px; font-weight:700; margin-bottom:6px; }
  .step p { font-size:13px; margin:0; }
  .bottom-cta { background:linear-gradient(135deg,var(--red),#991b1b); padding:50px 40px; text-align:center; }
  .bottom-cta h2 { font-family:'Playfair Display',serif; font-size:clamp(24px,3vw,38px); color:white; margin-bottom:10px; }
  .bottom-cta p { color:rgba(255,255,255,0.75); margin-bottom:28px; }
  footer { background:var(--navy); padding:20px 40px; text-align:center; font-size:12px; color:rgba(247,242,235,0.35); }
  footer a { color:rgba(247,242,235,0.4); text-decoration:none; }
  @media(max-width:768px) { .steps{grid-template-columns:1fr;} .content{padding:40px 24px;} .hero{padding:40px 24px;} }
</style>
</head>
<body>

<div class="alert-bar">⚠️ ACTIVE STORM ALERT — ${stateName} — Roof damage may have occurred in your area</div>

<div class="hero">
  <div class="hero-inner">
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
      <div class="storm-badge">🌩️ Storm Alert</div>
      <div class="date-pill">${today}</div>
    </div>
    <h1>${headline.replace(stateName, `<em>${stateName}</em>`)}</h1>
    <p class="hero-sub">NOAA storm reports show significant weather activity in ${stateName} today. Hail, high winds, and severe storms can cause serious roof damage that isn't visible from the ground — and waiting to inspect can turn a $500 repair into a $15,000 replacement.</p>
    <a href="tel:+18664669261" class="call-btn">📞 Call (866) 466-9261 — Free Inspection</a>
  </div>
</div>

<div class="content">
  <div class="section-label">Today's Storm Reports — ${stateName}</div>
  <h2>What Was Reported in ${stateName}</h2>
  <p>The following storm events were recorded by NOAA's Storm Prediction Center in ${stateName} today. Each of these events is capable of causing significant roof damage.</p>

  <div class="storm-grid">
    ${events.slice(0, 12).map(e => `
    <div class="storm-card ${e.severity}">
      <div class="storm-type ${e.type}">${e.type.toUpperCase()}</div>
      <div class="storm-location">${e.location || 'Reported Location'}</div>
      <div class="storm-detail">${e.description} · ${e.time || 'Today'}</div>
    </div>`).join('')}
  </div>

  <div class="urgency-box">
    <h3>Why You Need to Act Within 48 Hours</h3>
    <p>Insurance claims for storm damage must typically be filed within 12 months — but the documentation window is now. A licensed inspector can identify damage, photograph it, and help you file a claim before evidence degrades. Most homeowner's insurance policies cover hail and wind damage with no out-of-pocket cost beyond your deductible.</p>
    <a href="tel:+18664669261" class="call-btn" style="display:inline-flex;">📞 Get a Free Inspection Now</a>
  </div>

  <div class="section-label">How It Works</div>
  <h2>Get Your ${stateName} Roof Inspected Today</h2>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><h4>Call Us Now</h4><p>Call (866) 466-9261 — we'll connect you with an available ${stateName} contractor immediately.</p></div>
    <div class="step"><div class="step-num">2</div><h4>Free Inspection</h4><p>A licensed contractor inspects your roof at no charge and documents any storm damage found.</p></div>
    <div class="step"><div class="step-num">3</div><h4>Insurance Help</h4><p>Your contractor helps you understand your claim options. Most storm repairs cost you nothing out of pocket.</p></div>
  </div>
</div>

<div class="bottom-cta">
  <h2>Don't Wait — Storm Damage Gets Worse</h2>
  <p>Free inspection · Licensed & insured contractors · No obligation</p>
  <a href="tel:+18664669261" class="call-btn" style="background:white;color:var(--navy);">📞 Call (866) 466-9261</a>
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
  const repo = process.env.GITHUB_REPO; // format: "username/reponame"
  if (!token || !repo) {
    console.log('GitHub not configured — skipping page push');
    return;
  }

  const apiUrl = `https://api.github.com/repos/${repo}/contents/${filename}`;

  // Check if file exists to get SHA for update
  let sha;
  try {
    const check = await fetch(apiUrl, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' }
    });
    if (check.ok) {
      const data = await check.json();
      sha = data.sha;
    }
  } catch (e) {}

  const body = {
    message: `Storm alert: ${filename} — ${new Date().toISOString()}`,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {})
  };

  await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  console.log(`Pushed ${filename} to GitHub`);
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Allow manual trigger via GET, or automatic via cron
  console.log('Storm monitor running:', new Date().toISOString());

  try {
    // Fetch all storm data from NOAA in parallel
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

    // Parse all events
    const allEvents = [
      ...parseNoaaCSV(hailCsv, 'hail'),
      ...parseNoaaCSV(windCsv, 'wind'),
      ...parseNoaaCSV(tornCsv, 'tornado')
    ];

    console.log(`Found ${allEvents.length} qualifying storm events`);

    if (allEvents.length === 0) {
      return res.status(200).json({ message: 'No significant storms today', events: 0 });
    }

    // Group by state
    const byState = groupByState(allEvents);
    const affectedStates = Object.keys(byState);

    console.log(`Affected states: ${affectedStates.join(', ')}`);

    // Generate and push a storm alert page for each affected state
    const pagesPushed = [];
    for (const stateCode of affectedStates) {
      const stateName = STATE_NAMES[stateCode] || stateCode;
      const events = byState[stateCode];
      const filename = `storm-alert-${stateCode.toLowerCase()}.html`;
      const html = generateStormPage(stateName, stateCode, events);
      await pushToGitHub(filename, html);
      pagesPushed.push(filename);
    }

    // Send email alert
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

<----> comment text
