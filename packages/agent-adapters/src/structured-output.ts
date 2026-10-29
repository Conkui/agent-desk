import { AppError, type Profile } from "@agent-desk/contracts";

/** DeepSeek thinking rejects forced tool_choice. Keep thinking and validate a text JSON plan instead. */
export function usesTextPlan(profile: Profile) {
  return (
    profile.protocol === "openai-compatible" &&
    new URL(profile.baseUrl).hostname === "api.deepseek.com"
  );
}
export function parseTextPlan(text: string): unknown {
  const value = text
    .trim()
    .replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1");
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError(
      "invalid_plan",
      "编排器未返回有效的 JSON 计划，未启动工作节点。",
      502,
    );
  }
}
/** Do not persist upstream response bodies/headers, which may echo credentials. */
export function providerFailure(error: unknown): AppError {
  const data = (
    error && typeof error === "object"
      ? (error as { data?: unknown }).data
      : null
  ) as { statusCode?: unknown; message?: unknown } | null;
  const status =
    typeof data?.statusCode === "number" ? data.statusCode : undefined;
  const message = typeof data?.message === "string" ? data.message : "";
  if (status === 400 && /thinking mode.*tool_choice/i.test(message))
    return new AppError(
      "thinking_tool_choice",
      "模型不接受思考模式下的强制工具选择（HTTP 400：tool_choice）。",
      502,
    );
  const detail =
    status === 401 || status === 403
      ? "API 认证或访问权限被拒绝"
      : status === 402
        ? "模型服务额度不足"
        : status === 429
          ? "模型服务请求限流"
          : status === 400
            ? "模型服务拒绝了请求参数"
            : "模型服务返回错误";
  return new AppError(
    "provider_error",
    `${detail}${status ? `（HTTP ${status}）` : ""}，未自动重试任务。`,
    502,
  );
}
