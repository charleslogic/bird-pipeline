import { google } from "googleapis";

const EBIRD_API_KEY = process.env.EBIRD_API_KEY;
const LAT = 32.7357;
const LNG = -97.1081;
const DIST = 25;

// ---------- GOOGLE SHEETS AUTH ----------
// Using GoogleAuth is the modern standard for Service Accounts
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    // The key needs to be wrapped in quotes if it contains spaces/newlines
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// PASS AUTH CORRECTLY: Needs to be inside the object
const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.SHEET_ID;

// ---------- FETCH EBIRD ----------
async function fetchEbird(endpoint) {
  const res = await fetch(
    `https://api.ebird.org/v2/data/obs/geo/${endpoint}?lat=${LAT}&lng=${LNG}&dist=${DIST}`,
    {
      headers: { "X-eBirdApiToken": EBIRD_API_KEY }
    }
  );
  if (!res.ok) throw new Error(`eBird API error: ${res.statusText}`);
  return res.json();
}

// ---------- FETCH INAT ----------
async function fetchINat() {
  const res = await fetch(
    `https://api.inaturalist.org/v1/observations?taxon_id=3&lat=${LAT}&lng=${LNG}&radius=40&per_page=200`
  );
  if (!res.ok) throw new Error(`iNat API error: ${res.statusText}`);
  const data = await res.json();
  return data.results;
}

// ---------- WRITE TO SHEETS ----------
async function writeToSheet(tabName, data) {
  if (!data || data.length === 0) return;

  const keys = Array.from(new Set(data.flatMap(obj => Object.keys(obj))));

  const rows = data.map(obj =>
    keys.map(k => {
      const val = obj[k];
      // Convert objects/arrays to strings, but keep strings/numbers clean
      return typeof val === 'object' ? JSON.stringify(val) : (val ?? "");
    })
  );

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A:Z`
  });

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

// ---------- MAIN ----------
export default async function handler(req, res) {
  try {
    // Check if variables exist before running
    if (!SPREADSHEET_ID || !process.env.GOOGLE_CLIENT_EMAIL) {
      throw new Error("Missing Environment Variables");
    }

    const [recent, notable, inat] = await Promise.all([
      fetchEbird("recent"),
      fetchEbird("recent/notable"),
      fetchINat()
    ]);

    await writeToSheet("ebird_recent", recent);
    await writeToSheet("ebird_notable", notable);
    await writeToSheet("inat_birds", inat);

    res.status(200).json({
      success: true,
      counts: {
        ebird_recent: recent.length,
        ebird_notable: notable.length,
        inat: inat.length
      }
    });

  } catch (err) {
    console.error("Handler Error:", err.message);
    res.status(500).json({ error: err.message });
  }
}