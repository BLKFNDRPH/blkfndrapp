/**
 * Not a "use server" module: that would make improveListingQuality a server
 * action anyone can call, a model call with no sign-in check. The one entry
 * point is runImproveListingQuality in src/app/actions.ts, which requires a
 * signed-in caller first.
 *
 * @fileOverview The AI listing review: one chat request to an Ollama server
 * (OLLAMA_BASE_URL, self-hosted or Ollama Cloud) running a vision model. Ollama
 * holds the model's answer to the output schema below, and the reply is checked
 * against that schema before anything returns it, so a malformed reply throws
 * instead of reaching the dialog.
 *
 * It exports the `improveListingQuality` function, the `ImproveListingQualityInput` type, and the `ImproveListingQualityOutput` type.
 */

import { z } from 'zod';

/** Used when OLLAMA_MODEL is unset. It has to read pictures. */
const DEFAULT_MODEL = 'gemma4:12b';

/**
 * A picture as FileReader.readAsDataURL writes it, in a format Ollama's vision
 * models read. Ollama refuses AVIF ("Failed to load image"), so a picture in
 * any other format is refused here, before a request is made.
 */
const IMAGE_DATA_URI = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

// Well past every listing limit (src/lib/listing-limits.ts), so a draft that is
// over one still gets reviewed. It bounds what one press can send to the model.
const TEXT_MAX = 10_000;

// Cloudflare, in front of blkfndr.com, drops a request that takes over 100
// seconds. Giving up first means the builder gets the form's failure toast
// rather than an error from Cloudflare.
const TIMEOUT_MS = 90_000;

const ImproveListingQualityInputSchema = z.object({
  title: z.string().max(TEXT_MAX).describe('The title of the project listing.'),
  description: z.string().max(TEXT_MAX).describe('The detailed description of the project.'),
  category: z.string().max(200).describe('The category the project belongs to (e.g., Technology, Art, Charity).'),
  fundingGoal: z.number().describe('The total funding amount being sought for the project.'),
  imageUrl: z
    .string()
    .regex(IMAGE_DATA_URI, 'Expected a PNG, JPEG, WebP or GIF picture as a Base64 data URI')
    .describe("An image representing the project, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
});
export type ImproveListingQualityInput = z.infer<typeof ImproveListingQualityInputSchema>;

const ImproveListingQualityOutputSchema = z.object({
  suggestions: z
    .array(z.string().describe('Specific suggestions for improving the listing.'))
    .max(10)
    .describe('A list of AI-powered suggestions to enhance the project listing.'),
  flags: z
    .array(z.string().describe('Potential issues or concerns identified in the listing.'))
    .max(10)
    .describe('A list of potential issues or concerns that need review.'),
  overallQualityScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('An overall quality score (0-100) for the listing based on AI analysis.'),
});
export type ImproveListingQualityOutput = z.infer<typeof ImproveListingQualityOutputSchema>;

// The reply's JSON Schema. Ollama turns it into a grammar the model's output
// has to follow, but the model never reads it there, so the prompt carries it
// too, descriptions and all. $schema is left out as noise.
const replyJsonSchema: Record<string, unknown> = z.toJSONSchema(ImproveListingQualityOutputSchema);
delete replyJsonSchema.$schema;

/** The part of Ollama's /api/chat answer the review reads. */
const OllamaChatReply = z.object({
  message: z.object({ content: z.string() }),
  done_reason: z.string().optional(),
});

function prompt(listing: ImproveListingQualityInput): string {
  return `You are an AI-powered listing quality tool that reviews project listings and provides suggestions for improvement and flags potential issues.

Analyze the following project listing details:

Title: ${listing.title}
Description: ${listing.description}
Category: ${listing.category}
Funding Goal: ${listing.fundingGoal}
Image: the attached picture.

Provide specific, actionable suggestions to improve the listing's quality and user engagement.
Identify any potential issues or concerns that an admin should review, such as misleading information, unrealistic funding goals, or inappropriate content.
Assess the overall quality of the listing and assign a score between 0 and 100.

Ensure that the suggestions and flags are clear, concise, and directly related to the listing details.
Reply with JSON that matches this JSON Schema, using its descriptions to ensure suggestions, flags and overallQualityScore are in the format requested:
${JSON.stringify(replyJsonSchema)}`;
}

export async function improveListingQuality(input: ImproveListingQualityInput): Promise<ImproveListingQualityOutput> {
  const listing = ImproveListingQualityInputSchema.parse(input);
  const base = process.env.OLLAMA_BASE_URL;
  if (!base) throw new Error('OLLAMA_BASE_URL is not set, so the listing review is off');
  const [, picture] = IMAGE_DATA_URI.exec(listing.imageUrl)!;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // Ollama Cloud takes a key, as can a proxy in front of a self-hosted server.
  if (process.env.OLLAMA_API_KEY) headers.authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;

  const res = await fetch(`${base.replace(/\/+$/, '')}/api/chat`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || DEFAULT_MODEL,
      stream: false,
      // The answer is held to the schema anyway; thinking first only adds time.
      think: false,
      format: replyJsonSchema,
      messages: [{ role: 'user', content: prompt(listing), images: [picture] }],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${body.slice(0, 500)}`);

  const { message, done_reason } = OllamaChatReply.parse(JSON.parse(body));
  if (!message.content) throw new Error(`Ollama returned no text (done reason ${done_reason ?? 'none'})`);
  return ImproveListingQualityOutputSchema.parse(JSON.parse(message.content));
}
