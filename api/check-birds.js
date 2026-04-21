import { google } from "googleapis";

const EBIRD_API_KEY = process.env.EBIRD_API_KEY;
const SPREADSHEET_ID = process.env.SHEET_ID;
const AMY_SHEET_ID = process.env.SHEET_ID_AMY;
const GOOGLE_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_KEY = process.env.GOOGLE_PRIVATE_KEY;

const LAT = 32.7357;
const LNG = -97.1081;
const DIST = 25;

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: GOOGLE_EMAIL,
    private_key: GOOGLE_KEY ? GOOGLE_KEY.replace(/\\n/g, "\n") : undefined,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

async function fetchEbird(endpoint) {
  const res = await fetch(`https://api.ebird.org/v2/data/obs/geo/${endpoint}?lat=${LAT}&lng=${LNG}&dist=${DIST}`, {
    headers: { "X-eBirdApiToken": EBIRD_API_KEY }
  });
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
  const rows = data.map(obj => keys.map(k => {
    const val = obj[k];
    return typeof val === 'object' ? JSON.stringify(val) : (val ?? "");
  }));

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [keys, ...rows] }
  });
}

export default async function handler(req, res) {
  try {
    const [recent, notable, inatRaw, lifeListRaw] = await Promise.all([
      fetchEbird("recent"),
      fetchEbird("recent/notable"),
      fetchINat(),
      fetchLifeList(AMY_SHEET_ID)
    ]);

    // 1. Split Life List into Seen vs Unseen
    const unseenBirds = lifeListRaw.filter(b => !b.Seen || b.Seen.toString().toUpperCase() === 'FALSE');
    const seenBirds = lifeListRaw.filter(b => b.Seen && b.Seen.toString().toUpperCase() === 'TRUE');

    // 2. Create Lookup Sets (using Scientific Name / Latin1)
    const unseenSciNames = new Set(unseenBirds.map(b => b.Latin1?.trim().toLowerCase()).filter(Boolean));
    const seenSciNames = new Set(seenBirds.map(b => b.Latin1?.trim().toLowerCase()).filter(Boolean));

    const inatCleaned = inatRaw.map(obs => ({
      name: obs.taxon?.preferred_common_name || obs.taxon?.name || "Unknown",
      scientific: obs.taxon?.name || "",
      location: obs.place_guess || "Unknown",
      date: obs.observed_on
    }));

    // 3. THE JOINS
    const unseenMatches = [];
    const seenMatches = [];

    const allCurrentSightings = [
        ...recent.map(s => ({ bird: s.comName, sci: s.sciName, src: "eBird", loc: s.locName, date: s.obsDt })),
        ...inatCleaned.map(s => ({ bird: s.name, sci: s.scientific, src: "iNat", loc: s.location, date: s.date }))
    ];

    allCurrentSightings.forEach(s => {
        if (!s.sci) return;
        const sciLower = s.sci.toLowerCase();
        
        if (unseenSciNames.has(sciLower)) {
            unseenMatches.push({ ...s, category: "NEW LIFE BIRD" });
        } else if (seenSciNames.has(sciLower)) {
            seenMatches.push({ ...s, category: "ALREADY SEEN" });
        }
    });

    // 4. Update tabs (Add 'life_list_seen_matches' to your spreadsheet!)
    await writeToSheet("ebird_recent", recent);
    await writeToSheet("inat_birds", inatCleaned);
    await writeToSheet("life_list_matches", unseenMatches);
    await writeToSheet("life_list_seen_matches", seenMatches);

    res.status(200).json({
      success: true,
      counts: {
        unseen_matches: unseenMatches.length,
        seen_but_active_now: seenMatches.length,
        total_recent_sightings: allCurrentSightings.length
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}