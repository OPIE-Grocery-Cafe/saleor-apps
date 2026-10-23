import type { Pool } from "pg";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockedAppConfigRepo } from "@/__tests__/mocks/app-config-repo";
import { mockedSaleorAppId } from "@/__tests__/mocks/constants";
import { mockedSaleorApiUrl } from "@/__tests__/mocks/saleor-api-url";
import { StripeClient } from "@/modules/stripe/stripe-client";

import { StoredPaymentCustomerRepo } from "./customer-repo";
import { StoredPaymentMethodsService, StoredPaymentMethodUnavailableError } from "./service";

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

  it("resolves an owned saved card to the mapped Stripe customer without creating a customer", async () => {
    vi.spyOn(customerRepo, "get").mockResolvedValue("cus_123");
    stripe.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_owned",
      type: "card",
      card: { last4: "4242" },
      customer: "cus_123",
    });
    const service = new StoredPaymentMethodsService(mockedAppConfigRepo, customerRepo);

    await expect(
      service.resolveForPayment({ ...context, paymentMethodId: "pm_owned" }),
    ).resolves.toStrictEqual({ customer: "cus_123", paymentMethod: "pm_owned" });
    expect(stripe.customers.create).not.toHaveBeenCalled();
  });

  it.each([null, "cus_other", { id: "cus_other" }])(
    "rejects a detached or foreign saved card",
    async (customer) => {
      vi.spyOn(customerRepo, "get").mockResolvedValue("cus_123");
      stripe.paymentMethods.retrieve.mockResolvedValue({
        id: "pm_other",
        type: "card",
        card: { last4: "4242" },
        customer,
      });
      const service = new StoredPaymentMethodsService(mockedAppConfigRepo, customerRepo);

      await expect(
        service.resolveForPayment({ ...context, paymentMethodId: "pm_other" }),
      ).rejects.toBeInstanceOf(StoredPaymentMethodUnavailableError);
    },
  );

  it("refuses a card Stripe doesn't have, and rethrows any other Stripe error", async () => {
    vi.spyOn(customerRepo, "get").mockResolvedValue("cus_123");
    const service = new StoredPaymentMethodsService(mockedAppConfigRepo, customerRepo);

    stripe.paymentMethods.retrieve.mockRejectedValueOnce(
      Object.assign(new Error("No such PaymentMethod"), { code: "resource_missing" }),
    );
    await expect(
      service.resolveForPayment({ ...context, paymentMethodId: "pm_gone" }),
    ).rejects.toBeInstanceOf(StoredPaymentMethodUnavailableError);
    stripe.paymentMethods.retrieve.mockRejectedValueOnce(
      Object.assign(new Error("Connection reset"), { type: "StripeConnectionError" }),
    );
    const transport = await service
      .resolveForPayment({ ...context, paymentMethodId: "pm_owned" })
      .catch((error: unknown) => error);

    expect(transport).not.toBeInstanceOf(StoredPaymentMethodUnavailableError);
    expect(transport).toMatchObject({ message: "Connection reset" });
  });

  it("refuses a method of the customer that isn't a card", async () => {
    vi.spyOn(customerRepo, "get").mockResolvedValue("cus_123");
    stripe.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_bank",
      type: "us_bank_account",
      customer: "cus_123",
    });
    const service = new StoredPaymentMethodsService(mockedAppConfigRepo, customerRepo);

    await expect(
      service.resolveForPayment({ ...context, paymentMethodId: "pm_bank" }),
    ).rejects.toThrow("The payment method isn't a card");
  });

  it("rejects a customer without a saved-payment mapping", async () => {
    vi.spyOn(customerRepo, "get").mockResolvedValue(null);
    const service = new StoredPaymentMethodsService(mockedAppConfigRepo, customerRepo);

    await expect(
      service.resolveForPayment({ ...context, paymentMethodId: "pm_owned" }),
    ).rejects.toThrow("The customer has no Stripe customer");
    expect(stripe.paymentMethods.retrieve).not.toHaveBeenCalled();
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
    stripe.paymentMethods.list.mockResolvedValue({
      data: [{ id: "pm_123", created: 100, card: { fingerprint: "fp_visa" } }],
    });
    const service = new StoredPaymentMethodsService(mockedAppConfigRepo, customerRepo);

    await expect(
      service.processMethod({ ...context, setupIntentId: "seti_123" }),
    ).resolves.toStrictEqual({
      id: "pm_123",
      result: "SUCCESSFULLY_TOKENIZED",
    });
  });

  it("keeps the newly saved card and detaches earlier copies of the same card", async () => {
    vi.spyOn(customerRepo, "get").mockResolvedValue("cus_123");
    stripe.setupIntents.retrieve.mockResolvedValue({
      id: "seti_456",
      customer: "cus_123",
      status: "succeeded",
      payment_method: "pm_new",
    });
    stripe.paymentMethods.list.mockResolvedValue({
      data: [
        { id: "pm_new", created: 300, card: { fingerprint: "fp_visa", last4: "4242" } },
        { id: "pm_other", created: 200, card: { fingerprint: "fp_mastercard", last4: "4444" } },
        { id: "pm_old", created: 100, card: { fingerprint: "fp_visa", last4: "4242" } },
      ],
    });
    stripe.paymentMethods.detach.mockReset().mockResolvedValue({ id: "pm_old" });
    const service = new StoredPaymentMethodsService(mockedAppConfigRepo, customerRepo);

    await expect(
      service.processMethod({ ...context, setupIntentId: "seti_456" }),
    ).resolves.toStrictEqual({ id: "pm_new", result: "SUCCESSFULLY_TOKENIZED" });
    expect(stripe.paymentMethods.list).toHaveBeenCalledWith({
      customer: "cus_123",
      type: "card",
      limit: 100,
    });
    expect(stripe.paymentMethods.detach).toHaveBeenCalledTimes(1);
    expect(stripe.paymentMethods.detach).toHaveBeenCalledWith("pm_old");
  });

  it("keeps a later copy saved at the same time, and reports a replaced card as not saved", async () => {
    vi.spyOn(customerRepo, "get").mockResolvedValue("cus_123");
    stripe.setupIntents.retrieve.mockResolvedValue({
      id: "seti_first",
      customer: "cus_123",
      status: "succeeded",
      payment_method: "pm_first",
    });
    // Another save of the same card finished in between: its copy is newer.
    stripe.paymentMethods.list.mockResolvedValue({
      data: [
        { id: "pm_second", created: 200, card: { fingerprint: "fp_visa" } },
        { id: "pm_first", created: 100, card: { fingerprint: "fp_visa" } },
      ],
    });
    stripe.paymentMethods.detach.mockReset();
    const service = new StoredPaymentMethodsService(mockedAppConfigRepo, customerRepo);

    await expect(
      service.processMethod({ ...context, setupIntentId: "seti_first" }),
    ).resolves.toStrictEqual({ id: "pm_first", result: "SUCCESSFULLY_TOKENIZED" });
    expect(stripe.paymentMethods.detach).not.toHaveBeenCalled();
    // Processed again after the newer save detached it.
    stripe.paymentMethods.list.mockResolvedValue({
      data: [{ id: "pm_second", created: 200, card: { fingerprint: "fp_visa" } }],
    });
    await expect(
      service.processMethod({ ...context, setupIntentId: "seti_first" }),
    ).resolves.toStrictEqual({
      result: "FAILED_TO_TOKENIZE",
      error: "A newer copy of this card was saved",
    });
  });

  it("still reports the saved card when the earlier copies cannot be cleaned up", async () => {
    vi.spyOn(customerRepo, "get").mockResolvedValue("cus_123");
    stripe.setupIntents.retrieve.mockResolvedValue({
      id: "seti_789",
      customer: "cus_123",
      status: "succeeded",
      payment_method: "pm_new",
    });
    stripe.paymentMethods.list.mockRejectedValueOnce(new Error("Stripe unavailable"));
    stripe.paymentMethods.detach.mockReset();
    const service = new StoredPaymentMethodsService(mockedAppConfigRepo, customerRepo);

    await expect(
      service.processMethod({ ...context, setupIntentId: "seti_789" }),
    ).resolves.toStrictEqual({ id: "pm_new", result: "SUCCESSFULLY_TOKENIZED" });
    expect(stripe.paymentMethods.detach).not.toHaveBeenCalled();
  });
});
