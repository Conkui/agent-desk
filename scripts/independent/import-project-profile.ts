import { resolve, join } from "node:path";
import { Profiles } from "@agent-desk/provider-config";

// An explicit migration of this project's own OpenCode profile, not native CLI configuration.
const root = resolve(import.meta.dir, "../.."),
  home = join(root, ".local/agent-desk");
const profiles = new Profiles(home);
if ((await profiles.list()).some((profile) => profile.cli === "opencode"))
  throw new Error(
    "Independent OpenCode profile already exists; nothing overwritten.",
  );
const source = await Bun.file(join(root, ".local/demo/agent-api.json")).json();
const profile = source.profiles?.opencode;
if (!profile?.enabled || !profile?.apiKey)
  throw new Error("No saved project OpenCode profile to import.");
await profiles.save("opencode", {
  protocol: "openai-compatible",
  baseUrl: profile.baseUrl,
  model: profile.model,
  apiKey: profile.apiKey,
});
console.log(
  "Imported the existing project OpenCode profile. No credential was printed; no native CLI files were changed.",
);
