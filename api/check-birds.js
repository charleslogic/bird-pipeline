import { google } from "googleapis";

// 1. CONFIGURATION & ENVIRONMENT
const EBIRD_API_KEY = process.env.EBIRD_API_KEY;
const SPREADSHEET_ID = process.env.SHEET_ID;
const AMY_SHEET_ID = process.env.SHEET_ID_AMY;
const GOOGLE_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_KEY = process.env.GOOGLE_PRIVATE_KEY;

// Location: Arlington, TX
const LAT = 32.7357;
const LNG = -97.1081;

// North Texas Regions (Tarrant, Dallas, Denton, Collin)
const REGIONS = ["US-TX-439", "US-TX-113", "US-TX-121", "US-TX-085"];

// 2. GOOGLE SHEETS AUTH
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: GOOGLE_EMAIL,
    private_key: GOOGLE_KEY ? GOOGLE_KEY.replace(/\\n/g, "\n") : undefined,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// 3. HELPER FUNCTIONS
async function fetchEbirdRegion(endpoint, regionCode) {
  const url = `https://api.ebird.org/v2/data/obs/${regionCode}/${endpoint}?back=7&maxResults=10000`;
  const res = await fetch(url, { headers: { "X-eBirdApiToken": EBIRD_API_KEY } });
  if (!res.ok) return [];
  return res.json();
}

async function fetchINat() {
  const url = `https://api.inaturalist.org/v1/observations?taxon_id=3&lat=${LAT}&lng=${LNG}&radius=60&per_page=200&order=desc&order_by=observed_on`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}

async function fetchLifeList(id) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: "'ABA_Checklist-8.12.csv'!A3:H", 
  });
  const rows = response.data.values;
  if (!rows || rows.length === 0) return [];
  const headers = rows[0]; 
  return rows.slice(1).map(row => {
    let obj = {};
    headers.forEach((header, i) => { obj[header] = row[i]; });
    return obj;
  });
}

async function writeToSheet(tabName, data) {
  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `${tabName}!A:Z` });
  if (!data || data.length === 0) return;
  const keys = Array.from(new Set(data.flatMap(obj => Object.keys(obj))));
  const rows = data.map(obj => keys.map(k => typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : (obj[k] ?? "")));
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [keys, ...rows] }
  });
}

async function appendToLog(tabName, logEntry) {
  const values = [Object.values(logEntry)];
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values }
  });
}

// 4. MAIN HANDLER
export default async function handler(req, res) {
  const startTime = Date.now();
  const isCron = req.headers['x-vercel-cron'] === '1';
  const execType = isCron ? "CRON" : "MANUAL";
  
  try {
    const [inatRaw, lifeListRaw] = await Promise.all([
      fetchINat(),
      fetchLifeList(AMY_SHEET_ID)
    ]);

    const ebirdPromises = [];
    REGIONS.forEach(reg => {
      ebirdPromises.push(fetchEbirdRegion("recent", reg));
      ebirdPromises.push(fetchEbirdRegion("recent/notable", reg));
    });

    const ebirdDataChunks = await Promise.all(ebirdPromises);
    const recentEbird = ebirdDataChunks.flat();

    const unseenBirds = lifeListRaw.filter(b => !b.Seen || b.Seen.toString().toUpperCase() === 'FALSE');
    const unseenSciNames = new Set(unseenBirds.map(b => b.Latin2?.trim().toLowerCase()).filter(Boolean));
    
    const allMatchesRaw = []; 
    const summaryMap = new Map();
    let ebirdHits = 0;
    let inatHits = 0;

    const processSighting = (s, source) => {
      const sci = (source === "eBird" ? s.sciName : s.taxon?.name);
      if (!sci) return;
      const key = sci.toLowerCase();
      
      if (unseenSciNames.has(key)) {
        const sighting = {
          pk_id: source === "eBird" ? s.subId : s.id,
          bird: source === "eBird" ? s.comName : (s.taxon?.preferred_common_name || sci),
          scientific: sci,
          lat: source === "eBird" ? s.lat : s.location?.split(',')[0],
          lng: source === "eBird" ? s.lng : s.location?.split(',')[1],
          location: source === "eBird" ? s.locName : (s.place_guess || "iNat Spot"),
          date_observed: source === "eBird" ? s.obsDt : (s.time_observed_at || s.observed_on_string || s.observed_on),
          is_private: source === "eBird" ? (s.locationPrivate ? "YES" : "NO") : (s.geoprivacy ? "YES" : "NO"),
          source: source,
          link: source === "eBird" ? `https://ebird.org/checklist/${s.subId}` : s.uri
        };

        allMatchesRaw.push(sighting);
        if (source === "eBird") ebirdHits++; else inatHits++;

        if (summaryMap.has(key)) {
          const entry = summaryMap.get(key);
          entry.sighting_count++;
          if (new Date(sighting.date_observed) > new Date(entry.date_observed)) {
            Object.assign(entry, sighting, { sighting_count: entry.sighting_count });
          }
        } else {
          summaryMap.set(key, { ...sighting, sighting_count: 1 });
        }
      }
    };

    recentEbird.forEach(s => processSighting(s, "eBird"));
    inatRaw.forEach(s => processSighting(s, "iNat"));

    const summaryList = Array.from(summaryMap.values());
    summaryList.sort((a, b) => a.bird.localeCompare(b.bird));
    allMatchesRaw.sort((a, b) => new Date(b.date_observed) - new Date(a.date_observed));

    // Write to all three functional tabs
    await writeToSheet("life_list_matches", summaryList);
    await writeToSheet("life_list_all_leads", allMatchesRaw);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    const logEntry = {
      timestamp: new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }),
      type: execType,
      runtime_sec: duration,
      processed: (recentEbird.length + inatRaw.length),
      unique_matches: summaryList.length,
      total_leads: allMatchesRaw.length,
      ebird_hits: ebirdHits,
      inat_hits: inatHits,
      status: "SUCCESS"
    };

    await appendToLog("system_log", logEntry);
    res.status(200).json({ success: true, matches: summaryList.length, leads: allMatchesRaw.length });

  } catch (err) {
    const errorTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const errorEntry = {
      timestamp: new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }),
      type: execType,
      runtime_sec: errorTime,
      processed: 0,
      unique_matches: 0,
      total_leads: 0,
      ebird_hits: 0,
      inat_hits: 0,
      status: "ERROR",
      message: err.message
    };
    await appendToLog("system_log", errorEntry);
    res.status(500).json({ error: err.message });
  }
}