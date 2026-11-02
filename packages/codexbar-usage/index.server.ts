import type { PluginServerContext } from "@getpaseo/plugin/server";
import { codexbarStatus } from "./shared/status";
import { codexbarSettings } from "./shared/settings";
import { setConfiguredCliPath } from "./server/codexbar-cli";
import { readStatus } from "./server/status";
import { contributeCodexbarUsage } from "./server/usage-source";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(codexbarSettings);
  const apply = (state: Awaited<ReturnType<typeof settings.read>>) => {
    setConfiguredCliPath(state.status === "ready" ? state.values.cliPath : "");
  };
  // Settings are not loaded yet while the plugin starts; the subscription keeps a later
  // save usable without a reload for fetches, even though the provider list needs one.
  void settings.read().then(apply, () => setConfiguredCliPath(""));
  const unsubscribe = settings.subscribe(apply);
  server.handle(codexbarStatus, readStatus);
  const cleanupUsage = contributeCodexbarUsage(server);
  return () => {
    unsubscribe();
    cleanupUsage();
  };
}
