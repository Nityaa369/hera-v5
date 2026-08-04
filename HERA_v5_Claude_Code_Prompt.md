# HERA v5 — Full Build Prompt for Claude Code

## What You Are Building

**HERA** (Hierarchical Engagement and Revenue Analytics) is a business intelligence and decision platform for **LawSikho (Addictive Learning Technology Ltd) — Team Abhipsa**. LawSikho runs 21-day paid WhatsApp community programs in legal skills (Contract Drafting, Criminal Litigation, Independent Director, AI Legal). Communities are sold via webinar → leads are called by Academic Counsellors (ACs) → enrolled students get course access.

Build this as a **Node.js/Express server** with a **React single-page frontend** (or vanilla JS if simpler). Deploy target is Railway. Must run on `node server.js` and serve at `process.env.PORT || 3000`.

---

## Architecture Requirements

```
hera-v5/
  server.js          — Express server, static files, /api/ai proxy, /api/upload
  package.json       — express, dotenv, multer, xlsx, cors
  public/
    index.html       — single-page app
    app.js           — all frontend logic
    styles.css       — all styles
```

**Server responsibilities:**
- Serve static files from `/public`
- `POST /api/ai` — proxy to Anthropic API using `process.env.ANTHROPIC_API_KEY`. Never expose key to browser.
- `POST /api/upload` — accept xlsx/csv file via multipart, parse using the `xlsx` npm package server-side, return clean JSON. This eliminates ALL browser-side SheetJS issues.
- `GET /health` — returns `{status:'ok', api: key_is_set}`
- All other routes → `public/index.html` (SPA fallback)

**Why server-side parsing:** Every browser-side SheetJS implementation broke on binary xlsx files. Parse on server, return clean JSON to browser — no SheetJS in browser at all.

---

## Authentication

Login screen requires three fields:
1. Username (`admin`, `shrawani`, `irene`, `tl`)
2. Password (`hera2024` for all)
3. Anthropic API Key (must start with `sk-ant-`) — stored in JS memory only, cleared on logout, never persisted

On Railway the server holds the API key in env — browser sends requests to `/api/ai` with no key. In development/direct mode the browser sends the key as `x-api-key` header directly to Anthropic. Auto-detect: if `window.location.hostname` includes `railway.app` or `localhost` with port 3000, use `/api/ai`; else call Anthropic directly.

Show `🔑 ···xxxx` key indicator in topbar. Clear key and both fields on logout.

---

## Real Data — Hardcode This Exactly

### Cohort CVR (9 CD cohorts)
```javascript
const COHORTS = [
  // BAD (CVR 1.2–5.9%)
  {id:'22/CD', perf:'bad', cvr:1.16, leads:259, enrolled:3, drop:98.8, topic:'GDPR + Scholarships', w:[111,90,58,71,54,40,39,33,8]},
  {id:'26/CD', perf:'bad', cvr:1.92, leads:261, enrolled:6, drop:97.7, topic:'Shark Tank + GDPR + Scholarships', w:[137,98,107,104,87,44,29,30,38]},
  {id:'27/CD', perf:'bad', cvr:1.63, leads:246, enrolled:7, drop:98.4, topic:'Publish first article', w:[178,134,99,124,108,62,43,47,50]},
  {id:'38/CD', perf:'mid', cvr:4.92, leads:243, enrolled:12, drop:95.1, topic:'GDPR + Brahmastra intro', w:[180,142,118,130,105,80,62,55,70]},
  {id:'39/CD', perf:'mid', cvr:3.13, leads:230, enrolled:7, drop:96.9, topic:'UK SME + Brahmastra', w:[165,128,94,110,88,60,45,40,53]},
  {id:'40/CD', perf:'mid', cvr:5.95, leads:252, enrolled:15, drop:94.0, topic:'Brahmastra refined', w:[188,152,140,148,120,90,72,65,84]},
  // GOOD (CVR 7.6–8.3%)
  {id:'31/CD', perf:'good', cvr:8.14, leads:258, enrolled:29, drop:88.8, topic:'UK SME + Brahmastra (income-first)', w:[180,135,139,133,106,77,50,68,91]},
  {id:'34/CD', perf:'good', cvr:8.33, leads:168, enrolled:18, drop:89.3, topic:'UK SME + Brahmastra (income-first)', w:[132,110,116,114,89,63,42,52,71]},
  {id:'36/CD', perf:'good', cvr:7.58, leads:264, enrolled:21, drop:92.0, topic:'UK SME + Brahmastra (income-first)', w:[208,181,137,126,130,89,82,75,90]},
];
```

### Team (LOP from MAY22-JUNE21 period)
```javascript
const TEAM = [
  {name:'Shrawani Mohan Patil', role:'AC', vertical:'CD', lopDays:0.5, deficit:409, target:6300, actual:5891, resigned:false, dials:5013, avgDur:233, calls20:576},
  {name:'Deepika Choudhary', role:'AC', vertical:'ID', lopDays:0, deficit:-105, target:5700, actual:5805, resigned:false, dials:5299, avgDur:263, calls20:582},
  {name:'Sukhnoor Kaur', role:'AC', vertical:'ID', lopDays:0, deficit:325, target:6000, actual:5675, resigned:false, dials:8272, avgDur:228, calls20:385},
  {name:'Humrah Hilal Nathkhan', role:'AC', vertical:'ID', lopDays:0.5, deficit:385, target:6300, actual:5915, resigned:false, dials:6075, avgDur:209, calls20:401},
  {name:'Md Laraib Zafir', role:'AC', vertical:'CL', lopDays:0, deficit:22, target:6300, actual:6278, resigned:false, dials:5268, avgDur:276, calls20:535},
  {name:'Purnima Singh', role:'AC', vertical:'CL', lopDays:4.5, deficit:1644, target:6300, actual:4656, resigned:false, dials:3320, avgDur:187, calls20:428},
  {name:'Akansha Sachdeva', role:'AC', vertical:'CL', lopDays:0.5, deficit:-174, target:5400, actual:5574, resigned:false, dials:4012, avgDur:204, calls20:516},
  {name:'Tanvi', role:'AC', vertical:'CD', lopDays:4, deficit:1218, target:6000, actual:4782, resigned:true, dials:2899, avgDur:247, calls20:276},
  {name:'Irene Abraham', role:'CM', vertical:'CD', lopDays:0, deficit:0, target:0, actual:0, resigned:false},
  {name:'Bhoomika Saxena', role:'CM', vertical:'CD', lopDays:0, deficit:0, target:0, actual:0, resigned:false},
  {name:'Vrinda Singh', role:'CM', vertical:'CD', lopDays:0, deficit:0, target:0, actual:0, resigned:false},
  {name:'Manisha Sikder', role:'TL', vertical:'CD', lopDays:0, deficit:0, target:6300, actual:280, resigned:false, dials:339, avgDur:14, calls20:1},
];
```

### Pipeline (from DUMP sheet)
```javascript
const PIPELINE = [
  // CD cohorts
  {cohort:'CD-42/43', person:'Shrawani', assigned:81, roadmap:62, converted:6},
  {cohort:'CD-42/43', person:'Humrah', assigned:54, roadmap:33, converted:1},
  {cohort:'CD-42/43', person:'Deepika', assigned:68, roadmap:52, converted:3},
  {cohort:'CD-42/43', person:'Irene', assigned:8, roadmap:3, converted:1},
  {cohort:'CD-44/45', person:'Shrawani', assigned:127, roadmap:61, converted:3},
  {cohort:'CD-44/45', person:'Humrah', assigned:99, roadmap:35, converted:1},
  {cohort:'CD-44/45', person:'Deepika', assigned:129, roadmap:58, converted:0},
  {cohort:'CD-44/45', person:'Irene', assigned:15, roadmap:6, converted:1},
  {cohort:'CD-44/45', person:'Bhoomika', assigned:22, roadmap:11, converted:0},
  {cohort:'CD-46/47', person:'Shrawani', assigned:90, roadmap:33, converted:0},
  {cohort:'CD-48', person:'Shrawani', assigned:15, roadmap:3, converted:0},
  // CL cohorts
  {cohort:'CL-53/54', person:'Akansha', assigned:80, roadmap:48, converted:5},
  {cohort:'CL-53/54', person:'Purnima', assigned:36, roadmap:14, converted:2},
  {cohort:'CL-55/56', person:'Akansha', assigned:72, roadmap:57, converted:3},
  {cohort:'CL-55/56', person:'Purnima', assigned:101, roadmap:45, converted:3},
  {cohort:'CL-55/56', person:'Laraib', assigned:128, roadmap:59, converted:6},
  {cohort:'CL-57/58', person:'Akansha', assigned:137, roadmap:79, converted:0},
  {cohort:'CL-57/58', person:'Purnima', assigned:135, roadmap:79, converted:2},
];
```

### Lead Demographics (934 total from Jasmine AI profiling)
```javascript
const LEAD_STATS = {
  total:934, lawStudent:576, inhouse:87, litigator:47, hr:20, ca:7, other:197,
  goalFreelancing:655, goalUpskilling:209, goalIntl:53, goalIncome:9, goalRemote:8,
  engaged10Plus:402, topCity:'UP', upLeads:134, delhiLeads:85, mumbaiLeads:62
};
```

### Webinar Recordings
```javascript
const RECORDINGS = {
  'CD 38/39': [
    {w:'W1',yt:'https://youtu.be/zpgeNijBbhE',drive:'https://drive.google.com/drive/folders/1hr6PWsZXMCnInhavQnwzW2_eq3Sb1qyk'},
    {w:'W2',yt:'https://youtu.be/Ajal7srHWqI'},{w:'W3',yt:'https://youtu.be/4PORtGASriY'},
    {w:'W4',yt:'https://youtu.be/VD27jF3UJ0Q'},{w:'W5',yt:'https://youtu.be/E2kKVSnXr2c'},
    {w:'W6',yt:'https://youtu.be/crl3apjQ7ow'},{w:'W7',yt:'https://youtu.be/dtW_26tl3ts'},
    {w:'W8',yt:'https://youtu.be/WemIAlLQ6xI'},{w:'W9',yt:'https://youtu.be/WMtdsjiEkPY'},
    {w:'W10',yt:'https://youtu.be/BO-fNmCwTlM'},{w:'W11',yt:'https://youtu.be/m-x3Kp5n1tw'},
    {w:'W12 Sales',yt:'https://youtu.be/bRaSLw0OGmo',drive:'https://drive.google.com/drive/folders/1pEFiAb0ITaPXgIfBuL5468KbD9yK6DTl'},
  ],
  'CD 30/31 (High CVR)': [
    {w:'W1',yt:'https://youtu.be/Mf3DLLjZiFM',drive:'https://drive.google.com/drive/folders/1K2IQgghF9H2Vps9SfndGKhAbxGz9Eh_x'},
    {w:'W2',yt:'https://youtu.be/zkzA-GL7biU'},{w:'W3',yt:'https://youtu.be/aQ9y0p8iIPU'},
    {w:'W4',yt:'https://youtu.be/gwJRaXVcgxs'},{w:'W5 Sales',yt:'https://youtu.be/P8DChOyHECM'},
  ],
  'CL 47/48': [
    {w:'W1',yt:'https://youtu.be/3oGHz3DkA20'},{w:'W2',yt:'https://youtu.be/HZ686Q0vTZ4'},
    {w:'W3',yt:'https://youtu.be/6d62fy-Y5Ws'},{w:'W4',yt:'https://youtu.be/gzc-1H5GIp8'},
    {w:'W5 Sales',yt:'https://youtu.be/bRaSLw0OGmo'},
  ],
};
```

---

## Pages / Sections (build all of these)

### 1. Dashboard
- 5 KPI cards: Total Leads (934), Total Enrolled (sum COHORTS), Best CVR (8.33% 34/CD), LOP Critical (members with lopDays >= 3), Active Alerts count
- CVR bar chart (all 9 cohorts, color-coded: red=bad, amber=mid, green=good) using Chart.js
- W1-W9 attendance line chart (all 9 cohorts as series)
- Active alerts section (3 fixed alerts: single point of failure CD, critical LOP, 7x CVR gap)
- Framework signals (4 cards: AIDA W3 drop, Pareto 3 topics = 90% enrollments, Burndown 313 leads decaying, RFM 402 high-engagement leads)

### 2. Agentic AI — SDR (4-state machine)
4 states shown as a flow: Ingestion → Scoring (HPRO) → Synthesis → Routing
Input form: Name, Persona, Goal, Current income, Target income, Attendance record, Notes
On submit: single Anthropic API call (Sonnet) with a system prompt defining all 4 states.
System prompt produces STATE 1 (JSON profile), STATE 2 (score 0-100), STATE 3 (6-month roadmap if score > 65), STATE 4 (CRM routing JSON).
Parse output to show score numerically, routing JSON, and roadmap separately.
Rules: Only reference verified alumni (there are 3: ask AI to name them from LawSikho CD). Positive framing only. No hallucinations.

### 3. Decision Engine
7 frameworks: AIDA, Pareto, RFM, OKR, PDCA, Burndown, Funnel
Parameters: Depth (Haiku/Sonnet), Focus (all/marketing/ops/planning), Format, extra context
Output: numbered decisions, each with URGENCY (URGENT/THIS WEEK/THIS MONTH), WHAT, WHY (with numbers), HOW (named owner, date), EXPECTED RESULT
Parse output into cards sorted by urgency, show badge counts

### 4. Cohort Analysis
All 9 cohorts as pills (color-coded)
4 charts: horizontal CVR bar, W1-W9 attendance lines, drop% bar, leads vs enrolled grouped bar
Full cohort table with all columns
Topic impact insight cards (bad/mid/good performance explanation)

### 5. Demographics
5 KPI cards from LEAD_STATS
Doughnut charts: Background (law student/in-house/litigator/HR/CA/other), Goal (freelancing/upskilling/intl clients/income growth/remote)
Enrolled students grid (show ENROLLED.bad and ENROLLED.good as badges)

### 6. Recordings
Tabbed: CD 38/39 | CD 30/31 | CL 47/48
Each webinar as a row: YouTube badge + link, Drive badge + link if available

### 7. CM Operations
21-day script calendar. Data: a full 21-day script with morning (10am), afternoon (3pm), evening (8pm) slots for each day. Key days: Day 8 marathon announcement slot, Day 10 Marathon 1 UK SME (SALES), Day 11 Marathon 2 Brahmastra+scholarship (CONVERSION), Day 21 Final+Surprise.
Click any slot to toggle: pending → sent → missed → pending
Compliance % tracker
"Mark today sent" button

### 8. Bandwidth Monitor
Composite bandwidth score per team member: `score = min(100, (actual/target*100) - (lopDays*10) - (overload ? 30 : 0))`
Color: green ≥ 70, amber 40-69, red < 40
Horizontal bar chart per person with score label and LOP badge
Radar chart (top 7 ACs)
AI Rebalancing button → Haiku call → rebalancing plan in text

### 9. Pipeline Tracker
Table: Person, Cohort, Assigned, Roadmap, Converted, CVR%, Status
Status logic: assigned > 100 = Overloaded, cvr > 5% = On Track, cvr > 2% = Watch, else = Help
Multi-vertical bar chart (ID/CD/CL/AI Legal conversions)
Burndown line chart (Assigned vs Roadmap vs Converted over pipeline entries)
4 KPI cards: CD Assigned total, Roadmaps done, Converted total, At Risk

### 10. Roadmap Generator
Input form: Name, Persona, Goal, Current income, Target income, Notes
6-month curriculum verbatim: M1 Foundations+Lifecycle+Outreach, M2 POA/MOUs/franchise, M3 MoA/AoA/SHA/SPA+AI, M4 Finance+Arbitration, M5 Digital+Advanced, M6 IP+Tech
Output: AI (Sonnet) generates 9-section roadmap with specific alumni references only
PDF download button on output

### 11. Reports
7 report types with selector:
- Cohort Comparison — all 9
- Attendance Drop Root Cause
- Webinar Topic Impact on CVR
- Demographic Intelligence
- Operational Health (Bandwidth + LOP)
- Leadership Impact analysis
- Full Intelligence Report

4 quick PDF buttons: Cohort PDF, Ops Health PDF, Pipeline PDF, Full Report PDF (each calls AI with current data then triggers print dialog)
Copy button on output

### 12. Data Input (5 tabs)

**Tab 1 — File Upload (most important):**
File drop zone + browse button accepting .xlsx, .xls, .csv
Upload goes to `POST /api/upload` on the server
Server parses with `xlsx` npm package, auto-detects file type, returns JSON
Client renders preview table (first 10 rows)
Confirm button loads data into runtime arrays
File type detection by filename:
- `Counsellor__LOP` → parse `MAY22-JUNE21 LOP` sheet → update TEAM lopDays + deficit
- `Vertical_Wise_Team_Data` → parse Sheet1 → update TEAM (Team Abhipsa filter)
- `nitya_requirements` → parse Sheet2 → update COHORTS cvr
- `manual_roadmap_check` → parse DUMP sheet → update PIPELINE
- `CM__Counsellors_combined` → parse `for counsellors` → update TEAM actual talktime

**Tab 2 — Manual Cohort:** form + CSV paste for cohorts
**Tab 3 — Team/LOP:** dropdown + form + CSV paste for team
**Tab 4 — Pipeline:** form + CSV paste for pipeline records
**Tab 5 — View All:** see all loaded data, export JSON, export CSVs, reset to defaults, localStorage status

localStorage auto-saves on every change. Restores on page load. All charts refresh immediately after import.

### 13. Community Manual (128 sections, 11 tabs)
Full manual text embedded. Tabs: Overview, Timeline & Process, Marketing & Ads, CM Operations, Webinar Playbook, Sales Pitch & SOP, Objection Handling, Operations & Data, Group Management, Course & Pricing, Post-Sales.

Search bar highlights matches across all sections.
Expandable accordion sections.
5 SOP PDF download buttons: Sales Caller SOP, CM Weekly SOP, Pre-Group Checklist, Webinar SOP, Objection Scripts (all content pre-written in app.js — NO JS string apostrophes, use only double-quoted JSON).
AI Q&A: user types question, Haiku answers from compressed manual context.

---

## PDF Generation

All PDF generation uses `window.print()` with a hidden print-only div. Never use jsPDF or html2pdf (both break on Railway).

Print CSS hides everything except `#print-frame`. Print frame has HERA letterhead (red H logo), title, date, body content, confidential footer.

Buttons that trigger PDF:
- Every AI output card has a ⬇ PDF button
- 5 SOP buttons in Community Manual header
- 4 quick report PDF buttons in Reports page

SOP content must be stored as a JS object with NO apostrophes in strings (use: "it is" not "it's", "do not" not "don't", "cannot" not "can't"). Test with `node --check` on every script block before considering the build complete.

---

## AI Models

- `claude-haiku-4-5-20251001` — quick tasks: bandwidth rebalance, manual Q&A, decision engine quick mode, dashboard signals
- `claude-sonnet-4-6` — deep tasks: decision engine deep mode, roadmaps, SDR agent, full reports
- Every AI call compresses context with `buildCtx(focus)` to under 400 tokens input
- Show token counter in topbar: `{tokens}tok·₹{cost}`
- Cost calculation: Haiku input ₹0.0021/1K, Haiku output ₹0.0104/1K; Sonnet input ₹0.0252/1K, Sonnet output ₹0.126/1K

---

## Design System

Dark theme. CSS custom properties:
```css
--red: #C8102E; --red-d: #9B0B22; --red-m: rgba(200,16,46,.1);
--ink: #0F1219; --ink2: #161C27; --ink3: #1E2535; --ink4: #252E40;
--steel: #3D4A62; --mid: #6B7A94; --muted: #9BA8BF; --ghost: #C8D2DF;
--border: #232D3F; --border2: #2A3548; --surface: #EEF1F6;
--ok: #10B981; --warn: #F59E0B; --err: #EF4444; --info: #3B82F6; --purple: #8B5CF6;
```

Layout: fixed left sidebar (220px), fixed topbar (50px), scrollable main content.
Sidebar: HERA logo + Team Abhipsa org chip + nav items grouped (Intelligence, Data, Operations, Tools) + user chip + logout button.
Topbar: page title, key indicator, time, Team Abhipsa chip, Analyse button.
Mobile: hamburger → overlay sidebar, single-column grid.

Cards: `background: var(--ink2); border: 1px solid var(--border); border-radius: 10px`
KPI cards: label (9px uppercase), value (22px bold), subtitle (10px muted)
Badges: colored micro-labels
Tables: striped on hover, colored td for red/amber/green values
Charts: all on `--ink2` background, grid color `rgba(255,255,255,.05)`, tick color `#6B7494`

---

## Critical Technical Rules

1. **Server parses all xlsx files** — never SheetJS in browser
2. **No apostrophes in single-quoted JS strings** — use double quotes for all SOP/manual content, or JSON.stringify, or template literals with escaped content
3. **Run `node --check` on every JS file** before declaring done
4. **localStorage** for persistence — save COHORTS, TEAM, PIPELINE as JSON on every change
5. **refreshAll()** called after every data change — updates all visible charts
6. **No CDN libraries in browser except Chart.js** — everything else server-side or vanilla JS
7. **Print CSS** must hide all elements except `#print-frame` using `body > *:not(#print-frame) { display: none !important }`
8. **Server proxy only** — browser never sends API key to Anthropic directly when on Railway

---

## Deployment

```
package.json scripts: { "start": "node server.js" }
engines: { "node": ">=18.0.0" }
dependencies: express, dotenv, multer, xlsx, cors
```

Railway environment variable: `ANTHROPIC_API_KEY`
No other environment variables needed.

---

## Files to Provide to Claude Code

Upload these files to Claude Code — it will parse them server-side:
- `Counsellor__LOP.xlsx` (sheets: MAY22-JUNE21 LOP, Combined talktime overall)
- `Vertical_Wise_Team_Data_Communities__For_Team_Structure_.xlsx` (Sheet1)
- `nitya_requirements.xlsx` (Sheet2)
- `manual_roadmap_check__3.xlsx` (DUMP sheet)
- `CM__Counsellors_combined_reports_1.xlsx` (for counsellors sheet)
- `Recordings_Chat_Files__Scripts.xlsx`

---

## Definition of Done

1. `node --check` on all JS files returns clean
2. `node server.js` runs without errors
3. `GET /` returns the full HTML (no "Not Found")
4. `GET /health` returns `{status:'ok', api:'configured'}`
5. `POST /api/upload` with a real xlsx file returns parsed JSON
6. Login screen appears, accepts `admin` / `hera2024` / `sk-ant-xxx` and enters platform
7. Dashboard renders all 5 KPIs and both charts
8. Decision Engine runs and produces numbered decisions
9. Data Input → File Upload → drop xlsx → see preview → click Import → charts update
10. Community Manual → search works → SOP PDF buttons produce printable output
11. All pages accessible from sidebar, all charts render, no JS console errors

