// POST raw WAV audio (≤ ~4 MB) → Groq Whisper → { text, segments:[{start,end,text}] }
// Key: GROQ_API_KEY env var on Vercel, or the user's own key in the "x-groq-key" header.

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = req.headers['x-groq-key'] || process.env.GROQ_API_KEY;
  if (!key) return res.status(500).json({ error: 'No Groq API key set. Add GROQ_API_KEY in Vercel → Settings → Environment Variables, or paste your own key under Advanced.' });

  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const audio = Buffer.concat(chunks);
    if (!audio.length) return res.status(400).json({ error: 'No audio received.' });

    const lang = new URL(req.url, 'http://x').searchParams.get('lang');
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', process.env.WHISPER_MODEL || 'whisper-large-v3-turbo');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (lang) form.append('language', lang);

    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || `Transcription failed (${r.status}).` });

    return res.status(200).json({
      text: j.text || '',
      segments: (j.segments || []).map(s => ({ start: s.start, end: s.end, text: s.text })),
    });
  } catch (e) {
    return res.status(500).json({ error: 'Transcription error: ' + e.message });
  }
}
