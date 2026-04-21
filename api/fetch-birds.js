export default function handler(req, res) {
  // Replace VAR_ONE and VAR_TWO with your actual variable names
  const var1Status = process.env.EBIRD_API_KEY ? "Defined" : "Undefined";
  const var2Status = process.env.CRON_SECRET ? "Defined" : "Undefined";

  res.status(200).json({
    ok: true,
    env_check: {
      EBIRD_API_KEY: var1Status,
      CRON_SECRET: var2Status,
    },
    // Optional: Only show the first 3 chars if you really need to see it
    // debug_hint: process.env.VAR_ONE?.substring(0, 3) + "..."
  });
}