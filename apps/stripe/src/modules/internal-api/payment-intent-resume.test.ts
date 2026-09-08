import { describe, expect, it } from "vitest";

import { paymentIntentResumeSecret } from "./payment-intent-resume";

describe("paymentIntentResumeSecret", () => {
  it.each(["requires_action", "requires_confirmation"] as const)(
    "allows the browser to resume %s without creating another intent",
    (status) => {
      expect(paymentIntentResumeSecret({ status, client_secret: "pi_secret_existing" })).toBe(
        "pi_secret_existing",
      );
    },
  );

  it.each([
    "requires_payment_method",
    "processing",
    "requires_capture",
    "succeeded",
    "canceled",
  ] as const)("does not expose a client secret for %s", (status) => {
    expect(paymentIntentResumeSecret({ status, client_secret: "pi_secret_existing" })).toBeNull();
  });

  it("fails closed when Stripe did not return a client secret", () => {
    expect(
      paymentIntentResumeSecret({ status: "requires_action", client_secret: null }),
    ).toBeNull();
  });
});
