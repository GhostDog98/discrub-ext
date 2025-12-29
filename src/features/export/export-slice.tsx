import { createSlice } from "@reduxjs/toolkit";
import { getMessageData, resetMessageData } from "../message/message-slice";
import {
  entityIsAudio,
  entityIsImage,
  entityIsVideo,
  formatUserData,
  getEncodedEmoji,
  getExportFileName,
  getMediaUrls,
  getRoleNames,
  getOsSafeString,
  isDm,
  resolveAvatarUrl,
  resolveEmojiUrl,
  resolveRoleUrl,
  sortByProperty,
  stringToBool,
  stringToTypedArray,
  getThreadEntityName,
  getPercent,
  getFsUUID,
} from "discrub-lib/discrub-utils";
import { wait, MapUtils } from "discrub-lib/common-utils";
import { ExportDataService } from "discrub-lib/export-data-service";
import { resetChannel, setChannel } from "../channel/channel-slice";
import {
  isAppStopped,
  resetStatus,
  setDiscrubCancelled,
  setStatus,
} from "../app/app-slice";
import { renderToString } from "react-dom/server";
import { parseSpecialFormatting } from "discrub-lib/message-formatting-utils";
import { replaceUserMentionsWithUsernames } from "discrub-lib/export-utils";
import type {
  ExportAvatarMap,
  ExportEmojiMap,
  ExportMediaMap,
  ExportReactionMap,
  ExportRoleMap,
  ExportUserMap,
} from "discrub-lib/types/discrub-types";
import {
  AvatarFromMessageProps,
  CompressMessagesProps,
  EmojisFromMessageProps,
  ExportData,
  ExportHtmlProps,
  ExportJsonProps,
  ExportMap,
  ExportState,
  FilesFromMessagesProps,
  FormattedInnerHtmlProps,
  GetEmojiProps,
  ProcessMessagesProps,
  SpecialFormatting,
} from "./export-types";
import { DiscrubSetting, ExportType, MediaType } from "discrub-lib/discrub-enum";
import type { Message, Guild, Channel } from "discrub-lib/types/discord-types";
import ExportUtils from "./export-utils";
import { AppThunk } from "../../app/store";
import { ReactElement } from "react";
import Papa from "papaparse";
import { flatten } from "flat";
import { DiscordService } from "discrub-lib/discord-service";
import { isAttachment } from "discrub-lib/discrub-guards";
import hljs from "highlight.js";
import { setSetting } from "../../services/chrome-service.ts";
import { fileTypeFromBlob } from "file-type";
import { parseISO } from "date-fns";

const initialMaps: ExportMap = {
  userMap: {},
  emojiMap: {},
  avatarMap: {},
  mediaMap: {},
  roleMap: {},
  reactionMap: {},
};

const initialState: ExportState = {
  isExporting: false,
  name: "",
  isGenerating: false,
  currentPage: 1,
  totalPages: 0,
  exportMaps: initialMaps,
  exportMessages: [],
  currentExportEntity: null,
  exportData: {},
};

export const exportSlice = createSlice({
  name: "export",
  initialState: initialState,
  reducers: {
    setExportUserMap: (
      state,
      { payload }: { payload: ExportUserMap },
    ): void => {
      setSetting(DiscrubSetting.CACHED_USER_MAP, JSON.stringify(payload));
      state.exportMaps.userMap = payload;
    },
    setExportEmojiMap: (
      state,
      { payload }: { payload: ExportEmojiMap },
    ): void => {
      state.exportMaps.emojiMap = payload;
    },
    setExportAvatarMap: (
      state,
      { payload }: { payload: ExportAvatarMap },
    ): void => {
      state.exportMaps.avatarMap = payload;
    },
    setExportMediaMap: (
      state,
      { payload }: { payload: ExportMediaMap },
    ): void => {
      state.exportMaps.mediaMap = payload;
    },
    setExportRoleMap: (
      state,
      { payload }: { payload: ExportRoleMap },
    ): void => {
      state.exportMaps.roleMap = payload;
    },
    setExportReactionMap: (
      state,
      { payload }: { payload: ExportReactionMap },
    ): void => {
      state.exportMaps.reactionMap = payload;
    },
    resetExportMaps: (state, { payload }: { payload: string[] }): void => {
      if (payload.length) {
        payload.forEach((mapName) => {
          if (mapName in initialMaps) {
            (state.exportMaps as any)[mapName] = (initialMaps as any)[mapName];
          }
        });
      } else {
        state.exportMaps = initialMaps;
      }
    },
    setCurrentPage: (state, { payload }: { payload: number }): void => {
      state.currentPage = payload;
    },
    setTotalPages: (state, { payload }: { payload: number }): void => {
      state.totalPages = payload;
    },
    setIsGenerating: (state, { payload }: { payload: boolean }): void => {
      state.isGenerating = payload;
    },
    setIsExporting: (state, { payload }: { payload: boolean }): void => {
      state.isExporting = payload;
    },
    setName: (state, { payload }: { payload: string }): void => {
      state.name = payload;
    },
    setExportMessages: (state, { payload }: { payload: Message[] }): void => {
      state.exportMessages = payload;
    },
    setCurrentExportEntity: (
      state,
      { payload }: { payload: Guild | Channel | null | undefined },
    ): void => {
      state.currentExportEntity = payload;
    },
    setExportData: (state, { payload }: { payload: ExportData }): void => {
      state.exportData = payload;
    },
  },
});

export const {
  setCurrentPage,
  setIsGenerating,
  setIsExporting,
  setName,
  resetExportMaps,
  setExportUserMap,
  setExportAvatarMap,
  setExportEmojiMap,
  setExportMediaMap,
  setExportRoleMap,
  setExportReactionMap,
  setExportMessages,
  setTotalPages,
  setCurrentExportEntity,
  setExportData,
} = exportSlice.actions;

const _downloadFilesFromMessage =
  ({
    message,
    exportUtils,
    paths,
    index,
  }: FilesFromMessagesProps): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const { settings } = getState().app;
    const { threads } = getState().thread;
    const {
      exportUseArtistMode,
      exportDownloadMedia_2,
      exportSeparateThreadAndForumPosts,
    } = getState().app.settings;
    const artistMode = stringToBool(exportUseArtistMode);
    const downloadMedia = stringToTypedArray<MediaType>(exportDownloadMedia_2);
    const folderingThreads = stringToBool(exportSeparateThreadAndForumPosts);
    const isDlImages = downloadMedia.some((mt) => mt === MediaType.IMAGES);
    const isDlVideos = downloadMedia.some((mt) => mt === MediaType.VIDEOS);
    const isDlAudio = downloadMedia.some((mt) => mt === MediaType.AUDIO);
    const isDlEmbedImages = downloadMedia.some(
      (mt) => mt === MediaType.EMBEDDED_IMAGES,
    );
    const isDlEmbedVideos = downloadMedia.some(
      (mt) => mt === MediaType.EMBEDDED_VIDEOS,
    );

    let embeds = message.embeds;
    let attachments = message.attachments;

    let mediaPath = paths.media;
    if (folderingThreads) {
      const foundThread = threads.find(
        (t) => message.thread?.id === t.id || message.channel_id === t.id,
      );
      mediaPath = foundThread
        ? `${mediaPath.substring(0, mediaPath.lastIndexOf("/"))}/${getThreadEntityName(foundThread)}_media`
        : mediaPath;
    }
    if (artistMode && message.userName) {
      mediaPath = `${mediaPath}/${message.userName}`;
    }

    for (const [eI, entity] of [...embeds, ...attachments].entries()) {
      const isImage = entityIsImage(entity);
      const isVideo = entityIsVideo(entity);
      const isAudio = entityIsAudio(entity);
      // As far as I'm aware, Discord does not support embedded audio.
      const shouldPerformDownload =
        (isImage && (isAttachment(entity) ? isDlImages : isDlEmbedImages)) ||
        (isVideo && (isAttachment(entity) ? isDlVideos : isDlEmbedVideos)) ||
        (isAudio && isDlAudio);

      if (shouldPerformDownload) {
        const downloadUrls = getMediaUrls(entity);
        for (const [dI, downloadUrl] of downloadUrls.entries()) {
          if (await dispatch(isAppStopped())) break;
          const { exportMaps } = getState().export;
          const map = exportMaps.mediaMap;

          if (!map[downloadUrl]) {
            const status = `Downloading - ${downloadUrl}`;
            dispatch(setStatus(status));
            const { success, data } = await new DiscordService(
              settings,
            ).downloadFile(downloadUrl);
            if (success && data) {
              const { ext: fileExtension } = (await fileTypeFromBlob(data)) || {
                ext: "",
              };
              const fileIndex = `${index + 1}_${eI + 1}_${dI + 1}`;
              const fileName = `${fileIndex}_${getExportFileName(
                entity,
                fileExtension,
              )}`;
              const filePath = `${mediaPath}/${fileName}`;
              const status = `Archiving - ${filePath}`;
              dispatch(setStatus(status));
              await exportUtils.addToZip(data, filePath, {
                lastModified: parseISO(message.timestamp),
              });

              const updatedMediaMap = MapUtils.set(
                map,
                downloadUrl,
                `${mediaPath.slice(mediaPath.indexOf("/") + 1)}/${fileName}`,
              );
              dispatch(setExportMediaMap(updatedMediaMap));
            }
          }
        }
      }
    }
  };

const _downloadRoles =
  (exportUtils: ExportUtils, guild: Guild): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const guildRoles = guild.roles || [];
    for (const [_, role] of guildRoles.entries()) {
      const { settings } = getState().app;
      if (await dispatch(isAppStopped())) break;

      const { exportMaps } = getState().export;
      const iconUrl = resolveRoleUrl(role.id, role.icon).remote;
      if (iconUrl) {
        const { success, data } = await new DiscordService(
          settings,
        ).downloadFile(iconUrl);
        if (success && data) {
          const fileExt = data.type.split("/")?.[1] || "webp";
          const fileName = getExportFileName(role, fileExt);
          const roleFilePath = `roles/${fileName}.${fileExt}`;
          await exportUtils.addToZip(data, roleFilePath);
          dispatch(
            setExportRoleMap(
              MapUtils.set(exportMaps.roleMap, iconUrl, roleFilePath),
            ),
          );
        }
      }
    }
  };

const _downloadAvatarFromMessage =
  ({ message, exportUtils }: AvatarFromMessageProps): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const { settings } = getState().app;
    const { reactionsEnabled } = settings;
    const { exportMaps } = getState().export;
    const { reactionMap, userMap } = exportMaps;

    const avatarLookups: { id: string; avatar: string | null | undefined }[] = [
      { id: message.author.id, avatar: message.author.avatar },
    ];

    if (stringToBool(reactionsEnabled)) {
      message.reactions?.forEach((r) => {
        const encodedEmoji = getEncodedEmoji(r.emoji);
        if (encodedEmoji) {
          const users = reactionMap[message.id]?.[encodedEmoji] || [];
          users.forEach((eR) => {
            const { avatar } = userMap[eR.id] || {};
            if (!avatarLookups.some((aL) => aL.id === eR.id))
              avatarLookups.push({ id: eR.id, avatar: avatar });
          });
        }
      });
    }

    for (const [_, aL] of avatarLookups.entries()) {
      const { settings } = getState().app;
      if (await dispatch(isAppStopped())) break;

      const { avatarMap } = getState().export.exportMaps;
      const idAndAvatar = `${aL.id}/${aL.avatar}`;
      const { remote: remoteAvatar } = resolveAvatarUrl(aL.id, aL.avatar);

      if (!avatarMap[idAndAvatar] && remoteAvatar) {
        const status = `Downloading - ${remoteAvatar}`;
        dispatch(setStatus(status));
        const { success, data } = await new DiscordService(
          settings,
        ).downloadFile(remoteAvatar);
        if (success && data) {
          const fileExt = data.type.split("/")?.[1] || "webp";
          const avatarFilePath = `avatars/${idAndAvatar}.${fileExt}`;
          const status = `Archiving - ${avatarFilePath}`;
          dispatch(setStatus(status));
          await exportUtils.addToZip(data, avatarFilePath);

          dispatch(
            setExportAvatarMap(
              MapUtils.set(avatarMap, idAndAvatar, avatarFilePath),
            ),
          );
        }
      }
    }
  };

/**
 * Parses Discord special formatting from message content
 * @param {String} content String content to parse Discord special formatting
 * @returns An Object of special formatting
 */
export const getSpecialFormatting =
  (content: string): AppThunk<SpecialFormatting> =>
  (_, getState) => {
    const { userMap } = getState().export.exportMaps;
    const { selectedGuild } = getState().guild;
    const guildRoles = selectedGuild?.roles || [];

    return parseSpecialFormatting(content, { userMap, guildRoles });
  };

const _getEmoji =
  ({ emojiRef, isReply, exportView }: GetEmojiProps): AppThunk<ReactElement> =>
  (_, getState) => {
    const { id, name } = emojiRef;
    const { exportMaps } = getState().export;
    const { emojiMap } = exportMaps;

    const { local: localPath, remote: remotePath } = resolveEmojiUrl(
      id,
      emojiMap,
    );

    const emojiUrl = exportView ? localPath || remotePath : remotePath;

    return (
      <img
        style={{
          display: "inline-flex",
          verticalAlign: "middle",
          width: isReply ? "16px" : "25px",
          height: isReply ? "16px" : "25px",
        }}
        title={isReply ? undefined : name}
        id={name}
        src={emojiUrl}
        alt={name}
      />
    );
  };

/**
 *
 * @param {String} content String content to get formatted html from
 * @returns Html in String format
 */
export const getFormattedInnerHtml =
  ({
    content,
    isReply = false,
    exportView = false,
  }: FormattedInnerHtmlProps): AppThunk<string> =>
  (dispatch, getState) => {
    const { userMap } = getState().export.exportMaps;
    const { selectedGuild } = getState().guild;
    let rawHtml = content || "";

    const { emoji } = dispatch(getSpecialFormatting(rawHtml));
    if (emoji.length) {
      emoji.forEach((emojiRef) => {
        rawHtml = rawHtml.replaceAll(
          emojiRef.raw,
          renderToString(
            dispatch(_getEmoji({ emojiRef, isReply, exportView })),
          ),
        );
      });
    }

    const { link } = dispatch(getSpecialFormatting(rawHtml));
    if (link.length) {
      link.forEach((linkRef) => {
        rawHtml = rawHtml.replaceAll(
          linkRef.raw,
          renderToString(
            <a
              style={{
                textDecoration: "none",
                color: "rgb(0, 168, 252)",
                cursor: "pointer !important",
              }}
              href={linkRef.url}
              target="_blank"
              rel="noreferrer"
              title={linkRef.description}
              dangerouslySetInnerHTML={{ __html: linkRef.text }}
            />,
          ),
        );
      });
    }

    const { hyperLink } = dispatch(getSpecialFormatting(rawHtml));
    if (hyperLink.length) {
      hyperLink.forEach((hyperLinkRef) => {
        rawHtml = rawHtml.replaceAll(
          hyperLinkRef.raw,
          renderToString(
            <a
              style={{
                textDecoration: "none",
                color: "rgb(0, 168, 252)",
                cursor: "pointer !important",
              }}
              href={hyperLinkRef.raw}
              target="_blank"
              rel="noreferrer"
              title={hyperLinkRef.raw}
              dangerouslySetInnerHTML={{ __html: hyperLinkRef.raw }}
            />,
          ),
        );
      });
    }

    const { bold } = dispatch(getSpecialFormatting(rawHtml));
    if (bold.length) {
      bold.forEach((boldRef) => {
        rawHtml = rawHtml.replaceAll(
          boldRef.raw,
          renderToString(
            <strong dangerouslySetInnerHTML={{ __html: boldRef.text }} />,
          ),
        );
      });
    }

    const { code } = dispatch(getSpecialFormatting(rawHtml));
    if (code.length) {
      code.forEach((codeRef) => {
        rawHtml = rawHtml.replaceAll(
          codeRef.raw,
          renderToString(
            <span
              style={{
                backgroundColor: "#282b30",
                borderRadius: 5,
                padding: "7px",
                border: "1px solid #1e1f22",
                display: "block",
                whiteSpace: "pre-wrap",
                margin: "1em 0",
                fontFamily: "monospace",
              }}
              dangerouslySetInnerHTML={{
                __html: hljs.highlightAuto(codeRef.text).value,
              }}
            />,
          ),
        );
      });
    }

    const { quote } = dispatch(getSpecialFormatting(rawHtml));
    if (quote.length) {
      quote.forEach((quoteRef) => {
        rawHtml = rawHtml.replaceAll(
          quoteRef.raw,
          renderToString(
            <span
              style={{
                backgroundColor: "#242529",
                borderRadius: 5,
                padding: "3px",
              }}
              dangerouslySetInnerHTML={{ __html: quoteRef.text }}
            />,
          ),
        );
      });
    }

    const { underLine } = dispatch(getSpecialFormatting(rawHtml));
    if (underLine.length) {
      underLine.forEach((underLineRef) => {
        rawHtml = rawHtml.replaceAll(
          underLineRef.raw,
          renderToString(
            <span
              style={{
                textDecoration: "underline",
              }}
              dangerouslySetInnerHTML={{ __html: underLineRef.text }}
            />,
          ),
        );
      });
    }

    const { italics } = dispatch(getSpecialFormatting(rawHtml));
    if (italics.length) {
      italics.forEach((italicsRef) => {
        rawHtml = rawHtml.replaceAll(
          italicsRef.raw,
          renderToString(
            <span
              style={{
                fontStyle: "italic",
              }}
              dangerouslySetInnerHTML={{ __html: italicsRef.text }}
            />,
          ),
        );
      });
    }

    const { channel } = dispatch(getSpecialFormatting(rawHtml));
    if (channel.length) {
      channel.forEach((channelRef) => {
        const { channels } = getState().channel;
        const channelName =
          channels.find((c) => c.id === channelRef.channelId)?.name ||
          "Channel Not Found";
        rawHtml = rawHtml.replaceAll(
          channelRef.raw,
          renderToString(
            <span
              style={{
                backgroundColor: "#3c4270",
                padding: "0 2px",
                borderRadius: "5px",
              }}
              dangerouslySetInnerHTML={{ __html: `# ${channelName}` }}
            />,
          ),
        );
      });
    }

    const { userMention } = dispatch(getSpecialFormatting(rawHtml));
    if (userMention.length) {
      userMention.forEach((userMentionRef) => {
        const userMapping = userMap[userMentionRef.id];
        const { guilds, userName, displayName } = userMapping || {
          guilds: {},
          userName: null,
          displayName: null,
        };

        let nick, roles, joinedAt: string | null | undefined;
        let roleNames: string[] = [];
        if (selectedGuild) {
          ({ nick, roles, joinedAt } = guilds[selectedGuild.id] || {});
          roleNames = getRoleNames(roles, selectedGuild);
        }

        rawHtml = rawHtml.replaceAll(
          userMentionRef.raw,
          renderToString(
            <span
              title={formatUserData({
                userId: userMentionRef.id,
                userName,
                displayName,
                guildNickname: nick,
                joinedAt,
                roleNames,
              })}
              style={{
                backgroundColor: "#4a4b6f",
                padding: "0 2px",
                borderRadius: "5px",
              }}
              dangerouslySetInnerHTML={{
                __html: `@${
                  nick || displayName || userName || "User Not Found"
                }`,
              }}
            />,
          ),
        );
      });
    }

    return rawHtml;
  };

const _downloadEmojisFromMessage =
  ({ message, exportUtils }: EmojisFromMessageProps): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const { emoji: emojiReferences } = dispatch(
      getSpecialFormatting(message.content),
    );
    const { settings } = getState().app;
    const reactionsEnabled = stringToBool(settings.reactionsEnabled);
    if (message.reactions && reactionsEnabled) {
      message.reactions.forEach((r) => {
        const { id, name } = r.emoji || {};
        if (id && name) emojiReferences.push({ id, name, raw: "" });
      });
    }

    if (emojiReferences.length) {
      for (const { id, name } of emojiReferences) {
        if (await dispatch(isAppStopped())) break;
        const { exportMaps } = getState().export;
        if (!exportMaps.emojiMap[id]) {
          const downloadUrl = `https://cdn.discordapp.com/emojis/${id}`;
          const status = `Downloading - ${downloadUrl}`;
          dispatch(setStatus(status));
          const { success, data } = await new DiscordService(
            settings,
          ).downloadFile(downloadUrl);

          if (success && data) {
            const fileExt = data.type?.split("/")?.[1] || "gif";
            const emojiFilePath = `emojis/${getOsSafeString(
              name,
            )}_${id}.${fileExt}`;
            const status = `Archiving - ${emojiFilePath}`;
            dispatch(setStatus(status));
            await exportUtils.addToZip(data, emojiFilePath);

            dispatch(
              setExportEmojiMap(
                MapUtils.set(exportMaps.emojiMap, id, emojiFilePath),
              ),
            );
          }
        }
      }
    }
  };

const _downloadDiscrubMedia = async (exportUtils: ExportUtils) => {
  const media = [{ url: "resources/media/discrub.png", name: "discrub.png" }];
  for (const m of media) {
    const { success, data } = await new DiscordService().downloadFile(m.url);

    if (success && data) {
      await exportUtils.addToZip(data, `discrub_media/${m.name}`);
    }
  }
};

const _processMessages =
  ({
    messages,
    paths,
    exportUtils,
  }: ProcessMessagesProps): AppThunk<Promise<void>> =>
  async (dispatch, _getState) => {
    for (const [i, message] of messages.entries()) {
      await wait(!i ? 3 : 0);
      if (await dispatch(isAppStopped())) break;

      await dispatch(
        _downloadFilesFromMessage({
          message,
          exportUtils,
          paths,
          index: i,
        }),
      );
      await dispatch(_downloadEmojisFromMessage({ message, exportUtils }));
      await dispatch(_downloadAvatarFromMessage({ message, exportUtils }));

      dispatch(
        setStatus(
          `Processed ${i + 1} of ${messages.length} messages (${getPercent(i + 1, messages.length)}%)`,
        ),
      );
    }
  };

const _exportHtml = async ({
  exportUtils,
  messages,
  filePath,
}: ExportHtmlProps) => {
  // TODO: Do we still need to reference messages in case of error?
  // HTML Exports actually are using ExportMessages component ref, NOT the messages passed to _exportHtml
  exportUtils.setExportMessages(messages); // This is purely so that we can reference the messages in the case of an error!
  const htmlBlob = await exportUtils.generateHTML();
  await exportUtils.addToZip(htmlBlob, filePath);
};

const _exportJson =
  ({
    exportUtils,
    messages,
    filePath,
  }: ExportJsonProps): AppThunk<Promise<void>> =>
  async (_, getState) => {
    const { userMap } = getState().export.exportMaps;
    const { selectedGuild } = getState().guild;
    const guildRoles = selectedGuild?.roles || [];

    await exportUtils.addToZip(
      new Blob(
        [
          JSON.stringify(
            messages.map((message) => {
              // We are currently only parsing User mentions, using username, in JSON exports.
              const content = replaceUserMentionsWithUsernames(
                message.content,
                userMap,
                guildRoles,
              );
              return { ...message, content };
            }),
          ),
        ],
        {
          type: "text/plain",
        },
      ),
      filePath,
    );
  };

const _exportCsv = async ({
  exportUtils,
  messages,
  filePath,
}: ExportHtmlProps) => {
  const csvKeys: string[] = [];
  const csvData: Object[] = messages.map((m) => {
    const flattenedMessage: Object = flatten(m);
    Object.keys(flattenedMessage).forEach((mKey) => {
      if (!csvKeys.some((csvKey) => csvKey === mKey)) {
        csvKeys.push(mKey);
      }
    });
    return flattenedMessage;
  });

  await exportUtils.addToZip(
    Papa.unparse(csvData, {
      columns: ["id", ...csvKeys.filter((k) => k !== "id").sort()],
    }),
    filePath,
  );
};

const _compressMessages =
  ({
    messages,
    format,
    entityName,
    entityMainDirectory,
    exportUtils,
    threadData,
  }: CompressMessagesProps): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const { exportSeparateThreadAndForumPosts, exportMessagesPerPage } =
      getState().app.settings;
    const messagesPerPage = parseInt(exportMessagesPerPage);
    const separateThreads = stringToBool(exportSeparateThreadAndForumPosts);

    // Use ExportDataService to prepare export structure
    const exportData = ExportDataService.prepareExportData({
      messages,
      messagesPerPage,
      entityName,
      entityMainDirectory,
      format,
      threads: getState().thread.threads,
      separateThreads: separateThreads && !threadData,
    });

    // Helper function to export a single page
    const exportPage = async (
      pageMessages: Message[],
      filePath: string,
      pageNumber: number,
      totalPagesInContext: number,
      currentThread?: Channel,
    ) => {
      if (await dispatch(isAppStopped())) return false;

      // Set page numbers relative to the current export context
      dispatch(setCurrentPage(pageNumber));
      dispatch(setTotalPages(totalPagesInContext));

      if (currentThread) {
        dispatch(setExportData({ currentThread }));
      } else {
        const { exportData: currentExportData } = getState().export;
        dispatch(setExportData({ ...currentExportData, currentThread: undefined }));
      }

      if (format !== ExportType.MEDIA) {
        dispatch(setStatus(`Archiving - ${filePath}`));
      }

      dispatch(setExportMessages(pageMessages));

      if (format === ExportType.JSON) {
        await dispatch(
          _exportJson({
            exportUtils,
            messages: pageMessages,
            filePath,
          }),
        );
      } else if (format === ExportType.HTML) {
        await _exportHtml({
          exportUtils,
          messages: pageMessages,
          filePath,
        });
      } else if (format === ExportType.CSV) {
        await _exportCsv({
          exportUtils,
          messages: pageMessages,
          filePath,
        });
      }

      return true;
    };

    let shouldStop = false;

    // Process thread exports
    for (const threadExport of exportData.threadExports) {
      if (shouldStop) break;

      for (const page of threadExport.pages) {
        const shouldContinue = await exportPage(
          page.messages,
          page.filePath,
          page.pageNumber,
          threadExport.pages.length,
          threadExport.thread,
        );

        if (!shouldContinue) {
          shouldStop = true;
          break;
        }
      }

      if (await dispatch(isAppStopped())) {
        shouldStop = true;
        break;
      }
    }

    // Process main pages
    if (!shouldStop && !(await dispatch(isAppStopped()))) {
      for (const page of exportData.mainPages) {
        const shouldContinue = await exportPage(
          page.messages,
          page.filePath,
          page.pageNumber,
          exportData.mainPages.length,
        );

        if (!shouldContinue) break;
      }
    }

    dispatch(setCurrentPage(1));
  };

export const exportMessages =
  (
    messages: Message[],
    entityName: string,
    exportUtils: ExportUtils,
    format: ExportType,
  ): AppThunk =>
  async (dispatch, getState) => {
    const { selectedGuild } = getState().guild;
    const { selectedChannel } = getState().channel;
    const { selectedDms } = getState().dm;

    const entity = !!selectedDms.length
      ? selectedDms[0]
      : selectedChannel || selectedGuild;
    const safeEntityName = getOsSafeString(entityName);
    const entityMainDirectory = `${safeEntityName}_${getFsUUID()}`;
    dispatch(setIsExporting(true));
    dispatch(setName(safeEntityName));
    dispatch(setCurrentExportEntity(entity));

    if (selectedGuild)
      await dispatch(_downloadRoles(exportUtils, selectedGuild));
    if (format === ExportType.HTML) await _downloadDiscrubMedia(exportUtils);

    const mediaPath = `${entityMainDirectory}/${safeEntityName}_media`;
    const paths = { media: mediaPath };

    await dispatch(_processMessages({ messages, paths, exportUtils }));

    if (messages.length > 0 && !(await dispatch(isAppStopped()))) {
      await dispatch(
        _compressMessages({
          messages,
          format,
          entityName: safeEntityName,
          entityMainDirectory,
          exportUtils,
        }),
      );
    }

    if (!(await dispatch(isAppStopped()))) {
      dispatch(setStatus("Preparing Archive"));
      await exportUtils.generateZip();
    }

    dispatch(setIsGenerating(false));
    dispatch(setIsExporting(false));
    dispatch(setName(""));
    dispatch(setCurrentExportEntity(null));
    await exportUtils.resetZip();
    dispatch(resetStatus());
    dispatch(setCurrentPage(1));
    dispatch(setDiscrubCancelled(false));
    dispatch(resetExportMaps(["emojiMap", "avatarMap", "mediaMap", "roleMap"]));
  };

export const exportChannels =
  (
    channels: Channel[],
    exportUtils: ExportUtils,
    format: ExportType,
  ): AppThunk =>
  async (dispatch, getState) => {
    const { settings } = getState().app;
    const sortOverride = settings.exportMessageSortOrder;
    const { selectedGuild } = getState().guild;

    dispatch(setIsExporting(true));

    if (selectedGuild)
      await dispatch(_downloadRoles(exportUtils, selectedGuild));
    if (format === ExportType.HTML) await _downloadDiscrubMedia(exportUtils);

    for (const entity of channels) {
      if (getState().app.discrubCancelled) break;
      dispatch(resetStatus());
      const safeEntityName = getOsSafeString(entity.name || entity.id);
      const entityMainDirectory = `${safeEntityName}_${getFsUUID()}`;
      dispatch(setCurrentExportEntity(entity));
      dispatch(setName(safeEntityName));
      if (!isDm(entity)) {
        dispatch(setChannel(entity.id));
      }

      let exportMessages: Message[] = [];

      //TODO: Use retrieveMessages instead
      const messageData = await dispatch(
        getMessageData(selectedGuild?.id || null, entity.id),
      );

      if (messageData) {
        exportMessages = messageData.messages
          .map((m) => ({ ...m }))
          .sort((a, b) =>
            sortByProperty(
              { ...a, date: new Date(a.timestamp) },
              { ...b, date: new Date(b.timestamp) },
              "date",
              sortOverride,
            ),
          );
      }

      const mediaPath = `${entityMainDirectory}/${safeEntityName}_media`;
      const paths = { media: mediaPath };

      await dispatch(
        _processMessages({ messages: exportMessages, paths, exportUtils }),
      );

      if (exportMessages.length > 0) {
        if (await dispatch(isAppStopped())) break;
        await dispatch(
          _compressMessages({
            messages: exportMessages,
            format,
            entityName: safeEntityName,
            entityMainDirectory,
            exportUtils,
          }),
        );
      }

      if (await dispatch(isAppStopped())) break;
    }
    if (!(await dispatch(isAppStopped()))) {
      dispatch(setStatus("Preparing Archive"));
      await exportUtils.generateZip();
    }

    dispatch(resetChannel());
    dispatch(resetMessageData());

    dispatch(setIsGenerating(false));
    dispatch(setIsExporting(false));
    dispatch(setName(""));
    dispatch(setCurrentExportEntity(null));
    await exportUtils.resetZip();
    dispatch(resetStatus());
    dispatch(setCurrentPage(1));
    dispatch(setDiscrubCancelled(false));
    dispatch(resetExportMaps(["emojiMap", "avatarMap", "mediaMap", "roleMap"]));
  };

export default exportSlice.reducer;
