import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Paseo reads the provider list while the plugin starts, where settings are not loaded
 * yet, so this path is the last resort rather than an override: it is consulted after
 * `codexbar` on PATH and the CLI inside the app bundle.
 */
export const codexbarSettings = defineSettings({
  id: "codexbar",
  scope: "host",
  version: 1,
  schema: z.object({
    cliPath: z.string().trim().default(""),
  }),
});
