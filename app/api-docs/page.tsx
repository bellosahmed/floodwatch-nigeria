export const metadata = { title: "For partners · FloodWatch Community" };

export default function ApiDocs() {
  return (
    <>
      <h1>For governments and partners</h1>
      <p className="lead">
        The risk level combines two layers. The <b>forecast layer</b> (public rainfall and river-flow models) gives
        early warning. The <b>ground layer</b> (community reports and partner gauges, data this service owns) confirms
        it. If the forecast source is down, the app keeps working on the ground layer alone and says so in{" "}
        <code>forecastAvailable</code>.
      </p>

      <h2>Read the risk feed (public)</h2>
      <pre><code>{`GET /api/risk               all states + FCT (merged level; see "forecast" and "ground" per state)
GET /api/risk?state=lagos   one state
GET /api/risk?min=2         High (2) and Severe (3) only`}</code></pre>
      <p>
        Levels: <code>0</code> No reports, <code>1</code> Watch, <code>2</code> High, <code>3</code> Severe. Each state
        also carries <code>confidence</code> (none, unverified, corroborated) and the counts behind the level.
      </p>

      <h2>Local governments and heat (public)</h2>
      <pre><code>{`GET /api/lga?state=kano               LGAs ranked by flood outlook
GET /api/lga?state=kano&hazard=heat    LGAs ranked by heat outlook
GET /api/lgas?state=kano               the state's LGAs (static list)`}</code></pre>
      <p>
        Each LGA has a 16-day outlook with its first-affected date, peak level and day-by-day levels. LGAs are scored
        from rainfall and temperature only (no river flow) at one representative point inside the LGA. In{" "}
        <code>/api/risk</code>, each state also carries <code>forecast.heat</code> and, per day,{" "}
        <code>heatLevel</code>, <code>heatwave</code> and the previous 30 days (<code>phase: &quot;past&quot;</code>).
      </p>

      <h2>Typical months (public)</h2>
      <pre><code>{`GET /api/climatology?state=lagos`}</code></pre>
      <p>
        Twelve typical months for a state, from 10 years of rainfall records: average rainfall, heavy-rain days and a
        season label. Each state in <code>/api/risk</code> also carries a 16-entry <code>forecast.days</code> list
        (date, level, rainfall, confidence) for the day-by-day calendar. Typical months are <b>not</b> a forecast for
        a particular year.
      </p>

      <h2>Send river gauge readings (partners, needs a key)</h2>
      <pre><code>{`POST /api/gauges
x-api-key: <GAUGE_API_KEY>
{ "state": "benue", "station": "Makurdi bridge",
  "levelM": 11.2, "warningM": 10.5, "dangerM": 12.0 }`}</code></pre>
      <p>A reading at or above <code>warningM</code> sets High, and at or above <code>dangerM</code> sets Severe.</p>

      <h2>Submit a community report</h2>
      <pre><code>{`POST /api/reports
{ "state": "lagos", "area": "Ajegunle, Mile 2", "severity": 2,
  "note": "optional", "deviceId": "<stable anonymous id>" }`}</code></pre>

      <h2>Limits</h2>
      <ul>
        <li>The forecast layer uses Open-Meteo&apos;s free tier, which is non-commercial. A paid or licensed data source is needed for commercial or government deployments.</li>
        <li>Coverage depends entirely on how many people report. Quiet does not mean safe.</li>
        <li>Anonymous reports can be wrong or malicious. Distinct devices count once and a device is capped at 5 reports an hour, but a determined attacker could still fake several devices. Gauges and agency staff are the trusted layer.</li>
        <li>The file-based store is for a pilot. Move to Postgres before real traffic.</li>
      </ul>
    </>
  );
}
