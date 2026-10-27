// The listing review against a stand-in for Ollama's /api/chat: fetch is
// replaced, so nothing here needs an Ollama server.

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

type Sent = { url: string; method?: string; headers: Headers; body: Record<string, any> };
let sent: Sent[];
const realFetch = globalThis.fetch;
const ENV = ["OLLAMA_BASE_URL", "OLLAMA_MODEL", "OLLAMA_API_KEY"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

/** Ollama answers every request with `content` as the model's reply, or with `status` and an error. */
function ollamaReplies(content: string, { status = 200, doneReason = "stop" } = {}) {
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), method: init?.method, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    if (status !== 200) return Response.json({ error: content }, { status });
    return Response.json({ model: "m", message: { role: "assistant", content }, done: true, done_reason: doneReason });
  };
}

beforeEach(() => {
  sent = [];
  for (const k of ENV) delete process.env[k];
  process.env.OLLAMA_BASE_URL = "http://ollama.test:11434/";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("one chat request to Ollama with the draft, the picture and the reply schema, and the reply comes back", async () => {
  ollamaReplies(JSON.stringify(goodReply));

  assert.deepEqual(await improveListingQuality(draft), goodReply);
  assert.equal(sent.length, 1);
  const [{ url, method, headers, body }] = sent;
  assert.equal(url, "http://ollama.test:11434/api/chat");
  assert.equal(method, "POST");
  assert.equal(headers.get("authorization"), null, "no key unless OLLAMA_API_KEY is set");

  assert.equal(body.model, "gemma4:12b");
  assert.equal(body.stream, false);
  assert.equal(body.think, false);
  assert.equal(body.messages.length, 1);
  const [message] = body.messages;
  assert.equal(message.role, "user");
  assert.deepEqual(message.images, [PICTURE], "the picture goes as bare Base64, without the data: prefix");
  assert.match(message.content, /Title: Solar kiosk for the market\n/);
  assert.match(message.content, /Funding Goal: 500\n/);
  assert.ok(message.content.includes(JSON.stringify(body.format)), "the prompt carries the schema the output is held to");

  assert.equal(body.format.$schema, undefined);
  assert.deepEqual(body.format.required, ["suggestions", "flags", "overallQualityScore"]);
  assert.equal(body.format.properties.suggestions.maxItems, 10);
  assert.deepEqual([body.format.properties.overallQualityScore.minimum, body.format.properties.overallQualityScore.maximum], [0, 100]);
});

test("OLLAMA_MODEL picks the model, and OLLAMA_API_KEY is sent as a bearer token", async () => {
  process.env.OLLAMA_BASE_URL = "https://ollama.com";
  process.env.OLLAMA_MODEL = "qwen3.8:latest";
  process.env.OLLAMA_API_KEY = "test-ollama-key";
  ollamaReplies(JSON.stringify(goodReply));

  await improveListingQuality(draft);
  assert.equal(sent[0].url, "https://ollama.com/api/chat");
  assert.equal(sent[0].body.model, "qwen3.8:latest");
  assert.equal(sent[0].headers.get("authorization"), "Bearer test-ollama-key");
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
  for (const [what, content] of Object.entries(replies)) {
    ollamaReplies(content);
    await assert.rejects(improveListingQuality(draft), Error, what);
  }
});

test("an empty reply throws with the done reason, and an Ollama error with its status and message", async () => {
  ollamaReplies("", { doneReason: "length" });
  await assert.rejects(improveListingQuality(draft), /no text \(done reason length\)/);

  ollamaReplies('model "gemma4:12b" not found, try pulling it first', { status: 404 });
  await assert.rejects(improveListingQuality(draft), /Ollama answered 404: .*not found/);
});

test("without OLLAMA_BASE_URL nothing is sent", async () => {
  delete process.env.OLLAMA_BASE_URL;
  ollamaReplies(JSON.stringify(goodReply));
  await assert.rejects(improveListingQuality(draft), /OLLAMA_BASE_URL is not set/);
  assert.equal(sent.length, 0);
});

test("a picture Ollama can't read, or text past the cap, is refused before anything is sent", async () => {
  ollamaReplies(JSON.stringify(goodReply));
  const bad: Record<string, Partial<ImproveListingQualityInput>> = {
    "no picture": { imageUrl: "" },
    "a web address": { imageUrl: "https://example.com/kiosk.png" },
    "AVIF, which Ollama refuses": { imageUrl: `data:image/avif;base64,${PICTURE}` },
    "HEIC": { imageUrl: `data:image/heic;base64,${PICTURE}` },
    "not an image": { imageUrl: `data:application/pdf;base64,${PICTURE}` },
    "not Base64": { imageUrl: "data:image/png,rawbytes" },
    "a description of 10,001 characters": { description: "x".repeat(10_001) },
  };
  for (const [what, change] of Object.entries(bad)) {
    await assert.rejects(improveListingQuality({ ...draft, ...change }), Error, what);
  }
  for (const type of ["png", "jpeg", "webp", "gif"]) {
    await improveListingQuality({ ...draft, imageUrl: `data:image/${type};base64,${PICTURE}` });
  }
  assert.equal(sent.length, 4, "only the four readable formats were sent");
});
