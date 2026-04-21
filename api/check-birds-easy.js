import { google } from "googleapis";

// 1. CONSTANTS & ENV
const EBIRD_API_KEY = process.env.EBIRD_API_KEY;
const SPREADSHEET_ID = process.env.SHEET_ID;
const AMY_SHEET_ID = process.env.SHEET_ID_AMY;
const GOOGLE_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_KEY = process.env.GOOGLE_PRIVATE_KEY;

const LAT = 32.7357;
const LNG = -97.1081;
const DIST = 25;

// 2. AUTH SETUP
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: GOOGLE_EMAIL,
    private_key: GOOGLE_KEY ? GOOGLE_KEY.replace(/\\n/g, "\n") : undefined,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// 3. HELPER FUNCTIONS
async function fetchEbird(endpoint) {
  const res = await fetch(`https://api.ebird.org/v2/data/obs/geo/${endpoint}?lat=${LAT}&lng=${LNG}&dist=${DIST}`, {
    headers: { "X-eBirdApiToken": EBIRD_API_KEY }
  });
  if (!res.ok) throw new Error(`eBird Error: ${res.status}`);
  return res.json();
}

async function fetchINat() {
  const res = await fetch(`https://api.inaturalist.org/v1/observations?taxon_id=3&lat=${LAT}&lng=${LNG}&radius=40&per_page=50`);
  const data = await res.json();
  return data.results;
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

// 4. MAIN HANDLER
export default async function handler(req, res) {
  try {
    const [recent, notable, inatRaw, lifeListRaw] = await Promise.all([
      fetchEbird("recent"),
      fetchEbird("recent/notable"),
      fetchINat(),
      fetchLifeList(AMY_SHEET_ID)
    ]);

    const unseenBirds = lifeListRaw.filter(b => !b.Seen || b.Seen.toString().toUpperCase() === 'FALSE');
    const unseenSciNames = new Set(unseenBirds.map(b => b.Latin2?.trim().toLowerCase()).filter(Boolean));
    const matches = [];

    // Process eBird Matches
    recent.forEach(s => {
      const sciLower = s.sciName?.trim().toLowerCase();
      if (unseenSciNames.has(sciLower)) {
        matches.push({
          pk_id: s.subId,
          bird: s.comName,
          scientific: s.sciName,
          lat: s.lat,
          lng: s.lng,
          location: s.locName,
          is_private: s.locationPrivate === true ? "YES" : "NO", // Ebird Private Flag
          date: s.obsDt,
          source: "eBird",
          link: `https://ebird.org/checklist/${s.subId}`
        });
      }
    });

    // Process iNat Matches
    inatRaw.forEach(obs => {
      const sci = obs.taxon?.name;
      const sciLower = sci?.trim().toLowerCase();
      if (unseenSciNames.has(sciLower)) {
        // iNat Private Flag Check
        const isPrivate = (obs.geoprivacy === 'obscured' || obs.geoprivacy === 'private') ? "YES" : "NO";
        
        matches.push({
          pk_id: obs.id,
          bird: obs.taxon?.preferred_common_name || sci,
          scientific: sci,
          lat: obs.location?.split(',')[0],
          lng: obs.location?.split(',')[1],
          location: obs.place_guess || "Unknown",
          is_private: isPrivate,
          date: obs.observed_on,
          source: "iNat",
          link: obs.uri
        });
      }
    });

    await writeToSheet("life_list_matches", matches);

    res.status(200).json({ 
        success: true, 
        unseen_matches: matches.length,
        timestamp: new Date().toLocaleString()
    });
  } catch (err) {
    console.error("Handler Failure:", err.message);
    res.status(500).json({ error: err.message });
  }
}