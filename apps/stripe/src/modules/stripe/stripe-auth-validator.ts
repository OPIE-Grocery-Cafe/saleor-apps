import { err, ok, type Result } from "neverthrow";
import type Stripe from "stripe";

import { BaseError } from "@/lib/errors";
import { type StripeClient } from "@/modules/stripe/stripe-client";

export class StripeAuthValidator {
  stripe: Stripe;

  static AuthError = BaseError.subclass("StripeAuthValidator.AuthError", {
    props: {
      _internalName: "StripeAuthValidator.AuthError" as const,
    },
  });

  private constructor(stripe: Stripe) {
    this.stripe = stripe;
  }

  static createFromClient(client: StripeClient) {
    return new StripeAuthValidator(client.nativeClient);
  }

  /**
   * Checks if restricted keys is valid. Infers permissions scope by calling APIs that are needed by app
   */
  async validateStripeAuth(): Promise<
    Result<null, InstanceType<typeof StripeAuthValidator.AuthError>>
  > {
    try {
      await this.stripe.paymentIntents.list({ limit: 1 });

      await this.expectResourceMissing(() =>
        this.stripe.paymentIntents.retrieve("pi_opie_permission_probe_missing"),
      );
      await this.expectResourceMissing(() =>
        this.stripe.paymentIntents.capture("pi_opie_permission_probe_missing"),
      );
      await this.expectResourceMissing(() =>
        this.stripe.paymentIntents.cancel("pi_opie_permission_probe_missing"),
      );
      await this.expectResourceMissing(() =>
        this.stripe.refunds.create({ payment_intent: "pi_opie_permission_probe_missing" }),
      );
      await this.expectResourceMissing(() =>
        this.stripe.customers.retrieve("cus_opie_permission_probe_missing"),
      );
      await this.expectResourceMissing(() =>
        this.stripe.paymentMethods.retrieve("pm_opie_permission_probe_missing"),
      );
      await this.expectResourceMissing(() =>
        this.stripe.setupIntents.retrieve("seti_opie_permission_probe_missing"),
      );

      return ok(null);
    } catch (e) {
      return err(
        new StripeAuthValidator.AuthError("Failed to authorize with Stripe", { cause: e }),
      );
    }
  }

  private async expectResourceMissing(request: () => PromiseLike<unknown>): Promise<void> {
    try {
      await request();
      throw new Error("Stripe permission probe unexpectedly found its impossible resource");
    } catch (error) {
      if (isResourceMissing(error)) return;
      throw error;
    }
  }
}

function isResourceMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const stripeError = error as { code?: unknown; rawType?: unknown };

  return stripeError.code === "resource_missing" && stripeError.rawType === "invalid_request_error";
}
