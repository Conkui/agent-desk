import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isIP } from "node:net";
import { AppError } from "@agent-desk/contracts";
import type { Store } from "@agent-desk/storage";

export const LISTEN_HOST = "127.0.0.1" as const;
export function privateOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  // No Funnel/public domain convenience: this edition accepts only explicit private endpoints.
  const host = url.hostname;
  const privateIP =
    isIP(host) === 4 &&
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
      host,
    );
  if (
    url.protocol !== "https:" ||
    (!host.endsWith(".ts.net") && !privateIP) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new AppError(
      "private_origin_required",
      "手机入口只接受明确的 HTTPS 私网地址；本机不开放公网端口。",
    );
  return url.origin;
}
export function checkRequestBoundary(
  request: Request,
  port: number,
  remoteOrigin?: string,
) {
  const local = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const allowed = [...local, ...(remoteOrigin ? [remoteOrigin] : [])];
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (!allowed.some((origin) => new URL(origin).host === host))
    throw new AppError("host_forbidden", "不接受该访问主机。", 403);
  const origin = request.headers.get("origin");
  if (origin && !allowed.includes(origin))
    throw new AppError("origin_forbidden", "不接受跨站请求。", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new AppError("origin_forbidden", "不接受跨站访问。", 403);
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class DeviceAccess {
  private password = "";
  private failures: number[] = [];
  constructor(
    private home: string,
    private store: Store,
    private secure = false,
  ) {}
  async initialize() {
    await mkdir(this.home, { recursive: true });
    const path = join(this.home, "connection-password.txt");
    try {
      this.password = (await readFile(path, "utf8")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.password = Buffer.from(
        crypto.getRandomValues(new Uint8Array(32)),
      ).toString("base64url");
      await writeFile(path, this.password, { mode: 0o600, flag: "wx" });
    }
    if (this.password.length < 32)
      throw new Error("Invalid local connection credential");
  }
  login(password: string, secure = this.secure): string {
    const now = Date.now();
    this.failures = this.failures.filter((time) => now - time < 60000);
    if (this.failures.length >= 8)
      throw new AppError(
        "login_throttled",
        "尝试次数过多，请一分钟后再试。",
        429,
      );
    if (
      !timingSafeEqual(
        Buffer.from(hash(password)),
        Buffer.from(hash(this.password)),
      )
    ) {
      this.failures.push(now);
      throw new AppError("invalid_credential", "设备连接密码不正确。", 401);
    }
    const token = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString("base64url");
    this.store.db
      .query("INSERT INTO browser_sessions VALUES(?,?)")
      .run(hash(token), now + 12 * 60 * 60 * 1000);
    return `agent_desk_session=${token}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
  }
  authorized(request: Request): boolean {
    const token = request.headers
      .get("cookie")
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("agent_desk_session="))
      ?.slice(19);
    if (!token) return false;
    const record = this.store.db
      .query<
        { expires: number },
        [string]
      >("SELECT expires FROM browser_sessions WHERE hash=?")
      .get(hash(token));
    return !!record && record.expires > Date.now();
  }
  logout(request: Request) {
    const token = request.headers
      .get("cookie")
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("agent_desk_session="))
      ?.slice(19);
    if (token)
      this.store.db
        .query("DELETE FROM browser_sessions WHERE hash=?")
        .run(hash(token));
    return "agent_desk_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0";
  }
}
