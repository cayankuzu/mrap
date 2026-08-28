import process from "node:process";

const requireRemote = process.argv.includes("--require-remote");
const provider = (process.env.MRAP_DATA_PROVIDER ?? "sqlite").trim().toLowerCase();
const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
const secret = (process.env.SUPABASE_SECRET_KEY || "").trim();
const expectedProjectRef = (process.env.SUPABASE_PROJECT_REF || "").trim();

function expectedInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) stop(`${name} geçerli bir pozitif tamsayı olmalı.`, 2);
  return value;
}

function expectedNumber(name, fallback, minimum = 0) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum) stop(`${name} geçerli bir sayı olmalı.`, 2);
  return value;
}

const expectedRules = Object.freeze({
  minimumClaimAreaM2: expectedNumber("MRAP_MIN_LOOP_AREA_M2", 35, 1),
  maximumClaimAreaM2: expectedNumber("MRAP_MAX_CLAIM_AREA_M2", 25_000_000, 1),
  minimumRouteLengthM: expectedNumber("MRAP_MIN_LOOP_ROUTE_M", 25, 1),
  maximumCompetitiveRiskScore: expectedInteger("MRAP_MAX_CLAIM_RISK_SCORE", 15),
  maximumPolygonPoints: expectedInteger("MRAP_MAX_CLAIM_VERTICES", 3500),
  maximumRoutePoints: expectedInteger("MRAP_COMPETITIVE_MAX_POINTS", 10_000),
  maximumGpsAccuracyM: expectedNumber("MRAP_MAX_GPS_ACCURACY_M", 65, 1),
  maximumPlausibleSpeedMps: expectedNumber("MRAP_MAX_REAL_SPEED_MPS", 12, 1),
  realGpsProximityThresholdM: expectedNumber("MRAP_REAL_LOOP_PROXIMITY_M", 12, 0.25),
  simulatorProximityThresholdM: expectedNumber("MRAP_SIM_LOOP_PROXIMITY_M", 4, 0.25),
  minimumClaimCells: expectedInteger("MRAP_MIN_CLAIM_CELL_COUNT", 1),
  maximumInlinePatchCells: expectedInteger("MRAP_MAX_INLINE_PATCH_CELLS", 350),
  maximumClaimCells: expectedInteger("MRAP_MAX_CANDIDATE_CELLS", 25000),
  maximumBatchPoints: expectedInteger("MRAP_MAX_POINT_BATCH", 100),
  maximumBatchBytes: expectedInteger("MRAP_MAX_POINT_BATCH_BYTES", 96_000),
  sessionLeaseSeconds: expectedInteger("MRAP_SESSION_LEASE_SECONDS", 1_800),
  offlineGraceSeconds: expectedInteger("MRAP_MAX_TRACKING_GAP_SECONDS", 20),
  rawPointRetentionDays: expectedInteger("MRAP_RAW_LOCATION_RETENTION_DAYS", 30),
  claimRateWindowSeconds: 600,
  claimRateMaxCommands: expectedInteger("MRAP_CLAIMS_PER_TEN_MINUTES", 40),
  paintCooldownSeconds: Math.ceil(expectedNumber("MRAP_LOOP_COOLDOWN_MS", 4_500) / 1_000),
  minimumLoopPointCount: expectedInteger("MRAP_MIN_LOOP_INDEX_GAP", 4) + 1,
});

function stop(message, code) {
  console.error(`[supabase-contract] ${message}`);
  process.exit(code);
}

if (provider !== "supabase") {
  if (requireRemote) stop("MRAP_DATA_PROVIDER=supabase gerekli.", 2);
  console.log("[supabase-contract] Yerel provider SQLite; uzak doğrulama bilinçli olarak atlandı.");
  process.exit(0);
}
if (!url || !secret) stop("SUPABASE_URL ve SUPABASE_SECRET_KEY güvenli ortamda tanımlanmalı.", 2);

let parsed;
try { parsed = new URL(url); }
catch { stop("SUPABASE_URL geçersiz.", 2); }
if (parsed.protocol !== "https:") stop("Uzak Supabase doğrulaması HTTPS kullanmalı.", 2);
const hostedProjectRef = parsed.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1];
if (expectedProjectRef && hostedProjectRef && expectedProjectRef !== hostedProjectRef) {
  stop("SUPABASE_PROJECT_REF ile URL farklı projeleri gösteriyor.", 2);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 8_000);
try {
  const response = await fetch(`${url}/rest/v1/rpc/mrap_runtime_contract`, {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "X-Client-Info": "mrap-readiness",
    },
    body: "{}",
    cache: "no-store",
    signal: controller.signal,
  });
  if (!response.ok) stop(`Runtime contract okunamadı (HTTP ${response.status}). Migration 015 uygulanmış olmalı.`, 1);
  const contract = await response.json();
  const valid = contract?.schemaVersion >= 16
    && contract?.productionWorldSlug === "world-main"
    && contract?.gridResolution === 22
    && contract?.regionResolution === 14
    && contract?.postClaimEventReady === true
    && contract?.distributedRateLimitReady === true
    && contract?.outboxPublisherReady === true
    && contract?.dissolvedTerritoryReady === true
    && contract?.regionMapStateReady === true
    && contract?.worldLocationsOnDemandReady === true
    && Object.entries(expectedRules).every(
      ([key, expected]) => contract?.authoritativeRules?.[key] === expected,
    )
    && contract?.authoritativeGameRuntimeReady === true;
  if (!valid) stop("Uzak runtime contract beklenen mrap şema sözleşmesiyle eşleşmiyor.", 1);
  console.log(`[supabase-contract] PASS · proje=${hostedProjectRef ?? "custom"} · schema=${contract.schemaVersion} · world=${contract.productionWorldSlug} · grid=${contract.gridResolution}`);
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") stop("Uzak Supabase doğrulaması zaman aşımına uğradı.", 1);
  stop("Uzak Supabase doğrulaması bağlantı hatasıyla durdu.", 1);
} finally {
  clearTimeout(timeout);
}
