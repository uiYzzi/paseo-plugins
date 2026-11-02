import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * The settings screen cannot run the CLI itself, so the daemon reports what it found:
 * where the CLI is, which version it is, and which providers it exposes.
 */
export const codexbarStatus = defineRpc({
  name: "codexbar.status",
  input: z.object({}),
  output: z.object({
    available: z.boolean(),
    command: z.string(),
    version: z.string().nullable(),
    error: z.string().nullable(),
    providers: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
      }),
    ),
  }),
});

export type CodexbarStatus = z.infer<typeof codexbarStatus.output>;
