// The listing review against a stand-in for the Gemini API: fetch is replaced,
// so nothing here reaches Google or bills anyone.

import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { improveListingQuality, type ImproveListingQualityInput } from "./improve-listing-quality.ts";

const PICTURE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const draft: ImproveListingQualityInput = {
  title: "Solar kiosk for the market",
  description: "A solar-powered charging kiosk for the stallholders of the town market.",
  category: "Energy",
  fundingGoal: 500,
  imageUrl: `data:image/png;base64,${PICTURE}`,
};
const goodReply = {
  suggestions: ["Say how many stalls the kiosk serves."],
  flags: [],
  overallQualityScore: 72,
};

type Sent = { url: URL; headers: Headers; body: Record<string, any> };
let sent: Sent[];
const realFetch = globalThis.fetch;
const env = { GEMINI_API_KEY: process.env.GEMINI_API_KEY, GOOGLE_API_KEY: process.env.GOOGLE_API_KEY };

/** Gemini answers every request with `text` as the model's reply. */
function geminiReplies(text: string | null, finishReason = "STOP") {
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: new URL(String(input)), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const content = text === null ? undefined : { role: "model", parts: [{ text }] };
    return Response.json({ candidates: [{ content, finishReason }] });
  };
}

beforeEach(() => {
  sent = [];
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.GOOGLE_API_KEY;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("one request to Gemini with the draft, the picture and the reply schema, and the reply comes back", async () => {
  process.env.GOOGLE_API_KEY = "a-key-for-something-else";
  geminiReplies(JSON.stringify(goodReply));

  // With both set the SDK logs "Using GOOGLE_API_KEY" whatever key it is
  // given. It isn't using it: the header below says which key went.
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await improveListingQuality(draft), goodReply);
  } finally {
    console.warn = warn;
  }
  assert.equal(sent.length, 1);
  const [{ url, headers, body }] = sent;
  assert.equal(url.host, "generativelanguage.googleapis.com");
  assert.match(url.pathname, /\/models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(headers.get("x-goog-api-key"), "test-gemini-key", "the key comes from GEMINI_API_KEY only");

  const parts = body.contents[0].parts;
  assert.match(parts[0].text, /Title: Solar kiosk for the market\n/);
  assert.match(parts[0].text, /Funding Goal: 500\n/);
  assert.deepEqual(parts[1], { inlineData: { mimeType: "image/png", data: PICTURE } });

  const { responseMimeType, responseJsonSchema } = body.generationConfig;
  assert.equal(responseMimeType, "application/json");
  assert.equal(responseJsonSchema.$schema, undefined);
  assert.deepEqual(responseJsonSchema.required, ["suggestions", "flags", "overallQualityScore"]);
  assert.equal(responseJsonSchema.properties.suggestions.maxItems, 10);
  assert.deepEqual(
    [responseJsonSchema.properties.overallQualityScore.minimum, responseJsonSchema.properties.overallQualityScore.maximum],
    [0, 100],
  );
});

test("a reply that isn't JSON in the reply schema throws instead of reaching the dialog", async () => {
  const replies = {
    "not JSON": "Here is my review: looks good!",
    "score over 100": JSON.stringify({ ...goodReply, overallQualityScore: 150 }),
    "fractional score": JSON.stringify({ ...goodReply, overallQualityScore: 72.5 }),
    "no flags": JSON.stringify({ suggestions: [], overallQualityScore: 50 }),
    "a suggestion that isn't text": JSON.stringify({ ...goodReply, suggestions: [{ text: "x" }] }),
    "eleven suggestions": JSON.stringify({ ...goodReply, suggestions: Array(11).fill("More detail.") }),
  };
  for (const [what, text] of Object.entries(replies)) {
    geminiReplies(text);
    await assert.rejects(improveListingQuality(draft), Error, what);
  }
});

test("a reply with no text, as when Gemini blocks one, throws with the finish reason", async () => {
  geminiReplies(null, "SAFETY");
  await assert.rejects(improveListingQuality(draft), /no text \(finish reason SAFETY\)/);
});

test("without GEMINI_API_KEY nothing is sent, even with GOOGLE_API_KEY set", async () => {
  delete process.env.GEMINI_API_KEY;
  process.env.GOOGLE_API_KEY = "a-key-for-something-else";
  geminiReplies(JSON.stringify(goodReply));
  await assert.rejects(improveListingQuality(draft), /GEMINI_API_KEY is not set/);
  assert.equal(sent.length, 0);
});

test("a picture that isn't a Base64 image data URI, or text past the cap, is refused before anything is sent", async () => {
  geminiReplies(JSON.stringify(goodReply));
  const bad: Record<string, Partial<ImproveListingQualityInput>> = {
    "no picture": { imageUrl: "" },
    "a web address": { imageUrl: "https://example.com/kiosk.png" },
    "not an image": { imageUrl: `data:application/pdf;base64,${PICTURE}` },
    "not Base64": { imageUrl: "data:image/png,rawbytes" },
    "a description of 10,001 characters": { description: "x".repeat(10_001) },
  };
  for (const [what, change] of Object.entries(bad)) {
    await assert.rejects(improveListingQuality({ ...draft, ...change }), Error, what);
  }
  assert.equal(sent.length, 0);
});
