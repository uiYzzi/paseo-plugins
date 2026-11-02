import { commandPath, enabledProviders, readDashboard, readVersion } from "./codexbar-cli";
import type { CodexbarStatus } from "../shared/status";

/**
 * One cheap probe for the settings screen. A missing CLI is a normal answer here, not
 * an error, so the screen can tell the user what to install.
 */
export async function readStatus(): Promise<CodexbarStatus> {
  const command = commandPath();
  try {
    const [version, dashboard] = await Promise.all([readVersion(), readDashboard()]);
    return {
      available: true,
      command,
      version,
      error: null,
      providers: enabledProviders(dashboard).map((provider) => ({
        id: provider.id,
        name: provider.name ?? provider.id,
      })),
    };
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
