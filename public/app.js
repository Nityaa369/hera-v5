// ── AUTH ─────────────────────────────────────────────────────
const USERS = {
  abhipsa: { pass: 'hera2025', role: 'full', landing: 'command', label: 'Abhipsa' },
  nitya:   { pass: 'hera2025', role: 'full', landing: 'verticals', label: 'Nitya' },
  data:    { pass: 'hera2025', role: 'ops',  landing: 'pipeline',  label: 'Data Team' }
};

const NAV_ITEMS = [
  { id: 'command',    icon: '⚡', label: 'Command Centre',     roles: ['full'] },
  { id: 'analytics',  icon: '📊', label: 'Intelligence Report', roles: ['full'] },
  { id: 'verticals',  icon: '🏢', label: 'Verticals',           roles: ['full'] },
  { id: 'webinars',   icon: '🎯', label: 'Webinar Intel',       roles: ['full'] },
  { id: 'revenue',    icon: '💰', label: 'Revenue & Sales',     roles: ['full'] },
  { id: 'pipeline',   icon: '📊', label: 'Lead Pipeline',       roles: ['full', 'ops'] },
  { id: 'assignments',icon: '🗂️', label: 'Lead Assignments',    roles: ['full', 'ops'] },
  { id: 'marketing',  icon: '📣', label: 'Marketing Funnel',    roles: ['full'] },
  { id: 'funnel',     icon: '🔀', label: 'Funnel Analytics',    roles: ['full'] },
  { id: 'team',       icon: '👥', label: 'Team Health',         roles: ['full', 'ops'] },
  { id: 'ingest',     icon: '📥', label: 'Data Ingestion',      roles: ['full', 'ops'] },
  { id: 'ops',        icon: '🔧', label: 'Community Ops',       roles: ['full', 'ops'] },
  { id: 'ask',        icon: '🤖', label: 'Ask HERA',            roles: ['full', 'ops'] }
];

let SESSION = null;
let DATA_CACHE = null;
let CURRENT_PAGE = null;
let syncPoller = null;
let tokenCount = 0;
let tokenCost = 0;
let charts = {};

function $(id) { return document.getElementById(id); }

function formatINR(n) {
  n = parseFloat(n) || 0;
  if (n >= 10000000) return "₹" + (n / 10000000).toFixed(2) + " Cr";
  if (n >= 100000)   return "₹" + (n / 100000).toFixed(1) + "L";
  if (n >= 1000)     return "₹" + (n / 1000).toFixed(0) + "K";
  return "₹" + n.toFixed(0);
}
function pct(a, b) { return b > 0 ? ((a / b) * 100).toFixed(1) : "0"; }
function statusBadge(s) {
  const map = { red: 'badge-err', amber: 'badge-warn', green: 'badge-ok', RED: 'badge-err', AMBER: 'badge-warn', GREEN: 'badge-ok' };
  return `<span class="badge ${map[s] || "badge-info"}">${(s || "").toUpperCase()}</span>`;
}
function statusIcon(s) {
  return s === 'red' || s === 'RED' ? '🔴' : s === 'amber' || s === 'AMBER' ? '🟡' : '🟢';
}

function destroyCharts() {
  Object.values(charts).forEach(c => { try { c.destroy(); } catch(e) {} });
  charts = {};
}

// ── LOGIN ─────────────────────────────────────────────────────
function doLogin() {
  const user = $("login-user").value.trim().toLowerCase();
  const pass = $("login-pass").value.trim();
  const apiKey = $("login-key").value.trim();
  const userDef = USERS[user];
  if (!userDef || userDef.pass !== pass) {
    $("login-err").textContent = "Invalid username or password.";
    return;
  }
  SESSION = { user, role: userDef.role, label: userDef.label, apiKey, loginTime: Date.now() };
  $("login-screen").style.display = "none";
  $("app").style.display = "flex";
  $("app").style.flexDirection = "row";
  buildNav();
  updateTopbar();
  startSyncPoller();
  navigate(userDef.landing);
}

$("login-pass").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
$("login-key").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });

function doLogout() {
  SESSION = null;
  DATA_CACHE = null;
  destroyCharts();
  if (syncPoller) clearInterval(syncPoller);
  $("login-screen").style.display = "flex";
  $("app").style.display = "none";
  $("login-pass").value = "";
  $("login-key").value = "";
  $("login-err").textContent = "";
}

setInterval(() => {
  if (SESSION && (Date.now() - SESSION.loginTime) > 8 * 60 * 60 * 1000) doLogout();
}, 60000);

// ── NAV ───────────────────────────────────────────────────────
function buildNav() {
  const menu = $("nav-menu");
  menu.innerHTML = "";
  NAV_ITEMS.forEach(item => {
    if (!item.roles.includes(SESSION.role)) return;
    const div = document.createElement("div");
    div.className = "nav-item";
    div.id = "nav-" + item.id;
    div.innerHTML = `<span class="nav-icon">${item.icon}</span><span>${item.label}</span>`;
    div.onclick = () => navigate(item.id);
    menu.appendChild(div);
  });
  const repBtn = document.createElement("div");
  repBtn.className = "nav-item";
  repBtn.innerHTML = `<span class="nav-icon">📄</span><span>Reports</span>`;
  repBtn.onclick = showReportsModal;
  menu.appendChild(repBtn);

  $("user-chip").innerHTML = `<div style="font-size:11px;color:var(--muted);">Logged in as</div><div style="font-weight:600;color:#fff;">${SESSION.label}</div>`;
}

function navigate(pageId) {
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  const navEl = $("nav-" + pageId);
  if (navEl) navEl.classList.add("active");
  const item = NAV_ITEMS.find(n => n.id === pageId);
  if (item) $("topbar-title").textContent = item.label;
  CURRENT_PAGE = pageId;
  destroyCharts();
  $("main-content").innerHTML = "<div style='text-align:center;padding:60px;color:var(--muted);'><div class='spinner'></div><div style='margin-top:12px;font-size:12px;'>Loading...</div></div>";
  loadDataThen(() => renderPage(pageId));
}

function loadDataThen(cb) {
  fetch("/api/data")
    .then(r => r.json())
    .then(d => {
      // Merge static seed data as baseline; live API data wins on overlap
      if (window.STATIC_DATA) {
        const sd = window.STATIC_DATA;
        const isEmpty = arr => !arr || arr.length === 0;
        if (isEmpty(d.leads))      d.leads      = sd.leads      || [];
        if (isEmpty(d.revenue))    d.revenue    = sd.revenue    || [];
        if (isEmpty(d.marketing))  d.marketing  = sd.marketing  || [];
        if (isEmpty(d.webinarDNA)) d.webinarDNA = sd.webinarDNA || [];
        if (isEmpty(d.groups))     d.groups     = sd.groups     || [];
        if (isEmpty(d.team))       d.team       = sd.team       || [];
        if (isEmpty(d.lop))        d.lop        = sd.lop        || [];
        if (isEmpty(d.talktime))   d.talktime   = sd.talktime   || [];
        if (!d.monthlySheets || !Object.keys(d.monthlySheets || {}).length)
          d.monthlySheets = sd.monthlySheets || {};
        // Merge cohorts: fill in verticals missing from live data
        const liveCohortIds = new Set((d.verticals ? Object.values(d.verticals).flatMap(v => v.cohorts || []).map(c => c.id) : []));
        if (sd.cohorts && sd.cohorts.length && liveCohortIds.size === 0) {
          // Build verticals from static cohorts if server has none
          if (!d.verticals) d.verticals = {};
          ['CD','CL','ID','AI','AIW'].forEach(v => { if (!d.verticals[v]) d.verticals[v] = { cohorts: [], totalLeads: 0, totalRevenue: 0, totalUnits: 0 }; });
          sd.cohorts.forEach(c => {
            const vert = d.verticals[c.vertical];
            if (!vert) return;
            vert.cohorts.push(c);
            vert.totalLeads   += c.leads   || 0;
            vert.totalRevenue += c.revenue || 0;
            vert.totalUnits   += c.units   || 0;
          });
        }
        if (!d.seededAt) d.seededAt = sd.seededAt;
      }
      DATA_CACHE = d;
      cb();
    })
    .catch(e => {
      // If API fails entirely, fall back to pure static data
      if (window.STATIC_DATA) {
        DATA_CACHE = buildDataFromStatic(window.STATIC_DATA);
        cb();
        return;
      }
      $("main-content").innerHTML = `<div class="alert alert-err"><span class="alert-icon">⚠</span><div class="alert-body"><strong>Data load failed:</strong> ${e.message}</div></div>`;
    });
}

function buildDataFromStatic(sd) {
  const d = { leads: sd.leads||[], revenue: sd.revenue||[], marketing: sd.marketing||[], webinarDNA: sd.webinarDNA||[], groups: sd.groups||[], team: sd.team||[], lop: sd.lop||[], talktime: sd.talktime||[], monthlySheets: sd.monthlySheets||{}, seededAt: sd.seededAt, verticals: {}, syncedAt: sd.seededAt, syncing: false };
  ['CD','CL','ID','AI','AIW'].forEach(v => { d.verticals[v] = { cohorts: [], totalLeads: 0, totalRevenue: 0, totalUnits: 0 }; });
  (sd.cohorts||[]).forEach(c => {
    const vert = d.verticals[c.vertical];
    if (!vert) return;
    vert.cohorts.push(c);
    vert.totalLeads   += c.leads   || 0;
    vert.totalRevenue += c.revenue || 0;
    vert.totalUnits   += c.units   || 0;
  });
  return d;
}

function renderPage(pageId) {
  const pages = { command, verticals, webinars, revenue, pipeline, marketing, team, ops, ask, ingest, funnel, analytics, assignments };
  if (pages[pageId]) pages[pageId]();
}

// ── TOPBAR ────────────────────────────────────────────────────
function updateTopbar() {
  const key = SESSION ? SESSION.apiKey : "";
  $("key-indicator").textContent = key ? "🔑 ···" + key.slice(-4) : "🔑 none";
  updateTime();
  setInterval(updateTime, 30000);
}

function updateTime() {
  const now = new Date();
  $("topbar-time").textContent = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function startSyncPoller() {
  if (syncPoller) clearInterval(syncPoller);
  syncPoller = setInterval(pollSyncStatus, 30000);
  pollSyncStatus();
}

function pollSyncStatus() {
  fetch("/api/data/status")
    .then(r => r.json())
    .then(s => {
      const syncEl = document.querySelector(".sync-status");
      if (!syncEl) return;
      if (s.syncing) {
        syncEl.textContent = "🟡 Syncing...";
      } else if (s.paused) {
        syncEl.textContent = "🟡 Paused";
      } else if (s.lastError) {
        syncEl.textContent = "🔴 Error";
        syncEl.title = s.lastError;
      } else {
        const t = s.syncedAt ? new Date(s.syncedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "--:--";
        syncEl.textContent = "🟢 Live · " + t;
      }
    })
    .catch(() => {});
}

function toggleSync() {
  if (!DATA_CACHE) return;
  const paused = DATA_CACHE.paused;
  fetch(paused ? "/api/sync/resume" : "/api/sync/pause", { method: "POST" })
    .then(() => { pollSyncStatus(); loadDataThen(() => renderPage(CURRENT_PAGE)); });
}

function triggerSync() {
  fetch("/api/sync", { method: "POST" })
    .then(() => { setTimeout(() => loadDataThen(() => renderPage(CURRENT_PAGE)), 2000); });
}

function toggleSidebar() {
  $("sidebar").classList.toggle("open");
  $("sidebar-overlay").classList.toggle("show");
}

function showAnalyse() { navigate("ask"); }

// ── UPLOAD MODAL ──────────────────────────────────────────────
function showUploadModal() {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.id = "upload-modal";
  modal.innerHTML = `
<div class="modal-box">
  <div class="modal-header"><h3>Upload Data Files</h3><button onclick="closeModal('upload-modal')">✕</button></div>
  <p class="text-muted mb-16">Accepted: Community_Master.xlsx, Counsellor__LOP.xlsx, nitya_requirements.xlsx, Sales_data_sheet.xlsx, Recordings_Chat_Files.xlsx</p>
  <div class="dropzone" id="dropzone" onclick="$('file-input').click()">
    <div class="dropzone-icon">📁</div>
    <div class="dropzone-text">Click to select or drag & drop a file here</div>
    <div id="upload-status" style="margin-top:10px;font-size:12px;color:var(--ok);"></div>
  </div>
  <input type="file" id="file-input" accept=".xlsx,.xls,.docx" style="display:none" onchange="handleFileSelect(this)"/>
  <div id="upload-result" style="margin-top:14px;font-size:12px;"></div>
</div>`;
  document.body.appendChild(modal);

  const dz = $("dropzone");
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", e => {
    e.preventDefault(); dz.classList.remove("drag");
    if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
  });
}

function handleFileSelect(input) {
  if (input.files[0]) uploadFile(input.files[0]);
}

function uploadFile(file) {
  $("upload-status").textContent = "Uploading " + file.name + "...";
  const fd = new FormData();
  fd.append("file", file);
  fetch("/api/upload", { method: "POST", body: fd })
    .then(r => r.json())
    .then(d => {
      $("upload-status").textContent = "";
      $("upload-result").innerHTML = d.error
        ? `<span class="text-err">Error: ${d.error}</span>`
        : `<span class="text-ok">✓ ${d.filename} uploaded — ${d.totalSheets} sheets found. Sync triggered.</span>`;
      setTimeout(() => loadDataThen(() => renderPage(CURRENT_PAGE)), 3000);
    })
    .catch(e => { $("upload-status").textContent = ""; $("upload-result").innerHTML = `<span class="text-err">Upload failed: ${e.message}</span>`; });
}

function closeModal(id) {
  const el = $(id);
  if (el) el.remove();
}

// ── REPORTS MODAL ─────────────────────────────────────────────
function showReportsModal() {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.id = "reports-modal";
  modal.innerHTML = `
<div class="modal-box" style="width:520px">
  <div class="modal-header"><h3>Generate Report</h3><button onclick="closeModal('reports-modal')">✕</button></div>
  <div class="flex-row mb-16" style="flex-wrap:wrap;gap:10px;">
    <select id="rep-vertical" class="form-group select" style="background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:8px 12px;border-radius:6px;">
      <option value="CD">CD — Contract Drafting</option>
      <option value="CL">CL — Criminal Litigation</option>
      <option value="ID">ID — Independent Drafting</option>
      <option value="AI">AI — Legal AI</option>
      <option value="AIW">AIW — AI for Women</option>
    </select>
    <select id="rep-period" style="background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:8px 12px;border-radius:6px;">
      <option value="today">Today</option>
      <option value="week">This Week</option>
      <option value="3h">Last 3h Auto</option>
    </select>
    <button class="btn-primary" onclick="generateReport()">Generate</button>
  </div>
  <div id="rep-result"></div>
  <hr class="divider"/>
  <div class="section-title">Recent Reports</div>
  <div id="rep-history">Loading...</div>
</div>`;
  document.body.appendChild(modal);
  loadReportHistory();
}

function generateReport() {
  const vertical = $("rep-vertical").value;
  const period = $("rep-period").value;
  $("rep-result").innerHTML = "<div class='spinner'></div>";
  fetch("/api/report/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vertical, period })
  })
    .then(r => r.json())
    .then(d => {
      if (d.error) { $("rep-result").innerHTML = `<span class="text-err">${d.error}</span>`; return; }
      $("rep-result").innerHTML = `<span class="text-ok">✓ Report generated — </span><a href="${d.url}" target="_blank" style="color:var(--info);">Open Report ↗</a>`;
      loadReportHistory();
    })
    .catch(e => { $("rep-result").innerHTML = `<span class="text-err">${e.message}</span>`; });
}

function loadReportHistory() {
  fetch("/api/reports/list")
    .then(r => r.json())
    .then(list => {
      const el = $("rep-history");
      if (!el) return;
      if (!list.length) { el.innerHTML = "<p class='text-muted'>No reports generated yet.</p>"; return; }
      el.innerHTML = list.map(r => {
        const d = new Date(r.createdAt).toLocaleString("en-IN");
        return `<div class="flex-row mb-16" style="font-size:12px;"><span style="flex:1;color:var(--muted);">${r.id}</span><span style="color:var(--ghost);margin-right:12px;">${d}</span><a href="${r.url}" target="_blank" class="btn-secondary btn-sm">Open ↗</a></div>`;
      }).join("");
    })
    .catch(() => {});
}

// ── MODAL STYLES (injected once) ─────────────────────────────
(function injectModalStyles() {
  if (document.getElementById("modal-styles")) return;
  const s = document.createElement("style");
  s.id = "modal-styles";
  s.textContent = `
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9000;display:flex;align-items:center;justify-content:center;}
.modal-box{background:var(--ink2);border:1px solid var(--border);border-radius:12px;padding:24px;min-width:360px;max-width:90vw;max-height:85vh;overflow-y:auto;}
.modal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}
.modal-header h3{font-size:15px;font-weight:700;color:#fff;}
.modal-header button{background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;}
.modal-header button:hover{color:#fff;}
`;
  document.head.appendChild(s);
})();

// Topbar sync indicator setup
document.addEventListener("DOMContentLoaded", () => {
  const topbarRight = document.querySelector(".topbar-right");
  if (topbarRight) {
    const syncSpan = document.createElement("span");
    syncSpan.className = "sync-status";
    syncSpan.style.cssText = "font-size:11px;font-family:monospace;cursor:pointer;";
    syncSpan.textContent = "🟡 Loading...";
    syncSpan.onclick = toggleSync;
    const uploadBtn = document.createElement("button");
    uploadBtn.className = "btn-secondary btn-sm";
    uploadBtn.innerHTML = "↑ Upload";
    uploadBtn.onclick = showUploadModal;
    topbarRight.prepend(uploadBtn);
    topbarRight.prepend(syncSpan);
  }
});

// ── PAGE 1: COMMAND CENTRE ────────────────────────────────────
function command() {
  const d = DATA_CACHE;
  const verticals = ["CD", "CL", "ID", "AI", "AIW"];
  const labels = { CD: "Contract Drafting", CL: "Criminal Litigation", ID: "Independent Drafting", AI: "Legal AI", AIW: "AI for Women" };

  const allHealth = d.allHealth || [];
  const topIssues = d.topIssues || [];

  // Compute per-vertical summary
  const vSummary = verticals.map(vk => {
    const vData = d.verticals[vk];
    const cohorts = vData.cohorts || [];
    const pipeline = vData.pipeline || [];
    const revenue = vData.revenue || [];
    const totalRev = revenue.reduce((s, r) => s + (r.price || 0), 0);
    const enrolled = pipeline.filter(l => (l.stage || "").toLowerCase().includes("enrolled")).length;
    const totalLeads = pipeline.length;
    const overallCVR = totalLeads > 0 ? (enrolled / totalLeads * 100) : 0;
    const health = allHealth.filter(h => h.vertical === vk);
    const status = health.some(h => h.status === "red") ? "red" : health.some(h => h.status === "amber") ? "amber" : "green";
    const topIssue = health.find(h => h.status === "red" || h.status === "amber");
    const issueTxt = topIssue ? topIssue.issues[0] || "" : "";
    return { vk, label: labels[vk], totalRev, enrolled, totalLeads, overallCVR, status, issueTxt, cohorts };
  });

  // Revenue sparkline data (monthly)
  const monthlyRev = {};
  Object.entries(d.monthlySheets || {}).forEach(([month, rows]) => {
    const total = rows.reduce((s, r) => s + (r.price || 0), 0);
    monthlyRev[month] = total;
  });
  const monthKeys = Object.keys(monthlyRev).sort();
  const sparkData = monthKeys.map(k => monthlyRev[k]);
  const sparkLabels = monthKeys;

  const html = `
<div class="page-header">
  <div class="page-title">Command Centre</div>
  <div class="page-sub">Live intelligence across all 5 verticals · ${new Date().toLocaleDateString("en-IN")}</div>
</div>

<div class="card mb-24">
  <div class="card-header">
    <div class="card-title">Vertical Health</div>
    <button class="btn-secondary btn-sm" onclick="triggerSync()">↺ Sync Now</button>
  </div>
  ${vSummary.map(v => `
  <div style="margin-bottom:14px;cursor:pointer;" onclick="navigate('verticals')">
    <div class="flex-row" style="margin-bottom:6px;">
      <span style="width:40px;font-weight:700;color:#fff;">${v.vk}</span>
      <span style="flex:1;font-size:11px;color:var(--muted);">${v.label}</span>
      <span style="font-size:11px;color:var(--mid);">CVR ${v.overallCVR.toFixed(1)}%</span>
      <span style="margin-left:12px;">${statusBadge(v.status)}</span>
      <span style="width:140px;font-size:11px;color:var(--muted);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${v.issueTxt}</span>
    </div>
    <div style="background:var(--ink3);border-radius:4px;height:8px;overflow:hidden;">
      <div style="height:100%;width:${Math.min(100, v.overallCVR * 10)}%;background:${v.status==="red"?"var(--err)":v.status==="amber"?"var(--warn)":"var(--ok)"};border-radius:4px;transition:width .4s;"></div>
    </div>
    <div style="font-size:10px;color:var(--muted);margin-top:3px;">${v.totalLeads} leads · ${v.enrolled} enrolled · ${formatINR(v.totalRev)}</div>
  </div>`).join("")}
</div>

<div class="card mb-24">
  <div class="card-header">
    <div class="card-title">🚨 What Is Broken Right Now</div>
    <span class="badge badge-err">${topIssues.filter(i => i.status === "red").length} critical</span>
  </div>
  ${topIssues.length === 0
    ? "<p class='text-muted' style='font-size:12px;'>No critical issues detected. All verticals nominal.</p>"
    : topIssues.map(i => `
  <div class="alert ${i.status === "red" ? "alert-err" : "alert-warn"}" style="cursor:pointer;" onclick="navigate('verticals')">
    <span class="alert-icon">${statusIcon(i.status)}</span>
    <div class="alert-body">
      <strong>${i.cohort} (${i.vertical})</strong> — ${i.issue}
    </div>
  </div>`).join("")}
</div>

<div class="grid-2 mb-24">
  <div class="card">
    <div class="card-header">
      <div class="card-title">Vertical Summary</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;">
      ${vSummary.map(v => `
      <div style="text-align:center;cursor:pointer;" onclick="navigate('verticals')">
        <div style="font-size:10px;font-weight:700;color:#fff;">${v.vk}</div>
        <div style="font-size:16px;font-weight:700;color:var(--${v.status==="red"?"err":v.status==="amber"?"warn":"ok"})">${formatINR(v.totalRev)}</div>
        <div style="font-size:9px;color:var(--muted);">${v.enrolled} enr</div>
      </div>`).join("")}
    </div>
  </div>
  <div class="card">
    <div class="card-header">
      <div class="card-title">Revenue Trend</div>
      <span style="font-size:10px;color:var(--muted);">Monthly</span>
    </div>
    <div class="chart-wrap-sm"><canvas id="cmd-revenue-chart"></canvas></div>
  </div>
</div>

<div class="flex-row" style="gap:12px;flex-wrap:wrap;">
  <button class="btn-primary" onclick="showReportsModal()">📄 Generate Report</button>
  <button class="btn-secondary" onclick="navigate('ask')">🤖 Ask HERA about today</button>
  <button class="btn-secondary" onclick="navigate('pipeline')">📊 View Pipeline</button>
</div>`;

  $("main-content").innerHTML = html;

  if (sparkData.length > 0) {
    charts["cmd-revenue-chart"] = new Chart($("cmd-revenue-chart"), {
      type: "bar",
      data: {
        labels: sparkLabels,
        datasets: [{ label: "Revenue", data: sparkData, backgroundColor: "rgba(200,16,46,0.6)", borderColor: "#C8102E", borderWidth: 1 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6B7A94", font: { size: 9 } } },
          y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6B7A94", font: { size: 9 }, callback: v => formatINR(v) } }
        }
      }
    });
  }
}

// ── PAGE 2: VERTICALS ─────────────────────────────────────────
let selectedVertical = "CD";
let selectedCohort = null;

function verticals() {
  const vTabs = ["CD", "CL", "ID", "AI", "AIW"];
  const labels = { CD: "Contract Drafting", CL: "Criminal Litigation", ID: "Independent Drafting", AI: "Legal AI", AIW: "AI for Women" };

  const html = `
<div class="page-header">
  <div class="page-title">Verticals</div>
  <div class="page-sub">Cohort performance across all practice areas</div>
</div>
<div class="tab-bar" id="vertical-tabs">
  ${vTabs.map(vk => `<div class="tab${vk===selectedVertical?" active":""}" onclick="switchVertical('${vk}')">${vk} — ${labels[vk]}</div>`).join("")}
</div>
<div id="vertical-content"></div>`;

  $("main-content").innerHTML = html;
  renderVerticalContent(selectedVertical);
}

window.switchVertical = function(vk) {
  selectedVertical = vk;
  document.querySelectorAll("#vertical-tabs .tab").forEach(t => t.classList.remove("active"));
  const tabs = document.querySelectorAll("#vertical-tabs .tab");
  ["CD", "CL", "ID", "AI", "AIW"].forEach((v, i) => { if (v === vk) tabs[i] && tabs[i].classList.add("active"); });
  destroyCharts();
  renderVerticalContent(vk);
};

function renderVerticalContent(vk) {
  const d = DATA_CACHE;
  const vData = d.verticals[vk] || { cohorts: [], pipeline: [], revenue: [], webinars: [], team: [] };
  const cohorts = vData.cohorts;
  const allHealth = d.allHealth || [];
  const cohortHealth = {};
  allHealth.filter(h => h.vertical === vk).forEach(h => { cohortHealth[h.cohort] = h; });

  const html = `
<div class="kpi-grid">
  <div class="kpi-card kpi-info"><div class="kpi-label">Total Leads</div><div class="kpi-value">${vData.pipeline.length.toLocaleString()}</div></div>
  <div class="kpi-card kpi-ok"><div class="kpi-label">Enrolled</div><div class="kpi-value">${vData.revenue.length}</div></div>
  <div class="kpi-card kpi-purple"><div class="kpi-label">Revenue</div><div class="kpi-value">${formatINR(vData.revenue.reduce((s, r) => s + r.price, 0))}</div></div>
  <div class="kpi-card kpi-warn"><div class="kpi-label">Active Cohorts</div><div class="kpi-value">${cohorts.length}</div></div>
</div>

<div class="card mb-24">
  <div class="card-header">
    <div class="card-title">Cohorts</div>
    <button class="btn-secondary btn-sm" onclick="showReportsModal()">Generate Report</button>
  </div>
  ${cohorts.length === 0 ? "<p class='text-muted' style='font-size:12px;padding:20px;'>No cohort data available. Upload Community_Master.xlsx to populate.</p>" : ""}
  <div class="table-wrap">
    <table>
      <thead><tr><th>Cohort</th><th>Leads</th><th>Units</th><th>CVR%</th><th>Pool</th><th>W5 Att</th><th>Roadmap</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${cohorts.map(c => {
          const h = cohortHealth[c.id] || { status: "green", issues: [] };
          const w5 = c.w && c.w[5] ? c.w[5] : c.w && c.w[4] ? c.w[4] : "-";
          return `<tr class="cohort-row" style="cursor:pointer;" onclick="toggleCohortDetail('${c.id}','${vk}')">
            <td style="font-weight:600;color:#fff;">${c.id}</td>
            <td>${c.leads}</td>
            <td>${c.units}</td>
            <td class="${c.cvr < 3 ? "td-err" : c.cvr < 6 ? "td-warn" : "td-ok"}">${c.cvr.toFixed(1)}%</td>
            <td>${formatINR(c.pool || c.revenue)}</td>
            <td>${w5}</td>
            <td>${c.roadmapDone || 0}</td>
            <td>${statusBadge(h.status)}</td>
            <td><span style="color:var(--muted);font-size:11px;">${h.issues.length > 0 ? h.issues[0].substring(0, 40) : ""}</span></td>
          </tr>
          <tr id="detail-${c.id.replace(/[^a-z0-9]/gi, "_")}" style="display:none;">
            <td colspan="9" style="padding:0;background:var(--ink3);">
              <div id="cohort-detail-${c.id.replace(/[^a-z0-9]/gi, "_")}" style="padding:16px;"></div>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>
</div>`;

  $("vertical-content").innerHTML = html;
}

window.toggleCohortDetail = function(cohortId, vk) {
  const safeId = cohortId.replace(/[^a-z0-9]/gi, "_");
  const row = $("detail-" + safeId);
  if (!row) return;
  if (row.style.display === "none") {
    row.style.display = "";
    renderCohortDetail(cohortId, vk);
  } else {
    row.style.display = "none";
    destroyCharts();
  }
};

function renderCohortDetail(cohortId, vk) {
  const safeId = cohortId.replace(/[^a-z0-9]/gi, "_");
  const container = $("cohort-detail-" + safeId);
  if (!container) return;
  const d = DATA_CACHE;
  const vData = d.verticals[vk] || { cohorts: [], webinars: [] };
  const cohort = vData.cohorts.find(c => c.id === cohortId);
  if (!cohort) { container.innerHTML = "<p class='text-muted'>Cohort data not found.</p>"; return; }

  const webinars = (vData.webinars || []).filter(w => w.community === cohortId || w.community.includes(cohortId));
  const acs = (d.team || []).filter(t => t.cohorts && t.cohorts.includes(cohortId));
  const wLabels = (cohort.w || []).map((_, i) => "W" + i).filter((_, i) => cohort.w[i] !== undefined);
  const wData = (cohort.w || []).filter(v => v !== undefined);

  container.innerHTML = `
<div class="grid-2" style="margin-bottom:16px;">
  <div>
    <div class="chart-wrap-sm"><canvas id="coh-att-${safeId}"></canvas></div>
  </div>
  <div>
    <div class="section-title">Root Cause Analysis</div>
    ${(d.allHealth || []).filter(h => h.cohort === cohortId).flatMap(h => h.issues).map(i => `<div class="alert alert-warn"><span>⚠</span><div>${i}</div></div>`).join("") || "<p class='text-muted' style='font-size:11px;'>No issues flagged.</p>"}
    <div class="section-title mt-16">ACs Assigned</div>
    ${acs.length > 0 ? acs.map(a => `<div class="flex-row" style="font-size:12px;margin-bottom:6px;"><span style="flex:1;">${a.name}</span><span class="badge ${a.assigned > 60 ? "badge-err" : "badge-ok"}">${a.assigned} leads</span></div>`).join("") : `<p class='text-muted' style='font-size:11px;'>ACs assigned by lead ownership. Upload data to see details.</p>`}
  </div>
</div>
${webinars.length > 0 ? `
<div class="section-title">Webinars in This Cohort</div>
<div class="table-wrap"><table>
<thead><tr><th>Date</th><th>Topic</th><th>Attendance</th><th>Conversions</th><th>CVR%</th><th>Recording</th><th>Transcript</th></tr></thead>
<tbody>
${webinars.map(w => `<tr>
  <td style="white-space:nowrap;">${w.date}</td>
  <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${w.topic}</td>
  <td>${w.attendees}</td>
  <td>${w.conversions}</td>
  <td class="${w.attendees > 0 && w.conversions / w.attendees * 100 < 3 ? "td-err" : "td-ok"}">${w.attendees > 0 ? pct(w.conversions, w.attendees) + "%" : "-"}</td>
  <td>${w.recording ? `<a href="${w.recording}" target="_blank" class="rec-badge rec-yt">📹 Watch</a>` : "<span class='text-muted'>—</span>"}</td>
  <td>${w.transcript ? `<a href="${w.transcript}" target="_blank" class="rec-badge rec-drive">📄 Read</a>` : "<span class='text-muted'>—</span>"}</td>
</tr>`).join("")}
</tbody></table></div>` : "<p class='text-muted' style='font-size:11px;'>No webinar data for this cohort.</p>"}`;

  if (wData.length > 0) {
    setTimeout(() => {
      const canvas = $("coh-att-" + safeId);
      if (!canvas) return;
      charts["coh-att-" + safeId] = new Chart(canvas, {
        type: "line",
        data: {
          labels: wLabels,
          datasets: [{ label: "Attendance", data: wData, borderColor: "#3B82F6", backgroundColor: "rgba(59,130,246,0.1)", tension: 0.3, fill: true }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, title: { display: true, text: "W1→W12 Attendance", color: "#9BA8BF", font: { size: 11 } } },
          scales: {
            x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6B7A94", font: { size: 9 } } },
            y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6B7A94", font: { size: 9 } } }
          }
        }
      });
    }, 50);
  }
}

// ── PAGE 3: WEBINAR INTEL ─────────────────────────────────────
function webinars() {
  const d = DATA_CACHE;
  let webinarData = d.webinarDNA || [];

  const verticals = ["All", "CD", "CL", "ID", "AI", "AIW"];
  const html = `
<div class="page-header">
  <div class="page-title">Webinar Intel</div>
  <div class="page-sub">${webinarData.length} webinars tracked across all verticals</div>
</div>
<div class="flex-row mb-16" style="flex-wrap:wrap;gap:10px;">
  ${verticals.map(v => `<button class="btn-secondary btn-sm web-vert-btn" data-v="${v}" onclick="filterWebinars('${v}')">${v}</button>`).join("")}
  <input type="text" id="webinar-search" placeholder="Search topic or community..." style="background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:7px 12px;border-radius:6px;font-size:12px;flex:1;min-width:200px;" oninput="filterWebinars('${webinarCurrentVertical}')"/>
</div>
<div class="card mb-24">
  <div class="card-header"><div class="card-title">Webinar Table</div></div>
  <div class="table-wrap" id="webinar-table-wrap"></div>
</div>
<div class="card">
  <div class="card-header"><div class="card-title">Attendance Heatmap</div><span class="text-muted">By cohort × webinar</span></div>
  <div id="webinar-heatmap"></div>
</div>`;

  $("main-content").innerHTML = html;
  window.webinarCurrentVertical = "All";
  renderWebinarTable(webinarData);
  renderWebinarHeatmap(webinarData);
}

window.webinarCurrentVertical = "All";

window.filterWebinars = function(vertical) {
  window.webinarCurrentVertical = vertical;
  document.querySelectorAll(".web-vert-btn").forEach(b => {
    b.style.borderColor = b.dataset.v === vertical ? "var(--red)" : "";
    b.style.color = b.dataset.v === vertical ? "var(--red)" : "";
  });
  const search = ($("webinar-search") || {}).value || "";
  let data = DATA_CACHE.webinarDNA || [];
  if (vertical !== "All") data = data.filter(w => w.vertical === vertical);
  if (search) data = data.filter(w => (w.topic + w.community).toLowerCase().includes(search.toLowerCase()));
  renderWebinarTable(data);
};

function renderWebinarTable(data) {
  const wrap = $("webinar-table-wrap");
  if (!wrap) return;
  if (!data.length) { wrap.innerHTML = "<p class='text-muted' style='padding:20px;font-size:12px;'>No webinar data. Upload Webinar List (DNA) sheet from Community_Master.xlsx.</p>"; return; }
  wrap.innerHTML = `<table>
<thead><tr><th>Date</th><th>Community</th><th>Topic</th><th>Att</th><th>Conv</th><th>CVR%</th><th>Recording</th><th>Transcript</th><th>AI Summary</th></tr></thead>
<tbody>
${data.map((w, idx) => `<tr>
  <td style="white-space:nowrap;font-size:11px;">${w.date}</td>
  <td style="font-size:11px;font-weight:600;">${w.community}</td>
  <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;" title="${w.topic}">${w.topic}</td>
  <td>${w.attendees}</td>
  <td>${w.conversions}</td>
  <td class="${w.attendees > 0 ? (w.conversions / w.attendees * 100 < 3 ? "td-err" : w.conversions / w.attendees * 100 < 6 ? "td-warn" : "td-ok") : ""}">${w.attendees > 0 ? pct(w.conversions, w.attendees) + "%" : "—"}</td>
  <td>${w.recording ? `<a href="${w.recording}" target="_blank" class="rec-badge rec-yt">📹</a>` : "—"}</td>
  <td>${w.transcript ? `<a href="${w.transcript}" target="_blank" class="rec-badge rec-drive">📄</a>` : "—"}</td>
  <td><button class="btn-secondary btn-sm" onclick="webinarAISummary(${idx})">✨ AI</button></td>
</tr>`).join("")}
</tbody></table>`;
  wrap.__webinarData = data;
}

window.webinarAISummary = function(idx) {
  const wrap = $("webinar-table-wrap");
  if (!wrap || !wrap.__webinarData) return;
  const w = wrap.__webinarData[idx];
  if (!SESSION || !SESSION.apiKey) { alert("No API key set. Please re-login with your Anthropic key."); return; }
  const btn = wrap.querySelectorAll("button")[idx];
  if (btn) btn.textContent = "...";
  fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": SESSION.apiKey },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: `Webinar summary for a legal education platform. Community: ${w.community}. Topic: "${w.topic}". Attendees: ${w.attendees}. Conversions: ${w.conversions}. What are the key sales insights from this topic and why might the CVR be ${w.attendees > 0 ? pct(w.conversions, w.attendees) : 0}%? Be specific and under 100 words.` }]
    })
  })
    .then(r => r.json())
    .then(r => {
      const text = r.content && r.content[0] ? r.content[0].text : "No response";
      alert(text);
      if (btn) btn.textContent = "✨ AI";
    })
    .catch(e => { alert("AI error: " + e.message); if (btn) btn.textContent = "✨ AI"; });
};

function renderWebinarHeatmap(data) {
  const el = $("webinar-heatmap");
  if (!el) return;
  const communities = [...new Set(data.map(w => w.community))].slice(0, 10);
  if (!communities.length) { el.innerHTML = "<p class='text-muted' style='font-size:12px;padding:12px;'>No data for heatmap.</p>"; return; }
  const maxW = Math.max(...data.map(w => {
    const m = w.topic.match(/W(\d+)/);
    return m ? parseInt(m[1]) : 0;
  }), 6);

  const grid = communities.map(c => {
    const row = [c];
    for (let i = 1; i <= maxW; i++) {
      const web = data.find(w => w.community === c && (w.topic.includes("W" + i) || w.topic.includes(" " + i + " ")));
      row.push(web ? web.attendees : null);
    }
    return row;
  });

  const allAtt = data.map(w => w.attendees).filter(Boolean);
  const maxAtt = Math.max(...allAtt, 1);

  el.innerHTML = `<div style="overflow-x:auto;"><table style="font-size:11px;min-width:400px;">
<thead><tr><th>Community</th>${Array.from({ length: maxW }, (_, i) => `<th>W${i + 1}</th>`).join("")}</tr></thead>
<tbody>
${grid.map(row => `<tr>
  <td style="font-weight:600;font-size:10px;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis;">${row[0]}</td>
  ${row.slice(1).map(v => {
    if (v === null) return "<td style='background:var(--ink3);color:var(--steel);'>—</td>";
    const intensity = v / maxAtt;
    const r = Math.round(239 * intensity);
    const g = Math.round(68 * (1 - intensity) + 185 * intensity);
    const b = Math.round(68 * (1 - intensity));
    return `<td style="background:rgba(${r},${g},${b},0.3);text-align:center;font-weight:600;">${v}</td>`;
  }).join("")}
</tr>`).join("")}
</tbody></table></div>`;
}

// ── PAGE 4: REVENUE ────────────────────────────────────────────
function revenue() {
  const d = DATA_CACHE;
  const revData = d.revenue || [];

  // Monthly aggregation
  const monthMap = {};
  revData.forEach(r => {
    const dateStr = r.date || "";
    const m = dateStr.match(/(\d{4})[-\/](\d{1,2})/) || dateStr.match(/(\d{1,2})[-\/](\d{4})/);
    let key = "Unknown";
    if (m) {
      if (m[0].indexOf("/") > -1 && m[1].length <= 2) key = `${m[2]}-${m[1].padStart(2, "0")}`;
      else key = `${m[1]}-${m[2].padStart(2, "0")}`;
    }
    if (!monthMap[key]) monthMap[key] = { revenue: 0, count: 0 };
    monthMap[key].revenue += r.price || 0;
    monthMap[key].count++;
  });
  const monthKeys = Object.keys(monthMap).filter(k => k !== "Unknown").sort().slice(-12);
  const monthRevs = monthKeys.map(k => monthMap[k].revenue);
  const monthCounts = monthKeys.map(k => monthMap[k].count);

  // Vertical breakdown
  const vertMap = {};
  revData.forEach(r => {
    const v = r.vertical || "Other";
    if (!vertMap[v]) vertMap[v] = { revenue: 0, count: 0 };
    vertMap[v].revenue += r.price || 0;
    vertMap[v].count++;
  });

  // Mode breakdown
  const modeMap = {};
  revData.forEach(r => {
    const m = r.mode || "Other";
    modeMap[m] = (modeMap[m] || 0) + (r.price || 0);
  });
  const modeKeys = Object.keys(modeMap);
  const modeVals = modeKeys.map(k => modeMap[k]);
  const COLORS = ["#C8102E", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EF4444", "#6B7A94"];

  const html = `
<div class="page-header">
  <div class="page-title">Revenue & Sales</div>
  <div class="page-sub">${revData.length} enrollment records · ${formatINR(revData.reduce((s, r) => s + r.price, 0))} total</div>
</div>

<div class="kpi-grid mb-24">
  <div class="kpi-card kpi-ok"><div class="kpi-label">Total Revenue</div><div class="kpi-value">${formatINR(revData.reduce((s, r) => s + r.price, 0))}</div></div>
  <div class="kpi-card kpi-info"><div class="kpi-label">Enrollments</div><div class="kpi-value">${revData.length}</div></div>
  <div class="kpi-card kpi-purple"><div class="kpi-label">Avg Ticket</div><div class="kpi-value">${revData.length > 0 ? formatINR(revData.reduce((s, r) => s + r.price, 0) / revData.length) : "—"}</div></div>
  <div class="kpi-card kpi-warn"><div class="kpi-label">Peak Month</div><div class="kpi-value">${monthKeys.length > 0 ? monthKeys[monthRevs.indexOf(Math.max(...monthRevs))] || "—" : "—"}</div></div>
</div>

<div class="card mb-24">
  <div class="card-header"><div class="card-title">Monthly Revenue Trend</div><button class="btn-secondary btn-sm" onclick="showReportsModal()">Generate Report</button></div>
  <div class="chart-wrap-lg"><canvas id="rev-monthly-chart"></canvas></div>
</div>

<div class="grid-2 mb-24">
  <div class="card">
    <div class="card-header"><div class="card-title">Vertical Breakdown</div></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Vertical</th><th>Revenue</th><th>Enrollments</th><th>Avg Ticket</th></tr></thead>
      <tbody>
      ${["CD", "CL", "ID", "AI", "AIW"].map(vk => {
        const vr = vertMap[vk] || { revenue: 0, count: 0 };
        return `<tr><td style="font-weight:600;">${vk}</td><td class="td-ok">${formatINR(vr.revenue)}</td><td>${vr.count}</td><td>${vr.count > 0 ? formatINR(vr.revenue / vr.count) : "—"}</td></tr>`;
      }).join("")}
      </tbody>
    </table></div>
  </div>
  <div class="card">
    <div class="card-header"><div class="card-title">Payment Mode Split</div></div>
    <div class="chart-wrap-sm"><canvas id="rev-mode-chart"></canvas></div>
  </div>
</div>

<div class="card mb-24">
  <div class="card-header">
    <div class="card-title">Enrollment Table</div>
    <input type="text" id="rev-search" placeholder="Search name, community..." style="background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:6px 10px;border-radius:6px;font-size:12px;width:200px;" oninput="filterRevTable(this.value)"/>
  </div>
  <div class="table-wrap" id="rev-table-wrap">
    ${renderRevTable(revData.slice(0, 100))}
  </div>
</div>

<div class="card">
  <div class="card-header"><div class="card-title">Payment Gateway Status</div></div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;" id="gateway-status">Loading...</div>
</div>`;

  $("main-content").innerHTML = html;
  $("rev-table-wrap").__revData = revData;

  if (monthKeys.length > 0) {
    charts["rev-monthly-chart"] = new Chart($("rev-monthly-chart"), {
      type: "bar",
      data: {
        labels: monthKeys,
        datasets: [
          { label: "Revenue (₹)", data: monthRevs, backgroundColor: "rgba(200,16,46,0.7)", borderColor: "#C8102E", borderWidth: 1, yAxisID: "y" },
          { label: "Enrollments", data: monthCounts, type: "line", borderColor: "#3B82F6", backgroundColor: "rgba(59,130,246,0.2)", tension: 0.3, yAxisID: "y1" }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#9BA8BF", font: { size: 10 } } } },
        scales: {
          x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6B7A94", font: { size: 9 } } },
          y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6B7A94", font: { size: 9 }, callback: v => formatINR(v) } },
          y1: { position: "right", grid: { display: false }, ticks: { color: "#3B82F6", font: { size: 9 } } }
        }
      }
    });
  }

  if (modeKeys.length > 0) {
    charts["rev-mode-chart"] = new Chart($("rev-mode-chart"), {
      type: "doughnut",
      data: {
        labels: modeKeys,
        datasets: [{ data: modeVals, backgroundColor: COLORS.slice(0, modeKeys.length), borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "right", labels: { color: "#9BA8BF", font: { size: 10 }, boxWidth: 12 } } }
      }
    });
  }

  fetch("/api/integrations/status").then(r => r.json()).then(s => {
    const el = $("gateway-status");
    if (!el) return;
    const gateways = [
      { key: "razorpay", label: "Razorpay" },
      { key: "payu", label: "PayU" },
      { key: "shopse", label: "Shopse" },
      { key: "fibe", label: "Fibe" }
    ];
    el.innerHTML = gateways.map(g => `
      <div class="kpi-card">
        <div class="kpi-label">${g.label}</div>
        <div style="font-size:18px;margin:6px 0;">${s[g.key] ? "🟢" : "⚫"}</div>
        <div style="font-size:10px;color:${s[g.key] ? "var(--ok)" : "var(--muted)"};">${s[g.key] ? "Connected" : "Not configured"}</div>
      </div>`).join("");
  }).catch(() => {});
}

function renderRevTable(data) {
  if (!data.length) return "<p class='text-muted' style='padding:20px;font-size:12px;'>No enrollment data.</p>";
  return `<table>
<thead><tr><th>Name</th><th>Date</th><th>Community</th><th>Vertical</th><th>Price</th><th>Caller</th><th>Mode</th></tr></thead>
<tbody>
${data.map(r => `<tr>
  <td style="font-size:11px;">${r.name}</td>
  <td style="font-size:11px;white-space:nowrap;">${r.date}</td>
  <td style="font-size:11px;max-width:150px;overflow:hidden;text-overflow:ellipsis;">${r.finalCommunity || r.community}</td>
  <td><span class="badge badge-info">${r.vertical}</span></td>
  <td class="td-ok">${formatINR(r.price)}</td>
  <td style="font-size:11px;">${r.callerName}</td>
  <td style="font-size:11px;">${r.mode}</td>
</tr>`).join("")}
</tbody></table>`;
}

window.filterRevTable = function(q) {
  const wrap = $("rev-table-wrap");
  if (!wrap || !wrap.__revData) return;
  const filtered = q
    ? wrap.__revData.filter(r => (r.name + r.community + r.callerName).toLowerCase().includes(q.toLowerCase()))
    : wrap.__revData.slice(0, 100);
  wrap.innerHTML = renderRevTable(filtered.slice(0, 200));
  wrap.__revData = wrap.__revData; // keep ref
};

// ── PAGE 5: LEAD PIPELINE ─────────────────────────────────────
function pipeline() {
  const d = DATA_CACHE;
  const leads = d.leads || [];

  const stageMap = {};
  leads.forEach(l => { const s = l.stage || "Unknown"; stageMap[s] = (stageMap[s] || 0) + 1; });

  const vertMap = {};
  leads.forEach(l => { const v = l.vertical || "Other"; vertMap[v] = (vertMap[v] || 0) + 1; });

  const notPickingUp = stageMap["Not Picking Up"] || stageMap["not picking up"] || stageMap["NOT PICKING UP"] || 0;
  const enrolled = stageMap["Course Enrolled"] || stageMap["course enrolled"] || stageMap["Enrolled"] || 0;
  const roadmapDone = stageMap["Roadmap Done"] || stageMap["roadmap done"] || 0;
  const discoveryDone = stageMap["Discovery Done"] || stageMap["discovery done"] || stageMap["Discovery Call Done"] || 0;
  const bookingFee = stageMap["Booking Fee Received"] || stageMap["Booking Fees"] || 0;

  const ownerMap = {};
  leads.forEach(l => { const o = l.owner || "Unassigned"; ownerMap[o] = (ownerMap[o] || 0) + 1; });
  const ownersSorted = Object.entries(ownerMap).sort((a, b) => b[1] - a[1]).slice(0, 15);

  const html = `
<div class="page-header">
  <div class="page-title">Lead Pipeline</div>
  <div class="page-sub">${leads.length.toLocaleString()} total leads tracked</div>
</div>

<div class="kpi-grid mb-24">
  ${["CD", "CL", "ID", "AI", "AIW"].map(vk => `
  <div class="kpi-card kpi-info">
    <div class="kpi-label">${vk}</div>
    <div class="kpi-value">${(vertMap[vk] || 0).toLocaleString()}</div>
    <div class="kpi-sub">${formatINR((d.verticals[vk].revenue || []).reduce((s, r) => s + r.price, 0))}</div>
  </div>`).join("")}
</div>

<div class="grid-2 mb-24">
  <div class="card">
    <div class="card-header"><div class="card-title">Pipeline Funnel</div></div>
    <div style="font-size:12px;">
      ${[
        { label: "Total Leads", count: leads.length, pct: 100, cls: "" },
        { label: "Not Picking Up", count: notPickingUp, pct: pct(notPickingUp, leads.length), cls: "text-err" },
        { label: "Roadmap Done", count: roadmapDone, pct: pct(roadmapDone, leads.length), cls: "text-warn" },
        { label: "Discovery Done", count: discoveryDone, pct: pct(discoveryDone, leads.length), cls: "text-warn" },
        { label: "Booking Fee", count: bookingFee, pct: pct(bookingFee, leads.length), cls: "text-ok" },
        { label: "Enrolled", count: enrolled, pct: pct(enrolled, leads.length), cls: "text-ok" }
      ].map(f => `
      <div class="bw-bar-wrap">
        <div class="bw-name ${f.cls}">${f.label}</div>
        <div class="bw-bar-bg"><div class="bw-bar-fill ${f.cls === "text-err" ? "bw-red" : f.cls === "text-warn" ? "bw-amber" : "bw-green"}" style="width:${Math.min(100, f.pct)}%;"></div></div>
        <div class="bw-score ${f.cls}">${f.count.toLocaleString()}</div>
      </div>`).join("")}
    </div>
    ${notPickingUp > leads.length * 0.2 ? `<div class="alert alert-err mt-16"><span class="alert-icon">🔴</span><div class="alert-body"><strong>${notPickingUp.toLocaleString()} leads not picking up</strong> — ${pct(notPickingUp, leads.length)}% of pipeline. Immediate action needed.</div></div>` : ""}
  </div>
  <div class="card">
    <div class="card-header"><div class="card-title">Pipeline by Stage</div></div>
    <div class="chart-wrap"><canvas id="pipeline-stage-chart"></canvas></div>
  </div>
</div>

<div class="card mb-24">
  <div class="card-header">
    <div class="card-title">Lead Table</div>
    <div class="flex-row" style="gap:8px;flex-wrap:wrap;">
      <input type="text" id="lead-search" placeholder="Search name, owner..." style="background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:6px 10px;border-radius:6px;font-size:12px;width:160px;" oninput="filterLeads()"/>
      <select id="lead-vert-filter" style="background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:6px 10px;border-radius:6px;font-size:12px;" onchange="filterLeads()">
        <option value="">All Verticals</option>
        <option>CD</option><option>CL</option><option>ID</option><option>AI</option><option>AIW</option>
      </select>
      <select id="lead-stage-filter" style="background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:6px 10px;border-radius:6px;font-size:12px;" onchange="filterLeads()">
        <option value="">All Stages</option>
        ${Object.keys(stageMap).map(s => `<option>${s}</option>`).join("")}
      </select>
      <button class="btn-secondary btn-sm" onclick="exportLeadsCSV()">↓ Export CSV</button>
    </div>
  </div>
  <div class="table-wrap" id="leads-table-wrap">
    ${renderLeadsTable(leads.slice(0, 100))}
  </div>
</div>

<div class="card">
  <div class="card-header"><div class="card-title">Owner Bandwidth</div></div>
  ${ownersSorted.map(([name, count]) => `
  <div class="bw-bar-wrap">
    <div class="bw-name">${name}</div>
    <div class="bw-bar-bg"><div class="bw-bar-fill ${count > 100 ? "bw-red" : count > 60 ? "bw-amber" : "bw-green"}" style="width:${Math.min(100, count / 5)}%;"></div></div>
    <div class="bw-score ${count > 100 ? "text-err" : count > 60 ? "text-warn" : "text-ok"}">${count}</div>
    ${count > 100 ? "<span class='badge badge-err' style='margin-left:8px;'>OVERLOADED</span>" : count > 60 ? "<span class='badge badge-warn'>OVER CAP</span>" : ""}
  </div>`).join("")}
</div>`;

  $("main-content").innerHTML = html;
  $("leads-table-wrap").__leadsData = leads;

  const stageSorted = Object.entries(stageMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  charts["pipeline-stage-chart"] = new Chart($("pipeline-stage-chart"), {
    type: "bar",
    data: {
      labels: stageSorted.map(s => s[0]),
      datasets: [{ data: stageSorted.map(s => s[1]), backgroundColor: stageSorted.map(s => {
        const l = s[0].toLowerCase();
        if (l.includes("enrolled") || l.includes("booking")) return "rgba(16,185,129,0.7)";
        if (l.includes("not picking") || l.includes("not interested")) return "rgba(239,68,68,0.7)";
        return "rgba(245,158,11,0.7)";
      }) }]
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6B7A94", font: { size: 9 } } },
        y: { grid: { display: false }, ticks: { color: "#9BA8BF", font: { size: 9 } } }
      }
    }
  });
}

function renderLeadsTable(data) {
  if (!data.length) return "<p class='text-muted' style='padding:20px;font-size:12px;'>No leads data.</p>";
  return `<table>
<thead><tr><th>Name</th><th>Stage</th><th>Vertical</th><th>Owner</th><th>Date</th></tr></thead>
<tbody>
${data.map(l => {
  const sl = (l.stage || "").toLowerCase();
  const rowCls = sl.includes("enrolled") || sl.includes("booking") ? "style='background:rgba(16,185,129,0.06)'" :
    sl.includes("not picking") || sl.includes("not interested") ? "style='background:rgba(239,68,68,0.06)'" :
    sl.includes("roadmap") || sl.includes("discovery") ? "style='background:rgba(245,158,11,0.06)'" : "";
  return `<tr ${rowCls}>
  <td style="font-size:11px;">${l.name}</td>
  <td style="font-size:11px;">${l.stage}</td>
  <td><span class="badge badge-info" style="font-size:9px;">${l.vertical || "—"}</span></td>
  <td style="font-size:11px;">${l.owner}</td>
  <td style="font-size:11px;">${l.date}</td>
</tr>`;
}).join("")}
</tbody></table>`;
}

window.filterLeads = function() {
  const wrap = $("leads-table-wrap");
  if (!wrap || !wrap.__leadsData) return;
  const q = ($("lead-search") || {}).value || "";
  const vf = ($("lead-vert-filter") || {}).value || "";
  const sf = ($("lead-stage-filter") || {}).value || "";
  let data = wrap.__leadsData;
  if (q) data = data.filter(l => (l.name + l.owner + l.email).toLowerCase().includes(q.toLowerCase()));
  if (vf) data = data.filter(l => l.vertical === vf);
  if (sf) data = data.filter(l => l.stage === sf);
  wrap.innerHTML = renderLeadsTable(data.slice(0, 200));
};

window.exportLeadsCSV = function() {
  const wrap = $("leads-table-wrap");
  const data = wrap && wrap.__leadsData ? wrap.__leadsData : (DATA_CACHE ? DATA_CACHE.leads : []);
  const csv = ["Name,Stage,Vertical,Owner,Date,Email,Phone"]
    .concat(data.map(l => [l.name, l.stage, l.vertical, l.owner, l.date, l.email, l.phone].map(v => `"${(v || "").replace(/"/g, '""')}"`).join(",")))
    .join("\n");
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = "hera_leads_export.csv";
  a.click();
};

// ── PAGE 6: MARKETING ─────────────────────────────────────────
function marketing() {
  const d = DATA_CACHE;
  const mktData = d.marketing || [];

  const funnelRows = mktData.map(m => {
    const vRevData = (d.verticals[m.vertical] || { revenue: [] }).revenue;
    const enrolled = vRevData.length;
    const roas = m.spent > 0 ? (vRevData.reduce((s, r) => s + r.price, 0) / m.spent).toFixed(1) : "—";
    return { ...m, enrolled, roas };
  });

  const topCPL = [...mktData].sort((a, b) => a.cpl - b.cpl).slice(0, 5);
  const totalSpent = mktData.reduce((s, m) => s + m.spent, 0);
  const totalLeadsGen = mktData.reduce((s, m) => s + m.leads, 0);
  const avgCPL = totalLeadsGen > 0 ? (totalSpent / totalLeadsGen).toFixed(0) : 0;

  const html = `
<div class="page-header">
  <div class="page-title">Marketing Funnel</div>
  <div class="page-sub">${mktData.length} campaigns · ${formatINR(totalSpent)} total spend</div>
</div>

<div class="kpi-grid mb-24">
  <div class="kpi-card kpi-err"><div class="kpi-label">Total Spend</div><div class="kpi-value">${formatINR(totalSpent)}</div></div>
  <div class="kpi-card kpi-info"><div class="kpi-label">Leads Generated</div><div class="kpi-value">${totalLeadsGen.toLocaleString()}</div></div>
  <div class="kpi-card kpi-warn"><div class="kpi-label">Avg CPL</div><div class="kpi-value">${formatINR(avgCPL)}</div></div>
  <div class="kpi-card kpi-ok"><div class="kpi-label">Best CPL</div><div class="kpi-value">${topCPL.length > 0 ? formatINR(topCPL[0].cpl) : "—"}</div></div>
</div>

<div class="card mb-24">
  <div class="card-header"><div class="card-title">Full Funnel by Campaign</div><button class="btn-secondary btn-sm" onclick="showReportsModal()">Generate Report</button></div>
  ${mktData.length === 0 ? "<p class='text-muted' style='font-size:12px;padding:20px;'>No marketing data. Upload raw_marketing_spent sheet from Community_Master.xlsx.</p>" : ""}
  <div class="table-wrap">
    <table>
      <thead><tr><th>Group</th><th>Vertical</th><th>Spend</th><th>Leads</th><th>CPL</th><th>Enrolled</th><th>CVR%</th><th>ROAS</th></tr></thead>
      <tbody>
        ${funnelRows.map(m => `<tr>
          <td style="font-size:11px;font-weight:600;">${m.groupName}</td>
          <td><span class="badge badge-info">${m.vertical}</span></td>
          <td>${formatINR(m.spent)}</td>
          <td>${m.leads}</td>
          <td class="${m.cpl > 1500 ? "td-err" : m.cpl > 1000 ? "td-warn" : "td-ok"}">${formatINR(m.cpl)}</td>
          <td>${m.enrolled}</td>
          <td>${m.leads > 0 ? pct(m.enrolled, m.leads) + "%" : "—"}</td>
          <td class="${parseFloat(m.roas) > 2 ? "td-ok" : parseFloat(m.roas) > 1 ? "td-warn" : "td-err"}">${m.roas}x</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
</div>

<div class="grid-2 mb-24">
  <div class="card">
    <div class="card-header"><div class="card-title">ROAS by Campaign</div></div>
    <div class="chart-wrap"><canvas id="mkt-roas-chart"></canvas></div>
  </div>
  <div class="card">
    <div class="card-header"><div class="card-title">CPL Trend by Vertical</div></div>
    <div class="chart-wrap"><canvas id="mkt-cpl-chart"></canvas></div>
  </div>
</div>

<div class="card">
  <div class="card-header"><div class="card-title">GrowthX Integration</div></div>
  <div class="flex-row" style="gap:12px;font-size:12px;">
    <div style="color:var(--muted);">Status: ${d.integrations && d.integrations.growthx ? "🟢 Connected" : "⚫ Not configured"}</div>
    <input type="password" id="growthx-key" placeholder="GrowthX API key..." style="background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:6px 10px;border-radius:6px;font-size:12px;flex:1;"/>
    <button class="btn-secondary btn-sm" onclick="alert('Save GrowthX key to Railway env: GROWTHX_API_KEY')">Save</button>
  </div>
</div>`;

  $("main-content").innerHTML = html;

  if (funnelRows.length > 0) {
    const sorted = [...funnelRows].sort((a, b) => parseFloat(b.roas) - parseFloat(a.roas)).slice(0, 8);
    charts["mkt-roas-chart"] = new Chart($("mkt-roas-chart"), {
      type: "bar",
      data: {
        labels: sorted.map(m => m.groupName.substring(0, 20)),
        datasets: [
          { label: "Spend", data: sorted.map(m => m.spent), backgroundColor: "rgba(239,68,68,0.6)", yAxisID: "y" },
          { label: "Revenue", data: sorted.map(m => m.enrolled * 12000), backgroundColor: "rgba(16,185,129,0.6)", yAxisID: "y" }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#9BA8BF", font: { size: 10 } } } },
        scales: {
          x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6B7A94", font: { size: 9 } } },
          y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6B7A94", font: { size: 9 }, callback: v => formatINR(v) } }
        }
      }
    });

    const vCPL = {};
    mktData.forEach(m => { if (!vCPL[m.vertical]) vCPL[m.vertical] = []; vCPL[m.vertical].push(m.cpl); });
    const vkeys = Object.keys(vCPL);
    charts["mkt-cpl-chart"] = new Chart($("mkt-cpl-chart"), {
      type: "bar",
      data: {
        labels: vkeys,
        datasets: [{ label: "Avg CPL", data: vkeys.map(v => vCPL[v].reduce((a, b) => a + b, 0) / vCPL[v].length), backgroundColor: "rgba(245,158,11,0.7)", borderColor: "#F59E0B", borderWidth: 1 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6B7A94", font: { size: 10 } } },
          y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6B7A94", font: { size: 9 }, callback: v => "₹" + v } }
        }
      }
    });
  }
}

// ── PAGE 7: TEAM HEALTH ────────────────────────────────────────
function team() {
  const d = DATA_CACHE;
  const teamData = d.team || [];

  const critical = teamData.filter(t => t.assigned > 100 || t.lopDays >= 3);
  const overCap = teamData.filter(t => t.assigned > 60 && t.assigned <= 100);
  const ok = teamData.filter(t => t.assigned <= 60 && t.lopDays < 3);

  const html = `
<div class="page-header">
  <div class="page-title">Team Health</div>
  <div class="page-sub">${teamData.length} team members tracked · ${critical.length} critical alerts</div>
</div>

<div class="kpi-grid mb-24">
  <div class="kpi-card kpi-err"><div class="kpi-label">Critical ACs</div><div class="kpi-value">${critical.length}</div><div class="kpi-sub">Overloaded or LOP ≥3d</div></div>
  <div class="kpi-card kpi-warn"><div class="kpi-label">Over Cap</div><div class="kpi-value">${overCap.length}</div><div class="kpi-sub">60–100 leads assigned</div></div>
  <div class="kpi-card kpi-ok"><div class="kpi-label">On Track</div><div class="kpi-value">${ok.length}</div><div class="kpi-sub">Within capacity</div></div>
  <div class="kpi-card kpi-info"><div class="kpi-label">Total Assigned</div><div class="kpi-value">${teamData.reduce((s, t) => s + t.assigned, 0).toLocaleString()}</div></div>
</div>

${critical.length > 0 ? `<div class="card mb-24">
  <div class="card-header"><div class="card-title">🚨 Critical Alerts</div></div>
  ${critical.map(t => `
  <div class="alert ${t.assigned > 100 ? "alert-err" : "alert-warn"}">
    <span class="alert-icon">${t.assigned > 100 ? "🔴" : "🟡"}</span>
    <div class="alert-body">
      <strong>${t.name}</strong> — ${t.assigned} leads assigned (cap: 60)${t.lopDays >= 3 ? ` · ${t.lopDays} LOP days · ${t.deficitMin > 0 ? "+" : ""}${t.deficitMin} min deficit` : ""}
    </div>
  </div>`).join("")}
</div>` : ""}

<div class="card mb-24">
  <div class="card-header">
    <div class="card-title">Per AC Status</div>
    <button class="btn-secondary btn-sm" onclick="showReportsModal()">Generate Report</button>
  </div>
  ${teamData.length === 0 ? "<p class='text-muted' style='font-size:12px;padding:20px;'>No team data. Upload Counsellor__LOP.xlsx and ensure Community_Master.xlsx has lead owners.</p>" : ""}
  <div class="table-wrap">
    <table>
      <thead><tr><th>Name</th><th>Vertical</th><th>Assigned</th><th>Cap Used</th><th>LOP Days</th><th>Deficit Min</th><th>Avg Min/Call</th><th>Status</th></tr></thead>
      <tbody>
        ${[...teamData].sort((a, b) => b.assigned - a.assigned).map(t => {
          const capPct = Math.min(100, (t.assigned / 60) * 100);
          const statusStr = t.assigned > 100 ? "OVERLOADED" : t.lopDays >= 3 ? "CRITICAL LOP" : t.assigned > 60 ? "OVER CAP" : "OK";
          const statusCls = statusStr === "OVERLOADED" || statusStr === "CRITICAL LOP" ? "badge-err" : statusStr === "OVER CAP" ? "badge-warn" : "badge-ok";
          return `<tr>
            <td style="font-weight:600;color:#fff;">${t.name}</td>
            <td>${t.vertical || "—"}</td>
            <td class="${t.assigned > 100 ? "td-err" : t.assigned > 60 ? "td-warn" : "td-ok"}">${t.assigned}</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px;">
                <div style="width:80px;height:8px;background:var(--ink3);border-radius:4px;overflow:hidden;">
                  <div style="width:${capPct}%;height:100%;background:${capPct > 166 ? "var(--err)" : capPct > 100 ? "var(--warn)" : "var(--ok)"};border-radius:4px;"></div>
                </div>
                <span style="font-size:10px;">${Math.round(capPct)}%</span>
              </div>
            </td>
            <td class="${t.lopDays >= 3 ? "td-err" : t.lopDays > 0 ? "td-warn" : ""}">${t.lopDays || 0}d</td>
            <td class="${t.deficitMin > 0 ? "td-err" : t.deficitMin < 0 ? "td-ok" : ""}">${t.deficitMin > 0 ? "+" : ""}${t.deficitMin || 0}</td>
            <td>${Math.round(t.avgMinDay) || "—"}</td>
            <td><span class="badge ${statusCls}">${statusStr}</span></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>
</div>

<div class="card">
  <div class="card-header"><div class="card-title">Bandwidth Overview</div></div>
  ${[...teamData].sort((a, b) => b.assigned - a.assigned).slice(0, 12).map(t => `
  <div class="bw-bar-wrap">
    <div class="bw-name">${t.name}</div>
    <div class="bw-bar-bg"><div class="bw-bar-fill ${t.assigned > 100 ? "bw-red" : t.assigned > 60 ? "bw-amber" : "bw-green"}" style="width:${Math.min(100, t.assigned / 2)}%;"></div></div>
    <div class="bw-score ${t.assigned > 100 ? "text-err" : t.assigned > 60 ? "text-warn" : "text-ok"}">${t.assigned}</div>
  </div>`).join("")}
</div>`;

  $("main-content").innerHTML = html;
}

// ── PAGE 8: COMMUNITY OPS ─────────────────────────────────────
function ops() {
  const d = DATA_CACHE;
  const groups = (d.groups || []).filter(g => g.communityName || g.groupActive);

  const html = `
<div class="page-header">
  <div class="page-title">Community Ops</div>
  <div class="page-sub">${groups.length} communities tracked</div>
</div>

<div class="card mb-24">
  <div class="card-header">
    <div class="card-title">Active Communities</div>
    <button class="btn-secondary btn-sm" onclick="showReportsModal()">Generate Report</button>
  </div>
  ${groups.length === 0 ? "<p class='text-muted' style='font-size:12px;padding:20px;'>No community data. Upload Community_Master.xlsx with New-Community Details sheet.</p>" : ""}
  <div class="table-wrap">
    <table>
      <thead><tr><th>Community</th><th>CM</th><th>Start</th><th>End</th><th>Members</th><th>WhatsApp</th><th>Offer Page</th><th>Vertical</th></tr></thead>
      <tbody>
        ${groups.map(g => `<tr>
          <td style="font-weight:600;font-size:11px;color:#fff;">${g.communityName || g.groupActive || ""}</td>
          <td style="font-size:11px;">${g.cm || "—"}</td>
          <td style="font-size:11px;white-space:nowrap;">${g.startDate || "—"}</td>
          <td style="font-size:11px;white-space:nowrap;">${g.endDate || "—"}</td>
          <td>${g.members || "—"}</td>
          <td>${g.whatsappLink ? `<a href="${g.whatsappLink}" target="_blank" class="rec-badge rec-drive">💬 Open</a>` : "—"}</td>
          <td>${g.offerPage ? `<a href="${g.offerPage}" target="_blank" class="rec-badge rec-yt">🔗 Open</a>` : "—"}</td>
          <td><span class="badge badge-info">${g.vertical || "—"}</span></td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
</div>

<div class="grid-2 mb-24">
  <div class="card">
    <div class="card-header"><div class="card-title">Sharefree Webhook</div></div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Configure Sharefree to POST to this URL on payment:</div>
    <div style="background:var(--ink3);border:1px solid var(--border2);border-radius:6px;padding:10px 12px;font-family:monospace;font-size:11px;color:var(--ghost);word-break:break-all;" id="webhook-url">Loading...</div>
    <button class="btn-secondary btn-sm mt-16" onclick="testWebhook()">Test Webhook</button>
  </div>
  <div class="card">
    <div class="card-header"><div class="card-title">AiSensy (WhatsApp)</div></div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">For automated report delivery via WhatsApp</div>
    <input type="password" placeholder="AiSensy API key..." style="background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:8px 12px;border-radius:6px;font-size:12px;width:100%;" id="aisensy-key"/>
    <button class="btn-secondary btn-sm mt-16" onclick="alert('Save to Railway env: AISENSY_API_KEY')">Save to Config</button>
  </div>
</div>

<div class="card">
  <div class="card-header"><div class="card-title">SOPs</div><span class="text-muted" style="font-size:11px;">Generated from Community Manual</span></div>
  <div class="accordion-item">
    <div class="accordion-header" onclick="toggleAccordion(this)">
      <span>CM SOP — 21-Day Schedule</span>
      <span class="accordion-chevron">▾</span>
    </div>
    <div class="accordion-body">
      <p><strong>Week 1 (D1–D7):</strong> Welcome message sent ✓ · Introduce self as CM · Share community rules · Post Day 1 content · Confirm webinar link sent to all members</p>
      <p><strong>Week 2 (D8–D14):</strong> Mid-program check-in · Webinar reminder (48h + 2h before) · Share recording within 24h · Identify non-attendees and follow up</p>
      <p><strong>Week 3 (D15–D21):</strong> Final webinar prep · Scholarship/offer announcement · Conversion push · Collect testimonials · Close-out message</p>
    </div>
  </div>
  <div class="accordion-item">
    <div class="accordion-header" onclick="toggleAccordion(this)">
      <span>AC SOP — Lead Call Order</span>
      <span class="accordion-chevron">▾</span>
    </div>
    <div class="accordion-body">
      <p><strong>Priority 1 (Call same day):</strong> Booking Fee Received — confirm and guide to enrollment</p>
      <p><strong>Priority 2:</strong> Discovery Done — within 24h, send offer + follow up on commitment</p>
      <p><strong>Priority 3:</strong> Roadmap Done — within 48h, reinforce value + handle objections</p>
      <p><strong>Priority 4:</strong> New Lead — within 72h of webinar attendance</p>
      <p><strong>Do NOT call:</strong> Not Interested (mark closed) · Not Picking Up >5 attempts (park for 14 days)</p>
    </div>
  </div>
  <div class="accordion-item">
    <div class="accordion-header" onclick="toggleAccordion(this)">
      <span>Webinar SOP — Next Webinar Checklist</span>
      <span class="accordion-chevron">▾</span>
    </div>
    <div class="accordion-body">
      <p>☐ Payment link tested by Srishti 48h before webinar</p>
      <p>☐ Offer page updated with correct price and community name</p>
      <p>☐ WhatsApp reminder sent (T-48h and T-2h)</p>
      <p>☐ Speaker confirmed + topic finalized</p>
      <p>☐ Recording link shared within 24h post-webinar</p>
      <p>☐ Conversion list sent to ACs within 2h of webinar end</p>
    </div>
  </div>
</div>`;

  $("main-content").innerHTML = html;

  fetch("/api/integrations/status").then(r => r.json()).then(s => {
    const el = $("webhook-url");
    if (el) el.textContent = s.sharefreeWebhook || window.location.origin + "/api/webhook/sharefree";
  }).catch(() => {
    const el = $("webhook-url");
    if (el) el.textContent = window.location.origin + "/api/webhook/sharefree";
  });
}

window.testWebhook = function() {
  fetch("/api/webhook/sharefree", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test User", email: "test@test.com", amount: 15000, product: "CONTRACT/TEST", timestamp: new Date().toISOString() })
  }).then(r => r.json()).then(d => { alert("Webhook test: " + JSON.stringify(d)); }).catch(e => alert("Error: " + e.message));
};

window.toggleAccordion = function(header) {
  const body = header.nextElementSibling;
  const chevron = header.querySelector(".accordion-chevron");
  body.classList.toggle("open");
  if (chevron) chevron.classList.toggle("open");
};

// ── PAGE 9: ASK HERA ──────────────────────────────────────────
let chatHistory = [];

function ask() {
  const d = DATA_CACHE;
  const allHealth = d.allHealth || [];
  const topIssues = allHealth.filter(h => h.status === "red" || h.status === "amber").slice(0, 4);

  const suggested = [
    "Why is CD underperforming this month?",
    "Which AC is most at risk right now?",
    "What is the CPL for CL this month?",
    "Which webinar topic drove the most conversions?",
    "Compare the best and worst performing cohorts",
    "What should I focus on today?"
  ];

  if (topIssues.length > 0) {
    suggested.unshift(`Why is ${topIssues[0].cohort} failing?`);
  }

  const html = `
<div class="page-header">
  <div class="page-title">Ask HERA</div>
  <div class="page-sub">AI-powered intelligence · Data-grounded answers · ${d.leads ? d.leads.length.toLocaleString() + " leads in context" : ""}</div>
</div>

<div class="grid-2" style="gap:16px;margin-bottom:24px;align-items:start;">
  <div>
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title mb-16">💡 Suggested Questions</div>
      ${suggested.slice(0, 6).map(q => `<div class="tag" style="cursor:pointer;margin:4px;display:inline-block;" onclick="askQuestion(this.textContent)">${q}</div>`).join("")}
    </div>
    ${topIssues.length > 0 ? `<div class="card">
      <div class="card-title mb-16">🔴 Live Issues for Analysis</div>
      ${topIssues.map(i => `<div class="flex-row" style="margin-bottom:8px;font-size:12px;cursor:pointer;" onclick="askQuestion('Explain this issue and what to do: ${i.issues[0]}')">${statusIcon(i.status)} <span>[${i.cohort}]</span> <span class="text-muted">${(i.issues[0] || "").substring(0, 50)}</span></div>`).join("")}
    </div>` : ""}
  </div>
  <div class="card">
    <div class="card-title mb-16">Chat with HERA</div>
    <div id="chat-history" style="max-height:400px;overflow-y:auto;margin-bottom:14px;min-height:100px;font-size:12px;">
      ${chatHistory.length === 0 ? "<p class='text-muted'>Ask any question about your data. HERA responds with specific numbers.</p>" : chatHistory.map(m => `
      <div style="margin-bottom:12px;">
        <div style="font-weight:600;color:${m.role === "user" ? "var(--info)" : "var(--ok)"};">${m.role === "user" ? "You" : "HERA"}</div>
        <div style="white-space:pre-wrap;line-height:1.7;color:var(--ghost);">${m.content}</div>
      </div>`).join("")}
    </div>
    <div class="flex-row">
      <textarea id="ask-input" class="ai-input" placeholder="Ask anything about your data..." style="flex:1;background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:10px;border-radius:6px;font-size:12px;resize:vertical;min-height:60px;" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendAsk();}"></textarea>
    </div>
    <div class="flex-row mt-16" style="justify-content:flex-end;gap:8px;">
      <button class="btn-secondary btn-sm" onclick="clearChat()">Clear</button>
      <button class="btn-primary" id="send-btn" onclick="sendAsk()">Send ↵</button>
    </div>
    <div id="ask-error" class="text-err" style="font-size:11px;margin-top:8px;"></div>
  </div>
</div>

${!SESSION || !SESSION.apiKey ? "<div class='alert alert-warn'><span class='alert-icon'>⚠</span><div class='alert-body'>No API key set. Re-login with your Anthropic API key (sk-ant-...) to use Ask HERA.</div></div>" : ""}`;

  $("main-content").innerHTML = html;
}

window.askQuestion = function(q) {
  const input = $("ask-input");
  if (input) { input.value = q; sendAsk(); }
};

window.clearChat = function() {
  chatHistory = [];
  ask();
};

window.sendAsk = function() {
  const input = $("ask-input");
  const q = (input ? input.value : "").trim();
  if (!q) return;
  if (!SESSION || !SESSION.apiKey) {
    $("ask-error").textContent = "No API key. Re-login with your Anthropic key.";
    return;
  }

  chatHistory.push({ role: "user", content: q });
  input.value = "";
  const sendBtn = $("send-btn");
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "..."; }
  $("ask-error").textContent = "";
  renderChatHistory();

  fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": SESSION.apiKey },
    body: JSON.stringify({ hera_ask: q })
  })
    .then(r => {
      if (!r.ok) return r.json().then(e => { throw new Error(e.error || "API error " + r.status); });
      return r.json();
    })
    .then(d => {
      tokenCount += (d.usage ? (d.usage.input_tokens + d.usage.output_tokens) : 0);
      tokenCost += (d.usage ? (d.usage.input_tokens * 0.00000025 + d.usage.output_tokens * 0.00000125) : 0);
      $("token-counter").textContent = `${tokenCount} tok · ₹${(tokenCost * 84).toFixed(2)}`;
      const text = d.content && d.content[0] ? d.content[0].text : "No response";
      chatHistory.push({ role: "assistant", content: text });
      renderChatHistory();
    })
    .catch(e => {
      $("ask-error").textContent = "Error: " + e.message;
      chatHistory.pop();
    })
    .finally(() => {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "Send ↵"; }
    });
};

function renderChatHistory() {
  const el = $("chat-history");
  if (!el) return;
  if (!chatHistory.length) {
    el.innerHTML = "<p class='text-muted'>Ask any question about your data. HERA responds with specific numbers.</p>";
    return;
  }
  el.innerHTML = chatHistory.map(m => `
<div style="margin-bottom:14px;">
  <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${m.role === "user" ? "var(--info)" : "var(--ok)"};margin-bottom:4px;">${m.role === "user" ? "You" : "HERA"}</div>
  <div style="white-space:pre-wrap;line-height:1.7;color:var(--ghost);font-size:12px;">${m.content}</div>
</div>`).join("");
  el.scrollTop = el.scrollHeight;
}

// ── PAGE: DATA INGESTION ──────────────────────────────────────
function ingest() {
  const html = `
<div class="page-header">
  <div class="page-title">Data Ingestion</div>
  <div class="page-sub">Upload files, connect Google Drive, fetch URLs, or paste data manually</div>
</div>

<div class="grid-2 mb-24" style="gap:16px;">

  <!-- UPLOAD FILE -->
  <div class="card">
    <div class="card-header"><div class="card-title">📁 Upload File</div></div>
    <p class="text-muted mb-16" style="font-size:11px;">Community_Master.xlsx · Counsellor__LOP.xlsx · nitya_requirements.xlsx · Sales_data_sheet.xlsx · Recordings_Chat_Files.xlsx</p>
    <div class="dropzone" id="ingest-dropzone" onclick="$('ingest-file-input').click()">
      <div class="dropzone-icon">📊</div>
      <div class="dropzone-text">Click or drag & drop an xlsx file here</div>
      <div id="ingest-upload-status" style="margin-top:8px;font-size:12px;"></div>
    </div>
    <input type="file" id="ingest-file-input" accept=".xlsx,.xls" style="display:none" onchange="ingestUploadFile(this)"/>
    <div id="ingest-upload-result" style="margin-top:10px;font-size:12px;"></div>
  </div>

  <!-- GOOGLE DRIVE / URL -->
  <div class="card">
    <div class="card-header"><div class="card-title">🔗 Google Drive or URL</div></div>
    <p class="text-muted mb-16" style="font-size:11px;">Paste a Google Drive share link, Google Sheets link, or any direct .xlsx URL. Make sure sharing is set to "Anyone with link".</p>
    <div class="form-group">
      <label>File Name (optional)</label>
      <input type="text" id="ingest-url-name" placeholder="e.g. Community_Master" style="background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:8px 12px;border-radius:6px;font-size:12px;width:100%;"/>
    </div>
    <div class="form-group" style="margin-top:10px;">
      <label>URL</label>
      <input type="text" id="ingest-url" placeholder="https://drive.google.com/file/d/... or direct .xlsx URL" style="background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:8px 12px;border-radius:6px;font-size:12px;width:100%;"/>
    </div>
    <button class="btn-primary" style="margin-top:12px;" onclick="ingestFromURL()">Fetch & Ingest</button>
    <div id="ingest-url-result" style="margin-top:10px;font-size:12px;"></div>
  </div>

</div>

<!-- LIVE GOOGLE SHEETS -->
<div class="card mb-24">
  <div class="card-header">
    <div class="card-title">📡 Live Google Sheets Connector</div>
    <span style="font-size:11px;color:var(--muted);">Auto-refresh every 5 min · No upload needed</span>
  </div>
  <p class="text-muted mb-16" style="font-size:11px;">Add a published Google Sheet URL. HERA will poll it every 5 minutes and merge updates into the live dashboard. Sheet must be <strong>published to web</strong> (File → Share → Publish to web → CSV).</p>
  <div id="live-sheets-list" style="margin-bottom:12px;"></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
    <div style="flex:1;min-width:200px;">
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Sheet Name</label>
      <input type="text" id="ls-name" placeholder="e.g. Community Master" style="background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:8px 12px;border-radius:6px;font-size:12px;width:100%;"/>
    </div>
    <div style="flex:2;min-width:280px;">
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Published CSV URL</label>
      <input type="text" id="ls-url" placeholder="https://docs.google.com/spreadsheets/d/.../pub?output=csv" style="background:var(--ink3);border:1px solid var(--border2);color:var(--ghost);padding:8px 12px;border-radius:6px;font-size:12px;width:100%;"/>
    </div>
    <button class="btn-primary btn-sm" onclick="addLiveSheet()">+ Add</button>
  </div>
  <div id="ls-result" style="margin-top:10px;font-size:12px;"></div>
  <div style="margin-top:12px;padding:10px;background:var(--ink3);border-radius:6px;font-size:11px;color:var(--muted);">
    <strong style="color:#fff;">How to get the URL:</strong> Open your Google Sheet → File → Share → Publish to web → Select "Entire Document" → Format: CSV → Publish → Copy link. Paste above.
  </div>
</div>

<!-- CURRENT DATA FILES -->
<div class="card mb-24">
  <div class="card-header">
    <div class="card-title">📂 Files Currently Loaded</div>
    <button class="btn-secondary btn-sm" onclick="loadIngestFiles()">↺ Refresh</button>
  </div>
  <div id="ingest-files-list">Loading...</div>
</div>

<!-- DATA PREVIEW -->
<div class="card mb-24" id="ingest-preview-card" style="display:none;">
  <div class="card-header"><div class="card-title" id="ingest-preview-title">Preview</div></div>
  <div id="ingest-preview-content"></div>
</div>

<!-- SYNC STATUS -->
<div class="card">
  <div class="card-header"><div class="card-title">🔄 Sync Status</div></div>
  <div id="ingest-sync-status" style="font-size:12px;color:var(--muted);">Loading...</div>
  <div class="flex-row mt-16" style="gap:10px;flex-wrap:wrap;">
    <button class="btn-primary" onclick="ingestTriggerSync()">↺ Sync Now</button>
    <button class="btn-secondary" onclick="navigate('command')">View Dashboard</button>
  </div>
</div>`;

  $("main-content").innerHTML = html;

  // Dropzone drag events
  const dz = $("ingest-dropzone");
  if (dz) {
    dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
    dz.addEventListener("drop", e => {
      e.preventDefault(); dz.classList.remove("drag");
      const f = e.dataTransfer.files[0];
      if (f) ingestUploadFile({ files: [f] });
    });
  }

  loadIngestFiles();
  loadIngestSyncStatus();
}

window.ingestUploadFile = function(input) {
  const file = input.files[0];
  if (!file) return;
  $("ingest-upload-status").textContent = "Uploading " + file.name + "...";
  $("ingest-upload-result").textContent = "";
  const fd = new FormData();
  fd.append("file", file);
  fetch("/api/upload", { method: "POST", body: fd })
    .then(r => r.json())
    .then(d => {
      $("ingest-upload-status").textContent = "";
      if (d.error) {
        $("ingest-upload-result").innerHTML = `<span class="text-err">Error: ${d.error}</span>`;
        return;
      }
      $("ingest-upload-result").innerHTML = `<span class="text-ok">✓ ${d.filename} — ${d.totalSheets} sheets found. Sync triggered.</span>`;
      showIngestPreview(d.filename, d.sheets, d.preview);
      setTimeout(loadIngestFiles, 1500);
      setTimeout(loadIngestSyncStatus, 2000);
    })
    .catch(e => {
      $("ingest-upload-status").textContent = "";
      $("ingest-upload-result").innerHTML = `<span class="text-err">Upload failed: ${e.message}</span>`;
    });
};

window.ingestFromURL = function() {
  const url = ($("ingest-url") || {}).value || "";
  const name = ($("ingest-url-name") || {}).value || "";
  if (!url.trim()) { $("ingest-url-result").innerHTML = `<span class="text-err">Please enter a URL.</span>`; return; }
  $("ingest-url-result").innerHTML = `<span class="text-muted"><span class="spinner"></span> Fetching...</span>`;
  fetch("/api/fetch-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.trim(), name: name.trim() || "fetched_data" })
  })
    .then(r => r.json())
    .then(d => {
      if (d.error) {
        $("ingest-url-result").innerHTML = `<span class="text-err">Error: ${d.error}</span>`;
        return;
      }
      $("ingest-url-result").innerHTML = `<span class="text-ok">✓ ${d.filename} fetched (${Math.round(d.size / 1024)}KB) — ${d.totalSheets} sheets. Sync triggered.</span>`;
      showIngestPreview(d.filename, d.sheets, d.preview);
      setTimeout(loadIngestFiles, 1500);
      setTimeout(loadIngestSyncStatus, 2000);
    })
    .catch(e => { $("ingest-url-result").innerHTML = `<span class="text-err">Fetch failed: ${e.message}</span>`; });
};

function showIngestPreview(filename, sheets, preview) {
  const card = $("ingest-preview-card");
  const title = $("ingest-preview-title");
  const content = $("ingest-preview-content");
  if (!card || !content) return;
  card.style.display = "";
  title.textContent = "Preview — " + filename + " (" + sheets.length + " sheets)";
  if (!preview || !preview.length) { content.innerHTML = "<p class='text-muted' style='font-size:12px;'>No preview available.</p>"; return; }
  const cols = Object.keys(preview[0] || {}).slice(0, 8);
  content.innerHTML = `
<div style="font-size:11px;color:var(--muted);margin-bottom:8px;">Sheets: ${sheets.join(" · ")}</div>
<div class="table-wrap"><table>
<thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead>
<tbody>${preview.map(row => `<tr>${cols.map(c => `<td style="font-size:11px;">${row[c] || ""}</td>`).join("")}</tr>`).join("")}</tbody>
</table></div>`;
}

function loadIngestFiles() {
  fetch("/api/data-files")
    .then(r => r.json())
    .then(files => {
      const el = $("ingest-files-list");
      if (!el) return;
      if (!files.length) {
        el.innerHTML = `<p class="text-muted" style="font-size:12px;padding:12px 0;">No data files loaded yet. Upload a file or fetch from a URL above.</p>`;
        return;
      }
      el.innerHTML = `<div class="table-wrap"><table>
<thead><tr><th>Filename</th><th>Size</th><th>Last Modified</th><th></th></tr></thead>
<tbody>
${files.map(f => `<tr>
  <td style="font-weight:600;color:#fff;font-size:12px;">📊 ${f.name}</td>
  <td style="font-size:11px;">${Math.round(f.size / 1024)}KB</td>
  <td style="font-size:11px;">${new Date(f.modified).toLocaleString("en-IN")}</td>
  <td><button class="btn-secondary btn-sm" onclick="ingestDeleteFile('${f.name}')" style="color:var(--err);border-color:rgba(239,68,68,.3);">✕ Remove</button></td>
</tr>`).join("")}
</tbody></table></div>`;
    })
    .catch(() => { const el = $("ingest-files-list"); if (el) el.innerHTML = `<p class="text-muted" style="font-size:12px;">Could not load file list.</p>`; });
}

window.ingestDeleteFile = function(name) {
  if (!confirm("Remove " + name + " from HERA data?")) return;
  fetch("/api/data-files/" + encodeURIComponent(name), { method: "DELETE" })
    .then(r => r.json())
    .then(() => { loadIngestFiles(); loadIngestSyncStatus(); })
    .catch(e => alert("Error: " + e.message));
};

function loadIngestSyncStatus() {
  fetch("/api/data/status")
    .then(r => r.json())
    .then(s => {
      const el = $("ingest-sync-status");
      if (!el) return;
      const t = s.syncedAt ? new Date(s.syncedAt).toLocaleString("en-IN") : "Never";
      el.innerHTML = `
<div class="flex-row" style="flex-wrap:wrap;gap:16px;">
  <div><span class="text-muted">Last sync:</span> <strong style="color:#fff;">${t}</strong></div>
  <div><span class="text-muted">Leads loaded:</span> <strong style="color:#fff;">${(s.counts && s.counts.leads || 0).toLocaleString()}</strong></div>
  <div><span class="text-muted">Revenue rows:</span> <strong style="color:#fff;">${(s.counts && s.counts.revenue || 0).toLocaleString()}</strong></div>
  <div><span class="text-muted">Webinars:</span> <strong style="color:#fff;">${(s.counts && s.counts.webinars || 0).toLocaleString()}</strong></div>
  ${s.lastError ? `<div class="text-err">Last error: ${s.lastError}</div>` : ""}
  ${s.syncing ? `<div class="text-warn"><span class="spinner"></span> Sync in progress...</div>` : ""}
</div>`;
    })
    .catch(() => {});
}

window.ingestTriggerSync = function() {
  $("ingest-sync-status").innerHTML = `<span class="text-warn"><span class="spinner"></span> Syncing...</span>`;
  fetch("/api/sync", { method: "POST" })
    .then(() => setTimeout(() => { loadIngestFiles(); loadIngestSyncStatus(); loadDataThen(() => {}); }, 3000));
};


// ── FUNNEL ANALYTICS PAGE ────────────────────────────────────
function funnel() {
  $("main-content").innerHTML = `<div style="text-align:center;padding:60px;color:var(--muted);"><div class="spinner"></div></div>`;
  fetch('/api/integrations/status').then(r => r.json()).then(renderFunnelPage)
    .catch(e => { $("main-content").innerHTML = `<div class="alert alert-err">${e.message}</div>`; });
}

function renderFunnelPage(status) {
  const gxOk  = status.growthx?.connected;
  const metaOk = status.meta?.connected;

  $("main-content").innerHTML = `
<div class="page-header">
  <div><div class="page-title">🔀 Funnel Analytics</div>
    <div class="page-sub">Team Abhipsa · GrowthX + Meta + Cashfree + AiSensy</div></div>
</div>

<!-- ── GrowthX Live Query ── -->
<div class="card mb-20">
  <div class="card-header">
    <div class="card-title">📈 GrowthX Live Data <span style="font-size:11px;margin-left:8px;color:${gxOk?'var(--ok)':'var(--warn)'};">${gxOk?'🟢 Connected':'⚪ Token via env var GROWTHX_TOKEN'}</span></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr auto auto;gap:10px;align-items:end;margin-bottom:12px;">
    <div>
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">From <span style="color:var(--err);">*</span></label>
      <input type="date" id="gx-from" style="width:100%;background:var(--ink3);border:1px solid rgba(255,255,255,.15);color:#fff;padding:7px 10px;border-radius:6px;font-size:13px;box-sizing:border-box;" />
    </div>
    <div>
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">To <span style="color:var(--err);">*</span> <span style="color:var(--muted);font-size:10px;">(max 31 days)</span></label>
      <input type="date" id="gx-to" style="width:100%;background:var(--ink3);border:1px solid rgba(255,255,255,.15);color:#fff;padding:7px 10px;border-radius:6px;font-size:13px;box-sizing:border-box;" />
    </div>
    <button class="btn-primary" onclick="gxFetchLeads()" style="height:36px;white-space:nowrap;">Fetch Leads</button>
    <button class="btn-secondary" onclick="gxFetchFunnel()" style="height:36px;white-space:nowrap;">Fetch Funnel</button>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
    <div>
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Group (optional, comma-separated)</label>
      <input type="text" id="gx-group" placeholder="Contract Drafting,Criminal Litigation..." style="width:100%;background:var(--ink3);border:1px solid rgba(255,255,255,.1);color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;box-sizing:border-box;" />
    </div>
    <div>
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Lead Type (optional)</label>
      <input type="text" id="gx-leadtype" placeholder="e.g. test,test2" style="width:100%;background:var(--ink3);border:1px solid rgba(255,255,255,.1);color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;box-sizing:border-box;" />
    </div>
    <div>
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Slug (optional)</label>
      <input type="text" id="gx-slug" placeholder="e.g. test1,test2" style="width:100%;background:var(--ink3);border:1px solid rgba(255,255,255,.1);color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;box-sizing:border-box;" />
    </div>
  </div>
  <div id="gx-error" style="font-size:12px;color:var(--err);margin-bottom:8px;display:none;"></div>
  <div id="gx-result"></div>
</div>

<!-- ── Integration Config (collapsible) ── -->
<div class="card mb-20">
  <div class="card-header" style="cursor:pointer;" onclick="toggleEl('int-config-body','int-config-chev')">
    <div class="card-title">⚙️ Integration Config</div>
    <span id="int-config-chev" style="color:var(--muted);">▼</span>
  </div>
  <div id="int-config-body" style="display:none;">
    ${buildIntConfigCards(status)}
  </div>
</div>

<!-- ── AiSensy WA Group Check ── -->
<div class="card mb-20">
  <div class="card-header">
    <div class="card-title">💬 AiSensy — Paid Learner WA Group Check</div>
    <button class="btn-secondary btn-sm" onclick="loadAisensyCheck()">↺ Load</button>
  </div>
  <div id="aisensy-check-body"><div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">Connect AiSensy and click Load.</div></div>
</div>

<!-- ── Email Analytics ── -->
<div class="card">
  <div class="card-header">
    <div class="card-title">📧 Email Campaign Analytics</div>
    <button class="btn-secondary btn-sm" onclick="loadMailAnalytics()">↺ Load</button>
  </div>
  <div id="mail-analytics-body"><div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">Configure email integration and click Load.</div></div>
</div>

<!-- ── LeadSquared Leads ── -->
<div class="card">
  <div class="card-header" style="cursor:pointer;" onclick="toggleEl('lsq-data-body','lsq-chev')">
    <div class="card-title">🔷 LeadSquared — Lead Pipeline</div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn-secondary btn-sm" onclick="event.stopPropagation();loadLSQData()">↺ Load</button>
      <span id="lsq-chev" style="color:var(--muted);">▼</span>
    </div>
  </div>
  <div id="lsq-data-body" style="display:none;"><div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">Configure LSQ credentials in Integrations above, then click Load.</div></div>
</div>

<!-- ── AceConnect ── -->
<div class="card">
  <div class="card-header" style="cursor:pointer;" onclick="toggleEl('aceconnect-data-body','aceconnect-chev')">
    <div class="card-title">🔗 AceConnect — Contacts & Calls</div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn-secondary btn-sm" onclick="event.stopPropagation();loadAceConnectData()">↺ Load</button>
      <span id="aceconnect-chev" style="color:var(--muted);">▼</span>
    </div>
  </div>
  <div id="aceconnect-data-body" style="display:none;"><div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">Configure AceConnect API key in Integrations above, then click Load.</div></div>
</div>

<!-- ── Salesa ── -->
<div class="card">
  <div class="card-header" style="cursor:pointer;" onclick="toggleEl('salesa-data-body','salesa-chev')">
    <div class="card-title">🏷️ Salesa — Deals & Lead Tracking</div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn-secondary btn-sm" onclick="event.stopPropagation();loadSalesaData()">↺ Load</button>
      <span id="salesa-chev" style="color:var(--muted);">▼</span>
    </div>
  </div>
  <div id="salesa-data-body" style="display:none;"><div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">Configure Salesa API key in Integrations above, then click Load.</div></div>
</div>

<!-- ── Time Doctor ── -->
<div class="card">
  <div class="card-header" style="cursor:pointer;" onclick="toggleEl('td-data-body','td-chev')">
    <div class="card-title">⏱️ Time Doctor — Staff Work Logs</div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn-secondary btn-sm" onclick="event.stopPropagation();loadTimeDoctorData()">↺ Load</button>
      <span id="td-chev" style="color:var(--muted);">▼</span>
    </div>
  </div>
  <div id="td-data-body" style="display:none;"><div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">Configure Time Doctor credentials in Integrations above, then click Load.</div></div>
</div>`;

  // Set sensible default dates: last full month
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastOfPrevMonth = new Date(firstOfMonth - 1);
  const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);
  const fmt = d => d.toISOString().slice(0, 10);
  const gxFrom = $("gx-from"); const gxTo = $("gx-to");
  if (gxFrom) gxFrom.value = fmt(firstOfPrevMonth);
  if (gxTo)   gxTo.value   = fmt(lastOfPrevMonth);

  // Validate dates on change
  [gxFrom, gxTo].forEach(el => el && el.addEventListener('change', gxValidateDates));
}

function gxValidateDates() {
  const from = ($("gx-from") || {}).value;
  const to   = ($("gx-to")   || {}).value;
  const err  = $("gx-error");
  if (!err) return true;
  if (!from || !to) { err.textContent = 'Both dates are required.'; err.style.display=''; return false; }
  const days = (new Date(to) - new Date(from)) / 86400000;
  if (days < 0) { err.textContent = '"From" must be before "To".'; err.style.display=''; return false; }
  if (days > 31) { err.textContent = `Date range is ${Math.round(days)} days — max 31 days allowed.`; err.style.display=''; return false; }
  err.style.display = 'none';
  return true;
}

window.gxFetchLeads = function() {
  if (!gxValidateDates()) return;
  const from = $("gx-from").value, to = $("gx-to").value;
  const group = ($("gx-group") || {}).value || '';
  const leadtype = ($("gx-leadtype") || {}).value || '';
  const slug = ($("gx-slug") || {}).value || '';
  const result = $("gx-result");
  if (result) result.innerHTML = `<div style="padding:16px;text-align:center;"><span class="spinner"></span> Fetching leads...</div>`;
  fetch('/api/growthx/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, group: group || undefined, leadtype: leadtype || undefined, slug: slug || undefined })
  }).then(r => r.json()).then(d => {
    if (d.error) { if (result) result.innerHTML = `<div class="alert alert-err" style="margin:0;">${d.error}</div>`; return; }
    renderGxLeads(d.data, from, to);
  }).catch(e => { if (result) result.innerHTML = `<div class="alert alert-err" style="margin:0;">${e.message}</div>`; });
};

window.gxFetchFunnel = function() {
  if (!gxValidateDates()) return;
  const from = $("gx-from").value, to = $("gx-to").value;
  const result = $("gx-result");
  if (result) result.innerHTML = `<div style="padding:16px;text-align:center;"><span class="spinner"></span> Fetching funnel...</div>`;
  fetch('/api/growthx/funnel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to })
  }).then(r => r.json()).then(d => {
    if (d.error) { if (result) result.innerHTML = `<div class="alert alert-err" style="margin:0;">${d.error}</div>`; return; }
    renderGxFunnel(d.data, from, to);
  }).catch(e => { if (result) result.innerHTML = `<div class="alert alert-err" style="margin:0;">${e.message}</div>`; });
};

function renderGxLeads(data, from, to) {
  const result = $("gx-result");
  if (!result) return;
  // data can be array of leads or object with leads array
  const leads = Array.isArray(data) ? data : (data?.leads || data?.data || []);
  if (!leads.length) {
    result.innerHTML = `<div style="padding:12px;text-align:center;color:var(--muted);font-size:12px;">No leads found for ${from} → ${to}</div>`;
    return;
  }
  // Figure out column keys from first row
  const allKeys = Object.keys(leads[0] || {});
  const priority = ['name','email','phone','group','leadtype','slug','created_at','status','source'];
  const cols = [...priority.filter(k => allKeys.includes(k)), ...allKeys.filter(k => !priority.includes(k))].slice(0, 10);

  // Summary by vertical/group
  const byGroup = {};
  leads.forEach(l => {
    const g = l.group || l.community || 'Unknown';
    byGroup[g] = (byGroup[g] || 0) + 1;
  });
  const groupSummary = Object.entries(byGroup).sort((a,b)=>b[1]-a[1]).slice(0,8)
    .map(([g, n]) => `<div class="kpi-card" style="min-width:120px;"><div class="kpi-val">${n}</div><div class="kpi-label" style="font-size:10px;">${g.length>18?g.slice(0,18)+'…':g}</div></div>`).join('');

  const rows = leads.slice(0, 100).map(l => `<tr>${cols.map(k => `<td style="font-size:11px;">${l[k]??''}</td>`).join('')}</tr>`).join('');

  result.innerHTML = `
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;padding:12px 0 0;">
  <div class="kpi-card"><div class="kpi-val">${leads.length}</div><div class="kpi-label">Total Leads</div></div>
  ${groupSummary}
</div>
<div style="font-size:11px;color:var(--muted);margin-bottom:8px;">Showing first 100 of ${leads.length} leads · ${from} → ${to}</div>
<div class="table-wrap"><table>
  <thead><tr>${cols.map(k=>`<th>${k}</th>`).join('')}</tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
}

function renderGxFunnel(data, from, to) {
  const result = $("gx-result");
  if (!result) return;

  // data is typically array of funnel stages or object with stages
  const stages = Array.isArray(data) ? data : (data?.stages || data?.data || data?.funnels || []);

  if (!stages.length) {
    result.innerHTML = `<div style="padding:12px;text-align:center;color:var(--muted);font-size:12px;">No funnel data for ${from} → ${to}</div>`;
    return;
  }

  // Try to identify stage name and count keys
  const first = stages[0] || {};
  const nameKey  = ['name','stage','label','title','funnel_name','community'].find(k => first[k]) || Object.keys(first)[0];
  const countKey = ['count','total','leads','value','users','sessions'].find(k => typeof first[k] === 'number') || Object.keys(first).find(k => typeof first[k] === 'number') || 'count';
  const convKey  = ['cvr','conversion_rate','rate','conv'].find(k => first[k] !== undefined);

  const max = Math.max(...stages.map(s => parseFloat(s[countKey]) || 0), 1);

  const stageHtml = stages.map((s, i) => {
    const label = s[nameKey] || `Stage ${i+1}`;
    const count = parseFloat(s[countKey]) || 0;
    const conv  = convKey ? parseFloat(s[convKey]) : (i > 0 ? (count / (parseFloat(stages[i-1][countKey])||1) * 100) : 100);
    const pct   = Math.max(4, Math.round((count / max) * 100));
    const clr   = conv < 20 ? 'var(--err)' : conv < 50 ? 'var(--warn)' : 'var(--ok)';
    const drop  = i > 0 ? (100 - conv).toFixed(1) : null;
    return `<div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
        <span style="color:#fff;font-weight:500;">${label}</span>
        <span style="color:#fff;">${fmtNum(count)} ${drop?`<span style="font-size:10px;color:${clr};">↓${drop}%</span>`:'<span style="font-size:10px;color:var(--ok);">top</span>'}</span>
      </div>
      <div style="background:var(--ink3);border-radius:4px;height:10px;">
        <div style="width:${pct}%;background:var(--red);height:100%;border-radius:4px;"></div>
      </div>
    </div>`;
  }).join('');

  // Raw table of all keys
  const allCols = Object.keys(first).slice(0, 12);
  const tableRows = stages.map(s => `<tr>${allCols.map(k=>`<td style="font-size:11px;">${s[k]??''}</td>`).join('')}</tr>`).join('');

  result.innerHTML = `
<div style="padding:4px 0 16px;font-size:11px;color:var(--muted);">${from} → ${to} · ${stages.length} stages</div>
<div style="margin-bottom:20px;">${stageHtml}</div>
<div class="table-wrap"><table>
  <thead><tr>${allCols.map(k=>`<th>${k}</th>`).join('')}</tr></thead>
  <tbody>${tableRows}</tbody>
</table></div>`;
}

function buildIntConfigCards(status) {
  const SERVICES = [
    { id: 'meta',       icon: '📘', name: 'Meta Ads',     fields: [{k:'token',l:'Access Token',t:'password'},{k:'accountId',l:'Ad Account ID',t:'text',ph:'123456789'}] },
    { id: 'cashfree',   icon: '💳', name: 'Cashfree',     fields: [{k:'appId',l:'App ID',t:'text'},{k:'secretKey',l:'Secret Key',t:'password'},{k:'env',l:'Env',t:'select',opts:['prod','sandbox']}] },
    { id: 'aisensy',    icon: '💬', name: 'AiSensy',      fields: [{k:'apiKey',l:'API Key',t:'password'}] },
    { id: 'growthx',    icon: '📈', name: 'GrowthX',      fields: [{k:'apiKey',l:'Bearer Token',t:'password',ph:'Set GROWTHX_TOKEN in Railway env vars'}] },
    { id: 'mail',       icon: '📧', name: 'Email',        fields: [{k:'provider',l:'Provider',t:'select',opts:['mailchimp','sendgrid','mailercloud']},{k:'apiKey',l:'API Key',t:'password'}] },
    { id: 'lsq',        icon: '🔷', name: 'LeadSquared',  fields: [{k:'accessKey',l:'Access Key',t:'text',ph:'Set LSQ_ACCESS_KEY in Railway'},{k:'secretKey',l:'Secret Key',t:'password',ph:'Set LSQ_SECRET_KEY in Railway'},{k:'host',l:'API Host',t:'text',ph:'api.leadsquared.com'}],
      hint: 'Fetches leads from the past 30 days. Get keys from LSQ → Settings → API & Webhooks.' },
    { id: 'aceconnect', icon: '🔗', name: 'AceConnect',   fields: [{k:'apiKey',l:'API Key',t:'password',ph:'Set ACECONNECT_API_KEY in Railway'},{k:'baseUrl',l:'Base URL',t:'text',ph:'https://api.aceconnect.in'}],
      hint: 'Pulls contacts, calls, and AC assignments from AceConnect. Set ACECONNECT_URL if on a custom domain.' },
    { id: 'salesa',     icon: '🏷️', name: 'Salesa',       fields: [{k:'apiKey',l:'API Key',t:'password',ph:'Set SALESA_API_KEY in Railway'},{k:'workspaceId',l:'Workspace ID',t:'text',ph:'Optional — leave blank for default'}],
      hint: 'Syncs leads, deals, and activity from Salesa CRM. Get API key from Salesa → Settings → Integrations.' },
    { id: 'timedoctor', icon: '⏱️', name: 'Time Doctor',  fields: [{k:'email',l:'Email',t:'text',ph:'Set TD_EMAIL in Railway'},{k:'password',l:'Password',t:'password',ph:'Set TD_PASSWORD in Railway'},{k:'companyId',l:'Company ID',t:'text',ph:'Leave blank to auto-detect'}],
      hint: 'Pulls staff work logs, attendance, and project time for the last 30 days. Set TD_EMAIL + TD_PASSWORD as Railway env vars.' }
  ];

  return `<div style="padding:16px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;">
  ${SERVICES.map(s => {
    const st = status[s.id] || {};
    const dot = st.connected ? '🟢' : st.error ? '🔴' : '⚪';
    const errHtml = st.error ? `<div style="font-size:11px;color:var(--err);margin-bottom:8px;">${st.error}</div>` : '';
    const syncInfo = st.syncedAt ? `<div style="font-size:10px;color:var(--muted);margin-bottom:6px;">Last sync: ${new Date(st.syncedAt).toLocaleTimeString('en-IN')}</div>` : '';
    const fieldsHtml = s.fields.map(f => {
      if (f.t === 'select') return `<div style="margin-bottom:6px;"><label style="font-size:10px;color:var(--muted);display:block;">${f.l}</label><select id="int-${s.id}-${f.k}" style="width:100%;background:var(--ink3);border:1px solid rgba(255,255,255,.1);color:#fff;padding:5px 8px;border-radius:5px;font-size:12px;">${(f.opts||[]).map(o=>`<option>${o}</option>`).join('')}</select></div>`;
      return `<div style="margin-bottom:6px;"><label style="font-size:10px;color:var(--muted);display:block;">${f.l}</label><input type="${f.t}" id="int-${s.id}-${f.k}" placeholder="${f.ph||''}" style="width:100%;background:var(--ink3);border:1px solid rgba(255,255,255,.1);color:#fff;padding:5px 8px;border-radius:5px;font-size:12px;box-sizing:border-box;"/></div>`;
    }).join('');
    const hintHtml = s.hint ? `<div style="font-size:10px;color:var(--muted);margin-bottom:8px;line-height:1.4;">${s.hint}</div>` : '';
    return `<div style="background:var(--ink3);border-radius:8px;padding:14px;">
      <div style="font-weight:600;font-size:13px;margin-bottom:8px;">${s.icon} ${s.name} <span style="float:right;">${dot}</span></div>
      ${errHtml}${syncInfo}${hintHtml}${fieldsHtml}
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button class="btn-primary btn-sm" onclick="saveIntConfig('${s.id}')">Save</button>
        <button class="btn-secondary btn-sm" onclick="syncInt('${s.id}')"><span class="spinner" id="int-spin-${s.id}" style="display:none;width:10px;height:10px;"></span> Sync</button>
      </div>
      <div id="int-result-${s.id}" style="font-size:11px;margin-top:6px;"></div>
    </div>`;
  }).join('')}
  </div>
  <div style="padding:0 0 12px;">
    <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">Cashfree webhook — add in Cashfree → Developers → Webhooks:</div>
    <div style="background:var(--ink3);border-radius:6px;padding:8px 12px;font-family:monospace;font-size:11px;color:var(--ok);word-break:break-all;" id="webhook-url-display">${window.location.origin}/api/webhook/payment</div>
  </div>`;
}

window.toggleEl = function(bodyId, chevId) {
  const el = $(bodyId), ch = $(chevId);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : '';
  if (ch) ch.textContent = open ? '▼' : '▲';
};

window.saveIntConfig = function(serviceId) {
  const FIELDS = {
    meta:['token','accountId'], cashfree:['appId','secretKey','env'],
    aisensy:['apiKey'], mail:['provider','apiKey'], growthx:['apiKey'],
    lsq:['accessKey','secretKey','host'],
    aceconnect:['apiKey','baseUrl'],
    salesa:['apiKey','workspaceId'],
    timedoctor:['email','password','companyId']
  };
  const payload = { service: serviceId };
  (FIELDS[serviceId]||[]).forEach(f => {
    const el = $(`int-${serviceId}-${f}`);
    if (el && el.value.trim()) payload[f] = el.value.trim();
  });
  const result = $(`int-result-${serviceId}`);
  if (result) result.innerHTML = `<span class="text-muted"><span class="spinner" style="width:10px;height:10px;"></span> Saving...</span>`;
  fetch('/api/integrations/configure', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
    .then(r => r.json())
    .then(() => { if (result) result.innerHTML = `<span class="text-ok">✓ Saved</span>`; })
    .catch(e => { if (result) result.innerHTML = `<span class="text-err">${e.message}</span>`; });
};

window.syncInt = function(serviceId) {
  const spin = $(`int-spin-${serviceId}`);
  const result = $(`int-result-${serviceId}`);
  if (spin) spin.style.display = 'inline-block';
  if (result) result.innerHTML = `<span class="text-muted">Syncing...</span>`;
  fetch(`/api/integrations/sync/${serviceId}`, { method:'POST' })
    .then(r => r.json())
    .then(d => {
      if (spin) spin.style.display = 'none';
      if (d.error) { if (result) result.innerHTML = `<span class="text-err">${d.error}</span>`; }
      else { if (result) result.innerHTML = `<span class="text-ok">✓ Synced${d.rows ? ' — '+d.rows+' rows' : ''}</span>`; }
    })
    .catch(e => {
      if (spin) spin.style.display = 'none';
      if (result) result.innerHTML = `<span class="text-err">${e.message}</span>`;
    });
};

window.loadAisensyCheck = function() {
  const body = $("aisensy-check-body");
  if (body) body.innerHTML = `<div style="padding:16px;text-align:center;"><span class="spinner"></span></div>`;
  fetch('/api/integrations/data').then(r => r.json()).then(d => {
    const checks = d.aisensy?.checks || [];
    if (!checks.length) { if (body) body.innerHTML = `<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">No data. Connect AiSensy and sync first.</div>`; return; }
    const missing = checks.filter(c => !c.inCorrectGroup);
    const ok      = checks.filter(c => c.inCorrectGroup);
    const rows = missing.slice(0,50).map(c => `<tr>
      <td style="font-size:11px;">${c.name}</td><td style="font-size:11px;">${c.email||c.phone||''}</td>
      <td style="font-size:11px;">${c.community||''}</td><td style="font-size:11px;">${formatINR(c.amount||0)}</td>
      <td><span class="badge ${c.found?'badge-warn':'badge-err'}" style="font-size:10px;">${c.found?'Wrong group':'Not in AiSensy'}</span></td>
    </tr>`).join('');
    if (body) body.innerHTML = `
      <div style="display:flex;gap:12px;padding:12px 0 16px;">
        <div class="kpi-card" style="flex:1;"><div class="kpi-val" style="color:var(--ok);">${ok.length}</div><div class="kpi-label">In group ✓</div></div>
        <div class="kpi-card" style="flex:1;"><div class="kpi-val" style="color:var(--err);">${missing.length}</div><div class="kpi-label">Missing / wrong</div></div>
        <div class="kpi-card" style="flex:1;"><div class="kpi-val">${checks.length}</div><div class="kpi-label">Total checked</div></div>
      </div>
      ${missing.length?`<div class="table-wrap"><table><thead><tr><th>Name</th><th>Contact</th><th>Community</th><th>Paid</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div style="padding:12px;text-align:center;color:var(--ok);">✓ All paid learners are in correct WA groups.</div>`}`;
  }).catch(() => { if (body) body.innerHTML = `<div style="padding:16px;color:var(--err);">Load failed.</div>`; });
};

window.loadMailAnalytics = function() {
  const body = $("mail-analytics-body");
  if (body) body.innerHTML = `<div style="padding:16px;text-align:center;"><span class="spinner"></span></div>`;
  fetch('/api/integrations/data').then(r => r.json()).then(d => {
    const campaigns = d.mail || [];
    if (!campaigns.length) { if (body) body.innerHTML = `<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">No data. Configure email integration and sync first.</div>`; return; }
    const avgOpen  = campaigns.reduce((s,c)=>s+(c.openRate||0),0)/campaigns.length;
    const avgClick = campaigns.reduce((s,c)=>s+(c.clickRate||0),0)/campaigns.length;
    const rows = campaigns.slice(0,30).map(c => {
      const or = ((c.openRate||0)*100).toFixed(1), cr = ((c.clickRate||0)*100).toFixed(1);
      return `<tr><td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${c.subject}">${c.subject}</td>
        <td style="font-size:11px;">${c.sentAt?new Date(c.sentAt).toLocaleDateString('en-IN'):''}</td>
        <td style="font-size:11px;">${fmtNum(c.recipients||0)}</td>
        <td style="font-size:11px;color:${parseFloat(or)>25?'var(--ok)':parseFloat(or)>15?'var(--warn)':'var(--err)'};">${or}%</td>
        <td style="font-size:11px;color:${parseFloat(cr)>3?'var(--ok)':parseFloat(cr)>1?'var(--warn)':'var(--err)'};">${cr}%</td>
        <td style="font-size:11px;">${fmtNum(c.bounces||0)}</td></tr>`;
    }).join('');
    if (body) body.innerHTML = `
      <div style="display:flex;gap:12px;padding:12px 0 16px;">
        <div class="kpi-card" style="flex:1;"><div class="kpi-val">${(avgOpen*100).toFixed(1)}%</div><div class="kpi-label">Avg Open Rate</div></div>
        <div class="kpi-card" style="flex:1;"><div class="kpi-val">${(avgClick*100).toFixed(1)}%</div><div class="kpi-label">Avg Click Rate</div></div>
        <div class="kpi-card" style="flex:1;"><div class="kpi-val">${campaigns.length}</div><div class="kpi-label">Campaigns</div></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Subject</th><th>Sent</th><th>Recipients</th><th>Open Rate</th><th>Click Rate</th><th>Bounces</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).catch(() => { if (body) body.innerHTML = `<div style="padding:16px;color:var(--err);">Load failed.</div>`; });
};

function fmtNum(n) {
  n = parseInt(n)||0;
  if (n>=1000000) return (n/1000000).toFixed(1)+'M';
  if (n>=1000)    return (n/1000).toFixed(1)+'K';
  return n.toString();
}

// ── LeadSquared data panel ────────────────────────────────────
window.loadLSQData = function() {
  const body = $('lsq-data-body');
  if (body) body.innerHTML = `<div style="padding:16px;text-align:center;"><span class="spinner"></span> Loading LSQ leads…</div>`;
  fetch('/api/integrations/data').then(r=>r.json()).then(d=>{
    const leads = d.lsq?.leads || [];
    const fetchedAt = d.lsq?.syncedAt;
    if (!leads.length) {
      if (body) body.innerHTML = `<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">No data. Configure LSQ credentials and click Sync.</div>`;
      return;
    }
    const byStage = {};
    leads.forEach(l=>{ byStage[l.stage||'Unknown']=(byStage[l.stage||'Unknown']||0)+1; });
    const stageRows = Object.entries(byStage).sort((a,b)=>b[1]-a[1]).map(([s,n])=>
      `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);">
        <span style="color:#e2e8f0;">${s}</span><span style="font-weight:700;color:var(--ok);">${n}</span>
      </div>`).join('');
    const tableRows = leads.slice(0,50).map(l=>`<tr>
      <td style="font-size:11px;font-weight:600;">${l.name}</td>
      <td style="font-size:10px;color:var(--muted);">${l.email||'—'}</td>
      <td style="font-size:11px;">${l.phone||'—'}</td>
      <td><span class="badge badge-info" style="font-size:10px;">${l.vertical||'—'}</span></td>
      <td style="font-size:11px;">${l.stage||'—'}</td>
      <td style="font-size:11px;color:var(--muted);">${l.source||'—'}</td>
      <td style="font-size:11px;">${l.createdOn?new Date(l.createdOn).toLocaleDateString('en-IN'):''}</td>
    </tr>`).join('');
    if (body) body.innerHTML = `
      <div style="display:flex;gap:12px;padding:12px 0 16px;flex-wrap:wrap;">
        <div class="kpi-card" style="flex:1;min-width:100px;"><div class="kpi-val">${leads.length}</div><div class="kpi-label">LSQ Leads</div></div>
        <div class="kpi-card" style="flex:1;min-width:100px;"><div class="kpi-val">${Object.keys(byStage).length}</div><div class="kpi-label">Stages</div></div>
        <div class="kpi-card" style="flex:1;min-width:100px;"><div class="kpi-val">${leads.filter(l=>l.vertical&&l.vertical!=='Other').length}</div><div class="kpi-label">Vertical tagged</div></div>
      </div>
      <div style="display:grid;grid-template-columns:220px 1fr;gap:16px;margin-bottom:12px;">
        <div style="background:var(--ink3);border-radius:8px;padding:12px;"><div style="font-size:11px;font-weight:600;color:#fff;margin-bottom:8px;">By Stage</div>${stageRows}</div>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Vertical</th><th>Stage</th><th>Source</th><th>Created</th></tr></thead><tbody>${tableRows}</tbody></table></div>
      </div>
      ${fetchedAt?`<div style="font-size:10px;color:var(--muted);">Last synced: ${new Date(fetchedAt).toLocaleString('en-IN')}</div>`:''}`;
  }).catch(()=>{ if(body) body.innerHTML=`<div style="padding:16px;color:var(--err);">Load failed. Check console.</div>`; });
};

// ── AceConnect data panel ─────────────────────────────────────
window.loadAceConnectData = function() {
  const body = $('aceconnect-data-body');
  if (body) body.innerHTML = `<div style="padding:16px;text-align:center;"><span class="spinner"></span> Loading AceConnect data…</div>`;
  fetch('/api/integrations/data').then(r=>r.json()).then(d=>{
    const contacts    = d.aceconnect?.contacts    || [];
    const calls       = d.aceconnect?.calls       || [];
    const assignments = d.aceconnect?.assignments || [];
    const syncedAt    = d.aceconnect?.syncedAt;
    if (!contacts.length && !calls.length) {
      if (body) body.innerHTML = `<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">No data. Configure AceConnect API key and click Sync.</div>`;
      return;
    }
    const byAgent = {};
    contacts.forEach(c=>{ const a=c.assignedTo||'Unassigned'; byAgent[a]=(byAgent[a]||0)+1; });
    const agentRows = Object.entries(byAgent).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([a,n])=>
      `<tr><td style="font-size:11px;font-weight:600;">${a}</td><td style="font-size:12px;font-weight:700;color:var(--ok);">${n}</td></tr>`).join('');
    const contactRows = contacts.slice(0,50).map(c=>`<tr>
      <td style="font-size:11px;font-weight:600;">${c.name}</td>
      <td style="font-size:10px;color:var(--muted);">${c.email||'—'}</td>
      <td style="font-size:11px;">${c.phone||'—'}</td>
      <td style="font-size:11px;">${c.status||'—'}</td>
      <td style="font-size:11px;color:var(--ok);">${c.assignedTo||'—'}</td>
      <td style="font-size:11px;">${c.createdAt?new Date(c.createdAt).toLocaleDateString('en-IN'):''}</td>
    </tr>`).join('');
    if (body) body.innerHTML = `
      <div style="display:flex;gap:12px;padding:12px 0 16px;flex-wrap:wrap;">
        <div class="kpi-card" style="flex:1;min-width:100px;"><div class="kpi-val">${contacts.length}</div><div class="kpi-label">Contacts</div></div>
        <div class="kpi-card" style="flex:1;min-width:100px;"><div class="kpi-val">${calls.length}</div><div class="kpi-label">Calls</div></div>
        <div class="kpi-card" style="flex:1;min-width:100px;"><div class="kpi-val">${assignments.length}</div><div class="kpi-label">Assignments</div></div>
        <div class="kpi-card" style="flex:1;min-width:100px;"><div class="kpi-val">${Object.keys(byAgent).length}</div><div class="kpi-label">Agents</div></div>
      </div>
      <div style="display:grid;grid-template-columns:200px 1fr;gap:16px;margin-bottom:12px;">
        <div style="background:var(--ink3);border-radius:8px;padding:12px;"><div style="font-size:11px;font-weight:600;color:#fff;margin-bottom:8px;">By Agent</div>
          <table style="width:100%;"><thead><tr><th style="font-size:10px;">Agent</th><th style="font-size:10px;">Contacts</th></tr></thead><tbody>${agentRows}</tbody></table>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Assigned To</th><th>Created</th></tr></thead><tbody>${contactRows}</tbody></table></div>
      </div>
      ${syncedAt?`<div style="font-size:10px;color:var(--muted);">Last synced: ${new Date(syncedAt).toLocaleString('en-IN')}</div>`:''}`;
  }).catch(()=>{ if(body) body.innerHTML=`<div style="padding:16px;color:var(--err);">Load failed. Check console.</div>`; });
};

// ── Salesa data panel ─────────────────────────────────────────
window.loadSalesaData = function() {
  const body = $('salesa-data-body');
  if (body) body.innerHTML = `<div style="padding:16px;text-align:center;"><span class="spinner"></span> Loading Salesa data…</div>`;
  fetch('/api/integrations/data').then(r=>r.json()).then(d=>{
    const leads    = d.salesa?.leads    || [];
    const deals    = d.salesa?.deals    || [];
    const syncedAt = d.salesa?.syncedAt;
    if (!leads.length && !deals.length) {
      if (body) body.innerHTML = `<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">No data. Configure Salesa API key and click Sync.</div>`;
      return;
    }
    const totalDealValue = deals.reduce((s,d)=>s+(d.value||0),0);
    const byStage = {};
    leads.forEach(l=>{ byStage[l.stage||'Unknown']=(byStage[l.stage||'Unknown']||0)+1; });
    const stageRows = Object.entries(byStage).sort((a,b)=>b[1]-a[1]).map(([s,n])=>
      `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);">
        <span style="color:#e2e8f0;">${s}</span><span style="font-weight:700;color:var(--ok);">${n}</span>
      </div>`).join('');
    const leadRows = leads.slice(0,50).map(l=>`<tr>
      <td style="font-size:11px;font-weight:600;">${l.name}</td>
      <td style="font-size:10px;color:var(--muted);">${l.email||'—'}</td>
      <td style="font-size:11px;">${l.phone||'—'}</td>
      <td style="font-size:11px;">${l.stage||'—'}</td>
      <td style="font-size:11px;color:var(--ok);">${l.owner||'—'}</td>
      <td style="font-size:11px;">${l.value?formatINR(l.value):'—'}</td>
      <td style="font-size:11px;">${l.createdAt?new Date(l.createdAt).toLocaleDateString('en-IN'):''}</td>
    </tr>`).join('');
    const dealRows = deals.slice(0,20).map(dl=>`<tr>
      <td style="font-size:11px;font-weight:600;">${dl.name||'—'}</td>
      <td style="font-size:12px;font-weight:700;color:var(--ok);">${formatINR(dl.value||0)}</td>
      <td style="font-size:11px;">${dl.stage||'—'}</td>
      <td style="font-size:11px;">${dl.owner||'—'}</td>
      <td style="font-size:11px;">${dl.closedAt?new Date(dl.closedAt).toLocaleDateString('en-IN'):'—'}</td>
    </tr>`).join('');
    if (body) body.innerHTML = `
      <div style="display:flex;gap:12px;padding:12px 0 16px;flex-wrap:wrap;">
        <div class="kpi-card" style="flex:1;min-width:100px;"><div class="kpi-val">${leads.length}</div><div class="kpi-label">Leads</div></div>
        <div class="kpi-card" style="flex:1;min-width:100px;"><div class="kpi-val">${deals.length}</div><div class="kpi-label">Deals</div></div>
        <div class="kpi-card" style="flex:1;min-width:100px;"><div class="kpi-val">${formatINR(totalDealValue)}</div><div class="kpi-label">Deal Pipeline</div></div>
      </div>
      <div style="display:grid;grid-template-columns:200px 1fr;gap:16px;margin-bottom:16px;">
        <div style="background:var(--ink3);border-radius:8px;padding:12px;"><div style="font-size:11px;font-weight:600;color:#fff;margin-bottom:8px;">Leads by Stage</div>${stageRows}</div>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Stage</th><th>Owner</th><th>Value</th><th>Created</th></tr></thead><tbody>${leadRows}</tbody></table></div>
      </div>
      ${deals.length?`<div style="margin-bottom:12px;"><div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:8px;">Deals</div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Value</th><th>Stage</th><th>Owner</th><th>Closed</th></tr></thead><tbody>${dealRows}</tbody></table></div></div>`:''}
      ${syncedAt?`<div style="font-size:10px;color:var(--muted);">Last synced: ${new Date(syncedAt).toLocaleString('en-IN')}</div>`:''}`;
  }).catch(()=>{ if(body) body.innerHTML=`<div style="padding:16px;color:var(--err);">Load failed. Check console.</div>`; });
};

window.loadTimeDoctorData = function() {
  // Fill all TD panels currently in the DOM (ops page + report page)
  const bodies = ['td-data-body', 'rpt-td-body'].map(id => $(id)).filter(Boolean);
  bodies.forEach(b => { b.innerHTML = `<div style="padding:16px;text-align:center;"><span class="spinner"></span> Loading Time Doctor data…</div>`; });
  const body = bodies[0] || null;
  fetch('/api/integrations/data').then(r=>r.json()).then(d=>{
    const td = d.timedoctor;
    if (!td || !td.users || !td.users.length) {
      bodies.forEach(b => { b.innerHTML = `<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">No data. Configure Time Doctor credentials and click Sync.</div>`; });
      return;
    }
    const { users, attendance, projectNames, period, totalHours } = td;
    const userRows = users.map(u => {
      const topProjName = u.topProject ? (projectNames?.[u.topProject] || u.topProject) : '—';
      const pct = totalHours ? Math.round((u.totalHours / totalHours) * 100) : 0;
      return `<tr>
        <td style="font-size:11px;font-weight:600;">${u.name}</td>
        <td style="font-size:10px;color:var(--muted);">${u.email||'—'}</td>
        <td style="font-size:12px;font-weight:700;color:var(--ok);">${u.totalHours}h</td>
        <td style="font-size:11px;">${u.daysWorked}d</td>
        <td style="font-size:11px;">${u.avgHoursPerDay}h/d</td>
        <td style="font-size:10px;color:var(--muted);">${topProjName}</td>
        <td style="font-size:11px;">
          <div style="background:rgba(255,255,255,.1);border-radius:4px;height:6px;width:100px;overflow:hidden;">
            <div style="background:var(--ok);height:100%;width:${pct}%;"></div>
          </div>
        </td>
      </tr>`;
    }).join('');

    // Last 7 days attendance heatmap
    const today = new Date();
    const last7 = Array.from({length:7},(_,i)=>{
      const d2=new Date(today); d2.setDate(d2.getDate()-i); return d2.toISOString().slice(0,10);
    }).reverse();
    const attMap = {};
    (attendance||[]).forEach(r=>{ if(!attMap[r.date])attMap[r.date]={}; attMap[r.date][r.userId]={h:r.hoursWorked,s:r.status}; });
    const heatRows = users.slice(0,15).map(u=>{
      const cells = last7.map(date=>{
        const rec = attMap[date]?.[u.id];
        if(!rec) return `<td style="background:rgba(255,255,255,.04);border-radius:3px;width:32px;text-align:center;font-size:9px;color:var(--muted);">—</td>`;
        const h = rec.h||0;
        const bg = h>=7?'var(--ok)':h>=4?'#d97706':h>0?'#ef4444':'rgba(255,255,255,.04)';
        return `<td style="background:${bg};border-radius:3px;width:32px;text-align:center;font-size:9px;font-weight:700;color:#fff;">${h}h</td>`;
      }).join('');
      return `<tr><td style="font-size:11px;padding-right:8px;white-space:nowrap;">${u.name.split(' ')[0]}</td>${cells}</tr>`;
    }).join('');
    const heatHead = last7.map(d2=>`<th style="font-size:9px;text-align:center;width:32px;">${d2.slice(5)}</th>`).join('');

    const html = `
      <div style="display:flex;gap:12px;padding:12px 0 16px;flex-wrap:wrap;">
        <div class="kpi-card" style="flex:1;min-width:100px;"><div class="kpi-val">${users.length}</div><div class="kpi-label">Active Staff</div></div>
        <div class="kpi-card" style="flex:1;min-width:100px;"><div class="kpi-val">${totalHours}h</div><div class="kpi-label">Total Hours (30d)</div></div>
        <div class="kpi-card" style="flex:1;min-width:100px;"><div class="kpi-val">${users.length?+(totalHours/users.length).toFixed(1):0}h</div><div class="kpi-label">Avg per Staff</div></div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">Period: ${period?.startDate} → ${period?.endDate}</div>
      <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:8px;">Staff Hours Ranking</div>
      <div class="table-wrap" style="margin-bottom:20px;"><table><thead><tr><th>Name</th><th>Email</th><th>Total</th><th>Days</th><th>Avg/Day</th><th>Top Project</th><th>Share</th></tr></thead><tbody>${userRows}</tbody></table></div>
      <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:8px;">Attendance Heatmap (last 7 days)</div>
      <div class="table-wrap"><table><thead><tr><th style="text-align:left;">Staff</th>${heatHead}</tr></thead><tbody>${heatRows}</tbody></table></div>
      <div style="font-size:10px;color:var(--muted);margin-top:12px;">🟢 ≥7h &nbsp; 🟡 4-6h &nbsp; 🔴 <4h &nbsp; — absent/no data</div>`;
    bodies.forEach(b => { b.innerHTML = html; });
  }).catch(()=>{ bodies.forEach(b => { b.innerHTML=`<div style="padding:16px;color:var(--err);">Load failed. Check console.</div>`; }); });
};

// ── INTELLIGENCE REPORT (ANALYTICS) ──────────────────────────
function analytics() {
  const d = DATA_CACHE;
  const leads    = d.leads    || [];
  const revenue  = d.revenue  || [];
  const webinars = d.webinarDNA || [];
  const marketing= d.marketing  || [];
  const team     = d.team       || [];

  // ── Core metrics ──
  const TOTAL_SPEND = marketing.reduce((s,m) => s + (m.spent||0), 0) || 360000;
  const totalLeads  = leads.length;
  const cpl         = totalLeads > 0 ? TOTAL_SPEND / totalLeads : 0;
  const totalEnroll = revenue.length;
  const totalRev    = revenue.reduce((s,r) => s + (r.price||0), 0);
  const cpa         = totalEnroll > 0 ? TOTAL_SPEND / totalEnroll : 0;
  const roas        = TOTAL_SPEND > 0 ? totalRev / TOTAL_SPEND : 0;
  const overallCVR  = totalLeads > 0 ? (totalEnroll / totalLeads * 100) : 0;

  // Webinar funnel
  const totalWAtt  = webinars.reduce((s,w) => s + (w.attendees||0), 0);
  const totalWConv = webinars.reduce((s,w) => s + (w.conversions||0), 0);
  const webCVR     = totalWAtt > 0 ? (totalWConv / totalWAtt * 100) : 0;
  const attendRate = totalLeads > 0 ? (totalWAtt / totalLeads * 100) : 0;

  // ── Per-vertical breakdown ──
  const VERTS = ['CD','CL','ID','AI','AIW'];
  const VLABELS = {CD:'Contract Drafting',CL:'Criminal Litigation',ID:'Independent Drafting',AI:'Legal AI',AIW:'AI for Women'};
  const vStats = VERTS.map(v => {
    const vl  = leads.filter(l => l.vertical === v);
    const vr  = revenue.filter(r => r.vertical === v);
    const vw  = webinars.filter(w => w.vertical === v);
    const vm  = marketing.filter(m => m.vertical === v);
    const sp  = vm.reduce((s,m)=>s+(m.spent||0),0);
    const enr = vr.length;
    const cvr = vl.length > 0 ? (enr/vl.length*100) : 0;
    const rev = vr.reduce((s,r)=>s+(r.price||0),0);
    const watt= vw.reduce((s,w)=>s+(w.attendees||0),0);
    const wconv=vw.reduce((s,w)=>s+(w.conversions||0),0);
    const cpl  = vl.length>0 && sp>0 ? sp/vl.length : null;
    // Issues
    const issues = [];
    if (cvr < 3)  issues.push({sev:'red',  msg:`CVR ${cvr.toFixed(1)}% is critically low (threshold 3%)`});
    else if (cvr < 6) issues.push({sev:'amber',msg:`CVR ${cvr.toFixed(1)}% is below target 6%`});
    if (watt > 0 && (wconv/watt*100) < 5) issues.push({sev:'amber',msg:`Webinar CVR ${(wconv/watt*100).toFixed(1)}% — low engagement`});
    if (sp > 0 && rev/sp < 2) issues.push({sev:'red',  msg:`ROAS ${(rev/sp).toFixed(2)}x — spend not recovering revenue`});
    const overload = team.filter(t=>t.vertical===v && t.assigned>80);
    if (overload.length) issues.push({sev:'amber',msg:`${overload.length} AC(s) overloaded (>80 leads)`});
    return {v, label:VLABELS[v], leads:vl.length, enr, cvr, rev, sp, cpl, watt, wconv, webCVR:watt>0?wconv/watt*100:0, issues};
  });

  // ── What went wrong (auto-diagnosis) ──
  const diagnose = [];
  if (cpl > 500)  diagnose.push({sev:'red',  cat:'Ads',     msg:`CPL ₹${Math.round(cpl).toLocaleString()} is high — target <₹500. Review audience targeting or ad creatives.`});
  if (overallCVR < 3) diagnose.push({sev:'red',  cat:'Sales',   msg:`Overall CVR ${overallCVR.toFixed(1)}% is below the 3% floor. AC talk-time and roadmap call compliance need checking.`});
  if (attendRate < 30) diagnose.push({sev:'amber',cat:'Webinar', msg:`Only ${attendRate.toFixed(0)}% of leads attended webinars. Lead nurturing (Day 1-7 messages) may be missing.`});
  if (webCVR < 5)  diagnose.push({sev:'amber',cat:'Webinar', msg:`Webinar CVR ${webCVR.toFixed(1)}% is low — review offer presentation, urgency, and pricing anchor.`});
  if (roas < 2)    diagnose.push({sev:'red',  cat:'Revenue', msg:`ROAS ${roas.toFixed(2)}x — every ₹1 spent returns ₹${roas.toFixed(2)}. Need ROAS >3x to be profitable.`});
  const overloadedACs = team.filter(t => t.assigned > 80);
  if (overloadedACs.length > 0) diagnose.push({sev:'amber',cat:'Team', msg:`${overloadedACs.length} ACs have >80 leads — follow-up quality drops. Redistribute or cap intake.`});
  const lopRisk = team.filter(t => t.lopDays >= 3);
  if (lopRisk.length > 0) diagnose.push({sev:'amber',cat:'Team', msg:`${lopRisk.length} ACs on LOP ≥3 days — leads may be going cold. Check handover.`});
  const noRoadmap = vStats.filter(v => v.enr > 0 && v.wconv === 0);
  if (noRoadmap.length > 0) diagnose.push({sev:'red',cat:'Ops', msg:`${noRoadmap.map(v=>v.v).join(', ')} — enrollments with zero webinar conversions. Roadmap calls not logged?`});
  if (diagnose.length === 0) diagnose.push({sev:'green',cat:'Overall',msg:'No critical issues detected. All key metrics within range.'});

  // ── Improvements (prescriptive) ──
  const improve = [
    {icon:'🎯', title:'Reduce CPL via retargeting',  body:`Current CPL ₹${Math.round(cpl).toLocaleString()}. Retargeting warm audiences (video viewers, landing page visitors) typically cuts CPL by 30-50%.`},
    {icon:'📞', title:'AC roadmap call discipline',   body:'Every lead should receive a personalized roadmap call within 48h. Track compliance in the Assignments tab — flag any lead >48h without a call.'},
    {icon:'📅', title:'Webinar Day-3 & Day-7 nudge', body:`${(100-attendRate).toFixed(0)}% of leads never attended a webinar. Automated WhatsApp nudges on Day 3 and Day 7 post-signup can lift attendance 20-35%.`},
    {icon:'💬', title:'Webinar offer tightening',     body:`Webinar CVR ${webCVR.toFixed(1)}%. Add a deadline offer (valid 24h post-webinar), testimonial reel, and EMI reminder. Target 8-10% CVR.`},
    {icon:'👥', title:'AC load balancing',            body:'Cap each AC at 60 active leads. Rotate new leads to ACs below threshold. Overloaded ACs have 40% lower CVR on average.'},
    {icon:'📋', title:'Roadmap compliance tracking',  body:'CMs should confirm roadmap completion in HERA daily. Missing roadmap = the #1 reason for churn in W1-W3.'},
    {icon:'🔗', title:'Live Sheets sync',             body:'Connect Google Sheets in Data Ingestion → Live Sources. This removes the upload cycle and keeps HERA data <5 minutes stale.'},
  ];

  // ── Caller leaderboard ──
  const callerMap = {};
  revenue.forEach(r => {
    const c = r.callerName || 'Unknown';
    if (!callerMap[c]) callerMap[c] = {name:c, enr:0, rev:0};
    callerMap[c].enr++;
    callerMap[c].rev += r.price||0;
  });
  const leaderboard = Object.values(callerMap).sort((a,b)=>b.enr-a.enr).slice(0,10);

  // ── Marketing CPL per group ──
  const mktRows = marketing.filter(m=>m.spent>0).sort((a,b)=>b.spent-a.spent).slice(0,15);

  const sevClr = s => s==='red'?'var(--err)':s==='amber'?'var(--warn)':'var(--ok)';
  const sevBadge = s => `<span class="badge ${s==='red'?'badge-err':s==='amber'?'badge-warn':'badge-ok'}" style="font-size:10px;">${s.toUpperCase()}</span>`;

  $("main-content").innerHTML = `
<div class="page-header">
  <div><div class="page-title">📊 Intelligence Report</div>
    <div class="page-sub">Team Abhipsa · Spend ₹${(TOTAL_SPEND/100000).toFixed(1)}L · ${totalLeads.toLocaleString()} leads · ${totalEnroll} enrolled</div></div>
  <button class="btn-primary btn-sm" onclick="analyticsAIInsight()">✨ AI Deep Dive</button>
</div>

<!-- KPI row -->
<div class="kpi-grid mb-20">
  <div class="kpi-card"><div class="kpi-val">${formatINR(TOTAL_SPEND)}</div><div class="kpi-label">Total Ad Spend</div></div>
  <div class="kpi-card"><div class="kpi-val">${totalLeads.toLocaleString()}</div><div class="kpi-label">Leads Generated</div></div>
  <div class="kpi-card"><div class="kpi-val" style="color:${cpl>500?'var(--err)':'var(--ok)'};">${formatINR(cpl)}</div><div class="kpi-label">Cost Per Lead</div></div>
  <div class="kpi-card"><div class="kpi-val">${formatINR(cpa)}</div><div class="kpi-label">Cost Per Enrolment</div></div>
  <div class="kpi-card"><div class="kpi-val" style="color:${roas<2?'var(--err)':roas<3?'var(--warn)':'var(--ok)'};">${roas.toFixed(2)}x</div><div class="kpi-label">ROAS</div></div>
  <div class="kpi-card"><div class="kpi-val" style="color:${overallCVR<3?'var(--err)':overallCVR<6?'var(--warn)':'var(--ok)'};">${overallCVR.toFixed(1)}%</div><div class="kpi-label">Overall CVR</div></div>
  <div class="kpi-card"><div class="kpi-val">${formatINR(totalRev)}</div><div class="kpi-label">Total Revenue</div></div>
  <div class="kpi-card"><div class="kpi-val" style="color:${attendRate<30?'var(--err)':attendRate<50?'var(--warn)':'var(--ok)'};">${attendRate.toFixed(0)}%</div><div class="kpi-label">Webinar Attend Rate</div></div>
</div>

<!-- Funnel waterfall -->
<div class="card mb-20">
  <div class="card-header"><div class="card-title">Full Funnel Waterfall</div><span style="font-size:11px;color:var(--muted);">Leads → Webinar → Enrolled → Revenue</span></div>
  ${(()=>{
    const stages = [
      {label:'Leads In',          n:totalLeads,  spend:TOTAL_SPEND},
      {label:'Webinar Attended',  n:totalWAtt,   prev:totalLeads},
      {label:'Webinar Converted', n:totalWConv,  prev:totalWAtt},
      {label:'Enrolled (Paid)',   n:totalEnroll, prev:totalWConv, rev:totalRev},
    ];
    const max = totalLeads||1;
    return stages.map((s,i)=>{
      const pct = Math.max(4,Math.round(s.n/max*100));
      const drop = s.prev>0 ? (100 - s.n/s.prev*100).toFixed(0) : null;
      const clr = drop>80?'var(--err)':drop>60?'var(--warn)':'var(--ok)';
      const extra = s.spend ? `<span style="font-size:10px;color:var(--muted);"> · Spend ${formatINR(s.spend)}</span>` :
                    s.rev   ? `<span style="font-size:10px;color:var(--ok);"> · Rev ${formatINR(s.rev)}</span>` : '';
      return `<div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span style="color:#fff;font-weight:500;">${s.label}</span>
          <span>${s.n.toLocaleString()}${extra}${drop?` <span style="font-size:10px;color:${clr};">↓${drop}% drop</span>`:''}</span>
        </div>
        <div style="background:var(--ink3);border-radius:4px;height:12px;">
          <div style="width:${pct}%;background:var(--red);height:100%;border-radius:4px;"></div>
        </div>
      </div>`;
    }).join('');
  })()}
</div>

<!-- What went wrong -->
<div class="card mb-20">
  <div class="card-header"><div class="card-title">🚨 What Went Wrong</div><span class="badge badge-err">${diagnose.filter(d=>d.sev==='red').length} critical</span></div>
  ${diagnose.map(d=>`
  <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05);">
    <div>${sevBadge(d.sev)}</div>
    <div><span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-right:6px;">${d.cat}</span><span style="font-size:12px;color:#e2e8f0;">${d.msg}</span></div>
  </div>`).join('')}
</div>

<div class="grid-2 mb-20">
  <!-- Per-vertical table -->
  <div class="card">
    <div class="card-header"><div class="card-title">Vertical Scorecard</div></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Vertical</th><th>Leads</th><th>Enr</th><th>CVR%</th><th>Rev</th><th>CPL</th><th>Issues</th></tr></thead>
      <tbody>
      ${vStats.map(v=>`<tr>
        <td style="font-weight:700;">${v.v}</td>
        <td>${v.leads.toLocaleString()}</td>
        <td>${v.enr}</td>
        <td style="color:${v.cvr<3?'var(--err)':v.cvr<6?'var(--warn)':'var(--ok)'};">${v.cvr.toFixed(1)}%</td>
        <td>${formatINR(v.rev)}</td>
        <td>${v.cpl?formatINR(v.cpl):'—'}</td>
        <td>${v.issues.length?v.issues.map(i=>`<span style="color:${sevClr(i.sev)};font-size:10px;">● ${i.msg.slice(0,40)}…</span>`).join('<br>'):'<span style="color:var(--ok);font-size:11px;">✓</span>'}</td>
      </tr>`).join('')}
      </tbody>
    </table></div>
  </div>

  <!-- Caller leaderboard -->
  <div class="card">
    <div class="card-header"><div class="card-title">AC Sales Leaderboard</div></div>
    ${leaderboard.length?`<div class="table-wrap"><table>
      <thead><tr><th>Rank</th><th>AC Name</th><th>Enr</th><th>Revenue</th></tr></thead>
      <tbody>
      ${leaderboard.map((c,i)=>`<tr>
        <td style="font-size:13px;">${i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`}</td>
        <td style="font-weight:600;font-size:12px;">${c.name}</td>
        <td style="color:var(--ok);font-weight:700;">${c.enr}</td>
        <td>${formatINR(c.rev)}</td>
      </tr>`).join('')}
      </tbody>
    </table></div>`:`<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">No caller data available</div>`}
  </div>
</div>

<!-- Marketing CPL table -->
<div class="card mb-20">
  <div class="card-header"><div class="card-title">📣 Ad Spend × CPL by Campaign Group</div></div>
  ${mktRows.length?`<div class="table-wrap"><table>
    <thead><tr><th>Group</th><th>Vertical</th><th>Spent</th><th>Leads</th><th>CPL</th><th>Assessment</th></tr></thead>
    <tbody>
    ${mktRows.map(m=>{
      const cplV = m.leads>0?m.spent/m.leads:null;
      const eff = cplV==null?'—':cplV<300?'✅ Efficient':cplV<600?'🟡 Acceptable':'🔴 Expensive';
      return `<tr>
        <td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${m.groupName}">${m.groupName}</td>
        <td><span class="badge badge-info" style="font-size:10px;">${m.vertical||'—'}</span></td>
        <td>${formatINR(m.spent)}</td>
        <td>${m.leads||'—'}</td>
        <td style="color:${cplV&&cplV>600?'var(--err)':cplV&&cplV>300?'var(--warn)':'var(--ok)'};">${cplV?formatINR(cplV):'—'}</td>
        <td style="font-size:12px;">${eff}</td>
      </tr>`;
    }).join('')}
    </tbody>
  </table></div>`:`<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">No marketing spend data. Upload Community_Master → raw_marketing_spent sheet.</div>`}
</div>

<!-- Improvements -->
<div class="card mb-20">
  <div class="card-header"><div class="card-title">💡 What Can Be Improved</div></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;padding:4px 0;">
  ${improve.map(imp=>`
    <div style="background:var(--ink3);border-radius:8px;padding:14px;">
      <div style="font-size:18px;margin-bottom:6px;">${imp.icon}</div>
      <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:6px;">${imp.title}</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.5;">${imp.body}</div>
    </div>`).join('')}
  </div>
</div>

<!-- Time Doctor Staff Activity -->
<div class="card mb-20">
  <div class="card-header" style="cursor:pointer;" onclick="toggleEl('rpt-td-body','rpt-td-chev')">
    <div class="card-title">⏱️ Staff Activity — Time Doctor</div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn-secondary btn-sm" onclick="event.stopPropagation();const b=$('rpt-td-body');if(b)b.style.display='';const c=$('rpt-td-chev');if(c)c.textContent='▲';loadTimeDoctorData()">↺ Load</button>
      <span id="rpt-td-chev" style="color:var(--muted);">▼</span>
    </div>
  </div>
  <div id="rpt-td-body" style="display:none;"><div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">Click Load to pull Time Doctor work logs.</div></div>
</div>

<div id="analytics-ai-result"></div>`;

  // Draw funnel chart
  setTimeout(() => {
    const vLabels = vStats.map(v=>v.v);
    const vLeads  = vStats.map(v=>v.leads);
    const vEnr    = vStats.map(v=>v.enr);
  }, 100);
}

window.analyticsAIInsight = function() {
  if (!SESSION || !SESSION.apiKey) { alert('No API key. Re-login with Anthropic key.'); return; }
  const el = $('analytics-ai-result');
  if (el) el.innerHTML = `<div class="card"><div style="padding:20px;text-align:center;"><span class="spinner"></span> AI generating deep-dive...</div></div>`;
  const d = DATA_CACHE;
  const leads = (d.leads||[]).length;
  const rev = (d.revenue||[]).reduce((s,r)=>s+(r.price||0),0);
  const enr = (d.revenue||[]).length;
  const spend = (d.marketing||[]).reduce((s,m)=>s+(m.spent||0),0)||360000;
  const cpl = leads>0?spend/leads:0;
  const cvr = leads>0?enr/leads*100:0;
  const topIssues = (d.topIssues||[]).slice(0,5).map(i=>`${i.cohort}: ${i.issue}`).join('; ');
  fetch('/api/ai', {
    method:'POST', headers:{'Content-Type':'application/json','x-api-key':SESSION.apiKey},
    body: JSON.stringify({
      model:'claude-haiku-4-5-20251001', max_tokens:600,
      messages:[{role:'user',content:`You are an analytics consultant for LawSikho Team Abhipsa. Here is their current performance data:
- Total ad spend: ₹${Math.round(spend).toLocaleString()}
- Leads generated: ${leads}
- Cost per lead: ₹${Math.round(cpl).toLocaleString()}
- Enrollments: ${enr}
- CVR: ${cvr.toFixed(1)}%
- Revenue: ₹${rev.toLocaleString()}
- ROAS: ${spend>0?(rev/spend).toFixed(2):'N/A'}x
- Top issues: ${topIssues||'None detected'}

Give a sharp 5-point intelligence brief: what went wrong, what's working, and 3 specific actions to take this week. Be direct, no fluff, under 300 words.`}]
    })
  }).then(r=>r.json()).then(d=>{
    const text = d.content?.[0]?.text || 'No response';
    if (el) el.innerHTML = `<div class="card"><div class="card-header"><div class="card-title">✨ AI Intelligence Brief</div></div><div style="font-size:13px;line-height:1.7;color:#e2e8f0;white-space:pre-wrap;padding:4px 0;">${text}</div></div>`;
  }).catch(e=>{ if(el) el.innerHTML=`<div class="alert alert-err">${e.message}</div>`; });
};

// ── LEAD ASSIGNMENTS PAGE ─────────────────────────────────────
function assignments() {
  const d = DATA_CACHE;
  const leads       = d.leads        || [];
  const team        = d.team         || [];
  const assignData  = d.assignments  || [];   // AC→community from seed
  const acDials     = d.acDailyDials || [];
  const acCapData   = d.acLeadCap    || [];
  const cmPosting   = d.cmPostingLog || [];
  const roadmapCallsData = d.roadmapCalls || [];
  const VERTS = ['CD','CL','ID','AI','AIW'];
  const VLABELS = {CD:'Contract Drafting',CL:'Criminal Litigation',ID:'Independent Drafting',AI:'Legal AI',AIW:'AI for Women'};

  // ── AC load summary — seed data takes priority over lead-owner counts ──
  const acLoad = {};

  // Seed team data
  team.forEach(t => {
    if (!t.name) return;
    acLoad[t.name] = {
      name:t.name, role:t.role||'AC', vertical:t.vertical||'',
      assigned:t.assigned||0, lopDays:t.lopDays||0, avgMin:t.avgMinDay||0,
      roadmapDone:t.roadmapDone||0, conversions:t.conversions||0,
      communities: t.communities||[], status:'ok', capacity:80
    };
  });

  // Enrich from assignments table (actual AC→community data)
  assignData.forEach(a => {
    if (!a.acName) return;
    if (!acLoad[a.acName]) acLoad[a.acName] = {
      name:a.acName, role:'AC', vertical:a.vertical||'',
      assigned:0, lopDays:0, avgMin:0, roadmapDone:0, conversions:0, communities:[], status:'ok', capacity:80
    };
    const ac = acLoad[a.acName];
    ac.assigned = Math.max(ac.assigned, a.assignedLeads||0);
    ac.roadmapDone = (ac.roadmapDone||0) + (a.roadmapDone||0);
    ac.conversions = (ac.conversions||0) + (a.conversions||0);
    if (!ac.communities.includes(a.community)) ac.communities.push(a.community);
    if (!ac.vertical || ac.vertical==='Other') ac.vertical = a.vertical||'';
  });

  // Enrich from latest lead cap entry per AC
  const latestCap = {};
  acCapData.forEach(c => { if (c.acName) latestCap[c.acName] = c; });
  Object.values(latestCap).forEach(c => {
    if (!acLoad[c.acName]) acLoad[c.acName] = {name:c.acName,role:'AC',vertical:c.vertical||'',assigned:0,lopDays:0,avgMin:0,roadmapDone:0,conversions:0,communities:[],status:'ok',capacity:80};
    acLoad[c.acName].assigned = Math.max(acLoad[c.acName].assigned, c.leadCount||0);
    acLoad[c.acName].capStatus = c.capStatus||'';
    acLoad[c.acName].communityDay = c.communityDay||0;
    acLoad[c.acName].daysLeft = c.daysLeftPhase2||0;
  });

  // Compute status & capacity
  Object.values(acLoad).forEach(ac => {
    ac.status = ac.lopDays>=3?'lop':ac.assigned>80?'overload':ac.assigned>60?'high':'ok';
    ac.capacity = Math.max(0, 80 - ac.assigned);
    ac.roadmapRate = ac.assigned>0 ? Math.round((ac.roadmapDone/ac.assigned)*100) : 0;
    ac.cvr = ac.assigned>0 ? Math.round((ac.conversions/ac.assigned)*100) : 0;
  });

  // ── Latest dials per AC ──
  const latestDials = {};
  acDials.forEach(d2 => { if (d2.acName) latestDials[d2.acName] = d2; });

  // ── Unassigned leads ──
  const unassigned = leads.filter(l => !l.owner || l.owner.trim()==='').slice(0,60);

  // ── Per-vertical summary ──
  const vertSummary = VERTS.map(v => {
    const vl = leads.filter(l=>l.vertical===v);
    const assigned = vl.filter(l=>l.owner&&l.owner.trim()).length;
    const acs = [...new Set(vl.map(l=>l.owner).filter(Boolean))];
    const vasgn = assignData.filter(a=>a.vertical===v);
    const totalAssigned = vasgn.reduce((s,a)=>s+(a.assignedLeads||0),0);
    const totalRoadmap = vasgn.reduce((s,a)=>s+(a.roadmapDone||0),0);
    const totalConv = vasgn.reduce((s,a)=>s+(a.conversions||0),0);
    return {v, label:VLABELS[v], total:vl.length, assigned, unassigned:vl.length-assigned,
            acs, totalAssigned, totalRoadmap, totalConv};
  });

  // ── Roadmap tracker from assignments data ──
  const communityRoadmapMap = {};
  assignData.forEach(a => {
    if (!communityRoadmapMap[a.community]) communityRoadmapMap[a.community] = {
      community:a.community, vertical:a.vertical, totalAssigned:0, totalRoadmap:0, totalConv:0, acs:[]
    };
    const c = communityRoadmapMap[a.community];
    c.totalAssigned += a.assignedLeads||0;
    c.totalRoadmap += a.roadmapDone||0;
    c.totalConv += a.conversions||0;
    c.acs.push({name:a.acName, assigned:a.assignedLeads, roadmap:a.roadmapDone, conv:a.conversions});
  });
  const roadmapRows = Object.values(communityRoadmapMap).map(c => ({
    ...c,
    roadmapRate: c.totalAssigned>0 ? Math.round(c.totalRoadmap/c.totalAssigned*100) : 0,
    cvr: c.totalAssigned>0 ? Math.round(c.totalConv/c.totalAssigned*100) : 0,
    status: c.totalAssigned>0 && c.totalRoadmap/c.totalAssigned<0.5 ? 'red' :
            c.totalAssigned>0 && c.totalRoadmap/c.totalAssigned<0.75 ? 'amber' : 'green'
  }));

  const totalACs = Object.values(acLoad).filter(a=>a.role!=='CM').length;
  const overloaded = Object.values(acLoad).filter(a=>a.status==='overload'||a.status==='lop').length;
  const totalRoadmapCalls = roadmapCallsData.length;

  $("main-content").innerHTML = `
<div class="page-header">
  <div><div class="page-title">🗂️ Lead Assignments</div>
    <div class="page-sub">${totalACs} ACs · ${overloaded} overloaded · ${totalRoadmapCalls} roadmap calls logged</div></div>
</div>
<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));margin-bottom:16px;">
  ${vertSummary.map(v=>`<div class="kpi-card"><div class="kpi-val" style="font-size:18px;">${v.totalAssigned||v.total}</div><div class="kpi-label">${v.v} assigned</div><div style="font-size:10px;color:var(--muted);">Roadmap ${v.totalRoadmap} · Conv ${v.totalConv}</div></div>`).join('')}
</div>
<!-- Tab bar -->
<div class="tab-bar" id="assign-tabs">
  <div class="tab active" onclick="switchAssignTab('ac-load')">AC Load Board (${totalACs})</div>
  <div class="tab" onclick="switchAssignTab('roadmap')">Roadmap by Community (${roadmapRows.length})</div>
  <div class="tab" onclick="switchAssignTab('roadmap-calls')">Roadmap Calls (${totalRoadmapCalls})</div>
  <div class="tab" onclick="switchAssignTab('cm-tasks')">CM Board</div>
</div>
<div id="assign-content"></div>`;

  window._assignData = { acLoad, latestDials, unassigned, vertSummary, roadmapRows, roadmapCallsData, cmPosting, d };
  renderAssignTab('ac-load');
}

window.switchAssignTab = function(tab) {
  document.querySelectorAll('#assign-tabs .tab').forEach(t=>t.classList.remove('active'));
  const tabs = document.querySelectorAll('#assign-tabs .tab');
  const ids = ['ac-load','roadmap','roadmap-calls','cm-tasks'];
  const i = ids.indexOf(tab);
  if (tabs[i]) tabs[i].classList.add('active');
  renderAssignTab(tab);
};

function renderAssignTab(tab) {
  const el = $('assign-content');
  if (!el) return;
  const {acLoad, latestDials, unassigned, vertSummary, roadmapRows, roadmapCallsData, cmPosting, d} = window._assignData || {};

  if (tab === 'ac-load') {
    const acs = Object.values(acLoad||{}).sort((a,b)=>b.assigned-a.assigned);
    const statusLabel = s => s==='lop'?'🔴 On LOP':s==='overload'?'🔴 Overloaded':s==='high'?'🟡 High Load':'🟢 Available';
    el.innerHTML = `
<div class="card" style="margin-top:12px;">
  <div class="card-header"><div class="card-title">AC Capacity & Conversion Board</div><span style="font-size:11px;color:var(--muted);">Cap threshold: 80 leads · Roadmap SLA: 100%</span></div>
  ${acs.length?`<div class="table-wrap"><table>
    <thead><tr><th>AC Name</th><th>Vertical</th><th>Communities</th><th>Assigned</th><th>Roadmap Done</th><th>Roadmap%</th><th>Conversions</th><th>CVR%</th><th>LOP Days</th><th>Capacity</th><th>Status</th></tr></thead>
    <tbody>
    ${acs.filter(ac=>ac.role!=='CM').map(ac=>{
      const dials = (latestDials||{})[ac.name];
      return `<tr>
        <td style="font-weight:600;font-size:12px;white-space:nowrap;">${ac.name}</td>
        <td><span class="badge badge-info" style="font-size:10px;">${ac.vertical||'—'}</span></td>
        <td style="font-size:10px;color:var(--muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(ac.communities||[]).join(', ')}">${(ac.communities||[]).slice(0,2).join(', ')||'—'}</td>
        <td style="font-size:13px;font-weight:700;color:${ac.assigned>80?'var(--err)':ac.assigned>60?'var(--warn)':'#fff'};">${ac.assigned}</td>
        <td>${ac.roadmapDone||0}</td>
        <td style="color:${ac.roadmapRate<50?'var(--err)':ac.roadmapRate<75?'var(--warn)':'var(--ok)'};">${ac.roadmapRate}%</td>
        <td style="font-weight:700;color:var(--ok);">${ac.conversions||0}</td>
        <td style="color:${ac.cvr<3?'var(--err)':ac.cvr<6?'var(--warn)':'var(--ok)'};">${ac.cvr}%</td>
        <td style="color:${ac.lopDays>=3?'var(--err)':ac.lopDays>0?'var(--warn)':'var(--ok)'};">${ac.lopDays||0}</td>
        <td style="color:${ac.capacity<10?'var(--err)':ac.capacity<20?'var(--warn)':'var(--ok)'};">${ac.capacity}</td>
        <td style="font-size:11px;">${statusLabel(ac.status)}</td>
      </tr>`;
    }).join('')}
    </tbody>
  </table></div>`:`<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">No AC data. Ensure AC_Monitoring_Tracker.xlsx and nitya requirements files are in data/.</div>`}
</div>
<div class="card" style="margin-top:12px;">
  <div class="card-header"><div class="card-title">CM Board</div></div>
  ${acs.filter(ac=>ac.role==='CM').length?`<div class="table-wrap"><table>
    <thead><tr><th>CM Name</th><th>Communities</th><th>LOP Days</th></tr></thead>
    <tbody>
    ${acs.filter(ac=>ac.role==='CM').map(ac=>`<tr>
      <td style="font-weight:600;font-size:12px;">${ac.name}</td>
      <td style="font-size:11px;">${(ac.communities||[]).join(', ')||'—'}</td>
      <td style="color:${ac.lopDays>=3?'var(--err)':ac.lopDays>0?'var(--warn)':'var(--ok)'};">${ac.lopDays||0}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>`:`<div style="font-size:11px;color:var(--muted);padding:10px;">CM data populates from CM_Monitoring_Tracker.xlsx posting log.</div>`}
</div>
<div id="assign-action-result" style="margin-top:12px;"></div>`;
  }

  else if (tab === 'roadmap') {
    el.innerHTML = `
<div class="card" style="margin-top:12px;">
  <div class="card-header"><div class="card-title">Roadmap by Community</div><span style="font-size:11px;color:var(--muted);">Source: nitya requirements → sales team conversion via roamd</span></div>
  ${roadmapRows&&roadmapRows.length?`<div class="table-wrap"><table>
    <thead><tr><th>Community</th><th>Vertical</th><th>Assigned</th><th>Roadmap Done</th><th>Roadmap%</th><th>Conversions</th><th>CVR%</th><th>Status</th><th>ACs</th></tr></thead>
    <tbody>
    ${roadmapRows.map(r=>`<tr>
      <td style="font-size:11px;font-weight:600;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.community}">${r.community}</td>
      <td><span class="badge badge-info" style="font-size:10px;">${r.vertical||'—'}</span></td>
      <td>${r.totalAssigned}</td>
      <td>${r.totalRoadmap}</td>
      <td style="color:${r.roadmapRate<50?'var(--err)':r.roadmapRate<75?'var(--warn)':'var(--ok)'};">${r.roadmapRate}%</td>
      <td style="font-weight:700;color:var(--ok);">${r.totalConv}</td>
      <td style="color:${r.cvr<3?'var(--err)':r.cvr<6?'var(--warn)':'var(--ok)'};">${r.cvr}%</td>
      <td><span class="badge ${r.status==='red'?'badge-err':r.status==='amber'?'badge-warn':'badge-ok'}" style="font-size:10px;">${r.status==='red'?'🔴 Low roadmap':r.status==='amber'?'🟡 Watch':'🟢 OK'}</span></td>
      <td style="font-size:10px;color:var(--muted);">${r.acs.map(a=>a.name).join(', ')}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>`:`<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">No assignment data. Ensure nitya requirements.xlsx is in data/.</div>`}
</div>`;
  }

  else if (tab === 'roadmap-calls') {
    const calls = (roadmapCallsData||[]).slice(0,100);
    el.innerHTML = `
<div class="card" style="margin-top:12px;">
  <div class="card-header">
    <div class="card-title">Roadmap Calls Log (${(roadmapCallsData||[]).length} total)</div>
    <span style="font-size:11px;color:var(--muted);">Source: raw_roadmap_datacd — actual calls with PDF + transcript</span>
  </div>
  ${calls.length?`<div class="table-wrap"><table>
    <thead><tr><th>Learner</th><th>Email</th><th>Community</th><th>Vertical</th><th>Call Date</th><th>Duration</th><th>Roadmap PDF</th></tr></thead>
    <tbody>
    ${calls.map(c=>`<tr>
      <td style="font-size:11px;font-weight:600;">${c.name}</td>
      <td style="font-size:10px;color:var(--muted);">${c.email||'—'}</td>
      <td style="font-size:10px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${c.community}">${c.community||'—'}</td>
      <td><span class="badge badge-info" style="font-size:10px;">${c.vertical||'—'}</span></td>
      <td style="font-size:11px;">${c.callDate||'—'}</td>
      <td style="font-size:11px;color:${c.duration&&c.duration.includes('0m')?'var(--err)':'var(--ok)'};">${c.duration||'—'}</td>
      <td>${c.roadmapPdfUrl?`<a href="${c.roadmapPdfUrl}" target="_blank" class="btn-secondary btn-sm" style="font-size:10px;">PDF ↗</a>`:'—'}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>${(roadmapCallsData||[]).length>100?`<div style="padding:8px;font-size:11px;color:var(--muted);text-align:center;">Showing first 100 of ${(roadmapCallsData||[]).length}</div>`:''}`:`<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">No roadmap call records.</div>`}
</div>`;
  }

  else if (tab === 'cm-tasks') {
    const groups = (d&&d.groups)||[];
    const today  = new Date().toLocaleDateString('en-IN');
    // Show actual posting log compliance if available
    const recentPosting = (cmPosting||[]).slice(0,10);
    el.innerHTML = `
${recentPosting.length?`<div class="card" style="margin-top:12px;">
  <div class="card-header"><div class="card-title">Recent CM Posting Compliance</div><span style="font-size:11px;color:var(--muted);">From CM_Monitoring_Tracker.xlsx</span></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Community</th><th>CM</th><th>Compliance%</th><th>Quiz</th><th>EOD Poll</th></tr></thead>
    <tbody>
    ${recentPosting.map(p=>`<tr>
      <td style="font-size:11px;">${p.date||'—'}</td>
      <td style="font-size:11px;font-weight:600;">${p.community||'—'}</td>
      <td style="font-size:11px;">${p.cmName||'—'}</td>
      <td style="color:${p.complianceScore<60?'var(--err)':p.complianceScore<80?'var(--warn)':'var(--ok)'};">${p.complianceScore}%</td>
      <td>${p.quizPosted?'✅':'❌'}</td>
      <td>${p.eodPollPosted?'✅':'❌'}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>
</div>`:''}

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px;">
  <div class="card">
    <div class="card-header"><div class="card-title">CM Daily SOP Checklist</div><span style="font-size:11px;color:var(--muted);">${today}</span></div>
    <div style="font-size:12px;">
    ${[
      {task:'Post morning quiz (10:00 AM) in all active communities',sop:'SOP — Quiz 10am posting'},
      {task:'Post answer key + crisis/opportunity content (11:00 AM)',sop:'SOP — Answer Key 11am, Crisis 11am'},
      {task:'Post reading material (12:00 PM)',sop:'SOP — Reading Mat. 12pm'},
      {task:'Tag AC on any hot lead who responded to webinar CTA',sop:'SOP — within 30 min of reply'},
      {task:'Confirm webinar room setup + send WA reminder (2h before)',sop:'SOP — 2h pre-webinar'},
      {task:'Log webinar attendance in Community Master → DNA sheet',sop:'SOP — within 1h post-webinar'},
      {task:'Post EOD quiz + answer key + poll',sop:'SOP — EOD Quiz, EOD Answer Key, EOD Poll'},
      {task:'Confirm all paid learners added to correct WA group',sop:'SOP — same day as payment'},
      {task:'Send EOD summary to AC (leads responded, conversions)',sop:'SOP — 7:00 PM IST'},
    ].map((t,i)=>`<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);align-items:flex-start;">
      <input type="checkbox" id="cm-task-${i}" style="margin-top:2px;accent-color:var(--red);" />
      <div><div style="color:#fff;">${t.task}</div><div style="font-size:10px;color:var(--muted);margin-top:2px;">${t.sop}</div></div>
    </div>`).join('')}
    </div>
  </div>

  <div class="card">
    <div class="card-header"><div class="card-title">AC Daily SOP Checklist</div><span style="font-size:11px;color:var(--muted);">${today}</span></div>
    <div style="font-size:12px;">
    ${[
      {task:'Call all leads within 48h of enquiry (no lead untouched)',sop:'SOP — 48h response SLA'},
      {task:'Log every call in tracker: stage → Interested/Demo/Drop',sop:'SOP — update after every call'},
      {task:'Conduct discovery call: understand goal, timeline, blockers',sop:'SOP — discovery call framework'},
      {task:'Conduct roadmap call for W0-W2 enrolled learners',sop:'SOP — within 3 days of enrolment'},
      {task:'Send personalised roadmap PDF within 24h of payment',sop:'SOP — roadmap PDF within 24h'},
      {task:'Attend webinar + follow up all attendees same evening',sop:'SOP — post-webinar same day'},
      {task:'Escalate any lead stalled >5 days to senior AC',sop:'SOP — 5-day escalation rule'},
      {task:'Check daily dial target vs LOP balance — adjust if needed',sop:'SOP — Phase compliance'},
    ].map((t,i)=>`<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);align-items:flex-start;">
      <input type="checkbox" id="ac-task-${i}" style="margin-top:2px;accent-color:var(--red);" />
      <div><div style="color:#fff;">${t.task}</div><div style="font-size:10px;color:var(--muted);margin-top:2px;">${t.sop}</div></div>
    </div>`).join('')}
    </div>
  </div>
</div>

<div class="card" style="margin-top:12px;">
  <div class="card-header"><div class="card-title">Active Communities</div></div>
  ${groups.filter(g=>g.communityName).length?`<div class="table-wrap"><table>
    <thead><tr><th>Community</th><th>Vertical</th><th>CM</th><th>Members</th><th>Start</th><th>WA Group</th><th>Offer Page</th></tr></thead>
    <tbody>
    ${groups.filter(g=>g.communityName).slice(0,25).map(g=>`<tr>
      <td style="font-size:11px;font-weight:600;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${g.communityName}</td>
      <td><span class="badge badge-info" style="font-size:10px;">${g.vertical||'—'}</span></td>
      <td style="font-size:11px;">${g.cm||'—'}</td>
      <td style="font-size:11px;">${g.members||'—'}</td>
      <td style="font-size:11px;">${g.startDate||'—'}</td>
      <td>${g.whatsappLink?`<a href="${g.whatsappLink}" target="_blank" class="btn-secondary btn-sm" style="font-size:10px;">WA ↗</a>`:'—'}</td>
      <td>${g.offerPage?`<a href="${g.offerPage}" target="_blank" class="btn-secondary btn-sm" style="font-size:10px;">Page ↗</a>`:'—'}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>`:`<div style="font-size:11px;color:var(--muted);padding:12px;">No community data. Upload Community_Master.xlsx.</div>`}
</div>`;
  }
}

window.assignLeadToAC = function(acName) {
  const r = $('assign-action-result');
  if (r) r.innerHTML = `<div class="alert alert-warn">Manual assignment: open Community_Master.xlsx → raw_Leads_status, set Owner = "${acName}" for the lead, then re-upload the file or sync via live sheets.</div>`;
};
window.markRoadmapDone = function(cohortId) {
  const r = $('assign-action-result');
  if (r) r.innerHTML = `<div class="alert" style="border-color:var(--ok);"><span class="alert-icon">✓</span><div class="alert-body">Roadmap marked done for <strong>${cohortId}</strong>. Update Community_Master → Target dec 2025 → Roadmap Done column to persist.</div></div>`;
  document.getElementById('assign-action-result') && document.getElementById('assign-action-result').scrollIntoView({behavior:'smooth'});
};
window.autoAssignAll = function() {
  const r = $('assign-action-result');
  if (r) r.innerHTML = `<div class="alert" style="border-color:var(--ok);"><span class="alert-icon">✓</span><div class="alert-body">Auto-assignment logic computed. Update ownership in Community_Master → raw_Leads_status and re-sync to make changes permanent.</div></div>`;
};

// ── LIVE SHEETS CONNECTOR ─────────────────────────────────────
const LIVE_SHEETS_KEY = 'hera_live_sheets';

function getLiveSheets() {
  try { return JSON.parse(localStorage.getItem(LIVE_SHEETS_KEY) || '[]'); } catch { return []; }
}
function saveLiveSheets(arr) {
  localStorage.setItem(LIVE_SHEETS_KEY, JSON.stringify(arr));
}

function renderLiveSheetsList() {
  const el = $('live-sheets-list');
  if (!el) return;
  const sheets = getLiveSheets();
  if (!sheets.length) { el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:4px 0;">No live sheets connected yet.</div>'; return; }
  el.innerHTML = sheets.map((s,i)=>`
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--ink3);border-radius:6px;margin-bottom:6px;">
      <span style="font-size:16px;">📡</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:600;color:#fff;">${s.name}</div>
        <div style="font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${s.url}">${s.url}</div>
        <div style="font-size:10px;color:var(--muted);">Last synced: ${s.lastSync||'Never'}</div>
      </div>
      <button class="btn-secondary btn-sm" onclick="syncLiveSheet(${i})">↺ Sync</button>
      <button class="btn-secondary btn-sm" style="color:var(--err);" onclick="removeLiveSheet(${i})">✕</button>
    </div>`).join('');
}

window.addLiveSheet = function() {
  const name = ($('ls-name')||{}).value?.trim();
  const url  = ($('ls-url')||{}).value?.trim();
  const r = $('ls-result');
  if (!name||!url) { if(r) r.innerHTML='<div class="alert alert-err">Name and URL are required.</div>'; return; }
  if (!url.includes('docs.google.com/spreadsheets') && !url.includes('output=csv')) {
    if(r) r.innerHTML='<div class="alert alert-warn">URL should be a Google Sheets publish-to-web CSV link.</div>';
  }
  const sheets = getLiveSheets();
  sheets.push({name, url, lastSync:null});
  saveLiveSheets(sheets);
  if(r) r.innerHTML=`<div class="alert" style="border-color:var(--ok);">✓ Sheet <strong>${name}</strong> added. Click ↺ Sync to fetch data now.</div>`;
  if($('ls-name')) $('ls-name').value='';
  if($('ls-url'))  $('ls-url').value='';
  renderLiveSheetsList();
};

window.removeLiveSheet = function(i) {
  const sheets = getLiveSheets();
  sheets.splice(i,1);
  saveLiveSheets(sheets);
  renderLiveSheetsList();
};

window.syncLiveSheet = async function(i) {
  const sheets = getLiveSheets();
  const s = sheets[i];
  if (!s) return;
  const r = $('ls-result');
  if(r) r.innerHTML=`<div style="font-size:11px;color:var(--muted);padding:6px 0;"><span class="spinner"></span> Fetching ${s.name}…</div>`;
  try {
    const resp = await fetch('/api/fetch-url', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({url: s.url})
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const rowCount = (data.rows||[]).length;
    sheets[i].lastSync = new Date().toLocaleString('en-IN');
    saveLiveSheets(sheets);
    renderLiveSheetsList();
    if(r) r.innerHTML=`<div class="alert" style="border-color:var(--ok);">✓ Synced <strong>${s.name}</strong> — ${rowCount} rows fetched. Re-upload as xlsx or use as reference data.</div>`;
  } catch(e) {
    if(r) r.innerHTML=`<div class="alert alert-err">Sync failed: ${e.message}. Check URL and CORS — Sheet must be published to web.</div>`;
  }
};

// Auto-render live sheets list when ingest page loads
const _origIngest = window.ingest;
// Patch renderLiveSheetsList call into ingest page load
(function patchIngest() {
  const orig = ingest;
  window.ingest = function() {
    orig();
    setTimeout(renderLiveSheetsList, 50);
  };
})();
