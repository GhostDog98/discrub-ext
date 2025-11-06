import type { Channel, Message } from "discrub-lib/types/discord-types";

export type ThreadState = {
  threads: Channel[];
};

export type ArchivedThreadProps = {
  channelId: string;
  knownThreads: Channel[];
};

export type ThreadsFromMessagesProps = {
  messages: Message[];
  knownThreads: Channel[];
};
