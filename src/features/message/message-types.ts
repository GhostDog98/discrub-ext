import type { Channel, Message } from "discrub-lib/types/discord-types";
import type { SearchCriteria, Filter } from "discrub-lib/types/discrub-types";
import { SortDirection } from "discrub-lib/common-enum";

export type MessageState = {
  messages: Message[]; // Message objects
  selectedMessages: string[]; // Array of id
  filteredMessages: Message[]; // Message objects
  filters: Filter[]; // Array of object filters
  isLoading?: boolean | null;
  order: SortDirection;
  orderBy: keyof Message;
  searchCriteria: SearchCriteria;
};

export type DeleteConfiguration = {
  attachments: boolean;
  messages: boolean;
  reactions: boolean;
  reactingUserIds: string[];
  emojis: string[];
};

export type MessageData = {
  threads: Channel[];
  messages: Message[];
};

export type SearchResultData = {
  offset: number;
  searchCriteria: SearchCriteria;
  totalMessages: number;
};

export type MessageSearchOptions = {
  excludeReactions?: boolean;
  excludeUserLookups?: boolean;
  startOffSet?: number;
  endOffSet?: number;
  searchCriteriaOverrides?: Partial<SearchCriteria>;
};
