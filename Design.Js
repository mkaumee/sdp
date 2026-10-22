// Design.Js — browser-side code for ClimateSmart AI.
// It draws the map, talks to our Python backend (app.py) and fills in the results panel.

const API_SEARCH = "/api/search"; // backend address that turns a place name into coordinates
const API_ANALYZE = "/api/analyze"; // backend address that scores an area from satellite data

const $ = (id) => document.getElementById(id); // shortcut for document.getElementById

const form = $("search-form"); // the search form
const placeInput = $("place"); // text box where you type a place
const searchBtn = $("search-btn"); // the Search button
const suggestions = $("suggestions"); // list of other matching places
const statusEl = $("status"); // line of text for messages and errors
const scaleInput = $("scale"); // MW or new residents
const scaleLabel = $("scale-label"); // label above that box
const areaSelect = $("area"); // how wide an area to analyse
const results = $("results"); // the whole results section

const SCALE = { // settings for the size box, per purpose
  datacentre: { label: "IT load (MW)", min: 1, max: 500, step: 1, value: 30 },
  township: { label: "New residents", min: 100, max: 1000000, step: 100, value: 20000 }, // step must divide (value - min)
};
const TAG_ICONS = { water: "💧", nature: "🌳", people: "👥", cooling: "❄️", terrain: "⛰️", heat: "🌡️", green: "🌿", site: "📍" }; // emoji per recommendation type
const VERDICT_ICONS = { good: "✓", caution: "!", poor: "✕" }; // icon + label, so the verdict is never colour alone
const VERDICT_COLORS = { good: "#0ca30c", caution: "#fab219", poor: "#d03b3b" }; // ring colour per verdict

const state = { // what the page currently shows
  purpose: "datacentre", // data centre or township
  point: null, // chosen {lat, lon}
  placeName: null, // name from the search, if any
  result: null, // last analysis from the backend
  requestId: 0, // increases on every analysis, so late replies from older requests are ignored
  cellLayers: { suitability: {}, heat: {} }, // map rectangles by "row,col", so lists can open their popups
  spotMarkers: [], // numbered best-spot pins
};

function toISODate(d) { // turns a Date object into "YYYY-MM-DD" text
  return d.toISOString().slice(0, 10); // ISO string is "YYYY-MM-DDTHH:MM..." so keep the first 10 characters
}

function esc(text) { // makes text safe to put inside HTML
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function fmt(n, digits = 0) { // 12345.6 -> "12,346"; null -> "–"
  return n == null ? "–" : Number(n).toLocaleString("en", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function setStatus(msg, isError = false) { // shows a message under the controls
  statusEl.textContent = msg; // put the text in
  statusEl.classList.toggle("error", isError); // red only for errors
}

// ---------- Map ----------

const map = L.map("map", { worldCopyJump: true }).setView([3.1, 101.6], 9); // start over the Klang Valley, Malaysia
const nasaDate = toISODate(new Date(Date.now() - 2 * 86400000)); // NASA posts daily images 1–2 days late

const baseLayers = { // background maps you can switch between
  "Satellite (Esri)": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
  }),
  "Streets (OpenStreetMap)": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap contributors",
  }),
  [`NASA MODIS daily (${nasaDate})`]: L.tileLayer( // the same NASA GIBS imagery the first version of this app used
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${nasaDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    { maxNativeZoom: 9, maxZoom: 19, attribution: "NASA EOSDIS GIBS" },
  ),
};
baseLayers["Satellite (Esri)"].addTo(map); // satellite view by default

const overlays = { // layers drawn on top, filled after each analysis
  landcover: L.layerGroup(), // coloured ESA WorldCover picture
  suitability: L.layerGroup(), // grid coloured by score
  heat: L.layerGroup(), // grid coloured by heat risk
  spots: L.layerGroup(), // numbered best spots
};
const outline = L.layerGroup().addTo(map); // the analysed square and the chosen point (always shown)
L.control.layers(baseLayers, { // the layer switcher in the top-right corner
  "Land cover (ESA WorldCover)": overlays.landcover,
  "Suitability grid": overlays.suitability,
  "Heat hotspots grid": overlays.heat,
  "Best spots": overlays.spots,
}).addTo(map);
L.control.scale({ imperial: false }).addTo(map); // km scale bar

// Colours: suitability uses a diverging red–grey–blue scale (bad ↔ good, grey = middle);
// heat uses one orange hue, light → dark. Neither relies on red vs green.
const SCORE_STEPS = [[80, "#2a78d6", "80–100 good"], [65, "#86b6ef", "65–79"], [50, "#bdbcb5", "50–64 middle"], [35, "#f0a3a2", "35–49"], [0, "#d03b3b", "0–34 poor"]];
const HEAT_STEPS = [[0.8, "#b8461b", "Very hot surfaces"], [0.6, "#eb6834", "Hot"], [0.4, "#f4874f", "Warm"], [0.2, "#f9b38f", "Mild"], [0, "#fde0cf", "Slightly warm"]];

function scoreColor(score) { // colour for a 0–100 score
  if (score == null) return "#6b6b6b"; // grey when unknown
  return SCORE_STEPS.find(([min]) => score >= min)[1]; // colour of the first step the score reaches
}

function heatColor(risk) { // colour for heat risk (-1 leafy .. +1 concrete); null = cooler than average, not filled
  if (risk <= 0) return null;
  return HEAT_STEPS.find(([min]) => risk >= min)[1];
}

const legend = L.control({ position: "bottomright" }); // legend box for whichever grid is on
legend.onAdd = () => L.DomUtil.create("div", "map-legend"); // an empty box, filled by updateLegend()
legend.addTo(map);

function updateLegend() { // show the legend for the grid that is switched on
  const box = legend.getContainer(); // the legend's <div>
  const rows = (title, steps, note) =>
    `<b>${title}</b>` + steps.map(([, colour, label]) => `<div><i style="background:${colour}"></i>${label}</div>`).join("") + (note ? `<div class="muted">${note}</div>` : "");
  if (map.hasLayer(overlays.heat) && state.result) { // heat grid visible
    box.innerHTML = rows("Heat risk (roofs & roads vs shade)", HEAT_STEPS, "Thick outline = priority hotspot");
  } else if (map.hasLayer(overlays.suitability) && state.result) { // suitability grid visible
    box.innerHTML = rows(`Suitability for a ${state.result.purpose_label.toLowerCase()}`, SCORE_STEPS, "Click a cell for details");
  } else if (map.hasLayer(overlays.landcover) && state.result) { // only land cover visible
    box.innerHTML = "<b>Land cover</b>" + state.result.landcover.slice(0, 7).map((c) => `<div><i style="background:${c.color}"></i>${esc(c.name)}</div>`).join("");
  } else {
    box.innerHTML = "<b>Click the map</b>to analyse any place"; // nothing analysed yet
  }
}
map.on("overlayadd overlayremove", updateLegend); // refresh when layers are switched
updateLegend(); // first draw

map.on("click", (e) => { // clicking empty map picks a new place
  state.placeName = null; // no name for a clicked point
  analyse({ lat: e.latlng.lat, lon: L.Util.wrapNum(e.latlng.lng, [-180, 180], true) }); // keep longitude within ±180
});

// ---------- Talking to the backend ----------

async function geocode(query) { // asks the backend for places matching the typed text
  const res = await fetch(`${API_SEARCH}?q=${encodeURIComponent(query)}`); // call /api/search?q=...
  const data = await res.json(); // read the JSON reply
  if (!res.ok) throw new Error(data.error || "Search failed"); // backend reported an error
  return data.places; // list of { name, detail, lat, lon }
}

function settings() { // the analysis settings as an object
  return { lat: state.point.lat, lon: state.point.lon, area: areaSelect.value, purpose: state.purpose, scale: scaleInput.value };
}

async function analyse(point) { // scores the chosen place and shows the result
  if (point) state.point = point; // remember a newly chosen point
  if (!state.point) return; // nothing chosen yet
  if (!scaleInput.reportValidity()) return; // size box out of range: the browser shows why

  const id = ++state.requestId; // number this request
  outline.clearLayers(); // show the chosen point straight away
  L.circleMarker([state.point.lat, state.point.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#4f8cff", fillOpacity: 1 }).addTo(outline);
  setStatus("Reading satellite data (land cover, population, terrain, climate)…"); // tell the user we're waiting

  try {
    const res = await fetch(`${API_ANALYZE}?${new URLSearchParams(settings())}`); // call /api/analyze
    const data = await res.json(); // read the reply
    if (id !== state.requestId) return; // a newer request has started; drop this one
    if (!res.ok) throw new Error(data.error || "Analysis failed"); // backend error message
    state.result = data; // remember it
    showResult(data); // fill the panel
    drawResult(data); // draw on the map
    setStatus(data.warnings.length ? `Done, with missing data: ${data.warnings.join("; ")}` : "Done. Click grid cells and pins for details.");
  } catch (err) {
    if (id !== state.requestId) return; // ignore failures of outdated requests
    console.error(err); // details in the developer console
    setStatus(`Could not analyse: ${err.message}`, true); // red message
  }
}

// ---------- Drawing on the map ----------

function cellPopup(cell, r) { // popup shown when a grid cell is clicked
  const div = document.createElement("div"); // build it as a DOM element so the button can have a listener
  div.className = "cell-pop";
  div.innerHTML =
    `<b>Score ${fmt(cell.score)}/100</b><br>` +
    `Mostly ${esc(cell.main_cover)}<br>` +
    `Trees ${fmt(cell.tree_pct)}% · Built-up ${fmt(cell.built_pct)}% · Water ${fmt(cell.water_pct)}%<br>` +
    `Open land ${fmt(cell.buildable_pct)}% · Trees/wetland ${fmt(cell.sensitive_pct)}%<br>` +
    (cell.people != null ? `Residents ~${fmt(cell.people)}<br>` : "") +
    (cell.low_lying_pct != null ? `Flood-prone land ${fmt(cell.low_lying_pct)}%<br>` : "") +
    `<span class="muted">Cell is ${fmt(r.location.width_km / 10, 1)} km wide</span><br>`;
  const btn = document.createElement("button"); // re-centre the analysis on this cell
  btn.textContent = "Analyse around here";
  btn.addEventListener("click", () => {
    map.closePopup(); // close the popup first
    state.placeName = null; // a cell has no name
    analyse({ lat: cell.center[0], lon: cell.center[1] });
  });
  div.appendChild(btn);
  return div;
}

function pin(text, colour) { // round numbered marker
  return L.divIcon({ className: "", html: `<div class="spot-pin" style="background:${colour}">${text}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
}

function drawResult(r) { // draws the analysis on the map
  Object.values(overlays).forEach((layer) => layer.clearLayers()); // remove the previous result
  state.cellLayers = { suitability: {}, heat: {} }; // forget old rectangles
  state.spotMarkers = []; // and old pins

  L.rectangle(r.location.bounds, { color: "#ffffff", weight: 2, dashArray: "6 4", fill: false, interactive: false }).addTo(outline); // analysed square
  L.imageOverlay(r.overlay.png, r.overlay.bounds, { opacity: 0.65 }).addTo(overlays.landcover); // land-cover picture

  const hotKeys = new Set(r.hotspots.map((h) => `${h.row},${h.col}`)); // which cells are priority hotspots
  for (const cell of r.cells) { // one rectangle per cell in each grid
    const key = `${cell.row},${cell.col}`;
    const common = { weight: 0.6, color: "#0b1020", bubblingMouseEvents: false }; // thin dark border; clicks don't reach the map
    state.cellLayers.suitability[key] = L.rectangle(cell.bounds, { ...common, fillColor: scoreColor(cell.score), fillOpacity: 0.5 })
      .bindPopup(() => cellPopup(cell, r)).addTo(overlays.suitability);
    const heat = heatColor(cell.heat_risk); // null for cool cells
    const hot = hotKeys.has(key); // priority hotspot?
    state.cellLayers.heat[key] = L.rectangle(cell.bounds, {
      ...common,
      fillColor: heat || "#000", fillOpacity: heat ? 0.55 : 0, // cool cells stay see-through
      color: hot ? "#ffffff" : "#0b1020", weight: hot ? 3 : 0.6, // thick white outline marks hotspots
    }).bindPopup(() => cellPopup(cell, r)).addTo(overlays.heat);
  }
  for (const spot of r.candidates) { // numbered pins for the best spots
    const marker = L.marker(spot.center, { icon: pin(spot.rank, "#4f8cff") })
      .bindPopup(`<b>Best spot ${spot.rank} · ${spot.score}/100</b><br>${esc(spot.reason)}`).addTo(overlays.spots);
    state.spotMarkers.push(marker);
  }

  const showHeat = r.purpose === "township"; // townships care about heat hotspots, data centres about suitability
  map.removeLayer(overlays.landcover); // land cover is off by default (switch it on in the layer menu)
  map.addLayer(showHeat ? overlays.heat : overlays.suitability); // the grid that fits the purpose
  map.removeLayer(showHeat ? overlays.suitability : overlays.heat); // and hide the other
  map.addLayer(overlays.spots); // pins on top
  updateLegend(); // match the legend to the visible grid
  map.fitBounds(r.location.bounds, { padding: [24, 24] }); // zoom to the analysed area
}

function focusCell(cell, grid) { // zoom to a cell and open its popup (used by the lists)
  map.addLayer(overlays[grid]); // make sure that grid is visible
  const layer = state.cellLayers[grid][`${cell.row},${cell.col}`]; // its rectangle
  map.flyToBounds(cell.bounds, { padding: [60, 60], maxZoom: 15 }); // zoom in smoothly
  map.once("moveend", () => layer.openPopup()); // open the popup once the map stops moving
  updateLegend();
}

// ---------- Filling in the panel ----------

function showResult(r) { // fills the results panel
  results.hidden = false; // make it visible

  const ring = $("ring-fg"); // the coloured part of the gauge
  const circumference = 2 * Math.PI * 52; // length of the circle (radius 52)
  ring.style.strokeDasharray = circumference; // one dash as long as the circle...
  ring.style.strokeDashoffset = circumference * (1 - r.overall / 100); // ...shifted so only "score %" shows
  ring.style.stroke = VERDICT_COLORS[r.verdict.level]; // green / amber / red
  $("score").textContent = r.overall; // the number
  const verdict = $("verdict");
  verdict.className = `verdict ${r.verdict.level}`; // colour class
  verdict.textContent = `${VERDICT_ICONS[r.verdict.level]} ${r.verdict.label}`; // icon + words
  $("place-name").textContent = `${state.placeName || "Selected location"} · ${r.purpose_label}`;
  const scaleText = r.purpose === "datacentre" ? `${fmt(r.size)} MW` : `${fmt(r.size)} new residents`;
  $("coords").textContent = `${r.location.lat.toFixed(4)}°, ${r.location.lon.toFixed(4)}° · ${r.location.width_km} km area · ${scaleText}`;

  $("flags").innerHTML = r.flags.map((f) => `<li class="${f.level}">${esc(f.text)}</li>`).join(""); // red flags

  $("factors").innerHTML = r.factors.map((f) => // one row per factor
    `<li><div class="factor-head"><span>${esc(f.label)} <span class="w">· weight ${f.weight}%</span></span>` +
    `<b>${f.score == null ? "no data" : f.score}</b></div>` +
    `<div class="factor-bar${f.score == null ? " na" : ""}" title="${esc(f.label)}: ${f.score ?? "no data"}/100"><span style="width:${f.score ?? 0}%"></span></div>` +
    `<p>${esc(f.detail)}</p></li>`).join("");

  const m = r.metrics, c = r.climate || {}; // shortcuts
  const tiles = [ // [value, label]
    [`${fmt(m.tree_pct, 1)}%`, "Tree canopy"],
    [`${fmt(m.built_pct, 1)}%`, "Built-up"],
    [`${fmt(m.water_pct, 1)}%`, "Surface water"],
    [fmt(m.people), "Residents in area"],
    [c.rain_mm_year != null ? `${fmt(c.rain_mm_year)} mm` : "–", "Rain per year"],
    [c.mean_temp_c != null ? `${c.mean_temp_c} °C` : "–", "Average temp"],
    [c.hottest_month_max_c != null ? `${c.hottest_month_max_c} °C` : "–", "Hottest-month high"],
    [m.low_lying_pct != null ? `${fmt(m.low_lying_pct, 1)}%` : "–", "Flood-prone land"],
    [`${fmt(m.sensitive_pct, 1)}%`, "Trees & wetland"],
  ];
  $("metrics").innerHTML = tiles.map(([v, label]) => `<div class="tile"><b>${v}</b><span>${label}</span></div>`).join("");

  const bar = $("cover-bar"); // land-cover stacked bar
  bar.innerHTML = r.landcover.filter((l) => l.pct >= 0.5).map((l) => // tiny classes are left out of the bar (still in the legend)
    `<span style="flex:${l.pct};background:${l.color}" title="${esc(l.name)}: ${l.pct}%"></span>`).join("");
  bar.setAttribute("aria-label", "Land cover: " + r.landcover.map((l) => `${l.name} ${l.pct}%`).join(", "));
  $("cover-legend").innerHTML = r.landcover.filter((l) => l.pct >= 0.1).map((l) => // skip classes that round to 0%
    `<li><i style="background:${l.color}"></i>${esc(l.name)}<em>${l.pct}%</em></li>`).join("");

  $("recs").innerHTML = r.recommendations.map((x) =>
    `<li><b><span class="tag">${TAG_ICONS[x.tag] || "•"}</span>${esc(x.title)}</b><p>${esc(x.text)}</p></li>`).join("");

  const spots = $("spots"); // best spots list
  spots.innerHTML = r.candidates.length ? "" : `<li class="empty">No cell has enough open land away from forest and water. Try a bigger area.</li>`;
  r.candidates.forEach((spot, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="num">${spot.rank}</span><div><b>${spot.score}/100</b><p>${esc(spot.reason)}</p></div>`;
    li.addEventListener("click", () => { // zoom to the spot and open its pin
      map.addLayer(overlays.spots);
      map.flyTo(spot.center, Math.max(map.getZoom(), 14));
      map.once("moveend", () => state.spotMarkers[i].openPopup());
    });
    spots.appendChild(li);
  });

  const isTownship = r.purpose === "township"; // hotspots only matter for townships
  $("hot-title").hidden = $("hotspots").hidden = !isTownship;
  const hotspots = $("hotspots");
  hotspots.innerHTML = r.hotspots.length ? "" : `<li class="empty">No strong heat hotspots — built-up areas here already have shade.</li>`;
  for (const h of r.hotspots) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="num">${h.rank}</span><div><b>${fmt(h.built_pct)}% built-up, ${fmt(h.tree_pct, 1)}% trees</b>` +
      `<p>Plant ~${fmt(h.trees_needed)} trees: ${esc(h.action)}.</p></div>`;
    li.addEventListener("click", () => focusCell(h, "heat"));
    hotspots.appendChild(li);
  }

  const w = r.water; // water budget table
  const stressLabel = (s) => (s < 0.1 ? "low" : s < 0.2 ? "low–medium" : s < 0.4 ? "medium–high" : s < 0.8 ? "high" : "extremely high");
  $("water").innerHTML = w
    ? `<tr><td>Usable rain-fed water (${w.catchment_km} km area)</td><td>${fmt(w.supply_m3)} m³</td></tr>` +
      `<tr><td>Used by existing residents</td><td>${fmt(w.residents_m3)} m³</td></tr>` +
      `<tr><td>Used by this ${r.purpose === "datacentre" ? "data centre" : "township"}</td><td>${fmt(w.new_m3)} m³</td></tr>` +
      `<tr><td><b>Share of supply used</b></td><td><b>${fmt(w.stress * 100)}% (${stressLabel(w.stress)})</b></td></tr>`
    : `<tr><td class="muted">Rainfall data unavailable, so the water budget could not be estimated.</td><td></td></tr>`;

  const a = r.assumptions; // data sources, assumptions, warnings
  $("sources").innerHTML = r.sources.map((s) => `<li>${esc(s)}</li>`).join("");
  $("assumptions").innerHTML = [
    `Data centre cooling uses ${a.dc_water_l_per_kwh} L of water per kWh (industry average)`,
    `Each resident uses ${a.litres_per_person_day} L of water a day`,
    `${a.usable_rain_share * 100}% of rainfall becomes usable river/ground water`,
    `Tree canopy target ${a.canopy_target_pct}% (3-30-300 rule); one street tree shades ~50 m²`,
    `Flood-prone = less than ${a.low_lying_m} m above water within 1 km; steep = over ${a.steep_slope_pct}% slope`,
    "ESA WorldCover counts plantations (oil palm, rubber) as tree cover — check on the ground which trees are natural forest",
  ].map((s) => `<li>${esc(s)}</li>`).join("");
  $("warnings").innerHTML = r.warnings.map((s) => `<li>${esc(s)}</li>`).join("");
}

// ---------- Search and controls ----------

function renderSuggestions(places) { // clickable list of other matching places
  suggestions.innerHTML = ""; // clear the old list
  for (const p of places) {
    const li = document.createElement("li");
    li.textContent = p.name; // short name
    const small = document.createElement("small");
    small.textContent = p.detail; // full name underneath
    li.appendChild(small);
    li.addEventListener("click", () => { // choose this place
      suggestions.hidden = true;
      placeInput.value = p.name;
      state.placeName = p.name;
      analyse({ lat: p.lat, lon: p.lon });
    });
    suggestions.appendChild(li);
  }
  suggestions.hidden = places.length < 2; // only worth showing with more than one choice
}

async function searchPlace(query) { // finds a place by name and analyses the best match
  searchBtn.disabled = true; // grey out the button while searching
  suggestions.hidden = true; // hide old suggestions
  setStatus(`Searching for “${query}”…`);
  try {
    const places = await geocode(query); // ask the backend where this is
    if (!places.length) {
      setStatus(`No place found for “${query}”.`, true);
      return;
    }
    state.placeName = places[0].name; // best match
    renderSuggestions(places); // list the others
    map.setView([places[0].lat, places[0].lon], 11); // jump there right away
    await analyse({ lat: places[0].lat, lon: places[0].lon }); // and analyse it
  } catch (err) {
    console.error(err);
    setStatus(`Could not search: ${err.message}. You can still click the map.`, true);
  } finally {
    searchBtn.disabled = false; // re-enable the button
  }
}

form.addEventListener("submit", (e) => { // Search clicked or Enter pressed
  e.preventDefault(); // stop the page reloading
  const query = placeInput.value.trim();
  if (query) searchPlace(query);
});

document.querySelectorAll(".chip").forEach((chip) => // quick demo places
  chip.addEventListener("click", () => {
    placeInput.value = chip.textContent;
    searchPlace(chip.dataset.q);
  }));

function setPurpose(purpose) { // switch between data centre and township
  state.purpose = purpose;
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.purpose === purpose)));
  const s = SCALE[purpose]; // matching size settings
  scaleLabel.textContent = s.label;
  Object.assign(scaleInput, { min: s.min, max: s.max, step: s.step, value: s.value });
}

document.querySelectorAll(".seg button").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.purpose === state.purpose) return; // already chosen
    setPurpose(b.dataset.purpose);
    analyse(); // re-score the same place
  }));
scaleInput.addEventListener("change", () => analyse()); // new size: re-score
areaSelect.addEventListener("change", () => analyse()); // new area: re-score
