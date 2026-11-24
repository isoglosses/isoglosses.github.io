// Builds web/data.json from the raw census downloads in data/raw/.
//
// Three ACS 5-year periods, each redrawn onto the 2026-27 FCPS high school
// attendance areas:
//
//   2010-14  ACS sequence files (B16001, B02006, B03003, B04006), 2010 tracts
//   2015-19  ACS sequence files (C16001, B02015, B03003, B04006), 2010 tracts
//   2020-24  ACS table-based files (C16001, B02015, B03003, B04006), 2020 tracts
//
// For each language we keep three numbers per area:
//   speakers  people 5+ who speak it at home
//   limited   of those, people who speak English less than "very well"
//   heritage  people of that background, all ages (Hispanic or Latino origin;
//             Chinese / Korean / Vietnamese / Filipino, Asian
//             alone; Arab ancestry)
//
// Tract -> attendance area: every populated census block (2010 blocks for the
// 2010-tract periods, 2020 blocks for 2020-24) is assigned to the area holding
// its internal point, and each tract's counts are split by block population.

import fs from "node:fs";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import simplify from "@turf/simplify";
import truncate from "@turf/truncate";

const RAW = new URL("../data/raw/", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, RAW), "utf8");
const DOT_SIZE = 25;

let seed = 20261122;
const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

const LANGS = ["spanish", "chinese", "korean", "vietnamese", "arabic", "tagalog"];
const LABELS = {
  spanish: "Spanish", korean: "Korean", chinese: "Chinese", vietnamese: "Vietnamese",
  arabic: "Arabic", tagalog: "Tagalog",
};
const HERITAGE_LABELS = {
  spanish: "Hispanic or Latino", korean: "Korean", chinese: "Chinese",
  vietnamese: "Vietnamese", arabic: "Arab ancestry", tagalog: "Filipino",
};

// Language lines: [speakers line]; limited English is always speakers + 2.
const C16001_LINES = { spanish: 3, korean: 18, chinese: 21, vietnamese: 24, arabic: 33, tagalog: 27 };
const B16001_2014_LINES = { spanish: 3, korean: 72, chinese: 66, vietnamese: 87, arabic: 108, tagalog: 93 };

// --- Readers -----------------------------------------------------------------

// Table-based files (2020-24): pipe-delimited, one row per geography.
function tableBased(file, cells) {
  const lines = read(file).split("\n");
  const head = lines[0].split("|");
  const at = Object.fromEntries(head.map((h, i) => [h, i]));
  const table = file.slice(0, 6).toUpperCase();
  const out = {};
  for (const line of lines) {
    if (!/^1400000US51(059|600)/.test(line)) continue;
    const c = line.split("|");
    out[c[0].slice(9)] = (n) => Number(c[at[`${table}_E${String(n).padStart(3, "0")}`]]) || 0;
  }
  return out;
}

// Sequence files (2010-14, 2015-19): comma-delimited, keyed by LOGRECNO, with a
// separate geography file. `start` is the 1-based field of the table's line 1.
function geoIndex(dir, year) {
  const map = {};
  for (const line of read(`${dir}/g${year}5va.csv`).split("\n")) {
    const f = line.split(",");
    const geo = f.find((x) => x.startsWith("14000US51059") || x.startsWith("14000US51600"));
    if (geo) map[f[4]] = geo.slice(7);
  }
  return map;
}
function sequence(dir, year, seq, start) {
  const geos = geoIndex(dir, year);
  const out = {};
  for (const line of read(`${dir}/e${year}5va${seq}000.txt`).split("\n")) {
    const f = line.split(",");
    const geoid = geos[f[5]];
    if (geoid) out[geoid] = (n) => Number(f[start + n - 2]) || 0;
  }
  return out;
}

// --- Per-period tract values ---------------------------------------------------

function period2024() {
  const lang = tableBased("c16001.dat");
  const asian = tableBased("b02015.dat");
  const hisp = tableBased("b03003.dat");
  const arab = tableBased("b04006.dat");
  const tracts = {};
  for (const [g, v] of Object.entries(lang)) {
    const a = asian[g] || (() => 0), h = hisp[g] || (() => 0), r = arab[g] || (() => 0);
    const heritage = {
      spanish: h(3), korean: a(5), chinese: a(2) + a(8), vietnamese: a(19), arabic: r(6), tagalog: a(12),
    };
    tracts[g] = { pop: v(1), ...Object.fromEntries(LANGS.map((k) => [k, [v(C16001_LINES[k]), v(C16001_LINES[k] + 2), heritage[k]]])) };
  }
  return tracts;
}

function period2019() {
  const d = "acs2019";
  const lang = sequence(d, 2019, "0044", 147);
  const asian = sequence(d, 2019, "0003", 78);
  const hisp = sequence(d, 2019, "0004", 59);
  const arab = sequence(d, 2019, "0006", 7);
  const tracts = {};
  for (const [g, v] of Object.entries(lang)) {
    const a = asian[g], h = hisp[g], r = arab[g];
    const heritage = {
      spanish: h(3), korean: a(12), chinese: a(7) + a(20), vietnamese: a(22), arabic: r(6), tagalog: a(8),
    };
    tracts[g] = { pop: v(1), ...Object.fromEntries(LANGS.map((k) => [k, [v(C16001_LINES[k]), v(C16001_LINES[k] + 2), heritage[k]]])) };
  }
  return tracts;
}

function period2014() {
  const d = "acs2014";
  const lang = sequence(d, 2014, "0044", 7);
  const asian = sequence(d, 2014, "0004", 63);
  const hisp = sequence(d, 2014, "0005", 59);
  const arab = sequence(d, 2014, "0007", 7);
  const tracts = {};
  for (const [g, v] of Object.entries(lang)) {
    const a = asian[g], h = hisp[g], r = arab[g];
    const heritage = {
      spanish: h(3), korean: a(10), chinese: a(5) + a(15), vietnamese: a(17), arabic: r(6), tagalog: a(6),
    };
    tracts[g] = { pop: v(1), ...Object.fromEntries(LANGS.map((k) => [k, [v(B16001_2014_LINES[k]), v(B16001_2014_LINES[k] + 2), heritage[k]]])) };
  }
  return tracts;
}

// --- Geometry ------------------------------------------------------------------

const hs = JSON.parse(read("hs.geojson"));
const schoolNames = hs.features.map((f) => f.properties.SCHOOL_NAME).sort();

function loadBlocks(file) {
  const blocks = JSON.parse(read(file)).features.map(({ attributes: a }) => ({
    tract: a.GEOID.slice(0, 11),
    pop: a.POP100,
    area: a.AREALAND,
    lon: Number(a.INTPTLON),
    lat: Number(a.INTPTLAT),
  }));
  for (const b of blocks) {
    const pt = { type: "Point", coordinates: [b.lon, b.lat] };
    b.school = hs.features.find((f) => booleanPointInPolygon(pt, f))?.properties.SCHOOL_NAME ?? null;
  }
  const byTract = {};
  for (const b of blocks) (byTract[b.tract] ??= []).push(b);
  return byTract;
}

function allocate(tracts, blocksByTract) {
  const schools = Object.fromEntries(
    schoolNames.map((n) => [n, { pop: 0, ...Object.fromEntries(LANGS.map((k) => [k, [0, 0, 0]])) }]),
  );
  const missing = [];
  for (const [geoid, t] of Object.entries(tracts)) {
    const bs = (blocksByTract[geoid] || []).filter((b) => b.school);
    const total = bs.reduce((s, b) => s + b.pop, 0);
    if (!total) {
      if (t.pop) missing.push(geoid);
      continue;
    }
    for (const b of bs) {
      const w = b.pop / total, s = schools[b.school];
      s.pop += t.pop * w;
      for (const k of LANGS) for (let i = 0; i < 3; i++) s[k][i] += t[k][i] * w;
    }
  }
  for (const s of Object.values(schools)) {
    s.pop = Math.round(s.pop);
    for (const k of LANGS) s[k] = s[k].map(Math.round);
  }
  return { schools, missing };
}

// One dot per DOT_SIZE speakers, at a population-weighted random block in the
// tract, jittered within about half that block's width. Stored flat as
// [lon, lat, schoolIndex, lon, lat, schoolIndex, ...].
function makeDots(tracts, blocksByTract) {
  const dots = Object.fromEntries(LANGS.map((k) => [k, []]));
  for (const [geoid, t] of Object.entries(tracts)) {
    const bs = blocksByTract[geoid];
    if (!bs) continue;
    const total = bs.reduce((s, b) => s + b.pop, 0);
    for (const k of LANGS) {
      const exact = t[k][0] / DOT_SIZE;
      const n = Math.floor(exact) + (rand() < exact % 1 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        let r = rand() * total, b = bs[0];
        for (b of bs) if ((r -= b.pop) <= 0) break;
        const half = Math.min(Math.sqrt(b.area || 10000) / 2, 400);
        const dLat = ((rand() * 2 - 1) * half) / 111320;
        const dLon = ((rand() * 2 - 1) * half) / (111320 * Math.cos((b.lat * Math.PI) / 180));
        dots[k].push(+(b.lon + dLon).toFixed(4), +(b.lat + dLat).toFixed(4), schoolNames.indexOf(b.school));
      }
    }
  }
  return dots;
}

// --- Build -----------------------------------------------------------------------

const blocks2010 = loadBlocks("blocks2010.json");
const blocks2020 = loadBlocks("blocks.json");

const periods = [
  { key: "2014", label: "2010–14", tracts: period2014(), blocks: blocks2010 },
  { key: "2019", label: "2015–19", tracts: period2019(), blocks: blocks2010 },
  { key: "2024", label: "2020–24", tracts: period2024(), blocks: blocks2020 },
].map((p) => {
  const { schools, missing } = allocate(p.tracts, p.blocks);
  const dots = makeDots(p.tracts, p.blocks);
  console.log(p.label, "tracts", Object.keys(p.tracts).length, "missing", missing.length,
    "dots", LANGS.map((k) => `${k} ${dots[k].length / 3}`).join(", "));
  const county = Object.fromEntries(LANGS.map((k) => [k, [0, 1, 2].map((i) => Object.values(schools).reduce((s, x) => s + x[k][i], 0))]));
  console.log("   county [speakers, limited, heritage]:", JSON.stringify(county));
  return { key: p.key, label: p.label, schools, dots };
});

const boundaries = truncate(simplify(hs, { tolerance: 0.0004, highQuality: true }), { precision: 5 });
// d3 draws on a sphere and wants exterior rings clockwise (holes counter-
// clockwise), the opposite of the GeoJSON spec the county serves.
const signedArea = (ring) => ring.reduce((s, [x1, y1], i) => {
  const [x2, y2] = ring[(i + 1) % ring.length];
  return s + (x2 - x1) * (y2 + y1);
}, 0); // > 0 means clockwise
const rewind = (poly) => poly.map((ring, i) => ((signedArea(ring) > 0) === (i === 0) ? ring : [...ring].reverse()));
boundaries.features = boundaries.features.map((f) => ({
  type: "Feature",
  properties: { name: f.properties.SCHOOL_NAME },
  geometry: f.geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: rewind(f.geometry.coordinates) }
    : { type: "MultiPolygon", coordinates: f.geometry.coordinates.map(rewind) },
}));

const out = {
  meta: {
    title: "Fairfax County Mother Tongue Project",
    sources: [
      "American Community Survey 5-year estimates (2010–14, 2015–19, 2020–24), U.S. Census Bureau: language spoken at home (B16001 / C16001), Asian groups (B02006 / B02015), Hispanic origin (B03003), ancestry (B04006)",
      "2010 and 2020 Census block populations (TIGERweb)",
      "FCPS high school attendance areas, 2026–27 (Fairfax County GIS)",
    ],
    dotSize: DOT_SIZE,
    built: new Date().toISOString().slice(0, 10),
  },
  schoolNames,
  langs: LANGS.map((k) => ({ key: k, label: LABELS[k], heritage: HERITAGE_LABELS[k] })),
  periods,
  boundaries,
};
const OUT = new URL("../web/data.json", import.meta.url);
fs.mkdirSync(new URL("../web/", import.meta.url), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log("wrote web/data.json,", Math.round(fs.statSync(OUT).size / 1024), "KB");
