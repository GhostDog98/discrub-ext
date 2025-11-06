import type { Channel } from "discrub-lib/types/discord-types";

export type ChannelState = {
  channels: Channel[];
  selectedChannel: Channel | Maybe;
  isLoading: boolean | Maybe;
  selectedExportChannels: Snowflake[];
};
