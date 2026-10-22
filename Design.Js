// Design.Js — browser-side code. It talks only to our Python backend (app.py),
// which in turn calls NASA GIBS and the place-search services.

const API_SEARCH = "/api/search"; // backend address that turns a place name into coordinates
const API_IMAGE = "/api/image"; // backend address that returns the NASA satellite image

const form = document.getElementById("search-form"); // the whole search form
const placeInput = document.getElementById("place"); // the text box where you type a place
const layerSelect = document.getElementById("layer"); // dropdown to choose which NASA imagery
const dateInput = document.getElementById("date"); // date picker for which day's image
const sizeSelect = document.getElementById("size"); // dropdown for how wide an area to show
const searchBtn = document.getElementById("search-btn"); // the Search button
const suggestions = document.getElementById("suggestions"); // list of other matching places
const statusEl = document.getElementById("status"); // line of text for messages and errors
const result = document.getElementById("result"); // box that holds the image and its caption
const img = document.getElementById("sat-img"); // the <img> that shows the satellite picture
const loader = document.getElementById("loader"); // spinning circle shown while the image loads
const placeName = document.getElementById("place-name"); // bold place name under the image
const meta = document.getElementById("meta"); // grey details under the image (coords, layer, date)
const openLink = document.getElementById("open-link"); // "Open full image" link

let currentPlace = null; // remembers the place being shown, so option changes can reload it

const defaultDate = new Date(Date.now() - 3 * 86400000); // 3 days ago (86400000 ms = 1 day); NASA posts daily images 1–2 days late
dateInput.value = toISODate(defaultDate); // pre-fill the date picker with that day
dateInput.max = toISODate(new Date()); // stop the user picking a future date

function toISODate(d) { // turns a Date object into "YYYY-MM-DD" text
  return d.toISOString().slice(0, 10); // ISO string is "YYYY-MM-DDTHH:MM..." so keep the first 10 characters
}

function setStatus(msg, isError = false) { // shows a message under the form
  statusEl.textContent = msg; // put the text in
  statusEl.classList.toggle("error", isError); // add the red "error" style only when isError is true
}

// ---------- Talking to the backend ----------

async function geocode(query) { // asks the backend for places matching the typed text
  const res = await fetch(`${API_SEARCH}?q=${encodeURIComponent(query)}`); // call /api/search?q=..., encoding spaces etc.
  const data = await res.json(); // read the JSON reply
  if (!res.ok) throw new Error(data.error || "Search failed"); // if the backend reported an error, stop with that message
  return data.places; // the list of { name, detail, lat, lon }
}

function buildImageUrl(place) { // builds the backend address for the image of this place
  const params = new URLSearchParams({ // URLSearchParams safely joins values into "a=1&b=2"
    lat: place.lat, // latitude
    lon: place.lon, // longitude
    layer: layerSelect.value, // chosen NASA layer name
    date: dateInput.value, // chosen date
    size: sizeSelect.value, // area width in km
  });
  return `${API_IMAGE}?${params}`; // e.g. /api/image?lat=35.6&lon=139.7&layer=...
}

function showImage(place) { // displays the satellite image for a place
  currentPlace = place; // remember it for later option changes
  const url = buildImageUrl(place); // backend URL for the picture
  const option = layerSelect.selectedOptions[0]; // the <option> currently chosen in the imagery dropdown

  result.hidden = false; // make the image box visible
  loader.hidden = false; // show the spinner
  placeName.textContent = place.name; // write the place name under the image
  meta.textContent = // write the details line:
    `${place.lat.toFixed(4)}°, ${place.lon.toFixed(4)}° · ${option.textContent} · ` + // coordinates (4 decimals) and layer name
    (option.dataset.static ? "composite" : dateInput.value) + // date, or "composite" for Blue Marble
    ` · ${sizeSelect.value} km wide`; // area width
  openLink.href = url; // "Open full image" points at the same picture
  setStatus("Loading NASA imagery…"); // tell the user we're waiting

  img.onload = () => { // runs when the picture has finished downloading
    loader.hidden = true; // hide the spinner
    setStatus( // show a tip, except for Blue Marble which is always complete
      option.dataset.static
        ? "" // Blue Marble: no message
        : "Black or blank areas mean no satellite pass / clouds that day — try another date or layer."
    );
  };
  img.onerror = () => { // runs if the backend returned an error instead of a picture
    loader.hidden = true; // hide the spinner
    setStatus("NASA imagery failed to load. Try a different date or imagery layer.", true); // show a red error
  };
  img.src = url; // setting src starts the download
}

// ---------- UI wiring ----------

function renderSuggestions(places) { // shows the clickable list of other matching places
  suggestions.innerHTML = ""; // clear any old list
  for (const p of places) { // for each place found...
    const li = document.createElement("li"); // make a list item
    li.textContent = p.name; // with the short name
    const small = document.createElement("small"); // and a smaller line
    small.textContent = p.detail; // holding the full name (city, country)
    li.appendChild(small); // put the small line inside the item
    li.addEventListener("click", () => { // when the item is clicked...
      suggestions.hidden = true; // hide the list
      placeInput.value = p.name; // put that name in the search box
      showImage(p); // and show its image
    });
    suggestions.appendChild(li); // add the item to the list
  }
  suggestions.hidden = places.length < 2; // only show the list if there is more than one choice
}

form.addEventListener("submit", async (e) => { // runs when Search is clicked or Enter is pressed
  e.preventDefault(); // stop the browser reloading the page (the default form behaviour)
  const query = placeInput.value.trim(); // the typed text without leading/trailing spaces
  if (!query) return; // do nothing if it's empty

  searchBtn.disabled = true; // grey out the button so it isn't clicked twice
  suggestions.hidden = true; // hide any old suggestions
  setStatus(`Searching for “${query}”…`); // tell the user we're searching

  try {
    const places = await geocode(query); // ask the backend where this place is
    if (!places.length) { // nothing found
      setStatus(`No place found for “${query}”.`, true); // show a red message
      return; // stop here
    }
    showImage(places[0]); // show the best match straight away
    renderSuggestions(places); // and list the other matches
  } catch (err) { // the search failed (backend down, no internet, etc.)
    console.error(err); // print details in the browser's developer console
    setStatus(`Could not search: ${err.message}. Is app.py running?`, true); // show a red message
  } finally { // runs whether it worked or not
    searchBtn.disabled = false; // re-enable the button
  }
});

for (const el of [layerSelect, dateInput, sizeSelect]) { // for each option control...
  el.addEventListener("change", () => { // when its value changes...
    if (currentPlace) showImage(currentPlace); // reload the image for the current place
  });
}
