import { google } from "googleapis";

const EBIRD_API_KEY = process.env.EBIRD_API_KEY;

// Arlington coords
const LAT = 32.7357;
const LNG = -97.1081;
const DIST = 25;

// ---------- GOOGLE SHEETS AUTH ----------
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);

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
  return res.json();
}

// ---------- FETCH INAT ----------
async function fetchINat() {
  const res = await fetch(
    `https://api.inaturalist.org/v1/observations?taxon_id=3&lat=${LAT}&lng=${LNG}&radius=40&per_page=200`
  );
  const data = await res.json();
  return data.results;
}

// ---------- WRITE TO SHEETS ----------
async function writeToSheet(tabName, data) {
  if (!data || data.length === 0) return;

  // collect all keys dynamically
  const keys = Array.from(
    new Set(data.flatMap(obj => Object.keys(obj)))
  );

  const rows = data.map(obj =>
    keys.map(k => JSON.stringify(obj[k] ?? ""))
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
    const [recent, notable, inat] = await Promise.all([
      fetchEbird("recent"),
      fetchEbird("recent/notable"),
      fetchINat()
    ]);

    await writeToSheet("ebird_recent", recent);
    await writeToSheet("ebird_notable", notable);
    await writeToSheet("inat_birds", inat);

    res.status(200).json({
      ebird_recent: recent.length,
      ebird_notable: notable.length,
      inat: inat.length
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}