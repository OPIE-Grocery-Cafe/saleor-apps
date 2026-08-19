import { describe, expect, it } from "vitest";

import { scrubSensitiveEventData } from "./scrub-sensitive-event-data";

describe("scrubSensitiveEventData", () => {
  it("redacts secret fields, authorization headers, and Stripe credentials", () => {
    expect(
      scrubSensitiveEventData({
        request: { headers: { authorization: "Bearer app-token", cookie: "session=value" } },
        extra: {
          restrictedKey: "rk_live_abc123",
          nested: { message: "Stripe webhook whsec_abc123 failed" },
          safeId: "wh_123",
        },
      }),
    ).toStrictEqual({
      request: { headers: { authorization: "[Filtered]", cookie: "[Filtered]" } },
      extra: {
        restrictedKey: "[Filtered]",
        nested: { message: "Stripe webhook [Filtered] failed" },
        safeId: "wh_123",
      },
    });
  });
});
