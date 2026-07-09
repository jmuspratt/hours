const STORAGE_KEY = "hours_data";
const TIMESTAMP_KEY = "hours_updated";
const TRACKED_IDS_KEY = "hours_tracked_ids";
const STALE_MS = 7 * 24 * 60 * 60 * 1000; // refresh tracked hours after a week
// Ships inside this unminified file, so it's abuse-deterrence against
// scripted hammering of /api/*, not real authentication.
const APP_SHARED_SECRET = "PMsvFX-f2jc7";
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// --- Time helpers ---

function formatHour(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const hour = h % 12 || 12;
  return m === 0
    ? `${hour} ${period}`
    : `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function getHoursForDate(business, date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const override = business.hours.overrides?.find((o) => o.date === dateStr);
  if (override !== undefined) return override.hours; // null = closed, {open,close} = modified

  const dayKey = DAYS[date.getDay()];
  return business.hours.regular[dayKey] ?? null;
}

// Returns { label, openClass } for a business at `now`
function getStatus(business, now) {
  const todayHours = getHoursForDate(business, now);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (todayHours) {
    const openMins = toMinutes(todayHours.open);
    const closeMins = toMinutes(todayHours.close);

    if (nowMins >= openMins && nowMins < closeMins) {
      return {
        label: `<span class="open">Open</span> · Closes ${formatHour(todayHours.close)}`,
        isOpen: true,
      };
    }

    if (nowMins < openMins) {
      return {
        label: `<span class="closed">Closed</span> · Opens ${formatHour(todayHours.open)} today`,
        isOpen: false,
      };
    }
  }

  // Closed for rest of today — find next open day
  for (let i = 1; i <= 7; i++) {
    const nextDate = new Date(now);
    nextDate.setDate(now.getDate() + i);
    const nextHours = getHoursForDate(business, nextDate);
    if (nextHours) {
      const dayLabel =
        i === 1
          ? "tomorrow"
          : nextDate.toLocaleDateString("en-US", { weekday: "long" });
      return {
        label: `<span class="closed">Closed</span> · Opens ${formatHour(nextHours.open)} ${dayLabel}`,
        isOpen: false,
      };
    }
  }

  return { label: `<span class="closed">Closed today</span>`, isOpen: false };
}

function buildScheduleHTML(business) {
  const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const reg = business.hours.regular;

  // Group consecutive days with identical hours
  const groups = [];
  let i = 0;
  while (i < 7) {
    const h = reg[DAY_KEYS[i]] ?? null;
    const hKey = h ? `${h.open}|${h.close}` : "null";
    let j = i + 1;
    while (j < 7) {
      const nh = reg[DAY_KEYS[j]] ?? null;
      if ((nh ? `${nh.open}|${nh.close}` : "null") !== hKey) break;
      j++;
    }
    groups.push({ start: i, end: j - 1, hours: h });
    i = j;
  }

  let html = '<div class="biz-schedule">';

  for (const g of groups) {
    const dayLabel =
      g.start === g.end
        ? DAY_LABELS[g.start]
        : `${DAY_LABELS[g.start]}–${DAY_LABELS[g.end]}`;
    const hoursStr = g.hours
      ? `${formatHour(g.hours.open)}–${formatHour(g.hours.close)}`
      : "Closed";
    html += `<span class="schedule-day">${dayLabel}</span><span class="schedule-hours">${hoursStr}</span>`;
  }

  // Upcoming overrides only
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = (business.hours.overrides || [])
    .filter((o) => o.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (upcoming.length > 0) {
    html += '<span class="schedule-override-rule"></span><span></span>';
    for (const o of upcoming) {
      const [y, mo, d] = o.date.split("-").map(Number);
      const dateLabel = new Date(y, mo - 1, d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const label = o.reason ? `${dateLabel} (${o.reason})` : dateLabel;
      const hoursStr = o.hours
        ? `${formatHour(o.hours.open)}–${formatHour(o.hours.close)}`
        : "Closed";
      html += `<span class="schedule-day schedule-override">${label}</span><span class="schedule-hours">${hoursStr}</span>`;
    }
  }

  html += "</div>";
  return html;
}

// --- Render ---

function categoryLabel(cat) {
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

let currentBusinesses = [];

// Per-business freshness, not a global one — different businesses can have
// been fetched at different times (e.g. one just added, others days old),
// so a single app-wide "Updated X ago" badge was actively misleading.
function relativeUpdatedLabel(isoTimestamp) {
  if (!isoTimestamp) return "";
  const diff = Date.now() - new Date(isoTimestamp).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (mins < 2) return "Updated just now";
  if (mins < 60) return `Updated ${mins} minutes ago`;
  if (hours < 24) return `Updated ${hours} hour${hours > 1 ? "s" : ""} ago`;
  return `Updated ${days} day${days > 1 ? "s" : ""} ago`;
}

function buildRow(business, now) {
  const { label } = getStatus(business, now);
  const scheduleHTML = buildScheduleHTML(business);
  const phoneHTML = business.phone
    ? `<a class="biz-call" href="tel:${business.phone}">${business.phone}</a>`
    : "";
  const mapsURL =
    business.lat != null
      ? `https://maps.apple.com/?ll=${business.lat},${business.lng}&q=${encodeURIComponent(business.name)}`
      : null;
  const mapsHTML =
    mapsURL && business.address
      ? `<a class="biz-maps" href="${mapsURL}" target="_blank">${business.address}</a>`
      : "";
  const updatedLabel = relativeUpdatedLabel(business.lastUpdated);

  const li = document.createElement("li");
  li.className = "biz-row";
  li.dataset.category = business.category;
  li.innerHTML = `
    <div class="biz-main">
      <div class="biz-header">
        <span class="biz-chevron"></span>
        <div class="biz-name">${business.name}</div>
        <div class="biz-status">${label}</div>
      </div>
      <div class="biz-accordion">
        ${scheduleHTML}
        <div class="biz-footer">
          <div class="biz-contact">${phoneHTML}${mapsHTML}</div>
          <span class="biz-updated">${updatedLabel}</span>
        </div>
      </div>
    </div>`;

  return li;
}

function renderFilters() {
  const scroll = document.getElementById("filter-scroll");
  scroll.innerHTML = "";

  const categories = [
    ...new Set(currentBusinesses.map((b) => b.category)),
  ].sort();
  for (const f of activeFilters) {
    if (!categories.includes(f)) activeFilters.delete(f);
  }

  for (const cat of categories) {
    const btn = document.createElement("button");
    btn.className = "filter-btn";
    btn.dataset.filter = cat;
    btn.textContent = categoryLabel(cat);
    if (activeFilters.has(cat)) btn.classList.add("active");
    scroll.appendChild(btn);
  }
}

function renderList() {
  const list = document.getElementById("business-list");
  const now = new Date();
  list.innerHTML = "";

  const isEmpty = currentBusinesses.length === 0;
  document
    .getElementById("filter-bar")
    .classList.toggle("empty-state", isEmpty);
  list.classList.toggle("empty-state", isEmpty);

  if (isEmpty) {
    list.innerHTML = `
      <li class="onboarding-empty">
        <p>Track the open hours of your favorite restaurants and shops in one simple list.</p>
        <button id="onboarding-add-btn" class="cta-btn">Add businesses...</button>
      </li>
    `;
    document.getElementById("clear-btn").classList.remove("visible");
    return;
  }

  if (activeFilters.size === 0) {
    // Group by category (alphabetized), businesses sorted by name within each group
    const groups = {};
    for (const biz of currentBusinesses) {
      (groups[biz.category] ??= []).push(biz);
    }
    for (const cat of Object.keys(groups).sort()) {
      const header = document.createElement("li");
      header.className = "category-header";
      header.textContent = categoryLabel(cat);
      list.appendChild(header);
      for (const biz of groups[cat].sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        list.appendChild(buildRow(biz, now));
      }
    }
  } else {
    // Flat filtered list, sorted by name
    const filtered = currentBusinesses
      .filter((b) => activeFilters.has(b.category))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const biz of filtered) {
      list.appendChild(buildRow(biz, now));
    }
  }

  document
    .getElementById("clear-btn")
    .classList.toggle("visible", activeFilters.size > 0);
}

// Single entry point for "something changed, redraw whatever's visible."
// Every mutation (filters, edit-mode add/remove/category, background
// refresh) calls this instead of remembering which specific sub-render
// functions apply — cheap enough at this list size to just redraw all of
// them every time, and it removes an entire class of "forgot to re-render
// view X" bugs.
function scheduleRender() {
  renderFilters();
  renderList();
  renderEditCurrent();
  renderEditResults();
}

function render(businesses) {
  currentBusinesses = businesses;
  scheduleRender();
}

// --- Filters ---

let activeFilters = new Set();

function applyFilters() {
  renderList();
  document.getElementById("business-list").scrollTop = 0;
  window.scrollTo(0, 0);
}

document.getElementById("filter-bar").addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  const f = btn.dataset.filter;
  const wasActive = activeFilters.has(f);
  activeFilters.clear();
  document
    .querySelectorAll(".filter-btn")
    .forEach((b) => b.classList.remove("active"));
  if (!wasActive) {
    activeFilters.add(f);
    btn.classList.add("active");
  }
  applyFilters();
});

document.getElementById("clear-btn").addEventListener("click", () => {
  activeFilters.clear();
  document
    .querySelectorAll(".filter-btn")
    .forEach((b) => b.classList.remove("active"));
  applyFilters();
});

document.getElementById("business-list").addEventListener("click", (e) => {
  if (e.target.closest("#onboarding-add-btn")) {
    enterEditMode("search");
    return;
  }
  if (e.target.closest("a")) return;
  const row = e.target.closest(".biz-row");
  if (row) row.classList.toggle("expanded");
});

// --- Data loading ---

function loadData() {
  const cached = localStorage.getItem(STORAGE_KEY);

  if (cached) {
    render(JSON.parse(cached));
    refreshIfStale();
    return;
  }

  // No personal list yet on this device — nothing to seed from anymore.
  // renderList() shows the onboarding empty state for an empty list.
  render([]);
}

// Silent background freshness check — never blocks render, never shown to
// the user. Refreshes hours for every tracked business without ever
// touching name/category, so the user's own overrides survive.
async function refreshIfStale() {
  const ts = localStorage.getItem(TIMESTAMP_KEY);
  if (ts && Date.now() - new Date(ts).getTime() < STALE_MS) return;

  const trackedIds = JSON.parse(localStorage.getItem(TRACKED_IDS_KEY) || "[]");
  if (trackedIds.length === 0) return;

  try {
    const res = await fetch("/api/details", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Secret": APP_SHARED_SECRET,
      },
      body: JSON.stringify({ placeIds: trackedIds }),
    });
    if (!res.ok) throw new Error(res.status);
    const updates = await res.json();
    const byId = new Map(updates.map((u) => [u.placeId, u]));

    for (const biz of currentBusinesses) {
      const u = byId.get(biz.placeId);
      if (!u) continue;
      biz.hours = u.hours;
      biz.phone = u.phone;
      biz.address = u.address;
      biz.lat = u.lat;
      biz.lng = u.lng;
      biz.lastUpdated = u.lastUpdated;
      // name/category intentionally left untouched
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentBusinesses));
    localStorage.setItem(TIMESTAMP_KEY, new Date().toISOString());
    scheduleRender();
  } catch {
    // Offline or server unreachable — silently keep showing cached data.
  }
}

// --- Edit mode ---

let pendingAdds = new Map(); // placeId -> { placeId, name, address, category }
let pendingRemoves = new Set(); // placeId
let userLocation = null; // { lat, lng } once geolocation resolves
let locationRequested = false;
let lastSearchResults = []; // so both edit-results and edit-current can re-render in sync

// Best-effort, silent — requested once per page load. If granted and the
// search fields are still empty, auto-runs a "nearby" search so Edit mode
// shows something without the user typing anything. Falls back to manual
// zip/query entry if denied, unsupported, or slow.
function requestLocationOnce() {
  if (locationRequested || !("geolocation" in navigator)) return;
  locationRequested = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const zipEmpty = !document.getElementById("edit-zip").value.trim();
      const queryEmpty = !document.getElementById("edit-query").value.trim();
      if (zipEmpty && queryEmpty) searchBusinesses();
    },
    () => {
      // Denied or unavailable — manual zip/query entry still works.
    },
    { timeout: 5000 },
  );
}

function switchEditTab(tab) {
  document
    .querySelectorAll(".edit-tab-btn")
    .forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  document.getElementById("edit-tab-current").hidden = tab !== "current";
  document.getElementById("edit-tab-search").hidden = tab !== "search";
}

function enterEditMode(tab = "current") {
  pendingAdds = new Map();
  pendingRemoves = new Set();
  lastSearchResults = [];
  document.getElementById("edit-btn").textContent = "Save";
  document.getElementById("edit-btn").classList.add("active");
  document.getElementById("filter-bar").classList.add("editing");
  document.getElementById("business-list").hidden = true;
  document.getElementById("edit-panel").hidden = false;
  switchEditTab(tab);
  scheduleRender();

  if (userLocation) searchBusinesses();
  else requestLocationOnce();
}

async function exitEditMode() {
  document.getElementById("edit-btn").textContent = "Settings";
  document.getElementById("edit-btn").classList.remove("active");
  document.getElementById("filter-bar").classList.remove("editing");
  document.getElementById("business-list").hidden = false;
  document.getElementById("edit-panel").hidden = true;

  let changed = false;

  if (pendingRemoves.size > 0) {
    currentBusinesses = currentBusinesses.filter(
      (b) => !pendingRemoves.has(b.placeId),
    );
    changed = true;
  }

  if (pendingAdds.size > 0) {
    try {
      const res = await fetch("/api/details", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Secret": APP_SHARED_SECRET,
        },
        body: JSON.stringify({ placeIds: [...pendingAdds.keys()] }),
      });
      if (res.ok) {
        const details = await res.json();
        for (const d of details) {
          const pending = pendingAdds.get(d.placeId);
          if (!pending) continue;
          currentBusinesses.push({
            id: slugify(d.name),
            name: d.name,
            category: pending.category,
            placeId: d.placeId,
            phone: d.phone,
            address: d.address,
            lat: d.lat,
            lng: d.lng,
            hours: d.hours,
            lastUpdated: d.lastUpdated,
          });
        }
        changed = true;
      }
    } catch {
      // Offline or server unreachable — additions are simply dropped
      // this session; the user can retry in Edit mode later.
    }
  }

  pendingAdds = new Map();
  pendingRemoves = new Set();

  if (changed) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentBusinesses));
    localStorage.setItem(
      TRACKED_IDS_KEY,
      JSON.stringify(currentBusinesses.map((b) => b.placeId).filter(Boolean)),
    );
    localStorage.setItem(TIMESTAMP_KEY, new Date().toISOString());
  }
  scheduleRender();
}

function renderEditCurrent() {
  const list = document.getElementById("edit-current");
  list.innerHTML = "";
  const sorted = [...currentBusinesses].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const existingCategories = new Set(currentBusinesses.map((b) => b.category));

  for (const biz of sorted) {
    const removed = pendingRemoves.has(biz.placeId);

    const categories = [
      ...new Set([...existingCategories, biz.category]),
    ].sort();
    const options =
      categories
        .map(
          (c) =>
            `<option value="${c}" ${c === biz.category ? "selected" : ""}>${categoryLabel(c)}</option>`,
        )
        .join("") +
      `<option value="${NEW_CATEGORY_VALUE}">New category…</option>`;

    const li = document.createElement("li");
    li.className = "edit-row";
    if (removed) li.style.opacity = "0.4";
    li.innerHTML = `
      <div class="edit-row-info">
        <div class="edit-row-name">${biz.name}</div>
      </div>
      <select class="edit-category-select" data-place-id="${biz.placeId}" ${removed ? "disabled" : ""}>${options}</select>
      <input type="text" class="edit-category-new-input" placeholder="Category name" hidden>
      <button class="edit-toggle-btn remove" data-place-id="${biz.placeId}">${removed ? "Removed" : "Remove"}</button>
    `;
    list.appendChild(li);
  }
}

// Category changes for already-tracked businesses apply immediately — no
// API call needed, so there's no reason to stage them like adds/removes.
function updateBusinessCategory(placeId, newCategory) {
  const biz = currentBusinesses.find((b) => b.placeId === placeId);
  if (!biz || !newCategory) return;
  biz.category = newCategory;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(currentBusinesses));
  scheduleRender();
}

const NEW_CATEGORY_VALUE = "__new__";

function renderEditResults() {
  const list = document.getElementById("edit-results");
  list.innerHTML = "";

  const existingCategories = new Set(currentBusinesses.map((b) => b.category));

  for (const r of lastSearchResults) {
    const trackedBiz = currentBusinesses.find((b) => b.placeId === r.placeId);
    const alreadyTracked = !!trackedBiz;
    // Already-tracked results toggle Remove ⇄ Add (staging/unstaging a
    // removal); new results toggle Add ⇄ Added (staging/unstaging an add).
    const pendingRemove = alreadyTracked && pendingRemoves.has(r.placeId);
    const added = pendingAdds.has(r.placeId);
    const btnLabel = alreadyTracked
      ? pendingRemove
        ? "Add"
        : "Remove"
      : added
        ? "Added"
        : "Add";
    const btnClass = alreadyTracked
      ? pendingRemove
        ? ""
        : "remove"
      : added
        ? "added"
        : "";

    // Already-tracked rows show/edit the business's real category; new
    // results default to Google's suggestion. Either way the current
    // value is guaranteed to appear even if it's not already in use —
    // that was the bug in the original <select>.
    const currentCategory = alreadyTracked
      ? trackedBiz.category
      : r.suggestedCategory;
    const categories = [
      ...new Set([...existingCategories, currentCategory]),
    ].sort();
    const options =
      categories
        .map(
          (c) =>
            `<option value="${c}" ${c === currentCategory ? "selected" : ""}>${categoryLabel(c)}</option>`,
        )
        .join("") +
      `<option value="${NEW_CATEGORY_VALUE}">New category…</option>`;

    const li = document.createElement("li");
    li.className = "edit-row";
    li.innerHTML = `
      <div class="edit-row-info">
        <div class="edit-row-name">${r.name}</div>
        <div class="edit-row-address">${r.address ?? ""}</div>
      </div>
      <select class="edit-category-select" data-place-id="${r.placeId}" ${pendingRemove ? "disabled" : ""}>${options}</select>
      <input type="text" class="edit-category-new-input" placeholder="Category name" hidden>
      <button class="edit-toggle-btn ${btnClass}" data-place-id="${r.placeId}" data-name="${r.name}" data-address="${r.address ?? ""}">
        ${btnLabel}
      </button>
    `;
    list.appendChild(li);
  }
}

async function searchBusinesses() {
  const zip = document.getElementById("edit-zip").value.trim();
  const q = document.getElementById("edit-query").value.trim();
  const resultsEl = document.getElementById("edit-results");
  if (!zip && !q && !userLocation) return;

  resultsEl.innerHTML =
    '<li class="edit-row" style="color:var(--text-muted)">Searching…</li>';

  try {
    const params = new URLSearchParams();
    if (zip) params.set("zip", zip);
    if (q) params.set("q", q);
    if (userLocation) {
      params.set("lat", userLocation.lat);
      params.set("lng", userLocation.lng);
    }
    const res = await fetch(`/api/search?${params}`, {
      headers: { "X-App-Secret": APP_SHARED_SECRET },
    });
    if (!res.ok) throw new Error(res.status);
    lastSearchResults = await res.json();
    scheduleRender();
  } catch {
    resultsEl.innerHTML =
      '<li class="edit-row" style="color:var(--text-muted)">Search failed. Check your connection.</li>';
  }
}

document.getElementById("edit-btn").addEventListener("click", () => {
  if (document.getElementById("edit-panel").hidden) {
    enterEditMode();
  } else {
    exitEditMode();
  }
});

document.getElementById("edit-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".edit-tab-btn");
  if (btn) switchEditTab(btn.dataset.tab);
});

document
  .getElementById("edit-search-btn")
  .addEventListener("click", searchBusinesses);

for (const id of ["edit-zip", "edit-query"]) {
  document.getElementById(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchBusinesses();
  });
}

// Selecting "New category…" swaps the select for a plain text input.
function toggleRemoval(placeId) {
  if (pendingRemoves.has(placeId)) pendingRemoves.delete(placeId);
  else pendingRemoves.add(placeId);
  scheduleRender();
}

document.getElementById("edit-current").addEventListener("click", (e) => {
  const btn = e.target.closest(".edit-toggle-btn");
  if (!btn) return;
  toggleRemoval(btn.dataset.placeId);
});

document.getElementById("edit-results").addEventListener("click", (e) => {
  const btn = e.target.closest(".edit-toggle-btn");
  if (!btn) return;
  const placeId = btn.dataset.placeId;

  // Already-tracked businesses toggle a pending removal, same Set the
  // "Your businesses" list uses — keep both lists in sync.
  if (currentBusinesses.some((b) => b.placeId === placeId)) {
    toggleRemoval(placeId);
    return;
  }

  const row = btn.closest(".edit-row");
  const select = row.querySelector(".edit-category-select");
  const newInput = row.querySelector(".edit-category-new-input");
  const category = newInput.hidden
    ? select.value
    : newInput.value.trim().toLowerCase() || "shops";

  if (pendingAdds.has(placeId)) pendingAdds.delete(placeId);
  else {
    pendingAdds.set(placeId, {
      placeId,
      name: btn.dataset.name,
      address: btn.dataset.address,
      category,
    });
  }
  scheduleRender();
});

// Category editing is identical in both lists — selecting an existing
// category commits immediately (a no-op if this row isn't a tracked
// business yet, since updateBusinessCategory() guards on that itself);
// selecting "New category…" swaps the select for a plain text input.
function handleCategorySelectChange(e) {
  const select = e.target.closest(".edit-category-select");
  if (!select) return;
  if (select.value === NEW_CATEGORY_VALUE) {
    const newInput = select.nextElementSibling;
    select.hidden = true;
    newInput.hidden = false;
    newInput.focus();
    return;
  }
  updateBusinessCategory(select.dataset.placeId, select.value);
}

function handleCategoryInputKeydown(e) {
  if (e.key === "Enter" && e.target.closest(".edit-category-new-input")) {
    e.target.blur();
  }
}

function handleCategoryInputBlur(e) {
  const newInput = e.target.closest?.(".edit-category-new-input");
  if (!newInput || newInput.hidden) return;
  const select = newInput.previousElementSibling;
  const category = newInput.value.trim().toLowerCase();
  if (category) updateBusinessCategory(select.dataset.placeId, category);
  else scheduleRender(); // empty — revert to showing the select
}

for (const listId of ["edit-current", "edit-results"]) {
  const list = document.getElementById(listId);
  list.addEventListener("change", handleCategorySelectChange);
  list.addEventListener("keydown", handleCategoryInputKeydown);
  // blur doesn't bubble — listen on the capture phase to delegate it.
  list.addEventListener("blur", handleCategoryInputBlur, true);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });

  // When a new SW takes control (after skipWaiting), reload to get fresh files
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

loadData();
