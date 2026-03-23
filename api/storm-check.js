// api/storm-check.js
// Called by the landing page on load
// Returns active storm alert for visitor's state if one exists

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600'); // Cache for 1 hour

  const { state } = req.query;
  if (!state) return res.status(200).json({ alert: null });

  const stateCode = state.toUpperCase();

  // Check NOAA for today's storms in this state
  try {
    const [hailRes, windRes, tornRes] = await Promise.all([
      fetch('https://www.spc.noaa.gov/climo/reports/today_hail.csv'),
      fetch('https://www.spc.noaa.gov/climo/reports/today_wind.csv'),
      fetch('https://www.spc.noaa.gov/climo/reports/today_torn.csv')
    ]);

    const [hailCsv, windCsv, tornCsv] = await Promise.all([
      hailRes.text(), windRes.text(), tornRes.text()
    ]);

    // Quick check — does this state appear in any report?
    const stateInHail = hailCsv.includes(`,${stateCode},`);
    const stateInWind = windCsv.includes(`,${stateCode},`);
    const stateInTorn = tornCsv.includes(`,${stateCode},`);

    if (!stateInHail && !stateInWind && !stateInTorn) {
      return res.status(200).json({ alert: null });
    }

    // Build alert message
    const types = [];
    if (stateInTorn) types.push('tornado activity');
    if (stateInHail) types.push('hail');
    if (stateInWind) types.push('high winds');

    const stormType = types[0];
    const alertPageSlug = `storm-alert-${stateCode.toLowerCase()}.html`;

    return res.status(200).json({
      alert: {
        state: stateCode,
        types,
        message: `⚠️ ${stormType.charAt(0).toUpperCase() + stormType.slice(1)} reported in your area today — roof damage may have occurred`,
        urgency: stateInTorn ? 'extreme' : stateInHail ? 'high' : 'moderate',
        alertPageUrl: `/${alertPageSlug}`,
        ctaText: 'Get a Free Inspection Now'
      }
    });

  } catch (err) {
    return res.status(200).json({ alert: null });
  }
}


