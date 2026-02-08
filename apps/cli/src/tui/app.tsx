import type { PermissionRequest, PermissionResolution } from "@blah-code/core";
import type { SessionSummary } from "@blah-code/session";
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { EventTimeline } from "./components/EventTimeline";
import { PermissionModal } from "./components/PermissionModal";
import { SessionList } from "./components/SessionList";
import { StatusPanel } from "./components/StatusPanel";
import { createRuntimeClient, type RuntimeClient } from "./runtime";
import type { TuiEvent } from "./state";

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
    typeof event.payload === "object" && event.payload !== null
      ? (event.payload as { text?: string })
      : {};
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
    typeof event.payload === "object" && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : {};

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
  const [showStatus, setShowStatus] = createSignal(false);
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

  const selectedSession = createMemo(() =>
    sessions().find((session) => session.id === selectedSessionId()),
  );

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
      const elapsed = state.startedAt
        ? `${Math.max(0, Math.floor((clockTick() - state.startedAt) / 1000))}s`
        : "0s";
      return `thinking ${elapsed}`;
    }
    if (state.phase === "tool") {
      const elapsed = state.startedAt
        ? `${Math.max(0, Math.floor((clockTick() - state.startedAt) / 1000))}s`
        : "0s";
      return `tool ${elapsed}`;
    }
    if (state.phase === "failed") return "failed";
    if (state.phase === "cancelled") return "cancelled";
    return "idle";
  });

  const runStatusColor = createMemo(() => {
    const state = selectedRunState();
    if (state.phase === "running") return "#fbbf24";
    if (state.phase === "tool") return "#93c5fd";
    if (state.phase === "failed") return "#fca5a5";
    if (state.phase === "cancelled") return "#f59e0b";
    return "#64748b";
  });

  const elapsedRunAge = createMemo(() => {
    const startedAt = selectedRunState().startedAt;
    if (!startedAt) return "-";
    return formatAge(startedAt, clockTick());
  });

  const runtimeModeText = createMemo(() => (status()?.mode === "daemon" ? "daemon" : "local"));
  const daemonUp = createMemo(() => status()?.daemonHealthy ?? false);
  const daemonText = createMemo(() => (daemonUp() ? "up" : "down"));

  const lastEventAt = createMemo(() => {
    const list = selectedEvents();
    const last = list.at(-1);
    return last?.createdAt ?? null;
  });

  const lastEventAge = createMemo(() => formatAge(lastEventAt(), clockTick()));

  const waitingHint = createMemo(() => {
    if (!running()) return null;
    const age = lastEventAt();
    if (!age) return "waiting for model/tool...";
    if (clockTick() - age < 3000) return null;
    return "waiting for model/tool...";
  });

  const reconnectHint = createMemo(() => {
    const currentError = error();
    if (!currentError) return null;
    if (!/daemon|stream|disconnect|network/i.test(currentError)) return null;
    return "connection issue. check daemon health with /status or `blah-code status --attach <url>`";
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
      .slice(-4);
    if (relevant.length === 0) return "no activity";
    return relevant
      .map((event) => `${activityLabel(event)} (${new Date(event.createdAt).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })})`)
      .join(" · ");
  });

  const sessionDisplayLabel = createMemo(() => {
    const session = selectedSession();
    if (!session) return "none";
    const title = normalizeTitle(session.name);
    if (title) return title;
    return session.id.length > 20
      ? `${session.id.slice(0, 8)}…${session.id.slice(session.id.length - 6)}`
      : session.id;
  });

  function focusInputSoon() {
    setTimeout(() => {
      if (inputRef && !inputRef.isDestroyed) inputRef.focus();
    }, 1);
  }

  function setSessionEvents(sessionId: string, updater: (events: TuiEvent[]) => TuiEvent[]) {
    setEventsBySession((current) => {
      const next = updater(current[sessionId] ?? []);
      return {
        ...current,
        [sessionId]: next,
      };
    });
  }

  function setSessionStreaming(sessionId: string, value: string) {
    setStreamBySession((current) => ({
      ...current,
      [sessionId]: value,
    }));
  }

  function setSessionRunState(
    sessionId: string,
    next: SessionRunState | ((state: SessionRunState) => SessionRunState),
  ) {
    setRunStateBySession((current) => {
      const prev = asRunState(current[sessionId]);
      const value = typeof next === "function" ? next(prev) : next;
      return {
        ...current,
        [sessionId]: value,
      };
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
    if (selected && listed.length > 0 && !listed.some((session) => session.id === selected)) {
      selectSession(listed[0].id);
    }
  }

  async function refreshStatus() {
    try {
      const nextStatus = await props.runtime.getStatus();
      setStatus(nextStatus);
      if (!modelId()) setModelId(nextStatus.modelId);
    } catch (error) {
      setStatus((current) => (current ? { ...current, daemonHealthy: false } : current));
      throw error;
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

    const index = list.findIndex((session) => session.id === selectedSessionId());
    const start = index < 0 ? 0 : index;
    const next = ((start + offset) % list.length + list.length) % list.length;
    const sessionId = list[next]?.id;
    if (!sessionId) return;
    selectSession(sessionId);
  }

  function appendEvent(event: TuiEvent) {
    setSessionEvents(event.sessionId, (current) => mergeEvents(current, [event]));

    if (event.kind === "run_started") {
      setSessionRunState(event.sessionId, {
        phase: "running",
        startedAt: Date.now(),
      });
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
        typeof event.payload === "object" && event.payload !== null
          ? (event.payload as Record<string, unknown>)
          : {};
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
        typeof event.payload === "object" && event.payload !== null
          ? (event.payload as { message?: string })
          : {};
      const message = typeof payload.message === "string" ? payload.message : event.kind;
      setSessionStreaming(event.sessionId, "");
      if (isCancelMessage(message) || cancelledByUser.has(event.sessionId)) {
        setSessionRunState(event.sessionId, {
          phase: "cancelled",
          message,
        });
      } else {
        setSessionRunState(event.sessionId, {
          phase: "failed",
          message,
        });
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

    if (command === "status") {
      setShowStatus((prev) => !prev);
      return true;
    }

    if (command === "events") {
      setShowSystemStream((prev) => !prev);
      return true;
    }

    if (command === "logs") {
      await refreshLogs();
      setShowStatus(true);
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

  const paletteCommands = createMemo<PaletteCommand[]>(() => [
    { id: "new", title: "new session", hint: "create and switch", keybind: "ctrl+n", category: "session" },
    { id: "sessions prev", title: "previous session", hint: "cycle backward", keybind: "ctrl+p", category: "session" },
    { id: "sessions next", title: "next session", hint: "cycle forward", keybind: "ctrl+shift+n", category: "session" },
    { id: "events", title: `${showSystemStream() ? "hide" : "show"} system stream`, keybind: "ctrl+e", category: "view" },
    { id: "status", title: `${showStatus() ? "hide" : "show"} status panel`, keybind: "ctrl+s", category: "view" },
    { id: "logs", title: "refresh logs", hint: "open runtime logs", keybind: "ctrl+l", category: "runtime" },
    { id: "stop", title: "stop current run", hint: "cancel active generation", keybind: "ctrl+x", category: "runtime" },
    { id: "quit", title: "quit", keybind: "ctrl+q", category: "app" },
  ]);

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
    setSessionRunState(sessionId, {
      phase: "running",
      startedAt: Date.now(),
    });
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
        setSessionRunState(sessionId, {
          phase: "cancelled",
          message,
        });
      } else {
        setSessionRunState(sessionId, {
          phase: "failed",
          message,
        });
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
      setShowStatus((prev) => !prev);
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

    if (withCtrl && evt.name === "up") {
      evt.preventDefault();
      cycleSession(-1);
      return;
    }

    if (withCtrl && evt.name === "down") {
      evt.preventDefault();
      cycleSession(1);
    }
  });

  onMount(async () => {
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
    <box flexDirection="column" height="100%" backgroundColor="#020617">
      <box flexDirection="column" border borderColor="#334155" backgroundColor="#0b1220">
        <box flexDirection="row" paddingLeft={1} paddingRight={1}>
          <text fg="#86efac" attributes={1}>blah code</text>
          <text fg="#64748b"> · interactive</text>
          <box flexGrow={1} />
          <text fg="#94a3b8">model: {modelId() || "default"}</text>
          <text fg="#64748b"> · </text>
          <text fg="#bfdbfe">session: {sessionDisplayLabel()}</text>
        </box>
        <box flexDirection="row" paddingLeft={1} paddingRight={1}>
          <text fg="#94a3b8">runtime: {runtimeModeText()}</text>
          <text fg="#64748b"> · </text>
          <text fg={daemonUp() ? "#86efac" : "#fca5a5"}>daemon: {daemonText()}</text>
          <text fg="#64748b"> · </text>
          <text fg={runStatusColor()}>state: {selectedRunState().phase}</text>
          <text fg="#64748b"> · </text>
          <text fg="#94a3b8">elapsed: {elapsedRunAge()}</text>
          <text fg="#64748b"> · </text>
          <text fg="#94a3b8">last event: {lastEventAge()}</text>
        </box>
      </box>

      <box flexGrow={1} flexDirection="row" gap={1}>
        <SessionList sessions={sessions()} selectedSessionId={selectedSessionId()} onSelect={selectSession} />

        <box
          flexDirection="column"
          flexGrow={1}
          border
          borderColor="#334155"
          backgroundColor="#020b1b"
          padding={1}
        >
          <box flexDirection="row">
            <text fg="#e2e8f0" attributes={1}>conversation</text>
            <box flexGrow={1} />
            <text fg={runStatusColor()}>{runStatusText()}</text>
          </box>
          <box border borderColor="#1e293b" backgroundColor="#020617" paddingLeft={1} paddingRight={1}>
            <text fg="#94a3b8">activity: {latestActivity()}</text>
          </box>
          <EventTimeline
            events={selectedEvents()}
            streamingText={selectedStreamingText()}
            showSystemStream={showSystemStream()}
            runState={selectedRunState()}
          />
        </box>

        <Show when={showStatus()}>
          <StatusPanel status={status()} logs={logs()} />
        </Show>
      </box>

      <box
        flexDirection="column"
        border
        borderColor="#334155"
        backgroundColor="#0b1220"
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        <box
          flexDirection="row"
          border
          borderColor={running() ? "#f59e0b" : "#1e293b"}
          backgroundColor="#020617"
          paddingLeft={1}
          paddingRight={1}
          minHeight={3}
        >
          <text fg={running() ? "#fbbf24" : "#64748b"}>{"> "}</text>
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
            <text fg="#fbbf24"> thinking...</text>
          </Show>
        </box>
        <text fg="#64748b">
          enter send · shift+enter newline · ctrl+k commands · ctrl+n new · ctrl+p prev · ctrl+x stop · ctrl+e system · ctrl+s status · ctrl+q quit
        </text>
        <Show when={waitingHint()}>
          <text fg="#fbbf24">{waitingHint()!}</text>
        </Show>
        <Show when={reconnectHint()}>
          <text fg="#f59e0b">{reconnectHint()!}</text>
        </Show>
        <Show when={error()}>
          <text fg="#fca5a5">{error()}</text>
        </Show>
      </box>

      <Show when={showPalette()}>
        <CommandPalette
          commands={paletteCommands()}
          onClose={() => {
            setShowPalette(false);
            focusInputSoon();
          }}
          onSelect={(commandId) => {
            handleCommand(`/${commandId}`)
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
