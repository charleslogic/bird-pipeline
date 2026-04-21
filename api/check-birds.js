import { google } from "googleapis";

// 1. CONSTANTS & ENV
const EBIRD_API_KEY = process.env.EBIRD_API_KEY;
const SPREADSHEET_ID = process.env.SHEET_ID;
const AMY_SHEET_ID = process.env.SHEET_ID_AMY;
const GOOGLE_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_KEY = process.env.GOOGLE_PRIVATE_KEY;

const LAT = 32.7357;
const LNG = -97.1081;

// Region Codes: Tarrant, Dallas, Denton, Collin
const REGIONS = ["US-TX-439", "US-TX-113", "US-TX-121", "US-TX-085"];

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
async function fetchEbirdRegion(endpoint, regionCode) {
  const url = `https://api.ebird.org/v2/data/obs/${regionCode}/${endpoint}?back=7&maxResults=10000`;
  const res = await fetch(url, { headers: { "X-eBirdApiToken": EBIRD_API_KEY } });
  if (!res.ok) return [];
  return res.json();
}

async function fetchINat() {
  // Pulling the latest 200 within 60 miles
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

// 4. MAIN HANDLER
export default async function handler(req, res) {
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
    
    const matches = [];

    // Map Sightings
    const allSightings = [
        ...recentEbird.map(s => ({ 
            pk_id: s.subId, 
            bird: s.comName, 
            sci: s.sciName, 
            lat: s.lat, 
            lng: s.lng, 
            loc: s.locName, 
            date_observed: s.obsDt, 
            priv: s.locationPrivate ? "YES" : "NO", 
            src: "eBird", 
            link: `https://ebird.org/checklist/${s.subId}` 
        })),
        ...inatRaw.map(obs => ({
            pk_id: obs.id, 
            bird: obs.taxon?.preferred_common_name || obs.taxon?.name, 
            sci: obs.taxon?.name, 
            lat: obs.location?.split(',')[0], 
            lng: obs.location?.split(',')[1],
            loc: obs.place_guess || "iNat Spot", 
            // USING time_observed_at OR observed_on_string to get the timestamp for iNat
            date_observed: obs.time_observed_at || obs.observed_on_string || obs.observed_on,
            priv: (obs.geoprivacy ? "YES" : "NO"), 
            src: "iNat", 
            link: obs.uri
        }))
    ];

    allSightings.forEach(s => {
        if (s.sci && unseenSciNames.has(s.sci.trim().toLowerCase())) {
            matches.push(s);
        }
    });

    // Deduplicate by Scientific Name
    const uniqueMatches = Array.from(new Map(matches.map(m => [m.sci.toLowerCase(), m])).values());

    // SORT ALPHABETICALLY BY SPECIES (BIRD NAME)
    uniqueMatches.sort((a, b) => a.bird.localeCompare(b.bird));

    await writeToSheet("life_list_matches", uniqueMatches);

    res.status(200).json({
      success: true,
      counts: {
        total_processed: allSightings.length,
        unseen_matches: uniqueMatches.length
      }
    });

  } catch (err) {
    console.error("Scout Error:", err.message);
    res.status(500).json({ error: err.message });
  }
}