/* Unreel — pure helpers (no DOM). Loaded before app.js. */
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const num = n => String(n).padStart(3, '0');

  function fmt(t) {
    t = Math.max(0, t || 0);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  function fmtFile(t) {
    t = Math.max(0, t || 0);
    return `${pad(Math.floor(t / 60))}m${pad(Math.floor(t % 60))}s`;
  }
  // "1:02:03", "02:03", "63", "00:01:02,500"
  function parseTime(str) {
    if (str == null) return NaN;
    str = String(str).trim().replace(',', '.');
    if (!str) return NaN;
    const parts = str.split(':').map(Number);
    if (parts.some(isNaN)) return NaN;
    return parts.reduce((a, p) => a * 60 + p, 0);
  }
  function slug(s) {
    return (s || 'video').replace(/\.[^.]+$/, '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'video';
  }

  /* ---------- transcript parsing ---------- */
  function fillEnds(segs, total) {
    segs.sort((a, b) => a.start - b.start);
    segs.forEach((s, i) => {
      if (s.end == null || isNaN(s.end)) s.end = i < segs.length - 1 ? segs[i + 1].start : Math.max(s.start + 5, total || 0);
    });
    return segs;
  }
  function parseTranscript(text, total) {
    text = (text || '').replace(/\r/g, '').replace(/^\uFEFF/, '').trim();
    if (!text) return { segments: [], plain: '' };

    // SRT / VTT
    if (/\d{1,2}:\d{2}[.,]\d{1,3}\s*-->/.test(text)) {
      const segs = [];
      for (const block of text.split(/\n\s*\n/)) {
        const lines = block.split('\n');
        const i = lines.findIndex(l => l.includes('-->'));
        if (i < 0) continue;
        const [a, b] = lines[i].split('-->').map(x => parseTime(x.trim().split(/\s+/)[0]));
        const t = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (t && !isNaN(a)) segs.push({ start: a, end: b, text: t });
      }
      // VTT auto-captions repeat lines; drop exact consecutive duplicates
      const out = segs.filter((s, i) => i === 0 || s.text !== segs[i - 1].text);
      return { segments: fillEnds(out, total), plain: '' };
    }

    // Lines with timestamps: "[00:12] text", "0:12 - text", or "0:12" on its own line then text
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const ts = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s*[-–—:]?\s*(.*)$/;
    const segs = [];
    let pending = null, lead = '';
    for (const l of lines) {
      const m = l.match(ts);
      if (m) {
        if (m[2]) { segs.push({ start: parseTime(m[1]), text: m[2] }); pending = null; }
        else pending = parseTime(m[1]);
      } else if (pending != null) {
        segs.push({ start: pending, text: l }); pending = null;
      } else if (segs.length) {
        segs[segs.length - 1].text += ' ' + l;
      } else {
        lead += (lead ? ' ' : '') + l;
      }
    }
    if (segs.length >= 2) {
      if (lead) segs[0].text = lead + ' ' + segs[0].text;
      return { segments: fillEnds(segs, total), plain: '' };
    }
    return { segments: [], plain: text };
  }

  // Assign each transcript segment to the latest frame at or before it
  function assign(frames, segs) {
    const out = frames.map(() => []);
    out.before = [];
    if (!frames.length || !segs.length) return out;
    for (const s of segs) {
      if (s.start < frames[0].t - 0.01) { out.before.push(s); continue; }
      let k = 0;
      for (let i = 0; i < frames.length; i++) {
        if (frames[i].t <= s.start + 0.01) k = i; else break;
      }
      out[k].push(s);
    }
    return out;
  }

  function transcriptText(segs, plain) {
    if (segs && segs.length) return segs.map(s => `[${fmt(s.start)}] ${s.text}`).join('\n') + '\n';
    return (plain || '') + '\n';
  }

  /* ---------- README for the AI ---------- */
  function buildReadme(o) {
    const L = [];
    L.push(`# ${o.title || 'Video'}`, '');
    L.push('This folder contains screenshots from a video plus its transcript, so you can understand the video without watching it. Read this file first.', '');
    const info = [];
    if (o.fileName) info.push(`**Source:** ${o.fileName}`);
    if (o.duration) info.push(`**Length:** ${fmt(o.duration)}`);
    if (o.duration && (o.start > 0.5 || o.end < o.duration - 0.5)) info.push(`**Section used:** ${fmt(o.start)} – ${fmt(o.end)}`);
    info.push(`**Screenshots:** ${o.frames.length}`);
    if (o.transcriptSource) info.push(`**Transcript:** ${o.transcriptSource}`);
    L.push(info.join('  \n'), '');

    if (o.notes) L.push('## What the user wants', '', o.notes, '');

    L.push('## Files', '');
    if (o.frames.length) L.push('- `frames/` — screenshots in order. The file name has the timestamp: `003_00m15s.jpg` = screenshot 3, at 0:15.');
    if (o.sheets) L.push('- `sheets/` — the same screenshots combined into grids, each labeled with its number and timestamp.');
    if (o.hasTranscript) L.push('- `transcript.txt` — the complete transcript.');
    L.push('- `timeline.json` — the timeline below, as data.', '');

    L.push('## Timeline', '');
    const segs = o.segments || [];
    if (!o.frames.length) {
      L.push('_No screenshots — transcript only._', '');
      if (segs.length) segs.forEach(s => L.push(`**${fmt(s.start)}** ${s.text}  `));
      else if (o.plain) L.push(o.plain);
      L.push('');
    } else if (segs.length) {
      L.push('Each screenshot is followed by what is said from that moment until the next screenshot.', '');
      const pre = (o.groups && o.groups.before) || [];
      if (pre.length) L.push(`### Before the first screenshot (00:00 – ${fmt(o.frames[0].t)})`, pre.map(s => s.text).join(' '), '');
      o.frames.forEach((f, i) => {
        L.push(`### ${num(i + 1)} · ${fmt(f.t)} · \`frames/${f.name}\``);
        const g = o.groups[i] || [];
        L.push(g.length ? g.map(s => s.text).join(' ') : '_(nothing said)_', '');
      });
    } else {
      o.frames.forEach((f, i) => L.push(`- ${num(i + 1)} · ${fmt(f.t)} · \`frames/${f.name}\``));
      L.push('');
      if (o.plain) L.push('The transcript has no timestamps, so it is not matched to screenshots. Full text:', '', o.plain, '');
      else L.push('_No transcript was added._', '');
    }
    return L.join('\n');
  }

  /* ---------- WAV encoder (16-bit mono) ---------- */
  function encodeWav(f32, sr) {
    const n = f32.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }
  function rms(f32) {
    let s = 0; const step = Math.max(1, Math.floor(f32.length / 20000));
    let n = 0;
    for (let i = 0; i < f32.length; i += step) { s += f32[i] * f32[i]; n++; }
    return Math.sqrt(s / Math.max(1, n));
  }

  /* ---------- tiny ZIP writer (store, no compression — JPEGs don't shrink anyway) ---------- */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function makeZip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.path);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer());
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  const api = { fmt, fmtFile, parseTime, slug, num, parseTranscript, assign, transcriptText, buildReadme, encodeWav, rms, crc32, makeZip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.U = api;
})(typeof window !== 'undefined' ? window : globalThis);
