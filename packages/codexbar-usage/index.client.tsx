import type { PluginClientContext } from "@getpaseo/plugin/client";
import { messages } from "./client/messages";
import { CodexbarSettingsScreen } from "./client/settings-screen";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: "codexbar",
    title: messages.message("title"),
    icon: "Gauge",
    Component: CodexbarSettingsScreen,
  });
  return () => {};
}
