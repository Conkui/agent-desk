import { expect, test } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { scanAgents } from "./index";
test("detects installed tools beyond the original four without executing them", async () => {
  const root = resolve(
    import.meta.dir,
    "../../../.local/tests/catalog-" + crypto.randomUUID(),
  );
  await mkdir(root, { recursive: true });
  try {
    const suffix = process.platform === "win32" ? ".cmd" : "";
    const npm = join(root, "AppData/npm"),
      local = join(root, ".local/bin");
    await mkdir(npm, { recursive: true });
    await mkdir(local, { recursive: true });
    await writeFile(join(npm, "dsh" + suffix), "must not execute", {
      mode: 0o700,
    });
    await writeFile(join(local, "claude" + suffix), "must not execute", {
      mode: 0o700,
    });
    await writeFile(
      join(root, "gemini" + suffix),
      'throw new Error("must not execute")',
      { mode: 0o700 },
    );
    await writeFile(
      join(root, "aider" + suffix),
      'throw new Error("must not execute")',
      { mode: 0o700 },
    );
    const tools = await scanAgents(root, {
      Path: root,
      PATHEXT: ".CMD",
      USERPROFILE: root,
      APPDATA: join(root, "AppData"),
    });
    expect(tools.length).toBeGreaterThan(20);
    expect(
      tools.some((tool) => tool.name.includes("Gemini") && tool.installed),
    ).toBe(true);
    expect(tools.find((tool) => tool.cli === "aider")?.installed).toBe(true);
    expect(tools.find((tool) => tool.cli === "codex")?.installed).toBe(false);
    expect(tools.find((tool) => tool.cli === "claude")?.installed).toBe(true);
    expect(tools.find((tool) => tool.cli === "dsh")?.installed).toBe(true);
    expect(tools.find((tool) => tool.cli === "claude")?.supported).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
