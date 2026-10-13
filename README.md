# Job Agent

A personal job-search assistant that runs entirely in your browser. It finds jobs, scores how well they fit your CV with AI, flags UK visa sponsors, and tracks your applications.

> **Status:** early test version. Your data never leaves your browser except for the API calls you make with your own keys.

**Live app:** https://pojithakarunathilake99.github.io/job-agent/

---

## What works now

| Feature | Details |
|---|---|
| **Profile from CV** | Upload a PDF, DOCX or TXT CV. The text is extracted in the browser and Gemini fills in your name, target job titles, skills and locations. |
| **Discover** | Searches your target titles via the Adzuna API, deduplicates results, scores each job with a keyword match, then has AI score the top 40 for fit (0–100, with a reason). |
| **Countries** | UK, India, Australia, New Zealand, Canada, and Europe (DE, FR, NL, IT, ES, AT, BE, CH, PL). Sri Lanka is coming soon. Capped at 20 searches per run. |
| **UK visa sponsors** | Checks every UK employer against the Home Office *Register of Licensed Sponsors*. The register is updated daily by a GitHub Action. Results show **Licensed sponsor**, **Possible sponsor** (check the name), **Agency** (real employer hidden) or **Not on register**. |
| **Sponsorship in the ad** | The AI flags ads that say "no visa sponsorship". These are hidden by default. |
| **Workspace** | Saved jobs with status (saved → applied → interview → offer / rejected / withdrawn), status history, notes, and AI score and sponsor badges. |
| **Backup** | Export and import all your data as JSON. API keys are never exported. |
| **Chrome extension** *(in testing)* | Adds a **Save to Job Agent** button on LinkedIn, Indeed and CV-Library job pages. |

### Not built yet
- The app's import of jobs sent by the extension. The button opens the app, but the job isn't saved yet.
- Reed search (its API blocks browser calls, so it will run through the extension).
- Sri Lanka search (planned via the Jooble API).
- CV and cover-letter tailoring per job.
- Gmail sync to update application statuses automatically.

---

## Quick start (use the live app)

### 1. Get your free API keys
You need your own keys. They are stored only in your browser, in IndexedDB.

| Key | Where | Needed for |
|---|---|---|
| **Gemini** | https://aistudio.google.com/apikey | Required: CV reading and AI scoring |
| **Adzuna** (app ID + app key) | https://developer.adzuna.com/signup | Required: job search |
| **Reed** | https://www.reed.co.uk/developers/jobseeker | Optional, not used yet |

> On Gemini's **free tier**, Google may use your prompts (including CV text) to improve its models. Use a paid-tier key if that matters to you.

### 2. Set up the app
1. Open the live app.
2. Go to **Settings** and enter your Gemini key, Adzuna app ID and Adzuna key. Click **Save settings**, then **Test Gemini**. It should say *Connection succeeded*.
3. Go to **Profile**, upload your CV and click **Fill from CV with AI**. Review the fields and set *Visa sponsorship required*, then click **Save profile**.
4. Go to **Discover**, pick countries and click **Find jobs**. A run takes about 20–40 seconds.
5. Click **Save** on the jobs you like. They appear in **Workspace**.

### 3. (Optional) Install the Chrome extension
1. Download or clone this repo.
2. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder.
4. Open a job on LinkedIn, Indeed or CV-Library. A green **Save to Job Agent** button appears in the bottom-right corner.

---

## Run locally (for developers)

Requirements: **Node.js 22+**, git.

```bash
git clone https://github.com/pojithakarunathilake99/job-agent.git
cd job-agent

# Build the sponsor register (downloads the latest gov.uk CSV)
node scripts/build-sponsors.mjs

# Web app
cd web
npm install
mkdir -p public/data && cp ../data/sponsors.json public/data/
npm run dev
```

Open http://localhost:5173/job-agent/

In dev mode, the browser console exposes `jobdb`, `llm`, `sponsors`, `discover` and `score` for testing.

To point the extension at your local app, open the extension's service worker console (`chrome://extensions` → *Inspect views: service worker*) and run:
```js
chrome.storage.sync.set({ appUrl: 'http://localhost:5173/job-agent/' })
```

---

## How it works

```
GitHub Pages (static site, no backend)
│
├─ React + TypeScript + Vite + Tailwind      web/
│   ├─ IndexedDB storage (jobs, profile, settings)   src/lib/db.ts
│   ├─ LLM adapter (Gemini; more providers later)    src/lib/llm.ts
│   ├─ CV text extraction (pdf.js, mammoth)          src/lib/cv.ts
│   ├─ Job discovery (Adzuna API)                    src/lib/discover.ts
│   ├─ AI batch scoring                              src/lib/score.ts
│   ├─ UK sponsor register lookup                    src/lib/sponsors.ts
│   └─ Country list                                  src/lib/countries.ts
│
├─ data/sponsors.json   UK sponsor register (compact JSON, ~1.8 MB gzipped)
├─ scripts/build-sponsors.mjs   gov.uk CSV → JSON
├─ .github/workflows/
│   ├─ sponsors.yml   daily register update (commits only when changed)
│   └─ deploy.yml     build + deploy to GitHub Pages
└─ extension/   Chrome MV3 extension ("Save to Job Agent")
```

**AI models (Gemini, configurable in Settings)**
- Scoring: `gemini-3.5-flash-lite` (cheap and fast; jobs are scored in batches of 10)
- Writing and CV extraction: `gemini-3.8-flash`

**Sponsor matching:** company names are normalised (lower-case, punctuation and suffixes like *Ltd*, *Limited* and *PLC* removed). An exact match counts as a sponsor; a prefix match counts as "possible". Recruitment agencies are detected by name and by AI, because the real employer is unknown.

**Cost:** API usage for one person is typically a few pounds a month or less. Adzuna's free tier allows 1,000 calls a month, and each Discover run uses up to 20.

---

## Privacy

- No server or account: everything is stored in your browser's IndexedDB.
- API keys are stored locally and excluded from backups.
- The extension only reads the job page you are viewing when you click the button. There's no background scraping or auto-applying.
- Jobs are passed from the extension to the app in the URL fragment (`#…`), which is never sent to a server.

---

## Feedback for testers

Please note:
- Any errors, with screenshots of the browser console (F12) if possible
- Whether the CV extraction filled in your profile correctly
- Whether the AI scores feel right for the jobs you'd actually apply to
- Any sponsor badges that look wrong
- Which job sites the extension button failed on

Jobs by [Adzuna](https://www.adzuna.com/).
