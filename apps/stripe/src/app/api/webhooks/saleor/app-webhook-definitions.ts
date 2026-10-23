import { paymentGatewayInitializeSessionWebhookDefinition } from "./payment-gateway-initialize-session/webhook-definition";
import {
  listStoredPaymentMethodsDefinition,
  paymentGatewayInitializeTokenizationDefinition,
  paymentMethodInitializeTokenizationDefinition,
  paymentMethodProcessTokenizationDefinition,
  storedPaymentMethodDeleteRequestedDefinition,
} from "./stored-payment-methods/webhook-definitions";
import { transactionCancelationRequestedWebhookDefinition } from "./transaction-cancelation-requested/webhook-definition";
import { transactionChargeRequestedWebhookDefinition } from "./transaction-charge-requested/webhook-definition";
import { transactionInitializeSessionWebhookDefinition } from "./transaction-initialize-session/webhook-definition";
import { transactionProcessSessionWebhookDefinition } from "./transaction-process-session/webhook-definition";
import { transactionRefundRequestedWebhookDefinition } from "./transaction-refund-requested/webhook-definition";

/**
 * Every Saleor webhook the app registers, in manifest order. The manifest and the webhook migration
 * script both read this list: the migration removes any installed webhook it does not name, so a webhook
 * missing here would be deleted from every installation the next time it runs.
 */
export const appWebhookDefinitions = [
  paymentGatewayInitializeSessionWebhookDefinition,
  transactionInitializeSessionWebhookDefinition,
  transactionProcessSessionWebhookDefinition,
  transactionChargeRequestedWebhookDefinition,
  transactionCancelationRequestedWebhookDefinition,
  transactionRefundRequestedWebhookDefinition,
  paymentGatewayInitializeTokenizationDefinition,
  paymentMethodInitializeTokenizationDefinition,
  paymentMethodProcessTokenizationDefinition,
  listStoredPaymentMethodsDefinition,
  storedPaymentMethodDeleteRequestedDefinition,
] as const;
