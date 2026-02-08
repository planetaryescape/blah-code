import { createMemo, For, Show } from "solid-js";
import type { SessionSummary } from "@blah-code/session";
import { formatSessionTime } from "../state";
import { theme } from "../theme";

interface SessionListProps {
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  onSelect: (id: string) => void;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function SessionList(props: SessionListProps) {
  const selectedIndex = createMemo(() =>
    props.sessions.findIndex((session) => session.id === props.selectedSessionId),
  );

  const windowSize = 14;
  const startIndex = createMemo(() => {
    const index = selectedIndex();
    if (index < 0) return 0;
    const half = Math.floor(windowSize / 2);
    return Math.max(0, index - half);
  });

  const endIndex = createMemo(() => Math.min(props.sessions.length, startIndex() + windowSize));

  const visibleSessions = createMemo(() => props.sessions.slice(startIndex(), endIndex()));

  const shortId = (id: string): string =>
    id.length > 18 ? `${id.slice(0, 8)}…${id.slice(id.length - 6)}` : id;

  const displayName = (session: SessionSummary): string => {
    const name = typeof session.name === "string" ? session.name.trim() : "";
    return name || shortId(session.id);
  };

  return (
    <box
      flexDirection="column"
      border
      borderStyle={theme.border.panelStyle}
      borderColor={theme.colors.border}
      backgroundColor={theme.colors.panel}
      padding={1}
      width={theme.layout.sidebarWidth}
    >
      <box flexDirection="row">
        <text fg={theme.colors.text} attributes={1}>Sessions</text>
        <box flexGrow={1} />
        <text fg={theme.colors.muted}>
          {props.sessions.length > 0 ? `${Math.max(selectedIndex(), 0) + 1}/${props.sessions.length}` : "0/0"}
        </text>
      </box>

      <Show when={props.sessions.length === 0}>
        <box marginTop={1}>
          <text fg={theme.colors.muted}>no sessions yet</text>
        </box>
      </Show>

      <Show when={props.sessions.length > 0}>
        <box justifyContent="center">
          <text fg={theme.colors.faint}>
            {startIndex() > 0 ? `↑ ${startIndex()} more` : " "}
          </text>
        </box>
      </Show>

      <For each={visibleSessions()}>
        {(session, idx) => {
          const actualIndex = () => startIndex() + idx();
          const selected = () => actualIndex() === selectedIndex();
          const title = () => truncate(displayName(session), 23);
          const idLine = () => truncate(shortId(session.id), 23);
          const timeLine = () => truncate(formatSessionTime(session.lastEventAt ?? session.createdAt), 23);
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI box is the interactive primitive in TUI.
            <box
              flexDirection="column"
              backgroundColor={selected() ? theme.colors.accentSoft : undefined}
              border={selected() ? ["left"] : undefined}
              borderColor={selected() ? theme.colors.accent : undefined}
              paddingLeft={selected() ? 1 : 0}
              paddingTop={1}
              paddingBottom={1}
              onMouseUp={(event) => {
                if (event.button !== 0) return;
                props.onSelect(session.id);
              }}
            >
              <box flexDirection="row" width="100%">
                <text fg={selected() ? theme.colors.text : theme.colors.text} attributes={selected() ? 1 : 0}>
                  {title()}
                </text>
                <box flexGrow={1} />
                <text fg={selected() ? theme.colors.muted : theme.colors.faint}>{session.eventCount}</text>
              </box>
              <Show when={session.name}>
                <text fg={selected() ? theme.colors.muted : theme.colors.faint}>{idLine()}</text>
              </Show>
              <text fg={selected() ? theme.colors.muted : theme.colors.muted}>{timeLine()}</text>
            </box>
          );
        }}
      </For>

      <Show when={props.sessions.length > 0}>
        <box justifyContent="center">
          <text fg={theme.colors.faint}>
            {endIndex() < props.sessions.length ? `↓ ${props.sessions.length - endIndex()} more` : " "}
          </text>
        </box>
      </Show>

      <box marginTop={1}>
        <text fg={theme.colors.faint}>ctrl+b hide · ctrl+k jump</text>
      </box>
    </box>
  );
}