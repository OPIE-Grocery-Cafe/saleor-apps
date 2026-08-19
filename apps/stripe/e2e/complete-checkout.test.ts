import { expect, test } from "@playwright/test";

import { SaleorApi } from "./api/saleor-api";
import { env } from "./env";
import { StripeCheckoutFormPage } from "./pages/stripe-checkout-form-page";

test("Complete checkout with transactionFlowStrategy: charge", async ({ request, page }) => {
  const saleorApi = new SaleorApi(request);
  const stripeCheckoutFormPage = new StripeCheckoutFormPage(page);

  const checkout = await saleorApi.createCheckout({
    channelSlug: env.E2E_CHARGE_CHANNEL_SLUG,
  });

  const publishableKey = await saleorApi.initializePaymentGateway({ checkoutId: checkout.id });

  await stripeCheckoutFormPage.initialize({
    publishableKey,
    amount: checkout.amount,
    currency: checkout.currency,
  });
  await stripeCheckoutFormPage.fillPaymentInformation();
  const paymentMethodId = await stripeCheckoutFormPage.createPaymentMethod();
  const transaction = await saleorApi.initializeTransaction({
    checkoutId: checkout.id,
    amount: checkout.amount,
    expectedFlow: "CHARGE",
  });

  await stripeCheckoutFormPage.confirmPayment({
    clientSecret: transaction.clientSecret,
    paymentMethodId,
  });
  expect(await saleorApi.processTransaction({ transactionId: transaction.transactionId })).toBe(
    "CHARGE_SUCCESS",
  );

  const order = await saleorApi.completeCheckout({
    checkoutId: checkout.id,
  });

  expect(order.id, "order.id").toBeDefined();
  expect(order.status, "order.status").toBe("UNFULFILLED");
  expect(order.chargeStatus, "order.chargeStatus").toBe("FULL");
  expect(order.paymentStatus, "order.paymentStatus").toBe("FULLY_CHARGED");
  expect(order.authorizeStatus, "order.authorizeStatus").toBe("FULL");
});

// baseUrl is set here so t3-oss/env-nextjs can be used in the test
test.use({ baseURL: env.E2E_BASE_URL });

test("Complete checkout with transactionFlowStrategy: authorize", async ({ request, page }) => {
  const saleorApi = new SaleorApi(request);
  const stripeCheckoutFormPage = new StripeCheckoutFormPage(page);

  const checkout = await saleorApi.createCheckout({
    channelSlug: env.E2E_AUTHORIZATION_CHANNEL_SLUG,
  });

  const publishableKey = await saleorApi.initializePaymentGateway({ checkoutId: checkout.id });

  await stripeCheckoutFormPage.initialize({
    publishableKey,
    amount: checkout.amount,
    currency: checkout.currency,
  });
  await stripeCheckoutFormPage.fillPaymentInformation();
  const paymentMethodId = await stripeCheckoutFormPage.createPaymentMethod();
  const transaction = await saleorApi.initializeTransaction({
    checkoutId: checkout.id,
    amount: checkout.amount,
    expectedFlow: "AUTHORIZATION",
  });

  await stripeCheckoutFormPage.confirmPayment({
    clientSecret: transaction.clientSecret,
    paymentMethodId,
  });
  expect(await saleorApi.processTransaction({ transactionId: transaction.transactionId })).toBe(
    "AUTHORIZATION_SUCCESS",
  );

  const order = await saleorApi.completeCheckout({
    checkoutId: checkout.id,
  });

  expect(order.id, "order.id").toBeDefined();
  expect(order.status, "order.status").toBe("UNFULFILLED");
  expect(order.chargeStatus, "order.chargeStatus").toBe("NONE");
  expect(order.paymentStatus, "order.paymentStatus").toBe("NOT_CHARGED");
  expect(order.authorizeStatus, "order.authorizeStatus").toBe("FULL");
});
