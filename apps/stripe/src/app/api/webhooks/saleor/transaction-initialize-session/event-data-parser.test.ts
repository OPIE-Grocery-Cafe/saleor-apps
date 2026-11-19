import { describe, expect, it } from "vitest";

import {
  ParseError,
  parseTransactionInitializeSessionEventData,
  type TransactionInitializeSessionEventData,
  UnsupportedPaymentMethodError,
} from "./event-data-parser";

describe("parseTransactionInitializeSessionEventData", () => {
  it("accepts a saved card identifier while rejecting shopper-supplied customer ownership", () => {
    expect(
      parseTransactionInitializeSessionEventData({
        paymentIntent: {
          paymentMethod: "card",
          storedPaymentMethodId: "pm_saved123",
        },
      })._unsafeUnwrap(),
    ).toMatchObject({ paymentIntent: { storedPaymentMethodId: "pm_saved123" } });
    expect(
      parseTransactionInitializeSessionEventData({
        paymentIntent: {
          paymentMethod: "card",
          storedPaymentMethodId: "pm_saved123",
          customer: "cus_victim",
        },
      }).isErr(),
    ).toBe(true);
  });

  it.each(["", "cus_123", "pm_", "pm_bad value"])(
    "rejects invalid saved method %s",
    (storedPaymentMethodId) => {
      expect(
        parseTransactionInitializeSessionEventData({
          paymentIntent: {
            paymentMethod: "card",
            storedPaymentMethodId,
          },
        }).isErr(),
      ).toBe(true);
    },
  );
  it("should parse valid data coming from storefront", () => {
    const storefrontData = {
      paymentIntent: {
        paymentMethod: "card",
      },
    };

    const result = parseTransactionInitializeSessionEventData(storefrontData);

    expect(result._unsafeUnwrap()).toStrictEqual({
      paymentIntent: {
        paymentMethod: "card",
      },
    });
  });

  it.each(["apple_pay", "google_pay"])("parses the supported %s wallet", (paymentMethod) => {
    const result = parseTransactionInitializeSessionEventData({ paymentIntent: { paymentMethod } });

    expect(result._unsafeUnwrap()).toStrictEqual({ paymentIntent: { paymentMethod } });
  });

  it.each(["link", "klarna", "paypal", "us_bank_account", "sepa_debit"])(
    "rejects the non-launch payment method %s",
    (paymentMethod) => {
      const result = parseTransactionInitializeSessionEventData({
        paymentIntent: { paymentMethod },
      });

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnsupportedPaymentMethodError);
    },
  );

  it("should return UnsupportedPaymentMethodError if storefront sends unsupported payment method", () => {
    const storefrontData = {
      paymentIntent: {
        paymentMethod: "my-pay",
      },
    };

    const result = parseTransactionInitializeSessionEventData(storefrontData);

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnsupportedPaymentMethodError);
    expect(result._unsafeUnwrapErr().publicMessage).toBe(
      'Payment method "my-pay" is not supported. Contact Saleor for assistance.',
    );
  });

  it("should return ParseError if storefront sends additional field we dont support for card payment method", () => {
    const storefrontData = {
      paymentIntent: {
        paymentMethod: "card",
        additionalField: "invalidValue",
      },
    };
    const result = parseTransactionInitializeSessionEventData(storefrontData);

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ParseError);
  });

  it("should return ParseError is storefront sends additional field we dont support", () => {
    const storefrontData = {
      paymentIntent: {
        paymentMethod: "card",
      },
      additionalField: "invalidValue",
    };
    const result = parseTransactionInitializeSessionEventData(storefrontData);

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ParseError);
  });

  it("shouldn't be assignable without createFromTransactionInitalizeSessionData", () => {
    // @ts-expect-error - if this fails - it means the type is not branded
    const testValue: TransactionInitializeSessionEventData = {};

    expect(testValue).toStrictEqual({});
  });
});
