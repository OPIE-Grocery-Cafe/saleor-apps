# OPIE Railway PostgreSQL Migration

Stripe and SMTP can run on PostgreSQL while their DynamoDB repositories remain
available for the 14-day rollback window.

## Release order

1. Provision `opie_commerce`, its isolated roles/schemas, PgBouncer in
   transaction mode, and PITR.
2. Run `pnpm provision:commerce-roles` with an administrative direct URL.
3. Run `stripe-db-migrate` and `smtp-db-migrate` with their schema-owner direct
   URLs. Runtime apps use role-specific PgBouncer URLs.
4. Deploy the apps with `PERSISTENCE_BACKEND=dynamodb` before cutover so the
   release is rollback-compatible.
5. Before any restart of the live in-memory DynamoDB service, run:

   ```sh
   pnpm migrate:dynamo-postgres inventory
   pnpm migrate:dynamo-postgres migrate
   pnpm migrate:dynamo-postgres verify
   ```

6. Switch SMTP and then Stripe to `APL=postgres` and
   `PERSISTENCE_BACKEND=postgres`, requiring `/api/health/ready` to pass.

The migration tool partitions a shared DynamoDB table using `STRIPE_APP_ID` and
`SMTP_APP_ID`, aborts on unknown/malformed records or duplicate identities,
encrypts plaintext APL tokens, logs only keyed checksums, and verifies the tokens
with a harmless Saleor query. `VERIFY_SALEOR_TOKENS=false` is test-fixture-only.

After PostgreSQL accepts writes, rollback requires pausing new payments,
draining webhooks, running `export-for-rollback`, verifying semantic parity, and
only then switching the backend. Do not dual-write.

After 14 green days, remove the Dynamo repositories, AWS dependencies and
variables, DynamoDB Local service, and compatibility flags in a separate
contract release.
