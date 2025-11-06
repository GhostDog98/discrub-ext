import type { Guild } from "discrub-lib/types/discord-types";
import { PreFilterUser } from "../dm/dm-types";

export type GuildState = {
  guilds: Guild[];
  selectedGuild: Guild | Maybe;
  preFilterUsers: PreFilterUser[];
  isLoading: boolean | Maybe;
};
