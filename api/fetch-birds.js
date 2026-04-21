export default function handler(req, res) {
  // Replace VAR_ONE and VAR_TWO with your actual variable names
  const var1Status = process.env.EBIRD_API_KEY ? "Defined" : "Undefined";
  const var2Status = process.env.CRON_SECRET ? "Defined" : "Undefined";
  const var3Status = process.env.GOOGLE_CLIENT_EMAIL ? "Defined" : "Undefined";
  const var4Status = process.env.GOOGLE_PRIVATE_KEY ? "Defined" : "Undefined";
  const var5Status = process.env.SHEET_ID ? "Defined" : "Undefined";
  const var6Status = process.env.SCRIPT_URL ? "Defined" : "Undefined";
  res.status(200).json({
    ok: true,
    env_check: {
      EBIRD_API_KEY: var1Status,
      CRON_SECRET: var2Status,
      GOOGLE_CLIENT_EMAIL: var3Status,
      GOOGLE_PRIVATE_KEY: var4Status,
      SHEET_ID: var5Status,
      SCRIPT_URL: var6Status,
    },
    // Optional: Only show the first 3 chars if you really need to see it
    // debug_hint: process.env.VAR_ONE?.substring(0, 3) + "..."
  });
}