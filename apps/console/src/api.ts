export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T = any>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (response.status === 401)
    window.dispatchEvent(new Event("agent-desk:connection-required"));
  if (!response.ok)
    throw new RequestError(
      result.message ?? "连接失败，请重试。",
      response.status,
    );
  return result;
}
export const command = () => ({ commandId: crypto.randomUUID() });
