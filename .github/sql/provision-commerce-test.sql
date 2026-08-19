\set ON_ERROR_STOP on

CREATE ROLE stripe_migrator LOGIN PASSWORD 'stripe-migrator-test';
CREATE ROLE stripe_runtime LOGIN PASSWORD 'stripe-runtime-test';
CREATE ROLE smtp_migrator LOGIN PASSWORD 'smtp-migrator-test';
CREATE ROLE smtp_runtime LOGIN PASSWORD 'smtp-runtime-test';

REVOKE CREATE, TEMPORARY ON DATABASE opie_commerce FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA stripe AUTHORIZATION stripe_migrator;
CREATE SCHEMA smtp AUTHORIZATION smtp_migrator;

GRANT CONNECT ON DATABASE opie_commerce TO stripe_migrator, stripe_runtime, smtp_migrator, smtp_runtime;
