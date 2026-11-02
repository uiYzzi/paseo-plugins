import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  hashAccountKey,
  toneFromUsedPct,
  type UsageAccount,
  type UsageDetail,
  type UsageReport,
  type UsageScope,
  type UsageWindow,
} from "@getpaseo/plugin/server/usage";
import { z } from "zod";
import {
  enabledProviders,
  readDashboard,
  readDashboardSync,
  readUsage,
  type DashboardProvider,
  type UsageRow,
} from "./codexbar-cli";

const inputSchema = z.object({ provider: z.string().min(1) }).strict();

/** CodexBar window kinds map to the short labels the usage bars use when space is tight. */
const KIND_SHORT_LABELS: Record<string, string> = {
  session: "5h",
  five_hour: "5h",
  daily: "d",
  weekly: "wk",
  monthly: "mo",
};

/**
 * A codexbar `kind` describes the slot, not the window: Kimi's five hour window
 * arrives as `weekly`, and a balance has no duration at all. Reported minutes win.
 */
function shortLabelFor(input: {
  kind?: string | null;
  label?: string;
  windowMinutes?: number | null;
}): string | undefined {
  const label = input.label ?? "";
  if (/balance|credit/i.test(label)) return undefined;
  const minutes = input.windowMinutes;
  if (typeof minutes === "number" && minutes > 0) {
    if (minutes % 43200 === 0) return `${minutes / 43200}mo`;
    if (minutes % 10080 === 0) return `${minutes / 10080}wk`;
    if (minutes % 1440 === 0) return `${minutes / 1440}d`;
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    return `${minutes}m`;
  }
  const fromLabel = /(\d+)[-\s]?hours?\b/i.exec(label);
  if (fromLabel) return `${fromLabel[1]}h`;
  if (input.kind) return KIND_SHORT_LABELS[input.kind];
  return undefined;
}

/** Window minutes per label, so a dashboard window can borrow the duration the usage rows report. */
function minutesByLabel(row: UsageRow | null): Map<string, number> {
  const minutes = new Map<string, number>();
  if (!row) return minutes;
  const labels = row.rateWindowLabels ?? {};
  for (const slot of ["primary", "secondary", "tertiary"] as const) {
    const value = row.usage?.[slot]?.windowMinutes;
    const label = labels[slot];
    if (label && typeof value === "number") minutes.set(label, value);
  }
  for (const extra of row.usage?.extraRateWindows ?? []) {
    const value = extra.window.windowMinutes;
    if (typeof value === "number") minutes.set(extra.title, value);
  }
  return minutes;
}

function makeWindow(input: {
  id: string;
  label: string;
  shortLabel?: string;
  usedPercent?: number | null;
  remainingPercent?: number | null;
  resetsAt?: string | null;
}): UsageWindow {
  const usedPct =
    typeof input.usedPercent === "number"
      ? input.usedPercent
      : typeof input.remainingPercent === "number"
        ? Math.max(0, 100 - input.remainingPercent)
        : null;
  const remainingPct =
    typeof input.remainingPercent === "number"
      ? input.remainingPercent
      : typeof input.usedPercent === "number"
        ? Math.max(0, 100 - input.usedPercent)
        : null;
  const window: UsageWindow = {
    id: input.id,
    label: input.label,
    summary: true,
    usedPct,
    remainingPct,
    resetsAt: input.resetsAt ?? null,
    tone: toneFromUsedPct(usedPct),
  };
  if (input.shortLabel) window.shortLabel = input.shortLabel;
  return window;
}

function windowsFromDashboard(
  provider: DashboardProvider,
  minutes: Map<string, number>,
): UsageWindow[] {
  return provider.windows.map((window, index) =>
    makeWindow({
      id: window.kind ?? `window-${index + 1}`,
      label: window.label,
      shortLabel: shortLabelFor({
        kind: window.kind,
        label: window.label,
        windowMinutes: minutes.get(window.label),
      }),
      usedPercent: window.usedPercent,
      remainingPercent: window.remainingPercent,
      resetsAt: window.resetAt,
    }),
  );
}

function windowsFromUsage(row: UsageRow): UsageWindow[] {
  const labels = row.rateWindowLabels ?? {};
  const windows: UsageWindow[] = [];
  for (const slot of ["primary", "secondary", "tertiary"] as const) {
    const window = row.usage?.[slot];
    if (!window) continue;
    windows.push(
      makeWindow({
        id: slot,
        label: labels[slot] ?? slot,
        shortLabel: shortLabelFor({ label: labels[slot], windowMinutes: window.windowMinutes }),
        usedPercent: window.usedPercent,
        remainingPercent: window.remainingPercent,
        resetsAt: window.resetsAt,
      }),
    );
  }
  for (const extra of row.usage?.extraRateWindows ?? []) {
    windows.push(
      makeWindow({
        id: extra.id,
        label: extra.title,
        shortLabel: shortLabelFor({ label: extra.title, windowMinutes: extra.window.windowMinutes }),
        usedPercent: extra.window.usedPercent,
        remainingPercent: extra.window.remainingPercent,
        resetsAt: extra.window.resetsAt,
      }),
    );
  }
  return windows;
}

/**
 * The menu bar app keeps balance text and pace outside the usage windows; the bars
 * have no slot for them, so they become detail rows.
 */
function detailsFrom(row: UsageRow | null, provider: DashboardProvider): UsageDetail[] {
  const details: UsageDetail[] = [];
  const balance = balanceText(row);
  if (balance) details.push({ id: "balance", label: "Balance", value: balance });
  const pace = paceText(row);
  if (pace) details.push({ id: "pace", label: "Pace", value: pace });
  const source = provider.source ?? row?.source;
  if (source) details.push({ id: "source", label: "Source", value: source });
  return details;
}

function balanceText(row: UsageRow | null): string | null {
  for (const slot of ["primary", "secondary", "tertiary"] as const) {
    const description = row?.usage?.[slot]?.resetDescription?.trim();
    if (description) return description;
  }
  return null;
}

function paceText(row: UsageRow | null): string | null {
  for (const entry of Object.values(row?.pace ?? {})) {
    const summary = entry?.summary?.trim();
    if (summary) return summary;
  }
  return null;
}

async function buildReport(providerId: string): Promise<UsageReport> {
  const [dashboardResult, usageResult] = await Promise.allSettled([
    readDashboard(),
    readUsage(providerId),
  ]);
  const provider =
    dashboardResult.status === "fulfilled"
      ? dashboardResult.value.providers.find((entry) => entry.id === providerId)
      : undefined;
  const row = usageResult.status === "fulfilled" ? usageResult.value : null;

  if (!provider && !row) {
    const reason =
      dashboardResult.status === "rejected"
        ? String(dashboardResult.reason?.message ?? dashboardResult.reason)
        : `CodexBar returned no data for "${providerId}".`;
    return { status: "error", error: reason };
  }
  if (provider?.error) {
    return { status: "error", error: provider.error };
  }

  const windows = provider
    ? windowsFromDashboard(provider, minutesByLabel(row))
    : windowsFromUsage(row as UsageRow);
  if (windows.length === 0) {
    return { status: "error", error: "CodexBar reported no usage windows for this provider." };
  }

  const report: UsageReport = {
    status: "available",
    windows,
    details: detailsFrom(row, provider ?? { id: providerId, windows: [] }),
  };
  const plan = provider?.identity?.plan ?? row?.usage?.identity?.plan;
  if (plan) report.planLabel = plan;
  return report;
}

/** The source label already carries CodexBar's provider name, so only a plan adds anything. */
function accountFor(provider: DashboardProvider): UsageAccount {
  const account: UsageAccount = {
    key: hashAccountKey(`codexbar:${provider.id}`),
    input: { provider: provider.id },
  };
  const plan = provider.identity?.plan;
  if (plan) account.label = plan;
  return account;
}

/**
 * Harnesses that launch another vendor's login. Their own subscription quota is a
 * different account from the one a prefixed session runs on.
 */
const MULTI_VENDOR_HARNESSES = new Set(["pi", "omp"]);

/**
 * Paseo providers read `harness/model` or `harness/vendor/model`, so the vendor
 * segment names the CodexBar provider when it matches one, and the harness is the
 * fallback.
 */
export function sessionCandidates(provider: string): string[] {
  const segments = provider.split("/").filter(Boolean);
  const candidates: string[] = [];
  const vendor = segments[1];
  if (segments.length >= 3 && vendor) candidates.push(vendor);
  const harness = segments[0];
  if (!harness) return candidates;
  if (MULTI_VENDOR_HARNESSES.has(harness) && segments.length >= 2) return candidates;
  candidates.push(harness);
  return candidates;
}

/** Source ids are plugin-local, so they carry a prefix the CodexBar ids never use. */
export function sourceIdFor(providerId: string): string {
  return `codexbar-${providerId.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`;
}

function registerProviderSource(server: PluginServerContext, provider: DashboardProvider): void {
  server.registerUsageSource({
    id: sourceIdFor(provider.id),
    label: provider.name ?? provider.id,
    icon: "icon.svg",
    input: inputSchema,
    discover: async (scope: UsageScope) =>
      scope.kind === "global" || sessionCandidates(scope.provider).includes(provider.id)
        ? [accountFor(provider)]
        : [],
    fetch: async (value) => {
      const parsed = inputSchema.safeParse(value);
      if (!parsed.success) return { status: "error", error: "Invalid CodexBar account input." };
      try {
        return await buildReport(parsed.data.provider);
      } catch (error) {
        return { status: "error", error: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}

/** Keeps failures visible when the CLI is missing, instead of showing nothing at all. */
function registerUnavailableSource(server: PluginServerContext, reason: string): void {
  server.registerUsageSource({
    id: "codexbar",
    label: "CodexBar",
    icon: "icon.svg",
    input: inputSchema,
    discover: async () => [
      { key: hashAccountKey("codexbar:unavailable"), input: { provider: "unavailable" } },
    ],
    fetch: async () => ({ status: "error", error: reason }),
  });
}

/**
 * CodexBar already knows each provider's display name, and a usage source carries a
 * single label, so every enabled provider becomes its own source. Paseo reads the
 * registrations once while the plugin starts, which is why the provider list is read
 * synchronously; enabling another provider in CodexBar takes a plugin reload.
 */
export function contributeCodexbarUsage(server: PluginServerContext): () => void {
  let providers: DashboardProvider[] = [];
  try {
    providers = enabledProviders(readDashboardSync());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[codexbar-usage]", reason);
    registerUnavailableSource(server, reason);
    return () => {};
  }
  if (providers.length === 0) {
    registerUnavailableSource(
      server,
      "No CodexBar provider is enabled. Turn one on in CodexBar, then reload this plugin.",
    );
    return () => {};
  }
  const seen = new Set<string>();
  for (const provider of providers) {
    if (seen.has(provider.id)) continue;
    seen.add(provider.id);
    registerProviderSource(server, provider);
  }
  return () => {};
}
