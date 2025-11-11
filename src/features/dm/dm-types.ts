import type { Channel } from "discrub-lib/types/discord-types";

export type DmState = {
  dms: Channel[];
  selectedDms: Channel[];
  isLoading?: boolean | null;
  preFilterUsers: PreFilterUser[];
};

export type PreFilterUser = {
  name?: string | null;
  id: string;
};

export type SetSelectedDmsProps = {
  dmIds: string[];
  preFilterUser: PreFilterUser;
};
