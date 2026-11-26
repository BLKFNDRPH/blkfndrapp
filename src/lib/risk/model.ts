/**
 * The model's part of a risk report: a short read of the listing text for
 * concerns a backer should know about. One chat request to the same Ollama
 * server the listing review uses (OLLAMA_BASE_URL), text only.
 *
 * What comes back is a list of findings, nothing else. The model does not see
 * or set the score; src/lib/risk/rules.ts turns each finding into a fixed,
 * small move and caps how many count.
 *
 * Self-contained (zod only) so node --test can load it.
 */

import { z } from "zod";
import type { ListingInputV1 } from "./inputs.ts";
import type { ModelFinding } from "./rules.ts";

const DEFAULT_MODEL = "gemma4:12b";
const TIMEOUT_MS = 90_000;

export const ModelReplySchema = z.object({
  findings: z
    .array(
      z.object({
        code: z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(48)
          .describe("A short kebab-case name for the finding, e.g. unclear-budget"),
        effect: z
          .enum(["raises", "lowers"])
          .describe("raises if it makes backing this project riskier, lowers if safer"),
        detail: z.string().min(1).max(240).describe("One plain sentence a backer reads"),
      }),
    )
    .max(5),
});

const replyJsonSchema: Record<string, unknown> = z.toJSONSchema(ModelReplySchema);
delete replyJsonSchema.$schema;

export function modelName(): string {
  return process.env.OLLAMA_MODEL || DEFAULT_MODEL;
}

export function riskPrompt(listing: ListingInputV1): string {
  return `You review crowdfunding listings for backers. Read the listing below and list at most 5 specific findings that change how risky it is to back. Only report what the text itself shows: vague or missing plans, a goal that does not match the work described, claims that cannot be checked, or, on the other side, concrete budgets, timelines and evidence. Do not invent facts. Do not comment on spelling or style. If there is nothing notable, return an empty list.

Title: ${listing.title}
Tagline: ${listing.tagline}
Category: ${listing.category}
Location: ${listing.location || "(not given)"}
Description:
${listing.description}

Reply with JSON that matches this JSON Schema:
${JSON.stringify(replyJsonSchema)}`;
}

/** Parse a model reply; anything off-schema throws. */
export function parseModelReply(content: string): ModelFinding[] {
  return ModelReplySchema.parse(JSON.parse(content)).findings;
}

/**
 * Ask the model. Returns null when no model is configured, so a run without
 * one writes rules-only reports rather than failing.
 */
export async function askModel(
  listing: ListingInputV1,
): Promise<{ model: string; findings: ModelFinding[] } | null> {
  const base = process.env.OLLAMA_BASE_URL;
  if (!base) return null;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.OLLAMA_API_KEY) headers.authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;
  const model = modelName();

  const res = await fetch(`${base.replace(/\/+$/, "")}/api/chat`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: replyJsonSchema,
      // Temperature 0: not repeatable across machines, but less noisy.
      options: { temperature: 0 },
      messages: [{ role: "user", content: riskPrompt(listing) }],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${body.slice(0, 500)}`);
  const parsed = z.object({ message: z.object({ content: z.string() }) }).parse(JSON.parse(body));
  return { model, findings: parseModelReply(parsed.message.content) };
}
