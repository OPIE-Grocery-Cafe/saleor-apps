import { vi } from "vitest";

vi.stubEnv("SECRET_KEY", "test_secret_key");
vi.stubEnv("COMMERCE_DATABASE_URL", "postgresql://test:test@localhost:5432/opie_commerce");

/**
 * Add test setup logic here
 *
 * https://vitest.dev/config/#setupfiles
 */
export {};
