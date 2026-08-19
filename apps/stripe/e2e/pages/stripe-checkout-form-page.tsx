import { expect, type Locator, type Page } from "@playwright/test";
import { env } from "e2e/env";

export class StripeCheckoutFormPage {
  private readonly page: Page;
  readonly cardNumberInput: Locator;
  readonly cardExpiryInput: Locator;
  readonly cardCvcInput: Locator;
  readonly countryInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.cardNumberInput = page
      .frameLocator('[title="Secure payment input frame"]')
      .locator('input[name="number"]');
    this.cardExpiryInput = page
      .frameLocator('[title="Secure payment input frame"]')
      .locator('input[name="expiry"]');
    this.cardCvcInput = page
      .frameLocator('[title="Secure payment input frame"]')
      .locator('input[name="cvc"]');
    this.countryInput = page
      .frameLocator('[title="Secure payment input frame"]')
      .locator('select[name="country"]');
  }

  async initialize(args: { publishableKey: string; amount: number; currency: string }) {
    await this.page.goto(env.E2E_BASE_URL);
    await this.page.setContent(`
      <!doctype html>
      <html>
        <body>
          <form id="payment-form"><div id="payment-element"></div></form>
          <script src="https://js.stripe.com/v3/"></script>
        </body>
      </html>
    `);
    await this.page.waitForFunction(() => typeof window.Stripe === "function");
    await this.page.evaluate(async ({ publishableKey, amount, currency }) => {
      const stripe = window.Stripe(publishableKey);
      const elements = stripe.elements({
        mode: "payment",
        amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        paymentMethodCreation: "manual",
      });
      const paymentElement = elements.create("payment", { layout: "tabs" });

      paymentElement.mount("#payment-element");
      window.opieStripeE2E = { stripe, elements };
    }, args);
    await expect(this.cardNumberInput).toBeVisible();
  }

  async fillPaymentInformation() {
    await this.cardNumberInput.click();
    await this.cardNumberInput.fill("4242424242424242");

    await this.cardExpiryInput.click();
    await this.cardExpiryInput.fill("01/50");

    await this.cardCvcInput.click();
    await this.cardCvcInput.fill("123");

    // Default channels are set to Poland so we need to ensure the country is set to Poland as well to avoid issues with Stripe changing countries based on IP.
    await this.countryInput.selectOption("PL");
  }

  async createPaymentMethod() {
    const result = await this.page.evaluate(async () => {
      const context = window.opieStripeE2E;

      if (!context) {
        return { error: "Stripe test context is missing" };
      }

      const submitResult = await context.elements.submit();

      if (submitResult.error) {
        return { error: submitResult.error.message ?? submitResult.error.type };
      }

      const paymentMethodResult = await context.stripe.createPaymentMethod({
        elements: context.elements,
        params: {
          billing_details: {
            name: "OPIE Stripe E2E",
            email: "saleor-app-payment-stripe-e2e-test@saleor.io",
            address: { country: "PL" },
          },
        },
      });

      return {
        error: paymentMethodResult.error?.message,
        paymentMethodId: paymentMethodResult.paymentMethod?.id,
      };
    });

    if (result.error || !result.paymentMethodId) {
      throw new Error(`Stripe payment method creation failed: ${result.error ?? "missing ID"}`);
    }

    return result.paymentMethodId;
  }

  async confirmPayment(args: { clientSecret: string; paymentMethodId: string }) {
    const result = await this.page.evaluate(async ({ clientSecret, paymentMethodId }) => {
      const context = window.opieStripeE2E;

      if (!context) {
        return { error: "Stripe test context is missing" };
      }

      const confirmResult = await context.stripe.confirmPayment({
        clientSecret,
        redirect: "if_required",
        confirmParams: {
          return_url: window.location.href,
          payment_method: paymentMethodId,
        },
      });

      return {
        error: confirmResult.error?.message,
        status: confirmResult.paymentIntent?.status,
      };
    }, args);

    if (result.error) {
      throw new Error(`Stripe confirmation failed: ${result.error}`);
    }

    expect(["requires_capture", "succeeded"]).toContain(result.status);
  }
}

declare global {
  interface Window {
    Stripe: (publishableKey: string) => {
      elements: (options: {
        mode: "payment";
        amount: number;
        currency: string;
        paymentMethodCreation: "manual";
      }) => {
        create: (
          type: "payment",
          options: { layout: "tabs" },
        ) => {
          mount: (selector: string) => void;
        };
        submit: () => Promise<{ error?: { message?: string; type: string } }>;
      };
      createPaymentMethod: (options: {
        elements: Window["opieStripeE2E"]["elements"];
        params: {
          billing_details: {
            name: string;
            email: string;
            address: { country: string };
          };
        };
      }) => Promise<{
        error?: { message?: string };
        paymentMethod?: { id: string };
      }>;
      confirmPayment: (options: {
        clientSecret: string;
        redirect: "if_required";
        confirmParams: { return_url: string; payment_method: string };
      }) => Promise<{
        error?: { message?: string };
        paymentIntent?: { status: string };
      }>;
    };
    opieStripeE2E: {
      stripe: ReturnType<Window["Stripe"]>;
      elements: ReturnType<ReturnType<Window["Stripe"]>["elements"]>;
    };
  }
}
