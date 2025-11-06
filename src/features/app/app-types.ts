import Attachment from "../../classes/attachment";
import type { Channel, Embed, Guild, Message, Reaction, Role } from "discrub-lib/types/discord-types";
import type { AppSettings } from "discrub-lib/types/discrub-types";
import { Emoji } from "../../classes/emoji";
import { User } from "../../classes/user";

export type AppState = {
  discrubPaused: boolean;
  discrubCancelled: boolean;
  task: AppTask;
  settings: AppSettings;
};

export type AppTaskStatus = {
  _index?: number;
  _total?: number;
  _status?: string;
  _offset?: number;
  _data1?: string;
  _data2?: string;
  _data3?: string;
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
  | Maybe;

export type AppTask = {
  active: boolean;
  entity: AppTaskEntity;
  statusText: string | Maybe;
};

export type Timeout = {
  message: string;
  timeout: number;
};
