import type { PluginClientContext } from "@getpaseo/plugin/client";

/**
 * Palette reference: Claude's warm off-white surfaces, charcoal text and
 * coral-orange accent. Paseo expands these base tokens into its complete theme.
 */
export default function contribute(client: PluginClientContext) {
  client.addTheme({
    id: "claude",
    name: "Claude",
    appearance: "light",
    colors: {
      background: "#F7F6F2",
      foreground: "#2C2C2A",
      raised: "#FFFFFF",
      control: "#EFEEE9",
      border: "#DDDCD6",
      accent: "#D97757",
      mutedForeground: "#706F6A",
      // Paseo maps `ring` to both the sidebar selection background and the
      // extra-muted text color in light themes, so it lands between the two
      // official values (#d4d4d8 selection, #a1a1aa extra muted text).
      ring: "#BDB6A4"
    }
  });

  return () => {};
}
