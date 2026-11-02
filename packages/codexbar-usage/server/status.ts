import type { CodexbarStatus } from "../shared/status";
import {
  commandPath,
  enabledProviderIds,
  enabledProviders,
  listPluginProviders,
  readDashboard,
  readVersion,
} from "./codexbar-cli";

/**
 * One cheap probe for the settings screen. A missing CLI is a normal answer here, not
 * an error, so the screen can tell the user what to install.
 */
export async function readStatus(): Promise<CodexbarStatus> {
  const command = commandPath();
  try {
    const [version, dashboard] = await Promise.all([readVersion(), readDashboard()]);
    const providers = enabledProviders(dashboard).map((provider) => ({
      id: provider.id,
      name: provider.name ?? provider.id,
    }));
    // Provider plugins never appear in the dashboard, so they are listed separately.
    try {
      const enabled = await enabledProviderIds();
      for (const plugin of await listPluginProviders()) {
        if (enabled !== null && !enabled.has(plugin.id)) continue;
        providers.push({ id: plugin.id, name: plugin.name });
      }
    } catch (error) {
      console.error(
        "[codexbar-usage] could not list CodexBar provider plugins:",
        error instanceof Error ? error.message : error,
      );
    }
    return { available: true, command, version, error: null, providers };
  } catch (error) {
    return {
      available: false,
      command,
      version: null,
      error: error instanceof Error ? error.message : String(error),
      providers: [],
    };
  }
}
