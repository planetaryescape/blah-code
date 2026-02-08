import type { PermissionRequest, PermissionResolution } from "@blah-code/core";
import type { SessionSummary } from "@blah-code/session";
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { CommandPalette, type PaletteItem } from "./components/CommandPalette";
import { EventTimeline } from "./components/EventTimeline";
import { PermissionModal } from "./components/PermissionModal";
import { SessionList } from "./components/SessionList";
import { StatusPanel } from "./components/StatusPanel";
import { createRuntimeClient, type RuntimeClient } from "./runtime";
import type { TuiEvent } from "./state";
import { formatSessionTime } from "./state";
import { theme } from "./theme";

interface RunTuiOptions {
  cwd: string;
  attachUrl?: string;
  modelId?: string;
  timeoutMs?: number;
}

interface TuiAppProps {
  runtime: RuntimeClient;
  modelId?: string;
  timeoutMs?: number;
}

interface SessionRunState {
  phase: "idle" | "running" | "tool" | "failed" | "cancelled";
  startedAt?: number;
  message?: string;
}

function normalizeTitle(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value
    .replace(/[\r\n]+/g, " ")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  const words = clean.split(" ").slice(0, 6);
  const title = words.join(" ").replace(/[.,;:!?-]+$/g, "").trim();
  return title || null;
}

function fallbackTitle(prompt: string): string {
  const words = prompt
    .replace(/[\r\n]+/g, " ")
    .replace(/["'`]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  return words.join(" ").trim() || "new session";
}

function sortEvents(events: TuiEvent[]): TuiEvent[] {
  return [...events].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id.localeCompare(b.id);
  });
}

function mergeEvents(current: TuiEvent[], incoming: TuiEvent[]): TuiEvent[] {
  const merged = new Map<string, TuiEvent>();
  for (const event of current) merged.set(event.id, event);
  for (const event of incoming) merged.set(event.id, event);
  return sortEvents(Array.from(merged.values()));
}

function payloadText(event: TuiEvent): string {
  const payload =
    typeof event.payload === "object" && event.payload !== null ? (event.payload as { text?: string }) : {};
  return typeof payload.text === "string" ? payload.text : "";
}

function asRunState(state: SessionRunState | undefined): SessionRunState {
  return state ?? { phase: "idle" };
}

function isCancelMessage(message: string): boolean {
  return /cancel/i.test(message);
}

function formatAge(ts: number | null, now: number): string {
  if (!ts) return "-";
  return `${Math.max(0, Math.floor((now - ts) / 1000))}s`;
}

function activityLabel(event: TuiEvent): string {
  const payload =
    typeof event.payload === "object" && event.payload !== null ? (event.payload as Record<string, unknown>) : {};

  if (event.kind === "tool_call") {
    const tool = typeof payload.tool === "string" ? payload.tool : "tool";
    return `tool ${tool}`;
  }
  if (event.kind === "tool_result") {
    const tool = typeof payload.tool === "string" ? payload.tool : "tool";
    return `tool done ${tool}`;
  }
  if (event.kind === "run_started") return "run started";
  if (event.kind === "run_finished" || event.kind === "done") return "run finished";
  if (event.kind === "run_failed") return "run failed";
  if (event.kind === "model_timeout") return "model timeout";
  if (event.kind === "error") return "error";
  if (event.kind === "permission_request") return "permission requested";
  if (event.kind === "permission_resolved") return "permission resolved";
  return event.kind;
}

function TuiApp(props: TuiAppProps) {
  const renderer = useRenderer();

  const [sessions, setSessions] = createSignal<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = createSignal<string | null>(null);
  const [eventsBySession, setEventsBySession] = createSignal<Record<string, TuiEvent[]>>({});
  const [streamBySession, setStreamBySession] = createSignal<Record<string, string>>({});
  const [runStateBySession, setRunStateBySession] = createSignal<Record<string, SessionRunState>>({});
  const [prompt, setPrompt] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<Awaited<ReturnType<RuntimeClient["getStatus"]>> | null>(null);
  const [logs, setLogs] = createSignal<string[]>([]);

  const [showSessions, setShowSessions] = createSignal(true);
  const [showInspector, setShowInspector] = createSignal(true);
  const [showToolsExpanded, setShowToolsExpanded] = createSignal(false);
  const [showPalette, setShowPalette] = createSignal(false);
  const [showSystemStream, setShowSystemStream] = createSignal(false);

  const [pendingPermission, setPendingPermission] = createSignal<PermissionRequest | null>(null);
  const [modelId, setModelId] = createSignal(props.modelId ?? "");
  const [clockTick, setClockTick] = createSignal(Date.now());

  let inputRef: any;
  let pendingResolver: ((resolution: PermissionResolution) => void) | null = null;
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let refreshSeq = 0;

  const refreshTokens = new Map<string, number>();
  const cancelledByUser = new Set<string>();
  const titleInFlight = new Set<string>();

  const selectedSession = createMemo(() => sessions().find((session) => session.id === selectedSessionId()));

  const selectedEvents = createMemo(() => {
    const sessionId = selectedSessionId();
    if (!sessionId) return [];
    return eventsBySession()[sessionId] ?? [];
  });

  const selectedStreamingText = createMemo(() => {
    const sessionId = selectedSessionId();
    if (!sessionId) return "";
    return streamBySession()[sessionId] ?? "";
  });

  const selectedRunState = createMemo<SessionRunState>(() => {
    const sessionId = selectedSessionId();
    if (!sessionId) return { phase: "idle" };
    return asRunState(runStateBySession()[sessionId]);
  });

  const running = createMemo(() => {
    const phase = selectedRunState().phase;
    return phase === "running" || phase === "tool";
  });

  const runStatusText = createMemo(() => {
    const state = selectedRunState();
    if (state.phase === "running") {
      const elapsed = state.startedAt ? `${Math.max(0, Math.floor((clockTick() - state.startedAt) / 1000))}s` : "0s";
      return `thinking ${elapsed}`;
    }
    if (state.phase === "tool") {
      const elapsed = state.startedAt ? `${Math.max(0, Math.floor((clockTick() - state.startedAt) / 1000))}s` : "0s";
      return `tool ${elapsed}`;
    }
    if (state.phase === "failed") return "failed";
    if (state.phase === "cancelled") return "cancelled";
    return "idle";
  });

  const runStatusColor = createMemo(() => {
    const state = selectedRunState();
    if (state.phase === "running") return theme.colors.warning;
    if (state.phase === "tool") return theme.colors.accent;
    if (state.phase === "failed") return theme.colors.danger;
    if (state.phase === "cancelled") return theme.colors.warning;
    return theme.colors.faint;
  });

  const runtimeModeText = createMemo(() => (status()?.mode === "daemon" ? "daemon" : "local"));
  const daemonUp = createMemo(() => status()?.daemonHealthy ?? false);
  const daemonText = createMemo(() => (daemonUp() ? "up" : "down"));

  const lastEventAt = createMemo(() => selectedEvents().at(-1)?.createdAt ?? null);
  const lastEventAge = createMemo(() => formatAge(lastEventAt(), clockTick()));

  const waitingHint = createMemo(() => {
    if (!running()) return null;
    const last = lastEventAt();
    if (!last) return "waiting for model/tool...";
    if (clockTick() - last < 3000) return null;
    return "waiting for model/tool...";
  });

  const reconnectHint = createMemo(() => {
    const currentError = error();
    if (!currentError) return null;
    if (!/daemon|stream|disconnect|network/i.test(currentError)) return null;
    return "connection issue. check daemon health / logs";
  });

  const latestActivity = createMemo(() => {
    const relevant = selectedEvents()
      .filter((event) =>
        [
          "run_started",
          "tool_call",
          "tool_result",
          "permission_request",
          "permission_resolved",
          "run_finished",
          "run_failed",
          "model_timeout",
          "error",
          "done",
        ].includes(event.kind),
      )
      .slice(-2);
    if (relevant.length === 0) return "no activity";
    return relevant
      .map(
        (event) =>
          `${activityLabel(event)} (${new Date(event.createdAt).toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })})`,
      )
      .join(" · ");
  });

  const sessionDisplayLabel = createMemo(() => {
    const session = selectedSession();
    if (!session) return "none";
    const title = normalizeTitle(session.name);
    if (title) return title;
    return session.id.length > 20 ? `${session.id.slice(0, 8)}…${session.id.slice(session.id.length - 6)}` : session.id;
  });

  function focusInputSoon() {
    setTimeout(() => {
      if (inputRef && !inputRef.isDestroyed) inputRef.focus();
    }, 1);
  }

  function setSessionEvents(sessionId: string, updater: (events: TuiEvent[]) => TuiEvent[]) {
    setEventsBySession((current) => {
      const next = updater(current[sessionId] ?? []);
      return { ...current, [sessionId]: next };
    });
  }

  function setSessionStreaming(sessionId: string, value: string) {
    setStreamBySession((current) => ({ ...current, [sessionId]: value }));
  }

  function setSessionRunState(sessionId: string, next: SessionRunState | ((s: SessionRunState) => SessionRunState)) {
    setRunStateBySession((current) => {
      const prev = asRunState(current[sessionId]);
      const value = typeof next === "function" ? next(prev) : next;
      return { ...current, [sessionId]: value };
    });
  }

  async function refreshEvents(sessionId: string) {
    const token = ++refreshSeq;
    refreshTokens.set(sessionId, token);
    const loaded = await props.runtime.listEvents(sessionId);
    if (refreshTokens.get(sessionId) !== token) return;
    setSessionEvents(sessionId, (existing) => mergeEvents(existing, loaded));
  }

  function selectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    refreshEvents(sessionId).catch((refreshError) => {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
      setError(message);
    });
  }

  async function refreshSessions() {
    const listed = await props.runtime.listSessions(60);
    setSessions(listed);

    if (!selectedSessionId() && listed[0]) {
      selectSession(listed[0].id);
      return;
    }

    const selected = selectedSessionId();
    if (selected && listed.length > 0 && !listed.some((s) => s.id === selected)) {
      selectSession(listed[0].id);
    }
  }

  async function refreshStatus() {
    try {
      const nextStatus = await props.runtime.getStatus();
      setStatus(nextStatus);
      if (!modelId()) setModelId(nextStatus.modelId);
    } catch {
      setStatus((current) => (current ? { ...current, daemonHealthy: false } : current));
      throw new Error("status refresh failed");
    }
  }

  async function refreshLogs() {
    setLogs(await props.runtime.getLogs(40));
  }

  async function createSession() {
    const sessionId = await props.runtime.createSession();
    setSessionRunState(sessionId, { phase: "idle" });
    setSessionStreaming(sessionId, "");
    await refreshSessions();
    selectSession(sessionId);
  }

  function cycleSession(offset: number) {
    const list = sessions();
    if (list.length === 0) return;

    const index = list.findIndex((s) => s.id === selectedSessionId());
    const start = index < 0 ? 0 : index;
    const next = ((start + offset) % list.length + list.length) % list.length;
    const sessionId = list[next]?.id;
    if (!sessionId) return;
    selectSession(sessionId);
  }

  function appendEvent(event: TuiEvent) {
    setSessionEvents(event.sessionId, (current) => mergeEvents(current, [event]));

    if (event.kind === "run_started") {
      setSessionRunState(event.sessionId, { phase: "running", startedAt: Date.now() });
      setSessionStreaming(event.sessionId, "");
      return;
    }

    if (event.kind === "assistant_delta") {
      const text = payloadText(event);
      if (text) {
        setSessionRunState(event.sessionId, (current) => ({
          phase: "running",
          startedAt: current.startedAt ?? Date.now(),
          message: current.message,
        }));
        setStreamBySession((current) => ({
          ...current,
          [event.sessionId]: `${current[event.sessionId] ?? ""}${text}`,
        }));
      }
      return;
    }

    if (event.kind === "tool_call") {
      const payload =
        typeof event.payload === "object" && event.payload !== null ? (event.payload as Record<string, unknown>) : {};
      const tool = typeof payload.tool === "string" ? payload.tool : "tool";
      setSessionRunState(event.sessionId, (current) => ({
        phase: "tool",
        startedAt: current.startedAt ?? Date.now(),
        message: tool,
      }));
      return;
    }

    if (event.kind === "tool_result") {
      setSessionRunState(event.sessionId, (current) => ({
        phase: "running",
        startedAt: current.startedAt ?? Date.now(),
        message: current.message,
      }));
      return;
    }

    if (event.kind === "assistant") {
      setSessionStreaming(event.sessionId, "");
      return;
    }

    if (event.kind === "run_finished" || event.kind === "done") {
      cancelledByUser.delete(event.sessionId);
      setSessionStreaming(event.sessionId, "");
      setSessionRunState(event.sessionId, { phase: "idle" });
      return;
    }

    if (event.kind === "run_failed" || event.kind === "model_timeout" || event.kind === "error") {
      const payload =
        typeof event.payload === "object" && event.payload !== null ? (event.payload as { message?: string }) : {};
      const message = typeof payload.message === "string" ? payload.message : event.kind;
      setSessionStreaming(event.sessionId, "");
      if (isCancelMessage(message) || cancelledByUser.has(event.sessionId)) {
        setSessionRunState(event.sessionId, { phase: "cancelled", message });
      } else {
        setSessionRunState(event.sessionId, { phase: "failed", message });
      }
      return;
    }
  }

  function requestPermission(request: PermissionRequest): Promise<PermissionResolution> {
    return new Promise((resolve) => {
      pendingResolver = resolve;
      setPendingPermission(request);
    });
  }

  function resolvePermission(resolution: PermissionResolution) {
    pendingResolver?.(resolution);
    pendingResolver = null;
    setPendingPermission(null);
  }

  async function cancelActiveRun() {
    const sessionId = selectedSessionId();
    if (!sessionId) return;
    cancelledByUser.add(sessionId);
    setSessionRunState(sessionId, (current) => ({
      phase: "running",
      startedAt: current.startedAt ?? Date.now(),
      message: "cancelling",
    }));
    await props.runtime.cancelRun(sessionId);
  }

  function toggleSessionsSidebar() {
    setShowSessions((v) => !v);
  }

  function toggleInspector() {
    setShowInspector((v) => !v);
  }

  function toggleTools() {
    setShowToolsExpanded((v) => !v);
  }

  async function executeCommand(command: string, arg: string): Promise<boolean> {
    if (command === "help") {
      setShowPalette(true);
      return true;
    }

    if (command === "new") {
      await createSession();
      return true;
    }

    if (command === "sessions") {
      await refreshSessions();
      if (arg === "next") cycleSession(1);
      if (arg === "prev") cycleSession(-1);
      return true;
    }

    if (command === "toggle") {
      if (arg === "sessions") toggleSessionsSidebar();
      else if (arg === "inspector") toggleInspector();
      else if (arg === "tools") toggleTools();
      else setError("usage: /toggle sessions|inspector|tools");
      return true;
    }

    if (command === "status") {
      toggleInspector();
      return true;
    }

    if (command === "events") {
      setShowSystemStream((prev) => !prev);
      return true;
    }

    if (command === "logs") {
      await refreshLogs();
      setShowInspector(true);
      return true;
    }

    if (command === "stop") {
      await cancelActiveRun();
      return true;
    }

    if (command === "model") {
      if (!arg) {
        setError("usage: /model <model-id>");
        return true;
      }
      setModelId(arg);
      return true;
    }

    if (command === "quit") {
      renderer.destroy();
      return true;
    }

    setError(`unknown command: /${command}`);
    return true;
  }

  async function handleCommand(value: string): Promise<boolean> {
    const [command, ...rest] = value.slice(1).split(" ").filter(Boolean);
    const arg = rest.join(" ").trim();
    return executeCommand(command, arg);
  }

  const paletteItems = createMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      { id: "new", title: "new session", hint: "create and switch", keybind: "ctrl+n", category: "session", kind: "command" },
      { id: "sessions prev", title: "previous session", hint: "cycle backward", keybind: "ctrl+p", category: "session", kind: "command" },
      { id: "sessions next", title: "next session", hint: "cycle forward", keybind: "ctrl+shift+n", category: "session", kind: "command" },
      { id: "toggle sessions", title: `${showSessions() ? "hide" : "show"} sessions`, keybind: "ctrl+b", category: "view", kind: "command" },
      { id: "toggle inspector", title: `${showInspector() ? "hide" : "show"} inspector`, keybind: "ctrl+s", category: "view", kind: "command" },
      { id: "toggle tools", title: `${showToolsExpanded() ? "compact" : "expand"} tools`, keybind: "ctrl+t", category: "view", kind: "command" },
      { id: "events", title: `${showSystemStream() ? "hide" : "show"} system stream`, keybind: "ctrl+e", category: "view", kind: "command" },
      { id: "logs", title: "refresh logs", hint: "open inspector", keybind: "ctrl+l", category: "runtime", kind: "command" },
      { id: "stop", title: "stop current run", hint: "cancel generation", keybind: "ctrl+x", category: "runtime", kind: "command" },
      { id: "quit", title: "quit", keybind: "ctrl+q", category: "app", kind: "command" },
    ];

    for (const session of sessions().slice(0, 60)) {
      const name = normalizeTitle(session.name) ?? (session.id.length > 18 ? `${session.id.slice(0, 8)}…${session.id.slice(-6)}` : session.id);
      const time = formatSessionTime(session.lastEventAt ?? session.createdAt);
      items.push({
        id: `session:${session.id}`,
        title: name,
        hint: `${time} · ${session.eventCount}`,
        kind: "session",
        category: "sessions",
      });
    }

    return items;
  });

  async function maybeAutoRenameSession(sessionId: string, promptText: string) {
    const session = sessions().find((entry) => entry.id === sessionId);
    if (!session) return;
    if (normalizeTitle(session.name)) return;
    if (titleInFlight.has(sessionId)) return;

    titleInFlight.add(sessionId);
    try {
      const fallback = fallbackTitle(promptText);
      const suggested = normalizeTitle(await props.runtime.suggestSessionName(promptText));
      const finalTitle = suggested ?? fallback;
      if (!finalTitle) return;
      await props.runtime.renameSession(sessionId, finalTitle);
      await refreshSessions();
    } catch {
      // Keep chat flow unblocked if title generation fails.
    } finally {
      titleInFlight.delete(sessionId);
    }
  }

  async function submitPrompt() {
    const value = prompt().trim();
    if (!value || running()) return;

    setError(null);
    setPrompt("");
    inputRef?.clear?.();

    if (value.startsWith("/")) {
      await handleCommand(value);
      return;
    }

    let sessionId = selectedSessionId();
    if (!sessionId) {
      await createSession();
      sessionId = selectedSessionId();
    }
    if (!sessionId) return;

    void maybeAutoRenameSession(sessionId, value);
    setSessionRunState(sessionId, { phase: "running", startedAt: Date.now() });
    setSessionStreaming(sessionId, "");

    try {
      await props.runtime.runPrompt({
        sessionId,
        prompt: value,
        modelId: modelId() || undefined,
        timeoutMs: props.timeoutMs,
        onEvent: appendEvent,
        onPermissionRequest: requestPermission,
      });
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      if (isCancelMessage(message) || cancelledByUser.has(sessionId)) {
        setSessionRunState(sessionId, { phase: "cancelled", message });
      } else {
        setSessionRunState(sessionId, { phase: "failed", message });
        setError(message);
      }
    } finally {
      cancelledByUser.delete(sessionId);
      setSessionRunState(sessionId, (current) => {
        if (current.phase === "running" || current.phase === "tool") return { phase: "idle" };
        return current;
      });
      await refreshSessions();
      await refreshStatus();
      await refreshLogs();
    }
  }

  useKeyboard((evt) => {
    const withCtrl = Boolean((evt as { ctrl?: boolean }).ctrl || (evt as { meta?: boolean }).meta);
    const withShift = Boolean((evt as { shift?: boolean }).shift);

    if (withCtrl && evt.name === "q") {
      evt.preventDefault();
      renderer.destroy();
      return;
    }

    if (showPalette()) return;

    if (withCtrl && evt.name === "k") {
      evt.preventDefault();
      setShowPalette(true);
      return;
    }

    if (withCtrl && evt.name === "b") {
      evt.preventDefault();
      toggleSessionsSidebar();
      return;
    }

    if (withCtrl && evt.name === "t") {
      evt.preventDefault();
      toggleTools();
      return;
    }

    if (withCtrl && withShift && evt.name === "n") {
      evt.preventDefault();
      cycleSession(1);
      return;
    }

    if (withCtrl && evt.name === "n") {
      evt.preventDefault();
      createSession().catch((createError) => {
        const message = createError instanceof Error ? createError.message : String(createError);
        setError(message);
      });
      return;
    }

    if (withCtrl && evt.name === "p") {
      evt.preventDefault();
      cycleSession(-1);
      return;
    }

    if (withCtrl && evt.name === "e") {
      evt.preventDefault();
      setShowSystemStream((prev) => !prev);
      return;
    }

    if (withCtrl && evt.name === "l") {
      evt.preventDefault();
      Promise.all([refreshSessions(), refreshStatus(), refreshLogs()]).catch((refreshError) => {
        const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
        setError(message);
      });
      return;
    }

    if (withCtrl && evt.name === "s") {
      evt.preventDefault();
      toggleInspector();
      return;
    }

    if (withCtrl && evt.name === "x") {
      evt.preventDefault();
      cancelActiveRun().catch((cancelError) => {
        const message = cancelError instanceof Error ? cancelError.message : String(cancelError);
        setError(message);
      });
      return;
    }
  });

  onMount(async () => {
    if (renderer.width < 110) setShowInspector(false);
    if (renderer.width < 90) setShowSessions(false);

    await refreshSessions();
    await refreshStatus();
    await refreshLogs();

    statusTimer = setInterval(() => {
      refreshStatus().catch(() => undefined);
    }, 5000);

    clockTimer = setInterval(() => {
      setClockTick(Date.now());
    }, 1000);

    focusInputSoon();
  });

  onCleanup(() => {
    if (statusTimer) clearInterval(statusTimer);
    if (clockTimer) clearInterval(clockTimer);
    props.runtime.close().catch(() => undefined);
  });

  return (
    <box flexDirection="column" height="100%" backgroundColor={theme.colors.bg}>
      <box
        flexDirection="row"
        border
        borderStyle={theme.border.panelStyle}
        borderColor={theme.colors.border}
        backgroundColor={theme.colors.panel}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.colors.text} attributes={1}>blah-code</text>
        <text fg={theme.colors.faint}>{` · ${runtimeModeText()}`}</text>
        <text fg={theme.colors.faint}>{` · daemon ${daemonText()}`}</text>
        <box flexGrow={1} />
        <text fg={theme.colors.muted}>model:</text>
        <text fg={theme.colors.text}>{` ${modelId() || "default"}`}</text>
        <text fg={theme.colors.faint}>{` · `}</text>
        <text fg={theme.colors.muted}>session:</text>
        <text fg={theme.colors.text}>{` ${sessionDisplayLabel()}`}</text>
        <text fg={theme.colors.faint}>{` · `}</text>
        <text fg={theme.colors.muted}>state:</text>
        <text fg={runStatusColor()} attributes={1}>{` ${selectedRunState().phase}`}</text>
        <text fg={theme.colors.faint}>{` · `}</text>
        <text fg={theme.colors.muted}>last:</text>
        <text fg={theme.colors.text}>{` ${lastEventAge()}`}</text>
      </box>

      <box flexGrow={1} flexDirection="row" gap={theme.layout.gap}>
        <Show when={showSessions()}>
          <SessionList sessions={sessions()} selectedSessionId={selectedSessionId()} onSelect={selectSession} />
        </Show>

        <box
          flexDirection="column"
          flexGrow={1}
          border
          borderStyle={theme.border.panelStyle}
          borderColor={theme.colors.border}
          backgroundColor={theme.colors.panelAlt}
          padding={1}
        >
          <box flexDirection="row">
            <text fg={theme.colors.text} attributes={1}>chat</text>
            <text fg={theme.colors.faint}>{` · ${latestActivity()}`}</text>
            <box flexGrow={1} />
            <text fg={runStatusColor()} attributes={1}>{runStatusText()}</text>
          </box>
          <EventTimeline
            events={selectedEvents()}
            streamingText={selectedStreamingText()}
            showSystemStream={showSystemStream()}
            showToolsExpanded={showToolsExpanded()}
            runState={selectedRunState()}
          />
        </box>

        <Show when={showInspector()}>
          <StatusPanel status={status()} logs={logs()} />
        </Show>
      </box>

      <box
        flexDirection="column"
        border
        borderStyle={theme.border.panelStyle}
        borderColor={theme.colors.border}
        backgroundColor={theme.colors.panel}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        <box
          flexDirection="row"
          border
          borderStyle="single"
          borderColor={running() ? theme.colors.warning : theme.colors.border}
          backgroundColor={theme.colors.bg}
          paddingLeft={1}
          paddingRight={1}
          minHeight={3}
        >
          <text fg={running() ? theme.colors.warning : theme.colors.faint}>{"> "}</text>
          <textarea
            ref={(value: unknown) => {
              inputRef = value;
            }}
            flexGrow={1}
            initialValue=""
            placeholder="Ask anything..."
            wrapMode="word"
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "return", shift: true, action: "newline" },
            ]}
            onContentChange={() => setPrompt(inputRef?.plainText ?? "")}
            onSubmit={() => {
              submitPrompt().catch((submitError) => {
                const message = submitError instanceof Error ? submitError.message : String(submitError);
                setError(message);
              });
            }}
          />
          <Show when={running()}>
            <text fg={theme.colors.warning} attributes={1}> thinking</text>
          </Show>
        </box>

        <text fg={theme.colors.faint}>
          enter send · shift+enter newline · ctrl+k palette · ctrl+b sessions · ctrl+s inspector · ctrl+t tools · ctrl+e system · ctrl+x stop · ctrl+q quit
        </text>
        <Show when={waitingHint()}>
          <text fg={theme.colors.warning}>{waitingHint()!}</text>
        </Show>
        <Show when={reconnectHint()}>
          <text fg={theme.colors.warning}>{reconnectHint()!}</text>
        </Show>
        <Show when={error()}>
          <text fg={theme.colors.danger}>{error()}</text>
        </Show>
      </box>

      <Show when={showPalette()}>
        <CommandPalette
          items={paletteItems()}
          onClose={() => {
            setShowPalette(false);
            focusInputSoon();
          }}
          onSelect={(id) => {
            const prefix = "session:";
            if (id.startsWith(prefix)) {
              selectSession(id.slice(prefix.length));
              setShowPalette(false);
              focusInputSoon();
              return;
            }

            handleCommand(`/${id}`)
              .catch((commandError) => {
                const message = commandError instanceof Error ? commandError.message : String(commandError);
                setError(message);
              })
              .finally(() => {
                setShowPalette(false);
                focusInputSoon();
              });
          }}
        />
      </Show>

      <Show when={pendingPermission()}>
        <PermissionModal request={pendingPermission()!} onResolve={resolvePermission} />
      </Show>
    </box>
  );
}

export async function runTui(options: RunTuiOptions): Promise<void> {
  const runtime = createRuntimeClient(options);
  await render(() => <TuiApp runtime={runtime} modelId={options.modelId} timeoutMs={options.timeoutMs} />, {
    targetFps: 60,
    exitOnCtrlC: true,
  });
}