import { For, Show } from "solid-js";
import type { RuntimeStatus } from "../runtime";

interface StatusPanelProps {
  status: RuntimeStatus | null;
  logs: string[];
}

export function StatusPanel(props: StatusPanelProps) {
  return (
    <box flexDirection="column" border borderColor="#3f3f46" padding={1} width={44}>
      <text attributes={1}>status</text>
      <Show when={props.status}>
        <text>mode: {props.status?.mode}</text>
        <text>cwd: {props.status?.cwd}</text>
        <text>model: {props.status?.modelId}</text>
        <text>daemon: {props.status?.daemonHealthy ? "up" : "down"}</text>
        <text>api key: {props.status?.apiKeyPresent ? "present" : "missing"}</text>
        <text>active sessions: {props.status?.activeSessions.length ?? 0}</text>
        <text>db: {props.status?.dbPath}</text>
        <text>logs: {props.status?.logPath}</text>
      </Show>
      <text fg="#a1a1aa">recent logs</text>
      <scrollbox flexGrow={1}>
        <For each={props.logs}>
          {(line) => <text fg="#a1a1aa">{line}</text>}
        </For>
      </scrollbox>
    </box>
  );
}
