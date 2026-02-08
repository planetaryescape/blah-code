import { For, Show } from "solid-js";
import type { RuntimeStatus } from "../runtime";
import { theme } from "../theme";

interface StatusPanelProps {
  status: RuntimeStatus | null;
  logs: string[];
}

export function StatusPanel(props: StatusPanelProps) {
  const clamp = (value: string | undefined, max: number): string =>
    !value ? "-" : value.length > max ? `${value.slice(0, max - 1)}…` : value;

  return (
    <box
      flexDirection="column"
      border
      borderStyle={theme.border.panelStyle}
      borderColor={theme.colors.border}
      backgroundColor={theme.colors.panel}
      padding={1}
      width={theme.layout.inspectorWidth}
    >
      <text fg={theme.colors.text} attributes={1}>inspector</text>
      <Show when={props.status}>
        <text fg={theme.colors.muted} attributes={1}>runtime</text>
        <text fg={theme.colors.text}>mode: {props.status?.mode === "in_process" ? "local" : "daemon"}</text>
        <text fg={theme.colors.text}>model: {props.status?.modelId}</text>
        <text fg={props.status?.daemonHealthy ? theme.colors.success : theme.colors.danger}>
          daemon: {props.status?.daemonHealthy ? "up" : "down"}
        </text>
        <text fg={props.status?.apiKeyPresent ? theme.colors.success : theme.colors.danger}>
          api key: {props.status?.apiKeyPresent ? "present" : "missing"}
        </text>
        <text fg={theme.colors.text}>active: {props.status?.activeSessions.length ?? 0}</text>
        <text fg={theme.colors.muted}>cwd: {clamp(props.status?.cwd, 38)}</text>
        <text fg={theme.colors.faint}>db: {clamp(props.status?.dbPath, 38)}</text>
        <text fg={theme.colors.faint}>logs: {clamp(props.status?.logPath, 38)}</text>
      </Show>
      <box marginTop={1}>
        <text fg={theme.colors.muted} attributes={1}>logs</text>
      </box>
      <scrollbox flexGrow={1} border borderColor={theme.colors.border} paddingLeft={1} paddingRight={1}>
        <For each={props.logs}>
          {(line) => <text fg={theme.colors.muted}>{line}</text>}
        </For>
      </scrollbox>
    </box>
  );
}