import { useKeyboard } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { theme } from "../theme";

export interface PaletteItem {
  id: string;
  title: string;
  hint?: string;
  keybind?: string;
  category?: string;
  kind?: "command" | "session";
}

interface CommandPaletteProps {
  items: PaletteItem[];
  onSelect: (commandId: string) => void;
  onClose: () => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  let inputRef: any;

  const filtered = createMemo(() => {
    const needle = query().trim().toLowerCase();
    if (!needle) return props.items;
    return props.items.filter((command) => {
      const haystack =
        `${command.kind ?? ""} ${command.category ?? ""} ${command.title} ${command.hint ?? ""} ${command.keybind ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  });

  createEffect(() => {
    filtered();
    setSelectedIndex(0);
  });

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      evt.preventDefault();
      props.onClose();
      return;
    }

    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault();
      setSelectedIndex((idx) => Math.min(idx + 1, Math.max(filtered().length - 1, 0)));
      return;
    }

    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault();
      setSelectedIndex((idx) => Math.max(idx - 1, 0));
      return;
    }

    if (evt.name === "return") {
      evt.preventDefault();
      const selected = filtered()[selectedIndex()];
      if (!selected) return;
      props.onSelect(selected.id);
    }
  });

  createEffect(() => {
    setTimeout(() => {
      if (inputRef && !inputRef.isDestroyed) inputRef.focus();
    }, 1);
  });

  const windowSize = 8;
  const startIndex = createMemo(() => Math.max(0, selectedIndex() - Math.floor(windowSize / 2)));
  const endIndex = createMemo(() => Math.min(filtered().length, startIndex() + windowSize));
  const visible = createMemo(() => filtered().slice(startIndex(), endIndex()));

  return (
    <box
      position="absolute"
      zIndex={25}
      border
      borderColor={theme.colors.border}
      borderStyle={theme.border.modalStyle}
      backgroundColor={theme.colors.panel}
      width="74%"
      height={18}
      left="13%"
      top="12%"
      flexDirection="column"
      padding={1}
    >
      <box flexDirection="row">
        <text fg={theme.colors.text} attributes={1}>palette</text>
        <box flexGrow={1} />
        <text fg={theme.colors.faint}>{filtered().length}</text>
      </box>

      <box marginTop={1} marginBottom={1} border borderColor={theme.colors.border} paddingLeft={1}>
        <text fg={theme.colors.accent}>{"> "}</text>
        <input
          ref={(value: unknown) => {
            inputRef = value;
          }}
          placeholder="search command..."
          value={query()}
          onInput={(value: string) => setQuery(value)}
        />
      </box>

      <Show when={visible().length > 0} fallback={<text fg={theme.colors.faint}>no matches</text>}>
        <For each={visible()}>
          {(command, idx) => {
            const actualIndex = () => startIndex() + idx();
            const selected = () => actualIndex() === selectedIndex();
            return (
              <box
                flexDirection="row"
                width="100%"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={selected() ? theme.colors.accentSoft : undefined}
                border={selected() ? ["left"] : undefined}
                borderColor={selected() ? theme.colors.accent : undefined}
              >
                <text fg={selected() ? theme.colors.muted : theme.colors.faint}>
                  {command.kind === "session" ? "session" : command.category ?? "command"}
                </text>
                <text fg={selected() ? theme.colors.muted : theme.colors.faint}>{" · "}</text>
                <text fg={selected() ? theme.colors.text : theme.colors.text} attributes={1}>
                  {command.title}
                </text>
                <Show when={command.hint}>
                  <text fg={selected() ? theme.colors.muted : theme.colors.muted}>{` · ${command.hint}`}</text>
                </Show>
                <box flexGrow={1} />
                <Show when={command.keybind}>
                  <text fg={selected() ? theme.colors.muted : theme.colors.faint}>{command.keybind}</text>
                </Show>
              </box>
            );
          }}
        </For>
      </Show>

      <box marginTop={1}>
        <text fg={theme.colors.faint}>↑↓ navigate · enter · esc</text>
      </box>
    </box>
  );
}