// ... (Keep existing imports and auth setup) ...

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
          pk_id: s.subId, // Submission ID for deep-linking
          bird: s.comName,
          scientific: s.sciName,
          lat: s.lat,
          lng: s.lng,
          location: s.locName,
          date: s.obsDt,
          source: "eBird",
          link: `https://ebird.org/checklist/${s.subId}` // Direct to eBird checklist
        });
      }
    });

    // Process iNat Matches
    inatRaw.forEach(obs => {
      const sci = obs.taxon?.name;
      const sciLower = sci?.trim().toLowerCase();
      if (unseenSciNames.has(sciLower)) {
        matches.push({
          pk_id: obs.id, // Observation ID
          bird: obs.taxon?.preferred_common_name || sci,
          scientific: sci,
          lat: obs.location?.split(',')[0],
          lng: obs.location?.split(',')[1],
          location: obs.place_guess || "Unknown",
          date: obs.observed_on,
          source: "iNat",
          link: obs.uri // Direct to iNat observation
        });
      }
    });

    await writeToSheet("life_list_matches", matches);

    res.status(200).json({ success: true, matches_found: matches.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}