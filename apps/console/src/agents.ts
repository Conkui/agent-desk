import {
  agentCapabilities,
  capabilityFor,
  type Installation,
  type PublicProfile,
} from "@agent-desk/contracts";

/** Device discovery, API settings and workflow pickers share availability rules. */
export function agentInventory(installations: Installation[]): Installation[] {
  const known = Object.entries(agentCapabilities).map(
    ([cli, capability]) =>
      installations.find((item) => item.cli === cli) ?? {
        cli,
        name: capability.name,
        installed: false,
        supported: capability.execution,
      },
  );
  return [
    ...known,
    ...installations.filter((item) => !capabilityFor(item.cli)),
  ];
}
export function agentAvailability(
  agent: Installation,
  profiles: PublicProfile[],
) {
  const profile = profiles.find((item) => item.cli === agent.cli);
  const capability = capabilityFor(agent.cli);
  const configured =
    !!profile?.hasApiKey && !!capability?.protocols.includes(profile.protocol);
  const ready = agent.installed && agent.supported && configured;
  const label = !agent.installed
    ? "未安装 CLI"
    : !agent.supported
      ? "执行未接入"
      : !configured
        ? "待配置 API"
        : "可用于工作流";
  return { ready, configured, label };
}
