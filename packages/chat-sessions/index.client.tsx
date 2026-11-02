import type { PluginClientContext } from "@getpaseo/plugin/client";
import { messages } from "./client/messages";
import { ChatSettingsScreen } from "./client/settings-screen";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: "chat",
    title: messages.message("title"),
    icon: "MessageSquarePlus",
    Component: ChatSettingsScreen,
  });
  return () => {};
}
