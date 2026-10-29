import { AppError } from "@agent-desk/contracts";

/** Persist only a fixed diagnostic category. Native error text can contain
 * response bodies, URLs and credentials, so it must never become UI/log text. */
export function runtimeFailure(error: unknown, cancelled = false): AppError {
  if (error instanceof AppError) return error;
  const native =
    error && typeof error === "object"
      ? (error as { code?: unknown; name?: unknown })
      : undefined;
  if (cancelled || native?.name === "AbortError")
    return new AppError(
      "runtime_cancelled",
      "本机 Agent 请求已取消，未自动重试。",
      502,
    );
  if (
    native?.name === "TimeoutError" ||
    native?.code === "ETIMEDOUT" ||
    native?.code === "UND_ERR_HEADERS_TIMEOUT" ||
    native?.code === "UND_ERR_BODY_TIMEOUT"
  )
    return new AppError(
      "runtime_timeout",
      "与 OpenCode 的本机连接超时，未自动重试任务。",
      502,
    );
  if (
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "EPIPE",
      "ConnectionClosed",
      "SocketClosed",
    ].includes(String(native?.code))
  )
    return new AppError(
      "runtime_disconnected",
      "与 OpenCode 的本机连接中断，未自动重试任务。",
      502,
    );
  if (error instanceof SyntaxError)
    return new AppError(
      "runtime_protocol",
      "OpenCode 返回了无效响应，未自动重试任务。",
      502,
    );
  return new AppError(
    "runtime_transport",
    "本机 Agent 请求失败，未自动重试；请核对运行进程。",
    502,
  );
}
