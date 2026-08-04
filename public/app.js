// ── AUTH ─────────────────────────────────────────────────────
const USERS = {
  abhipsa: { pass: 'hera2025', role: 'full', landing: 'command', label: 'Abhipsa' },
  nitya:   { pass: 'hera2025', role: 'full', landing: 'verticals', label: 'Nitya' },
  data:    { pass: 'hera2025', role: 'ops',  landing: 'pipeline',  label: 'Data Team' }
};

const NAV_ITEMS = [
  { id: 'command',  icon: '⚡', label: 'Command Centre', roles: ['full'] },
  { id: 'verticals',icon: '🏢', label: 'Verticals',      roles: ['full'] },
  { id: 'webinars', icon: '🎯', label: 'Webinar Intel',  roles: ['full'] },
  { id: 'revenue',  icon: '💰', label: 'Revenue & Sales',roles: ['full'] },
  { id: 'pipeline', icon: '📊', label: 'Lead Pipeline',  roles: ['full', 'ops'] },
  { id: 'marketing',icon: '📣', label: 'Marketing Funnel',roles: ['full'] },
  { id: 'team',     icon: '👥', label: 'Team Health',    roles: ['full', 'ops'] },
  { id: 'ops',      icon: '🔧', label: 'Community Ops',  roles: ['full', 'ops'] },
  { id: 'ask',      icon: '🤖', label: 'Ask HERA',       roles: ['full', 'ops'] }
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
    .then(d => { DATA_CACHE = d; cb(); })
    .catch(e => {
      $("main-content").innerHTML = `<div class="alert alert-err"><span class="alert-icon">⚠</span><div class="alert-body"><strong>Data load failed:</strong> ${e.message}</div></div>`;
    });
}

function renderPage(pageId) {
  const pages = { command, verticals, webinars, revenue, pipeline, marketing, team, ops, ask };
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
