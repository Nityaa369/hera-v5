"""
seed.py — parse all xlsx files in ./data/ and write ./public/static-data.js
Run: python3 seed.py
No external packages required (uses stdlib zipfile + xml).
"""
import zipfile, json, re, os, sys
from xml.etree import ElementTree as ET
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
OUT_FILE = os.path.join(os.path.dirname(__file__), "public", "static-data.js")

# ── XLSX LOW-LEVEL PARSER ─────────────────────────────────────────────────────
def parse_xlsx(path):
    """Return dict of {sheet_name: [row_dict, ...]} for all sheets."""
    try:
        zf = zipfile.ZipFile(path)
    except Exception as e:
        print(f"  SKIP {path}: {e}"); return {}

    # shared strings
    shared = []
    if "xl/sharedStrings.xml" in zf.namelist():
        tree = ET.parse(zf.open("xl/sharedStrings.xml"))
        for si in tree.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
            t_els = si.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
            shared.append("".join(t.text or "" for t in t_els))

    # workbook → sheet names
    wb_tree = ET.parse(zf.open("xl/workbook.xml"))
    wb_ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    sheets = {}  # name → rId
    for sh in wb_tree.iter(wb_ns + "sheet"):
        rid = sh.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        sheets[sh.get("name")] = rid

    # workbook rels
    rels_path = "xl/_rels/workbook.xml.rels"
    rid_to_path = {}
    if rels_path in zf.namelist():
        rtree = ET.parse(zf.open(rels_path))
        for rel in rtree.iter("{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"):
            rid_to_path[rel.get("Id")] = "xl/" + rel.get("Target").lstrip("/")

    NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

    def col_letters_to_idx(col):
        idx = 0
        for ch in col.upper():
            idx = idx * 26 + (ord(ch) - ord('A') + 1)
        return idx - 1

    def cell_ref_to_col(ref):
        m = re.match(r"([A-Za-z]+)", ref)
        return col_letters_to_idx(m.group(1)) if m else 0

    def get_cell_value(cell_el, t_attr):
        v_el = cell_el.find(NS + "v")
        if v_el is None:
            return ""
        v = v_el.text or ""
        if t_attr == "s":
            try: return shared[int(v)]
            except: return v
        if t_attr in ("b",):
            return True if v == "1" else False
        # numeric / date / inlineStr
        try: return float(v)
        except: return v

    result = {}
    for sheet_name, rid in sheets.items():
        spath = rid_to_path.get(rid)
        if not spath or spath not in zf.namelist():
            continue
        ws_tree = ET.parse(zf.open(spath))

        rows_raw = {}
        header_row = None
        for row_el in ws_tree.iter(NS + "row"):
            r_idx = int(row_el.get("r", 0))
            cells = {}
            for c_el in row_el.iter(NS + "c"):
                ref = c_el.get("r", "")
                col_i = cell_ref_to_col(ref)
                t_attr = c_el.get("t", "")
                cells[col_i] = get_cell_value(c_el, t_attr)
            rows_raw[r_idx] = cells

        if not rows_raw:
            result[sheet_name] = []; continue

        first_r = min(rows_raw)
        header_cells = rows_raw[first_r]
        max_col = max(header_cells.keys()) if header_cells else 0
        headers = [str(header_cells.get(i, "")).strip() for i in range(max_col + 1)]
        # deduplicate blank headers
        seen = {}
        clean_headers = []
        for h in headers:
            if not h:
                h = f"__col{len(clean_headers)}"
            if h in seen:
                seen[h] += 1
                h = f"{h}_{seen[h]}"
            else:
                seen[h] = 0
            clean_headers.append(h)

        rows_out = []
        for r_idx in sorted(rows_raw):
            if r_idx == first_r: continue
            cells = rows_raw[r_idx]
            row = {}
            for i, hdr in enumerate(clean_headers):
                row[hdr] = cells.get(i, "")
            if any(v != "" and v != 0 for v in row.values()):
                rows_out.append(row)
        result[sheet_name] = rows_out

    return result

# ── HELPERS ───────────────────────────────────────────────────────────────────
def safe_float(v):
    try: return float(str(v).replace(",","").strip() or 0)
    except: return 0.0

def detect_vertical(s):
    s = str(s).upper()
    if "AI FOR WOMEN" in s or "AIW" in s or ("WOMEN" in s and "AI" in s): return "AIW"
    if "LEGAL AI" in s or ("AI" in s and "LEGAL" in s): return "AI"
    if "CONTRACT" in s or "DRAFTING" in s: return "CD"
    if "CRIMINAL" in s or "LITIGATION" in s: return "CL"
    if "INDEPENDENT" in s or "/ ID" in s or "/ID" in s or s.strip() == "ID": return "ID"
    return "Other"

def find_sheet(wb, keywords):
    for kw in keywords:
        for name in wb:
            if kw.lower() in name.lower():
                return name
    return list(wb.keys())[0] if wb else None

def str_val(v):
    if v is None: return ""
    return str(v).strip()

# ── OUTPUT ────────────────────────────────────────────────────────────────────
OUT = dict(
    seededAt=datetime.utcnow().isoformat() + "Z",
    leads=[], revenue=[], marketing=[], webinarDNA=[],
    groups=[], cohorts=[], team=[], lop=[], talktime=[],
    monthlySheets={}
)

files = sorted([f for f in os.listdir(DATA_DIR) if f.lower().endswith((".xlsx",".xls"))])
print(f"Found {len(files)} file(s):", files)

for fname in files:
    fpath = os.path.join(DATA_DIR, fname)
    fn = fname.lower()
    wb = parse_xlsx(fpath)
    if not wb:
        continue
    print(f"\nParsing: {fname} — {len(wb)} sheet(s): {list(wb.keys())[:6]}")

    # ── Community Master ───────────────────────────────────────────────────────
    if "community master" in fn or "community_master" in fn:
        # Leads
        ls = find_sheet(wb, ["raw_leads_status","leads_status","leads status","leads"])
        if ls:
            rows = wb[ls]
            OUT["leads"] = [dict(
                name=str_val(r.get("Customer Name") or r.get("Name","")),
                email=str_val(r.get("Email","")),
                stage=str_val(r.get("Stage","")),
                owner=str_val(r.get("Owner","")),
                vertical=detect_vertical(r.get("Items") or r.get("Community","")),
                date=str_val(r.get("Date",""))
            ) for r in rows if (r.get("Customer Name") or r.get("Name") or r.get("Email"))]
            print(f"  Leads: {len(OUT['leads'])}")

        # Revenue
        rs = find_sheet(wb, ["compiled_revenue","compiled revenue","revenue"])
        if rs:
            rows = wb[rs]
            OUT["revenue"] = [dict(
                name=str_val(r.get("Name","")),
                date=str_val(r.get("Course Paid Date") or r.get("Paid Date","")),
                community=str_val(r.get("Final community name") or r.get("Community","")),
                price=safe_float(r.get("Price") or r.get("Amount",0)),
                callerName=str_val(r.get("Caller Name") or r.get("Caller","")),
                mode=str_val(r.get("Mode of Payment","")),
                vertical=detect_vertical(r.get("Community") or r.get("Final community name",""))
            ) for r in rows if safe_float(r.get("Price") or r.get("Amount",0)) > 0 or r.get("Name")]
            print(f"  Revenue: {len(OUT['revenue'])}")

        # Marketing
        ms = find_sheet(wb, ["raw_marketing_spent","marketing_spent","marketing spent","marketing"])
        if ms:
            rows = wb[ms]
            OUT["marketing"] = [dict(
                groupName=str_val(r.get("Group Name ( As per wordpress)") or r.get("Common Group Name") or r.get("Group Name") or r.get("Group","")),
                spent=safe_float(r.get("Total spent with gst") or r.get("Total Spent (GST)") or r.get("Total Spent",0)),
                leads=safe_float(r.get("Leads_in_group") or r.get("Total Leads_Campaign") or r.get("Leads",0)),
                cpl=safe_float(r.get("Cpl_campaign") or r.get("CPL",0)),
                vertical=detect_vertical(r.get("Common Group Name") or r.get("Group Name ( As per wordpress)") or r.get("Group Name",""))
            ) for r in rows if safe_float(r.get("Total spent with gst") or r.get("Total Spent (GST)") or r.get("Total Spent",0)) > 0]
            print(f"  Marketing: {len(OUT['marketing'])}")

        # Webinar DNA
        ws2 = find_sheet(wb, ["webinar list","webinar dna","webinar"])
        if ws2:
            rows = wb[ws2]
            OUT["webinarDNA"] = [dict(
                date=str_val(r.get("Date","")),
                community=str_val(r.get("COMMUNITY NAME") or r.get("Community Name") or r.get("Community","")),
                topic=str_val(r.get("WEBINAR 1 TOPIC") or r.get("Topic","")),
                attendees=safe_float(r.get("TOTAL ATTENDEES") or r.get("Attendees") or r.get("Attendance",0)),
                conversions=safe_float(r.get("TOTAL CONVERSIONS") or r.get("Conversions") or r.get("Conversion",0)),
                leads=safe_float(r.get("TOTAL LEADS") or r.get("Leads",0)),
                recording=str_val(r.get("Webinar Recordings") or r.get("Recordings") or r.get("Recording","")),
                speaker=str_val(r.get("SPEAKER","")),
                status=str_val(r.get("STATUS Of webinar","")),
                vertical=detect_vertical(r.get("COMMUNITY NAME") or r.get("Community Name") or r.get("Community",""))
            ) for r in rows if (r.get("COMMUNITY NAME") or r.get("Community Name") or r.get("Community"))]
            print(f"  Webinars: {len(OUT['webinarDNA'])}")

        # Cohorts (Target sheet)
        ts = find_sheet(wb, ["target dec 2025","target dec","target 2025","target"])
        if ts:
            cohort_map = {}
            for r in wb[ts]:
                # real column: "Group Active Dec +Jan+Feb+march" or "Combined Group name"
                name = str_val(r.get("Combined Group name") or r.get("Group Active Dec +Jan+Feb+march") or r.get("Group name") or r.get("Group Name") or r.get("Community",""))
                if not name or name.lower() in ("nan","none",""): continue
                if name not in cohort_map:
                    leads = safe_float(r.get("Leads",0))
                    units = safe_float(r.get("Total Units done") or r.get("Units",0))
                    cohort_map[name] = dict(
                        id=name,
                        vertical=detect_vertical(r.get("Team","") or name),
                        leads=leads,
                        units=units,
                        pool=safe_float(r.get("Total Pool") or r.get("Pool",0)),
                        revenue=safe_float(r.get("Collected Revenue") or r.get("Revenue",0)),
                        roadmapDone=0,
                        w=[]
                    )
                    c = cohort_map[name]
                    c["cvr"] = (c["units"] / c["leads"] * 100) if c["leads"] > 0 else 0
                    for i in range(13):
                        v = safe_float(r.get(f"W{i}") or r.get(f"w{i}",0))
                        if v > 0:
                            while len(c["w"]) <= i: c["w"].append(0)
                            c["w"][i] = v
            OUT["cohorts"] = list(cohort_map.values())
            print(f"  Cohorts: {len(OUT['cohorts'])}")

        # Groups
        gs = find_sheet(wb, ["new-community details 2025","new-community details","community details","communities","active groups"])
        if gs:
            rows = wb[gs]
            OUT["groups"] = [dict(
                communityName=str_val(r.get("Community  Name") or r.get("Community Name") or r.get("Community","")),
                cm=str_val(r.get("Community-Manager") or r.get("CM","")),
                startDate=str_val(r.get("Batch Start Date(group start)") or r.get("Start Date","")),
                endDate=str_val(r.get("Batch end date") or r.get("End Date","")),
                members=safe_float(r.get("Group Member") or r.get("Members",0)),
                whatsappLink=str_val(r.get("Whatsapp Group Link") or r.get("WhatsApp Link") or r.get("WA Link","")),
                offerPage=str_val(r.get("Offer page links") or r.get("Offer Page","")),
                vertical=detect_vertical(r.get("Owner/Vertical","") or r.get("Community  Name","") or r.get("Community Name",""))
            ) for r in rows if (r.get("Community  Name") or r.get("Community Name") or r.get("Community"))]
            print(f"  Groups: {len(OUT['groups'])}")

        # Monthly sheets
        month_re = re.compile(r'^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[- _]?\d{4}$', re.I)
        for sname, rows in wb.items():
            if month_re.match(sname.strip()):
                data = [dict(
                    name=str_val(r.get("Name","")),
                    date=str_val(r.get("Course Paid Date") or r.get("Date","")),
                    community=str_val(r.get("Community","")),
                    price=safe_float(r.get("Price",0)),
                    callerName=str_val(r.get("Caller Name","")),
                    mode=str_val(r.get("Mode of Payment","")),
                    vertical=detect_vertical(r.get("Community",""))
                ) for r in rows if safe_float(r.get("Price",0)) > 0]
                OUT["monthlySheets"][sname] = data
                print(f"  Monthly {sname}: {len(data)} rows")

    # ── Counsellor LOP ────────────────────────────────────────────────────────
    if "counsellor" in fn and ("lop" in fn or "combined" in fn):
        ls = find_sheet(wb, ["lop","leave","may22"])
        if ls:
            rows = wb[ls]
            OUT["lop"] = [dict(
                name=str_val(r.get("Name","")),
                lopDays=safe_float(r.get("Total LOP days") or r.get("LOP Days",0)),
                deficitMinutes=safe_float(r.get("Deficit minutes") or r.get("Deficit Minutes",0))
            ) for r in rows if (r.get("Name"))]
            print(f"  LOP: {len(OUT['lop'])}")
        ts2 = find_sheet(wb, ["talktime","combined talktime","talk time"])
        if ts2:
            rows = wb[ts2]
            OUT["talktime"] = [dict(
                name=str_val(r.get("Name","")),
                dials=safe_float(r.get("Dials",0)),
                calls20min=safe_float(r.get("Calls>20min") or r.get("Quality Calls",0)),
                totalDuration=safe_float(r.get("Total Duration") or r.get("Total Minutes",0))
            ) for r in rows if r.get("Name")]
            print(f"  Talktime: {len(OUT['talktime'])}")

    # ── nitya requirements ────────────────────────────────────────────────────
    if "nitya requirements" in fn or "nitya_requirements" in fn:
        rs2 = find_sheet(wb, ["raw_roadmap_datacd","roadmap data","raw_roadmap","roadmap"])
        if rs2:
            existing_ids = {c["id"] for c in OUT["cohorts"]}
            for r in wb[rs2]:
                community = str_val(r.get("Community",""))
                if community and community not in existing_ids:
                    OUT["cohorts"].append(dict(
                        id=community,
                        vertical=detect_vertical(community),
                        leads=safe_float(r.get("Leads",0)),
                        units=safe_float(r.get("Units",0)),
                        pool=0, revenue=0, cvr=0, roadmapDone=0, w=[]
                    ))
                    existing_ids.add(community)
            print(f"  Cohorts after nitya merge: {len(OUT['cohorts'])}")

    # ── Sales data / Leads enrolment / Master data ─────────────────────────────
    if "sales data" in fn or "leads enrolment" in fn or "master data" in fn or "interested leads" in fn:
        first_sheet = list(wb.keys())[0]
        rows = wb[first_sheet]
        extra_leads = [dict(
            name=str_val(r.get("Customer Name") or r.get("Name") or r.get("Lead Name","")),
            email=str_val(r.get("Email") or r.get("email","")),
            stage=str_val(r.get("Stage") or r.get("Status","")),
            owner=str_val(r.get("Owner") or r.get("Caller Name") or r.get("Counsellor","")),
            vertical=detect_vertical(r.get("Items") or r.get("Community") or r.get("Program","")),
            date=str_val(r.get("Date") or r.get("Created Date",""))
        ) for r in rows if (r.get("Customer Name") or r.get("Name") or r.get("Lead Name"))]
        existing = {(l["name"], l["email"]) for l in OUT["leads"]}
        added = [l for l in extra_leads if (l["name"], l["email"]) not in existing]
        OUT["leads"].extend(added)
        print(f"  Extra leads from {fname}: {len(added)}")

    # ── AC/CM Monitoring ───────────────────────────────────────────────────────
    if "ac_monitoring" in fn or "cm_monitoring" in fn or "cm monitoring" in fn or "ac monitoring" in fn:
        for sname, rows in wb.items():
            for r in rows:
                community = str_val(r.get("Community Name") or r.get("Community",""))
                if not community: continue
                existing = next((c for c in OUT["cohorts"] if c["id"] == community), None)
                if not existing:
                    OUT["cohorts"].append(dict(
                        id=community,
                        vertical=detect_vertical(community),
                        leads=safe_float(r.get("Leads",0)),
                        units=0, pool=0, revenue=0, cvr=0, roadmapDone=0, w=[]
                    ))

# ── Build team ────────────────────────────────────────────────────────────────
team_map = {}
for l in OUT["leads"]:
    owner = l.get("owner","").strip()
    if not owner: continue
    if owner not in team_map:
        team_map[owner] = dict(name=owner, assigned=0, vertical=l["vertical"], lopDays=0, deficitMin=0, avgMinDay=0)
    team_map[owner]["assigned"] += 1
for l in OUT["lop"]:
    name = l["name"].strip()
    if name not in team_map:
        team_map[name] = dict(name=name, assigned=0, vertical="", lopDays=0, deficitMin=0, avgMinDay=0)
    team_map[name]["lopDays"] = l["lopDays"]
    team_map[name]["deficitMin"] = l["deficitMinutes"]
for t in OUT["talktime"]:
    name = t["name"].strip()
    if name not in team_map:
        team_map[name] = dict(name=name, assigned=0, vertical="", lopDays=0, deficitMin=0, avgMinDay=0)
    team_map[name]["avgMinDay"] = t["totalDuration"]
OUT["team"] = list(team_map.values())

# ── Write output ──────────────────────────────────────────────────────────────
out_js = f"""// AUTO-GENERATED by seed.py — do not edit manually
// Seeded: {OUT['seededAt']}
// Leads: {len(OUT['leads'])} | Revenue: {len(OUT['revenue'])} | Webinars: {len(OUT['webinarDNA'])} | Cohorts: {len(OUT['cohorts'])}
window.STATIC_DATA = {json.dumps(OUT, ensure_ascii=False, indent=2)};
"""

with open(OUT_FILE, "w", encoding="utf-8") as f:
    f.write(out_js)

print(f"\n✓ Written to {OUT_FILE}")
print(f"  Leads:      {len(OUT['leads'])}")
print(f"  Revenue:    {len(OUT['revenue'])}")
print(f"  Marketing:  {len(OUT['marketing'])}")
print(f"  Webinars:   {len(OUT['webinarDNA'])}")
print(f"  Cohorts:    {len(OUT['cohorts'])}")
print(f"  Groups:     {len(OUT['groups'])}")
print(f"  Team:       {len(OUT['team'])}")
print(f"  Monthly:    {len(OUT['monthlySheets'])}")
print(f"  LOP:        {len(OUT['lop'])}")
print(f"  Talktime:   {len(OUT['talktime'])}")
