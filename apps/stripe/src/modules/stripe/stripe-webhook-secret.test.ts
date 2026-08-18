import { describe, expect, it } from "vitest";

import {
  createStripeWebhookSecret,
  type StripeWebhookSecret,
  StripeWebhookSecretValidationError,
} from "@/modules/stripe/stripe-webhook-secret";

describe("StripeWebhookSecret", () => {
  it("Creates from valid string", () => {
    const brandedString = createStripeWebhookSecret("whsec_XYZ")._unsafeUnwrap();

    expect(brandedString).toStrictEqual("whsec_XYZ");
  });
  it("rejects an unexpected prefix", () => {
    expect(createStripeWebhookSecret("unexpected_prefix_xyz")._unsafeUnwrapErr()).toBeInstanceOf(
      StripeWebhookSecretValidationError,
    );
  });

  it("Throws if empty value passed", () => {
    expect(createStripeWebhookSecret("")._unsafeUnwrapErr()).toBeInstanceOf(
      StripeWebhookSecretValidationError,
    );
  });

  it("Nominal typing works", () => {
    const fn = (v: StripeWebhookSecret) => v;

    // @ts-expect-error - should be error, only string must be accepted
    fn("whsec_XXX");

    expect(() => fn(createStripeWebhookSecret("whsec_XXX")._unsafeUnwrap())).not.toThrow();
  });
});
