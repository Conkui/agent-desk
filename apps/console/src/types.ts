import type { Installation, PublicProfile } from "@agent-desk/contracts";
export type Bootstrap = {
  workspace: string;
  installations: Installation[];
  profiles: PublicProfile[];
  network: {
    listenHost: string;
    privateOrigin: string | null;
    publicPort: boolean;
    relayEnabled: boolean;
  };
};
