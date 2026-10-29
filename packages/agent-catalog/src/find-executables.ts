// Extracted from puzige/acp-router src/agents.ts, commit e5e49a9ff1b5a1e454d4cd57bcaab69bf04a8881.
// MIT, copyright retained in third_party/acp-router/LICENSE. No version commands are executed.
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
export async function findExecutables(
  binary: string,
  pathEntries: string[],
): Promise<string[]> {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const entry of pathEntries) {
    const candidate = path.join(entry, binary);
    try {
      await fs.access(candidate, fsConstants.X_OK);
      if (!(await fs.stat(candidate)).isFile()) continue;
      const realPath = await fs.realpath(candidate).catch(() => candidate);
      if (seen.has(realPath)) continue;
      seen.add(realPath);
      candidates.push(candidate);
    } catch {
      continue;
    }
  }
  return candidates;
}
