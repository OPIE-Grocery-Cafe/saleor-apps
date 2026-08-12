import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next-app-router";

import { verifyWebhookSignature } from "@/app/api/webhooks/saleor/verify-signature";
import {
  ListStoredPaymentMethodsDocument,
  type ListStoredPaymentMethodsEventFragment,
  PaymentGatewayInitializeTokenizationDocument,
  type PaymentGatewayInitializeTokenizationEventFragment,
  PaymentMethodInitializeTokenizationDocument,
  type PaymentMethodInitializeTokenizationEventFragment,
  PaymentMethodProcessTokenizationDocument,
  type PaymentMethodProcessTokenizationEventFragment,
  StoredPaymentMethodDeleteRequestedDocument,
  type StoredPaymentMethodDeleteRequestedEventFragment,
} from "@/generated/graphql";
import { saleorApp } from "@/lib/saleor-app";

const verification = (
  jwks: Parameters<typeof verifyWebhookSignature>[0],
  signature: string,
  rawBody: string,
) => verifyWebhookSignature(jwks, signature, rawBody);

export const paymentGatewayInitializeTokenizationDefinition =
  new SaleorSyncWebhook<PaymentGatewayInitializeTokenizationEventFragment>({
    apl: saleorApp.apl,
    event: "PAYMENT_GATEWAY_INITIALIZE_TOKENIZATION_SESSION",
    name: "Stripe Payment Gateway Initialize Tokenization",
    isActive: true,
    query: PaymentGatewayInitializeTokenizationDocument,
    webhookPath: "api/webhooks/saleor/payment-gateway-initialize-tokenization",
    verifySignatureFn: verification,
  });

export const paymentMethodInitializeTokenizationDefinition =
  new SaleorSyncWebhook<PaymentMethodInitializeTokenizationEventFragment>({
    apl: saleorApp.apl,
    event: "PAYMENT_METHOD_INITIALIZE_TOKENIZATION_SESSION",
    name: "Stripe Payment Method Initialize Tokenization",
    isActive: true,
    query: PaymentMethodInitializeTokenizationDocument,
    webhookPath: "api/webhooks/saleor/payment-method-initialize-tokenization",
    verifySignatureFn: verification,
  });

export const paymentMethodProcessTokenizationDefinition =
  new SaleorSyncWebhook<PaymentMethodProcessTokenizationEventFragment>({
    apl: saleorApp.apl,
    event: "PAYMENT_METHOD_PROCESS_TOKENIZATION_SESSION",
    name: "Stripe Payment Method Process Tokenization",
    isActive: true,
    query: PaymentMethodProcessTokenizationDocument,
    webhookPath: "api/webhooks/saleor/payment-method-process-tokenization",
    verifySignatureFn: verification,
  });

export const listStoredPaymentMethodsDefinition =
  new SaleorSyncWebhook<ListStoredPaymentMethodsEventFragment>({
    apl: saleorApp.apl,
    event: "LIST_STORED_PAYMENT_METHODS",
    name: "Stripe List Stored Payment Methods",
    isActive: true,
    query: ListStoredPaymentMethodsDocument,
    webhookPath: "api/webhooks/saleor/list-stored-payment-methods",
    verifySignatureFn: verification,
  });

export const storedPaymentMethodDeleteRequestedDefinition =
  new SaleorSyncWebhook<StoredPaymentMethodDeleteRequestedEventFragment>({
    apl: saleorApp.apl,
    event: "STORED_PAYMENT_METHOD_DELETE_REQUESTED",
    name: "Stripe Stored Payment Method Delete Requested",
    isActive: true,
    query: StoredPaymentMethodDeleteRequestedDocument,
    webhookPath: "api/webhooks/saleor/stored-payment-method-delete-requested",
    verifySignatureFn: verification,
  });
