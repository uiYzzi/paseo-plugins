import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Default place where chat session directories are created. */
export const DEFAULT_ROOT_DIRECTORY = "~/.PaseoChats";
export const DEFAULT_PROJECT_NAME = "聊天";

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
  input: z.object({ register: z.boolean().default(false) }),
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
