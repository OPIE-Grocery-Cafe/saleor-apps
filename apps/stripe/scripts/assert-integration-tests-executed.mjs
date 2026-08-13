/* global process */
import { readFile, writeFile } from "node:fs/promises";

const reportPath = process.argv[2];

if (!reportPath) {
  throw new Error("Pass the Vitest JSON report path");
}

const report = JSON.parse(await readFile(reportPath, "utf8"));
const executed = Number(report.numTotalTests ?? 0);

if (!Number.isInteger(executed) || executed < 1) {
  throw new Error(`Stripe integration gate executed ${executed || 0} tests`);
}

process.stdout.write(`Stripe integration gate executed ${executed} tests\n`);
await writeFile("./test-results/stripe-integration-count.txt", `${executed}\n`, "utf8");
