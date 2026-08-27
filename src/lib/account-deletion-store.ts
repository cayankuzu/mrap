import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

function tableExists(database: DatabaseSync, name: string) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function maximumInlinePatchCells() {
  const parsed = Number(process.env.MRAP_MAX_INLINE_PATCH_CELLS);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 5_000 ? parsed : 350;
}

function redactCapturedFrom(resultJson: string, deletedUserId: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return resultJson;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return resultJson;
  const result = parsed as Record<string, unknown>;
  if (!Array.isArray(result.capturedFrom)) return resultJson;
  const capturedFrom = result.capturedFrom.filter((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return true;
    return (entry as Record<string, unknown>).userId !== deletedUserId;
  });
  if (capturedFrom.length === result.capturedFrom.length) return resultJson;
  return JSON.stringify({ ...result, capturedFrom });
}

/**
 * Kullanıcı kök kaydını tek transaction içinde siler. İlişkili kayıtların
 * tamamı şemadaki ON DELETE CASCADE kurallarıyla kaldırılır.
 */
export function deleteAccountFromDatabase(database: DatabaseSync, userId: string) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const account = database.prepare("SELECT username FROM users WHERE id = ?").get(userId) as { username: string } | undefined;
    if (!account) {
      database.exec("COMMIT");
      return false;
    }

    const authoritativeSchemaAvailable = tableExists(database, "territory_cells")
      && tableExists(database, "world_regions")
      && tableExists(database, "realtime_outbox");
    const affectedCells = authoritativeSchemaAvailable
      ? database.prepare(`
          SELECT world_id, region_id, cell_id FROM territory_cells
          WHERE owner_id = ? ORDER BY world_id, region_id, cell_id
        `).all(userId) as Array<{ world_id: string; region_id: string; cell_id: string }>
      : [];

    if (authoritativeSchemaAvailable && tableExists(database, "claim_events")) {
      if (tableExists(database, "claim_commands")) {
        const survivingResults = database.prepare(`
          SELECT id, result_json FROM claim_commands
          WHERE user_id <> ? AND result_json IS NOT NULL
        `).all(userId) as Array<{ id: string; result_json: string }>;
        const updateResult = database.prepare("UPDATE claim_commands SET result_json = ? WHERE id = ?");
        for (const command of survivingResults) {
          const redacted = redactCapturedFrom(command.result_json, userId);
          if (redacted !== command.result_json) updateResult.run(redacted, command.id);
        }
      }
      // The public outbox must not retain payloads produced by the erased account.
      database.prepare(`
        DELETE FROM realtime_outbox
        WHERE claim_event_id IN (SELECT id FROM claim_events WHERE user_id = ?)
      `).run(userId);
      // Older local databases used RESTRICT on immutable history foreign keys.
      // Explicit, ordered erasure keeps account deletion compatible while preserving one transaction.
      if (tableExists(database, "claim_cell_changes")) {
        database.prepare(`
          DELETE FROM claim_cell_changes
          WHERE old_owner_id = ?
             OR new_owner_id = ?
             OR claim_event_id IN (SELECT id FROM claim_events WHERE user_id = ?)
        `).run(userId, userId, userId);
      }
      database.prepare("DELETE FROM claim_events WHERE user_id = ?").run(userId);
      if (tableExists(database, "claim_commands")) database.prepare("DELETE FROM claim_commands WHERE user_id = ?").run(userId);
      if (tableExists(database, "loop_candidates")) database.prepare("DELETE FROM loop_candidates WHERE user_id = ?").run(userId);
      if (tableExists(database, "competitive_route_sessions")) database.prepare("DELETE FROM competitive_route_sessions WHERE user_id = ?").run(userId);
    }

    // Yeni bildirimler actor_id ile cascade olur. actor_id öncesi yerel kayıtları
    // yalnız mesajın kesin kullanıcı adı öneki eşleşiyorsa kaldır; metnin ortasındaki
    // tesadüfi bir mention başka kullanıcının ilgisiz bildirimini silmemelidir.
    const legacyActorPrefix = `@${account.username} `;
    database.prepare(`
      DELETE FROM notifications
      WHERE actor_id = ?
         OR (actor_id IS NULL AND substr(body, 1, length(?)) = ?)
    `).run(userId, legacyActorPrefix, legacyActorPrefix);
    const result = database.prepare("DELETE FROM users WHERE id = ?").run(userId);
    if (result.changes > 0) {
      const byRegion = new Map<string, { worldId: string; regionId: string; cellIds: string[] }>();
      for (const cell of affectedCells) {
        const key = `${cell.world_id}:${cell.region_id}`;
        const group = byRegion.get(key) ?? { worldId: cell.world_id, regionId: cell.region_id, cellIds: [] };
        group.cellIds.push(cell.cell_id);
        byRegion.set(key, group);
      }
      const committedAt = new Date().toISOString();
      for (const group of byRegion.values()) {
        const versionRow = database.prepare("SELECT version FROM world_regions WHERE world_id = ? AND region_id = ?")
          .get(group.worldId, group.regionId) as { version: number } | undefined;
        const previousVersion = versionRow?.version ?? 0;
        const version = previousVersion + 1;
        database.prepare(`
          INSERT INTO world_regions (world_id, region_id, version, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(world_id, region_id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at
        `).run(group.worldId, group.regionId, version, committedAt);
        const eventId = randomUUID();
        const event = {
          eventId,
          type: "region_patch",
          worldId: group.worldId,
          regionId: group.regionId,
          previousVersion,
          version,
          claimEventId: `system-account-deletion:${eventId}`,
          ...(group.cellIds.length <= maximumInlinePatchCells()
            ? { changedCells: group.cellIds.map((cellId) => ({ cellId, ownerId: null, paintColorId: null })) }
            : { requiresRefetch: true }),
          committedAtServer: committedAt,
        };
        database.prepare(`
          INSERT INTO realtime_outbox
            (event_id, world_id, region_id, previous_version, version, claim_event_id, payload_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(eventId, group.worldId, group.regionId, previousVersion, version, event.claimEventId, JSON.stringify(event), committedAt);
      }
      database.prepare("UPDATE world_state SET version = version + 1 WHERE id = 1").run();
    }
    database.exec("COMMIT");
    return true;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
