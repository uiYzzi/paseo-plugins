import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Default place where chat session directories are created. */
export const DEFAULT_ROOT_DIRECTORY = "~/.PaseoChats";
export const DEFAULT_PROJECT_NAME = "聊天";
export const FALLBACK_PROJECT_NAME = "Chat";

/** The name the plugin picks for a project it names itself, following the app language. */
export function localizedProjectName(locale: string | null | undefined): string {
  return (locale ?? "").trim().toLowerCase().startsWith("zh")
    ? DEFAULT_PROJECT_NAME
    : FALLBACK_PROJECT_NAME;
}

/**
 * A first registration follows the app language only while the stored name is still the
 * default; a name the user typed always wins. Without a locale the default is kept, so a
 * daemon-side registration never guesses.
 */
export function resolveNewProjectName(
  configured: string,
  locale: string | null | undefined,
): string {
  if (configured !== DEFAULT_PROJECT_NAME) return configured;
  return locale ? localizedProjectName(locale) : DEFAULT_PROJECT_NAME;
}

export const chatSettings = defineSettings({
  id: "chat",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Base directory. Each new chat workspace gets a fresh subdirectory here. */
    rootDirectory: z.string().trim().min(1).default(DEFAULT_ROOT_DIRECTORY),
    /** Project name shown in the project picker. */
    projectName: z.string().trim().min(1).default(DEFAULT_PROJECT_NAME),
    /** Delete empty chat directories older than a week. */
    pruneEmptyDirectories: z.boolean().default(true),
  }),
});

/**
 * The daemon has no locale, so it reports a code the app localizes, plus the raw
 * detail (path or command error) that goes into the message.
 */
export const chatProblem = z.enum([
  "rootCreateFailed",
  "cliUnavailable",
  "projectRegisterFailed",
  "projectRenameFailed",
  "notRegistered",
  "settingsUnreadable",
]);

export type ChatProblem = z.infer<typeof chatProblem>;

export const chatStatusRpc = defineRpc({
  name: "chat.status",
  input: z.object({
    /** Register the root as a project when it is missing. */
    register: z.boolean().default(false),
    /** Rename the project to the name this app language uses. */
    rename: z.boolean().default(false),
    /** App language, used only when the plugin is the one choosing the name. */
    locale: z.string().nullable().default(null),
  }),
  output: z.object({
    rootDirectory: z.string(),
    projectName: z.string(),
    projectId: z.string().nullable(),
    registered: z.boolean(),
    problem: chatProblem.nullable(),
    detail: z.string().nullable(),
  }),
});

export type ChatStatus = z.infer<typeof chatStatusRpc.output>;
