import { expect, test } from "bun:test";
import { fixture } from "../../../tests/fixtures";
import { openCodeEnvironment } from "./index";
test("project profiles exclude Codex, preserve existing secrets on blank edits, and never mutate the parent environment", async () => {
  const f = await fixture();
  try {
    const profile = {
      protocol: "openai-compatible" as const,
      baseUrl: "https://model.example.invalid/v1",
      model: "test",
      apiKey: "fake-secret",
    };
    await expect(f.profiles.save("codex", profile)).rejects.toThrow("Codex");
    await expect(f.profiles.save("claude", profile)).rejects.toThrow(
      "Anthropic",
    );
    await f.profiles.save("opencode", profile);
    await f.profiles.save("opencode", { ...profile, apiKey: undefined });
    await f.profiles.save("opencode", { ...profile, apiKey: "  " });
    expect((await f.profiles.get("opencode")).apiKey).toBe("fake-secret");
    expect(JSON.stringify(await f.profiles.list())).not.toContain(
      "fake-secret",
    );
    const prior = process.env.OPENCODE_CONFIG_CONTENT;
    const env = openCodeEnvironment(profile, f.home, f.workspace);
    expect(env.OPENCODE_CONFIG_CONTENT).not.toContain("fake-secret");
    expect(process.env.OPENCODE_CONFIG_CONTENT).toBe(prior);
    expect(env.XDG_CONFIG_HOME).toStartWith(f.home);
  } finally {
    await f.close();
  }
});

test("protocol selection persists Anthropic and chooses its native SDK without treating it as OpenAI", async () => {
  const f = await fixture();
  try {
    await f.profiles.save("opencode", {
      protocol: "anthropic",
      baseUrl: "  https://anthropic.example.invalid/v1  ",
      model: "  test-claude  ",
      apiKey: "fake-secret",
    });
    const profile = await f.profiles.get("opencode");
    expect(profile.baseUrl).toBe("https://anthropic.example.invalid/v1");
    expect(profile.model).toBe("test-claude");
    const config = JSON.parse(
      openCodeEnvironment(profile, f.home, f.workspace)
        .OPENCODE_CONFIG_CONTENT!,
    );
    expect(config.provider["agent-desk"].npm).toBe("@ai-sdk/anthropic");
    expect(config.provider["agent-desk"].options.baseURL).toBe(profile.baseUrl);
    expect(JSON.stringify(config)).not.toContain("fake-secret");
    expect((await f.profiles.list())[0].protocol).toBe("anthropic");
    await f.profiles.save("claude", profile);
    await expect(f.profiles.save("dsh", profile)).rejects.toThrow("OpenAI");
    await expect(
      f.profiles.save("opencode", { ...profile, protocol: "authrapic" }),
    ).rejects.toThrow("下拉栏");
    await expect(
      f.profiles.save("opencode", {
        ...profile,
        baseUrl: "https://example.invalid/v1/messages",
      }),
    ).rejects.toThrow("基础地址");
    await expect(
      f.profiles.save("opencode", {
        ...profile,
        baseUrl: "https://example.invalid/v1/chat/completions",
      }),
    ).rejects.toThrow("基础地址");
    await expect(
      f.profiles.save("opencode", { ...profile, baseUrl: "not a url" }),
    ).rejects.toThrow("URL");
  } finally {
    await f.close();
  }
});
