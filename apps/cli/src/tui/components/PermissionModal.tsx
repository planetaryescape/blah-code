import { useKeyboard } from "@opentui/solid";
import type { PermissionRequest, PermissionResolution } from "@blah-code/core";

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
      borderStyle="double"
      borderColor="#f59e0b"
      backgroundColor="#0b1220"
      width="70%"
      height={11}
      left="15%"
      top="30%"
      flexDirection="column"
      padding={1}
    >
      <text fg="#fbbf24" attributes={1}>permission required</text>
      <text fg="#e2e8f0">tool: {props.request.tool}</text>
      <text fg="#e2e8f0">operation: {props.request.op}</text>
      <text fg="#94a3b8">target: {props.request.target || "*"}</text>
      <box marginTop={1} border borderColor="#334155" paddingLeft={1}>
        <text fg="#fde68a">1 allow once</text>
        <text fg="#bbf7d0">2 allow always for this target</text>
        <text fg="#fecaca">3 deny</text>
      </box>
      <text fg="#64748b">Esc = deny</text>
    </box>
  );
}
