import type { Pool } from "pg";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockedAppConfigRepo } from "@/__tests__/mocks/app-config-repo";
import { mockedSaleorAppId } from "@/__tests__/mocks/constants";
import { mockedSaleorApiUrl } from "@/__tests__/mocks/saleor-api-url";
import { StripeClient } from "@/modules/stripe/stripe-client";

import { StoredPaymentCustomerRepo } from "./customer-repo";
import { StoredPaymentMethodsService } from "./service";

describe("StoredPaymentMethodsService", () => {
  const customerRepo = new StoredPaymentCustomerRepo({} as Pool);
  const stripe = {
    customers: { create: vi.fn() },
    setupIntents: { create: vi.fn(), retrieve: vi.fn() },
    paymentMethods: { list: vi.fn(), retrieve: vi.fn(), detach: vi.fn() },
  };
  const context = {
    saleorApiUrl: mockedSaleorApiUrl,
    appId: mockedSaleorAppId,
    channelId: "Q2hhbm5lbDox",
    user: { id: "VXNlcjox", email: "shopper@example.com" },
  };

  beforeEach(() => {
    vi.spyOn(StripeClient, "createFromRestrictedKey").mockReturnValue({
      nativeClient: stripe as unknown as Stripe,
    } as StripeClient);
  });

  it("requires explicit consent and creates a customer-scoped card SetupIntent", async () => {
    vi.spyOn(customerRepo, "get").mockResolvedValue(null);
    vi.spyOn(customerRepo, "put").mockResolvedValue();
    stripe.customers.create.mockResolvedValue({ id: "cus_123" });
    stripe.setupIntents.create.mockResolvedValue({ id: "seti_123", client_secret: "seti_secret" });
    const service = new StoredPaymentMethodsService(mockedAppConfigRepo, customerRepo);

    await expect(service.initializeMethod({ ...context, data: {} })).resolves.toStrictEqual({
      result: "FAILED_TO_TOKENIZE",
      error: "Explicit saved-payment consent is required",
    });
    const result = await service.initializeMethod({
      ...context,
      issuedAt: "2026-08-11T12:00:00Z",
      data: { savePaymentMethodConsent: true },
    });

    expect(result).toMatchObject({
      id: "seti_123",
      result: "ADDITIONAL_ACTION_REQUIRED",
      data: { clientSecret: "seti_secret" },
    });
    expect(stripe.setupIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_123", payment_method_types: ["card"] }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^opie_/) }),
    );
  });

  it("returns only display-safe card fields", async () => {
    vi.spyOn(customerRepo, "get").mockResolvedValue("cus_123");
    stripe.paymentMethods.list.mockResolvedValue({
      data: [
        { id: "pm_123", card: { brand: "visa", last4: "4242", exp_month: 8, exp_year: 2030 } },
      ],
    });
    const service = new StoredPaymentMethodsService(mockedAppConfigRepo, customerRepo);

    await expect(service.list(context)).resolves.toStrictEqual({
      paymentMethods: [
        {
          id: "pm_123",
          supportedPaymentFlows: ["INTERACTIVE"],
          type: "Credit Card",
          name: "visa •••• 4242",
          creditCardInfo: { brand: "visa", lastDigits: "4242", expMonth: 8, expYear: 2030 },
        },
      ],
    });
  });

  it("refuses to detach a payment method owned by another Stripe customer", async () => {
    vi.spyOn(customerRepo, "get").mockResolvedValue("cus_123");
    stripe.paymentMethods.retrieve.mockResolvedValue({ id: "pm_other", customer: "cus_other" });
    const service = new StoredPaymentMethodsService(mockedAppConfigRepo, customerRepo);

    await expect(
      service.remove({ ...context, paymentMethodId: "pm_other" }),
    ).resolves.toStrictEqual({
      result: "FAILED_TO_DELETE",
      error: "Payment method customer mismatch",
    });
    expect(stripe.paymentMethods.detach).not.toHaveBeenCalled();
  });

  it("finalizes only a succeeded SetupIntent for the mapped customer", async () => {
    vi.spyOn(customerRepo, "get").mockResolvedValue("cus_123");
    stripe.setupIntents.retrieve.mockResolvedValue({
      id: "seti_123",
      customer: "cus_123",
      status: "succeeded",
      payment_method: "pm_123",
    });
    const service = new StoredPaymentMethodsService(mockedAppConfigRepo, customerRepo);

    await expect(
      service.processMethod({ ...context, setupIntentId: "seti_123" }),
    ).resolves.toStrictEqual({
      id: "pm_123",
      result: "SUCCESSFULLY_TOKENIZED",
    });
  });
});
