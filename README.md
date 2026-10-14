# Job Agent

An AI job-search agent that runs entirely in your browser. It searches for jobs, scores how well each one fits your CV, flags UK visa sponsors, saves the best matches for you to review, and tracks your applications.

> **Status:** early test version. Your data stays in your browser. The only data that leaves it is the API calls made with your own keys.

**Live app:** https://rolescout.online/

---

## What works now

| Feature | Details |
|---|---|
| **AI agent** *(beta)* | Give it a goal ("find up to N good jobs in these countries"). It plans its own searches, scores results, refines queries when results are weak, saves the best matches as **Agent picks** with a reason, and finishes with a summary and career advice. It never applies for you. |
| **Profile from CV** | Upload a PDF, DOCX or TXT CV. The AI fills in your name, target titles, skills and locations. |
| **Discover** | Searches your target titles via the Adzuna API, deduplicates results, scores them by keyword, then gets AI fit scores (0–100, with a reason) for the top 40. |
| **Countries** | UK, India, Australia, New Zealand, Canada, and Europe (DE, FR, NL, IT, ES, AT, BE, CH, PL). Sri Lanka is coming soon. |
| **UK visa sponsors** | Checks UK employers against the Home Office *Register of Licensed Sponsors*, updated daily by a GitHub Action. Results show **Licensed sponsor**, **Possible sponsor**, **Agency** (real employer hidden) or **Not on register**. |
| **Sponsorship in ads** | The AI flags ads that say "no visa sponsorship". These are hidden by default. |
| **Workspace** | Saved jobs with status (saved → applied → interview → offer / rejected / withdrawn), history, notes, and AI score and sponsor badges. |
| **AI providers** | **Google Gemini** or **Groq** (open `gpt-oss` models), with a different provider per task if you want (agent, scoring, writing). |
| **Backup** | Export and import your data as JSON. API keys are never exported. |
| **Chrome extension** *(in testing)* | Adds a **Save to Job Agent** button on LinkedIn, Indeed and CV-Library job pages. |

### Agent guardrails (enforced in code)
- Hard limits on searches, steps and saves per run.
- It can only save jobs it has scored, and only if they meet the minimum score.
- If you need sponsorship, it never saves an ad that says sponsorship isn't offered.
- It retries automatically on rate limits or overloaded providers.
- Every action is written to a visible log.

### Not built yet
- An Agent page in the app. For now the agent runs from the browser console (see below).
- The app's import of jobs from the extension. The button opens the app, but the job isn't saved yet.
- Reed search (its API blocks browser calls, so it will go through the extension).
- Sri Lanka search (planned via the Jooble API).
- CV and cover-letter tailoring, and Gmail status sync.

---

## Quick start (live app)

### 1. Get your free API keys
Keys are stored only in your browser's IndexedDB. Never share them or commit them.

| Key | Where | Needed for |
|---|---|---|
| **Gemini** | https://aistudio.google.com/apikey | AI (recommended for the agent) |
| **Groq** | https://console.groq.com/keys | AI (fast; recommended for scoring) |
| **Adzuna** (app ID + app key) | https://developer.adzuna.com/signup | Job search (required) |
| **Reed** | https://www.reed.co.uk/developers/jobseeker | Optional, not used yet |

You need at least **one** AI key, Gemini or Groq. Having both works best.

> **Privacy:** on Gemini's **free tier**, Google may use prompts (including CV text) to improve its models. Use a paid key if that matters to you.

### 2. Set up
1. Open the live app and go to **Settings**.
2. Choose an **AI provider**, enter your keys (AI and Adzuna), click **Save settings**, then **Test AI**. It should say *Connection succeeded*.
3. Go to **Profile**, upload your CV and click **Fill from CV with AI**. Review the fields, set *Visa sponsorship required*, then click **Save profile**.
4. Go to **Discover**, pick countries and click **Find jobs**. Save the jobs you like; they appear in **Workspace**.

### 3. Run the agent (console, for now)
Run the app locally (see below), open it, press **F12**, and paste this into the console:

```js
// Recommended routing for free tiers: agent on Gemini, scoring on Groq
await jobdb.setSetting('llm:routes', { agent: { provider: 'gemini' }, scoring: { provider: 'groq' } })

const p = await jobdb.getSetting('profile')
const r = await agent.runAgent(p, {
  countries: ['gb'],      // e.g. ['gb', 'au', 'de']
  maxSearches: 4, maxSaves: 3, maxSteps: 12, minScore: 70,
  onLog: e => console.log(`[${e.kind}]`, e.text),
})
console.log(r.summary, r.saved)
```

A run takes 1–3 minutes. The saved picks appear in **Workspace**, with "Agent pick: …" in their notes.

> **Free-tier limits:** Groq's free tier allows about 8,000 tokens per minute on `gpt-oss-120b`, which an agent run quickly exceeds. That's why the routing above puts the agent on Gemini and scoring on Groq.

### 4. (Optional) Chrome extension
1. Download or clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder.
4. Open a job on LinkedIn, Indeed or CV-Library, and click **Save to Job Agent** in the bottom-right corner.

---

## Run locally (developers)

Requirements: **Node.js 22+**, git.

```bash
git clone https://github.com/pojithakarunathilake99/role-scout.git
cd role-scout

# Build the UK sponsor register (downloads the latest gov.uk CSV)
node scripts/build-sponsors.mjs

# Web app
cd web
npm install
mkdir -p public/data && cp ../data/sponsors.json public/data/
npm run dev
```

Open http://localhost:5173/

In dev mode, the console exposes `jobdb`, `llm`, `sponsors`, `discover`, `score` and `agent`.

To point the extension at your local app, open the extension's service worker console (`chrome://extensions` → *Inspect views: service worker*) and run:
```js
chrome.storage.sync.set({ appUrl: 'http://localhost:5173/' })
```

---

## How it works

```
GitHub Pages (static site, no backend)
│
├─ web/  React + TypeScript + Vite + Tailwind
│   ├─ src/lib/db.ts         IndexedDB storage (jobs, profile, settings)
│   ├─ src/lib/llm.ts        LLM adapters (Gemini, Groq): text, JSON, tool calling, per-task routing
│   ├─ src/lib/agent.ts      Agent loop: tools, guardrails, retries, log
│   ├─ src/lib/discover.ts   Job search (Adzuna) and keyword scoring
│   ├─ src/lib/score.ts      AI batch scoring (fit, ad sponsorship, agency)
│   ├─ src/lib/sponsors.ts   UK sponsor register lookup
│   ├─ src/lib/cv.ts         CV text extraction (pdf.js, mammoth) and AI profile fill
│   ├─ src/lib/countries.ts  Supported countries
│   └─ src/DiscoverPage.tsx  Discover UI
│
├─ data/sponsors.json            UK sponsor register (compact, ~1.8 MB gzipped)
├─ scripts/build-sponsors.mjs    gov.uk CSV → JSON
├─ .github/workflows/
│   ├─ sponsors.yml   daily register update (commits only when it changes)
│   └─ deploy.yml     build and deploy to GitHub Pages
└─ extension/   Chrome MV3 extension ("Save to Job Agent")
```

### The agent loop
The AI model is given four tools and decides which to call next:

| Tool | Does |
|---|---|
| `search_jobs(country, query)` | Live Adzuna search; returns new results with keyword score and UK sponsor status |
| `score_jobs(ids)` | AI fit score, what the ad says about sponsorship, and whether the advertiser is an agency |
| `save_job(id, reason)` | Saves to Workspace as an agent pick (code-enforced guardrails apply) |
| `finish(summary)` | Ends the run with a summary and advice |

### Default models
| Provider | Scoring | Writing / agent |
|---|---|---|
| Gemini | `gemini-3.5-flash-lite` | `gemini-3.8-flash` |
| Groq | `openai/gpt-oss-20b` | `openai/gpt-oss-120b` |

### Sponsor matching
Company names are normalised (lower-case, punctuation and suffixes like *Ltd*, *Limited* and *PLC* removed). An exact match counts as a sponsor; a prefix match counts as "possible". Recruitment agencies are detected by name and by AI, since the real employer is unknown.

### Cost
API usage for one person is typically a few pounds a month or less, and often free on the free tiers. Adzuna's free tier allows 1,000 calls a month: each Discover run uses up to 20 and each agent run up to its `maxSearches`.

---

## Privacy
- No server or account: everything is stored in your browser's IndexedDB.
- API keys are stored locally, excluded from backups, and never committed to the repo.
- The extension only reads the job page you're viewing, when you click its button. There's no background scraping or auto-applying.
- Jobs are passed from the extension to the app in the URL fragment (`#…`), which is never sent to a server.

---

## Feedback for testers
Please note:
- Any errors, with a screenshot of the browser console (F12) if possible
- Whether CV extraction filled in your profile correctly
- Whether the AI scores and the agent's picks match the jobs you'd actually apply to
- Any sponsor badges that look wrong
- Which job sites the extension button failed on

Jobs by [Adzuna](https://www.adzuna.com/).

---

## License

RoleScout is licensed under the **PolyForm Noncommercial License 1.0.0** (see [LICENSE](LICENSE)).

- **Free** for personal use, study, research, hobby projects, and non-profit, educational or public-interest organisations.
- **Commercial use** (using it in or for a business, selling it, or offering it as a paid service) **requires a separate licence.** Contact pojithah99@gmail.com

Copyright (c) 2026 Pojitha Hettiarachchilalage
