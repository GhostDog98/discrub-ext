import type { Channel } from "discrub-lib/types/discord-types";

export type ChannelState = {
  channels: Channel[];
  selectedChannel?: Channel | null;
  isLoading?: boolean | null;
  selectedExportChannels: string[];
};
