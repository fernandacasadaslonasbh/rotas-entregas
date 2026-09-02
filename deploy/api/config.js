// Vercel Serverless Function — configuração do app
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ mapsEnabled: true });
}
