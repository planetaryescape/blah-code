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
      borderColor="#fbbf24"
      backgroundColor="#18181b"
      width="70%"
      height={8}
      left="15%"
      top="35%"
      flexDirection="column"
      padding={1}
    >
      <text fg="#fbbf24">permission required</text>
      <text>op: {props.request.op}</text>
      <text>tool: {props.request.tool}</text>
      <text>target: {props.request.target}</text>
      <text fg="#a1a1aa">1 allow once   2 allow always   3 deny</text>
    </box>
  );
}
