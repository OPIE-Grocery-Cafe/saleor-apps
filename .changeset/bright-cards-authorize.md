---
"saleor-app-payment-stripe": patch
---

Buffered card authorizations now create manual-capture PaymentIntents that match deferred Stripe Elements, so checkout can authorize before the final picked total is captured.
