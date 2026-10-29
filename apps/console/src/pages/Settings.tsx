import { useState } from "react";
import type { Bootstrap } from "../types";
import { Brand } from "../components";
import { AgentApiSettings } from "../settings/AgentApiSettings";
import { AgentDevices } from "../settings/AgentDevices";

export function Settings({
  bootstrap,
  onRefresh,
  onLogout,
}: {
  bootstrap: Bootstrap;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [tab, setTab] = useState("api");
  const [cli, setCli] = useState("opencode");
  return (
    <main className="page">
      <div className="page-heading">
        <h1>设置</h1>
      </div>
      <div className="settings-layout">
        <nav aria-label="设置分类">
          {[
            ["api", "Agent API"],
            ["devices", "设备与连接"],
            ["about", "关于"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-current={tab === value ? "page" : undefined}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "api" ? (
            <AgentApiSettings
              bootstrap={bootstrap}
              cli={cli}
              onSelect={setCli}
              onDevices={() => setTab("devices")}
              onRefresh={onRefresh}
            />
          ) : tab === "devices" ? (
            <AgentDevices
              bootstrap={bootstrap}
              selectedCli={cli}
              onConfigure={(value) => {
                setCli(value);
                setTab("api");
              }}
              onRefresh={onRefresh}
              onLogout={onLogout}
            />
          ) : (
            <>
              <div className="about-brand">
                <Brand />
              </div>
              <h2>Agent Desk</h2>
              <p>个人 Agent 工作流工作台 · 0.2</p>
              <p className="hint">
                画布：React Flow · 消息面板：Radix UI
                <br />
                工具名录：ACP Registry · 本机探测：acp-router
                <br />
                本地执行：OpenCode
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
