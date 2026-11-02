import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rmdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

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
  message: string | null;
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
        lastError = `未找到 paseo 命令`;
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
    if (!Array.isArray(parsed)) return { projects: null, error: "paseo project ls 输出无法解析" };
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
export function ensureChatProject(
  settings: ChatProjectSettings,
  options: { register: boolean },
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
  options: { register: boolean },
): Promise<ChatProjectStatus> {
  const root = resolveRootDirectory(settings.rootDirectory);
  const projectName = settings.projectName.trim() || "聊天";
  const base: ChatProjectStatus = {
    rootDirectory: root,
    projectName,
    projectId: null,
    registered: false,
    message: null,
  };

  try {
    await mkdir(root, { recursive: true });
  } catch (error) {
    return {
      ...base,
      message: `无法创建目录 ${root}：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const first = await listProjects();
  if (!first.projects) {
    return { ...base, message: first.error };
  }

  let project = first.projects.find((entry) => samePath(entry.path, root)) ?? null;

  if (!project && options.register) {
    const created = await runPaseoCli(["project", "create", root]);
    if (!created.ok) {
      return {
        ...base,
        message: `注册项目失败：${created.error ?? "未知错误"}。可在终端运行：paseo project create ${root}`,
      };
    }
    const second = await listProjects();
    if (!second.projects) return { ...base, message: second.error };
    project = second.projects.find((entry) => samePath(entry.path, root)) ?? null;
  }

  if (!project) {
    return {
      ...base,
      message: `目录 ${root} 还没有注册为项目。在设置里点“注册项目”，或在终端运行：paseo project create ${root}`,
    };
  }

  let message: string | null = null;
  if (project.name !== projectName) {
    const renamed = await runPaseoCli(["project", "rename", project.projectId, projectName]);
    if (!renamed.ok) message = `项目已注册，但改名失败：${renamed.error ?? "未知错误"}`;
  }

  return { ...base, projectId: project.projectId, registered: true, message };
}
