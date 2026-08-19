import { ok } from "neverthrow";
import { beforeEach, vi } from "vitest";

import { mockedAppConfigRepo } from "@/__tests__/mocks/app-config-repo";
import { mockedStripeConfig } from "@/__tests__/mocks/mock-stripe-config";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => void) => fn(),
}));

process.env.TZ = "UTC";

vi.stubEnv("SECRET_KEY", "test_secret_key");
vi.stubEnv("COMMERCE_DATABASE_URL", "postgresql://test:test@localhost:5432/opie_commerce");

beforeEach(() => {
  mockedAppConfigRepo.getStripeConfig.mockImplementation(async () => ok(mockedStripeConfig));
});

export {};
