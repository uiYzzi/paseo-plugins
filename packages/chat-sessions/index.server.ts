import type {
  PluginHookContext,
  PluginHookRequests,
  PluginServerContext,
} from "@getpaseo/plugin/server";
import { chatSettings, chatStatusRpc } from "./shared/chat";
import {
  createSessionDirectory,
  ensureChatProject,
  pruneEmptyDirectories,
  resolveRootDirectory,
  samePath,
  type ChatProjectSettings,
} from "./server/chat";

type WorkspaceCreateRequest = PluginHookRequests["workspace.create.before"];
type WorkspaceCreateHandler = (
  request: WorkspaceCreateRequest,
  context: PluginHookContext,
) => Promise<WorkspaceCreateRequest | undefined>;

// 0.15 renamed the lifecycle API to addHook and the hooks to subject.operation.position;
// 0.14 daemons still expose before("workspace.create"). Register on whichever exists.
interface HookCompatRuntime {
  addHook?: (
    name: "workspace.create.before",
    handler: (payload: { request: WorkspaceCreateRequest }, context: PluginHookContext) => Promise<WorkspaceCreateRequest | void>,
  ) => () => void;
  before?: (
    name: "workspace.create",
    handler: (
      payload: { request: WorkspaceCreateRequest },
      context: PluginHookContext,
    ) => void | WorkspaceCreateRequest | Promise<WorkspaceCreateRequest | void>,
  ) => () => void;
}

function addWorkspaceCreateHook(server: PluginServerContext, handler: WorkspaceCreateHandler): void {
  const runtime = server as unknown as HookCompatRuntime;
  if (typeof runtime.addHook === "function") {
    runtime.addHook("workspace.create.before", ({ request }, context) => handler(request, context));
    return;
  }
  if (typeof runtime.before === "function") {
    runtime.before("workspace.create", ({ request }, context) => handler(request, context));
    return;
  }
  console.error(
    "[chat] this daemon exposes neither addHook nor before; chat directories will not be created",
  );
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(chatSettings);
  let stopped = false;

  async function readSettings(): Promise<ChatProjectSettings | null> {
    try {
      const state = await settings.read();
      if (state.status !== "ready") return null;
      return {
        rootDirectory: state.values.rootDirectory,
        projectName: state.values.projectName,
      };
    } catch {
      return null;
    }
  }

  async function readPruneFlag(): Promise<boolean> {
    try {
      const state = await settings.read();
      return state.status === "ready" ? state.values.pruneEmptyDirectories : true;
    } catch {
      return true;
    }
  }

  const ensureProject = async (register: boolean) => {
    const current = await readSettings();
    if (!current) {
      return {
        rootDirectory: "",
        projectName: "",
        projectId: null,
        registered: false,
        message: "插件设置无法读取，先在插件设置页修复配置。",
      };
    }
    return ensureChatProject(current, { register });
  };

  server.handle(chatStatusRpc, async ({ register }) => ensureProject(register));

  // Picking the chat project creates a workspace at the root directory; each request
  // is redirected into a fresh child directory so every session gets its own folder.
  addWorkspaceCreateHook(server, async (request) => {
    if (request.source.kind !== "directory") return;
    const current = await readSettings();
    if (!current) return;
    const root = resolveRootDirectory(current.rootDirectory);
    if (!samePath(request.source.path, root)) return;

    const directory = await createSessionDirectory(root);
    if (await readPruneFlag()) {
      void pruneEmptyDirectories(root).catch((error: unknown) => {
        console.error("[chat] prune failed", error);
      });
    }
    return { ...request, source: { ...request.source, path: directory } };
  });

  // Settings can load after the plugin session starts, so retry briefly before giving up.
  void (async () => {
    for (let attempt = 0; attempt < 20 && !stopped; attempt += 1) {
      const current = await readSettings();
      if (current) {
        await ensureChatProject(current, { register: true }).catch((error: unknown) => {
          console.error("[chat] project registration failed", error);
        });
        return;
      }
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), attempt < 5 ? 500 : 2_000);
      });
    }
  })();

  // A changed root directory or project name needs the same repair pass.
  const unsubscribe = settings.subscribe(async (state) => {
    if (stopped || state.status !== "ready") return;
    await ensureChatProject(
      {
        rootDirectory: state.values.rootDirectory,
        projectName: state.values.projectName,
      },
      { register: true },
    ).catch((error: unknown) => {
      console.error("[chat] project registration failed", error);
    });
  });

  return () => {
    stopped = true;
    unsubscribe();
  };
}
