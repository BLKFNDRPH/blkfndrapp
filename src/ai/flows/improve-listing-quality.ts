'use server';

/**
 * @fileOverview This file defines a Genkit flow for improving the quality of project listings using AI.
 *
 * The flow analyzes listing details to suggest improvements and flag potential issues.
 * It exports the `improveListingQuality` function, the `ImproveListingQualityInput` type, and the `ImproveListingQualityOutput` type.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ImproveListingQualityInputSchema = z.object({
  title: z.string().describe('The title of the project listing.'),
  description: z.string().describe('The detailed description of the project.'),
  category: z.string().describe('The category the project belongs to (e.g., Technology, Art, Charity).'),
  fundingGoal: z.number().describe('The total funding amount being sought for the project.'),
  imageUrl: z.string().describe("URL for an image representing the project, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
});
export type ImproveListingQualityInput = z.infer<typeof ImproveListingQualityInputSchema>;

const ImproveListingQualityOutputSchema = z.object({
  suggestions: z.array(
    z.string().describe('Specific suggestions for improving the listing.')
  ).describe('A list of AI-powered suggestions to enhance the project listing.'),
  flags: z.array(
    z.string().describe('Potential issues or concerns identified in the listing.')
  ).describe('A list of potential issues or concerns that need review.'),
  overallQualityScore: z.number().describe('An overall quality score (0-100) for the listing based on AI analysis.'),
});
export type ImproveListingQualityOutput = z.infer<typeof ImproveListingQualityOutputSchema>;

export async function improveListingQuality(input: ImproveListingQualityInput): Promise<ImproveListingQualityOutput> {
  return improveListingQualityFlow(input);
}

const improveListingQualityPrompt = ai.definePrompt({
  name: 'improveListingQualityPrompt',
  input: {schema: ImproveListingQualityInputSchema},
  output: {schema: ImproveListingQualityOutputSchema},
  prompt: `You are an AI-powered listing quality tool that reviews project listings and provides suggestions for improvement and flags potential issues.

  Analyze the following project listing details:

  Title: {{{title}}}
  Description: {{{description}}}
  Category: {{{category}}}
  Funding Goal: {{{fundingGoal}}}
  Image: {{media url=imageUrl}}

  Provide specific, actionable suggestions to improve the listing's quality and user engagement.
  Identify any potential issues or concerns that an admin should review, such as misleading information, unrealistic funding goals, or inappropriate content.
  Assess the overall quality of the listing and assign a score between 0 and 100.

  Ensure that the suggestions and flags are clear, concise, and directly related to the listing details.
  Use output schema descriptions to ensure suggestions, flags and overallQualityScore are in the format requested.
`,
});

const improveListingQualityFlow = ai.defineFlow(
  {
    name: 'improveListingQualityFlow',
    inputSchema: ImproveListingQualityInputSchema,
    outputSchema: ImproveListingQualityOutputSchema,
  },
  async input => {
    const {output} = await improveListingQualityPrompt(input);
    return output!;
  }
);
