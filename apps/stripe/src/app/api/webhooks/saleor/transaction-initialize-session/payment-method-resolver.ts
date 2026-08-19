import { assertUnreachable } from "@/lib/assert-unreachable";
import { ApplePayPaymentMethod } from "@/modules/stripe/payment-methods/apple-pay";
import { CardPaymentMethod } from "@/modules/stripe/payment-methods/card";
import { GooglePayPaymentMethod } from "@/modules/stripe/payment-methods/google-pay";

import { type TransactionInitializeSessionEventData } from "./event-data-parser";

export const resolvePaymentMethodFromEventData = (
  eventData: TransactionInitializeSessionEventData,
) => {
  switch (eventData.paymentIntent.paymentMethod) {
    case "card":
      return new CardPaymentMethod();
    case "google_pay":
      return new GooglePayPaymentMethod();
    case "apple_pay":
      return new ApplePayPaymentMethod();
    default:
      assertUnreachable(eventData.paymentIntent);
  }
};
