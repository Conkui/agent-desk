import { delimiter, join, isAbsolute, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { capabilityFor, type Installation } from "@agent-desk/contracts";
import registry from "./registry.json";
import { findExecutables } from "./find-executables";

// Registry entries describe availability, never permission to download or launch a CLI.
// Aliases resolve ACP wrappers to the native tool that users install themselves.
const aliases: Record<string, string[]> = {
  "claude-acp": ["claude", "claude-agent-acp"],
  "codex-acp": ["codex", "codex-acp"],
  cursor: ["agent", "cursor-agent"],
  "cursor-agent": ["agent", "cursor-agent"],
  gemini: ["gemini"],
  "amp-acp": ["amp"],
  "pi-acp": ["pi"],
  "github-copilot": ["copilot"],
  copilot: ["copilot"],
  kimi: ["kimi"],
  "qwen-code": ["qwen"],
  "mistral-vibe": ["vibe"],
  "opencode-v2": ["opencode"],
};
const canonical: Record<string, string> = {
  "claude-acp": "claude",
  "codex-acp": "codex",
  "opencode-v2": "opencode",
};
export async function scanAgents(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Installation[]> {
  const userHome = env.USERPROFILE ?? env.HOME ?? homedir();
  const entries = [
    ...new Set(
      [
        ...(env.PATH ?? env.Path ?? "").split(delimiter),
        join(root, ".local/agents/node_modules/.bin"),
        join(userHome, ".local/bin"),
        join(userHome, ".cargo/bin"),
        join(userHome, ".bun/bin"),
        ...(env.APPDATA ? [join(env.APPDATA, "npm")] : []),
        ...(env.LOCALAPPDATA
          ? [join(env.LOCALAPPDATA, "Microsoft/WinGet/Links")]
          : []),
      ].filter(Boolean),
    ),
  ];
  const catalog = new Map<
    string,
    { name: string; commands: string[]; repository?: string }
  >();
  for (const agent of registry.agents) {
    const id = canonical[agent.id] ?? agent.id;
    if (catalog.has(id)) continue;
    const distribution = agent.distribution as any;
    const platform = Object.values(distribution?.binary ?? {}) as any[];
    const commands = aliases[agent.id] ?? [
      agent.id.replace(/-acp$/, ""),
      ...platform
        .map(
          (target) =>
            String(target.cmd ?? "")
              .split(/[\\/]/)
              .pop()!,
        )
        .filter(Boolean),
    ];
    catalog.set(id, {
      name: agent.name,
      commands: [...new Set(commands)],
      repository: agent.repository,
    });
  }
  catalog.set("opencode", {
    name: "OpenCode",
    commands: [
      "opencode",
      join(
        root,
        ".local/agents/node_modules/opencode-windows-x64/bin/opencode.exe",
      ),
    ],
  });
  catalog.set("claude", {
    name: "Claude Code",
    commands: ["claude", "claude-agent-acp"],
  });
  catalog.set("codex", { name: "Codex", commands: ["codex", "codex-acp"] });
  catalog.set("dsh", {
    name: "DeepSeek Harness",
    commands: ["dsh", "deepseek"],
  });
  catalog.set("aider", { name: "Aider", commands: ["aider"] });
  const extensions =
    process.platform === "win32"
      ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").toLowerCase().split(";")]
      : [""];
  return Promise.all(
    [...catalog].map(async ([cli, item]) => {
      const matches = await Promise.all(
        item.commands.flatMap((command) =>
          extensions.map((extension) =>
            isAbsolute(command)
              ? findExecutables(basename(command) + extension, [
                  dirname(command),
                ])
              : findExecutables(command + extension, entries),
          ),
        ),
      );
      const paths = [...new Set(matches.flat())];
      return {
        cli,
        name: item.name,
        installed: paths.length > 0,
        supported: capabilityFor(cli)?.execution ?? false,
        path: paths[0],
        commands: item.commands,
        repository: item.repository,
      };
    }),
  );
}
