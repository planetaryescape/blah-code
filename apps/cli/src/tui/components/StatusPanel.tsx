import { For, Show } from "solid-js";
import type { RuntimeStatus } from "../runtime";

interface StatusPanelProps {
  status: RuntimeStatus | null;
  logs: string[];
}

export function StatusPanel(props: StatusPanelProps) {
  const clamp = (value: string | undefined, max: number): string =>
    !value ? "-" : value.length > max ? `${value.slice(0, max - 1)}…` : value;

  return (
    <box flexDirection="column" border borderColor="#334155" backgroundColor="#0b1220" padding={1} width={46}>
      <text fg="#e2e8f0" attributes={1}>runtime</text>
      <Show when={props.status}>
        <text fg="#cbd5e1">mode: {props.status?.mode === "in_process" ? "local" : "daemon"}</text>
        <text fg="#cbd5e1">model: {props.status?.modelId}</text>
        <text fg={props.status?.daemonHealthy ? "#86efac" : "#fca5a5"}>
          daemon: {props.status?.daemonHealthy ? "up" : "down"}
        </text>
        <text fg={props.status?.apiKeyPresent ? "#86efac" : "#fca5a5"}>
          api key: {props.status?.apiKeyPresent ? "present" : "missing"}
        </text>
        <text fg="#cbd5e1">active sessions: {props.status?.activeSessions.length ?? 0}</text>
        <text fg="#94a3b8">cwd: {clamp(props.status?.cwd, 40)}</text>
        <text fg="#64748b">db: {clamp(props.status?.dbPath, 40)}</text>
        <text fg="#64748b">logs: {clamp(props.status?.logPath, 40)}</text>
      </Show>
      <text fg="#94a3b8" attributes={1}>recent logs</text>
      <scrollbox flexGrow={1} border borderColor="#1e293b" paddingLeft={1} paddingRight={1}>
        <For each={props.logs}>
          {(line) => <text fg="#94a3b8">{line}</text>}
        </For>
      </scrollbox>
    </box>
  );
}
