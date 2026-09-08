import type Stripe from "stripe";

const RESUMABLE_STATES = new Set<Stripe.PaymentIntent.Status>([
  "requires_action",
  "requires_confirmation",
]);

export function paymentIntentResumeSecret(
  intent: Pick<Stripe.PaymentIntent, "status" | "client_secret">,
): string | null {
  return RESUMABLE_STATES.has(intent.status) && intent.client_secret ? intent.client_secret : null;
}
