import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ChatSettingsScreen } from "./client/settings-screen";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: "chat",
    title: "聊天会话",
    icon: "MessageSquarePlus",
    Component: ChatSettingsScreen,
  });
  return () => {};
}
