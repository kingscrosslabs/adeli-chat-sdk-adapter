import { ValidationError } from "@chat-adapter/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdeliAdapter } from "./adapter";
import { createAdeliAdapter } from "./factory";

describe("createAdeliAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ADELI_API_KEY;
    delete process.env.ADELI_WEBHOOK_SECRET;
    delete process.env.ADELI_PROFILE_ID;
    delete process.env.ADELI_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates an adapter from explicit config", () => {
    const adapter = createAdeliAdapter({ apiKey: "adeli_sk_x", webhookSecret: "whsec_x", userName: "shopbot" });
    expect(adapter).toBeInstanceOf(AdeliAdapter);
    expect(adapter.name).toBe("adeli");
    expect(adapter.userName).toBe("shopbot");
  });

  it("defaults the user name", () => {
    expect(createAdeliAdapter({ apiKey: "adeli_sk_x", webhookSecret: "whsec_x" }).userName).toBe("adeli-bot");
  });

  it("accepts resolver functions for both credentials", () => {
    const adapter = createAdeliAdapter({ apiKey: () => "adeli_sk_x", webhookSecret: async () => "whsec_x" });
    expect(adapter.name).toBe("adeli");
  });

  it("reads environment variables as a fallback", () => {
    process.env.ADELI_API_KEY = "adeli_sk_env";
    process.env.ADELI_WEBHOOK_SECRET = "whsec_env";
    process.env.ADELI_PROFILE_ID = "profile_1";
    const adapter = createAdeliAdapter();
    expect(adapter.name).toBe("adeli");
    expect(adapter.getConcurrencyScope()).toBe("profile:profile_1");
  });

  it("prefers explicit config over the environment", () => {
    process.env.ADELI_PROFILE_ID = "profile_env";
    const adapter = createAdeliAdapter({ apiKey: "k", webhookSecret: "s", profileId: "profile_cfg" });
    expect(adapter.getConcurrencyScope()).toBe("profile:profile_cfg");
  });

  it("has no concurrency scope without a profile", () => {
    expect(createAdeliAdapter({ apiKey: "k", webhookSecret: "s" }).getConcurrencyScope()).toBeUndefined();
  });

  it("throws a ValidationError naming apiKey and ADELI_API_KEY", () => {
    expect(() => createAdeliAdapter({ webhookSecret: "s" })).toThrow(ValidationError);
    expect(() => createAdeliAdapter({ webhookSecret: "s" })).toThrow(/apiKey.*ADELI_API_KEY/);
  });

  it("throws a ValidationError naming webhookSecret and ADELI_WEBHOOK_SECRET", () => {
    expect(() => createAdeliAdapter({ apiKey: "k" })).toThrow(ValidationError);
    expect(() => createAdeliAdapter({ apiKey: "k" })).toThrow(/webhookSecret.*ADELI_WEBHOOK_SECRET/);
  });

  it("rejects an invalid baseURL at construction", () => {
    expect(() => createAdeliAdapter({ apiKey: "k", webhookSecret: "s", baseURL: "http://example.com" })).toThrow();
  });
});
