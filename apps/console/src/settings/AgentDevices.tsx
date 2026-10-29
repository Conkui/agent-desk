import { useState } from "react";
import { capabilityFor } from "@agent-desk/contracts";
import type { Bootstrap } from "../types";
import { request } from "../api";
import { agentAvailability, agentInventory } from "../agents";

export function AgentDevices({
  bootstrap,
  selectedCli,
  onConfigure,
  onRefresh,
  onLogout,
}: {
  bootstrap: Bootstrap;
  selectedCli: string;
  onConfigure: (cli: string) => void;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [showCatalog, setShowCatalog] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inventory = agentInventory(bootstrap.installations);
  const installed = inventory.filter((item) => item.installed).length;
  const ready = inventory.filter(
    (item) => agentAvailability(item, bootstrap.profiles).ready,
  ).length;
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>本机 Agent</h2>
          <p className="hint">
            已安装 {installed} 个 · 可运行 {ready} 个
          </p>
        </div>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await request("/devices/local/scan", {});
              await onRefresh();
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "扫描中…" : "重新扫描"}
        </button>
      </div>
      {showCatalog && (
        <input
          className="catalog-search"
          aria-label="搜索 Agent"
          placeholder="搜索名称或命令"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      <div className="installation-list">
        {inventory
          .filter(
            (item) =>
              item.installed ||
              !!capabilityFor(item.cli)?.protocols.length ||
              showCatalog,
          )
          .filter((item) =>
            `${item.name} ${item.cli} ${(item.commands ?? []).join(" ")}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((item) => {
            const capability = capabilityFor(item.cli);
            const availability = agentAvailability(item, bootstrap.profiles);
            return (
              <div
                className={`installation-row ${selectedCli === item.cli ? "installation-selected" : ""}`}
                key={item.cli}
              >
                <div className="installation-info">
                  <strong>{item.name}</strong>
                  <span
                    className={`agent-state ${availability.ready ? "agent-ready" : ""}`}
                  >
                    {availability.label}
                    {!item.installed && !item.supported ? " · 执行未接入" : ""}
                  </span>
                  {item.path && (
                    <small className="installation-path">{item.path}</small>
                  )}
                  {capability?.protocols.length ? (
                    <small>
                      {availability.configured ? "API 已配置" : "API 未配置"}
                    </small>
                  ) : null}
                </div>
                <div className="installation-actions">
                  {!!capability?.protocols.length && (
                    <button onClick={() => onConfigure(item.cli)}>
                      配置 API
                    </button>
                  )}
                  {!item.installed && capability?.setupUrl && (
                    <a
                      href={capability.setupUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      安装说明 ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })}
      </div>
      <button
        className="catalog-toggle"
        onClick={() => {
          setShowCatalog(!showCatalog);
          setSearch("");
        }}
      >
        {showCatalog
          ? "收起工具名录"
          : `查看全部可识别 Agent（${inventory.length}）`}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="form-section">
        <h2>手机连接</h2>
        {bootstrap.network.privateOrigin ? (
          <>
            <p>私网已配置</p>
            <code>{bootstrap.network.privateOrigin}</code>
          </>
        ) : (
          <p className="hint">尚未连接手机</p>
        )}
        <p className="hint">阿里云中转方案已保存，稍后配置。</p>
      </section>
      <button onClick={() => void onLogout()}>断开此浏览器</button>
    </>
  );
}
