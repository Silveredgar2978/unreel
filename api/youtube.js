// GET /api/youtube?url=...&lang=es → { title, auto, segments:[{start,end,text}] }
// 1) Tries YouTube's own caption tracks (free).
// 2) If YouTube blocks the server, falls back to Supadata (paid API) when SUPADATA_API_KEY is set.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

function videoId(u) {
  if (/^[\w-]{11}$/.test(u)) return u;
  try {
    const x = new URL(u);
    if (x.hostname.includes('youtu.be')) return x.pathname.slice(1, 12);
    if (x.searchParams.get('v')) return x.searchParams.get('v');
    const m = x.pathname.match(/\/(shorts|embed|live|v)\/([\w-]{11})/);
    if (m) return m[2];
  } catch (_) {}
  return null;
}

const decode = s => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
  .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// Player data via the Android client (works more often from servers), then the watch page
async function playerData(id) {
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 12) gzip' },
      body: JSON.stringify({ videoId: id, context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 31, hl: 'en' } } }),
    });
    const j = await r.json();
    if (j?.captions) return j;
  } catch (_) {}
  const html = await (await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } })).text();
  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var|<\/script>)/s);
  if (!m) throw new Error('YouTube blocked the request.');
  return JSON.parse(m[1]);
}

function pickTrack(tracks, lang) {
  const manual = tracks.filter(t => t.kind !== 'asr'), auto = tracks.filter(t => t.kind === 'asr');
  const byLang = l => t => t.languageCode === l || t.languageCode?.startsWith(l + '-');
  return (lang && (manual.find(byLang(lang)) || auto.find(byLang(lang)))) || manual[0] || auto[0];
}

async function fromYouTube(id, lang) {
  const p = await playerData(id);
  const title = p?.videoDetails?.title || '';
  const tracks = p?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) throw new Error('This video has no captions.');
  const t = pickTrack(tracks, lang);
  const base = t.baseUrl.replace(/&fmt=[^&]*/, '');

  // json3 first
  let segs = [];
  try {
    const j = await (await fetch(base + '&fmt=json3', { headers: { 'User-Agent': UA } })).json();
    segs = (j.events || []).filter(e => e.segs).map(e => ({
      start: e.tStartMs / 1000,
      end: (e.tStartMs + (e.dDurationMs || 0)) / 1000,
      text: decode(e.segs.map(s => s.utf8).join('')),
    }));
  } catch (_) {
    const xml = await (await fetch(base, { headers: { 'User-Agent': UA } })).text();
    for (const m of xml.matchAll(/<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g)) {
      segs.push({ start: +m[1], end: +m[1] + (+m[2] || 0), text: decode(m[3]) });
    }
    for (const m of xml.matchAll(/<p t="(\d+)"(?: d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g)) {
      segs.push({ start: m[1] / 1000, end: (+m[1] + (+m[2] || 0)) / 1000, text: decode(m[3]) });
    }
  }
  segs = segs.filter(s => s.text);
  if (!segs.length) throw new Error('YouTube returned empty captions.');
  return { title, auto: t.kind === 'asr', language: t.languageCode, segments: segs };
}

async function fromSupadata(id, lang) {
  const key = process.env.SUPADATA_API_KEY;
  if (!key) return null;
  const u = `https://api.supadata.ai/v1/youtube/transcript?videoId=${id}` + (lang ? `&lang=${lang}` : '');
  const r = await fetch(u, { headers: { 'x-api-key': key } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(j.content)) throw new Error(j.message || j.error || 'Backup transcript service failed.');
  return {
    title: '', auto: false, language: j.lang,
    segments: j.content.map(c => ({ start: c.offset / 1000, end: (c.offset + (c.duration || 0)) / 1000, text: decode(c.text || '') })).filter(s => s.text),
  };
}

export default async function handler(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const id = videoId((q.get('url') || '').trim());
  const lang = q.get('lang') || '';
  if (!id) return res.status(400).json({ error: 'That doesn’t look like a YouTube link.' });

  let firstErr;
  try {
    return res.status(200).json(await fromYouTube(id, lang));
  } catch (e) { firstErr = e; }
  try {
    const b = await fromSupadata(id, lang);
    if (b) return res.status(200).json(b);
  } catch (e) { firstErr = e; }
  return res.status(502).json({ error: 'Couldn’t get the captions (' + firstErr.message + ')' });
}
