import { useEffect, useState, type FormEvent } from "react";
import {
  capabilityFor,
  protocolNames,
  ProtocolSchema,
  type Protocol,
} from "@agent-desk/contracts";
import type { Bootstrap } from "../types";
import { request } from "../api";
import { agentAvailability, agentInventory } from "../agents";

export function AgentApiSettings({
  bootstrap,
  cli,
  onSelect,
  onDevices,
  onRefresh,
}: {
  bootstrap: Bootstrap;
  cli: string;
  onSelect: (cli: string) => void;
  onDevices: () => void;
  onRefresh: () => Promise<void>;
}) {
  const inventory = agentInventory(bootstrap.installations);
  const agent = inventory.find((item) => item.cli === cli)!;
  const capability = capabilityFor(cli)!;
  const profile = bootstrap.profiles.find((item) => item.cli === cli);
  const [protocol, setProtocol] = useState<Protocol>(
    profile?.protocol ?? capability.protocols[0],
  );
  const [url, setUrl] = useState(profile?.baseUrl ?? "");
  const [model, setModel] = useState(profile?.model ?? "");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Changing CLI loads that profile. Background refreshes must not overwrite a draft or clear save feedback.
  useEffect(() => {
    setProtocol(profile?.protocol ?? capability.protocols[0]);
    setUrl(profile?.baseUrl ?? "");
    setModel(profile?.model ?? "");
    setKey("");
    setStatus("");
    setError("");
  }, [cli]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    setError("");
    try {
      await request(
        `/provider-profiles/${cli}`,
        {
          protocol,
          baseUrl: url.trim(),
          model: model.trim(),
          ...(key.trim() ? { apiKey: key.trim() } : {}),
        },
        "PUT",
      );
      setKey("");
      await onRefresh();
      setStatus("已保存，对新启动的工作流生效。");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2>Agent API</h2>
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <label>
            Agent CLI
            <select
              value={cli}
              onChange={(event) => onSelect(event.target.value)}
            >
              {inventory
                .filter((item) => capabilityFor(item.cli)?.protocols.length)
                .map((item) => (
                  <option key={item.cli} value={item.cli}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="agent-link-status">
            <span
              className={
                agentAvailability(agent, bootstrap.profiles).ready
                  ? "agent-ready"
                  : ""
              }
            >
              {agentAvailability(agent, bootstrap.profiles).label}
            </span>
            <button type="button" className="text-action" onClick={onDevices}>
              查看设备与连接 →
            </button>
          </div>
          <label>
            接口协议
            <select
              value={protocol}
              onChange={(event) => {
                setProtocol(ProtocolSchema.parse(event.target.value));
                setError("");
              }}
            >
              {ProtocolSchema.options.map((value) => (
                <option
                  key={value}
                  value={value}
                  disabled={!capability.protocols.includes(value)}
                >
                  {protocolNames[value]}
                  {!capability.protocols.includes(value)
                    ? " · 当前接入不支持"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            服务地址
            <input
              type="url"
              placeholder={
                protocol === "anthropic"
                  ? "https://api.anthropic.com/v1"
                  : "https://api.deepseek.com/v1"
              }
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
              maxLength={2048}
            />
          </label>
          <p className="field-help">
            填写基础地址，
            {protocol === "anthropic"
              ? "不含 /messages"
              : "不含 /chat/completions"}
            。
          </p>
          <label>
            模型
            <input
              placeholder="填写服务商的模型 ID"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              required
              maxLength={200}
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              autoComplete="off"
              placeholder={
                profile?.hasApiKey ? "已保存；留空保持原值" : "仅保存在本机"
              }
              value={key}
              onChange={(event) => setKey(event.target.value)}
              maxLength={4096}
            />
          </label>
          <button className="primary">{busy ? "正在保存…" : "保存配置"}</button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {status && (
            <p role="status" className="hint">
              {status}
            </p>
          )}
        </fieldset>
      </form>
    </>
  );
}
