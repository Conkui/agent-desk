import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "../../../tests/fixtures";
import { OpenCodeRuntime, redact } from "./index";

test("does not claim an unowned process has stopped after a restart", async () => {
  const f = await fixture();
  const unrelated = Bun.spawn(
    [process.execPath, "-e", "setInterval(()=>{},1000)"],
    { stdout: "ignore", stderr: "ignore" },
  );
  try {
    const runId = crypto.randomUUID(),
      directory = join(f.home, "opencode", runId);
    await mkdir(directory, { recursive: true });
    await Bun.write(
      join(directory, "process.json"),
      JSON.stringify({ pid: unrelated.pid }),
    );
    const runtime = new OpenCodeRuntime(f.workspace, f.home, f.profiles);
    await expect(runtime.stop(runId)).rejects.toThrow("旧进程不属于当前后台");
    expect(await Bun.file(join(directory, "process.json")).exists()).toBe(true);
    expect(unrelated.exitCode).toBeNull();
  } finally {
    unrelated.kill();
    await unrelated.exited;
    await f.close();
  }
}, 10000);

test("clears a stale manifest only after confirming its old PID no longer exists", async () => {
  const f = await fixture();
  const exited = Bun.spawn([process.execPath, "-e", "process.exit(0)"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await exited.exited;
  try {
    const runId = crypto.randomUUID(),
      directory = join(f.home, "opencode", runId);
    await mkdir(directory, { recursive: true });
    await Bun.write(
      join(directory, "process.json"),
      JSON.stringify({ pid: exited.pid }),
    );
    const runtime = new OpenCodeRuntime(f.workspace, f.home, f.profiles);
    await runtime.stop(runId);
    expect(await Bun.file(join(directory, "process.json")).exists()).toBe(
      false,
    );
  } finally {
    await f.close();
  }
});
test("redacts configured credentials and key-shaped output before persistence", () => {
  expect(
    redact("value=fake-secret; sk-abcdefghijklmnopqrstuv", "fake-secret"),
  ).toBe("value=[已隐藏]; [已隐藏]");
});
