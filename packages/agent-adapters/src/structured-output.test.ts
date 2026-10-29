import { expect, test } from "bun:test";
import {
  usesTextPlan,
  parseTextPlan,
  providerFailure,
} from "./structured-output";
import { PlanSchema } from "@agent-desk/contracts";

test("DeepSeek thinking uses text JSON planning while other protocols retain structured tool output", () => {
  const profile = {
    protocol: "openai-compatible" as const,
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
  };
  expect(usesTextPlan(profile)).toBe(true);
  expect(usesTextPlan({ ...profile, protocol: "anthropic" })).toBe(false);
  expect(
    usesTextPlan({
      ...profile,
      baseUrl: "https://api.deepseek.com.example.invalid",
    }),
  ).toBe(false);
  expect(PlanSchema.safeParse(parseTextPlan('{"nodes":[]}')).success).toBe(
    true,
  );
  expect(
    PlanSchema.safeParse(parseTextPlan('```json\n{"nodes":[]}\n```')).success,
  ).toBe(true);
  expect(
    PlanSchema.safeParse(
      parseTextPlan(
        '{"nodes":[{"name":"A","responsibility":"B","command":"run"}]}',
      ),
    ).success,
  ).toBe(false);
  expect(() => parseTextPlan('explanation {"nodes":[]}')).toThrow("JSON");
});
test("provider diagnostics distinguish protocol rejection, quota and credentials without exposing raw messages", () => {
  expect(
    providerFailure({
      data: {
        statusCode: 400,
        message: "Thinking mode does not support this tool_choice",
      },
    }).code,
  ).toBe("thinking_tool_choice");
  expect(
    providerFailure({ data: { statusCode: 402, message: "fake-secret" } })
      .message,
  ).toContain("额度不足");
  expect(
    providerFailure({ data: { statusCode: 401, message: "fake-secret" } })
      .message,
  ).toContain("认证");
  expect(
    providerFailure({ data: { statusCode: 400, message: "fake-secret" } })
      .message,
  ).not.toContain("fake-secret");
});
