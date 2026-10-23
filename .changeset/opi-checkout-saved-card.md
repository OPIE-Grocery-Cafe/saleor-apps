---
"saleor-app-payment-stripe": minor
---

Allow shoppers to pay with an existing saved card at checkout. The card must be attached to the Stripe customer of the checkout's signed-in customer (taken from Saleor's signed webhook); the PaymentIntent is created with that customer and card and keeps manual capture and interactive authentication. Saved cards pay only for checkouts, not orders. A card the app won't use is refused before any PaymentIntent exists, with the public code `StoredPaymentMethodUnavailableError`, and the reason is logged.

Saving a card the customer already saved detaches the earlier copies of it and keeps the new one.

The webhook migration script now registers every webhook in the manifest (it used to remove the five saved-card webhooks) and skips an installation with no app URL instead of removing its webhooks. Run it once on each installation so the transaction-initialize subscription includes the checkout's customer; until then saved-card payments are refused and logged.
