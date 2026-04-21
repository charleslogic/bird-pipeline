export default async function handler(req, res) {
  const LAT = 32.7357;
  const LNG = -97.1081;
  const DIST = 25;

  const EBIRD_API_KEY = process.env.EBIRD_API_KEY;

  const url =
    `https://api.ebird.org/v2/data/obs/geo/recent?lat=${LAT}&lng=${LNG}&dist=${DIST}`;

  const r = await fetch(url, {
    headers: { "X-eBirdApiToken": EBIRD_API_KEY } 
  });

  const data = await r.json();

  res.status(200).json({
    ok: true,
    count: data.length,
    sample: data[0] || null
  });
}