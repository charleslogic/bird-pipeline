export default function handler(req, res) {
  try {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(JSON.stringify({ ok: true }));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}