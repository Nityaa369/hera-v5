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

    shared = []
    if "xl/sharedStrings.xml" in zf.namelist():
        tree = ET.parse(zf.open("xl/sharedStrings.xml"))
        for si in tree.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
            t_els = si.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
            shared.append("".join(t.text or "" for t in t_els))

    wb_tree = ET.parse(zf.open("xl/workbook.xml"))
    wb_ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    sheets = {}
    for sh in wb_tree.iter(wb_ns + "sheet"):
        rid = sh.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        sheets[sh.get("name")] = rid

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
        try: return float(v)
        except: return v

    result = {}
    for sheet_name, rid in sheets.items():
        spath = rid_to_path.get(rid)
        if not spath or spath not in zf.namelist():
            continue
        ws_tree = ET.parse(zf.open(spath))

        rows_raw = {}
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
    if "CONTRACT" in s or "DRAFTING" in s or "/CD" in s or "CD-" in s: return "CD"
    if "CRIMINAL" in s or "LITIGATION" in s or "/CL" in s or "CL-" in s: return "CL"
    if "INDEPENDENT" in s or "/ ID" in s or "/ID" in s or "ID-" in s or s.strip() == "ID": return "ID"
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

def parse_sheet_raw(path, sheet_name):
    """Return list of {col_idx: value} for every row, preserving row structure."""
    try:
        zf = zipfile.ZipFile(path)
    except: return []
    shared = []
    if "xl/sharedStrings.xml" in zf.namelist():
        tree = ET.parse(zf.open("xl/sharedStrings.xml"))
        for si in tree.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
            t_els = si.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
            shared.append("".join(t.text or "" for t in t_els))
    wb_tree = ET.parse(zf.open("xl/workbook.xml"))
    wb_ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    sheets = {}
    for sh in wb_tree.iter(wb_ns + "sheet"):
        rid = sh.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        sheets[sh.get("name")] = rid
    rels_path = "xl/_rels/workbook.xml.rels"
    rid_to_path = {}
    if rels_path in zf.namelist():
        rtree = ET.parse(zf.open(rels_path))
        for rel in rtree.iter("{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"):
            rid_to_path[rel.get("Id")] = "xl/" + rel.get("Target").lstrip("/")
    NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    rid = sheets.get(sheet_name)
    if not rid: return []
    spath = rid_to_path.get(rid)
    if not spath or spath not in zf.namelist(): return []
    ws_tree = ET.parse(zf.open(spath))
    result = []
    for row_el in ws_tree.iter(NS + "row"):
        cells = {}
        for c_el in row_el.iter(NS + "c"):
            ref = c_el.get("r", "")
            m = re.match(r"([A-Za-z]+)", ref)
            if not m: continue
            col_s = m.group(1)
            idx = 0
            for ch in col_s.upper():
                idx = idx * 26 + (ord(ch) - ord('A') + 1)
            col_i = idx - 1
            v_el = c_el.find(NS + "v")
            if v_el is None: cells[col_i] = ""; continue
            v = v_el.text or ""
            t = c_el.get("t", "")
            if t == "s":
                try: cells[col_i] = shared[int(v)]
                except: cells[col_i] = v
            else:
                try: cells[col_i] = float(v)
                except: cells[col_i] = v
        if cells:
            result.append(cells)
    return result

def parse_monitoring_sheet(path, sheet_name, header_col_marker):
    """Parse a monitoring sheet where real headers start partway down.
    header_col_marker: a string that appears in the real header row (e.g. 'Date', 'AC Name')."""
    raw_rows = parse_sheet_raw(path, sheet_name)
    # Find header row: first row where any value matches marker
    header_row_idx = None
    for i, row in enumerate(raw_rows):
        for v in row.values():
            if str(v).strip() == header_col_marker:
                header_row_idx = i
                break
        if header_row_idx is not None: break
    if header_row_idx is None: return []
    header_row = raw_rows[header_row_idx]
    headers = {col_i: str(v).strip() for col_i, v in header_row.items() if str(v).strip()}
    result = []
    for row in raw_rows[header_row_idx+2:]:  # +2 to skip the "← Fill manually →" instruction row
        if not row: continue
        r = {hdr: row.get(col_i, "") for col_i, hdr in headers.items()}
        if any(v != "" and v != 0 for v in r.values()):
            result.append(r)
    return result

def excel_date_to_str(v):
    """Convert Excel serial date float to ISO date string."""
    if not v: return str_val(v)
    try:
        n = float(v)
        if n > 1000:  # likely an Excel date serial
            from datetime import date, timedelta
            d = date(1899, 12, 30) + timedelta(days=int(n))
            return d.isoformat()
    except: pass
    return str_val(v)

# ── OUTPUT ────────────────────────────────────────────────────────────────────
OUT = dict(
    seededAt=datetime.utcnow().isoformat() + "Z",
    leads=[], revenue=[], marketing=[], webinarDNA=[],
    groups=[], cohorts=[], team=[], lop=[], talktime=[],
    monthlySheets={},
    assignments=[],   # AC → community assignment + roadmap conversion data
    acDailyDials=[],  # daily dials per AC from AC_Monitoring_Tracker
    acLeadCap=[],     # lead cap status per AC
    cmPostingLog=[],  # CM daily posting compliance
    roadmapCalls=[],  # individual roadmap call records
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
    if "community master" in fn or "community_master" in fn or "master data" in fn:
        # Leads
        ls = find_sheet(wb, ["raw_leads_status","leads_status","leads status","raw_leads"])
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

        # Revenue — actual column names: Name, Course Paid date (serial), CALLER NAME,
        #   Course price / cp_updated(r.s) / First paid Amount, Final community name
        rs = find_sheet(wb, ["compiled_revenue","compiled revenue"])
        if rs:
            rows = wb[rs]
            rev_out = []
            for r in rows:
                name = str_val(r.get("Name",""))
                if not name or name.lower() in ("name","nan",""): continue
                # price: prefer cp_updated, then Course price, then First paid Amount
                price = safe_float(
                    r.get("cp_updated(r.s)") or
                    r.get("Course price") or
                    r.get("First paid Amount") or
                    r.get("Last Paid Amount") or
                    r.get("Paid Till date") or
                    r.get("Price") or
                    r.get("Amount") or 0
                )
                # caller: prefer Updated_caller name, then CALLER NAME
                caller = str_val(
                    r.get("Updated_caller name") or
                    r.get("CALLER NAME") or
                    r.get("Caller Name") or
                    r.get("Caller") or ""
                )
                community = str_val(r.get("Final community name") or r.get("Community Purchases") or r.get("Community",""))
                vertical = detect_vertical(community or r.get("Source","") or r.get("Course Enrolled",""))
                if price == 0 and not name: continue
                rev_out.append(dict(
                    name=name,
                    email=str_val(r.get("Email","")),
                    date=excel_date_to_str(r.get("Course Paid date") or r.get("Community paid date") or r.get("Paid Date","")),
                    community=community,
                    price=price,
                    callerName=caller,
                    enrollment=str_val(r.get("Enrollment","")),
                    mode=str_val(r.get("Mode of Payment L.T") or r.get("Mode of Payment","")),
                    vertical=vertical
                ))
            OUT["revenue"] = rev_out
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
                date=excel_date_to_str(r.get("Date","")),
                community=str_val(r.get("COMMUNITY NAME") or r.get("Community Name") or r.get("Community","")),
                topic=str_val(r.get("WEBINAR 1 TOPIC") or r.get("Topic","")),
                attendees=safe_float(r.get("TOTAL ATTENDEES") or r.get("Attendees") or r.get("Attendance",0)),
                conversions=safe_float(r.get("TOTAL CONVERSIONS") or r.get("Conversions") or r.get("Conversion",0)),
                leads=safe_float(r.get("TOTAL LEADS") or r.get("Leads",0)),
                recording=str_val(r.get("Webinar Recordings") or r.get("Recordings") or r.get("Recording","")),
                speaker=str_val(r.get("SPEAKER","")),
                status=str_val(r.get("STATUS Of webinar","")),
                offerPage=str_val(r.get("OFFER PAGE LINK","")),
                vertical=detect_vertical(r.get("COMMUNITY NAME") or r.get("Community Name") or r.get("Community",""))
            ) for r in rows if (r.get("COMMUNITY NAME") or r.get("Community Name") or r.get("Community"))]
            print(f"  Webinars: {len(OUT['webinarDNA'])}")

        # Cohorts (Target sheet)
        ts = find_sheet(wb, ["target dec 2025","target dec","target 2025","target"])
        if ts:
            cohort_map = {}
            for r in wb[ts]:
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
                        roadmapDone=0, w=[]
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
                startDate=excel_date_to_str(r.get("Batch Start Date(group start)") or r.get("Start Date","")),
                endDate=excel_date_to_str(r.get("Batch end date") or r.get("End Date","")),
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
                    date=excel_date_to_str(r.get("Course Paid Date") or r.get("Date","")),
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
        # LOP from LEAVE DATA RAW sheet — actual cols: Employee Name, Leave Types, From Date, To Date, Total Duration
        lop_sheet = find_sheet(wb, ["leave data raw","leave data","leave - records","lop","leave"])
        if lop_sheet:
            rows = wb[lop_sheet]
            lop_map = {}
            for r in rows:
                name = str_val(r.get("Employee Name") or r.get("Name",""))
                if not name or name.lower() in ("employee name","name",""): continue
                days = safe_float(r.get("Total Duration") or r.get("Total LOP days") or r.get("LOP Days",0))
                if name not in lop_map:
                    lop_map[name] = dict(name=name, lopDays=0, deficitMinutes=0)
                lop_map[name]["lopDays"] += days
            OUT["lop"] = list(lop_map.values())
            print(f"  LOP: {len(OUT['lop'])}")

        ts2 = find_sheet(wb, ["combined talktime","talktime","talk time"])
        if ts2:
            rows = wb[ts2]
            OUT["talktime"] = [dict(
                name=str_val(r.get("Name","")),
                dials=safe_float(r.get("Dials",0)),
                calls20min=safe_float(r.get("Calls>20min") or r.get("Quality Calls",0)),
                totalDuration=safe_float(r.get("Total Duration") or r.get("Total Minutes",0))
            ) for r in rows if r.get("Name")]
            print(f"  Talktime: {len(OUT['talktime'])}")

    # ── AC Monitoring Tracker ─────────────────────────────────────────────────
    if "ac_monitoring" in fn or "ac monitoring" in fn:
        dials = parse_monitoring_sheet(fpath, "DAILY_DIALS", "Date")
        for r in dials:
            ac_name = str_val(r.get("AC Name",""))
            if not ac_name: continue
            OUT["acDailyDials"].append(dict(
                date=excel_date_to_str(r.get("Date","")),
                acName=ac_name,
                community=str_val(r.get("Community","")),
                vertical=str_val(r.get("Vertical","")),
                phase=str_val(r.get("Phase (1/2/3)","")),
                totalDials=safe_float(r.get("Total Dials",0)),
                activeMin=safe_float(r.get("Active Min",0)),
                totalMin=safe_float(r.get("Total Min",0)),
                discoveryCalls=safe_float(r.get("Discovery Calls",0)),
                roadmapCalls=safe_float(r.get("Roadmap Calls",0)),
            ))
        print(f"  AC Daily Dials: {len(OUT['acDailyDials'])}")

        caps = parse_monitoring_sheet(fpath, "LEAD_CAP", "Date")
        for r in caps:
            ac_name = str_val(r.get("AC Name",""))
            if not ac_name: continue
            OUT["acLeadCap"].append(dict(
                date=excel_date_to_str(r.get("Date","")),
                acName=ac_name,
                community=str_val(r.get("Community","")),
                vertical=str_val(r.get("Vertical","")),
                leadCount=safe_float(r.get("Lead Count",0)),
                phase2Active=str_val(r.get("Phase 2 Active","")),
                communityDay=safe_float(r.get("Community Day",0)),
                daysLeftPhase2=safe_float(r.get("Days Left In Phase 2",0)),
                capStatus=str_val(r.get("⚡ Cap Status","")),
                capAction=str_val(r.get("⚡ Cap Action","")),
            ))
        print(f"  AC Lead Cap: {len(OUT['acLeadCap'])}")

    # ── CM Monitoring Tracker ─────────────────────────────────────────────────
    if "cm_monitoring" in fn or "cm monitoring" in fn:
        postings = parse_monitoring_sheet(fpath, "POSTING_LOG", "Date")
        for r in postings:
            date_val = r.get("Date","")
            try: float(str(date_val))
            except: continue
            community = str_val(r.get("Community",""))
            if not community: continue
            compliance_vals = [str_val(r.get(k,"")) for k in [
                "Quiz 10am","Answer Key 11am","Crisis 11am","Opportunity 11am",
                "Reading Mat. 12pm","Discussion Active","EOD Quiz","EOD Answer Key","EOD Poll"]]
            done = sum(1 for v in compliance_vals if "✅" in v or "posted" in v.lower())
            total = len([v for v in compliance_vals if v])
            OUT["cmPostingLog"].append(dict(
                date=excel_date_to_str(date_val),
                community=community,
                cmName=str_val(r.get("CM Name","")),
                complianceScore=round(done/total*100) if total else 0,
                quizPosted="✅" in str_val(r.get("Quiz 10am","")),
                eodPollPosted="✅" in str_val(r.get("EOD Poll","")),
            ))
        print(f"  CM Posting Log: {len(OUT['cmPostingLog'])}")

    # ── nitya requirements — roadmap calls + assignments ──────────────────────
    if "nitya requirements" in fn or "nitya_requirements" in fn:
        # Roadmap calls (raw_roadmap_datacd)
        rs2 = find_sheet(wb, ["raw_roadmap_datacd","roadmap data","raw_roadmap"])
        if rs2:
            existing_emails = {c.get("email","") for c in OUT["roadmapCalls"]}
            for r in wb[rs2]:
                name = str_val(r.get("Name",""))
                email = str_val(r.get("Email",""))
                if not name or not email: continue
                if email in existing_emails: continue
                existing_emails.add(email)
                team = str_val(r.get("Team Name",""))
                OUT["roadmapCalls"].append(dict(
                    name=name,
                    email=email,
                    community=team,
                    vertical=detect_vertical(team),
                    callDate=excel_date_to_str(r.get("Call Date","")),
                    duration=str_val(r.get("Duration","")),
                    roadmapPdfUrl=str_val(r.get("Roadmap Pdf url","")),
                ))
            print(f"  Roadmap calls: {len(OUT['roadmapCalls'])}")

        # AC → community assignments (sales team conversion via roamd)
        as2 = find_sheet(wb, ["sales team conversion","sales team","assignment","assignments"])
        if as2 and not OUT["assignments"]:  # parse once (same data across all nitya files)
            rows = wb[as2]
            current_community = ""
            for r in rows:
                community_val = str_val(r.get("COMMUNITY","") or list(r.values())[0])
                if community_val and community_val.lower() not in ("community","nan",""):
                    current_community = community_val
                caller = str_val(r.get("Callers","") or (list(r.values())[1] if len(r)>1 else ""))
                if not caller or caller.lower() in ("callers","nan",""): continue
                assigned = safe_float(r.get("Assigned leads","") or (list(r.values())[2] if len(r)>2 else 0))
                roadmap = safe_float(r.get("Roadmap done","") or (list(r.values())[3] if len(r)>3 else 0))
                conversion = safe_float(r.get("Conversion","") or (list(r.values())[4] if len(r)>4 else 0))
                if not assigned: continue
                vertical = detect_vertical(current_community)
                OUT["assignments"].append(dict(
                    community=current_community,
                    vertical=vertical,
                    acName=caller,
                    assignedLeads=int(assigned),
                    roadmapDone=int(roadmap),
                    conversions=int(conversion),
                    roadmapRate=round(roadmap/assigned*100, 1) if assigned else 0,
                    cvr=round(conversion/assigned*100, 1) if assigned else 0,
                ))
            print(f"  Assignments: {len(OUT['assignments'])}")

    # ── Sales data / Leads enrolment / Interested leads ───────────────────────
    if "sales data" in fn or "leads enrolment" in fn or "interested leads" in fn:
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

# ── Build team from all sources ───────────────────────────────────────────────
team_map = {}

# From leads (ownership)
for l in OUT["leads"]:
    owner = l.get("owner","").strip()
    if not owner: continue
    if owner not in team_map:
        team_map[owner] = dict(name=owner, role="AC", assigned=0, vertical=l["vertical"],
                               lopDays=0, deficitMin=0, avgMinDay=0,
                               roadmapDone=0, conversions=0, communities=set())
    team_map[owner]["assigned"] += 1

# From assignments (richer AC data)
for a in OUT["assignments"]:
    name = a["acName"].strip()
    if not name: continue
    if name not in team_map:
        team_map[name] = dict(name=name, role="AC", assigned=0, vertical=a["vertical"],
                              lopDays=0, deficitMin=0, avgMinDay=0,
                              roadmapDone=0, conversions=0, communities=set())
    team_map[name]["assigned"] = max(team_map[name]["assigned"], a["assignedLeads"])
    team_map[name]["roadmapDone"] = team_map[name].get("roadmapDone",0) + a["roadmapDone"]
    team_map[name]["conversions"] = team_map[name].get("conversions",0) + a["conversions"]
    team_map[name]["communities"].add(a["community"])
    if not team_map[name]["vertical"] or team_map[name]["vertical"] == "Other":
        team_map[name]["vertical"] = a["vertical"]

# From AC daily dials (latest entry per AC)
for d in OUT["acDailyDials"]:
    name = d["acName"].strip()
    if not name: continue
    if name not in team_map:
        team_map[name] = dict(name=name, role="AC", assigned=0, vertical=d.get("vertical",""),
                              lopDays=0, deficitMin=0, avgMinDay=0,
                              roadmapDone=0, conversions=0, communities=set())
    team_map[name]["avgMinDay"] = max(team_map[name].get("avgMinDay",0), d.get("totalMin",0))

# From AC lead cap (latest per AC)
for c in OUT["acLeadCap"]:
    name = c["acName"].strip()
    if not name: continue
    if name not in team_map:
        team_map[name] = dict(name=name, role="AC", assigned=0, vertical=c.get("vertical",""),
                              lopDays=0, deficitMin=0, avgMinDay=0,
                              roadmapDone=0, conversions=0, communities=set())
    team_map[name]["assigned"] = max(team_map[name]["assigned"], int(c.get("leadCount",0)))
    team_map[name]["capStatus"] = c.get("capStatus","")

# From CM posting log (CMs)
cm_seen = set()
for p in OUT["cmPostingLog"]:
    name = p["cmName"].strip()
    community = p["community"]
    if not name: continue
    if name not in team_map:
        team_map[name] = dict(name=name, role="CM", assigned=0, vertical=detect_vertical(community),
                              lopDays=0, deficitMin=0, avgMinDay=0,
                              roadmapDone=0, conversions=0, communities=set())
    team_map[name]["role"] = "CM"
    team_map[name]["communities"].add(community)

# From LOP
for l in OUT["lop"]:
    name = l["name"].strip()
    if not name: continue
    if name not in team_map:
        team_map[name] = dict(name=name, role="AC", assigned=0, vertical="",
                              lopDays=0, deficitMin=0, avgMinDay=0,
                              roadmapDone=0, conversions=0, communities=set())
    team_map[name]["lopDays"] = l["lopDays"]
    team_map[name]["deficitMin"] = l.get("deficitMinutes",0)

# From talktime
for t in OUT["talktime"]:
    name = t["name"].strip()
    if not name: continue
    if name not in team_map:
        team_map[name] = dict(name=name, role="AC", assigned=0, vertical="",
                              lopDays=0, deficitMin=0, avgMinDay=0,
                              roadmapDone=0, conversions=0, communities=set())
    team_map[name]["avgMinDay"] = max(team_map[name].get("avgMinDay",0), t.get("totalDuration",0))

# Convert sets to lists for JSON
for m in team_map.values():
    if isinstance(m.get("communities"), set):
        m["communities"] = sorted(m["communities"])

OUT["team"] = list(team_map.values())

# ── Write output ──────────────────────────────────────────────────────────────
out_js = f"""// AUTO-GENERATED by seed.py — do not edit manually
// Seeded: {OUT['seededAt']}
// Leads: {len(OUT['leads'])} | Revenue: {len(OUT['revenue'])} | Webinars: {len(OUT['webinarDNA'])} | Cohorts: {len(OUT['cohorts'])}
// Assignments: {len(OUT['assignments'])} | AC Dials: {len(OUT['acDailyDials'])} | Roadmap Calls: {len(OUT['roadmapCalls'])}
window.STATIC_DATA = {json.dumps(OUT, ensure_ascii=False, indent=2)};
"""

with open(OUT_FILE, "w", encoding="utf-8") as f:
    f.write(out_js)

print(f"\n✓ Written to {OUT_FILE}")
print(f"  Leads:         {len(OUT['leads'])}")
print(f"  Revenue:       {len(OUT['revenue'])}")
print(f"  Marketing:     {len(OUT['marketing'])}")
print(f"  Webinars:      {len(OUT['webinarDNA'])}")
print(f"  Cohorts:       {len(OUT['cohorts'])}")
print(f"  Groups:        {len(OUT['groups'])}")
print(f"  Team:          {len(OUT['team'])}")
print(f"  Assignments:   {len(OUT['assignments'])}")
print(f"  AC Dials:      {len(OUT['acDailyDials'])}")
print(f"  AC Lead Cap:   {len(OUT['acLeadCap'])}")
print(f"  CM Posting:    {len(OUT['cmPostingLog'])}")
print(f"  Roadmap Calls: {len(OUT['roadmapCalls'])}")
print(f"  LOP:           {len(OUT['lop'])}")
print(f"  Talktime:      {len(OUT['talktime'])}")
