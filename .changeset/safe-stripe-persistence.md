---
"saleor-app-payment-stripe": patch
"saleor-app-smtp": patch
"@saleor/sentry-utils": patch
---

Harden Stripe and SMTP persistence operations by scrubbing secrets from Sentry events, disabling local-variable capture, validating every required restricted-key permission, and compensating orphaned Stripe webhooks when configuration creation fails.
