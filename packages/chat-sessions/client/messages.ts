import { defineTranslations } from "@getpaseo/plugin/client";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

export const messages = defineTranslations({ resources: { en, "zh-CN": zhCN } });

/** Status codes the daemon returns; the screen picks the wording for them. */
export const PROBLEM_KEYS = {
  rootCreateFailed: "problem.rootCreateFailed",
  cliUnavailable: "problem.cliUnavailable",
  projectRegisterFailed: "problem.projectRegisterFailed",
  projectRenameFailed: "problem.projectRenameFailed",
  notRegistered: "problem.notRegistered",
  settingsUnreadable: "problem.settingsUnreadable",
} as const;
