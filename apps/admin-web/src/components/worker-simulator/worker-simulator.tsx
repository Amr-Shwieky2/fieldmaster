"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { DevLoginUser, Shift } from "@fieldmaster/api-client";
import type { OfflineSigningKeyPair } from "@fieldmaster/shared-validation";
import { CheckInMethod, OrgRole, TaskCategory, TimeEntryStatus } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { useFormat } from "@/lib/use-format";
import { useShiftTitle } from "@/lib/shift-title";
import { useSimulatorSession } from "@/lib/worker-simulator/session";
import {
  DEFAULT_DEVICE,
  clockLocationFields,
  deviceTimestamp,
  emergencyLocationFields,
  newClientEventId,
  type SimulatedDevice,
} from "@/lib/worker-simulator/device";
import { offsetByMeters, type LatLng } from "@/lib/worker-simulator/geo";
import {
  applySyncResults,
  batchIdempotencyKey,
  createSimulatedDeviceKey,
  signOfflineClockEvent,
  toBatchEvent,
  type QueuedOfflineEvent,
} from "@/lib/worker-simulator/offline";
import { SimulatorPrepareError, ensureNightTuran, ensureShift, ensureTemporarySupervisor } from "@/lib/worker-simulator/prepare";
import { TestModeBanner, useDevLoginUsers } from "@/components/dev-quick-login";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { WorkerPicker } from "./worker-picker";
import { WorkerStatus, splitOpenShifts } from "./worker-status";
import { SimulatorMap } from "./simulator-map";
import { DeviceControls } from "./device-controls";
import { ActionPanel, type PlacingPoint } from "./action-panel";
import { ResultPanel } from "./result-panel";
import { OfflineQueuePanel } from "./offline-queue-panel";
import { SessionLog } from "./session-log";
import { ScenarioChecklist } from "./scenario-checklist";
import type { ScenarioId, SessionLogEntry, SimulatorAction, SimulatorResult, SummaryForm } from "./types";
import { SupervisorPanel } from "./supervisor-panel";

/**
 * /dev/worker-simulator: act as any seeded worker from the admin web and
 * exercise every attendance rule through the REAL API. Test mode only (the
 * route is a 404 otherwise), Owners and Field Managers only.
 */
export function WorkerSimulator() {
  const t = useTranslations("workerSimulator");
  const { session, isReady } = useAuth();
  const devUsers = useDevLoginUsers();

  if (!isReady || devUsers.isPending) return <LoadingState />;
  if (devUsers.isError) return <ErrorState error={devUsers.error} onRetry={() => void devUsers.refetch()} />;
  // The API left dev login mode after the page was served: same as the server-side 404.
  if (devUsers.data === null) notFound();
  if (!session || (session.role !== OrgRole.OWNER && session.role !== OrgRole.FIELD_MANAGER)) return <AccessDenied />;

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="mb-6 space-y-2">
        <TestModeBanner />
        <p className="text-sm text-slate-600">{t("separateSession")}</p>
      </div>
      <SimulatorWorkspace devUsers={devUsers.data} organizationId={session.organizationId} />
    </div>
  );
}

function geofenceCenter(shift: Shift, fallback: LatLng): LatLng {
  if (shift.geofence) return { latitude: shift.geofence.centerLatitude, longitude: shift.geofence.centerLongitude };
  if (shift.site) return { latitude: shift.site.latitude, longitude: shift.site.longitude };
  return fallback;
}

function siteCenter(shift: Shift, fallback: LatLng): LatLng {
  return shift.site ? { latitude: shift.site.latitude, longitude: shift.site.longitude } : geofenceCenter(shift, fallback);
}

function SimulatorWorkspace({ devUsers, organizationId }: { devUsers: DevLoginUser[]; organizationId: string }) {
  const t = useTranslations("workerSimulator");
  const { client: admin } = useAuth();
  const adminQueryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const format = useFormat();
  const shiftTitle = useShiftTitle();
  const sim = useSimulatorSession();
  const simSession = sim.session;

  const workers = useMemo(
    () => devUsers.filter((u) => u.role === OrgRole.WORKER && u.organizationId === organizationId),
    [devUsers, organizationId],
  );

  const [pickingId, setPickingId] = useState<string | null>(null);
  const [pickFailed, setPickFailed] = useState<string | null>(null);
  const [device, setDevice] = useState<SimulatedDevice>(DEFAULT_DEVICE);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [checkInPointId, setCheckInPointId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryForm>(() => ({
    text: t("summary.defaultText"),
    category: TaskCategory.TRAFFIC_SIGN,
    materials: "",
    problems: "",
    followUp: false,
  }));
  const [placingPoint, setPlacingPoint] = useState<PlacingPoint | null>(null);
  const [busy, setBusy] = useState<SimulatorAction | null>(null);
  const [result, setResult] = useState<SimulatorResult | null>(null);
  const [log, setLog] = useState<SessionLogEntry[]>([]);
  const logId = useRef(0);
  const [queue, setQueue] = useState<QueuedOfflineEvent[]>([]);
  const [lastBatch, setLastBatch] = useState<QueuedOfflineEvent[]>([]);
  const resendAttempt = useRef(0);
  const deviceKey = useRef<OfflineSigningKeyPair | null>(null);
  const [keyRegistered, setKeyRegistered] = useState(false);
  const [preparing, setPreparing] = useState<ScenarioId | null>(null);
  const [scenarioNotice, setScenarioNotice] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<ScenarioId>>(() => new Set());
  /** The shift the phone was last placed for, so loading its details doesn't move a phone a scenario placed on purpose. */
  const positionedShift = useRef<string | null>(null);

  const memberKey = simSession?.membershipId ?? null;
  const enabled = memberKey !== null;

  // Every worker gets a fresh simulated phone: new device key, empty queue, nothing selected.
  useEffect(() => {
    setSelectedShiftId(null);
    setCheckInPointId(null);
    setPlacingPoint(null);
    setQueue([]);
    setLastBatch([]);
    deviceKey.current = null;
    setKeyRegistered(false);
    resendAttempt.current = 0;
    positionedShift.current = null;
  }, [memberKey]);

  // All worker data goes through the worker's own client and into the simulator's own QueryClient.
  const shiftsQuery = useQuery({ queryKey: ["sim", memberKey, "shifts"], queryFn: () => sim.client.listShifts(), enabled }, sim.queryClient);
  const activeEntryQuery = useQuery(
    {
      queryKey: ["sim", memberKey, "active-entry"],
      queryFn: async () => (await sim.client.listTimeEntries({ status: TimeEntryStatus.ACTIVE }))[0] ?? null,
      enabled,
    },
    sim.queryClient,
  );
  const contextQuery = useQuery({ queryKey: ["sim", memberKey, "context"], queryFn: () => sim.client.getWorkerSimulatorContext(), enabled }, sim.queryClient);
  const shiftQuery = useQuery(
    {
      queryKey: ["sim", memberKey, "shift", selectedShiftId],
      queryFn: () => sim.client.getShift(selectedShiftId as string),
      enabled: enabled && selectedShiftId !== null,
    },
    sim.queryClient,
  );

  const shifts = useMemo(() => shiftsQuery.data ?? [], [shiftsQuery.data]);
  const activeEntry = activeEntryQuery.data;
  const shift = shiftQuery.data;
  const context = contextQuery.data;
  const isTemporarySupervisor = Boolean(selectedShiftId && context?.temporarySupervisorAssignments.some((a) => a.shiftId === selectedShiftId));
  const workerQueryError = shiftsQuery.error ?? activeEntryQuery.error ?? contextQuery.error ?? null;

  // Select a shift once the data is in: the open entry's shift, else the first one today or later.
  useEffect(() => {
    if (!enabled || selectedShiftId || !shiftsQuery.data || activeEntryQuery.isPending) return;
    const preferred = (activeEntry && !activeEntry.isEmergency ? activeEntry.shiftId : null) ?? splitOpenShifts(shiftsQuery.data).current[0]?.id ?? null;
    if (preferred) setSelectedShiftId(preferred);
  }, [enabled, selectedShiftId, shiftsQuery.data, activeEntryQuery.isPending, activeEntry]);

  // Put the phone in the middle of a newly selected shift's geofence (a scenario that placed it already is left alone).
  useEffect(() => {
    if (!shift || positionedShift.current === shift.id) return;
    positionedShift.current = shift.id;
    setDevice((d) => ({ ...d, ...geofenceCenter(shift, d) }));
  }, [shift]);

  const refreshWorker = useCallback(() => sim.queryClient.invalidateQueries({ queryKey: ["sim"] }), [sim.queryClient]);

  const addLog = useCallback((entry: Omit<SessionLogEntry, "id" | "at">) => {
    logId.current += 1;
    const next: SessionLogEntry = { ...entry, id: logId.current, at: new Date().toISOString() };
    setLog((entries) => [next, ...entries]);
  }, []);

  async function run(action: SimulatorAction, perform: () => Promise<SimulatorResult>, params?: Record<string, string>) {
    setBusy(action);
    try {
      const outcome = await perform();
      setResult(outcome);
      addLog({ action, params, outcome: outcome.kind === "clockInQueued" || outcome.kind === "clockOutQueued" ? "queued" : "success" });
    } catch (error) {
      setResult({ kind: "error", action, error });
      addLog({ action, params, outcome: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
      void refreshWorker();
    }
  }

  function ensureDeviceKey(): OfflineSigningKeyPair {
    if (!deviceKey.current) deviceKey.current = createSimulatedDeviceKey();
    return deviceKey.current;
  }

  // ── Worker session ───────────────────────────────────────────────────
  async function pickWorker(user: DevLoginUser) {
    setPickingId(user.membershipId);
    setPickFailed(null);
    try {
      await sim.start(user);
      addLog({ action: "signIn", params: { name: user.fullLegalName }, outcome: "success" });
    } catch (error) {
      setPickFailed(`${t("picker.signInFailed")} ${errorMessage(error)}`);
      addLog({ action: "signIn", params: { name: user.fullLegalName }, outcome: "error", message: errorMessage(error) });
    } finally {
      setPickingId(null);
    }
  }

  function endSession() {
    if (simSession) addLog({ action: "signOut", params: { name: simSession.fullLegalName }, outcome: "success" });
    sim.end();
  }

  // ── Actions (all through the simulated worker's own session, except rewind / approve) ──
  function summaryFields() {
    return {
      summaryText: summary.text.trim(),
      taskCategory: summary.category,
      materialsUsed: summary.materials.trim() || undefined,
      problemsEncountered: summary.problems.trim() || undefined,
      followUpRequired: summary.followUp,
    };
  }

  const clockIn = () =>
    run("clockIn", async () => {
      const target = shift ?? shifts.find((s) => s.id === selectedShiftId);
      if (!simSession || !target) throw new Error("No shift selected.");
      const clientEventId = newClientEventId("in");
      const title = shiftTitle(target);
      const temporaryCheckInPointId = checkInPointId ?? undefined;
      if (!device.online) {
        const event = signOfflineClockEvent(
          { clientEventId, eventType: "CLOCK_IN", shiftId: target.id, temporaryCheckInPointId, deviceTimestamp: deviceTimestamp(device), ...clockLocationFields(device) },
          ensureDeviceKey(),
        );
        setQueue((q) => [...q, event]);
        return { kind: "clockInQueued", event, shiftTitle: title };
      }
      const body = await sim.client.clockIn(
        {
          shiftId: target.id,
          temporaryCheckInPointId,
          deviceId: simSession.deviceId,
          clientEventId,
          deviceTimestamp: deviceTimestamp(device),
          ...clockLocationFields(device),
          origin: "ONLINE",
        },
        clientEventId,
      );
      return { kind: "clockIn", body, shiftTitle: title };
    });

  const clockOut = () =>
    run("clockOut", async () => {
      if (!simSession) throw new Error("No worker session.");
      const clientEventId = newClientEventId("out");
      if (!device.online) {
        const event = signOfflineClockEvent(
          { clientEventId, eventType: "CLOCK_OUT", deviceTimestamp: deviceTimestamp(device), ...clockLocationFields(device), ...summaryFields() },
          ensureDeviceKey(),
        );
        setQueue((q) => [...q, event]);
        return { kind: "clockOutQueued", event };
      }
      const body = await sim.client.clockOut(
        { deviceId: simSession.deviceId, clientEventId, deviceTimestamp: deviceTimestamp(device), ...clockLocationFields(device), origin: "ONLINE", ...summaryFields() },
        clientEventId,
      );
      return { kind: "clockOut", body };
    });

  const startEmergency = () =>
    run("emergencyStart", async () => {
      if (!simSession) throw new Error("No worker session.");
      const clientEventId = newClientEventId("emergency-start");
      const body = await sim.client.startEmergencyCallout(
        { deviceId: simSession.deviceId, clientEventId, deviceTimestamp: deviceTimestamp(device), ...emergencyLocationFields(device) },
        clientEventId,
      );
      return { kind: "emergencyStart", body };
    });

  const endEmergency = () =>
    run("emergencyEnd", async () => {
      if (!simSession) throw new Error("No worker session.");
      // The actual click is the call-out's clock-in event; the entry's clock-in is the compensated start.
      const actualStart = activeEntry?.clockEvents?.find((e) => e.eventType === "CLOCK_IN")?.serverReceivedAt ?? null;
      const compensatedStart = activeEntry?.isEmergency ? activeEntry.clockInAt : null;
      const clientEventId = newClientEventId("emergency-end");
      const body = await sim.client.endEmergencyCallout(
        {
          deviceId: simSession.deviceId,
          clientEventId,
          deviceTimestamp: deviceTimestamp(device),
          ...emergencyLocationFields(device),
          summaryText: summary.text.trim(),
          taskCategory: summary.category,
        },
        clientEventId,
      );
      return { kind: "emergencyEnd", body, actualStart, compensatedStart };
    });

  const rewind = (targetMinutes: number) =>
    run(
      "rewind",
      async () => {
        const entry = activeEntry;
        if (!entry?.clockInAt) throw new Error("No open time entry.");
        const elapsed = (Date.now() - Date.parse(entry.clockInAt)) / 60_000;
        // Through the admin's own session: rewinding is a manager-side test tool, audited as DEV_REWIND.
        const body = await admin.rewindTimeEntry(entry.id, Math.round(targetMinutes - elapsed));
        return { kind: "rewind", body };
      },
      { duration: format.minutes(targetMinutes) },
    );

  const approve = (timeEntryId: string) =>
    run("approve", async () => {
      // The 540-minute regular / overtime split is made when a manager approves: do exactly that, as the admin.
      const body = await admin.approveTimeEntry(timeEntryId);
      void adminQueryClient.invalidateQueries({ queryKey: ["attendance-approvals-pending"] });
      return { kind: "approve", body };
    });

  const onMapClick = (latitude: number, longitude: number) => {
    if (placingPoint && shift) {
      const point = placingPoint;
      setPlacingPoint(null);
      void run("tempPoint", async () => {
        const body = await sim.client.createTemporaryCheckInPoint({
          shiftId: shift.id,
          name: point.name.trim() || t("actions.tempPointDefaultName"),
          latitude,
          longitude,
          radiusMeters: point.radiusMeters,
        });
        setCheckInPointId(body.id);
        return { kind: "tempPoint", body };
      });
      return;
    }
    setDevice((d) => ({ ...d, latitude, longitude }));
  };

  // ── Offline protocol ─────────────────────────────────────────────────
  const sync = () =>
    run("sync", async () => {
      if (!simSession) throw new Error("No worker session.");
      const pending = queue.filter((e) => e.localStatus === "PENDING");
      const key = ensureDeviceKey();
      if (!keyRegistered) {
        await sim.client.registerDevicePublicKey({ deviceId: simSession.deviceId, publicKey: key.publicKeyBase64 });
        setKeyRegistered(true);
      }
      const ids = new Set(pending.map((e) => e.clientEventId));
      setQueue((q) => q.map((e) => (ids.has(e.clientEventId) ? { ...e, localStatus: "SYNCING" } : e)));
      try {
        const body = await sim.client.submitOfflineSyncBatch(
          { deviceId: simSession.deviceId, events: pending.map(toBatchEvent) },
          batchIdempotencyKey(simSession.deviceId, pending),
        );
        setQueue((q) => applySyncResults(q, body.results));
        setLastBatch(applySyncResults(pending, body.results));
        resendAttempt.current = 0;
        return { kind: "sync", body, resend: false };
      } catch (error) {
        setQueue((q) => q.map((e) => (ids.has(e.clientEventId) ? { ...e, localStatus: "PENDING" } : e)));
        throw error;
      }
    });

  const resend = () =>
    run("resend", async () => {
      if (!simSession) throw new Error("No worker session.");
      resendAttempt.current += 1;
      // The same signed events in a new request (new Idempotency-Key): the server's duplicate detection must answer.
      const body = await sim.client.submitOfflineSyncBatch(
        { deviceId: simSession.deviceId, events: lastBatch.map(toBatchEvent) },
        batchIdempotencyKey(simSession.deviceId, lastBatch, resendAttempt.current),
      );
      return { kind: "sync", body, resend: true };
    });

  // ── Scenario preparation (admin session, real management endpoints) ──
  async function prepare(id: ScenarioId) {
    if (!simSession) return;
    setPreparing(id);
    setScenarioNotice(null);
    const params = { scenario: t(`scenarios.items.${id}.title`) };
    try {
      const [freshShifts, freshContext] = await Promise.all([sim.client.listShifts(), sim.client.getWorkerSimulatorContext()]);
      const worker = { workerProfileId: simSession.workerProfileId, shifts: freshShifts };
      const base: Partial<SimulatedDevice> = { accuracyMeters: 10, clockOffsetSeconds: 0, mockLocationSuspected: false, online: true };
      const geofencedShift = () => ensureShift(admin, worker, { checkInMethod: CheckInMethod.GEOFENCED, title: t("scenarios.testShiftTitle") });
      const place = async (shiftId: string, patch: (detail: Shift) => Partial<SimulatedDevice>) => {
        const detail = await sim.client.getShift(shiftId);
        positionedShift.current = shiftId;
        setSelectedShiftId(shiftId);
        setCheckInPointId(null);
        setPlacingPoint(null);
        setDevice((d) => ({ ...d, ...base, ...patch(detail) }));
      };
      const center = (detail: Shift) => geofenceCenter(detail, device);
      const radius = (detail: Shift) => detail.geofence?.radiusMeters ?? 100;

      switch (id) {
        case "insideGeofence":
        case "nineHours":
        case "tenHoursThirty":
          await place(await geofencedShift(), center);
          setSummary((s) => (s.text.trim() ? s : { ...s, text: t("summary.defaultText") }));
          break;
        case "outsideGeofence":
          await place(await geofencedShift(), (d) => offsetByMeters(center(d), radius(d) + 80, 0));
          break;
        case "poorAccuracy":
          await place(await geofencedShift(), (d) => ({ ...center(d), accuracyMeters: (d.geofence?.minAccuracyMeters ?? 50) + 50 }));
          break;
        case "clockAhead":
          await place(await geofencedShift(), (d) => ({ ...center(d), clockOffsetSeconds: 300 }));
          break;
        case "mockLocation":
          await place(await geofencedShift(), (d) => ({ ...center(d), mockLocationSuspected: true }));
          break;
        case "flexiCheck": {
          const shiftId = await ensureShift(admin, worker, { checkInMethod: CheckInMethod.FLEXI_CHECK, title: t("scenarios.testFlexiShiftTitle") });
          await place(shiftId, (d) => offsetByMeters(siteCenter(d, device), 3000, 0));
          break;
        }
        case "emptySummary":
          await place(await geofencedShift(), center);
          setSummary((s) => ({ ...s, text: "" }));
          break;
        case "nightTuranEmergency":
          if (!simSession.workerProfileId) throw new SimulatorPrepareError("noWorkerProfile");
          await ensureNightTuran(admin, simSession.workerProfileId, freshContext, t("scenarios.turanNotes"));
          setDevice((d) => ({ ...d, ...base }));
          setSummary((s) => (s.text.trim() ? s : { ...s, text: t("summary.defaultText") }));
          break;
        case "notEligibleEmergency":
          if (freshContext.emergencyEligibleTuranAssignmentId) setScenarioNotice(t("scenarios.alreadyEligible"));
          setDevice((d) => ({ ...d, ...base }));
          break;
        case "temporaryPoint": {
          if (!simSession.workerProfileId) throw new SimulatorPrepareError("noWorkerProfile");
          const shiftId = await geofencedShift();
          await ensureTemporarySupervisor(admin, shiftId, simSession.workerProfileId, freshContext);
          await place(shiftId, (d) => offsetByMeters(center(d), radius(d) + 300, 0));
          break;
        }
        case "offlineClockIn":
          await place(await geofencedShift(), (d) => ({ ...center(d), online: false }));
          break;
        case "duplicateBatch":
          break;
      }
      addLog({ action: "prepare", params, outcome: "success" });
    } catch (error) {
      const message = error instanceof SimulatorPrepareError ? t(`scenarios.errors.${error.reason}`) : errorMessage(error);
      setScenarioNotice(message);
      addLog({ action: "prepare", params, outcome: "error", message });
    } finally {
      setPreparing(null);
      void refreshWorker();
    }
  }

  const toggleChecked = (id: ScenarioId) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="min-w-0 space-y-6 xl:col-span-2">
        {sim.expired ? (
          <p role="alert" className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {t("sessionExpired")}
          </p>
        ) : null}
        <WorkerPicker workers={workers} current={simSession} pendingId={pickingId} failed={pickFailed} onPick={(u) => void pickWorker(u)} onEnd={endSession} />

        {simSession ? (
          <>
            {workerQueryError ? <ErrorState error={workerQueryError} onRetry={() => void refreshWorker()} /> : null}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <WorkerStatus
                loading={shiftsQuery.isPending || activeEntryQuery.isPending || contextQuery.isPending}
                workerProfileId={simSession.workerProfileId}
                activeEntry={activeEntry}
                shifts={shifts}
                context={context}
                selectedShiftId={selectedShiftId}
                onSelectShift={(id) => {
                  setSelectedShiftId(id);
                  setCheckInPointId(null);
                  setPlacingPoint(null);
                }}
              />
              <DeviceControls device={device} onChange={(patch) => setDevice((d) => ({ ...d, ...patch }))} />
            </div>
            <SimulatorMap device={device} shift={shift} placingPoint={placingPoint !== null} onMapClick={onMapClick} />
            <ActionPanel
              hasSession
              online={device.online}
              activeEntry={activeEntry}
              shift={shift}
              checkInPointId={checkInPointId}
              onCheckInPointChange={setCheckInPointId}
              isTemporarySupervisor={isTemporarySupervisor}
              placingPoint={placingPoint}
              onPlacingPointChange={setPlacingPoint}
              summary={summary}
              onSummaryChange={(patch) => setSummary((s) => ({ ...s, ...patch }))}
              busy={busy}
              onClockIn={() => void clockIn()}
              onClockOut={() => void clockOut()}
              onRewind={(target) => void rewind(target)}
              onEmergencyStart={() => void startEmergency()}
              onEmergencyEnd={() => void endEmergency()}
            />
            <ResultPanel result={result} onApprove={(id) => void approve(id)} approving={busy === "approve"} />
            {memberKey ? <SupervisorPanel client={sim.client} queryClient={sim.queryClient} memberKey={memberKey} onLog={addLog} /> : null}
            <OfflineQueuePanel
              queue={queue}
              keyRegistered={keyRegistered}
              canResend={lastBatch.length > 0}
              busy={busy === "sync" || busy === "resend" ? busy : null}
              onSync={() => void sync()}
              onResend={() => void resend()}
            />
          </>
        ) : (
          <ResultPanel result={result} onApprove={(id) => void approve(id)} approving={busy === "approve"} />
        )}
        <SessionLog entries={log} />
      </div>
      <aside className="min-w-0 space-y-6">
        <ScenarioChecklist
          enabled={simSession !== null}
          preparing={preparing}
          checked={checked}
          notice={scenarioNotice}
          onPrepare={(id) => void prepare(id)}
          onToggle={toggleChecked}
        />
      </aside>
    </div>
  );
}
