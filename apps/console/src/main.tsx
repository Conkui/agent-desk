import type React from "react";
import { useCallback, useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import type { Bootstrap } from "./types";
import { request, RequestError } from "./api";
import { Brand } from "./components";
import { usePage } from "./navigation";
import { WorkflowList } from "./pages/WorkflowList";
import { CreateWorkflow } from "./pages/CreateWorkflow";
const WorkflowDetail=lazy(()=>import('./pages/WorkflowDetail').then(module=>({default:module.WorkflowDetail})));
import { Settings } from "./pages/Settings";
import "./style.css";

function App() {
  const { path, navigate } = usePage(),
    [bootstrap, setBootstrap] = useState<Bootstrap | null>(null),
    [login, setLogin] = useState(false),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),[online,setOnline]=useState(true);
  useEffect(()=>{let disposed=false;const check=async()=>{try{const response=await fetch('/api/v1/health',{signal:AbortSignal.timeout(3000),cache:'no-store'});if(!disposed)setOnline(response.ok)}catch{if(!disposed)setOnline(false)}};const timer=setInterval(()=>void check(),12000);return()=>{disposed=true;clearInterval(timer)}},[]);
  const refresh = useCallback(async () => {
    try {
      setBootstrap(await request<Bootstrap>("/bootstrap"));
      setLogin(false);
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) {
        setBootstrap(null);
        setLogin(true);
      } else setError((error as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const reconnect = () => {
      setBootstrap(null);
      setLogin(true);
    };
    window.addEventListener("agent-desk:connection-required", reconnect);
    return () =>
      window.removeEventListener("agent-desk:connection-required", reconnect);
  }, []);
  useEffect(() => {
    document.title = "Agent Desk";
  }, [path]);
  const formLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request("/auth/login", { password });
      setPassword("");
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (login)
    return (
      <main className="connect-screen">
        <form className="connect-form" onSubmit={formLogin}>
          <Brand />
          <h1>连接你的工作台</h1>
          <p>输入电脑上的连接密码</p>
          <label>
            设备连接密码
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "正在连接…" : "连接"}
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <details>
            <summary>在哪里找到密码？</summary>
            <p>
              打开电脑项目目录中的{" "}
              <code>.local/agent-desk/connection-password.txt</code>
              。手机接入需要先配置私网连接。
            </p>
          </details>
        </form>
      </main>
    );
  if (!bootstrap)
    return (
      <main className="connect-screen">
        <Brand />
        <p role="status">{error || "正在连接工作台…"}</p>
        <button onClick={() => void refresh()}>重试</button>
      </main>
    );
  const settings = path.startsWith("/settings"),
    create = path === "/workflows/new",
    workflowId = !create ? path.match(/^\/workflows\/([^/]+)/)?.[1] : undefined;
  return (
    <div className="app">
      <header className="topbar">
        <button className="brand-link" onClick={() => navigate("/workflows")}>
          <Brand />
        </button>
        <nav aria-label="主导航">
          <button
            aria-current={!settings ? "page" : undefined}
            onClick={() => navigate("/workflows")}
          >
            工作流
          </button>
          <button
            aria-current={settings ? "page" : undefined}
            onClick={() => navigate("/settings")}
          >
            设置
          </button>
        </nav>
        <span className={`connection-indicator ${online?'':'disconnected'}`}>
          <i />
          {online?'本机已连接':'连接中断'}
        </span>
      </header>
      <div className="app-content">
        {settings ? (
          <Settings
            bootstrap={bootstrap}
            onRefresh={refresh}
            onLogout={async () => {
              await request("/auth/logout", {});
              setLogin(true);
              setBootstrap(null);
            }}
          />
        ) : create ? (
          <CreateWorkflow bootstrap={bootstrap} navigate={navigate} />
        ) : workflowId ? (
          <Suspense fallback={<main className="page"><p className="hint" role="status">正在打开画布…</p></main>}><WorkflowDetail
            key={workflowId}
            workflowId={workflowId}
            bootstrap={bootstrap}
            navigate={navigate}
          /></Suspense>
        ) : (
          <WorkflowList navigate={navigate} />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
