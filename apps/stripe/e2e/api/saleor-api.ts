import { type TypedDocumentNode } from "@graphql-typed-document-node/core";
import { type APIRequestContext } from "@playwright/test";
import { env } from "e2e/env";
import {
  CheckoutCompleteDocument,
  CheckoutCreateDocument,
  CheckoutDeliveryMethodUpdateDocument,
  FetchProductDocument,
  PaymentGatewayInitializeDocument,
  TransactionInitializeDocument,
  TransactionProcessDocument,
} from "e2e/generated/graphql";
import { print } from "graphql";

export class SaleorApi {
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  private async callGraphqlApi<TResult, TVariables>(
    ast: TypedDocumentNode<TResult, TVariables>,
    ...[variables]: TVariables extends Record<string, never> ? [] : [TVariables]
  ): Promise<{ data: TResult }> {
    const response = await this.request.post(env.E2E_SALEOR_API_URL, {
      data: {
        query: print(ast),
        variables,
      },
    });

    const result = (await response.json()) as {
      data?: TResult;
      errors?: Array<{ message?: string }>;
    };

    if (!response.ok() || result.errors?.length || !result.data) {
      throw new Error(
        `Saleor GraphQL request failed (${response.status()}): ${JSON.stringify(result.errors)}`,
      );
    }

    return { data: result.data };
  }

  private fetchProductVariant(channelSlug: string) {
    return this.callGraphqlApi(FetchProductDocument, {
      channelSlug,
      sku: env.E2E_PRODUCT_VARIANT_SKU,
    });
  }

  private updateCheckoutDeliveryMethod(args: { deliveryMethodId: string; checkoutId: string }) {
    return this.callGraphqlApi(CheckoutDeliveryMethodUpdateDocument, {
      deliveryMethodId: args.deliveryMethodId,
      checkoutId: args.checkoutId,
    });
  }

  async createCheckout(args: { channelSlug: string }) {
    const productResponse = await this.fetchProductVariant(args.channelSlug);

    const variant = productResponse.data.productVariant;
    const variantId = variant?.id;

    if (!variantId || !variant.sku?.trim() || !variant.product.isAvailableForPurchase) {
      throw new Error(
        `Configured contractual SKU ${env.E2E_PRODUCT_VARIANT_SKU} is unavailable in ${args.channelSlug}`,
      );
    }

    const createCheckoutResponse = await this.callGraphqlApi(CheckoutCreateDocument, {
      channelSlug: args.channelSlug,
      variantId,
      email: "saleor-app-payment-stripe-e2e-test@saleor.io",
    });

    const checkoutId = createCheckoutResponse.data.checkoutCreate?.checkout?.id;

    if (!checkoutId) {
      throw new Error("Checkout creation failed");
    }

    const deliveryMethodId =
      createCheckoutResponse.data.checkoutCreate?.checkout?.shippingMethods[0].id;

    if (!deliveryMethodId) {
      throw new Error("No delivery method found");
    }

    const deliveryMethodResponse = await this.updateCheckoutDeliveryMethod({
      deliveryMethodId,
      checkoutId,
    });

    const total =
      deliveryMethodResponse.data.checkoutDeliveryMethodUpdate?.checkout?.totalPrice?.gross;

    if (!total) {
      throw new Error("Checkout total is missing");
    }

    return {
      id: checkoutId,
      amount: Number(total.amount),
      currency: total.currency,
    };
  }

  async initializePaymentGateway(args: { checkoutId: string }) {
    const response = await this.callGraphqlApi(PaymentGatewayInitializeDocument, {
      checkoutId: args.checkoutId,
      paymentGateways: [{ id: "saleor.app.payment.stripe" }],
    });
    const result = response.data.paymentGatewayInitialize;

    if (!result || result.errors.length > 0) {
      throw new Error(`Payment gateway initialization failed: ${JSON.stringify(result?.errors)}`);
    }

    const config = result.gatewayConfigs?.find(
      (gatewayConfig) => gatewayConfig.id === "saleor.app.payment.stripe",
    );
    const data = config?.data as { stripePublishableKey?: unknown } | null | undefined;

    if (config?.errors?.length || typeof data?.stripePublishableKey !== "string") {
      throw new Error(`Stripe gateway configuration is invalid: ${JSON.stringify(config?.errors)}`);
    }

    return data.stripePublishableKey;
  }

  async initializeTransaction(args: {
    checkoutId: string;
    amount: number;
    expectedFlow: "CHARGE" | "AUTHORIZATION";
  }) {
    const response = await this.callGraphqlApi(TransactionInitializeDocument, {
      checkoutId: args.checkoutId,
      amount: args.amount,
      idempotencyKey: `stripe-e2e-${args.expectedFlow.toLowerCase()}-${args.checkoutId}`,
      paymentGateway: {
        id: "saleor.app.payment.stripe",
        data: { paymentIntent: { paymentMethod: "card" } },
      },
    });
    const result = response.data.transactionInitialize;

    if (!result || result.errors.length > 0) {
      throw new Error(`Transaction initialization failed: ${JSON.stringify(result?.errors)}`);
    }

    const data = result.data as
      | { paymentIntent?: { stripeClientSecret?: unknown } }
      | null
      | undefined;
    const transactionId = result.transaction?.id;
    const clientSecret = data?.paymentIntent?.stripeClientSecret;

    if (!transactionId || typeof clientSecret !== "string") {
      throw new Error("Transaction initialization did not return a transaction and client secret");
    }

    return { transactionId, clientSecret };
  }

  async processTransaction(args: { transactionId: string }) {
    const response = await this.callGraphqlApi(TransactionProcessDocument, {
      transactionId: args.transactionId,
    });
    const result = response.data.transactionProcess;

    if (!result || result.errors.length > 0 || !result.transactionEvent) {
      throw new Error(`Transaction processing failed: ${JSON.stringify(result?.errors)}`);
    }

    return result.transactionEvent.type;
  }

  async completeCheckout(args: { checkoutId: string }) {
    const completeCheckoutResponse = await this.callGraphqlApi(CheckoutCompleteDocument, {
      checkoutId: args.checkoutId,
    });

    const order = completeCheckoutResponse.data.checkoutComplete?.order;

    if (!order) {
      throw new Error(
        `Checkout completion failed: ${JSON.stringify(
          completeCheckoutResponse.data.checkoutComplete?.errors,
        )}`,
      );
    }

    return order;
  }
}
