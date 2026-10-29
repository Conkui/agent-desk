import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  AppError,
  ConfigurableCliSchema,
  capabilityFor,
  ProfileSchema,
  type Profile,
  type PublicProfile,
} from "@agent-desk/contracts";

const DiskSchema = z
  .object({
    version: z.literal(1),
    profiles: z
      .object({
        opencode: ProfileSchema.optional(),
        claude: ProfileSchema.optional(),
        dsh: ProfileSchema.optional(),
      })
      .strict(),
  })
  .strict();
export class Profiles {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private home: string) {}
  private async read() {
    try {
      return DiskSchema.parse(
        JSON.parse(await readFile(join(this.home, "profiles.json"), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return DiskSchema.parse({ version: 1, profiles: {} });
      throw new AppError(
        "profile_storage",
        "无法读取本项目 API 设置，请检查本地文件。",
        500,
      );
    }
  }
  async list(): Promise<PublicProfile[]> {
    const disk = await this.read();
    return Object.entries(disk.profiles).map(([cli, profile]) => ({
      cli,
      protocol: profile!.protocol,
      baseUrl: profile!.baseUrl,
      model: profile!.model,
      hasApiKey: !!profile!.apiKey,
    }));
  }
  async get(cli: string): Promise<Profile> {
    // Reject before reading secrets; a malformed disk file cannot affect Codex.
    const parsed = ConfigurableCliSchema.safeParse(cli);
    if (!parsed.success)
      throw new AppError(
        "cli_configuration_forbidden",
        "不允许设置 Codex 的 API。",
      );
    const profile = (await this.read()).profiles[parsed.data];
    if (!profile?.apiKey)
      throw new AppError(
        "profile_required",
        "请先在设置中保存该 CLI 的 API 配置。",
      );
    return profile;
  }
  save(cli: string, input: unknown): Promise<PublicProfile[]> {
    const parsedCli = ConfigurableCliSchema.safeParse(cli);
    if (!parsedCli.success)
      return Promise.reject(
        new AppError(
          "cli_configuration_forbidden",
          "不允许设置 Codex 的 API。",
        ),
      );
    const parsed = ProfileSchema.safeParse(input);
    if (!parsed.success)
      return Promise.reject(
        new AppError(
          "invalid_profile",
          parsed.error.issues[0]?.code === "custom"
            ? parsed.error.issues[0].message
            : ({
                protocol: "请从下拉栏选择接口协议。",
                baseUrl: "服务地址格式不正确，请填写完整 URL。",
                model: "请填写服务商的模型 ID。",
                apiKey: "API Key 格式不正确。",
              }[String(parsed.error.issues[0]?.path[0])] ??
              "API 配置格式不正确。"),
        ),
      );
    if (
      !capabilityFor(parsedCli.data)!.protocols.includes(parsed.data.protocol)
    )
      return Promise.reject(
        new AppError(
          "protocol_mismatch",
          `${capabilityFor(parsedCli.data)!.name} 不支持所选协议，请选择${capabilityFor(parsedCli.data)!.protocols.includes("anthropic") ? " Anthropic Messages" : " OpenAI 兼容 Chat Completions"}。`,
        ),
      );
    const operation = this.pending.then(async () => {
      const disk = await this.read(),
        prior = disk.profiles[parsedCli.data];
      disk.profiles[parsedCli.data] = {
        ...parsed.data,
        apiKey:
          parsed.data.apiKey === undefined ? prior?.apiKey : parsed.data.apiKey,
      };
      await mkdir(this.home, { recursive: true });
      const target = join(this.home, "profiles.json"),
        temp = `${target}.${crypto.randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(disk), { mode: 0o600, flag: "wx" });
      await rename(temp, target);
      return this.list();
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}

/** This process-only profile never writes native OpenCode or Codex configuration. */
export function openCodeEnvironment(
  profile: Profile,
  home: string,
  root: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    XDG_DATA_HOME: join(home, "data"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_STATE_HOME: join(home, "state"),
    TEMP: join(root, ".local/temp"),
    TMP: join(root, ".local/temp"),
    TMPDIR: join(root, ".local/temp"),
    AGENT_DESK_API_KEY: profile.apiKey,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model: `agent-desk/${profile.model}`,
      small_model: `agent-desk/${profile.model}`,
      enabled_providers: ["agent-desk"],
      autoupdate: false,
      permission: { "*": "ask", external_directory: "deny" },
      provider: {
        "agent-desk": {
          npm:
            profile.protocol === "anthropic"
              ? "@ai-sdk/anthropic"
              : "@ai-sdk/openai-compatible",
          name: "Agent Desk",
          options: {
            baseURL: profile.baseUrl.replace(/\/$/, ""),
            apiKey: "{env:AGENT_DESK_API_KEY}",
          },
          models: { [profile.model]: { name: profile.model } },
        },
      },
    }),
  };
}
