import { render, useKeyboard, useRenderer } from "@opentui/solid";
import type { PermissionRequest, PermissionResolution } from "@blah-code/core";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { EventTimeline } from "./components/EventTimeline";
import { PermissionModal } from "./components/PermissionModal";
import { SessionList } from "./components/SessionList";
import { StatusPanel } from "./components/StatusPanel";
import { createRuntimeClient } from "./runtime";
import type { RuntimeClient } from "./runtime";
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

function TuiApp(props: TuiAppProps) {
  const renderer = useRenderer();

  const [sessions, setSessions] = createSignal<
    Array<{ id: string; createdAt: number; lastEventAt: number | null; eventCount: number }>
  >([]);
  const [selectedSessionId, setSelectedSessionId] = createSignal<string | null>(null);
  const [events, setEvents] = createSignal<TuiEvent[]>([]);
  const [prompt, setPrompt] = createSignal("");
  const [running, setRunning] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [streamingText, setStreamingText] = createSignal("");
  const [status, setStatus] = createSignal<Awaited<ReturnType<RuntimeClient["getStatus"]>> | null>(null);
  const [logs, setLogs] = createSignal<string[]>([]);
  const [showStatus, setShowStatus] = createSignal(true);
  const [showPalette, setShowPalette] = createSignal(false);
  const [pendingPermission, setPendingPermission] = createSignal<PermissionRequest | null>(null);
  const [modelId, setModelId] = createSignal(props.modelId ?? "");

  let inputRef: any;
  let pendingResolver: ((resolution: PermissionResolution) => void) | null = null;
  let statusTimer: ReturnType<typeof setInterval> | null = null;

  const selectedSession = createMemo(() => sessions().find((session) => session.id === selectedSessionId()));

  function selectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    refreshEvents(sessionId).catch((refreshError) => {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
      setError(message);
    });
  }

  async function refreshSessions() {
    const listed = await props.runtime.listSessions(40);
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

  async function refreshEvents(sessionId: string) {
    setEvents(await props.runtime.listEvents(sessionId));
  }

  async function refreshStatus() {
    const nextStatus = await props.runtime.getStatus();
    setStatus(nextStatus);
    if (!modelId()) {
      setModelId(nextStatus.modelId);
    }
  }

  async function refreshLogs() {
    setLogs(await props.runtime.getLogs(30));
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
      const payload =
        typeof event.payload === "object" && event.payload !== null
          ? (event.payload as { text?: string })
          : {};
      if (payload.text) {
        setStreamingText((current) => current + payload.text);
      }
      return;
    }

    if (event.kind === "assistant" || event.kind === "run_finished" || event.kind === "run_failed") {
      setStreamingText("");
    }

    setEvents((current) => [...current, event]);
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
    { id: "new", title: "new session", hint: "create and switch", keybind: "ctrl+n" },
    { id: "sessions prev", title: "previous session", hint: "cycle backward", keybind: "ctrl+p" },
    { id: "sessions next", title: "next session", hint: "cycle forward", keybind: "ctrl+shift+n" },
    { id: "status", title: `${showStatus() ? "hide" : "show"} status panel`, keybind: "ctrl+s" },
    { id: "logs", title: "refresh logs", hint: "open status logs", keybind: "ctrl+l" },
    { id: "quit", title: "quit", keybind: "ctrl+q" },
  ]);

  async function submitPrompt() {
    const value = prompt().trim();
    if (!value || running()) return;

    setError(null);
    setPrompt("");

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

    setEvents((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        sessionId,
        kind: "user",
        payload: { text: value },
        createdAt: Date.now(),
      },
    ]);

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

    if (withCtrl && evt.name === "l") {
      evt.preventDefault();
      Promise.all([refreshSessions(), refreshStatus(), refreshLogs()]).catch((refreshError) => {
        const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
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
      return;
    }

    if (withCtrl && evt.name === "s") {
      evt.preventDefault();
      setShowStatus((prev) => !prev);
    }
  });

  createEffect(() => {
    const sessionId = selectedSessionId();
    if (!sessionId) return;
    refreshEvents(sessionId).catch((refreshError) => {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
      setError(message);
    });
  });

  onMount(async () => {
    await refreshSessions();
    await refreshStatus();
    await refreshLogs();
    statusTimer = setInterval(() => {
      refreshStatus().catch(() => undefined);
    }, 5000);
    setTimeout(() => {
      if (inputRef && !inputRef.isDestroyed) inputRef.focus();
    }, 1);
  });

  onCleanup(() => {
    if (statusTimer) clearInterval(statusTimer);
    props.runtime.close().catch(() => undefined);
  });

  return (
    <box flexDirection="column" height="100%">
      <box flexGrow={1} gap={1}>
        <SessionList
          sessions={sessions()}
          selectedSessionId={selectedSessionId()}
          onSelect={(id) => {
            selectSession(id);
          }}
        />

        <box flexDirection="column" flexGrow={1} border borderColor="#3f3f46" padding={1}>
          <box flexDirection="row">
            <text attributes={1}>session: {selectedSession()?.id ?? "none"}</text>
            <box flexGrow={1} />
            <text fg={running() ? "#fbbf24" : "#71717a"}>{running() ? "running" : "idle"}</text>
          </box>
          <EventTimeline events={events()} streamingText={streamingText()} />
        </box>

        <Show when={showStatus()}>
          <StatusPanel status={status()} logs={logs()} />
        </Show>
      </box>

      <box flexDirection="column" border borderColor="#3f3f46" padding={1}>
        <input
          ref={(value: unknown) => {
            inputRef = value;
          }}
          value={prompt()}
          placeholder="Type message... (Enter send, /help commands)"
          onInput={(value: string) => setPrompt(value)}
          onSubmit={() => {
            submitPrompt().catch((submitError) => {
              const message = submitError instanceof Error ? submitError.message : String(submitError);
              setError(message);
            });
          }}
        />
        <text fg="#71717a">
          enter send · ctrl+k palette · ctrl+n new · ctrl+p prev · ctrl+shift+n next · ctrl+s status · ctrl+q quit
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
            setTimeout(() => {
              if (inputRef && !inputRef.isDestroyed) inputRef.focus();
            }, 1);
          }}
          onSelect={(commandId) => {
            handleCommand(`/${commandId}`)
              .catch((commandError) => {
                const message = commandError instanceof Error ? commandError.message : String(commandError);
                setError(message);
              })
              .finally(() => {
                setShowPalette(false);
                setTimeout(() => {
                  if (inputRef && !inputRef.isDestroyed) inputRef.focus();
                }, 1);
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
