import type { Guild } from "discrub-lib/types/discord-types";
import { PreFilterUser } from "../dm/dm-types";

export type GuildState = {
  guilds: Guild[];
  selectedGuild?: Guild | null;
  preFilterUsers: PreFilterUser[];
  isLoading?: boolean | null;
};
