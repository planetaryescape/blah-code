import { useKeyboard } from "@opentui/solid";
import type { PermissionRequest, PermissionResolution } from "@blah-code/core";
import { theme } from "../theme";

interface PermissionModalProps {
  request: PermissionRequest;
  onResolve: (resolution: PermissionResolution) => void;
}

export function PermissionModal(props: PermissionModalProps) {
  useKeyboard((evt) => {
    if (evt.name === "1") {
      evt.preventDefault();
      props.onResolve({ decision: "allow" });
      return;
    }

    if (evt.name === "2") {
      evt.preventDefault();
      props.onResolve({
        decision: "allow",
        remember: {
          key: props.request.op,
          pattern: props.request.target || "*",
          decision: "allow",
        },
      });
      return;
    }

    if (evt.name === "3" || evt.name === "escape") {
      evt.preventDefault();
      props.onResolve({ decision: "deny" });
    }
  });

  return (
    <box
      position="absolute"
      zIndex={20}
      border
      borderStyle={theme.border.modalStyle}
      borderColor={theme.colors.border}
      backgroundColor={theme.colors.panel}
      width="70%"
      height={11}
      left="15%"
      top="30%"
      flexDirection="column"
      padding={1}
    >
      <text fg={theme.colors.text} attributes={1}>permission required</text>
      <text fg={theme.colors.muted}>tool: {props.request.tool}</text>
      <text fg={theme.colors.muted}>op: {props.request.op}</text>
      <text fg={theme.colors.faint}>target: {props.request.target || "*"}</text>
      <box marginTop={1} border borderColor={theme.colors.border} paddingLeft={1}>
        <text fg={theme.colors.accent} attributes={1}>1 allow once</text>
        <text fg={theme.colors.success} attributes={1}>2 always allow target</text>
        <text fg={theme.colors.danger} attributes={1}>3 deny</text>
      </box>
      <text fg={theme.colors.faint}>Esc = deny</text>
    </box>
  );
}