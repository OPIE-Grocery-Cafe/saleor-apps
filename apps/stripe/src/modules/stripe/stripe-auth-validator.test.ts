import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockedStripeRestrictedKeyTest } from "@/__tests__/mocks/mocked-stripe-restricted-key";
import { StripeAuthValidator } from "@/modules/stripe/stripe-auth-validator";
import { StripeClient } from "@/modules/stripe/stripe-client";

describe("StripeAuthValidator", () => {
  describe("validateStripeAuth", () => {
    const stripe = StripeClient.createFromRestrictedKey(mockedStripeRestrictedKeyTest);

    beforeEach(() => {
      vi.restoreAllMocks();

      vi.spyOn(stripe.nativeClient.paymentIntents, "list").mockImplementationOnce(() => {
        return Promise.resolve() as unknown as Stripe.ApiListPromise<Stripe.PaymentIntent>;
      });

      const missing = () => Promise.reject(resourceMissing());

      vi.spyOn(stripe.nativeClient.paymentIntents, "retrieve").mockImplementation(missing);
      vi.spyOn(stripe.nativeClient.paymentIntents, "capture").mockImplementation(missing);
      vi.spyOn(stripe.nativeClient.paymentIntents, "cancel").mockImplementation(missing);
      vi.spyOn(stripe.nativeClient.refunds, "create").mockImplementation(missing);
      vi.spyOn(stripe.nativeClient.customers, "retrieve").mockImplementation(missing);
      vi.spyOn(stripe.nativeClient.paymentMethods, "retrieve").mockImplementation(missing);
      vi.spyOn(stripe.nativeClient.setupIntents, "retrieve").mockImplementation(missing);
    });

    it("returns ok only when every read and action permission probe reaches Stripe", async () => {
      const instance = StripeAuthValidator.createFromClient(stripe);

      const result = await instance.validateStripeAuth();

      expect(result.isOk()).toBe(true);
      expect(stripe.nativeClient.paymentIntents.capture).toHaveBeenCalledOnce();
      expect(stripe.nativeClient.paymentIntents.cancel).toHaveBeenCalledOnce();
      expect(stripe.nativeClient.refunds.create).toHaveBeenCalledOnce();
      expect(stripe.nativeClient.customers.retrieve).toHaveBeenCalledOnce();
      expect(stripe.nativeClient.paymentMethods.retrieve).toHaveBeenCalledOnce();
      expect(stripe.nativeClient.setupIntents.retrieve).toHaveBeenCalledOnce();
    });

    it("Return AuthError if Payment Intents (READ) permission is missing", async () => {
      vi.spyOn(stripe.nativeClient.paymentIntents, "list").mockImplementationOnce(() => {
        return Promise.reject(
          new Error("Test Error"),
        ) as unknown as Stripe.ApiListPromise<Stripe.PaymentIntent>;
      });

      const instance = StripeAuthValidator.createFromClient(stripe);

      const result = await instance.validateStripeAuth();

      expect(result._unsafeUnwrapErr()).toMatchInlineSnapshot(`
        [StripeAuthValidator.AuthError: Test Error
        Failed to authorize with Stripe]
      `);
    });

    it("rejects an under-scoped key when an action probe returns permission denied", async () => {
      vi.spyOn(stripe.nativeClient.paymentIntents, "capture").mockRejectedValueOnce(
        new Stripe.errors.StripePermissionError({
          message: "Permission denied",
          type: "invalid_request_error",
        }),
      );

      const result = await StripeAuthValidator.createFromClient(stripe).validateStripeAuth();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain("Permission denied");
    });

    it("rejects non-resource-missing invalid request responses", async () => {
      vi.spyOn(stripe.nativeClient.customers, "retrieve").mockRejectedValueOnce(
        new Stripe.errors.StripeInvalidRequestError({
          message: "Invalid request",
          type: "invalid_request_error",
          code: "parameter_invalid_empty",
        }),
      );

      const result = await StripeAuthValidator.createFromClient(stripe).validateStripeAuth();

      expect(result.isErr()).toBe(true);
    });
  });
});

function resourceMissing() {
  return new Stripe.errors.StripeInvalidRequestError({
    message: "No such resource",
    type: "invalid_request_error",
    code: "resource_missing",
  });
}
