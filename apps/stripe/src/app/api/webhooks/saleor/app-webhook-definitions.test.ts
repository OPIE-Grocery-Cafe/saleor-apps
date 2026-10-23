/*
 * @vitest-environment node
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { appWebhookDefinitions } from "./app-webhook-definitions";

describe("appWebhookDefinitions", () => {
  it("names every Saleor webhook route, so the migration script never removes one", () => {
    const routes = readdirSync(__dirname, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(__dirname, entry.name, "route.ts")))
      .map((entry) => `https://app.example/api/webhooks/saleor/${entry.name}`)
      .sort();
    const targets = appWebhookDefinitions
      .map((definition) => definition.getWebhookManifest("https://app.example").targetUrl)
      .sort();

    expect(targets).toStrictEqual(routes);
    expect(routes).toContain("https://app.example/api/webhooks/saleor/list-stored-payment-methods");
  });
});
