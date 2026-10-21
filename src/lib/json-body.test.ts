import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonObject } from "./json-body.ts";

const req = (body: string) => new Request("http://x/", { method: "POST", body });

test("an object body comes back as the object", async () => {
  assert.deepEqual(await jsonObject(req('{"ids":["a"]}')), { ids: ["a"] });
});

test("anything that is not a JSON object comes back null instead of throwing", async () => {
  for (const body of ["notjson", "", "null", "[]", '"text"', "42", "{"]) {
    assert.equal(await jsonObject(req(body)), null, body);
  }
});
