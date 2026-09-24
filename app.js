/* Unreel — app logic */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const video = $('#video');

const S = {
  file: null, url: null, name: 'video', title: '', duration: 0,
  frames: [], segments: [], plain: '', tsource: '',
  mode: 'interval', tmode: 'auto', busy: false, cancel: false,
};
const MAX_FRAMES = 400;

/* ---------- small UI helpers ---------- */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 3400);
}
function bar(el, p) {
  el.classList.toggle('hidden', p == null);
  if (p != null) el.firstElementChild.style.width = (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%';
}
function tStatus(msg, err) {
  const el = $('#transStatus'); el.textContent = msg || ''; el.classList.toggle('err', !!err);
}
function segmented(id, key, onChange) {
  $$(`#${id} button`).forEach(b => b.addEventListener('click', () => {
    $$(`#${id} button`).forEach(x => x.classList.toggle('on', x === b));
    S[key] = b.dataset.v; onChange(b.dataset.v);
  }));
}
segmented('mode', 'mode', v => $$('.opt').forEach(o => o.classList.toggle('hidden', o.dataset.m !== v)));
segmented('tmode', 'tmode', v => $$('.topt').forEach(o => o.classList.toggle('hidden', o.dataset.t !== v)));

/* ---------- 01 load video ---------- */
const drop = $('#drop');
$('#file').addEventListener('change', e => loadFile(e.target.files[0]));
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

function waitFor(el, ev, ms = 20000) {
  return new Promise((res, rej) => {
    let timer;
    const ok = () => { done(); res(); };
    const bad = () => { done(); rej(new Error('Your browser can’t open this video. Try an .mp4 or .mov.')); };
    function done() { clearTimeout(timer); el.removeEventListener(ev, ok); el.removeEventListener('error', bad); }
    el.addEventListener(ev, ok); el.addEventListener('error', bad);
    timer = setTimeout(() => { done(); rej(new Error('Timed out loading the video.')); }, ms);
  });
}

async function loadFile(f) {
  if (!f || S.busy) return;
  if (!f.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name)) return toast('That doesn’t look like a video.');
  if (S.url) URL.revokeObjectURL(S.url);
  clearFrames();
  S.file = f; S.url = URL.createObjectURL(f); S.name = U.slug(f.name);
  if (!(S.tsource || '').startsWith('YouTube')) S.title = f.name.replace(/\.[^.]+$/, '');
  video.src = S.url;
  try { await waitFor(video, 'loadedmetadata'); } catch (e) { return toast(e.message); }
  S.duration = isFinite(video.duration) ? video.duration : 0;
  if (!S.duration) toast('Couldn’t read the video length — try converting it to .mp4.');

  const ar = video.videoWidth / video.videoHeight || 16 / 9;
  $('#grid').style.setProperty('--ar', ar);
  $('#grid').style.setProperty('--tw', ar < 1 ? '100px' : '150px');

  $('#videoWrap').classList.remove('hidden');
  drop.classList.add('small'); drop.querySelector('strong').textContent = 'Change video';
  $('#videoMeta').textContent = `${f.name} · ${U.fmt(S.duration)} · ${video.videoWidth}×${video.videoHeight} · ${(f.size / 1048576).toFixed(1)} MB`;
  $('#rangeStart').value = '00:00';
  $('#rangeEnd').value = U.fmt(S.duration);
  $('#folderName').value = S.name;
  $('#extractBtn').disabled = false; $('#transBtn').disabled = false;
  refresh();
}

function getRange() {
  let a = U.parseTime($('#rangeStart').value), b = U.parseTime($('#rangeEnd').value);
  if (isNaN(a)) a = 0;
  if (isNaN(b) || $('#rangeEnd').value.trim() === U.fmt(S.duration)) b = S.duration;
  a = Math.max(0, Math.min(a, S.duration)); b = Math.max(0, Math.min(b, S.duration));
  return [a, b];
}

/* ---------- 02 screenshots ---------- */
const full = document.createElement('canvas');
const small = document.createElement('canvas'); small.width = 64; small.height = 36;
const sctx = small.getContext('2d', { willReadFrequently: true });

function seek(t) {
  return new Promise(res => {
    let timer;
    const done = () => { clearTimeout(timer); video.removeEventListener('seeked', done); res(); };
    video.addEventListener('seeked', done);
    timer = setTimeout(done, 4000);
    video.currentTime = Math.min(Math.max(0, t), Math.max(0, S.duration - 0.05));
  });
}
function grab(maxW) {
  const w = video.videoWidth, h = video.videoHeight;
  const sc = maxW && w > maxW ? maxW / w : 1;
  full.width = Math.round(w * sc); full.height = Math.round(h * sc);
  full.getContext('2d').drawImage(video, 0, 0, full.width, full.height);
  return new Promise(r => full.toBlob(r, 'image/jpeg', 0.85));
}
function signature() {
  sctx.drawImage(video, 0, 0, 64, 36);
  const d = sctx.getImageData(0, 0, 64, 36).data, g = new Uint8Array(64 * 36);
  for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) | 0;
  return g;
}
function diff(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; }

async function addFrame(t, maxW) {
  const blob = await grab(maxW);
  const f = { t, blob, url: URL.createObjectURL(blob), on: true };
  S.frames.push(f); addThumb(f, S.frames.length - 1);
}

async function extract() {
  if (!S.file || S.busy) return;
  const [start, end] = getRange();
  if (end - start < 0.2) return toast('Pick a longer section.');
  const maxW = +$('#maxW').value;

  let times = null;
  if (S.mode === 'interval') {
    const step = Math.max(0.2, +$('#interval').value || 3);
    times = []; for (let t = start + 0.05; t < end; t += step) times.push(t);
  } else if (S.mode === 'count') {
    const n = Math.max(1, Math.min(1000, Math.round(+$('#count').value || 20)));
    times = []; for (let i = 0; i < n; i++) times.push(start + (end - start) * (i + 0.5) / n);
  }
  if (times && times.length > MAX_FRAMES && !confirm(`That's ${times.length} screenshots. Most AIs only accept ~20–100 images at a time. Continue?`)) return;

  clearFrames();
  S.busy = true; S.cancel = false;
  $('#extractBtn').disabled = true; $('#cancelBtn').classList.remove('hidden');
  const barEl = $('#frameBar'); bar(barEl, 0);
  try { await video.play(); video.pause(); } catch (_) { /* iOS warm-up, harmless if it fails */ }

  try {
    if (times) {
      for (let i = 0; i < times.length && !S.cancel; i++) {
        await seek(times[i]); await addFrame(times[i], maxW); bar(barEl, (i + 1) / times.length);
      }
    } else {
      // Smart: sample the video, keep a frame when it differs enough from the last kept one
      const sens = +$('#sens').value;                 // 1..100
      const thr = 30 * (1 - sens / 100) + 2;          // mean pixel diff (0..255)
      const step = Math.max(0.25, (end - start) / 800);
      const minGap = 0.8, maxGap = 20;
      let last = null, lastT = -1e9;
      for (let t = start + 0.05; t < end && !S.cancel; t += step) {
        await seek(t);
        const sig = signature();
        if (!last || t - lastT >= maxGap || (t - lastT >= minGap && diff(sig, last) > thr)) {
          await addFrame(t, maxW); last = sig; lastT = t;
          if (S.frames.length >= MAX_FRAMES) { toast(`Stopped at ${MAX_FRAMES} screenshots — lower the sensitivity.`); break; }
        }
        bar(barEl, (t - start) / (end - start));
      }
    }
  } catch (e) {
    toast('Something went wrong: ' + e.message);
  }
  S.busy = false;
  $('#extractBtn').disabled = false; $('#cancelBtn').classList.add('hidden');
  bar(barEl, null);
  if (S.frames.length) toast(`${S.frames.length} screenshots ready — tap any to remove it.`);
  refresh();
}
$('#extractBtn').addEventListener('click', extract);
$('#cancelBtn').addEventListener('click', () => { S.cancel = true; });

function clearFrames() {
  S.frames.forEach(f => URL.revokeObjectURL(f.url));
  S.frames = []; $('#grid').innerHTML = ''; refresh();
}
function addThumb(f, i) {
  const b = document.createElement('button');
  b.className = 'thumb' + (f.on ? '' : ' off');
  const img = document.createElement('img'); img.src = f.url; img.alt = ''; img.loading = 'lazy';
  const sp = document.createElement('span'); sp.textContent = `${U.num(i + 1)} · ${U.fmt(f.t)}`;
  b.append(img, sp);
  b.addEventListener('click', () => { f.on = !f.on; b.classList.toggle('off', !f.on); refresh(); });
  $('#grid').appendChild(b);
}
function setAll(on) { S.frames.forEach(f => f.on = on); $$('.thumb').forEach(t => t.classList.toggle('off', !on)); refresh(); }
$('#allOn').addEventListener('click', () => setAll(true));
$('#allOff').addEventListener('click', () => setAll(false));

/* ---------- 03 transcript ---------- */
function setTranscript(segments, plain, source) {
  S.segments = segments || []; S.plain = plain || ''; S.tsource = source;
  const v = $('#tview'); v.innerHTML = '';
  if (S.segments.length) {
    S.segments.forEach(s => {
      const d = document.createElement('div'), b = document.createElement('b'), p = document.createElement('p');
      b.textContent = U.fmt(s.start); p.textContent = s.text; d.append(b, p); v.appendChild(d);
    });
  } else if (S.plain) {
    const p = document.createElement('p'); p.textContent = S.plain; v.appendChild(p);
  }
  v.classList.toggle('hidden', !S.segments.length && !S.plain);
  const words = (S.segments.length ? S.segments.map(s => s.text).join(' ') : S.plain).split(/\s+/).filter(Boolean).length;
  tStatus(words ? `✓ ${words.toLocaleString()} words · ${source}${S.segments.length ? '' : ' · no timestamps'}` : 'Transcript is empty.', !words);
  refresh();
}

// Auto: decode audio in the browser → 16 kHz mono → 2-minute WAV chunks → /api/transcribe
async function transcribe() {
  if (!S.file) return toast('Upload a video first.');
  if (S.busy) return;
  S.busy = true; $('#transBtn').disabled = true;
  const barEl = $('#transBar'); bar(barEl, 0);
  const lang = $('#lang').value, key = $('#groqKey').value.trim();
  try {
    tStatus('Reading audio…');
    const buf = await S.file.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    let decoded;
    try {
      decoded = await new Promise((res, rej) => { const p = ac.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
    } catch (_) {
      throw new Error('Couldn’t read audio from this video (it may have no sound). Use “Paste / upload” instead.');
    } finally { if (ac.close) ac.close(); }

    tStatus('Preparing audio…');
    const SR = 16000;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(1, Math.max(1, Math.ceil(decoded.duration * SR)), SR);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
    const data = (await off.startRendering()).getChannelData(0);

    const [a, b] = S.duration ? getRange() : [0, decoded.duration];
    const s0 = Math.floor(a * SR), s1 = Math.min(data.length, Math.floor(b * SR));
    const CH = 120 * SR;                               // 2 min ≈ 3.8 MB (fits Vercel's 4.5 MB limit)
    const total = Math.ceil((s1 - s0) / CH);
    const segs = [];
    for (let i = s0, n = 0; i < s1; i += CH, n++) {
      tStatus(`Transcribing… part ${n + 1} of ${total}`);
      const slice = data.subarray(i, Math.min(i + CH, s1));
      if (U.rms(slice) < 0.002) { bar(barEl, (n + 1) / total); continue; }   // skip silence
      const r = await fetch('/api/transcribe' + (lang ? '?lang=' + lang : ''), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'audio/wav' }, key ? { 'x-groq-key': key } : {}),
        body: U.encodeWav(slice, SR),
      });
      const j = await r.json().catch(() => ({ error: 'Transcription server not reachable (it only works once deployed, or with `vercel dev`).' }));
      if (!r.ok || j.error) throw new Error(j.error || 'Transcription failed.');
      const offset = i / SR;
      (j.segments || []).forEach(s => { const t = (s.text || '').trim(); if (t) segs.push({ start: s.start + offset, end: s.end + offset, text: t }); });
      bar(barEl, (n + 1) / total);
    }
    setTranscript(segs, '', 'Auto (Whisper)');
  } catch (e) {
    tStatus(e.message, true);
  }
  S.busy = false; $('#transBtn').disabled = !S.file; bar(barEl, null);
}
$('#transBtn').addEventListener('click', transcribe);

// YouTube captions
async function getYouTube() {
  const u = $('#ytUrl').value.trim();
  if (!u) return toast('Paste a YouTube link first.');
  const btn = $('#ytBtn'); btn.disabled = true;
  tStatus('Getting captions from YouTube…');
  try {
    const lang = $('#lang').value;
    const r = await fetch('/api/youtube?url=' + encodeURIComponent(u) + (lang ? '&lang=' + lang : ''));
    const j = await r.json().catch(() => ({ error: 'Server not reachable (it only works once deployed).' }));
    if (!r.ok || j.error) throw new Error(j.error || 'Couldn’t get captions.');
    if (j.title) { S.title = j.title; if (!S.file) $('#folderName').value = U.slug(j.title); }
    setTranscript(j.segments, '', 'YouTube captions' + (j.auto ? ' (auto-generated)' : ''));
  } catch (e) {
    tStatus(e.message + ' → Open the video on YouTube, “Show transcript”, copy it, and use Paste / upload.', true);
  }
  btn.disabled = false;
}
$('#ytBtn').addEventListener('click', getYouTube);

// Paste / upload
$('#tFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  $('#pasteBox').value = await f.text(); usePasted(); e.target.value = '';
});
function usePasted() {
  const { segments, plain } = U.parseTranscript($('#pasteBox').value, S.duration);
  if (!segments.length && !plain) return toast('Paste a transcript first.');
  setTranscript(segments, plain, 'Pasted by user');
}
$('#pasteBtn').addEventListener('click', usePasted);

/* ---------- 04 export ---------- */
function refresh() {
  const on = S.frames.filter(f => f.on).length;
  $('#gridHead').classList.toggle('hidden', !S.frames.length);
  $('#frameCount').textContent = `${on} of ${S.frames.length} selected`;
  const hasT = S.segments.length || S.plain;
  const parts = [];
  parts.push(on ? `${on} screenshots` : 'no screenshots');
  parts.push(hasT ? (S.segments.length ? `transcript · ${S.segments.length} lines` : 'transcript (no timestamps)') : 'no transcript');
  $('#summary').textContent = parts.join('  ·  ');
  $('#zipBtn').disabled = !(on || hasT);
}

async function makeSheets(frames) {
  const bmps0 = await createImageBitmap(frames[0].blob);
  const portrait = bmps0.height > bmps0.width; bmps0.close && bmps0.close();
  const cols = portrait ? 5 : 3, rowsPer = portrait ? 2 : 3, per = cols * rowsPer;
  const cw = portrait ? 360 : 640, label = 44, gap = 8;
  const out = [];
  for (let i = 0; i < frames.length; i += per) {
    const group = frames.slice(i, i + per);
    const bmps = await Promise.all(group.map(f => createImageBitmap(f.blob)));
    const ch = Math.round(cw * bmps[0].height / bmps[0].width);
    const rows = Math.ceil(group.length / cols);
    const c = document.createElement('canvas');
    c.width = gap + cols * (cw + gap); c.height = gap + rows * (ch + label + gap);
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
    x.font = '600 24px Inter, system-ui, sans-serif'; x.textBaseline = 'middle';
    group.forEach((f, j) => {
      const px = gap + (j % cols) * (cw + gap), py = gap + Math.floor(j / cols) * (ch + label + gap);
      x.drawImage(bmps[j], px, py, cw, ch);
      x.fillStyle = '#fff'; x.fillText(`#${U.num(i + j + 1)}   ${U.fmt(f.t)}`, px + 4, py + ch + label / 2);
    });
    bmps.forEach(b => b.close && b.close());
    out.push(await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82)));
  }
  return out;
}

async function exportZip() {
  const btn = $('#zipBtn'), label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Packing…';
  try {
    const folder = U.slug($('#folderName').value) || 'video';
    const frames = S.frames.filter(f => f.on).map((f, i) => ({ t: f.t, blob: f.blob, name: `${U.num(i + 1)}_${U.fmtFile(f.t)}.jpg` }));
    const files = frames.map(f => ({ path: `${folder}/frames/${f.name}`, data: f.blob }));

    const wantSheets = $('#sheets').checked && frames.length > 1;
    if (wantSheets) (await makeSheets(frames)).forEach((b, i) =>
      files.push({ path: `${folder}/sheets/sheet_${String(i + 1).padStart(2, '0')}.jpg`, data: b }));

    const hasTranscript = !!(S.segments.length || S.plain);
    const [start, end] = S.duration ? getRange() : [0, 0];
    const groups = U.assign(frames, S.segments);
    const notes = $('#notes').value.trim();

    files.unshift({ path: `${folder}/README_for_AI.md`, data: U.buildReadme({
      title: S.title || folder, fileName: S.file && S.file.name, duration: S.duration, start, end,
      frames, groups, segments: S.segments, plain: S.plain, notes,
      transcriptSource: S.tsource, sheets: wantSheets, hasTranscript,
    }) });
    if (hasTranscript) files.push({ path: `${folder}/transcript.txt`, data: U.transcriptText(S.segments, S.plain) });
    files.push({ path: `${folder}/timeline.json`, data: JSON.stringify({
      title: S.title || folder, duration: S.duration, notes,
      screenshots: frames.map((f, i) => ({ n: i + 1, time: +f.t.toFixed(2), file: `frames/${f.name}`, said: (groups[i] || []).map(s => s.text).join(' ') })),
      transcript: S.segments.length ? S.segments.map(s => ({ start: +s.start.toFixed(2), end: +(s.end || s.start).toFixed(2), text: s.text })) : S.plain,
    }, null, 2) });

    const zip = await U.makeZip(files);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zip); a.download = folder + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast('Folder downloaded — unzip it and drop the files into your AI.');
  } catch (e) {
    toast('Export failed: ' + e.message);
  }
  btn.textContent = label; refresh();
}
$('#zipBtn').addEventListener('click', exportZip);

$('#copyBtn').addEventListener('click', async () => {
  const notes = $('#notes').value.trim();
  const p = 'I’m sharing screenshots and the transcript of a video. Read README_for_AI.md first — it has the full timeline and matches each screenshot to what is being said at that moment.' + (notes ? '\n\n' + notes : '');
  try { await navigator.clipboard.writeText(p); toast('Prompt copied.'); }
  catch (_) { toast('Couldn’t copy on this browser.'); }
});

refresh();
