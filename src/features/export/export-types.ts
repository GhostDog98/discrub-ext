import type { Channel, Guild, Message } from "discrub-lib/types/discord-types";
import type {
  ExportReactionMap,
  ExportUserMap,
  ExportEmojiMap,
  ExportAvatarMap,
  ExportMediaMap,
  ExportRoleMap,
} from "discrub-lib/types/discrub-types";
import { ExportType } from "discrub-lib/discrub-enum";
import type {
  SpecialFormatting,
  EmojiFormat,
} from "discrub-lib/types/message-formatting-types";
import ExportUtils from "./export-utils";

// Re-export for backwards compatibility
export type { SpecialFormatting };

export type ExportState = {
  isExporting: boolean;
  name: string;
  isGenerating: boolean;
  currentPage: number;
  totalPages: number;
  exportMaps: ExportMap;
  exportMessages: Message[];
  currentExportEntity?: Guild | Channel | null;
  exportData: ExportData;
};

export type ExportMap = {
  /** Cleared at the end of an export **/
  userMap: ExportUserMap;
  emojiMap: ExportEmojiMap;
  avatarMap: ExportAvatarMap;
  mediaMap: ExportMediaMap;
  roleMap: ExportRoleMap;
  /*************************************/

  /** Cleared when messages are reset **/
  reactionMap: ExportReactionMap;
  /*************************************/
};

export type FilesFromMessagesProps = {
  message: Message;
  exportUtils: ExportUtils;
  paths: { media: string };
  index: number;
};

export type AvatarFromMessageProps = {
  message: Message;
  exportUtils: ExportUtils;
};

export type GetEmojiProps = {
  emojiRef: EmojiFormat;
  isReply: boolean;
  exportView: boolean;
};

export type FormattedInnerHtmlProps = {
  content: string;
  isReply: boolean;
  exportView: boolean;
};

export type EmojisFromMessageProps = {
  message: Message;
  exportUtils: ExportUtils;
};

export type ProcessMessagesProps = {
  messages: Message[];
  paths: { media: string };
  exportUtils: ExportUtils;
};

export type ExportHtmlProps = {
  exportUtils: ExportUtils;
  messages: Message[];
  filePath: string;
};

export type ExportJsonProps = ExportHtmlProps;

export type CompressMessagesProps = {
  messages: Message[];
  format: ExportType;
  entityName: string;
  entityMainDirectory: string;
  exportUtils: ExportUtils;
  threadData?: { thread: Channel; threadNo: number; threadCount: number };
};

export type ExportData = {
  currentThread?: Channel;
};
