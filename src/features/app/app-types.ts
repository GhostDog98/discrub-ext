import type { Attachment, Channel, Embed, Emoji, Guild, Message, Reaction, Role, User } from "discrub-lib/types/discord-types";
import type { AppSettings, AppTaskStatus } from "discrub-lib/types/discrub-types";

export type AppState = {
  discrubPaused: boolean;
  discrubCancelled: boolean;
  task: AppTask;
  settings: AppSettings;
};

export type AppTaskEntity =
  | ((
      | Message
      | Channel
      | User
      | Guild
      | Reaction
      | Emoji
      | Role
      | Attachment
      | Embed
    ) &
      AppTaskStatus)
  | null
  | undefined;

export type AppTask = {
  active: boolean;
  entity: AppTaskEntity;
  statusText?: string | null;
};

export type Timeout = {
  message: string;
  timeout: number;
};
