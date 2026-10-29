import { z } from "zod";

export const CliSchema = z.enum(["opencode", "claude", "dsh", "codex"]);
export const ConfigurableCliSchema = z.enum(["opencode", "claude", "dsh"]);
export const ProtocolSchema = z.enum(["openai-compatible", "anthropic"]);
export type Cli = z.infer<typeof CliSchema>;
export type Protocol = z.infer<typeof ProtocolSchema>;

// One capability table drives discovery, configuration validation and UI choices.
// Recognizing an executable does not imply that its execution adapter is implemented.
type Capability = {
  name: string;
  protocols: readonly Protocol[];
  execution: boolean;
  setupUrl: string;
};
export const agentCapabilities: Record<Cli, Capability> = {
  opencode: {
    name: "OpenCode",
    protocols: ["openai-compatible", "anthropic"],
    execution: true,
    setupUrl: "https://opencode.ai/docs/",
  },
  claude: {
    name: "Claude Code",
    protocols: ["anthropic"],
    execution: false,
    setupUrl: "https://code.claude.com/docs/en/setup",
  },
  dsh: {
    name: "DeepSeek Harness",
    protocols: ["openai-compatible"],
    execution: false,
    setupUrl:
      "https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/cli",
  },
  codex: { name: "Codex", protocols: [], execution: false, setupUrl: "" },
};
export const protocolNames: Record<Protocol, string> = {
  "openai-compatible": "OpenAI 兼容 · Chat Completions",
  anthropic: "Anthropic · Messages",
};
export function capabilityFor(cli: string): Capability | undefined {
  return Object.hasOwn(agentCapabilities, cli)
    ? agentCapabilities[cli as Cli]
    : undefined;
}
