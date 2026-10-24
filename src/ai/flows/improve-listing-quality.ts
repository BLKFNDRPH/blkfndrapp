/**
 * Not a "use server" module: that would make improveListingQuality a server
 * action anyone can call, a billable model call with no sign-in check. The one
 * entry point is runImproveListingQuality in src/app/actions.ts, which requires
 * a signed-in caller first.
 *
 * @fileOverview The AI listing review: one Gemini call through Google's Gen AI
 * SDK (@google/genai). The model is asked for JSON in the shape of the output
 * schema below, and its reply is checked against that schema before anything
 * returns it, so a malformed reply throws instead of reaching the dialog.
 *
 * It exports the `improveListingQuality` function, the `ImproveListingQualityInput` type, and the `ImproveListingQualityOutput` type.
 */

import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

const MODEL = 'gemini-2.5-flash';

/** A picture as FileReader.readAsDataURL writes it: the MIME type, then the Base64 bytes. */
const IMAGE_DATA_URI = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

// Well past every listing limit (src/lib/listing-limits.ts), so a draft that is
// over one still gets reviewed. It bounds what one press can send to the model.
const TEXT_MAX = 10_000;

const ImproveListingQualityInputSchema = z.object({
  title: z.string().max(TEXT_MAX).describe('The title of the project listing.'),
  description: z.string().max(TEXT_MAX).describe('The detailed description of the project.'),
  category: z.string().max(200).describe('The category the project belongs to (e.g., Technology, Art, Charity).'),
  fundingGoal: z.number().describe('The total funding amount being sought for the project.'),
  imageUrl: z
    .string()
    .regex(IMAGE_DATA_URI, 'Expected an image as a Base64 data URI')
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

// The reply's JSON Schema, sent with the request. Gemini enforces maxItems,
// minimum and maximum, and reads the descriptions as instructions. $schema is
// not a keyword Gemini lists, so it is left out.
const replyJsonSchema: Record<string, unknown> = z.toJSONSchema(ImproveListingQualityOutputSchema);
delete replyJsonSchema.$schema;

export async function improveListingQuality(input: ImproveListingQualityInput): Promise<ImproveListingQualityOutput> {
  const listing = ImproveListingQualityInputSchema.parse(input);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set, so the listing review is off');
  const [, mimeType, data] = IMAGE_DATA_URI.exec(listing.imageUrl)!;

  // The key is passed rather than left to the SDK, which would prefer
  // GOOGLE_API_KEY. Without retryOptions the SDK makes one attempt, so one press
  // is one billable call; the timeout stops a hung call holding the action.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 60_000 } });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `You are an AI-powered listing quality tool that reviews project listings and provides suggestions for improvement and flags potential issues.

Analyze the following project listing details:

Title: ${listing.title}
Description: ${listing.description}
Category: ${listing.category}
Funding Goal: ${listing.fundingGoal}
Image:`,
          },
          { inlineData: { mimeType, data } },
          {
            text: `Provide specific, actionable suggestions to improve the listing's quality and user engagement.
Identify any potential issues or concerns that an admin should review, such as misleading information, unrealistic funding goals, or inappropriate content.
Assess the overall quality of the listing and assign a score between 0 and 100.

Ensure that the suggestions and flags are clear, concise, and directly related to the listing details.
Use output schema descriptions to ensure suggestions, flags and overallQualityScore are in the format requested.`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: replyJsonSchema,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error(`Gemini returned no text (finish reason ${response.candidates?.[0]?.finishReason ?? 'none'})`);
  }
  return ImproveListingQualityOutputSchema.parse(JSON.parse(text));
}
