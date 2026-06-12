#!/usr/bin/env python3
"""
build_costs.py (v2) — builds college-costs.json for the TES Ledger app.

Matching strategy (in order):
  1. exact     — normalized names are identical
  2. family    — campus/branch name resolves to its parent institution
                 (e.g. "STRAYER UNIVERSITY-WOODBRIDGE CAMPUS" -> Strayer University)
  3. fuzzy     — high-confidence similarity match (threshold 0.87)

v2 improvements over v1:
  - strips accents (MÉNDEZ -> MENDEZ) and apostrophes (KAPI'OLANI -> KAPIOLANI)
  - strips trailing ", THE" and generic tokens: DISTRICT / SYSTEM / AREA /
    MAIN / CAMPUS / ONLINE / INC / SUNY / "STATE UNIVERSITY OF NEW YORK"
  - family matching: progressively strips trailing dash-segments on both the
    TES name and IPEDS names, then resolves among same-family candidates by
    similarity; when the TES name had no campus suffix, prefers the largest
    institution (flagship assumption, via IPEDS INSTSIZE)
  - records how each match was made (matchQuality) for auditing

Usage:
  python build_costs.py [path/to/tes-data.json]

Outputs: college-costs.json, unmatched.txt, match-report.txt
Requires: Python 3.9+, stdlib only.
"""

import csv
import io
import json
import re
import sys
import time
import unicodedata
import urllib.request
import zipfile
from difflib import SequenceMatcher
from pathlib import Path

YEAR = 2023
HD_URL = f"https://nces.ed.gov/ipeds/datacenter/data/HD{YEAR}.zip"
IC_URL = f"https://nces.ed.gov/ipeds/datacenter/data/IC{YEAR}_AY.zip"
EF_URL = f"https://nces.ed.gov/ipeds/datacenter/data/EF{YEAR}A_DIST.zip"
FALLBACK_CREDITS_PER_YEAR = 24
FUZZY_THRESHOLD = 0.87

# ---------------------------------------------------------------- download

CACHE_DIR = Path("ipeds_cache")

def download_zip(url: str) -> bytes:
    """Download with retries; cache to disk so reruns never re-download.
    If NCES keeps refusing, the user can manually download the file in a
    browser and drop it into ipeds_cache/."""
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / url.split("/")[-1]

    if cache_file.exists() and zipfile.is_zipfile(cache_file):
        print(f"Using cached {cache_file}")
        return cache_file.read_bytes()

    last_data = b""
    for attempt in range(1, 4):
        print(f"Downloading {url} (attempt {attempt}/3) ...")
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Accept": "*/*",
            })
            with urllib.request.urlopen(req, timeout=180) as resp:
                last_data = resp.read()
        except Exception as e:
            print(f"  request failed: {e}")
            time.sleep(5 * attempt)
            continue
        if last_data[:4] == b"PK\x03\x04":
            cache_file.write_bytes(last_data)
            return last_data
        print(f"  server returned non-zip content ({len(last_data)} bytes, "
              f"starts with {last_data[:40]!r}) — retrying after a pause")
        time.sleep(5 * attempt)

    debug = CACHE_DIR / (cache_file.name + ".error.html")
    debug.write_bytes(last_data)
    sys.exit(
        f"\nNCES kept returning a non-zip response (saved to {debug} for inspection — "
        "it's usually a rate-limit or maintenance page).\n"
        f"Workaround: open {url} in your browser, save the file, "
        f"and place it at {cache_file}. Then rerun this script — it will use the cached copy."
    )

def fetch_zip_csv(url: str) -> list[dict]:
    data = download_zip(url)
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = sorted(zf.namelist(), key=lambda n: ("_rv" in n.lower(), n))
    csv_name = names[0]
    print(f"  -> reading {csv_name}")
    raw = zf.read(csv_name)
    if raw.startswith(b"\xef\xbb\xbf"):  # strip UTF-8 BOM (breaks first header)
        raw = raw[3:]
    text = io.StringIO(raw.decode("latin-1"))
    rows = []
    for row in csv.DictReader(text):
        rows.append({
            (k or "").replace("\ufeff", "").strip().upper(): (v or "").strip()
            for k, v in row.items()
        })
    return rows

def clean_id(v: str) -> str:
    """UNITID as digits only, so join keys can't disagree on formatting."""
    return re.sub(r"\D", "", v or "")

def num(row: dict, *cols):
    """First parseable positive number among candidate columns (money)."""
    for c in cols:
        v = row.get(c, "")
        if v in ("", ".", "0"):
            continue
        try:
            f = float(v)
            if f > 0:
                return f
        except ValueError:
            continue
    return None

def coord(row: dict, *cols):
    """Signed float — longitudes in the US are negative."""
    for c in cols:
        v = row.get(c, "")
        if v in ("", "."):
            continue
        try:
            return float(v)
        except ValueError:
            continue
    return None

# ---------------------------------------------------------------- normalize

# Tokens that carry no identity: legal/structural noise and campus qualifiers.
DROP_TOKENS = {
    "THE", "OF", "AT", "AND", "&", "INC",
    "DISTRICT", "SYSTEM", "AREA", "MAIN", "CAMPUS", "CAMPUSES", "ONLINE",
    "SUNY",
}

def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")

def normalize(name: str) -> str:
    n = strip_accents(name).upper()
    n = re.sub(r",\s*THE\s*$", "", n)               # "X COLLEGE, THE"
    n = n.replace("'", "").replace("\u2019", "")     # KAPI'OLANI -> KAPIOLANI
    n = re.sub(r"STATE UNIVERSITY OF NEW YORK", " ", n)
    n = re.sub(r"[^A-Z0-9 ]", " ", n)
    n = re.sub(r"\bCOMM\b", "COMMUNITY", n)
    n = re.sub(r"\bCOLL\b", "COLLEGE", n)
    n = re.sub(r"\bUNIV\b", "UNIVERSITY", n)
    n = re.sub(r"\bTECH\b", "TECHNICAL", n)
    n = re.sub(r"\bCMTY\b", "COMMUNITY", n)
    n = re.sub(r"\bCO\b", "COUNTY", n)
    tokens = [t for t in n.split() if t and t not in DROP_TOKENS]
    return " ".join(tokens)

def similarity(a: str, b: str) -> float:
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return 0.0
    jaccard = len(ta & tb) / len(ta | tb)
    seq = SequenceMatcher(None, a, b).ratio()
    return 0.55 * jaccard + 0.45 * seq

def dash_bases(raw_name: str) -> list[str]:
    """Progressively strip trailing dash-segments: each step is a possible
    'parent' name. 'PENN STATE-WILKES-BARRE' -> [.., 'PENN STATE-WILKES', 'PENN STATE'].
    Only bases with >=2 tokens and >=10 chars qualify (avoids junk like 'ANOKA')."""
    segs = re.split(r"\s*[-\u2013\u2014]\s*", strip_accents(raw_name))
    out = []
    for i in range(len(segs) - 1, 0, -1):
        base = normalize("-".join(segs[:i]))
        if len(base) >= 10 and len(base.split()) >= 2:
            out.append(base)
    return out

# ---------------------------------------------------------------- matching

LOOSE_TOKENS = {"COMMUNITY", "JUNIOR"}

def loosen(norm: str) -> str:
    return " ".join(t for t in norm.split() if t not in LOOSE_TOKENS)

def build_indexes(candidates: list[dict]):
    by_norm: dict[str, list[dict]] = {}
    by_base: dict[str, list[dict]] = {}
    by_loose: dict[str, list[dict]] = {}
    for c in candidates:
        by_norm.setdefault(c["norm"], []).append(c)
        for b in c["bases"]:
            by_base.setdefault(b, []).append(c)
        l = loosen(c["norm"])
        if l != c["norm"]:
            by_loose.setdefault(l, []).append(c)
    return by_norm, by_base, by_loose

def family_candidates(key: str, by_norm, by_base) -> list[dict]:
    """All candidates whose full name OR parent base matches the key."""
    seen, out = set(), []
    for c in by_norm.get(key, []) + by_base.get(key, []):
        if id(c) not in seen:
            seen.add(id(c))
            out.append(c)
    return out

def resolve_family(tes_norm: str, cands: list[dict], tes_had_suffix: bool) -> dict:
    """Pick the best candidate within one institutional family."""
    scored = [(similarity(tes_norm, c["norm"]), c) for c in cands]
    scored.sort(key=lambda t: (-t[0], -t[1]["instsize"], len(t[1]["norm"])))
    if not tes_had_suffix:
        # 'TEXAS A&M UNIVERSITY' with no campus suffix means the flagship:
        # among near-equal candidates, take the biggest institution.
        top = scored[0][0]
        near = [c for s, c in scored if s >= top - 0.25]
        near.sort(key=lambda c: (-c["instsize"], len(c["norm"])))
        return near[0]
    return scored[0][1]

def match_one(college: str, by_norm, by_base, by_loose, candidates):
    """Returns (candidate, quality) or (None, reason)."""
    n = normalize(college)

    # 1. exact (single unambiguous full-name hit)
    exact = by_norm.get(n)
    if exact and len(family_candidates(n, by_norm, by_base)) == 1:
        return exact[0], "exact"

    # 2. family — full name first, then progressively stripped campus suffixes
    tes_bases = dash_bases(college)
    for i, base in enumerate([n] + tes_bases):
        had_suffix = i > 0
        cands = family_candidates(base, by_norm, by_base)
        if cands:
            best = resolve_family(n, cands, had_suffix)
            quality = "exact" if best["norm"] == n else "family"
            return best, quality

    # 2b. prefix containment (no dash in either name, e.g. ASU 'Campus Immersion')
    probe = tes_bases[0] if tes_bases else n
    if len(probe) >= 10 and len(probe.split()) >= 2:
        pref = [c for c in candidates
                if c["norm"].startswith(probe + " ") or c["norm"] == probe]
        if pref:
            return resolve_family(n, pref, bool(tes_bases)), "family"

    # 2c. loose — tolerate inserted/dropped COMMUNITY/JUNIOR
    for base in [n] + tes_bases:
        cands = by_loose.get(loosen(base), [])
        if cands:
            return resolve_family(n, cands, base != n), "family"

    # 3. fuzzy
    best, best_score = None, 0.0
    for c in candidates:
        s = similarity(n, c["norm"])
        if s > best_score:
            best, best_score = c, s
    if best and best_score >= FUZZY_THRESHOLD:
        return best, "fuzzy"
    return None, f"best guess: {best['ipedsName'] if best else '—'} @ {best_score:.2f}"

# ---------------------------------------------------------------- main

def load_online(ef: list[dict]) -> dict[str, dict]:
    """UNITID -> undergrad distance-education enrollment.
    EF_DIST columns: EFDELEV (2 = undergrad total, 1 = all students),
    EFDETOT (enrolled), EFDEEXC (exclusively online), EFDESOM (some online)."""
    needed = {"EFDELEV", "EFDETOT", "EFDEEXC", "EFDESOM"}
    have = set(ef[0].keys()) if ef else set()
    if not needed <= have:
        print(f"  WARNING: EF_DIST columns missing {needed - have}; "
              f"headers present: {sorted(have)[:12]}… — skipping online data")
        return {}

    def intval(row, col):
        v = row.get(col, "")
        try:
            return int(float(v))
        except ValueError:
            return None

    out: dict[str, dict] = {}
    for r in ef:
        uid = clean_id(r.get("UNITID", ""))
        lev = intval(r, "EFDELEV")
        if not uid or lev not in (1, 2):
            continue
        # prefer undergrad rows (2); fall back to all-students (1)
        if uid in out and out[uid]["_lev"] == 2 and lev != 2:
            continue
        tot, exc, som = intval(r, "EFDETOT"), intval(r, "EFDEEXC"), intval(r, "EFDESOM")
        if tot in (None, 0):
            continue
        out[uid] = {
            "_lev": lev,
            "onlineExclusive": exc or 0,
            "onlineSome": som or 0,
            "onlineTotal": tot,
            "onlineExclusiveShare": round((exc or 0) / tot, 3),
            "onlineShare": round(((exc or 0) + (som or 0)) / tot, 3),
        }
    print(f"  online data: {len(out)} institutions with distance-ed enrollment")
    return out

def load_candidates(hd: list[dict], ic: list[dict], online: dict[str, dict]) -> list[dict]:
    ic_by_id = {clean_id(r.get("UNITID", "")): r for r in ic if clean_id(r.get("UNITID", ""))}

    # Self-diagnosis: verify the join and the charge columns actually exist.
    hd_ids = {clean_id(r.get("UNITID", "")) for r in hd}
    joined = sum(1 for i in hd_ids if i in ic_by_id)
    print(f"  join check: {joined}/{len(hd_ids)} directory rows have student-charge rows")
    if joined == 0:
        sys.exit("JOIN FAILED: no UNITID overlap between HD and IC files. "
                 f"HD headers: {sorted(hd[0].keys())[:8]}... IC headers: {sorted(ic[0].keys())[:8]}...")
    charge_cols = [c for c in ic[0].keys() if "HRCHG" in c or "TUITION" in c or "FEE" in c]
    print(f"  charge columns found in IC file: {sorted(charge_cols)[:12]}{'…' if len(charge_cols) > 12 else ''}")
    if not any("TUITION" in c or "HRCHG" in c for c in charge_cols):
        sys.exit("NO CHARGE COLUMNS FOUND in IC file — IPEDS may have renamed them. "
                 "Inspect the headers printed above and update the column names in this script.")

    out = []
    for r in hd:
        name = r.get("INSTNM", "")
        if not name:
            continue
        icr = ic_by_id.get(clean_id(r.get("UNITID", "")), {})

        per_d, per_i, per_o = num(icr, "HRCHG1"), num(icr, "HRCHG2"), num(icr, "HRCHG3")
        method = "per_credit_hour"
        for attr, tui_c, fee_c, cur in (("d", "TUITION1", "FEE1", per_d),
                                        ("i", "TUITION2", "FEE2", per_i),
                                        ("o", "TUITION3", "FEE3", per_o)):
            if cur is None:
                t = num(icr, tui_c)
                if t:
                    val = round((t + (num(icr, fee_c) or 0)) / FALLBACK_CREDITS_PER_YEAR)
                    method = "annual_div_24"
                    if attr == "d": per_d = val
                    elif attr == "i": per_i = val
                    else: per_o = val

        try:
            instsize = int(r.get("INSTSIZE", "0") or 0)
        except ValueError:
            instsize = 0

        ol = online.get(clean_id(r.get("UNITID", "")), {})

        out.append({
            "norm": normalize(name),
            "bases": dash_bases(name),
            "instsize": max(instsize, 0),
            "ipedsName": name,
            "state": r.get("STABBR", ""),
            "city": r.get("CITY", ""),
            "lat": coord(r, "LATITUDE"),
            "lng": coord(r, "LONGITUD", "LONGITUDE"),
            "perCreditInDistrict": per_d,
            "perCreditInState": per_i,
            "perCreditOutState": per_o,
            "method": method,
            "onlineExclusive": ol.get("onlineExclusive"),
            "onlineSome": ol.get("onlineSome"),
            "onlineTotal": ol.get("onlineTotal"),
            "onlineExclusiveShare": ol.get("onlineExclusiveShare"),
            "onlineShare": ol.get("onlineShare"),
        })

    with_cost = sum(1 for c in out
                    if c["perCreditInDistrict"] or c["perCreditInState"] or c["perCreditOutState"])
    print(f"  cost coverage: {with_cost}/{len(out)} IPEDS institutions have at least one rate")
    if with_cost == 0:
        sys.exit("COST EXTRACTION FAILED: charge columns exist but no values parsed. "
                 "Inspect a sample IC row and update the column names in this script.")
    return out

def main():
    tes_path = Path(sys.argv[1] if len(sys.argv) > 1 else "tes-data.json")
    if not tes_path.exists():
        sys.exit(f"Can't find {tes_path}. Pass the path: python build_costs.py path/to/tes-data.json")

    tes = json.loads(tes_path.read_text(encoding="utf-8"))
    tes_colleges = sorted({(inst.get("college") or "").strip() for inst in tes if inst.get("college")})
    print(f"{len(tes_colleges)} unique colleges in {tes_path.name}")

    hd = fetch_zip_csv(HD_URL)
    ic = fetch_zip_csv(IC_URL)
    ef = fetch_zip_csv(EF_URL)
    online = load_online(ef)
    candidates = load_candidates(hd, ic, online)
    by_norm, by_base, by_loose = build_indexes(candidates)

    matched, unmatched, counts = {}, [], {"exact": 0, "family": 0, "fuzzy": 0}
    report = []
    for college in tes_colleges:
        cand, quality = match_one(college, by_norm, by_base, by_loose, candidates)
        if cand is None:
            unmatched.append(f"{college}  ({quality})")
            continue
        counts[quality] += 1
        report.append(f"[{quality:6}] {college}  ->  {cand['ipedsName']}")
        rec = {k: v for k, v in cand.items() if k not in ("norm", "bases", "instsize")}
        rec["matchQuality"] = quality
        matched[college] = rec

    Path("college-costs.json").write_text(json.dumps(matched, indent=1), encoding="utf-8")
    Path("unmatched.txt").write_text("\n".join(unmatched), encoding="utf-8")
    Path("match-report.txt").write_text("\n".join(report), encoding="utf-8")

    print(f"\nMatched {len(matched)}/{len(tes_colleges)} "
          f"(exact {counts['exact']}, family {counts['family']}, fuzzy {counts['fuzzy']})")
    have_rate = sum(1 for r in matched.values()
                    if r["perCreditInDistrict"] or r["perCreditInState"] or r["perCreditOutState"])
    print(f"Cost data present for {have_rate}/{len(matched)} matched colleges")
    have_online = sum(1 for r in matched.values() if r.get("onlineShare") is not None)
    print(f"Online-enrollment data present for {have_online}/{len(matched)} matched colleges")
    print(f"Unmatched: {len(unmatched)} -> unmatched.txt")
    print("Audit every family/fuzzy match in match-report.txt")
    print("Drop college-costs.json into the app's public/ folder.")

if __name__ == "__main__":
    main()
