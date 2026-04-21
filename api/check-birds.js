import { google } from "googleapis";

// Environment Variables
const EBIRD_API_KEY = process.env.EBIRD_API_KEY;
const SPREADSHEET_ID = process.env.SHEET_ID;
const AMY_SHEET_ID = process.env.SHEET_ID_AMY;
const GOOGLE_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_KEY = process.env.GOOGLE_PRIVATE_KEY;

// Arlington, TX coordinates
const LAT = 32.7357;
const LNG = -97.1081;
const DIST = 25;

// ---------- GOOGLE SHEETS AUTH ----------
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: GOOGLE_EMAIL,
    private_key: GOOGLE_KEY ? GOOGLE_KEY.replace(/\\n/g, "\n") : undefined,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// ---------- FETCH EBIRD ----------
async function fetchEbird(endpoint) {
  const res = await fetch(
    `https://api.ebird.org/v2/data/obs/geo/${endpoint}?lat=${LAT}&lng=${LNG}&dist=${DIST}`,
    { headers: { "X-eBirdApiToken": EBIRD_API_KEY } }
  );
  if (!res.ok) throw new Error(`eBird API error: ${res.statusText}`);
  return res.json();
}

// ---------- FETCH INAT ----------
async function fetchINat() {
  const res = await fetch(
    `https://api.inaturalist.org/v1/observations?taxon_id=3&lat=${LAT}&lng=${LNG}&radius=40&per_page=50`
  );
  if (!res.ok) throw new Error(`iNat API error: ${res.statusText}`);
  const data = await res.json();
  return data.results;
}

// ---------- FETCH AMY'S LIFE LIST (Starts Row 3) ----------
async function fetchLifeList(id) {
  // We start at A3 because row 1 & 2 are headers/metadata
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: "'ABA_Checklist-8.12.csv'!A3:H", 
  });
  
  const rows = response.data.values;
  if (!rows || rows.length === 0) return [];

  // Row 3 becomes our keys
  const headers = rows[0]; 
  return rows.slice(1).map(row => {
    let obj = {};
    headers.forEach((header, i) => {
      // Mapping to match your specific field list
      obj[header] = row[i];
    });
    return obj;
  });
}

// ---------- WRITE TO SHEETS ----------
async function writeToSheet(tabName, data) {
  if (!data || data.length === 0) {
      // Clear even if no data to keep the sheet fresh
      await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `${tabName}!A:Z` });
      return;
  }

  const keys = Array.from(new Set(data.flatMap(obj => Object.keys(obj))));
  const rows = data.map(obj => keys.map(k => {
    const val = obj[k];
    return typeof val === 'object' ? JSON.stringify(val) : (val ?? "");
  }));

  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `${tabName}!A:Z` });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [keys, ...rows] }
  });
}

// ---------- MAIN HANDLER ----------
export default async function handler(req, res) {
  try {
    const [recent, notable, inatRaw, lifeListRaw] = await Promise.all([
      fetchEbird("recent"),
      fetchEbird("recent/notable"),
      fetchINat(),
      fetchLifeList(AMY_SHEET_ID)
    ]);

    // 1. Filter for Unseen (Checkbox in Google Sheets returns "TRUE" or "FALSE")
    const unseenBirds = lifeListRaw.filter(bird => 
      !bird.Seen || bird.Seen.toString().toUpperCase() === 'FALSE'
    );

    // 2. Map Scientific Names (Latin1) for the Join
    const unseenScientificNames = new Set(
      unseenBirds.map(b => b.Latin1 ? b.Latin1.trim().toLowerCase() : null).filter(Boolean)
    );

    // 3. Clean iNat Data
    const inatCleaned = inatRaw.map(obs => ({
      name: obs.taxon?.preferred_common_name || obs.taxon?.name || "Unknown",
      scientific: obs.taxon?.name || "",
      group: obs.taxon?.iconic_taxon_name || "Unknown",
      date: obs.observed_on,
      location: obs.place_guess || "Unknown",
      link: obs.uri
    }));

    // 4. THE JOIN (Comparing live sightings to Unseen Latin1 names)
    const matches = [];

    // Check eBird Recent
    recent.forEach(s => {
      if (s.sciName && unseenScientificNames.has(s.sciName.toLowerCase())) {
        matches.push({
          Bird: s.comName,
          Scientific: s.sciName,
          Source: "eBird",
          Location: s.locName,
          Date: s.obsDt,
          Type: "Recent"
        });
      }
    });

    // Check iNat
    inatCleaned.forEach(s => {
      if (s.scientific && unseenScientificNames.has(s.scientific.toLowerCase())) {
        matches.push({
          Bird: s.name,
          Scientific: s.scientific,
          Source: "iNat",
          Location: s.location,
          Date: s.date,
          Type: "Community"
        });
      }
    });

    // 5. Deploy to your Spreadsheet
    await writeToSheet("ebird_recent", recent);
    await writeToSheet("ebird_notable", notable);
    await writeToSheet("inat_birds", inatCleaned);
    await writeToSheet("amy_unseen", unseenBirds);
    await writeToSheet("life_list_matches", matches);

    res.status(200).json({
      success: true,
      counts: {
        recent_sightings: recent.length,
        unseen_on_list: unseenBirds.length,
        nearby_matches: matches.length
      }
    });

  } catch (err) {
    console.error("Handler Error:", err.message);
    res.status(500).json({ error: err.message });
  }
}