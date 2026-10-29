import { expect, test } from "bun:test";
import { agentAvailability, agentInventory } from "./agents";
import type { PublicProfile } from "@agent-desk/contracts";

test("device, API and workflow availability retain missing CLIs without presenting them as executable", () => {
  const agents = agentInventory([
    { cli: "opencode", name: "OpenCode", installed: true, supported: true },
  ]);
  expect(agents.find((item) => item.cli === "claude")?.installed).toBe(false);
  expect(agents.find((item) => item.cli === "dsh")?.installed).toBe(false);
  const profile: PublicProfile = {
    cli: "opencode",
    protocol: "anthropic",
    baseUrl: "https://example.invalid/v1",
    model: "mock",
    hasApiKey: true,
  };
  expect(agentAvailability(agents[0], []).ready).toBe(false);
  expect(agentAvailability(agents[0], [profile]).ready).toBe(true);
  expect(
    agentAvailability(agents[0], [{ ...profile, hasApiKey: false }]).ready,
  ).toBe(false);
  const claude = agents.find((item) => item.cli === "claude")!;
  expect(agentAvailability(claude, [{ ...profile, cli: "claude" }]).ready).toBe(
    false,
  );
  expect(
    agentAvailability({ ...claude, installed: true }, [
      { ...profile, cli: "claude" },
    ]).label,
  ).toBe("执行未接入");
  expect(
    agentAvailability(agents.find((item) => item.cli === "codex")!, [profile])
      .configured,
  ).toBe(false);
});
