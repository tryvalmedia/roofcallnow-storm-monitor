// api/storm-check.js
// Called by the landing page on load
// Returns active storm alert for visitor's state if one exists

// Map state codes to full names as NOAA uses them in CSV (ALL CAPS)
const STATE_FULL_NAMES = {
  AL:'ALABAMA', AK:'ALASKA', AZ:'ARIZONA', AR:'ARKANSAS', CA:'CALIFORNIA',
  CO:'COLORADO', CT:'CONNECTICUT', DE:'DELAWARE', FL:'FLORIDA', GA:'GEORGIA',
  HI:'HAWAII', ID:'IDAHO', IL:'ILLINOIS', IN:'INDIANA', IA:'IOWA', KS:'KANSAS',
  KY:'KENTUCKY', LA:'LOUISIANA', ME:'MAINE', MD:'MARYLAND', MA:'MASSACHUSETTS',
  MI:'MICHIGAN', MN:'MINNESOTA', MS:'MISSISSIPPI', MO:'MISSOURI', MT:'MONTANA',
  NE:'NEBRASKA', NV:'NEVADA', NH:'NEW HAMPSHIRE', NJ:'NEW JERSEY', NM:'NEW MEXICO',
  NY:'NEW YORK', NC:'NORTH CAROLINA', ND:'NORTH DAKOTA', OH:'OHIO', OK:'OKLAHOMA',
  OR:'OREGON', PA:'PENNSYLVANIA', RI:'RHODE ISLAND', SC:'SOUTH CAROLINA',
  SD:'SOUTH DAKOTA', TN:'TENNESSEE', TX:'TEXAS', UT:'UTAH', VT:'VERMONT',
  VA:'VIRGINIA', WA:'WASHINGTON', WV:'WEST VIRGINIA', WI:'WISCONSIN', WY:'WYOMING'
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600'); // Cache for 1 hour

  const { state } = req.query;
  if (!state) return res.status(200).json({ alert: null });

  const stateCode = state.toUpperCase();
  const stateFullName = STATE_FULL_NAMES[stateCode];
  if (!stateFullName) return res.status(200).json({ alert: null });

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

    // NOAA CSV uses two-letter state codes e.g. "OH", "TX", "IN"
    // Format: Time,Size,Location,County,State,Lat,Lon,Comments
    // We check for ,OH, pattern (with commas) to avoid partial matches
    const stateInHail = hailCsv.includes(`,${stateCode},`);
    const stateInWind = windCsv.includes(`,${stateCode},`);
    const stateInTorn = tornCsv.includes(`,${stateCode},`);

    // Debug mode — add ?debug=1 to see raw CSV snippet
    if (req.query.debug) {
      return res.status(200).json({
        stateCode,
        hailSnippet: hailCsv.substring(0, 500),
        windSnippet: windCsv.substring(0, 500),
        stateInHail,
        stateInWind,
        stateInTorn
      });
    }

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
