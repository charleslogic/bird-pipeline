import { google } from "googleapis";

// Environment Variables
const EBIRD_API_KEY = process.env.EBIRD_API_KEY;
const SPREADSHEET_ID = process.env.SHEET_ID;
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
    {
      headers: { "X-eBirdApiToken": EBIRD_API_KEY }
    }
  );
  if (!res.ok) throw new Error(`eBird API error: ${res.status} ${res.statusText}`);
  return res.json();
}

// ---------- FETCH INAT ----------
async function fetchINat() {
  // taxon_id=3 is Aves (Birds)
  const res = await fetch(
    `https://api.inaturalist.org/v1/observations?taxon_id=3&lat=${LAT}&lng=${LNG}&radius=40&per_page=50`
  );
  if (!res.ok) throw new Error(`iNat API error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.results;
}

// ---------- WRITE TO SHEETS ----------
async function writeToSheet(tabName, data) {
  if (!data || data.length === 0) return;

  // Dynamically get headers from the object keys
  const keys = Array.from(new Set(data.flatMap(obj => Object.keys(obj))));

  const rows = data.map(obj =>
    keys.map(k => {
      const val = obj[k];
      // Keep strings/numbers clean, stringify nested objects if they exist
      return typeof val === 'object' ? JSON.stringify(val) : (val ?? "");
    })
  );

  // Clear existing data in the tab
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A:Z`
  });

  // Upload new data
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        keys,   // header row
        ...rows // data rows
      ]
    }
  });
}

// ---------- MAIN HANDLER ----------
export default async function handler(req, res) {
  try {
    // 1. Fetch data from all sources
    const [recent, notable, inatRaw] = await Promise.all([
      fetchEbird("recent"),
      fetchEbird("recent/notable"),
      fetchINat()
    ]);

    // 2. Map iNat data to your specific requested fields
    const inatCleaned = inatRaw.map(obs => ({
      name: obs.taxon?.preferred_common_name || obs.taxon?.name || "Unknown",
      scientific_name: obs.taxon?.name || "",
      group: obs.taxon?.iconic_taxon_name || "Unknown",
      date: obs.observed_on_details?.date || obs.observed_on,
      location: obs.place_guess || "Unknown Location",
      link: obs.uri,
      image: obs.photos?.[0]?.url || ""
    }));

    // 3. Update the three tabs
    // Ensure these tab names exist exactly in your Google Sheet
    await writeToSheet("ebird_recent", recent);
    await writeToSheet("ebird_notable", notable);
    await writeToSheet("inat_birds", inatCleaned);

    // 4. Return summary to the browser
    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      counts: {
        ebird_recent: recent.length,
        ebird_notable: notable.length,
        inat: inatCleaned.length
      }
    });

  } catch (err) {
    console.error("Pipeline Error:", err.message);
    res.status(500).json({ error: err.message });
  }
}