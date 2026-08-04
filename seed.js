// Run: node seed.js
// Reads all xlsx files from ./data/ and writes ./public/static-data.js
// Commit the result to git so Railway always has fresh static data

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const OUT_FILE = path.join(__dirname, 'public', 'static-data.js');

function safeNum(v) { return parseFloat(v) || 0; }

function detectVertical(str) {
  const s = (str || '').toUpperCase();
  if (s.includes('AI FOR WOMEN') || s.includes('WOMEN')) return 'AIW';
  if (s.includes('LEGAL AI') || s.includes('AI FOR LEGAL')) return 'AI';
  if (s.includes('CONTRACT') || s.includes('DRAFTING')) return 'CD';
  if (s.includes('CRIMINAL') || s.includes('LITIGATION')) return 'CL';
  if (s.includes('INDEPENDENT') || s.includes('/ ID') || s.includes('/ID')) return 'ID';
  return 'Other';
}

function readSheet(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

function findSheet(wb, keywords) {
  for (const kw of keywords) {
    const found = wb.SheetNames.find(n => n.toLowerCase().includes(kw.toLowerCase()));
    if (found) return found;
  }
  return wb.SheetNames[0];
}

const OUT = {
  seededAt: new Date().toISOString(),
  leads: [],
  revenue: [],
  marketing: [],
  webinarDNA: [],
  groups: [],
  cohorts: [],
  team: [],
  lop: [],
  talktime: [],
  monthlySheets: {}
};

const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
console.log('Found files:', files);

files.forEach(file => {
  const fp = path.join(DATA_DIR, file);
  let wb;
  try { wb = XLSX.readFile(fp); } catch(e) { console.warn('Skip', file, e.message); return; }
  const fn = file.toLowerCase();
  console.log('Parsing:', file, '—', wb.SheetNames.length, 'sheets');

  if (fn.includes('community_master') || fn.includes('community master')) {
    // Leads
    const ls = findSheet(wb, ['raw_leads_status', 'leads_status', 'leads status']);
    if (ls) {
      const rows = readSheet(wb, ls);
      OUT.leads = rows.map(r => ({
        name: r['Customer Name'] || r['Name'] || '',
        email: r['Email'] || r['email'] || '',
        stage: r['Stage'] || r['stage'] || '',
        owner: r['Owner'] || r['owner'] || '',
        vertical: detectVertical(r['Items'] || r['Community'] || ''),
        date: r['Date'] || ''
      })).filter(r => r.name || r.email);
      console.log('  Leads:', OUT.leads.length);
    }

    // Revenue
    const rs = findSheet(wb, ['compiled_revenue', 'compiled revenue', 'revenue']);
    if (rs) {
      OUT.revenue = readSheet(wb, rs).map(r => ({
        name: r['Name'] || r['name'] || '',
        date: r['Course Paid Date'] || r['Paid Date'] || '',
        community: r['Final community name'] || r['Community'] || '',
        price: safeNum(r['Price'] || r['Amount'] || 0),
        callerName: r['Caller Name'] || r['Caller'] || '',
        mode: r['Mode of Payment'] || '',
        vertical: detectVertical(r['Community'] || r['Final community name'] || '')
      })).filter(r => r.price > 0 || r.name);
      console.log('  Revenue:', OUT.revenue.length);
    }

    // Marketing
    const ms = findSheet(wb, ['raw_marketing_spent', 'marketing_spent', 'marketing']);
    if (ms) {
      OUT.marketing = readSheet(wb, ms).map(r => ({
        groupName: r['Group Name'] || r['Group'] || '',
        spent: safeNum(r['Total Spent (GST)'] || r['Total Spent'] || 0),
        leads: safeNum(r['Leads'] || 0),
        cpl: safeNum(r['CPL'] || 0),
        vertical: detectVertical(r['Group Name'] || '')
      })).filter(r => r.spent > 0 || r.leads > 0);
      console.log('  Marketing:', OUT.marketing.length);
    }

    // Webinar DNA
    const ws2 = findSheet(wb, ['webinar list', 'webinar dna', 'dna']);
    if (ws2) {
      OUT.webinarDNA = readSheet(wb, ws2).map(r => ({
        date: r['Date'] || '',
        community: r['Community Name'] || r['Community'] || '',
        topic: r['Topic'] || '',
        attendees: safeNum(r['Attendees'] || r['Attendance'] || 0),
        conversions: safeNum(r['Conversions'] || r['Conversion'] || 0),
        recording: r['Recordings'] || r['Recording'] || '',
        transcript: r['Transcript'] || '',
        vertical: detectVertical(r['Community Name'] || r['Community'] || '')
      })).filter(r => r.community);
      console.log('  Webinars:', OUT.webinarDNA.length);
    }

    // Cohorts from Target sheet
    const ts = findSheet(wb, ['target dec 2025', 'target dec', 'target 2025']);
    if (ts) {
      const cohortMap = {};
      readSheet(wb, ts).forEach(r => {
        const name = r['Group name'] || r['Group Name'] || r['Community'] || '';
        if (!name) return;
        if (!cohortMap[name]) cohortMap[name] = {
          id: name,
          vertical: detectVertical(name),
          leads: safeNum(r['Leads'] || 0),
          units: safeNum(r['Units'] || 0),
          pool: safeNum(r['Pool'] || r['Revenue'] || 0),
          revenue: safeNum(r['Revenue'] || 0),
          roadmapDone: safeNum(r['Roadmap Done'] || 0),
          w: []
        };
        const c = cohortMap[name];
        c.cvr = c.leads > 0 ? (c.units / c.leads) * 100 : 0;
        for (let i = 0; i <= 12; i++) {
          const v = safeNum(r['W' + i] || r['w' + i] || 0);
          if (v > 0) c.w[i] = v;
        }
      });
      OUT.cohorts = Object.values(cohortMap);
      console.log('  Cohorts:', OUT.cohorts.length);
    }

    // Groups / Communities
    const gs = findSheet(wb, ['new-community details', 'community details']);
    if (gs) {
      OUT.groups = readSheet(wb, gs).map(r => ({
        communityName: r['Community Name'] || r['Community'] || '',
        cm: r['CM'] || '',
        startDate: r['Start Date'] || '',
        endDate: r['End Date'] || '',
        members: safeNum(r['Members'] || 0),
        whatsappLink: r['WhatsApp Link'] || r['WA Link'] || '',
        offerPage: r['Offer page links'] || r['Offer Page'] || '',
        vertical: detectVertical(r['Community Name'] || '')
      })).filter(r => r.communityName);
      console.log('  Groups:', OUT.groups.length);
    }

    // Monthly sheets
    const monthRe = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[- _]?\d{4}$/i;
    wb.SheetNames.forEach(n => {
      if (monthRe.test(n.trim())) {
        const rows = readSheet(wb, n);
        OUT.monthlySheets[n] = rows.map(r => ({
          name: r['Name'] || '',
          date: r['Course Paid Date'] || r['Date'] || '',
          community: r['Community'] || '',
          price: safeNum(r['Price'] || 0),
          callerName: r['Caller Name'] || '',
          mode: r['Mode of Payment'] || '',
          vertical: detectVertical(r['Community'] || '')
        })).filter(r => r.price > 0);
        console.log('  Monthly', n, ':', OUT.monthlySheets[n].length, 'rows');
      }
    });
  }

  if (fn.includes('counsellor__lop') || fn.includes('counsellor_lop')) {
    const ls = findSheet(wb, ['may22', 'lop', 'leave']);
    if (ls) {
      OUT.lop = readSheet(wb, ls).map(r => ({
        name: r['Name'] || r['name'] || '',
        lopDays: safeNum(r['Total LOP days'] || r['LOP Days'] || 0),
        deficitMinutes: safeNum(r['Deficit minutes'] || r['Deficit Minutes'] || 0)
      })).filter(r => r.name);
      console.log('  LOP:', OUT.lop.length);
    }
    const ts = findSheet(wb, ['talktime', 'combined talktime']);
    if (ts) {
      OUT.talktime = readSheet(wb, ts).map(r => ({
        name: r['Name'] || r['name'] || '',
        dials: safeNum(r['Dials'] || 0),
        calls20min: safeNum(r['Calls>20min'] || r['Quality Calls'] || 0),
        totalDuration: safeNum(r['Total Duration'] || r['Total Minutes'] || 0)
      })).filter(r => r.name);
      console.log('  Talktime:', OUT.talktime.length);
    }
  }

  if (fn.includes('nitya_requirements') || fn.includes('nitya requirements')) {
    const rs = findSheet(wb, ['raw_roadmap_datacd', 'roadmap data', 'raw_roadmap']);
    if (rs) {
      const roadmap = readSheet(wb, rs);
      roadmap.forEach(r => {
        const community = r['Community'] || '';
        const vertical = detectVertical(community);
        const existing = OUT.cohorts.find(c => c.id === community);
        if (!existing && community) {
          OUT.cohorts.push({ id: community, vertical, leads: 0, units: 0, pool: 0, revenue: 0, cvr: 0, w: [] });
        }
      });
    }
  }
});

// Build team from leads + lop + talktime
const teamMap = {};
OUT.leads.forEach(l => {
  if (!l.owner) return;
  if (!teamMap[l.owner]) teamMap[l.owner] = { name: l.owner, assigned: 0, vertical: l.vertical, lopDays: 0, deficitMin: 0, avgMinDay: 0 };
  teamMap[l.owner].assigned++;
});
OUT.lop.forEach(l => {
  if (!teamMap[l.name]) teamMap[l.name] = { name: l.name, assigned: 0, vertical: '', lopDays: 0, deficitMin: 0, avgMinDay: 0 };
  teamMap[l.name].lopDays = l.lopDays;
  teamMap[l.name].deficitMin = l.deficitMinutes;
});
OUT.talktime.forEach(t => {
  if (!teamMap[t.name]) teamMap[t.name] = { name: t.name, assigned: 0, vertical: '', lopDays: 0, deficitMin: 0, avgMinDay: 0 };
  teamMap[t.name].avgMinDay = t.totalDuration;
});
OUT.team = Object.values(teamMap);
console.log('Team members:', OUT.team.length);

// Write output
const outJs = `// AUTO-GENERATED by seed.js — do not edit manually
// Seeded: ${OUT.seededAt}
// Leads: ${OUT.leads.length} | Revenue: ${OUT.revenue.length} | Webinars: ${OUT.webinarDNA.length} | Cohorts: ${OUT.cohorts.length}
window.STATIC_DATA = ${JSON.stringify(OUT, null, 2)};
`;

fs.writeFileSync(OUT_FILE, outJs);
console.log('\n✓ Written to', OUT_FILE);
console.log('Summary:');
console.log('  Leads:', OUT.leads.length);
console.log('  Revenue:', OUT.revenue.length);
console.log('  Marketing campaigns:', OUT.marketing.length);
console.log('  Webinars:', OUT.webinarDNA.length);
console.log('  Cohorts:', OUT.cohorts.length);
console.log('  Groups:', OUT.groups.length);
console.log('  Team:', OUT.team.length);
console.log('  Monthly sheets:', Object.keys(OUT.monthlySheets).length);
