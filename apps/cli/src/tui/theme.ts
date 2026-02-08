export const theme = {
  colors: {
    bg: "#05070b",
    panel: "#0b1220",
    panelAlt: "#070d18",
    border: "#1f2a3a",
    text: "#e5e7eb",
    muted: "#9ca3af",
    faint: "#64748b",

    accent: "#60a5fa",
    accentSoft: "#0b2346",

    success: "#34d399",
    warning: "#fbbf24",
    danger: "#f87171",

    userBg: "#0b1b35",
    userBorder: "#60a5fa",

    assistantBg: "#0f172a",
    assistantBorder: "#334155",

    toolBg: "#061a20",
    toolBorder: "#22d3ee",
  },
  layout: {
    sidebarWidth: 32,
    inspectorWidth: 44,
    gap: 1,
  },
  border: {
    panelStyle: "rounded" as const,
    modalStyle: "rounded" as const,
  },
} as const;