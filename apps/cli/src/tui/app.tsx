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

function TuiApp(props: TuiAppProps) {
  const renderer = useRenderer();

  const [sessions, setSessions] = createSignal<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = createSignal<string | null>(null);
  const [events, setEvents] = createSignal<TuiEvent[]>([]);
  const [prompt, setPrompt] = createSignal("");
  const [running, setRunning] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [streamingText, setStreamingText] = createSignal("");
  const [status, setStatus] = createSignal<Awaited<ReturnType<RuntimeClient["getStatus"]>> | null>(null);
  const [logs, setLogs] = createSignal<string[]>([]);
  const [showStatus, setShowStatus] = createSignal(false);
  const [showPalette, setShowPalette] = createSignal(false);
  const [showSystemStream, setShowSystemStream] = createSignal(false);
  const [pendingPermission, setPendingPermission] = createSignal<PermissionRequest | null>(null);
  const [modelId, setModelId] = createSignal(props.modelId ?? "");

  let inputRef: any;
  let pendingResolver: ((resolution: PermissionResolution) => void) | null = null;
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  const titleInFlight = new Set<string>();

  const selectedSession = createMemo(() =>
    sessions().find((session) => session.id === selectedSessionId()),
  );

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

  async function refreshEvents(sessionId: string) {
    const loaded = await props.runtime.listEvents(sessionId);
    setStreamingText("");
    setEvents(sortEvents(loaded));
  }

  function selectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    setStreamingText("");
    setEvents([]);
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
    const nextStatus = await props.runtime.getStatus();
    setStatus(nextStatus);
    if (!modelId()) setModelId(nextStatus.modelId);
  }

  async function refreshLogs() {
    setLogs(await props.runtime.getLogs(40));
  }

  async function createSession() {
    const sessionId = await props.runtime.createSession();
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
    if (event.sessionId !== selectedSessionId()) return;

    if (event.kind === "assistant_delta") {
      const text = payloadText(event);
      if (text) setStreamingText((current) => current + text);
      return;
    }

    if (
      event.kind === "assistant" ||
      event.kind === "run_finished" ||
      event.kind === "run_failed" ||
      event.kind === "done"
    ) {
      setStreamingText("");
    }

    setEvents((current) => mergeEvents(current, [event]));
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
    setRunning(true);
    setStreamingText("");

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
      setError(message);
    } finally {
      setRunning(false);
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
    focusInputSoon();
  });

  onCleanup(() => {
    if (statusTimer) clearInterval(statusTimer);
    props.runtime.close().catch(() => undefined);
  });

  return (
    <box flexDirection="column" height="100%" backgroundColor="#020617">
      <box
        flexDirection="row"
        border
        borderColor="#334155"
        backgroundColor="#0b1220"
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg="#86efac" attributes={1}>blah code</text>
        <text fg="#64748b"> · opencode mode</text>
        <box flexGrow={1} />
        <text fg="#94a3b8">model: {modelId() || "default"}</text>
        <text fg="#64748b"> · </text>
        <text fg="#bfdbfe">session: {sessionDisplayLabel()}</text>
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
            <text fg={running() ? "#fbbf24" : "#64748b"}>{running() ? "responding" : "idle"}</text>
          </box>
          <EventTimeline
            events={events()}
            streamingText={streamingText()}
            showSystemStream={showSystemStream()}
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
            placeholder="Ask anything…"
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
            <text fg="#fbbf24"> thinking…</text>
          </Show>
        </box>
        <text fg="#64748b">
          enter send · shift+enter newline · ctrl+k commands · ctrl+n new · ctrl+p prev · ctrl+e system · ctrl+s status · ctrl+q quit
        </text>
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
