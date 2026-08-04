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

  res.json({
    syncedAt: DATA.syncedAt,
    syncing: DATA.syncing,
    paused: DATA.paused,
    lastError: DATA.lastError,
    verticals: DATA.verticals,
    team: DATA.team,
    leads: DATA.leads,
    revenue: DATA.revenue,
    marketing: DATA.marketing,
    webinarDNA: DATA.webinarDNA,
    groups: DATA.groups,
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

app.get('/api/integrations/status', (req, res) => {
  res.json({
    razorpay: !!process.env.RAZORPAY_KEY_ID,
    payu: !!process.env.PAYU_KEY,
    shopse: !!process.env.SHOPSE_KEY,
    fibe: !!process.env.FIBE_KEY,
    aisensy: !!process.env.AISENSY_API_KEY,
    growthx: !!process.env.GROWTHX_API_KEY,
    sharefreeWebhook: process.env.BASE_URL ? `${process.env.BASE_URL}/api/webhook/sharefree` : '/api/webhook/sharefree'
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('HERA v5 running on port ' + PORT);
  console.log('Dev mode:', IS_DEV ? 'ON (1-minute cron)' : 'OFF (3-hour cron)');
});
