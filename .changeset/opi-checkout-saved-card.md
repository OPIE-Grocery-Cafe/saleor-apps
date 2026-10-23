---
"saleor-app-payment-stripe": minor
---

Allow shoppers to pay with an existing saved card at checkout. Verify the card belongs to the checkout customer before creating an authorization, while retaining interactive authentication and manual capture.

Saving a card the customer already saved keeps only the new copy. The webhook migration script now registers every webhook in the manifest (it used to remove the five saved-card webhooks), and must be run once on each installation so the transaction-initialize subscription includes the checkout's customer.
