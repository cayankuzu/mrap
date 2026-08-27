import { describe, expect, it } from "vitest";
import type { AuthoritativeUiState } from "@/lib/game/authoritative-types";
import {
  AuthoritativeGameStateMachine,
  type AuthoritativeUiEvent,
} from "@/lib/game/authoritative-state-machine";

const validTransitions = [
  ["IDLE", "REQUEST_LOCATION", "ACQUIRING_LOCATION"],
  ["IDLE", "RESET", "IDLE"],
  ["ACQUIRING_LOCATION", "LOCATION_READY", "READY"],
  ["ACQUIRING_LOCATION", "REJECT", "CLAIM_REJECTED"],
  ["ACQUIRING_LOCATION", "RESET", "IDLE"],
  ["READY", "START", "TRACKING"],
  ["READY", "RESET", "IDLE"],
  ["TRACKING", "LOOP_DETECTED", "LOOP_AVAILABLE"],
  ["TRACKING", "LOW_ACCURACY", "PAUSED_LOW_ACCURACY"],
  ["TRACKING", "OFFLINE", "PAUSED_OFFLINE"],
  ["TRACKING", "RESYNC", "RESYNCING_MAP"],
  ["TRACKING", "FINISH", "FINISHED"],
  ["TRACKING", "REVOKE", "SESSION_REVOKED"],
  ["LOOP_AVAILABLE", "CONTINUE", "CONTINUING"],
  ["LOOP_AVAILABLE", "SUBMIT", "SUBMITTING_CLAIM"],
  ["LOOP_AVAILABLE", "LOW_ACCURACY", "PAUSED_LOW_ACCURACY"],
  ["LOOP_AVAILABLE", "OFFLINE", "PAUSED_OFFLINE"],
  ["LOOP_AVAILABLE", "FINISH", "FINISHED"],
  ["LOOP_AVAILABLE", "REVOKE", "SESSION_REVOKED"],
  ["CONTINUING", "START", "TRACKING"],
  ["CONTINUING", "LOOP_DETECTED", "LOOP_AVAILABLE"],
  ["CONTINUING", "FINISH", "FINISHED"],
  ["SUBMITTING_CLAIM", "ACCEPT", "CLAIM_ACCEPTED"],
  ["SUBMITTING_CLAIM", "PARTIAL", "CLAIM_PARTIAL"],
  ["SUBMITTING_CLAIM", "REJECT", "CLAIM_REJECTED"],
  ["SUBMITTING_CLAIM", "OFFLINE", "PAUSED_OFFLINE"],
  ["SUBMITTING_CLAIM", "REVOKE", "SESSION_REVOKED"],
  ["CLAIM_ACCEPTED", "START", "TRACKING"],
  ["CLAIM_ACCEPTED", "LOOP_DETECTED", "LOOP_AVAILABLE"],
  ["CLAIM_ACCEPTED", "FINISH", "FINISHED"],
  ["CLAIM_PARTIAL", "START", "TRACKING"],
  ["CLAIM_PARTIAL", "LOOP_DETECTED", "LOOP_AVAILABLE"],
  ["CLAIM_PARTIAL", "FINISH", "FINISHED"],
  ["CLAIM_REJECTED", "START", "TRACKING"],
  ["CLAIM_REJECTED", "LOOP_DETECTED", "LOOP_AVAILABLE"],
  ["CLAIM_REJECTED", "FINISH", "FINISHED"],
  ["CLAIM_REJECTED", "RESET", "IDLE"],
  ["PAUSED_LOW_ACCURACY", "LOCATION_READY", "TRACKING"],
  ["PAUSED_LOW_ACCURACY", "FINISH", "FINISHED"],
  ["PAUSED_LOW_ACCURACY", "REVOKE", "SESSION_REVOKED"],
  ["PAUSED_OFFLINE", "LOCATION_READY", "RESYNCING_MAP"],
  ["PAUSED_OFFLINE", "FINISH", "FINISHED"],
  ["PAUSED_OFFLINE", "REVOKE", "SESSION_REVOKED"],
  ["RESYNCING_MAP", "SYNCED", "TRACKING"],
  ["RESYNCING_MAP", "REVOKE", "SESSION_REVOKED"],
  ["RESYNCING_MAP", "FINISH", "FINISHED"],
  ["SESSION_REVOKED", "RESET", "IDLE"],
  ["FINISHED", "RESET", "IDLE"],
  ["FINISHED", "REQUEST_LOCATION", "ACQUIRING_LOCATION"],
] as const satisfies ReadonlyArray<readonly [AuthoritativeUiState, AuthoritativeUiEvent, AuthoritativeUiState]>;

describe("AuthoritativeGameStateMachine", () => {
  it.each(validTransitions)("%s + %s geçişini %s durumuna taşır", (from, event, to) => {
    const machine = new AuthoritativeGameStateMachine(from);

    expect(machine.send(event)).toEqual({ accepted: true, state: to });
    expect(machine.state).toBe(to);
  });

  it.each([
    ["IDLE", "ACCEPT"],
    ["READY", "LOOP_DETECTED"],
    ["TRACKING", "SUBMIT"],
    ["LOOP_AVAILABLE", "ACCEPT"],
    ["SUBMITTING_CLAIM", "CONTINUE"],
    ["SESSION_REVOKED", "START"],
    ["FINISHED", "FINISH"],
  ] as const satisfies ReadonlyArray<readonly [AuthoritativeUiState, AuthoritativeUiEvent]>) (
    "%s durumundaki geçersiz %s olayını no-op olarak reddeder",
    (from, event) => {
      const machine = new AuthoritativeGameStateMachine(from);

      expect(machine.send(event)).toEqual({ accepted: false, state: from });
      expect(machine.state).toBe(from);
    },
  );

  it("çoklu loop, devam ve claim sonrasında aynı oturumda takibe döner", () => {
    const machine = new AuthoritativeGameStateMachine();
    const events: AuthoritativeUiEvent[] = [
      "REQUEST_LOCATION",
      "LOCATION_READY",
      "START",
      "LOOP_DETECTED",
      "CONTINUE",
      "START",
      "LOOP_DETECTED",
      "SUBMIT",
      "ACCEPT",
      "START",
    ];

    for (const event of events) expect(machine.send(event).accepted).toBe(true);
    expect(machine.state).toBe("TRACKING");
  });

  it("oturum iptalinden sonra yalnızca RESET ile yeniden başlatılabilir", () => {
    const machine = new AuthoritativeGameStateMachine("TRACKING");

    expect(machine.send("REVOKE")).toEqual({ accepted: true, state: "SESSION_REVOKED" });
    expect(machine.send("REQUEST_LOCATION")).toEqual({ accepted: false, state: "SESSION_REVOKED" });
    expect(machine.send("RESET")).toEqual({ accepted: true, state: "IDLE" });
  });
});
