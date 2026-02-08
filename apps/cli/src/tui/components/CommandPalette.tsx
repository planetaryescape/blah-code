import { useKeyboard } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

export interface PaletteCommand {
  id: string;
  title: string;
  hint?: string;
  keybind?: string;
  category?: string;
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
  onSelect: (commandId: string) => void;
  onClose: () => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  let inputRef: any;

  const filtered = createMemo(() => {
    const needle = query().trim().toLowerCase();
    if (!needle) return props.commands;
    return props.commands.filter((command) => {
      const haystack = `${command.title} ${command.hint ?? ""} ${command.keybind ?? ""}`.toLowerCase();
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
      borderColor="#3b82f6"
      borderStyle="double"
      backgroundColor="#020617"
      width="72%"
      height={16}
      left="14%"
      top="14%"
      flexDirection="column"
      padding={1}
    >
      <box flexDirection="row">
        <text fg="#bfdbfe" attributes={1}>
          command palette
        </text>
        <box flexGrow={1} />
        <text fg="#64748b">{filtered().length} cmds</text>
      </box>

      <box marginTop={1} marginBottom={1}>
        <text fg="#3b82f6">{"> "}</text>
        <input
          ref={(value: unknown) => {
            inputRef = value;
          }}
          placeholder="search command..."
          onInput={(value: string) => setQuery(value)}
        />
      </box>

      <Show when={visible().length > 0} fallback={<text fg="#64748b">no matches</text>}>
        <For each={visible()}>
          {(command, idx) => {
            const actualIndex = () => startIndex() + idx();
            const selected = () => actualIndex() === selectedIndex();
            return (
              <box
                flexDirection="row"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={selected() ? "#1d4ed8" : undefined}
              >
                <Show when={command.category}>
                  <text fg={selected() ? "#dbeafe" : "#64748b"}>{`${command.category} · `}</text>
                </Show>
                <text fg={selected() ? "#eff6ff" : "#e2e8f0"}>{command.title}</text>
                <Show when={command.hint}>
                  <text fg={selected() ? "#dbeafe" : "#94a3b8"}>{` · ${command.hint}`}</text>
                </Show>
                <box flexGrow={1} />
                <Show when={command.keybind}>
                  <text fg={selected() ? "#dbeafe" : "#64748b"}>{command.keybind}</text>
                </Show>
              </box>
            );
          }}
        </For>
      </Show>

      <box marginTop={1}>
        <text fg="#64748b">↑↓ navigate · enter run · esc close · /help from input</text>
      </box>
    </box>
  );
}
