import { execFileSync } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execCommand } from "@getpaseo/plugin/server";
import { z } from "zod";

/** Where CodexBar ships its CLI inside the macOS app bundle. */
export const APP_BUNDLE_CLI = "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI";

/** Paseo gives each usage fetch a 20 second deadline; stay under it. */
const COMMAND_TIMEOUT_MS = 15_000;

/** Startup runs once per plugin load and blocks only the plugin subprocess. */
const INIT_TIMEOUT_MS = 12_000;

/** Discovery and the following fetch usually run back to back. */
const DASHBOARD_CACHE_MS = 20_000;

const windowSchema = z.object({
  usedPercent: z.number().nullable().optional(),
  remainingPercent: z.number().nullable().optional(),
  windowMinutes: z.number().nullable().optional(),
  resetsAt: z.string().nullable().optional(),
  resetAt: z.string().nullable().optional(),
  resetDescription: z.string().nullable().optional(),
});

const identitySchema = z
  .object({
    providerID: z.string().optional(),
    accountEmail: z.string().nullable().optional(),
    plan: z.string().nullable().optional(),
  })
  .partial();

const dashboardSchema = z.object({
  schemaVersion: z.number().optional(),
  staleAfterSeconds: z.number().optional(),
  host: z.object({ codexBarVersion: z.string().optional() }).partial().optional(),
  providers: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable().optional(),
      enabled: z.boolean().optional(),
      error: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      source: z.string().nullable().optional(),
      updatedAt: z.string().nullable().optional(),
      identity: identitySchema.nullable().optional(),
      windows: z.array(
        z.object({
          kind: z.string().nullable().optional(),
          label: z.string(),
          usedPercent: z.number().nullable().optional(),
          remainingPercent: z.number().nullable().optional(),
          resetAt: z.string().nullable().optional(),
        }),
      ),
    }),
  ),
});

const usageRowSchema = z.object({
  provider: z.string(),
  source: z.string().nullable().optional(),
  rateWindowLabels: z.record(z.string(), z.string()).optional(),
  pace: z.record(z.string(), z.object({ summary: z.string().optional() })).optional(),
  usage: z
    .object({
      primary: windowSchema.nullable().optional(),
      secondary: windowSchema.nullable().optional(),
      tertiary: windowSchema.nullable().optional(),
      extraRateWindows: z
        .array(z.object({ id: z.string(), title: z.string(), window: windowSchema }))
        .optional(),
      identity: identitySchema.optional(),
    })
    .optional(),
});

export type Dashboard = z.infer<typeof dashboardSchema>;
export type DashboardProvider = Dashboard["providers"][number];
export type UsageRow = z.infer<typeof usageRowSchema>;

let configuredCliPath = "";
let dashboardCache: { at: number; value: Dashboard } | null = null;
let lastUsedCommand: string | null = null;

/** A path typed in the settings screen. Empty means "not configured". */
export function setConfiguredCliPath(value: string): void {
  const trimmed = value.trim();
  configuredCliPath = trimmed.length > 0 ? expandHome(trimmed) : "";
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

function onPath(name: string): string | null {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Keep looking: an unreadable PATH entry is not an error.
    }
  }
  return null;
}

/**
 * A deliberate environment override wins, then `codexbar` on the daemon's PATH, then the
 * CLI inside the app bundle, then whatever the user saved in the plugin's settings.
 */
export function commandCandidates(): string[] {
  const candidates: string[] = [];
  const override = process.env.CODEXBAR_BIN?.trim();
  if (override) candidates.push(expandHome(override));
  const fromPath = onPath("codexbar");
  if (fromPath) candidates.push(fromPath);
  if (existsSync(APP_BUNDLE_CLI)) candidates.push(APP_BUNDLE_CLI);
  if (configuredCliPath && !candidates.includes(configuredCliPath)) {
    candidates.push(configuredCliPath);
  }
  return candidates;
}

/** What the settings screen and error messages report as the CLI in use. */
export function commandPath(): string {
  return lastUsedCommand ?? commandCandidates()[0] ?? "";
}

function missingCommandError(tried: string[]): Error {
  const hint =
    tried.length === 0
      ? "CodexBar was not found on PATH or in /Applications."
      : `Tried ${tried.join(", ")}.`;
  return new Error(
    `${hint} Install CodexBar, put \`codexbar\` on PATH, or set the CLI path in this plugin's settings.`,
  );
}

function isMissingBinary(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ENOENT" || code === 127) return true;
  return /ENOENT|not found|No such file/i.test(messageOf(error));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function commandArgs(args: string[]): string[] {
  return args;
}

async function run(args: string[]): Promise<string> {
  const candidates = commandCandidates();
  if (candidates.length === 0) throw missingCommandError(candidates);
  for (const command of candidates) {
    try {
      const { stdout } = await execCommand(command, commandArgs(args), {
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      });
      lastUsedCommand = command;
      return stdout;
    } catch (error) {
      if (isMissingBinary(error)) continue;
      throw new Error(`\`${command} ${args.join(" ")}\` failed: ${messageOf(error)}`);
    }
  }
  throw missingCommandError(candidates);
}

/** Enabled providers with their windows; the CLI writes diagnostics to stderr only. */
export async function readDashboard(): Promise<Dashboard> {
  const now = Date.now();
  if (dashboardCache && now - dashboardCache.at < DASHBOARD_CACHE_MS) {
    return dashboardCache.value;
  }
  const stdout = await run(["dashboard", "--timeout", "12"]);
  const value = dashboardSchema.parse(JSON.parse(stdout));
  dashboardCache = { at: now, value };
  return value;
}

/**
 * Plugin contributions are registered once, synchronously, while the plugin starts, so
 * provider names have to be read before `contribute` returns. This blocks only the plugin
 * subprocess.
 */
export function readDashboardSync(): Dashboard {
  const candidates = commandCandidates();
  if (candidates.length === 0) throw missingCommandError(candidates);
  let stdout: string | null = null;
  for (const command of candidates) {
    try {
      stdout = execFileSync(command, ["dashboard", "--timeout", "8"], {
        encoding: "utf8",
        timeout: INIT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      lastUsedCommand = command;
      break;
    } catch (error) {
      if (isMissingBinary(error)) continue;
      throw new Error(`\`${command} dashboard\` failed: ${messageOf(error)}`);
    }
  }
  if (stdout === null) throw missingCommandError(candidates);
  const value = dashboardSchema.parse(JSON.parse(stdout));
  dashboardCache = { at: Date.now(), value };
  return value;
}

/** `codexbar --version` prints the app version and exits without touching providers. */
export async function readVersion(): Promise<string> {
  const stdout = await run(["--version"]);
  return stdout.trim().split("\n")[0]?.trim() ?? "";
}

/** One provider's report as the menu bar app renders it, including pace and balances. */
export async function readUsage(providerId: string): Promise<UsageRow | null> {
  const stdout = await run([
    "usage",
    "--provider",
    providerId,
    "--format",
    "json",
    "--no-color",
  ]);
  const rows = z.array(usageRowSchema).parse(JSON.parse(stdout));
  return rows.find((row) => row.provider === providerId) ?? rows[0] ?? null;
}

export function enabledProviders(dashboard: Dashboard): DashboardProvider[] {
  return dashboard.providers.filter((provider) => provider.enabled !== false);
}
