import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { InternalRequestError, verifyInternalRequest } from "./verify-internal-request";

const secret = "s".repeat(32);
const timestamp = "1735689600";
const transactionId = "VHJhbnNhY3Rpb246MQ==";
const saleorApiUrl = "https://saleor.example.com/graphql/";

function headers(signingSecret = secret, signedTimestamp = timestamp) {
  const signature = createHmac("sha256", signingSecret)
    .update(`${signedTimestamp}.${transactionId}.${saleorApiUrl}`)
    .digest("hex");

  return new Headers({
    "x-opie-timestamp": signedTimestamp,
    "x-opie-signature": `v1=${signature}`,
  });
}

describe("verifyInternalRequest", () => {
  it("accepts a current or rotation secret", () => {
    expect(() =>
      verifyInternalRequest({
        transactionId,
        saleorApiUrl,
        headers: headers("p".repeat(32)),
        secrets: [secret, "p".repeat(32)],
        now: Number(timestamp),
      }),
    ).not.toThrow();
  });

  it("rejects stale and tampered requests", () => {
    expect(() =>
      verifyInternalRequest({
        transactionId,
        saleorApiUrl,
        headers: headers(),
        secrets: [secret],
        now: Number(timestamp) + 301,
      }),
    ).toThrow(InternalRequestError);
    expect(() =>
      verifyInternalRequest({
        transactionId: "tampered",
        saleorApiUrl,
        headers: headers(),
        secrets: [secret],
        now: Number(timestamp),
      }),
    ).toThrow(InternalRequestError);
  });
});
