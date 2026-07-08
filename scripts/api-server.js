#!/usr/bin/env node
// Persistent proxy service for Edit-mode: lets the PWA search Google Places
// by zip, text query, and/or device location, and fetch hours for placeIds
// — without ever shipping the API key to the browser. Stateless — nothing
// is persisted here, it's a pass-through.
// Usage: node scripts/api-server.js  (reads .env for config)

import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import {
  parseRegularHours,
  parseOverrides,
} from "./lib/hours-parser.js";
import { mapPrimaryTypeToCategory } from "./lib/category-map.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Load .env without any external dependencies
const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error("Error: GOOGLE_PLACES_API_KEY is not set.");
  console.error("  Add it to .env: GOOGLE_PLACES_API_KEY=your_key_here");
  process.exit(1);
}

const PORT = process.env.API_PORT || 8787;
const APP_SHARED_SECRET = process.env.APP_SHARED_SECRET;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";

if (!APP_SHARED_SECRET) {
  console.error("Error: APP_SHARED_SECRET is not set.");
  console.error("  Add it to .env: APP_SHARED_SECRET=some-random-string");
  process.exit(1);
}

const DETAILS_FIELD_MASK =
  "id,displayName,nationalPhoneNumber,shortFormattedAddress,location,regularOpeningHours,currentOpeningHours";

// --- In-memory per-IP rate limiting ---
// Deliberately volatile (resets on restart) — this is abuse deterrence for a
// personal-scale proxy, not a hardened API gateway.
const RATE_LIMITS = { search: 30, details: 10 }; // requests per minute
const rateState = new Map(); // `${ip}:${bucket}` -> { count, windowStart }

function checkRateLimit(ip, bucket) {
  const limit = RATE_LIMITS[bucket];
  const now = Date.now();
  const key = `${ip}:${bucket}`;
  const entry = rateState.get(key);

  if (!entry || now - entry.windowStart >= 60_000) {
    rateState.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

function clientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

// --- Google Places calls ---

const PLACES_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.primaryType";

function mapSearchResults(data) {
  return (data.places ?? []).map((place) => ({
    placeId: place.id,
    name: place.displayName?.text ?? "",
    address: place.formattedAddress ?? null,
    suggestedCategory: mapPrimaryTypeToCategory(place.primaryType),
  }));
}

async function searchPlaces(zip, query, lat, lng) {
  const textQuery = `${query ?? ""} ${zip ?? ""}`.trim();
  const hasLocation = lat != null && lng != null;

  // No text to search on but we know where the user is — browse nearby
  // instead of forcing a (required) text query on Places Text Search.
  if (!textQuery && hasLocation) {
    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
      },
      body: JSON.stringify({
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 1500 },
        },
        maxResultCount: 15,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return mapSearchResults(await res.json());
  }

  const body = { textQuery, maxResultCount: 15 };
  if (hasLocation) {
    body.locationBias = {
      circle: { center: { latitude: lat, longitude: lng }, radius: 5000 },
    };
  }
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return mapSearchResults(await res.json());
}

async function fetchPlaceDetails(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();

  return {
    placeId,
    name: data.displayName?.text ?? "",
    phone: data.nationalPhoneNumber ?? null,
    address: data.shortFormattedAddress ?? null,
    lat: data.location?.latitude ?? null,
    lng: data.location?.longitude ?? null,
    hours: {
      regular: parseRegularHours(data.regularOpeningHours),
      overrides: parseOverrides(data.currentOpeningHours),
    },
    lastUpdated: new Date().toISOString(),
  };
}

// --- HTTP server ---

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "X-App-Secret, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(res, status, body) {
  withCors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    withCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (!url.pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  // Note: this shared-secret header ships inside unminified app.js, so it's
  // only a deterrent against casual/scripted abuse — not real authentication.
  if (req.headers["x-app-secret"] !== APP_SHARED_SECRET) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const ip = clientIp(req);

  try {
    if (url.pathname === "/api/search" && req.method === "GET") {
      if (!checkRateLimit(ip, "search")) {
        sendJson(res, 429, { error: "Rate limited" });
        return;
      }
      const zip = url.searchParams.get("zip")?.trim();
      const q = url.searchParams.get("q")?.trim();
      const lat = url.searchParams.has("lat")
        ? Number(url.searchParams.get("lat"))
        : null;
      const lng = url.searchParams.has("lng")
        ? Number(url.searchParams.get("lng"))
        : null;
      if (!zip && !q && lat == null) {
        sendJson(res, 400, { error: "Missing zip, q, or lat/lng" });
        return;
      }
      const results = await searchPlaces(zip, q, lat, lng);
      sendJson(res, 200, results);
      return;
    }

    if (url.pathname === "/api/details" && req.method === "POST") {
      if (!checkRateLimit(ip, "details")) {
        sendJson(res, 429, { error: "Rate limited" });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      const placeIds = Array.isArray(body.placeIds) ? body.placeIds : [];
      if (placeIds.length === 0) {
        sendJson(res, 400, { error: "Missing placeIds" });
        return;
      }

      const results = [];
      for (const placeId of placeIds) {
        try {
          results.push(await fetchPlaceDetails(placeId));
        } catch (err) {
          console.warn(`WARN: ${placeId}: ${err.message}`);
        }
        // Be polite to the API
        await new Promise((r) => setTimeout(r, 200));
      }
      sendJson(res, 200, results);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("Error:", err.message);
    sendJson(res, 502, { error: err.message });
  }
}).listen(PORT, () => {
  console.log(`Edit-mode API proxy → http://localhost:${PORT}`);
});
