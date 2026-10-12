import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nearestImageWidth,
  parseCid,
  resizedImageUrl,
  resizedSrcSet,
} from "./project-image.ts";

// A real listing picture from testnet, and a CIDv0.
const V1 = "bafybeidu2zb3rgholkhgmwvxp5gyqb7t6tvkh2flgxev2knavv2iduppyq";
const V0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

test("a CID is found however the address spells it", () => {
  assert.equal(parseCid(V1), V1);
  assert.equal(parseCid(`ipfs://${V1}`), V1);
  assert.equal(parseCid(`https://gateway.pinata.cloud/ipfs/${V1}`), V1);
  assert.equal(parseCid(`https://example.mypinata.cloud/ipfs/${V1}?filename=a.jpg`), V1);
  assert.equal(parseCid(`https://gateway.pinata.cloud/ipfs/${V0}/photo.png`), V0);
});

test("anything that is not a CID is refused", () => {
  assert.equal(parseCid(""), null);
  assert.equal(parseCid(null), null);
  assert.equal(parseCid("/images/project-placeholder.svg"), null);
  assert.equal(parseCid("https://lh3.googleusercontent.com/a/ACg8ocJ"), null);
  assert.equal(parseCid("../../etc/passwd"), null);
  assert.equal(parseCid("..%2F..%2Fsecret"), null);
  // Only the CID segment is ever taken; what follows it is dropped.
  assert.equal(parseCid(`${V1}/../../secret`), V1);
  assert.equal(parseCid("bafy UPPER"), null);
});

test("a requested width rounds up to a served one, and caps at the largest", () => {
  assert.equal(nearestImageWidth(1), 320);
  assert.equal(nearestImageWidth(320), 320);
  assert.equal(nearestImageWidth(321), 640);
  assert.equal(nearestImageWidth(1200), 1600);
  assert.equal(nearestImageWidth(4000), 1600);
});

test("IPFS pictures go through the resize route; others are left alone", () => {
  assert.equal(
    resizedImageUrl(`https://gateway.pinata.cloud/ipfs/${V1}`, 600),
    `/api/images/${V1}?w=640`,
  );
  assert.equal(resizedImageUrl("/images/project-placeholder.svg", 600), "/images/project-placeholder.svg");
  const dataUri = `data:image/png;base64,${V1}`;
  assert.equal(resizedImageUrl(dataUri, 600), dataUri);
});

test("the srcset offers every served width", () => {
  assert.equal(
    resizedSrcSet(`ipfs://${V1}`),
    [320, 640, 1080, 1600].map((w) => `/api/images/${V1}?w=${w} ${w}w`).join(", "),
  );
  assert.equal(resizedSrcSet("/images/project-placeholder.svg"), undefined);
});
