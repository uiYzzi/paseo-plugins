import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rmdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ChatProblem } from "../shared/chat";
import { DEFAULT_PROJECT_NAME, resolveNewProjectName } from "../shared/chat";

const execFileAsync = promisify(execFile);

/** Empty chat directories older than this are pruned. */
export const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// The daemon may run from a GUI session whose PATH lacks the Homebrew prefix, so the
// bundled CLI is tried by absolute path as well.
const CLI_CANDIDATES = [
  process.env.PASEO_CLI,
  "paseo",
  "/opt/homebrew/bin/paseo",
  "/usr/local/bin/paseo",
  path.join(os.homedir(), ".local", "bin", "paseo"),
  "/Applications/Paseo.app/Contents/Resources/bin/paseo",
].filter((candidate): candidate is string => Boolean(candidate));

export interface ChatProjectSettings {
  rootDirectory: string;
  projectName: string;
}

export interface ChatProjectStatus {
  rootDirectory: string;
  projectName: string;
  projectId: string | null;
  registered: boolean;
  /** Localized by the app; the daemon has no locale. */
  problem: ChatProblem | null;
  detail: string | null;
}

interface CliProject {
  projectId: string;
  name: string;
  kind: string;
  path: string;
}

export function expandHome(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

export function resolveRootDirectory(value: string): string {
  const expanded = expandHome(value);
  return path.resolve(expanded.length > 0 ? expanded : DEFAULT_FALLBACK_ROOT);
}

const DEFAULT_FALLBACK_ROOT = os.homedir();

export function samePath(left: string, right: string): boolean {
  return path.resolve(expandHome(left)) === path.resolve(expandHome(right));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** A sortable, unique directory name for one chat session. */
export function sessionDirectoryName(now: Date = new Date()): string {
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("");
  const clock = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join("");
  return `chat-${stamp}-${clock}-${randomBytes(2).toString("hex")}`;
}

export async function createSessionDirectory(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const target = path.join(root, sessionDirectoryName());
  await mkdir(target, { recursive: false });
  return target;
}

/** Removes empty session directories that nobody touched for a week. */
export async function pruneEmptyDirectories(
  root: string,
  now: number = Date.now(),
): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = path.join(root, entry.name);
    try {
      const info = await stat(target);
      if (now - info.mtimeMs < PRUNE_AFTER_MS) continue;
      if ((await readdir(target)).length > 0) continue;
      await rmdir(target);
      removed.push(target);
    } catch {
      // Busy, already gone, or not removable: leave it for the next pass.
    }
  }
  return removed;
}

interface CliResult {
  ok: boolean;
  stdout: string;
  error: string | null;
}

async function runPaseoCli(args: readonly string[]): Promise<CliResult> {
  let lastError: string | null = null;
  for (const candidate of CLI_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(candidate, [...args], { timeout: 30_000 });
      return { ok: true, stdout, error: null };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        lastError = `paseo not found`;
        continue;
      }
      const stderr = (error as { stderr?: string }).stderr?.trim();
      lastError = stderr || (error instanceof Error ? error.message : String(error));
      return { ok: false, stdout: "", error: lastError };
    }
  }
  return { ok: false, stdout: "", error: lastError };
}

async function listProjects(): Promise<{ projects: CliProject[] | null; error: string | null }> {
  const result = await runPaseoCli(["project", "ls", "--json"]);
  if (!result.ok) return { projects: null, error: result.error };
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) return { projects: null, error: "paseo project ls printed no array" };
    const projects = parsed.flatMap((entry): CliProject[] => {
      if (typeof entry !== "object" || entry === null) return [];
      const record = entry as Record<string, unknown>;
      const { projectId, name, kind, path: rootPath } = record;
      if (typeof projectId !== "string" || typeof rootPath !== "string") return [];
      return [
        {
          projectId,
          name: typeof name === "string" ? name : "",
          kind: typeof kind === "string" ? kind : "non_git",
          path: rootPath,
        },
      ];
    });
    return { projects, error: null };
  } catch (error) {
    return { projects: null, error: error instanceof Error ? error.message : String(error) };
  }
}

let inFlight: Promise<ChatProjectStatus> | null = null;

/**
 * Makes sure the chat root exists and is registered as a Paseo project, and that it
 * carries the configured name. Registration goes through the `paseo` CLI because the
 * plugin SDK can list projects but not add or rename them.
 */
export interface ChatEnsureOptions {
  register: boolean;
  /** Force the project name to this app language's default. */
  rename?: boolean;
  /** App language; only used when the plugin picks the name itself. */
  locale?: string | null;
}

export function ensureChatProject(
  settings: ChatProjectSettings,
  options: ChatEnsureOptions,
): Promise<ChatProjectStatus> {
  if (inFlight) return inFlight;
  const run = registerChatProject(settings, options).finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

async function registerChatProject(
  settings: ChatProjectSettings,
  options: ChatEnsureOptions,
): Promise<ChatProjectStatus> {
  const root = resolveRootDirectory(settings.rootDirectory);
  const configuredName = settings.projectName.trim() || DEFAULT_PROJECT_NAME;
  const projectName = resolveNewProjectName(configuredName, options.locale);
  const namesItself = configuredName === DEFAULT_PROJECT_NAME;
  const base: ChatProjectStatus = {
    rootDirectory: root,
    projectName,
    projectId: null,
    registered: false,
    problem: null,
    detail: null,
  };

  try {
    await mkdir(root, { recursive: true });
  } catch (error) {
    return {
      ...base,
      problem: "rootCreateFailed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const first = await listProjects();
  if (!first.projects) {
    return { ...base, problem: "cliUnavailable", detail: first.error };
  }

  let project = first.projects.find((entry) => samePath(entry.path, root)) ?? null;
  let created = false;

  if (!project && options.register) {
    const made = await runPaseoCli(["project", "create", root]);
    if (!made.ok) {
      return { ...base, problem: "projectRegisterFailed", detail: made.error };
    }
    created = true;
    const second = await listProjects();
    if (!second.projects) return { ...base, problem: "cliUnavailable", detail: second.error };
    project = second.projects.find((entry) => samePath(entry.path, root)) ?? null;
  }

  if (!project) {
    return { ...base, problem: "notRegistered", detail: null };
  }

  let problem: ChatProblem | null = null;
  let detail: string | null = null;
  // Rename when the plugin just named the project, when the user asked for the app-language
  // name, or when a stored custom name drifted. A daemon-side pass never renames a default
  // name, so a name chosen by one app language never flips under another.
  let targetName: string | null = null;
  if (created) targetName = projectName;
  else if (options.rename) targetName = namesItself ? projectName : configuredName;
  else if (!namesItself) targetName = configuredName;

  let actualName = project.name;
  if (targetName && project.name !== targetName) {
    const renamed = await runPaseoCli(["project", "rename", project.projectId, targetName]);
    if (renamed.ok) actualName = targetName;
    else {
      problem = "projectRenameFailed";
      detail = renamed.error;
    }
  }

  return {
    ...base,
    projectName: actualName || projectName,
    projectId: project.projectId,
    registered: true,
    problem,
    detail,
  };
}
