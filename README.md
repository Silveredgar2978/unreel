# UNREEL: video in, folder out

This tool turns any video into **screenshots + the full transcript**, packed into one folder any AI (Claude, ChatGPT, Gemini) can read.

## What it does
- **Screenshots** in 3 modes:
  - **Every X seconds**: one screenshot at a fixed interval
  - **Exact count**: the number of screenshots you pick, spread evenly
  - **Smart**: a screenshot only when the scene changes
- **Section**: pick From/To to use only one part of the video
- **Tap a screenshot** to remove it before exporting
- **Transcript**, 3 ways:
  - **Auto (AI)**: Groq Whisper, with timestamps
  - **YouTube link**: pulls the captions from YouTube
  - **Paste / upload**: plain text, timestamps, .srt or .vtt
- **Export (.zip)**:
  ```
  my-video/
  ├── README_for_AI.md   ← each screenshot matched to what's said at that moment
  ├── frames/001_00m03s.jpg …
  ├── sheets/sheet_01.jpg  ← grids of 9 screenshots (fewer uploads)
  ├── transcript.txt       ← the full transcript, nothing cut
  └── timeline.json
  ```
- **Privacy**: screenshots are made on your device. Your video is never uploaded. Only the audio is sent, and only when you use Auto transcript.

## Put it online (free, about 10 minutes)
1. Get a free API key at **console.groq.com/keys**.
2. Create a repo on **github.com**, then upload all these files to it (drag and drop works).
3. Go to **vercel.com**, sign in with GitHub, click **Add New → Project**, and pick the repo.
4. Before you click Deploy, open **Environment Variables** and add:
   `GROQ_API_KEY` = your key
5. Click **Deploy**. You get a link like `unreel.vercel.app` that works on your phone.

Optional: if YouTube blocks the server (this happens a lot), add `SUPADATA_API_KEY` from supadata.ai as a backup. Users can always use **Paste / upload** too.

## Run it on your computer
```
npm i -g vercel
vercel dev
```
Then open http://localhost:3000. Put your key in a `.env` file (see `.env.example`).

## Files
| File | What it is |
|---|---|
| `index.html` / `style.css` | Page and design |
| `app.js` | Screenshots, transcript, export |
| `lib.js` | Helpers: transcript parsing, README builder, zip maker |
| `api/transcribe.js` | Sends audio to Groq Whisper |
| `api/youtube.js` | Gets YouTube captions |

## Cost
- Vercel hosting: free
- Groq Whisper: roughly $0.04 per hour of audio, and there's a free tier

## Notes
- **iPhone .mov (HEVC)** works in Safari. On Chrome for Windows it may not open. If that happens, use Safari or convert the video to .mp4.
- Most AIs accept about 20–100 images per message, so use contact sheets for long videos.

## Ads (Google AdSense)
1. Apply at adsense.google.com with your site's domain.
2. Once you're approved, open `index.html`, find `UNREEL_ADS`, and paste your `ca-pub-…` ID and the slot IDs of your ad units.
3. In `ads.txt`, replace `pub-0000000000000000` with your ID.
4. In `privacy.html`, replace hello@example.com with your email.
If no ID is set, no ads show.
