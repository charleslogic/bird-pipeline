// ... (Imports and Auth remain the same) ...

// List of nearby County Codes (Subnational2)
// US-TX-439 = Tarrant, US-TX-113 = Dallas, US-TX-121 = Denton, US-TX-085 = Collin
const REGIONS = ["US-TX-439", "US-TX-113", "US-TX-121", "US-TX-085"];

// ---------- FETCH EBIRD (BY REGION) ----------
async function fetchEbirdRegion(endpoint, regionCode) {
  const res = await fetch(
    `https://api.ebird.org/v2/data/obs/${regionCode}/${endpoint}?back=7&maxResults=10000`,
    { headers: { "X-eBirdApiToken": EBIRD_API_KEY } }
  );
  if (!res.ok) return []; // Return empty array if a specific region fails
  return res.json();
}

// ---------- MAIN HANDLER ----------
export default async function handler(req, res) {
  try {
    // 1. Fetch Life List and iNat as usual
    const [inatRaw, lifeListRaw] = await Promise.all([
      fetchINat(),
      fetchLifeList(AMY_SHEET_ID)
    ]);

    // 2. Fetch eBird data for ALL DFW COUNTIES at once
    // This effectively gives you a ~100 mile "box" of data
    const ebirdRequests = REGIONS.map(reg => fetchEbirdRegion("recent", reg));
    const notableRequests = REGIONS.map(reg => fetchEbirdRegion("recent/notable", reg));
    
    const ebirdResults = await Promise.all([...ebirdRequests, ...notableRequests]);
    const recent = ebirdResults.flat(); // Merge all counties into one big list

    // 3. Setup Joining Logic
    const unseenBirds = lifeListRaw.filter(b => !b.Seen || b.Seen.toString().toUpperCase() === 'FALSE');
    const unseenSciNames = new Set(unseenBirds.map(b => b.Latin2?.trim().toLowerCase()).filter(Boolean));
    const matches = [];

    // 4. THE JOIN (eBird + iNat)
    const allCurrentSightings = [
        ...recent.map(s => ({ 
            pk_id: s.subId, bird: s.comName, sci: s.sciName, lat: s.lat, lng: s.lng, 
            loc: s.locName, priv: s.locationPrivate ? "YES" : "NO", src: "eBird", 
            link: `https://ebird.org/checklist/${s.subId}` 
        })),
        ...inatRaw.map(obs => ({
            pk_id: obs.id, bird: obs.taxon?.preferred_common_name || obs.taxon?.name, 
            sci: obs.taxon?.name, lat: obs.location?.split(',')[0], lng: obs.location?.split(',')[1],
            loc: obs.place_guess || "iNat Spot", priv: (obs.geoprivacy ? "YES" : "NO"), src: "iNat", 
            link: obs.uri
        }))
    ];

    allCurrentSightings.forEach(s => {
        if (s.sci && unseenSciNames.has(s.sci.trim().toLowerCase())) {
            matches.push(s);
        }
    });

    // 5. Deduplicate (Since a bird might be in multiple counties or sources)
    const uniqueMatches = Array.from(new Map(matches.map(m => [m.sci, m])).values());

    await writeToSheet("life_list_matches", uniqueMatches);

    res.status(200).json({
      success: true,
      counts: {
        total_records_analyzed: allCurrentSightings.length,
        unique_unseen_matches: uniqueMatches.length
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}