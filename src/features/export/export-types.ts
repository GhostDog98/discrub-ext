import type { Channel, Guild, Message } from "discrub-lib/types/discord-types";
import type {
  ExportReactionMap,
  ExportUserMap,
  ExportEmojiMap,
  ExportAvatarMap,
  ExportMediaMap,
  ExportRoleMap,
} from "discrub-lib/types/discrub-types";
import { ExportType } from "../../enum/export-type";
import ExportUtils from "./export-utils";

export type ExportState = {
  isExporting: boolean;
  name: string;
  isGenerating: boolean;
  currentPage: number;
  totalPages: number;
  exportMaps: ExportMap;
  exportMessages: Message[];
  currentExportEntity: Guild | Channel | Maybe;
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

export type SpecialFormatting = {
  userMention: UserMentionRef[];
  channel: ChannelRef[];
  underLine: UnderlineRef[];
  code: CodeRef[];
  italics: ItalicRef[];
  bold: BoldRef[];
  link: LinkRef[];
  quote: QuoteRef[];
  hyperLink: HyperlinkRef[];
  emoji: EmojiRef[];
};

export type UserMentionRef = { raw: string; userName: string; id: Snowflake };
export type ChannelRef = { channelId: Snowflake | Maybe; raw: string };
export type UnderlineRef = { text: string; raw: string };
export type CodeRef = { text: string; raw: string };
export type ItalicRef = { text: string; raw: string };
export type BoldRef = { text: string; raw: string };
export type LinkRef = {
  url: string;
  text: string;
  description: string;
  raw: string;
};
export type QuoteRef = { text: string; raw: string };
export type HyperlinkRef = { raw: string };
export type EmojiRef = { raw: string; name: string; id: Snowflake };

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
  emojiRef: EmojiRef;
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
