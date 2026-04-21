export default async function handler(req, res) {
  const LAT = 32.7357;
  const LNG = -97.1081;
  const DIST = 25;

  const EBIRD_API_KEY = process.env.EBIRD_API_KEY;

  async function fetchEbird(endpoint) {
    const url = `https://api.ebird.org/v2/data/obs/geo/${endpoint}?lat=${LAT}&lng=${LNG}&dist=${DIST}`;

    const r = await fetch(url, {
      headers: { "X-eBirdApiToken": EBIRD_API_KEY }
    });

    return r.json();
  }

  async function fetchINat() {
    const url =
      `https://api.inaturalist.org/v1/observations?taxon_id=3&lat=${LAT}&lng=${LNG}&radius=40&per_page=50`;

    const r = await fetch(url);
    const data = await r.json();
    return data.results;
  }

  try {
    const [recent, notable, inat] = await Promise.all([
      fetchEbird("recent"),
      fetchEbird("recent/notable"),
      fetchINat()
    ]);

    res.status(200).json({
      ok: true,
      ebird_recent_count: recent.length,
      ebird_notable_count: notable.length,
      inat_count: inat.length,
      sample: {
        ebird: recent[0],
        inat: inat[0]
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}