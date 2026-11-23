import { Sonifier } from "./sound.js";

const data = await fetch("data.json").then((r) => r.json());
const services = await d3.csv("services.csv").catch(() => []);

const LANGS = data.langs.map((l) => l.key);
const LABEL = Object.fromEntries(data.langs.map((l) => [l.key, l.label]));
const HERITAGE = Object.fromEntries(data.langs.map((l) => [l.key, l.heritage]));
const PERIODS = data.periods;
const LATEST = PERIODS.length - 1;
const NAMES = data.schoolNames;
const DOT = data.meta.dotSize;

const SERVICE_CATEGORIES = [
  "Grocery & food", "Worship", "Government & civic", "Library", "Banking",
  "Senior center", "Media", "Music & culture", "Other",
];

const fmt = d3.format(",");
const pct = d3.format(".0%");
const pct1 = d3.format(".1%");

// ---------------------------------------------------------------------------
// State

const state = {
  mode: "speakers",
  speakersView: "dots", // dots | share
  timeView: "dots", // dots | kept
  picked: ["korean", "chinese", "vietnamese"], // up to three, for dot views
  slot: { korean: 0, chinese: 1, vietnamese: 2 }, // a language keeps its color while picked
  lang: "korean", // the one language for single-language views
  t: LATEST, // position on the timeline, 0..LATEST (fractional while playing)
  playing: false,
};

// ---------------------------------------------------------------------------
// Map setup

const wrap = document.querySelector(".map-wrap");
const svg = d3.select("#map");
const dotsCanvas = document.getElementById("dots");
const flashCanvas = document.getElementById("flash");
const tooltip = document.getElementById("tooltip");
const panel = document.getElementById("panel");

const projection = d3.geoMercator();
const path = d3.geoPath(projection);
const features = data.boundaries.features;

const areaLayer = svg.append("g");
const placeLayer = svg.append("g");
const labelLayer = svg.append("g");

// Octave band per school, from north (high) to south (low).
const centroidLat = Object.fromEntries(features.map((f) => [f.properties.name, d3.geoCentroid(f)[1]]));
const latCuts = d3.range(1, 4).map((i) => d3.quantile(Object.values(centroidLat).sort(d3.ascending), i / 4));
const octaveOf = (name) => 3 + d3.bisect(latCuts, centroidLat[name]);

let colors = {};
let gapRows = [];
function readColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  colors = {
    slots: [v("--s1"), v("--s2"), v("--s3")],
    seq: [v("--q1"), v("--q2"), v("--q3"), v("--q4"), v("--q5")],
    bivar: [0, 1, 2].map((r) => [0, 1, 2].map((c) => v(`--b${r}${c}`))),
    muted: v("--muted"),
    fill: v("--area-fill"),
    surface: v("--surface"),
  };
}

let size = { w: 0, h: 0, dpr: 1 };
let screenDots = []; // per period: { lang: Float32Array [x, y, ...] }
let dotsBySchool = []; // per period: { lang: { schoolIndex: [dotIndex, ...] } }

function resize() {
  const r = wrap.getBoundingClientRect();
  size = { w: r.width, h: r.height, dpr: window.devicePixelRatio || 1 };
  for (const c of [dotsCanvas, flashCanvas]) {
    c.width = Math.round(size.w * size.dpr);
    c.height = Math.round(size.h * size.dpr);
  }
  const pad = Math.min(28, size.w * 0.04);
  projection.fitExtent([[pad, pad], [size.w - pad, size.h - pad]], data.boundaries);

  screenDots = PERIODS.map((p) =>
    Object.fromEntries(LANGS.map((k) => {
      const src = p.dots[k];
      const out = new Float32Array((src.length / 3) * 2);
      for (let i = 0, j = 0; i < src.length; i += 3, j += 2) {
        const [x, y] = projection([src[i], src[i + 1]]);
        out[j] = x;
        out[j + 1] = y;
      }
      return [k, out];
    })),
  );
  dotsBySchool = PERIODS.map((p) =>
    Object.fromEntries(LANGS.map((k) => {
      const by = {};
      const src = p.dots[k];
      for (let i = 0; i < src.length; i += 3) (by[src[i + 2]] ??= []).push(i / 3);
      return [k, by];
    })),
  );

  areaLayer.selectAll("path")
    .data(features)
    .join("path")
    .attr("class", "area")
    .attr("d", path)
    .on("pointermove", (e, f) => showTooltip(e, f.properties.name))
    .on("pointerenter", function () { d3.select(this).classed("hover", true).raise(); })
    .on("pointerleave", function () { d3.select(this).classed("hover", false); hideTooltip(); });

  labelLayer.selectAll("text")
    .data(size.w > 560 ? features : [])
    .join("text")
    .attr("class", "label")
    .attr("x", (f) => path.centroid(f)[0])
    .attr("y", (f) => path.centroid(f)[1])
    .text((f) => f.properties.name);

  draw();
}

// ---------------------------------------------------------------------------
// Data helpers

const periodIndex = () => Math.round(state.t);
const school = (p, name) => PERIODS[p].schools[name];

function servicesIn(lang) {
  return services.filter((s) => s.languages?.split(";").map((x) => x.trim().toLowerCase()).includes(lang));
}

// Which attendance area a place falls in.
function schoolAt(lon, lat) {
  const pt = [lon, lat];
  return features.find((f) => d3.geoContains(f, pt))?.properties.name ?? null;
}
for (const s of services) {
  s.lat = +s.lat;
  s.lon = +s.lon;
  s.school = Number.isFinite(s.lat) && Number.isFinite(s.lon) ? schoolAt(s.lon, s.lat) : null;
}

function gapLevels(lang) {
  const p = LATEST;
  const rows = NAMES.map((n) => {
    const limited = school(p, n)[lang][1];
    const count = servicesIn(lang).filter((s) => s.school === n).length;
    return { name: n, limited, count, rate: limited ? (count / limited) * 1000 : 0 };
  });
  const need = d3.scaleQuantile(rows.map((r) => r.limited), [0, 1, 2]);
  const withAny = rows.filter((r) => r.count > 0).map((r) => r.rate);
  const help = withAny.length >= 3 ? d3.scaleQuantile(withAny, [0, 1, 2]) : () => 1;
  for (const r of rows) {
    r.need = need(r.limited);
    r.help = r.count > 0 ? help(r.rate) : 0;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Drawing

function areaFill(name) {
  const m = state.mode;
  if (m === "speakers" && state.speakersView === "share") return shareScale()(shareOf(LATEST, name));
  if (m === "gaps") {
    const r = gapRows.find((x) => x.name === name);
    return colors.bivar[r.help][r.need];
  }
  if (m === "time" && state.timeView === "kept") {
    const v = keptOf(periodIndex(), name);
    return v == null ? colors.fill : keptScale()(v);
  }
  return colors.fill;
}

const shareOf = (p, name) => {
  const s = school(p, name);
  return s.pop ? s[state.lang][0] / s.pop : 0;
};
const keptOf = (p, name) => {
  const [speakers, , heritage] = school(p, name)[state.lang];
  return heritage >= 100 ? speakers / heritage : null; // too few people to say
};
function shareScale() {
  return d3.scaleQuantile(NAMES.map((n) => shareOf(LATEST, n)), colors.seq);
}
function keptScale() {
  return d3.scaleThreshold([0.4, 0.55, 0.7, 0.85], colors.seq);
}

function draw() {
  if (state.mode === "gaps") gapRows = gapLevels(state.lang);
  areaLayer.selectAll("path").style("fill", (f) => areaFill(f.properties.name));
  drawPlaces();
  drawDots();
}

function drawDots() {
  const ctx = dotsCanvas.getContext("2d");
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.clearRect(0, 0, size.w, size.h);
  const showDots =
    (state.mode === "speakers" && state.speakersView === "dots") ||
    (state.mode === "time" && state.timeView === "dots");
  if (!showDots || !screenDots.length) return;

  const r = size.w < 560 ? 0.9 : 1.25;
  const layers = [];
  if (state.mode === "time") {
    const i = Math.min(Math.floor(state.t), LATEST - 1);
    const f = state.t - i;
    layers.push([i, 1 - f], [i + 1, f]);
  } else {
    layers.push([LATEST, 1]);
  }
  for (const [p, alpha] of layers) {
    if (alpha <= 0.01) continue;
    for (const k of state.picked) {
      const pts = screenDots[p][k];
      ctx.fillStyle = colors.slots[state.slot[k]];
      ctx.globalAlpha = 0.8 * alpha;
      ctx.beginPath();
      for (let j = 0; j < pts.length; j += 2) {
        ctx.moveTo(pts[j] + r, pts[j + 1]);
        ctx.arc(pts[j], pts[j + 1], r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawPlaces() {
  const rows = state.mode === "services"
    ? (state.lang === "all" ? services : servicesIn(state.lang)).filter((s) => s.school)
    : [];
  placeLayer.selectAll("circle")
    .data(rows)
    .join("circle")
    .attr("class", "place")
    .attr("r", 5)
    .attr("cx", (s) => projection([s.lon, s.lat])[0])
    .attr("cy", (s) => projection([s.lon, s.lat])[1])
    .attr("fill", (s) => (s.category === "Music & culture" ? colors.slots[1] : colors.slots[0]))
    .on("pointermove", (e, s) => showPlaceTooltip(e, s))
    .on("pointerleave", hideTooltip);
}

// ---------------------------------------------------------------------------
// Tooltips

function placeTooltip(e, html) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const r = wrap.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
  tooltip.style.left = `${Math.min(x + 14, r.width - tw - 8)}px`;
  tooltip.style.top = `${y + th + 20 > r.height ? y - th - 12 : y + 14}px`;
}
const row = (k, v) => `<div class="row"><span>${k}</span><b>${v}</b></div>`;

function showTooltip(e, name) {
  const p = state.mode === "time" ? periodIndex() : LATEST;
  const s = school(p, name);
  let html = `<strong>${name}</strong>`;
  if (state.mode === "speakers" && state.speakersView === "dots") {
    html += state.picked.map((k) => row(LABEL[k], fmt(s[k][0]))).join("");
  } else if (state.mode === "time" && state.timeView === "dots") {
    html += `<div class="row"><span>${PERIODS[p].label}</span></div>`;
    html += state.picked.map((k) => row(LABEL[k], fmt(s[k][0]))).join("");
  } else if (state.mode === "gaps") {
    const r = gapRows.find((x) => x.name === name);
    html += row(`${LABEL[state.lang]}, limited English`, fmt(r.limited));
    html += row("Places logged", fmt(r.count));
  } else if (state.mode === "services") {
    const n = (state.lang === "all" ? services : servicesIn(state.lang)).filter((x) => x.school === name).length;
    html += row("Places logged", fmt(n));
  } else {
    const [speakers, limited, heritage] = s[state.lang];
    html += row(`Speak ${LABEL[state.lang]}`, fmt(speakers));
    html += row("Share of residents", pct1(s.pop ? speakers / s.pop : 0));
    html += row("Limited English", fmt(limited));
    if (state.mode === "time") {
      html += row(`${HERITAGE[state.lang]} background`, fmt(heritage));
      const kept = keptOf(p, name);
      html += row("Speak it at home", kept == null ? "too few" : pct(kept));
    }
  }
  placeTooltip(e, html);
}
function showPlaceTooltip(e, s) {
  let html = `<strong>${s.name}</strong>`;
  html += row("Type", s.category);
  html += row("Languages", s.languages.split(";").map((k) => LABEL[k.trim()] ?? k).join(", "));
  if (s.address) html += `<div class="row"><span>${s.address}</span></div>`;
  if (s.verified) html += row("Checked", s.verified);
  placeTooltip(e, html);
}
function hideTooltip() {
  tooltip.hidden = true;
}

// ---------------------------------------------------------------------------
// Panel pieces

function langChips({ multi }) {
  return `<div class="chips">${LANGS.map((k) => {
    const on = multi ? state.picked.includes(k) : state.lang === k;
    const sw = multi && on ? `<span class="sw" style="background:${colors.slots[state.slot[k]]}"></span>` : "";
    return `<button class="chip" data-lang="${k}" aria-pressed="${on}">${sw}${LABEL[k]}</button>`;
  }).join("")}</div>`;
}

function seg(name, options, current) {
  return `<div class="seg" role="group">${options.map(([v, label]) =>
    `<button data-${name}="${v}" aria-pressed="${v === current}">${label}</button>`).join("")}</div>`;
}

function rampLegend(cols, labels) {
  return `<div class="ramp">${cols.map((c) => `<span style="background:${c}"></span>`).join("")}</div>
    <div class="ramp-labels">${labels.map((l) => `<span>${l}</span>`).join("")}</div>`;
}

function stat(v, k) {
  return `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
}

function table(headers, rows) {
  return `<details class="table"><summary>Show as a table</summary><table>
    <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></details>`;
}

function togglePicked(k) {
  if (state.picked.includes(k)) {
    if (state.picked.length === 1) return;
    state.picked = state.picked.filter((x) => x !== k);
    delete state.slot[k];
  } else {
    if (state.picked.length === 3) {
      const oldest = state.picked.shift();
      delete state.slot[oldest];
    }
    const used = new Set(Object.values(state.slot));
    state.slot[k] = [0, 1, 2].find((s) => !used.has(s));
    state.picked.push(k);
  }
  state.lang = k;
}

// ---------------------------------------------------------------------------
// Panels per mode

function speakersPanel() {
  const k = state.lang;
  const s = NAMES.map((n) => school(LATEST, n));
  const total = d3.sum(s, (x) => x[k][0]);
  const limited = d3.sum(s, (x) => x[k][1]);
  const dots = state.speakersView === "dots";
  const scale = shareScale();
  const cuts = [0, ...scale.quantiles()].map((q) => pct1(q));

  return `
    <h2>Who speaks what, where</h2>
    <p>People 5 and older who speak each language at home, ${PERIODS[LATEST].label}.</p>
    ${seg("sview", [["dots", "Dots"], ["share", "Share of residents"]], state.speakersView)}
    <h3>${dots ? "Languages (up to three at once)" : "Language"}</h3>
    ${langChips({ multi: dots })}
    <h3>Key</h3>
    ${dots
      ? `<div class="legend"><div class="item">One dot = ${DOT} speakers, placed where people live</div></div>`
      : `${rampLegend(colors.seq, cuts)}<p class="note">Each color holds about the same number of areas.</p>`}
    <h3>${LABEL[k]} countywide</h3>
    <div class="stats">${stat(fmt(total), "speak it at home")}${stat(pct(limited / total), "of them speak English less than very well")}</div>
    ${table(["Area", "Speakers", "Share", "Limited English"],
      NAMES.map((n) => school(LATEST, n)).map((x, i) => [NAMES[i], fmt(x[k][0]), pct1(x.pop ? x[k][0] / x.pop : 0), fmt(x[k][1])]))}
  `;
}

function servicesPanel() {
  const rows = state.lang === "all" ? services : servicesIn(state.lang);
  const counts = SERVICE_CATEGORIES.map((c) => [c, rows.filter((s) => s.category === c).length]);
  const chips = `<div class="chips">
    <button class="chip" data-lang="all" aria-pressed="${state.lang === "all"}">All</button>
    ${LANGS.map((k) => `<button class="chip" data-lang="${k}" aria-pressed="${state.lang === k}">${LABEL[k]}</button>`).join("")}
  </div>`;
  return `
    <h2>Where help speaks your language</h2>
    <p>Places where someone can get something done in a language other than English. Every entry is visited, called or otherwise checked by hand.</p>
    <h3>Language</h3>
    ${chips}
    <h3>Key</h3>
    <div class="legend">
      <div class="item"><span class="dot" style="background:${colors.slots[0]}"></span>Service</div>
      <div class="item"><span class="dot" style="background:${colors.slots[1]}"></span>Music &amp; culture</div>
    </div>
    <h3>${rows.length ? `${fmt(rows.length)} places logged` : "No places logged yet"}</h3>
    ${rows.length
      ? table(["Type", "Places"], counts)
      : `<p class="note">This layer is the original fieldwork of the project and fills in as it goes. Each row of <code>services.csv</code> records a name, type, languages, location, source, and the date it was checked.</p>`}
  `;
}

function gapsPanel() {
  const k = state.lang;
  gapRows = gapLevels(k);
  const top = [...gapRows].sort((a, b) => b.limited - a.limited).slice(0, 5);
  const noData = !servicesIn(k).length;
  const cell = (r, c) => `<span class="c" style="background:${colors.bivar[r][c]}"></span>`;
  return `
    <h2>Where help is missing</h2>
    <p>Residents who speak ${LABEL[k]} and speak English less than "very well," set against the places that serve them in ${LABEL[k]}.</p>
    <h3>Language</h3>
    ${langChips({ multi: false })}
    <h3>Key</h3>
    <div class="bivar" aria-label="Color key: more residents with limited English to the right, more places per resident going up">
      <span>more help</span>${cell(2, 0)}${cell(2, 1)}${cell(2, 2)}
      <span></span>${cell(1, 0)}${cell(1, 1)}${cell(1, 2)}
      <span>less help</span>${cell(0, 0)}${cell(0, 1)}${cell(0, 2)}
      <span></span><span>fewer</span><span></span><span>more</span>
    </div>
    <p class="note">Across: residents with limited English. Up: places logged per 1,000 of them. The red corner is where help is most needed.</p>
    ${noData ? `<p class="note">No ${LABEL[k]} places are logged yet, so every area shows as having little help. The map sharpens as the services layer fills in.</p>` : ""}
    <h3>Most residents with limited English</h3>
    <div class="legend">${top.map((r) => `<div class="item">${r.name}: ${fmt(r.limited)} residents, ${r.count} places</div>`).join("")}</div>
    ${table(["Area", "Limited English", "Places"], gapRows.map((r) => [r.name, fmt(r.limited), r.count]))}
  `;
}

function heritageChart(k) {
  const w = 316, h = 150, m = { t: 18, r: 4, b: 22, l: 4 };
  const vals = PERIODS.map((p) => {
    const sum = (i) => d3.sum(NAMES, (n) => p.schools[n][k][i]);
    return { label: p.label, heritage: sum(2), speakers: sum(0) };
  });
  const x = d3.scaleBand(vals.map((v) => v.label), [m.l, w - m.r]).paddingInner(0.3).paddingOuter(0.1);
  const xi = d3.scaleBand(["heritage", "speakers"], [0, x.bandwidth()]).padding(0.12);
  const y = d3.scaleLinear([0, d3.max(vals, (v) => v.heritage)], [h - m.b, m.t]);
  const bar = (v, key, color) => {
    const bx = x(v.label) + xi(key), bw = xi.bandwidth(), by = y(v[key]), bh = h - m.b - by;
    const r = Math.min(4, bw / 2, bh);
    return `<path fill="${color}" d="M${bx},${h - m.b}V${by + r}q0,-${r} ${r},-${r}h${bw - 2 * r}q${r},0 ${r},${r}V${h - m.b}Z"><title>${v.label}, ${key === "heritage" ? HERITAGE[k] + " background" : "speak " + LABEL[k] + " at home"}: ${fmt(v[key])}</title></path>`;
  };
  return `
    <svg class="bars" viewBox="0 0 ${w} ${h}" role="img" aria-label="${LABEL[k]} heritage and home speakers by period">
      <line x1="${m.l}" x2="${w - m.r}" y1="${h - m.b}" y2="${h - m.b}" stroke="var(--edge)"/>
      ${vals.map((v) => `
        ${bar(v, "heritage", colors.seq[1])}
        ${bar(v, "speakers", colors.seq[3])}
        <text class="val" x="${x(v.label) + x.bandwidth() / 2}" y="${m.t - 6}" text-anchor="middle">${pct(v.speakers / v.heritage)}</text>
        <text x="${x(v.label) + x.bandwidth() / 2}" y="${h - 6}" text-anchor="middle">${v.label}</text>`).join("")}
    </svg>
    <div class="legend">
      <div class="item"><span class="dot" style="background:${colors.seq[1]}"></span>${HERITAGE[k]} background</div>
      <div class="item"><span class="dot" style="background:${colors.seq[3]}"></span>Speak ${LABEL[k]} at home (the % above each pair)</div>
    </div>`;
}

function timePanel() {
  const k = state.lang;
  const p = periodIndex();
  const dots = state.timeView === "dots";
  return `
    <h2>How it changed</h2>
    <p>Three census periods, all redrawn on today's attendance areas. Press play to hear the change: new speakers sound as notes.</p>
    <div class="player">
      <button class="play" id="play" aria-label="${state.playing ? "Pause" : "Play"}">${state.playing ? "❚❚" : "▶"}</button>
      <div class="timeline">
        <input id="slider" type="range" min="0" max="${LATEST}" step="0.01" value="${state.t}" aria-label="Census period">
        <div class="ticks">${PERIODS.map((x) => `<span>${x.label}</span>`).join("")}</div>
      </div>
    </div>
    <p class="note">Each language is one note of a pentatonic scale with its own instrument. Northern areas play higher and southern areas lower. Louder notes mean faster growth, and soft low notes mean a decline.</p>
    <h3>Show</h3>
    ${seg("tview", [["dots", "Dots"], ["kept", "Kept at home"]], state.timeView)}
    <h3>${dots ? "Languages (up to three at once)" : "Language"}</h3>
    ${langChips({ multi: dots })}
    ${dots ? "" : `<h3>Key: share of ${HERITAGE[k]} residents who speak ${LABEL[k]} at home</h3>
      ${rampLegend(colors.seq, ["", "40%", "55%", "70%", "85%"])}
      <p class="note">Gray areas have fewer than 100 people of this background.</p>`}
    <h3>Heritage and home language, countywide</h3>
    ${heritageChart(k)}
    <p class="note">Heritage counts include people of all ages, while the language counts include people 5 and older, so the share is a slight underestimate.</p>
    ${table(["Area", "Speakers", "Heritage", "Kept"],
      NAMES.map((n) => {
        const [sp, , he] = school(p, n)[k];
        const kept = keptOf(p, n);
        return [n, fmt(sp), fmt(he), kept == null ? "–" : pct(kept)];
      }))}
  `;
}

const PANELS = { speakers: speakersPanel, services: servicesPanel, gaps: gapsPanel, time: timePanel };

function renderPanel() {
  if (state.mode === "about") return;
  panel.innerHTML = PANELS[state.mode]();
}

// ---------------------------------------------------------------------------
// Events

function setMode(m) {
  if (state.playing) stop();
  state.mode = m;
  if (m === "services" && !LANGS.includes(state.lang)) state.lang = "all";
  if (m !== "services" && state.lang === "all") state.lang = state.picked.at(-1);
  if (m !== "time") state.t = LATEST;
  history.replaceState(null, "", m === "speakers" ? location.pathname : `#${m}`);
  document.querySelectorAll(".modes button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === m));
  const about = m === "about";
  document.querySelector(".layout").hidden = about;
  document.getElementById("about").hidden = !about;
  if (!about) {
    renderPanel();
    resize();
  }
}

document.querySelector(".modes").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) setMode(b.dataset.mode);
});

panel.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.id === "play") return state.playing ? stop() : play();
  if (b.dataset.sview) state.speakersView = b.dataset.sview;
  if (b.dataset.tview) state.timeView = b.dataset.tview;
  if (b.dataset.lang) {
    const k = b.dataset.lang;
    const multi = (state.mode === "speakers" && state.speakersView === "dots") ||
      (state.mode === "time" && state.timeView === "dots");
    if (multi) togglePicked(k);
    else state.lang = k;
  }
  renderPanel();
  draw();
});

panel.addEventListener("input", (e) => {
  if (e.target.id !== "slider") return;
  if (state.playing) stop();
  state.t = +e.target.value;
  draw();
});
panel.addEventListener("change", (e) => {
  if (e.target.id !== "slider") return;
  state.t = Math.round(+e.target.value);
  renderPanel();
  draw();
});

// ---------------------------------------------------------------------------
// Playback: dots cross-fade between periods while growth plays as notes.

const sound = new Sonifier();
const SEGMENT_MS = 8000;
let flashes = [];
let lastFrame = 0;
let scheduledSegment = -1;

async function play() {
  await sound.start();
  if (state.t >= LATEST) state.t = 0;
  state.playing = true;
  scheduledSegment = -1;
  lastFrame = performance.now();
  renderPanel();
  requestAnimationFrame(tick);
}

function stop() {
  state.playing = false;
  flashes = [];
  clearFlash();
  renderPanel();
  draw();
}

function scheduleSegment(i) {
  const start = performance.now();
  const audioStart = sound.now + 0.05;
  const remaining = (i + 1 - state.t) * SEGMENT_MS;
  NAMES.forEach((name, si) => {
    const octave = octaveOf(name);
    LANGS.forEach((k, voice) => {
      const a = PERIODS[i].schools[name][k][0];
      const b = PERIODS[i + 1].schools[name][k][0];
      const change = b - a;
      const n = Math.round(Math.abs(change) / DOT);
      if (!n) return;
      const notes = Math.min(3, Math.ceil(n / 6));
      const growth = change / Math.max(a, DOT);
      const pool = dotsBySchool[i + 1][k][si] ?? [];
      for (let j = 0; j < notes; j++) {
        const at = Math.random() * remaining * 0.95;
        if (change > 0) {
          sound.note(voice, octave, 0.2 + 0.6 * Math.min(1, growth), audioStart + at / 1000);
          if (pool.length) {
            const d = pool[Math.floor(Math.random() * pool.length)];
            const pts = screenDots[i + 1][k];
            const color = k in state.slot ? colors.slots[state.slot[k]] : colors.muted;
            flashes.push({ t: start + at, x: pts[d * 2], y: pts[d * 2 + 1], color });
          }
        } else {
          sound.note(voice, Math.max(3, octave - 1), 0.08, audioStart + at / 1000);
        }
      }
    });
  });
}

function clearFlash() {
  const ctx = flashCanvas.getContext("2d");
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.clearRect(0, 0, size.w, size.h);
}

function drawFlashes(now) {
  clearFlash();
  const ctx = flashCanvas.getContext("2d");
  const LIFE = 900;
  flashes = flashes.filter((f) => now - f.t < LIFE);
  for (const f of flashes) {
    const age = now - f.t;
    if (age < 0) continue;
    const k = age / LIFE;
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 2 + k * 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function tick(now) {
  if (!state.playing) return;
  const dt = now - lastFrame;
  lastFrame = now;
  state.t = Math.min(LATEST, state.t + dt / SEGMENT_MS);
  const i = Math.min(Math.floor(state.t), LATEST - 1);
  if (i !== scheduledSegment && state.t < LATEST) {
    scheduledSegment = i;
    scheduleSegment(i);
  }
  const slider = document.getElementById("slider");
  if (slider) slider.value = state.t;
  drawDots();
  if (state.timeView === "kept") areaLayer.selectAll("path").style("fill", (f) => areaFill(f.properties.name));
  drawFlashes(now);
  if (state.t >= LATEST) {
    setTimeout(stop, 900);
    state.playing = false;
    requestAnimationFrame(function fade(n) {
      drawFlashes(n);
      if (flashes.length) requestAnimationFrame(fade);
    });
    return;
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Start

document.getElementById("sources").innerHTML = data.meta.sources.map((s) => `<li>${s}</li>`).join("");
document.getElementById("built").textContent = data.meta.built;

readColors();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  readColors();
  renderPanel();
  draw();
});
new ResizeObserver(() => resize()).observe(wrap);
const fromHash = location.hash.slice(1);
setMode(["speakers", "services", "gaps", "time", "about"].includes(fromHash) ? fromHash : "speakers");
