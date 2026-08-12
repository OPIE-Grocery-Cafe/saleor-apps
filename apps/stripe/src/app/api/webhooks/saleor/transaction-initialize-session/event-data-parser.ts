import { err, ok } from "neverthrow";
import { z } from "zod";

import { BaseError } from "@/lib/errors";
import { ApplePayPaymentMethod } from "@/modules/stripe/payment-methods/apple-pay";
import { CardPaymentMethod } from "@/modules/stripe/payment-methods/card";
import { GooglePayPaymentMethod } from "@/modules/stripe/payment-methods/google-pay";

const TransactionInitializeEventDataSchema = z
  .object({
    paymentIntent: z.discriminatedUnion("paymentMethod", [
      CardPaymentMethod.TransactionInitializeSchema,
      GooglePayPaymentMethod.TransactionInitializeSchema,
      ApplePayPaymentMethod.TransactionInitializeSchema,
    ]),
  })
  .strict()
  .brand("TransactionInitializeRequestData");

export const ParseErrorPublicCode = "ParseError" as const;
export const UnsupportedPaymentMethodErrorPublicCode = "UnsupportedPaymentMethodError" as const;

export const ParseError = BaseError.subclass("ParseError", {
  props: {
    _internalName: "TransactionInitializeEventDataParseError" as const,
    publicCode: ParseErrorPublicCode,
    publicMessage:
      "Provided data is invalid. Check your data argument to transactionInitializeSession mutation and try again.",
    merchantMessage: "Payment intent not created - storefront sent invalid data",
  },
});

export const UnsupportedPaymentMethodError = ParseError.subclass("UnsupportedPaymentMethodError", {
  props: {
    _internalName: "TransactionInitializeEventDataUnsupportedPaymentMethodError" as const,
    publicCode: UnsupportedPaymentMethodErrorPublicCode,
    publicMessage: "Provided payment method is not supported",
    merchantMessage: "Payment intent not created - provided payment method is not supported",
  },
});

export const parseTransactionInitializeSessionEventData = (raw: unknown) => {
  const parsingResult = TransactionInitializeEventDataSchema.safeParse(raw);

  if (parsingResult.success) {
    return ok(parsingResult.data);
  }

  const hasInvalidUnionDiscriminator = parsingResult.error.issues.some(
    (issue) => issue.code === "invalid_union_discriminator",
  );

  if (hasInvalidUnionDiscriminator) {
    const attemptedMethod =
      raw != null &&
      typeof raw === "object" &&
      "paymentIntent" in raw &&
      raw.paymentIntent != null &&
      typeof raw.paymentIntent === "object" &&
      "paymentMethod" in raw.paymentIntent &&
      typeof raw.paymentIntent.paymentMethod === "string"
        ? raw.paymentIntent.paymentMethod
        : "unknown";

    return err(
      new UnsupportedPaymentMethodError("Payment method is not supported", {
        cause: parsingResult.error,
        props: {
          data: raw,
          publicMessage: `Payment method "${attemptedMethod}" is not supported. Contact Saleor for assistance.`,
          merchantMessage: `Payment intent not created - payment method "${attemptedMethod}" is not supported`,
        },
      }),
    );
  }

  return err(new ParseError("Invalid data", { cause: parsingResult.error }));
};

export type TransactionInitializeSessionEventData = z.infer<
  typeof TransactionInitializeEventDataSchema
>;

export type TransactionInitializeSessionEventDataError =
  | InstanceType<typeof ParseError>
  | InstanceType<typeof UnsupportedPaymentMethodError>;
