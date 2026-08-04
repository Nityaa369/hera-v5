require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const https = require('https');
const fs = require('fs');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_DEV = process.env.HERA_DEV === '1';

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const REPORTS_DIR = path.join(__dirname, 'reports');
[DATA_DIR, REPORTS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const upload = multer({
  storage: multer.diskStorage({
    destination: DATA_DIR,
    filename: (req, file, cb) => cb(null, file.originalname)
  }),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// ── DATA STORE ───────────────────────────────────────────────
let DATA = {
  syncedAt: null,
  syncing: false,
  paused: false,
  lastError: null,
  verticals: {
    CD: { cohorts: [], pipeline: [], revenue: [], webinars: [], team: [] },
    CL: { cohorts: [], pipeline: [], revenue: [], webinars: [], team: [] },
    ID: { cohorts: [], pipeline: [], revenue: [], webinars: [], team: [] },
    AI: { cohorts: [], pipeline: [], revenue: [], webinars: [], team: [] },
    AIW: { cohorts: [], pipeline: [], revenue: [], webinars: [], team: [] }
  },
  team: [],
  leads: [],
  revenue: [],
  marketing: [],
  webinarDNA: [],
  groups: [],
  monthlySheets: {},
  formResponses: [],
  lop: [],
  talktime: [],
  roadmapCalls: []
};

// ── HELPERS ──────────────────────────────────────────────────
function detectVertical(str) {
  const s = (str || '').toUpperCase();
  if (s.includes('AI FOR WOMEN') || s.includes('AI WOMEN') || s.includes('WOMEN')) return 'AIW';
  if (s.includes('LEGAL AI') || s.includes('AI FOR LEGAL') || /\d+\/LEGAL/i.test(str || '')) return 'AI';
  if (s.includes('CONTRACT') || s.includes('DRAFTING')) return 'CD';
  if (s.includes('CRIMINAL') || s.includes('LITIGATION')) return 'CL';
  if (s.includes('INDEPENDENT') || s.includes('/ ID') || s.includes('/ID')) return 'ID';
  return 'Other';
}

function rupees(val) {
  const n = parseFloat(val) || 0;
  if (n >= 10000000) return (n / 10000000).toFixed(2) + ' Cr';
  if (n >= 100000) return (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return n.toFixed(0);
}

function safeNum(v) { return parseFloat(v) || 0; }

function readSheet(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

function findSheet(wb, keywords) {
  const names = wb.SheetNames;
  for (const kw of keywords) {
    const found = names.find(n => n.toLowerCase().includes(kw.toLowerCase()));
    if (found) return found;
  }
  return names[0];
}

// ── FILE PARSERS ─────────────────────────────────────────────
function parseCommunityMaster(wb) {
  const names = wb.SheetNames;

  // raw_Leads_status
  const leadsSheet = findSheet(wb, ['raw_leads_status', 'leads_status', 'leads status']);
  if (leadsSheet) {
    const rows = readSheet(wb, leadsSheet);
    DATA.leads = rows.map(r => ({
      date: r['Date'] || r['date'] || '',
      name: r['Customer Name'] || r['Name'] || r['name'] || '',
      email: r['Email'] || r['email'] || '',
      phone: r['Phone'] || r['phone'] || '',
      items: r['Items'] || r['items'] || r['Funnel'] || '',
      stage: r['Stage'] || r['stage'] || '',
      owner: r['Owner'] || r['owner'] || r['AC Name'] || '',
      vertical: detectVertical(r['Items'] || r['items'] || r['Community'] || '')
    })).filter(r => r.name || r.email);
  }

  // compiled_revenue
  const revSheet = findSheet(wb, ['compiled_revenue', 'compiled revenue', 'revenue']);
  if (revSheet) {
    const rows = readSheet(wb, revSheet);
    DATA.revenue = rows.map(r => ({
      name: r['Name'] || r['name'] || '',
      date: r['Course Paid Date'] || r['Paid Date'] || r['date'] || '',
      email: r['Email'] || r['email'] || '',
      community: r['Community'] || r['community'] || '',
      finalCommunity: r['Final community name'] || r['Final Community'] || r['Community'] || '',
      paidTill: r['Paid Till Date'] || '',
      price: safeNum(r['Price'] || r['Amount'] || 0),
      enrollment: r['Enrollment'] || '',
      callerName: r['Caller Name'] || r['Caller'] || '',
      mode: r['Mode of Payment'] || r['Payment Mode'] || '',
      vertical: detectVertical(r['Community'] || r['Final community name'] || '')
    })).filter(r => r.name || r.price > 0);
  }

  // raw_marketing_spent
  const mktSheet = findSheet(wb, ['raw_marketing_spent', 'marketing_spent', 'marketing spent', 'marketing']);
  if (mktSheet) {
    const rows = readSheet(wb, mktSheet);
    DATA.marketing = rows.map(r => ({
      campaignStart: r['Campaign Start'] || r['Start'] || '',
      campaignEnd: r['Campaign End'] || r['End'] || '',
      groupName: r['Group Name'] || r['Group'] || '',
      commonGroup: r['Common Group'] || '',
      spent: safeNum(r['Total Spent (GST)'] || r['Total Spent'] || r['Spent'] || 0),
      leads: safeNum(r['Leads'] || r['leads'] || 0),
      cpl: safeNum(r['CPL'] || r['cpl'] || 0),
      vertical: detectVertical(r['Group Name'] || r['Common Group'] || '')
    })).filter(r => r.spent > 0 || r.leads > 0);
  }

  // Webinar List (DNA)
  const webSheet = findSheet(wb, ['webinar list', 'webinar dna', 'dna', 'webinar_list']);
  if (webSheet) {
    const rows = readSheet(wb, webSheet);
    DATA.webinarDNA = rows.map(r => ({
      date: r['Date'] || r['date'] || '',
      community: r['Community Name'] || r['Community'] || r['community'] || '',
      topic: r['Topic'] || r['topic'] || '',
      speaker: r['Speaker'] || r['speaker'] || '',
      status: r['Status'] || r['status'] || '',
      attendees: safeNum(r['Attendees'] || r['Attendance'] || 0),
      conversions: safeNum(r['Conversions'] || r['Conversion'] || r['Conv'] || 0),
      recording: r['Recordings'] || r['Recording'] || r['recording'] || '',
      transcript: r['Transcript'] || r['transcript'] || '',
      vertical: detectVertical(r['Community Name'] || r['Community'] || '')
    })).filter(r => r.community || r.topic);
  }

  // Group_mappings + New-Community Details
  const grpSheet = findSheet(wb, ['group_mapping', 'group mapping', 'group_map']);
  if (grpSheet) {
    DATA.groups = readSheet(wb, grpSheet).map(r => ({
      groupActive: r['Group Active'] || r['Group'] || '',
      team: r['Team'] || r['team'] || '',
      combinedGroup: r['Combined Group'] || r['Combined'] || '',
      activeForSales: r['Active for Sales'] || ''
    }));
  }

  // New-Community Details
  const commSheet = findSheet(wb, ['new-community details', 'new community details', 'community details 2025', 'community details']);
  if (commSheet) {
    const rows = readSheet(wb, commSheet);
    DATA.groups = DATA.groups.concat(rows.map(r => ({
      communityName: r['Community Name'] || r['Community'] || '',
      status: r['Status'] || '',
      cm: r['CM'] || r['cm'] || '',
      whatsappLink: r['WhatsApp Link'] || r['WA Link'] || '',
      startDate: r['Start Date'] || '',
      endDate: r['End Date'] || '',
      members: safeNum(r['Members'] || 0),
      webinarPrices: r['Webinar prices'] || '',
      offerPage: r['Offer page links'] || r['Offer Page'] || '',
      vertical: detectVertical(r['Community Name'] || '')
    })));
  }

  // Target dec 2025 (cohort intelligence)
  const targetSheet = findSheet(wb, ['target dec 2025', 'target dec', 'target_dec', 'target 2025']);
  if (targetSheet) {
    const rows = readSheet(wb, targetSheet);
    const cohorts = {};
    rows.forEach(r => {
      const name = r['Group name'] || r['Group Name'] || r['Community'] || r['community'] || '';
      if (!name) return;
      const vertical = detectVertical(name);
      if (!cohorts[name]) cohorts[name] = {
        id: name,
        vertical,
        leads: safeNum(r['Leads'] || 0),
        target: safeNum(r['Target'] || 0),
        units: safeNum(r['Units'] || 0),
        pool: safeNum(r['Pool'] || r['Revenue'] || 0),
        revenue: safeNum(r['Revenue'] || r['Pool'] || 0),
        cvr: 0,
        w: [],
        roadmapDone: safeNum(r['Roadmap Done'] || 0),
        discoveryCalls: safeNum(r['Discovery calls'] || r['Discovery Calls'] || 0),
        team: r['Team'] || r['team'] || ''
      };
      // attendance W0–W12
      for (let i = 0; i <= 12; i++) {
        const key = `W${i}`;
        const v = safeNum(r[key] || r[`w${i}`] || 0);
        if (v > 0) cohorts[name].w[i] = v;
      }
    });
    Object.values(cohorts).forEach(c => {
      if (c.leads > 0) c.cvr = (c.units / c.leads) * 100;
      const vk = c.vertical;
      if (DATA.verticals[vk]) DATA.verticals[vk].cohorts.push(c);
    });
  }

  // Monthly sheets (Jul-2026, Jun-2026 etc)
  const monthRe = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[- _]?(\d{4})$/i;
  names.forEach(n => {
    if (monthRe.test(n.trim())) {
      const rows = readSheet(wb, n);
      DATA.monthlySheets[n] = rows.map(r => ({
        name: r['Name'] || r['name'] || '',
        date: r['Course Paid Date'] || r['Paid Date'] || r['Date'] || '',
        email: r['Email'] || r['email'] || '',
        community: r['Community'] || r['community'] || '',
        price: safeNum(r['Price'] || r['Amount'] || 0),
        callerName: r['Caller Name'] || r['Caller'] || '',
        mode: r['Mode of Payment'] || '',
        vertical: detectVertical(r['Community'] || r['Final community name'] || '')
      })).filter(r => r.name || r.price > 0);
    }
  });

  // Form responses
  const formSheet = findSheet(wb, ['form responses', 'form response', 'form_responses']);
  if (formSheet) {
    DATA.formResponses = readSheet(wb, formSheet).map(r => ({
      name: r['Name'] || r['name'] || '',
      email: r['Email'] || r['email'] || '',
      role: r['Role'] || r['role'] || '',
      experience: r['Experience'] || '',
      income: r['Income'] || '',
      goals: r['Goals'] || '',
      aiComfort: r['AI comfort'] || r['AI Comfort'] || '',
      aiTools: r['AI tools used'] || r['AI Tools'] || ''
    }));
  }

  // webinar_analysis — W1-W11 attendance per cohort
  const wAnal = findSheet(wb, ['webinar_analysis', 'webinar analysis']);
  if (wAnal) {
    const rows = readSheet(wb, wAnal);
    rows.forEach(r => {
      const community = r['Community Name'] || r['Community'] || '';
      const vertical = detectVertical(community);
      const vk = DATA.verticals[vertical];
      if (!vk) return;
      const existing = vk.cohorts.find(c => c.id === community);
      if (existing) {
        for (let i = 1; i <= 11; i++) {
          const att = safeNum(r[`W${i} Attendance`] || r[`W${i}`] || 0);
          if (att > 0) existing.w[i] = att;
        }
      }
    });
  }
}

function parseCounsellorLOP(wb) {
  // LOP sheet
  const lopSheet = findSheet(wb, ['may22', 'jun21', 'lop', 'leave']);
  if (lopSheet) {
    DATA.lop = readSheet(wb, lopSheet).map(r => ({
      name: r['Name'] || r['name'] || r['Employee'] || '',
      lopDays: safeNum(r['Total LOP days'] || r['LOP Days'] || r['LOP'] || 0),
      deficitMinutes: safeNum(r['Deficit minutes'] || r['Deficit Minutes'] || r['Deficit'] || 0)
    })).filter(r => r.name);
  }

  // Talktime sheet
  const ttSheet = findSheet(wb, ['talktime', 'talk time', 'combined talktime', 'talktime overall']);
  if (ttSheet) {
    DATA.talktime = readSheet(wb, ttSheet).map(r => ({
      date: r['Date'] || r['date'] || '',
      name: r['Name'] || r['name'] || '',
      dials: safeNum(r['Dials'] || r['dials'] || 0),
      calls20min: safeNum(r['Calls>20min'] || r['Calls > 20 min'] || r['Quality Calls'] || 0),
      totalDuration: safeNum(r['Total Duration'] || r['Duration'] || r['Total Minutes'] || 0)
    })).filter(r => r.name);
  }
}

function parseNityaRequirements(wb) {
  // raw_roadmap_datacd
  const rdSheet = findSheet(wb, ['raw_roadmap_datacd', 'roadmap_datacd', 'roadmap data', 'raw_roadmap']);
  if (rdSheet) {
    DATA.roadmapCalls = readSheet(wb, rdSheet).map(r => ({
      name: r['Name'] || r['name'] || r['Student'] || '',
      community: r['Community'] || r['community'] || '',
      date: r['Date'] || r['date'] || '',
      done: !!(r['Done'] || r['Roadmap Done'] || r['Status']),
      vertical: detectVertical(r['Community'] || '')
    })).filter(r => r.name);
  }

  // Attendance Drop Data
  const dropSheet = findSheet(wb, ['attendance drop', 'attendance_drop']);
  if (dropSheet) {
    const rows = readSheet(wb, dropSheet);
    rows.forEach(r => {
      const community = r['Community'] || r['community'] || r['Group'] || '';
      const vertical = detectVertical(community);
      const vk = DATA.verticals[vertical];
      if (!vk) return;
      const cohort = vk.cohorts.find(c => c.id === community);
      if (cohort) {
        for (let i = 1; i <= 9; i++) {
          const v = safeNum(r[`W${i}`] || r[`W${i} Attendance`] || 0);
          if (v > 0) cohort.w[i] = v;
        }
      }
    });
  }
}

function parseSalesData(wb) {
  const sheet = wb.SheetNames[0];
  const rows = readSheet(wb, sheet);
  const newRevs = rows.map(r => ({
    name: r['Name'] || r['name'] || '',
    date: r['Course Paid Date'] || r['Paid Date'] || r['Date'] || '',
    email: r['Email'] || r['email'] || '',
    community: r['Community'] || r['community'] || '',
    price: safeNum(r['Price'] || r['Amount'] || 0),
    callerName: r['Caller Name'] || r['Caller'] || '',
    mode: r['Mode of Payment'] || '',
    vertical: detectVertical(r['Community'] || '')
  })).filter(r => r.name || r.price > 0);
  DATA.revenue = DATA.revenue.concat(newRevs);
}

function parseRecordings(wb) {
  const sheet = wb.SheetNames[0];
  const rows = readSheet(wb, sheet);
  rows.forEach(r => {
    const community = r['Community Name'] || r['Community'] || r['community'] || '';
    const topic = r['Topic'] || r['topic'] || '';
    const rec = r['Recording'] || r['Recordings'] || r['recording'] || r['Recording Link'] || '';
    const trans = r['Transcript'] || r['transcript'] || r['Transcript Link'] || '';
    if (!rec && !trans) return;
    const existing = DATA.webinarDNA.find(w =>
      w.community === community && (w.topic === topic || (!topic && !w.topic))
    );
    if (existing) {
      if (rec) existing.recording = rec;
      if (trans) existing.transcript = trans;
    } else if (community) {
      DATA.webinarDNA.push({
        date: r['Date'] || '',
        community,
        topic,
        speaker: r['Speaker'] || '',
        status: r['Status'] || '',
        attendees: safeNum(r['Attendees'] || 0),
        conversions: safeNum(r['Conversions'] || 0),
        recording: rec,
        transcript: trans,
        vertical: detectVertical(community)
      });
    }
  });
}

// ── HEALTH SCORING ───────────────────────────────────────────
function healthScore(cohort) {
  const issues = [];
  let status = 'green';

  const setStatus = (s) => {
    if (s === 'red') status = 'red';
    else if (s === 'amber' && status !== 'red') status = 'amber';
  };

  if (cohort.cvr < 3) { setStatus('red'); issues.push(`CVR ${cohort.cvr.toFixed(1)}% — below 3% threshold`); }
  else if (cohort.cvr < 6) { setStatus('amber'); issues.push(`CVR ${cohort.cvr.toFixed(1)}% — below 6% target`); }

  const cohortACs = DATA.team.filter(a => a.cohorts && a.cohorts.includes(cohort.id));
  cohortACs.forEach(ac => {
    if (ac.assigned > 100) { setStatus('red'); issues.push(`${ac.name}: ${ac.assigned} leads — critical overload (cap=60)`); }
    else if (ac.assigned > 60) { setStatus('amber'); issues.push(`${ac.name}: ${ac.assigned} leads — over cap`); }
  });

  if (cohort.w && cohort.w[0] > 0 && cohort.w[4] > 0) {
    const drop = (cohort.w[0] - cohort.w[4]) / cohort.w[0];
    if (drop > 0.6) { setStatus('red'); issues.push(`Attendance dropped ${Math.round(drop * 100)}% by W5`); }
    else if (drop > 0.4) { setStatus('amber'); issues.push(`Attendance dropped ${Math.round(drop * 100)}% by W5`); }
  }

  if (cohortACs.length === 1 && cohort.leads > 100) {
    setStatus('red');
    issues.push(`Single AC for ${cohort.leads} leads — SPOF`);
  }

  cohortACs.forEach(ac => {
    if (ac.lopDays >= 3) { setStatus('amber'); issues.push(`${ac.name}: ${ac.lopDays} LOP days`); }
  });

  return { status, issues, cohort: cohort.id, vertical: cohort.vertical };
}

function computeAllHealth() {
  const results = [];
  Object.keys(DATA.verticals).forEach(vk => {
    DATA.verticals[vk].cohorts.forEach(cohort => {
      results.push(healthScore(cohort));
    });
  });
  return results;
}

function buildTeamFromData() {
  const teamMap = {};

  // Build from talktime
  DATA.talktime.forEach(tt => {
    const key = tt.name;
    if (!key) return;
    if (!teamMap[key]) teamMap[key] = { name: key, cohorts: [], assigned: 0, lopDays: 0, deficitMin: 0, avgMinDay: 0, cvr: 0, vertical: '' };
    teamMap[key].avgMinDay = tt.totalDuration > 0 ? tt.totalDuration : teamMap[key].avgMinDay;
  });

  // Merge LOP
  DATA.lop.forEach(l => {
    if (!l.name) return;
    if (!teamMap[l.name]) teamMap[l.name] = { name: l.name, cohorts: [], assigned: 0, lopDays: 0, deficitMin: 0, avgMinDay: 0, cvr: 0, vertical: '' };
    teamMap[l.name].lopDays = l.lopDays;
    teamMap[l.name].deficitMin = l.deficitMinutes;
  });

  // Count lead assignments
  DATA.leads.forEach(lead => {
    const owner = lead.owner;
    if (!owner) return;
    if (!teamMap[owner]) teamMap[owner] = { name: owner, cohorts: [], assigned: 0, lopDays: 0, deficitMin: 0, avgMinDay: 0, cvr: 0, vertical: '' };
    teamMap[owner].assigned++;
    if (!teamMap[owner].vertical) teamMap[owner].vertical = lead.vertical;
  });

  DATA.team = Object.values(teamMap);
}

// ── SYNC ─────────────────────────────────────────────────────
async function parseAllFiles() {
  // Reset
  DATA.leads = [];
  DATA.revenue = [];
  DATA.marketing = [];
  DATA.webinarDNA = [];
  DATA.groups = [];
  DATA.monthlySheets = {};
  DATA.formResponses = [];
  DATA.lop = [];
  DATA.talktime = [];
  DATA.roadmapCalls = [];
  Object.keys(DATA.verticals).forEach(vk => {
    DATA.verticals[vk] = { cohorts: [], pipeline: [], revenue: [], webinars: [], team: [] };
  });

  const files = fs.readdirSync(DATA_DIR);

  for (const file of files) {
    if (!file.endsWith('.xlsx') && !file.endsWith('.xls')) continue;
    const fp = path.join(DATA_DIR, file);
    let wb;
    try {
      wb = XLSX.readFile(fp);
    } catch (e) {
      console.warn('Could not parse', file, e.message);
      continue;
    }
    const fn = file.toLowerCase();
    if (fn.includes('community_master') || fn.includes('community master')) {
      parseCommunityMaster(wb);
    } else if (fn.includes('counsellor__lop') || fn.includes('counsellor_lop')) {
      parseCounsellorLOP(wb);
    } else if (fn.includes('nitya_requirements') || fn.includes('nitya requirements')) {
      parseNityaRequirements(wb);
    } else if (fn.includes('sales_data_sheet') || fn.includes('sales data sheet')) {
      parseSalesData(wb);
    } else if (fn.includes('recordings_chat') || fn.includes('recordings chat')) {
      parseRecordings(wb);
    }
  }

  buildTeamFromData();

  // Push revenue/webinars into verticals
  DATA.revenue.forEach(r => {
    const vk = r.vertical;
    if (DATA.verticals[vk]) DATA.verticals[vk].revenue.push(r);
  });
  DATA.webinarDNA.forEach(w => {
    const vk = w.vertical;
    if (DATA.verticals[vk]) DATA.verticals[vk].webinars.push(w);
  });
  DATA.leads.forEach(l => {
    const vk = l.vertical;
    if (DATA.verticals[vk]) DATA.verticals[vk].pipeline.push(l);
  });
  DATA.team.forEach(t => {
    if (t.vertical && DATA.verticals[t.vertical]) DATA.verticals[t.vertical].team.push(t);
  });
}

async function syncData() {
  if (DATA.paused || DATA.syncing) return;
  DATA.syncing = true;
  try {
    await parseAllFiles();
    DATA.syncedAt = new Date();
    DATA.lastError = null;
  } catch (e) {
    DATA.lastError = e.message;
    console.error('Sync error:', e);
  } finally {
    DATA.syncing = false;
  }
}

const cronExpr = IS_DEV ? '*/1 * * * *' : '0 */3 * * *';
cron.schedule(cronExpr, syncData);
syncData();

// ── REPORT BUILDER ───────────────────────────────────────────
function buildReport(vertical, period) {
  const vk = vertical.toUpperCase();
  const vData = DATA.verticals[vk] || { cohorts: [], pipeline: [], revenue: [], webinars: [], team: [] };
  const allHealth = computeAllHealth().filter(h => h.vertical === vk);
  const redCount = allHealth.filter(h => h.status === 'red').length;
  const amberCount = allHealth.filter(h => h.status === 'amber').length;
  const overallStatus = redCount > 0 ? 'RED' : amberCount > 0 ? 'AMBER' : 'GREEN';

  const totalRevenue = vData.revenue.reduce((s, r) => s + r.price, 0);
  const totalLeads = vData.pipeline.length;
  const enrolled = vData.pipeline.filter(l => (l.stage || '').toLowerCase().includes('enrolled')).length;
  const overallCVR = totalLeads > 0 ? (enrolled / totalLeads * 100).toFixed(1) : '0';

  const issues = allHealth.flatMap(h => h.issues.map(i => ({ cohort: h.cohort, issue: i, status: h.status })));

  const topACIssues = DATA.team
    .filter(t => t.vertical === vk && (t.assigned > 60 || t.lopDays >= 3))
    .map(t => `${t.name}: ${t.assigned} leads, LOP ${t.lopDays}d`);

  const reportId = Date.now().toString(36);
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/>
<title>HERA Report — ${vk} ${period}</title>
<style>
body{font-family:'Segoe UI',sans-serif;margin:0;padding:24px;color:#111;background:#fff;}
h1{color:#C8102E;border-bottom:3px solid #C8102E;padding-bottom:8px;}
h2{color:#333;margin-top:20px;font-size:15px;}
.status-RED{color:#C8102E;font-weight:700;}
.status-AMBER{color:#D97706;font-weight:700;}
.status-GREEN{color:#059669;font-weight:700;}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px;}
th{background:#f5f5f5;padding:8px;text-align:left;border:1px solid #ddd;}
td{padding:8px;border:1px solid #ddd;}
.footer{margin-top:30px;font-size:10px;color:#999;border-top:1px solid #ddd;padding-top:8px;}
.issue-red{color:#C8102E;} .issue-amber{color:#D97706;}
</style>
</head><body>
<h1>HERA · ${vk} Vertical Report</h1>
<p>Generated: ${now} · Period: ${period} · ID: ${reportId}</p>
<p>Overall Status: <span class="status-${overallStatus}">${overallStatus}</span></p>

<h2>1. Health Overview</h2>
<table><tr><th>Metric</th><th>Value</th></tr>
<tr><td>Total Leads</td><td>${totalLeads}</td></tr>
<tr><td>Enrolled</td><td>${enrolled}</td></tr>
<tr><td>Overall CVR</td><td>${overallCVR}%</td></tr>
<tr><td>Revenue</td><td>₹${rupees(totalRevenue)}</td></tr>
<tr><td>Red Cohorts</td><td>${redCount}</td></tr>
<tr><td>Amber Cohorts</td><td>${amberCount}</td></tr>
</table>

<h2>2. Issues Detected</h2>
${issues.length === 0 ? '<p>No issues detected.</p>' : issues.map(i =>
  `<p class="issue-${i.status}">● [${i.cohort}] ${i.issue}</p>`
).join('')}

<h2>3. Cohort CVR Table</h2>
<table><tr><th>Cohort</th><th>Leads</th><th>Units</th><th>CVR%</th><th>Revenue</th><th>Status</th></tr>
${vData.cohorts.map(c => {
  const h = healthScore(c);
  return `<tr><td>${c.id}</td><td>${c.leads}</td><td>${c.units}</td><td>${c.cvr.toFixed(1)}%</td><td>₹${rupees(c.revenue)}</td><td class="status-${h.status.toUpperCase()}">${h.status.toUpperCase()}</td></tr>`;
}).join('')}
</table>

<h2>4. Lead Pipeline by Stage</h2>
<table><tr><th>Stage</th><th>Count</th></tr>
${(() => {
  const stageMap = {};
  vData.pipeline.forEach(l => { stageMap[l.stage || 'Unknown'] = (stageMap[l.stage || 'Unknown'] || 0) + 1; });
  return Object.entries(stageMap).sort((a, b) => b[1] - a[1]).map(([s, c]) => `<tr><td>${s}</td><td>${c}</td></tr>`).join('');
})()}
</table>

<h2>5. AC Performance</h2>
<table><tr><th>Name</th><th>Assigned</th><th>LOP Days</th><th>Deficit Min</th><th>Status</th></tr>
${DATA.team.filter(t => t.vertical === vk || !t.vertical).map(t => {
  const st = t.assigned > 100 ? 'OVERLOADED' : t.assigned > 60 ? 'OVER CAP' : 'OK';
  return `<tr><td>${t.name}</td><td>${t.assigned}</td><td>${t.lopDays}</td><td>${t.deficitMin}</td><td>${st}</td></tr>`;
}).join('')}
</table>

${topACIssues.length > 0 ? `<h2>6. Team Alerts</h2>${topACIssues.map(i => `<p class="issue-red">⚠ ${i}</p>`).join('')}` : ''}

<div class="footer">CONFIDENTIAL — Team Abhipsa · LawSikho (Addictive Learning Technology Ltd) · HERA v5</div>
</body></html>`;

  const reportPath = path.join(REPORTS_DIR, `${reportId}.html`);
  fs.writeFileSync(reportPath, html);

  return { id: reportId, url: `/api/report/${reportId}`, htmlContent: html, vertical: vk, period, generatedAt: now };
}

// ── AI CONTEXT BUILDER ───────────────────────────────────────
function buildAskContext(question) {
  const allHealth = computeAllHealth();
  const topIssues = allHealth
    .filter(h => h.status === 'red' || h.status === 'amber')
    .flatMap(h => h.issues.map(i => `[${h.cohort}] ${i}`))
    .slice(0, 6);

  const revByVertical = {};
  Object.keys(DATA.verticals).forEach(vk => {
    const total = DATA.verticals[vk].revenue.reduce((s, r) => s + r.price, 0);
    revByVertical[vk] = total;
  });
  const revenueSnapshot = Object.entries(revByVertical).map(([v, r]) => `${v}:₹${rupees(r)}`).join(', ');

  const criticalTeam = DATA.team
    .filter(t => t.lopDays >= 2 || t.assigned > 60)
    .map(t => `${t.name}:${t.assigned}leads,${t.lopDays}LOP`)
    .slice(0, 5)
    .join(', ');

  const stageMap = {};
  DATA.leads.forEach(l => { stageMap[l.stage || 'Unknown'] = (stageMap[l.stage || 'Unknown'] || 0) + 1; });
  const notPickingUp = stageMap['Not Picking Up'] || stageMap['not picking up'] || 0;

  return `LawSikho Team Abhipsa intelligence platform. 5 verticals: CD (Contract Drafting), CL (Criminal Litigation), ID (Independent Drafting), AI (Legal AI), AIW (AI for Women).
TOP ISSUES: ${topIssues.join('. ') || 'No critical issues'}.
REVENUE: ${revenueSnapshot || 'No data'}.
TEAM: ${criticalTeam || 'No critical alerts'}.
PIPELINE: ${DATA.leads.length} live leads. ${notPickingUp} not picking up.
User question: ${question}
Answer with specific numbers from the data. Be direct. Under 200 words.`;
}

// ── ROUTES ───────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    integrations: {
      razorpay: !!process.env.RAZORPAY_KEY_ID,
      payu: !!process.env.PAYU_KEY,
      shopse: !!process.env.SHOPSE_KEY,
      fibe: !!process.env.FIBE_KEY,
      aisensy: !!process.env.AISENSY_API_KEY,
      growthx: !!process.env.GROWTHX_API_KEY,
      sharefree: true
    }
  });
});

app.get('/api/data', (req, res) => {
  const allHealth = computeAllHealth();
  const topIssues = allHealth
    .filter(h => h.status === 'red' || h.status === 'amber')
    .sort((a, b) => (a.status === 'red' ? -1 : 1))
    .flatMap(h => h.issues.map(i => ({ cohort: h.cohort, vertical: h.vertical, issue: i, status: h.status })))
    .slice(0, 8);

  // Only expose Team Abhipsa verticals (CD/CL/ID/AI/AIW)
  const abhipsaVerticals = {};
  ['CD','CL','ID','AI','AIW'].forEach(v => { abhipsaVerticals[v] = DATA.verticals[v]; });

  res.json({
    syncedAt: DATA.syncedAt,
    syncing: DATA.syncing,
    paused: DATA.paused,
    lastError: DATA.lastError,
    verticals: abhipsaVerticals,
    team: abhipsaOnly(DATA.team),
    leads: abhipsaOnly(DATA.leads),
    revenue: abhipsaOnly(DATA.revenue),
    marketing: abhipsaOnly(DATA.marketing),
    webinarDNA: abhipsaOnly(DATA.webinarDNA),
    groups: abhipsaOnly(DATA.groups),
    monthlySheets: DATA.monthlySheets,
    formResponses: DATA.formResponses,
    topIssues,
    allHealth
  });
});

app.get('/api/data/vertical/:v', (req, res) => {
  const vk = (req.params.v || '').toUpperCase();
  if (!DATA.verticals[vk]) return res.status(404).json({ error: 'Unknown vertical' });
  const vData = DATA.verticals[vk];
  const health = vData.cohorts.map(c => healthScore(c));
  res.json({ vertical: vk, ...vData, health });
});

app.get('/api/data/status', (req, res) => {
  res.json({
    syncing: DATA.syncing,
    paused: DATA.paused,
    syncedAt: DATA.syncedAt,
    lastError: DATA.lastError,
    counts: {
      leads: DATA.leads.length,
      revenue: DATA.revenue.length,
      webinars: DATA.webinarDNA.length,
      team: DATA.team.length
    }
  });
});

app.post('/api/sync', async (req, res) => {
  if (DATA.syncing) return res.json({ message: 'Sync already in progress' });
  syncData();
  res.json({ message: 'Sync started' });
});

app.post('/api/sync/pause', (req, res) => {
  DATA.paused = true;
  res.json({ paused: true });
});

app.post('/api/sync/resume', (req, res) => {
  DATA.paused = false;
  res.json({ paused: false });
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const fn = req.file.originalname.toLowerCase();
    let wb;
    try {
      wb = XLSX.readFile(path.join(DATA_DIR, req.file.originalname));
    } catch (e) {
      return res.status(400).json({ error: 'Could not parse file: ' + e.message });
    }
    const sheets = wb.SheetNames;
    const preview = readSheet(wb, sheets[0]).slice(0, 5);
    // Trigger resync
    syncData();
    res.json({
      filename: req.file.originalname,
      sheets,
      totalSheets: sheets.length,
      preview,
      message: 'File uploaded and sync triggered'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DATA SOURCES (persistent config) ────────────────────────
const DATA_SOURCES_FILE = path.join(DATA_DIR, '_sources.json');

function loadSources() {
  try { return JSON.parse(fs.readFileSync(DATA_SOURCES_FILE, 'utf8')); } catch(e) { return []; }
}

function saveSources(sources) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_SOURCES_FILE, JSON.stringify(sources, null, 2));
}

app.get('/api/sources', (req, res) => {
  res.json(loadSources());
});

app.post('/api/sources', (req, res) => {
  const sources = loadSources();
  const newSource = {
    id: Date.now().toString(36),
    type: req.body.type || 'url',
    name: req.body.name || 'Unnamed',
    url: req.body.url || '',
    addedAt: new Date().toISOString()
  };
  sources.push(newSource);
  saveSources(sources);
  res.json(newSource);
});

app.delete('/api/sources/:id', (req, res) => {
  const sources = loadSources().filter(s => s.id !== req.params.id);
  saveSources(sources);
  res.json({ ok: true });
});

// Fetch xlsx from a URL (Google Drive export or direct link)
app.post('/api/fetch-url', async (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  // Convert Google Drive share link to direct download
  let fetchUrl = url;
  const gdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (gdMatch) {
    fetchUrl = "https://drive.google.com/uc?export=download&id=" + gdMatch[1];
  }
  // Google Sheets export
  const gsMatch = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (gsMatch) {
    fetchUrl = "https://docs.google.com/spreadsheets/d/" + gsMatch[1] + "/export?format=xlsx";
  }

  try {
    const chunks = [];
    await new Promise((resolve, reject) => {
      const urlObj = new URL(fetchUrl);
      const mod = urlObj.protocol === 'https:' ? https : require('http');
      const doReq = (targetUrl) => {
        mod.get(targetUrl, (r) => {
          if (r.statusCode === 301 || r.statusCode === 302) {
            doReq(r.headers.location);
            return;
          }
          r.on('data', c => chunks.push(c));
          r.on('end', resolve);
          r.on('error', reject);
        }).on('error', reject);
      };
      doReq(fetchUrl);
    });

    const buf = Buffer.concat(chunks);
    if (buf.length < 100) return res.status(400).json({ error: 'Downloaded file too small — check the URL or sharing permissions' });

    const filename = (name || 'fetched_data') + '.xlsx';
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, filename), buf);

    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheets = wb.SheetNames;
    const preview = readSheet(wb, sheets[0]).slice(0, 5);

    // Save as a source
    const sources = loadSources();
    sources.push({ id: Date.now().toString(36), type: 'url', name: filename, url: fetchUrl, addedAt: new Date().toISOString() });
    saveSources(sources);

    syncData();
    res.json({ filename, sheets, totalSheets: sheets.length, preview, size: buf.length, message: 'Fetched and synced' });
  } catch (e) {
    res.status(500).json({ error: 'Fetch failed: ' + e.message });
  }
});

// List files currently in /data
app.get('/api/data-files', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'))
      .map(f => {
        const stats = fs.statSync(path.join(DATA_DIR, f));
        return { name: f, size: stats.size, modified: stats.mtime };
      });
    res.json(files);
  } catch(e) { res.json([]); }
});

app.delete('/api/data-files/:name', (req, res) => {
  try {
    const fp = path.join(DATA_DIR, path.basename(req.params.name));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    syncData();
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/report/generate', (req, res) => {
  try {
    const { vertical, period } = req.body;
    const report = buildReport(vertical || 'CD', period || 'today');
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/report/:id', (req, res) => {
  const fp = path.join(REPORTS_DIR, `${req.params.id}.html`);
  if (!fs.existsSync(fp)) return res.status(404).send('Report not found');
  res.setHeader('Content-Type', 'text/html');
  res.sendFile(fp);
});

app.get('/api/reports/list', (req, res) => {
  const files = fs.readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('.html'))
    .map(f => {
      const id = f.replace('.html', '');
      const stats = fs.statSync(path.join(REPORTS_DIR, f));
      return { id, url: `/api/report/${id}`, createdAt: stats.mtime };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);
  res.json(files);
});

app.post('/api/ai', (req, res) => {
  const key = req.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY || '';
  if (!key) return res.status(401).json({ error: 'No API key' });

  let bodyData = req.body;
  if (req.body.hera_ask) {
    const context = buildAskContext(req.body.hera_ask);
    bodyData = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: context }]
    };
  }

  const body = JSON.stringify(bodyData);
  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const proxyReq = https.request(options, proxyRes => {
    res.status(proxyRes.statusCode);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', err => res.status(500).json({ error: err.message }));
  proxyReq.write(body);
  proxyReq.end();
});

app.post('/api/webhook/sharefree', (req, res) => {
  const { name, email, amount, product, timestamp } = req.body;
  if (name && amount) {
    DATA.revenue.push({
      name, email,
      date: timestamp || new Date().toISOString(),
      community: product || '',
      price: safeNum(amount),
      callerName: 'Sharefree',
      mode: 'Sharefree',
      vertical: detectVertical(product || '')
    });
  }
  res.json({ received: true });
});

// ── INTEGRATIONS STORE ───────────────────────────────────────
// Holds credentials + fetched data in memory (never written to disk)
let INTEGRATIONS = {
  meta:      { token: null, accountId: null, data: null, syncedAt: null, error: null },
  cashfree:  { appId: null, secretKey: null, env: 'prod', data: null, syncedAt: null, error: null },
  aisensy:   { apiKey: null, data: null, syncedAt: null, error: null },
  growthx:   { apiKey: null, data: null, syncedAt: null, error: null },
  mail:      { provider: null, apiKey: null, listId: null, data: null, syncedAt: null, error: null }
};

// ── HTTP HELPER ──────────────────────────────────────────────
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'Accept': 'application/json', ...headers }
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpPost(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(opts, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch(e) { resolve({ status: res.statusCode, data: b }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── META ADS ─────────────────────────────────────────────────
async function syncMeta() {
  const { token, accountId } = INTEGRATIONS.meta;
  if (!token || !accountId) throw new Error('Meta token or accountId not configured');
  INTEGRATIONS.meta.error = null;

  const base = `https://graph.facebook.com/v19.0/act_${accountId}`;
  const fields = 'campaign_name,adset_name,ad_name,impressions,clicks,spend,cpm,cpc,ctr,actions,cost_per_action_type,reach,frequency';
  const period = 'last_90d';

  // Fetch ad-level insights
  const insightsUrl = `${base}/insights?fields=${fields}&date_preset=${period}&level=ad&limit=500&access_token=${token}`;
  const r = await httpGet(insightsUrl);
  if (r.status !== 200) throw new Error(`Meta API error ${r.status}: ${JSON.stringify(r.data).slice(0,200)}`);

  const rows = r.data.data || [];

  // Fetch campaigns for status
  const campUrl = `${base}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget&limit=200&access_token=${token}`;
  const cr = await httpGet(campUrl);
  const campaigns = (cr.data.data || []).reduce((m, c) => { m[c.name] = c; return m; }, {});

  // Fetch adsets for funnel link
  const adsetUrl = `${base}/adsets?fields=id,name,campaign_id,targeting,status&limit=500&access_token=${token}`;
  const ar = await httpGet(adsetUrl);
  const adsets = (ar.data.data || []).reduce((m, a) => { m[a.name] = a; return m; }, {});

  // Enrich rows
  const enriched = rows.map(row => {
    const leads = (row.actions || []).find(a => a.action_type === 'lead')?.value || 0;
    const purchases = (row.actions || []).find(a => a.action_type === 'offsite_conversion.fb_pixel_purchase' || a.action_type === 'purchase')?.value || 0;
    const vertical = detectVertical(row.campaign_name || row.adset_name || row.ad_name || '');
    const cpl = leads > 0 ? (safeNum(row.spend) / leads) : null;
    return {
      campaignName: row.campaign_name || '',
      adsetName: row.adset_name || '',
      adName: row.ad_name || '',
      vertical,
      impressions: safeNum(row.impressions),
      clicks: safeNum(row.clicks),
      spend: safeNum(row.spend),
      cpm: safeNum(row.cpm),
      cpc: safeNum(row.cpc),
      ctr: safeNum(row.ctr),
      reach: safeNum(row.reach),
      frequency: safeNum(row.frequency),
      leads: safeNum(leads),
      purchases: safeNum(purchases),
      cpl,
      cpa: purchases > 0 ? safeNum(row.spend) / purchases : null,
      cvrClickToLead: safeNum(row.clicks) > 0 ? (safeNum(leads) / safeNum(row.clicks)) * 100 : 0,
      campaignStatus: campaigns[row.campaign_name]?.status || 'UNKNOWN'
    };
  });

  INTEGRATIONS.meta.data = enriched;
  INTEGRATIONS.meta.syncedAt = new Date().toISOString();
  return enriched;
}

// ── CASHFREE ─────────────────────────────────────────────────
async function syncCashfree() {
  const { appId, secretKey, env } = INTEGRATIONS.cashfree;
  if (!appId || !secretKey) throw new Error('Cashfree credentials not configured');
  INTEGRATIONS.cashfree.error = null;

  const host = env === 'sandbox' ? 'sandbox.cashfree.com' : 'api.cashfree.com';
  const headers = { 'x-client-id': appId, 'x-client-secret': secretKey, 'x-api-version': '2023-08-01' };

  // Fetch last 90 days of orders
  const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const to   = new Date().toISOString().slice(0, 10);
  const r = await httpGet(`https://${host}/pg/orders?from=${from}&to=${to}&count=200`, headers);
  if (r.status !== 200) throw new Error(`Cashfree API error ${r.status}: ${JSON.stringify(r.data).slice(0,200)}`);

  const orders = (r.data.data || r.data || []).map(o => ({
    orderId:    o.order_id || o.cf_order_id || '',
    customerName:  o.customer_details?.customer_name || o.customer_name || '',
    customerEmail: o.customer_details?.customer_email || o.customer_email || '',
    customerPhone: o.customer_details?.customer_phone || o.customer_phone || '',
    amount:     safeNum(o.order_amount),
    currency:   o.order_currency || 'INR',
    status:     o.order_status || '',
    createdAt:  o.created_at || o.order_tags?.created_at || '',
    tags:       o.order_tags || {},
    vertical:   detectVertical(o.order_note || o.order_tags?.product || '')
  })).filter(o => o.status === 'PAID' || o.status === 'SUCCESS');

  INTEGRATIONS.cashfree.data = orders;
  INTEGRATIONS.cashfree.syncedAt = new Date().toISOString();
  return orders;
}

// ── AISENSY ──────────────────────────────────────────────────
async function syncAisensy() {
  const { apiKey } = INTEGRATIONS.aisensy;
  if (!apiKey) throw new Error('AiSensy API key not configured');
  INTEGRATIONS.aisensy.error = null;

  const headers = { 'x-api-key': apiKey };

  // Fetch all campaigns/broadcasts
  const cr = await httpGet('https://backend.aisensy.com/direct-apis/t1/campaigns?limit=50', headers);

  // Fetch all contacts count
  const contacts = cr.status === 200 ? (cr.data.data || cr.data || []) : [];

  // Cross-reference: for each paid lead, check if they're in a WA group
  const paid = DATA.revenue.filter(r => r.email || r.phone);
  const checks = [];

  for (const lead of paid.slice(0, 100)) { // limit to avoid rate limits
    const query = lead.phone || lead.email;
    if (!query) continue;
    try {
      const res = await httpGet(`https://backend.aisensy.com/direct-apis/t1/contacts/search?query=${encodeURIComponent(query)}`, headers);
      const contact = res.data?.data?.[0] || res.data?.[0];
      checks.push({
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        community: lead.finalCommunity || lead.community,
        vertical: lead.vertical,
        paidDate: lead.date,
        amount: lead.price,
        found: !!contact,
        waTags: contact?.tags || [],
        waGroups: contact?.labels || [],
        inCorrectGroup: contact ? checkGroupMatch(lead, contact) : false
      });
    } catch(e) {
      checks.push({ name: lead.name, email: lead.email, found: false, inCorrectGroup: false, error: e.message });
    }
  }

  INTEGRATIONS.aisensy.data = { campaigns: contacts, checks };
  INTEGRATIONS.aisensy.syncedAt = new Date().toISOString();
  return INTEGRATIONS.aisensy.data;
}

function checkGroupMatch(lead, contact) {
  const community = (lead.finalCommunity || lead.community || '').toLowerCase();
  const tags = (contact.tags || []).concat(contact.labels || []).map(t => (t.name || t || '').toLowerCase());
  return tags.some(t => community && (t.includes(community.slice(0,10)) || community.includes(t.slice(0,10))));
}

// ── GROWTHX ───────────────────────────────────────────────────
const GROWTHX_BASE = 'https://growthx.skillarbitra.ge';

function growthxToken() {
  const t = INTEGRATIONS.growthx.apiKey || process.env.GROWTHX_TOKEN;
  if (!t) throw new Error('GrowthX token not configured. Add GROWTHX_TOKEN in Railway env vars or save via Funnel page.');
  return t;
}

function validateDateRange(from, to) {
  if (!from || !to) throw new Error('from and to dates are required (YYYY-MM-DD)');
  const d1 = new Date(from), d2 = new Date(to);
  if (isNaN(d1) || isNaN(d2)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  const days = (d2 - d1) / 86400000;
  if (days < 0) throw new Error('"from" must be before "to"');
  if (days > 31) throw new Error('Date range cannot exceed 31 days');
  return { d1, d2, days };
}

async function fetchGrowthxLeads(from, to, opts = {}) {
  validateDateRange(from, to);
  let url = `${GROWTHX_BASE}/api/public/leads?from=${from}&to=${to}`;
  if (opts.group)    url += `&group=${encodeURIComponent(opts.group)}`;
  if (opts.leadtype) url += `&leadtype=${encodeURIComponent(opts.leadtype)}`;
  if (opts.slug)     url += `&slug=${encodeURIComponent(opts.slug)}`;
  const r = await httpGet(url, { 'Authorization': `Bearer ${growthxToken()}` });
  if (r.status !== 200) throw new Error(`GrowthX Leads API ${r.status}: ${JSON.stringify(r.data).slice(0,300)}`);
  return r.data;
}

async function fetchGrowthxFunnel(from, to) {
  validateDateRange(from, to);
  const url = `${GROWTHX_BASE}/api/public/funnels?from=${from}&to=${to}&category=community`;
  const r = await httpGet(url, { 'Authorization': `Bearer ${growthxToken()}` });
  if (r.status !== 200) throw new Error(`GrowthX Funnel API ${r.status}: ${JSON.stringify(r.data).slice(0,300)}`);
  return r.data;
}

async function syncGrowthx() {
  INTEGRATIONS.growthx.error = null;
  // Default: last 30 days
  const to   = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [leadsData, funnelData] = await Promise.allSettled([
    fetchGrowthxLeads(from, to),
    fetchGrowthxFunnel(from, to)
  ]);
  INTEGRATIONS.growthx.data = {
    leads:  leadsData.status  === 'fulfilled' ? leadsData.value  : { error: leadsData.reason?.message },
    funnel: funnelData.status === 'fulfilled' ? funnelData.value : { error: funnelData.reason?.message },
    from, to
  };
  INTEGRATIONS.growthx.syncedAt = new Date().toISOString();
  INTEGRATIONS.growthx.apiKey = growthxToken(); // persist resolved token
  return INTEGRATIONS.growthx.data;
}

async function syncMail() {
  const { provider, apiKey, listId } = INTEGRATIONS.mail;
  if (!apiKey) throw new Error('Mail API key not configured');
  INTEGRATIONS.mail.error = null;

  let campaigns = [];

  if (provider === 'mailchimp') {
    // Mailchimp needs dc from key (key ends in -usXX)
    const dc = (apiKey.split('-').pop()) || 'us1';
    const r = await httpGet(`https://${dc}.api.mailchimp.com/3.0/campaigns?count=50&status=sent`, {
      'Authorization': `Basic ${Buffer.from('anystring:' + apiKey).toString('base64')}`
    });
    campaigns = (r.data.campaigns || []).map(c => ({
      id: c.id, subject: c.settings?.subject_line || '', sentAt: c.send_time,
      recipients: c.recipients?.recipient_count || 0,
      opens: c.report_summary?.unique_opens || 0,
      clicks: c.report_summary?.unique_subscriber_clicks || 0,
      openRate: c.report_summary?.open_rate || 0,
      clickRate: c.report_summary?.click_rate || 0
    }));
  } else if (provider === 'sendgrid') {
    const r = await httpGet('https://api.sendgrid.com/v3/campaigns?limit=50', { 'Authorization': `Bearer ${apiKey}` });
    campaigns = (r.data.result || r.data || []).map(c => ({
      id: c.id, subject: c.subject || c.title || '', sentAt: c.send_at,
      recipients: c.recipients || 0
    }));
  } else if (provider === 'mailercloud') {
    const r = await httpGet(`https://api.mailercloud.com/v1/campaigns?api_key=${apiKey}&limit=50`);
    campaigns = (r.data.data || []).map(c => ({
      id: c.id, subject: c.subject || '', sentAt: c.sent_at,
      recipients: c.recipients_count || 0,
      opens: c.unique_opens || 0,
      clicks: c.unique_clicks || 0,
      openRate: c.open_rate || 0,
      clickRate: c.click_rate || 0,
      bounces: c.bounces || 0,
      unsubscribes: c.unsubscribes || 0
    }));
  }

  INTEGRATIONS.mail.data = campaigns;
  INTEGRATIONS.mail.syncedAt = new Date().toISOString();
  return campaigns;
}

// ── STARTUP: load static-data.js into server DATA ─────────────
function loadStaticDataOnStartup() {
  const p = path.join(__dirname, 'public', 'static-data.js');
  if (!fs.existsSync(p)) return;
  try {
    const content = fs.readFileSync(p, 'utf8');
    const m = content.match(/window\.STATIC_DATA\s*=\s*(\{[\s\S]*?\});\s*$/);
    if (!m) return;
    const sd = JSON.parse(m[1]);
    DATA.leads      = sd.leads      || [];
    DATA.revenue    = sd.revenue    || [];
    DATA.marketing  = sd.marketing  || [];
    DATA.webinarDNA = sd.webinarDNA || [];
    DATA.groups     = sd.groups     || [];
    DATA.team       = sd.team       || [];
    DATA.lop        = sd.lop        || [];
    DATA.talktime   = sd.talktime   || [];
    DATA.monthlySheets = sd.monthlySheets || {};
    if (sd.cohorts) {
      ['CD','CL','ID','AI','AIW'].forEach(v => {
        DATA.verticals[v].cohorts = sd.cohorts.filter(c => c.vertical === v);
      });
    }
    DATA.syncedAt = sd.seededAt;

    // Reset vertical sub-arrays then distribute from flat arrays (same as parseAllFiles)
    ['CD','CL','ID','AI','AIW'].forEach(v => {
      DATA.verticals[v].pipeline = [];
      DATA.verticals[v].revenue  = [];
      DATA.verticals[v].webinars = [];
      DATA.verticals[v].team     = [];
    });
    buildTeamFromData();
    DATA.revenue.forEach(r  => { if (DATA.verticals[r.vertical])  DATA.verticals[r.vertical].revenue.push(r); });
    DATA.webinarDNA.forEach(w => { if (DATA.verticals[w.vertical]) DATA.verticals[w.vertical].webinars.push(w); });
    DATA.leads.forEach(l    => { if (DATA.verticals[l.vertical])   DATA.verticals[l.vertical].pipeline.push(l); });
    DATA.team.forEach(t     => { if (t.vertical && DATA.verticals[t.vertical]) DATA.verticals[t.vertical].team.push(t); });

    console.log(`Static data loaded: ${DATA.leads.length} leads, ${DATA.revenue.length} revenue, ${DATA.webinarDNA.length} webinars`);
    console.log(`Verticals populated: ${['CD','CL','ID','AI','AIW'].map(v=>`${v}:${DATA.verticals[v].pipeline.length}leads/${DATA.verticals[v].revenue.length}rev`).join(' ')}`);
  } catch(e) { console.warn('loadStaticDataOnStartup failed:', e.message); }
}

// ── TEAM ABHIPSA FILTER ───────────────────────────────────────
const ABHIPSA_VERTICALS = new Set(['CD','CL','ID','AI','AIW']);
function abhipsaOnly(arr) {
  return (arr || []).filter(r => !r.vertical || ABHIPSA_VERTICALS.has(r.vertical));
}

// ── INTEGRATION ROUTES ───────────────────────────────────────

// GrowthX: query leads with mandatory date range (max 31 days)
app.post('/api/growthx/leads', async (req, res) => {
  const { from, to, group, leadtype, slug } = req.body;
  try {
    const data = await fetchGrowthxLeads(from, to, { group, leadtype, slug });
    res.json({ ok: true, data });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// GrowthX: fetch funnel data
app.post('/api/growthx/funnel', async (req, res) => {
  const { from, to } = req.body;
  try {
    const data = await fetchGrowthxFunnel(from, to);
    res.json({ ok: true, data });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// Get status of all integrations
app.get('/api/integrations/status', (req, res) => {
  const gxConnected = !!(INTEGRATIONS.growthx.apiKey || process.env.GROWTHX_TOKEN);
  res.json({
    meta:     { connected: !!(INTEGRATIONS.meta.token && INTEGRATIONS.meta.accountId), syncedAt: INTEGRATIONS.meta.syncedAt, error: INTEGRATIONS.meta.error, rows: INTEGRATIONS.meta.data?.length || 0 },
    cashfree: { connected: !!(INTEGRATIONS.cashfree.appId && INTEGRATIONS.cashfree.secretKey), syncedAt: INTEGRATIONS.cashfree.syncedAt, error: INTEGRATIONS.cashfree.error, rows: INTEGRATIONS.cashfree.data?.length || 0 },
    aisensy:  { connected: !!INTEGRATIONS.aisensy.apiKey, syncedAt: INTEGRATIONS.aisensy.syncedAt, error: INTEGRATIONS.aisensy.error, rows: INTEGRATIONS.aisensy.data?.checks?.length || 0 },
    growthx:  { connected: gxConnected, syncedAt: INTEGRATIONS.growthx.syncedAt, error: INTEGRATIONS.growthx.error },
    mail:     { connected: !!INTEGRATIONS.mail.apiKey, syncedAt: INTEGRATIONS.mail.syncedAt, error: INTEGRATIONS.mail.error, rows: INTEGRATIONS.mail.data?.length || 0 },
    webhookUrl: process.env.BASE_URL ? `${process.env.BASE_URL}/api/webhook/payment` : null
  });
});

// Save credentials
app.post('/api/integrations/configure', (req, res) => {
  const { service, ...creds } = req.body;
  if (!INTEGRATIONS[service]) return res.status(400).json({ error: 'Unknown service' });
  Object.assign(INTEGRATIONS[service], creds);
  // Clear stale data when reconfigured
  INTEGRATIONS[service].data = null;
  INTEGRATIONS[service].syncedAt = null;
  INTEGRATIONS[service].error = null;
  res.json({ ok: true, service });
});

// Trigger sync for a service
app.post('/api/integrations/sync/:service', async (req, res) => {
  const { service } = req.params;
  try {
    let result;
    if (service === 'meta')      result = await syncMeta();
    else if (service === 'cashfree') result = await syncCashfree();
    else if (service === 'aisensy')  result = await syncAisensy();
    else if (service === 'growthx')  result = await syncGrowthx();
    else if (service === 'mail')     result = await syncMail();
    else return res.status(400).json({ error: 'Unknown service' });
    res.json({ ok: true, rows: Array.isArray(result) ? result.length : 1 });
  } catch(e) {
    INTEGRATIONS[service] && (INTEGRATIONS[service].error = e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get integration data for frontend
app.get('/api/integrations/data', (req, res) => {
  res.json({
    meta:     INTEGRATIONS.meta.data,
    cashfree: INTEGRATIONS.cashfree.data,
    aisensy:  INTEGRATIONS.aisensy.data,
    growthx:  INTEGRATIONS.growthx.data,
    mail:     INTEGRATIONS.mail.data
  });
});

// Funnel analytics: cross-join Meta ads → Leads → Revenue → AiSensy
app.get('/api/funnel', (req, res) => {
  const vertical = req.query.vertical || null;

  // Filter by vertical if specified
  const filterV = arr => vertical ? arr.filter(r => !vertical || r.vertical === vertical) : arr;

  const metaAds   = filterV(INTEGRATIONS.meta.data || []);
  const leads     = filterV(DATA.leads);
  const revenue   = filterV(DATA.revenue);
  const webinars  = filterV(DATA.webinarDNA);
  const aiChecks  = (INTEGRATIONS.aisensy.data?.checks || []).filter(c => !vertical || c.vertical === vertical);

  // Aggregate by vertical
  const verticals = ['CD','CL','ID','AI','AIW','Other'];
  const byVertical = verticals.map(v => {
    const ads  = metaAds.filter(a => a.vertical === v);
    const ls   = DATA.leads.filter(l => l.vertical === v);
    const rev  = DATA.revenue.filter(r => r.vertical === v);
    const webs = DATA.webinarDNA.filter(w => w.vertical === v);
    const chks = (INTEGRATIONS.aisensy.data?.checks || []).filter(c => c.vertical === v);

    const spend       = ads.reduce((s, a) => s + a.spend, 0);
    const impressions = ads.reduce((s, a) => s + a.impressions, 0);
    const adLeads     = ads.reduce((s, a) => s + a.leads, 0);
    const totalLeads  = ls.length;
    const webAttend   = webs.reduce((s, w) => s + (w.attendees || 0), 0);
    const webConv     = webs.reduce((s, w) => s + (w.conversions || 0), 0);
    const enrolled    = rev.length;
    const revenue_sum = rev.reduce((s, r) => s + r.price, 0);
    const inGroup     = chks.filter(c => c.inCorrectGroup).length;
    const missingGroup= chks.filter(c => c.found && !c.inCorrectGroup).length;

    return {
      vertical: v,
      funnel: [
        { stage: 'Ad Impressions', count: impressions, spend },
        { stage: 'Clicks',         count: ads.reduce((s,a)=>s+a.clicks,0) },
        { stage: 'Ad Leads',       count: adLeads },
        { stage: 'Total Leads',    count: totalLeads },
        { stage: 'Webinar Attended', count: webAttend },
        { stage: 'Webinar Converted', count: webConv },
        { stage: 'Enrolled (Paid)', count: enrolled, revenue: revenue_sum },
        { stage: 'In WA Group',    count: inGroup }
      ],
      dropoffs: computeDropoffs(adLeads, totalLeads, webAttend, webConv, enrolled, inGroup),
      ads: ads.slice(0, 20),
      cpl: adLeads > 0 ? spend / adLeads : null,
      roas: spend > 0 ? revenue_sum / spend : null
    };
  });

  // Per-campaign funnel breakdown
  const campaignFunnels = aggregateByCampaign(metaAds, DATA.leads, DATA.revenue);

  res.json({ byVertical, campaignFunnels, syncedAt: new Date().toISOString() });
});

function computeDropoffs(adLeads, totalLeads, webAttend, webConv, enrolled, inGroup) {
  const stages = [adLeads, webAttend, webConv, enrolled, inGroup].filter(n => n > 0);
  const drops = [];
  const labels = ['Leads → Webinar', 'Webinar → Conversion', 'Conversion → Enrolled', 'Enrolled → WA Group'];
  const vals   = [adLeads || totalLeads, webAttend, webConv, enrolled, inGroup];
  for (let i = 0; i < vals.length - 1; i++) {
    if (!vals[i]) continue;
    const rate = vals[i+1] ? ((vals[i+1] / vals[i]) * 100) : 0;
    const drop = 100 - rate;
    drops.push({ label: labels[i], from: vals[i], to: vals[i+1] || 0, convRate: rate.toFixed(1), dropRate: drop.toFixed(1), status: drop > 80 ? 'red' : drop > 60 ? 'amber' : 'green' });
  }
  return drops;
}

function aggregateByCampaign(metaAds, leads, revenue) {
  const map = {};
  metaAds.forEach(a => {
    const key = a.campaignName;
    if (!map[key]) map[key] = { campaignName: key, vertical: a.vertical, spend: 0, impressions: 0, clicks: 0, leads: 0, status: a.campaignStatus };
    map[key].spend       += a.spend;
    map[key].impressions += a.impressions;
    map[key].clicks      += a.clicks;
    map[key].leads       += a.leads;
  });
  // Match revenue to campaigns by date proximity + vertical
  Object.values(map).forEach(c => {
    const rev = revenue.filter(r => r.vertical === c.vertical);
    c.enrolled = rev.length;
    c.revenue  = rev.reduce((s, r) => s + r.price, 0);
    c.cpl      = c.leads > 0 ? c.spend / c.leads : null;
    c.roas     = c.spend > 0 ? c.revenue / c.spend : null;
  });
  return Object.values(map).sort((a, b) => b.spend - a.spend);
}

// Cashfree webhook (incoming payments)
app.post('/api/webhook/payment', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = JSON.parse(req.body);
    const { type, data } = event;
    if (type === 'PAYMENT_SUCCESS_WEBHOOK' || type === 'PAYMENT_SUCCESS') {
      const o = data?.order || data || {};
      const c = data?.customer_details || o.customer_details || {};
      DATA.revenue.push({
        name:      c.customer_name  || '',
        email:     c.customer_email || '',
        phone:     c.customer_phone || '',
        date:      o.created_at     || new Date().toISOString(),
        community: o.order_note     || o.order_id || '',
        price:     safeNum(o.order_amount),
        callerName:'Cashfree',
        mode:      'Cashfree',
        vertical:  detectVertical(o.order_note || o.order_tags?.product || '')
      });
      if (INTEGRATIONS.cashfree.data) {
        INTEGRATIONS.cashfree.data.push({ orderId: o.order_id, amount: safeNum(o.order_amount), status: 'PAID', createdAt: o.created_at });
      }
    }
    res.json({ received: true });
  } catch(e) { res.json({ received: true }); }
});

app.post('/api/webhook/sharefree', (req, res) => {
  const { name, email, amount, product, timestamp } = req.body;
  if (name && amount) {
    DATA.revenue.push({
      name, email,
      date: timestamp || new Date().toISOString(),
      community: product || '',
      price: safeNum(amount),
      callerName: 'Sharefree',
      mode: 'Sharefree',
      vertical: detectVertical(product || '')
    });
  }
  res.json({ received: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Pre-populate INTEGRATIONS.growthx from env var so it works without UI config
if (process.env.GROWTHX_TOKEN) {
  INTEGRATIONS.growthx.apiKey = process.env.GROWTHX_TOKEN;
}

// ── Google Sheets CSV proxy (avoids CORS) ──────────────────────
app.post('/api/fetch-url', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
  const allowed = /^https:\/\/docs\.google\.com\/spreadsheets\//;
  if (!allowed.test(url)) return res.status(403).json({ error: 'Only Google Sheets publish URLs are allowed' });
  try {
    const https = require('https');
    const fetchUrl = (u) => new Promise((resolve, reject) => {
      https.get(u, { headers: { 'User-Agent': 'HERA/5' } }, (r) => {
        if (r.statusCode === 301 || r.statusCode === 302) return resolve(fetchUrl(r.headers.location));
        let body = '';
        r.on('data', d => body += d);
        r.on('end', () => resolve({ status: r.statusCode, body }));
      }).on('error', reject);
    });
    const result = await fetchUrl(url);
    if (result.status !== 200) return res.status(502).json({ error: `Upstream ${result.status}` });
    // Parse CSV into rows array
    const lines = result.body.split('\n').filter(Boolean);
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
      return obj;
    });
    res.json({ headers, rows, rowCount: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log('HERA v5 running on port ' + PORT);
  console.log('Dev mode:', IS_DEV ? 'ON (1-minute cron)' : 'OFF (3-hour cron)');
  loadStaticDataOnStartup();
});
