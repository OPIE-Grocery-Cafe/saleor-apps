import { createHash } from "node:crypto";

import type Stripe from "stripe";

import { env } from "@/lib/env";
import { type StripeConfig } from "@/modules/app-config/domain/stripe-config";
import { type AppConfigRepo } from "@/modules/app-config/repositories/app-config-repo";
import { getStripePostgresPool } from "@/modules/postgres/postgres";
import { StripeClient } from "@/modules/stripe/stripe-client";

import { type StoredPaymentAccess, StoredPaymentCustomerRepo } from "./customer-repo";

type User = { id: string; email?: string | null };
type Context = StoredPaymentAccess & { channelId: string; user: User };

export class StoredPaymentMethodsService {
  private readonly appConfigRepo: AppConfigRepo;
  private readonly customerRepo: StoredPaymentCustomerRepo;

  constructor(
    appConfigRepo: AppConfigRepo,
    customerRepo = new StoredPaymentCustomerRepo(
      env.PERSISTENCE_BACKEND === "postgres" ? getStripePostgresPool() : undefined,
    ),
  ) {
    this.appConfigRepo = appConfigRepo;
    this.customerRepo = customerRepo;
  }

  async initializeGateway(context: Context) {
    const { config } = await this.resolve(context);

    return {
      result: "SUCCESSFULLY_INITIALIZED",
      data: { stripePublishableKey: config.publishableKey },
    };
  }

  async initializeMethod(context: Context & { issuedAt?: string | null; data?: unknown }) {
    const consent = context.data as { savePaymentMethodConsent?: unknown } | null;

    if (consent?.savePaymentMethodConsent !== true) {
      return { result: "FAILED_TO_TOKENIZE", error: "Explicit saved-payment consent is required" };
    }
    const { stripe, config, access } = await this.resolve(context);
    const customerId = await this.ensureCustomer(stripe, access, context.user);
    const setupIntent = await stripe.setupIntents.create(
      {
        customer: customerId,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: {
          saleor_user_id: context.user.id,
          saleor_api_url: context.saleorApiUrl,
          saleor_app_id: context.appId,
          consent_recorded: "true",
          consent_recorded_at: context.issuedAt ?? new Date().toISOString(),
        },
      },
      {
        idempotencyKey: this.idempotencyKey(
          `setup:${context.saleorApiUrl}:${context.appId}:${context.user.id}:${
            context.issuedAt ?? "retry"
          }`,
        ),
      },
    );

    if (!setupIntent.client_secret)
      throw new Error("Stripe SetupIntent did not return a client secret");

    return {
      id: setupIntent.id,
      result: "ADDITIONAL_ACTION_REQUIRED",
      data: {
        clientSecret: setupIntent.client_secret,
        stripePublishableKey: config.publishableKey,
      },
    };
  }

  async processMethod(context: Context & { setupIntentId: string }) {
    const { stripe, access } = await this.resolve(context);
    const customerId = await this.customerRepo.get(access, context.user.id);

    if (!customerId) return { result: "FAILED_TO_TOKENIZE", error: "Stripe customer not found" };
    const setupIntent = await stripe.setupIntents.retrieve(context.setupIntentId);
    const intentCustomer =
      typeof setupIntent.customer === "string" ? setupIntent.customer : setupIntent.customer?.id;

    if (intentCustomer !== customerId)
      return { result: "FAILED_TO_TOKENIZE", error: "SetupIntent customer mismatch" };
    if (setupIntent.status === "processing") return { id: setupIntent.id, result: "PENDING" };
    if (setupIntent.status !== "succeeded" || !setupIntent.payment_method) {
      return { result: "FAILED_TO_TOKENIZE", error: `SetupIntent is ${setupIntent.status}` };
    }
    const paymentMethodId =
      typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent.payment_method.id;

    return { id: paymentMethodId, result: "SUCCESSFULLY_TOKENIZED" };
  }

  async list(context: Context) {
    const { stripe, access } = await this.resolve(context);
    const customerId = await this.customerRepo.get(access, context.user.id);

    if (!customerId) return { paymentMethods: [] };
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
      limit: 100,
    });

    return {
      paymentMethods: paymentMethods.data.flatMap((method) => {
        if (!method.card) return [];

        return [
          {
            id: method.id,
            supportedPaymentFlows: ["INTERACTIVE"],
            type: "Credit Card",
            name: `${method.card.brand} •••• ${method.card.last4}`,
            creditCardInfo: {
              brand: method.card.brand,
              lastDigits: method.card.last4,
              expMonth: method.card.exp_month,
              expYear: method.card.exp_year,
            },
          },
        ];
      }),
    };
  }

  async remove(context: Context & { paymentMethodId: string }) {
    const { stripe, access } = await this.resolve(context);
    const customerId = await this.customerRepo.get(access, context.user.id);

    if (!customerId) return { result: "FAILED_TO_DELETE", error: "Stripe customer not found" };
    const paymentMethod = await stripe.paymentMethods.retrieve(context.paymentMethodId);
    const methodCustomer =
      typeof paymentMethod.customer === "string"
        ? paymentMethod.customer
        : paymentMethod.customer?.id;

    if (methodCustomer !== customerId)
      return { result: "FAILED_TO_DELETE", error: "Payment method customer mismatch" };
    await stripe.paymentMethods.detach(context.paymentMethodId);

    return { result: "SUCCESSFULLY_DELETED" };
  }

  private async resolve(context: Context): Promise<{
    stripe: Stripe;
    config: StripeConfig;
    access: StoredPaymentAccess;
  }> {
    const result = await this.appConfigRepo.getStripeConfig({
      channelId: context.channelId,
      appId: context.appId,
      saleorApiUrl: context.saleorApiUrl,
    });

    if (result.isErr()) throw result.error;
    if (!result.value) throw new Error("Stripe channel configuration not found");

    return {
      stripe: StripeClient.createFromRestrictedKey(result.value.restrictedKey).nativeClient,
      config: result.value,
      access: { saleorApiUrl: context.saleorApiUrl, appId: context.appId },
    };
  }

  private async ensureCustomer(
    stripe: Stripe,
    access: StoredPaymentAccess,
    user: User,
  ): Promise<string> {
    const existing = await this.customerRepo.get(access, user.id);

    if (existing) return existing;
    const customer = await stripe.customers.create(
      { email: user.email ?? undefined, metadata: { saleor_user_id: user.id } },
      {
        idempotencyKey: this.idempotencyKey(
          `customer:${access.saleorApiUrl}:${access.appId}:${user.id}`,
        ),
      },
    );

    await this.customerRepo.put(access, user.id, customer.id);

    return customer.id;
  }

  private idempotencyKey(value: string): string {
    return `opie_${createHash("sha256").update(value).digest("hex")}`;
  }
}
