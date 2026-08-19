import { mkdir, rm } from "node:fs/promises";

await rm("./test-results/stripe-integration.json", { force: true });
await rm("./test-results/stripe-integration-count.txt", { force: true });
await mkdir("./test-results", { recursive: true });
