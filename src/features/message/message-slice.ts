import { createSlice } from "@reduxjs/toolkit";
import {
  defaultGMOMappingData,
  getEncodedEmoji,
  getGMOMappingData,
  getSortedMessages,
  getThreadEntityName,
  getUserMappingData,
  isCriteriaActive,
  isDm,
  isGuildForum,
  isRemovableMessage,
  isSearchComplete,
  isUserDataStale,
  messageTypeEquals,
  stringToBool,
} from "discrub-lib/discrub-utils";
import type {
  Attachment,
  Message,
  Channel,
  Reaction,
  User,
} from "discrub-lib/types/discord-types";
import type {
  SearchCriteria,
  ExportReaction,
  ExportReactionMap,
  ExportUserMap,
} from "discrub-lib/types/discrub-types";
import {
  IsPinnedType,
  MessageCategory,
  MessageType,
  QueryStringParam,
  ReactionType,
} from "discrub-lib/discord-enum";
import { SortDirection } from "discrub-lib/common-enum";
import { FilterName, FilterType } from "discrub-lib/discrub-enum";
import { MessageRegex } from "discrub-lib/regex";
import {
  getArchivedThreads,
  getThreadsFromMessages,
  liftThreadRestrictions,
  resetThreads,
  setThreads,
} from "../thread/thread-slice";
import {
  resetModify,
  setDiscrubCancelled,
  setIsModifying,
  setModifyEntity,
  setTimeoutMessage as notify,
  setStatus,
  resetStatus,
  isAppStopped,
} from "../app/app-slice";
import {
  resetExportMaps,
  setExportReactionMap,
  setExportUserMap,
} from "../export/export-slice";
import { getPreFilterUsers } from "../guild/guild-slice";
import { isDate, parseISO, isAfter, isBefore, isEqual } from "date-fns";
import {
  DeleteConfiguration,
  Filter,
  MessageData,
  MessageSearchOptions,
  MessageState,
  SearchResultData,
} from "./message-types";
import { AppThunk } from "../../app/store";
import { isMessage } from "discrub-lib/discrub-guards";
import { DiscordService } from "discrub-lib/discord-service";
import {
  ATTACHMENT_REQUIRES_ENTIRE_MSG_REMOVAL,
  MAX_OFFSET,
  MISSING_PERMISSION_ATTACHMENT,
  MISSING_PERMISSION_SKIPPING,
  MISSING_PERMISSION_TO_MODIFY,
  OFFSET_INCREMENT,
  REACTION_REMOVE_FAILED_FOR,
  START_OFFSET,
} from "./contants.ts";

/**
 * Centralized status message builders for consistent user feedback
 */
const StatusMessages = {
  // Message retrieval
  retrievedMessages: (count: number) => `Retrieved ${count} messages`,

  retrievedSearchResults: (count: number, total: number) =>
    `Retrieved ${count} of ${total} messages`,

  retrievedThreads: (count: number) => `Retrieved ${count} threads`,

  retrievingThreadMessages: (threadName: string) =>
    `Retrieving messages for thread - ${threadName}`,

  // Reaction handling
  retrievingReactionUsers: (
    emojiName: string,
    current: number,
    total: number,
    hasBrackets: boolean = false,
  ) => {
    const brackets = hasBrackets ? ":" : "";
    return `Retrieving users who reacted with ${brackets}${emojiName}${brackets} for message ${current} of ${total}`;
  },

  searchingReactions: (current: number, total: number) =>
    `Searching for reactions around message ${current} of ${total}`,

  // User data enrichment
  retrievingUserAlias: (userName: string) =>
    `Retrieving alias data for ${userName}`,

  retrievingServerData: (userName: string) =>
    `Retrieving server data for ${userName}`,
} as const;

const _descendingComparator = <Message>(
  a: Message,
  b: Message,
  orderBy: keyof Message,
) => {
  return b[orderBy] < a[orderBy] ? -1 : b[orderBy] > a[orderBy] ? 1 : 0;
};

/**
 * Apply inverse logic to a filter condition
 * @param matches - Whether the condition matched
 * @param inverseActive - Whether inverse filtering is enabled
 * @returns true if message should be included, false otherwise
 */
const _applyInverseLogic = (
  matches: boolean,
  inverseActive: boolean,
): boolean => {
  return inverseActive ? !matches : matches;
};

type TimeComparison = "before" | "after";

/**
 * Unified timestamp filter for both start and end time filtering
 * @param filterValue - The date to compare against
 * @param message - The message to filter
 * @param inverseActive - Whether inverse filtering is enabled
 * @param comparison - Whether to check if message is 'before' or 'after' the filter date
 */
const _filterByTimestamp = (
  filterValue: Date,
  message: Message,
  inverseActive: boolean,
  comparison: TimeComparison,
): boolean => {
  const messageDate = parseISO(message.timestamp);

  const matches =
    comparison === "after"
      ? isAfter(messageDate, filterValue) || isEqual(messageDate, filterValue) // Start time: message is after or equal to filter
      : isBefore(messageDate, filterValue) || isEqual(messageDate, filterValue); // End time: message is before or equal to filter

  return _applyInverseLogic(matches, inverseActive);
};

/**
 * Text extractors for different filter types
 */
type TextExtractor = (message: Message) => string | string[];

const TextExtractors = {
  property: (propertyName: keyof Message | string) => (message: Message) => {
    // Handle special cases where the filter name doesn't directly map to a Message property
    if (propertyName === "userName") {
      return message.author?.username || "";
    }

    // Default: access property directly on message
    return String(message[propertyName as keyof Message] || "");
  },

  attachments: (message: Message) =>
    message.attachments.map((a) => a.filename).join(),

  contentAndEmbeds: (message: Message) => {
    const texts = [message.content];

    message.embeds?.forEach((embed) => {
      if (embed.type === "rich") {
        const embedTexts = [
          embed.author?.name,
          embed.author?.url,
          embed.description,
          embed.footer?.text,
          embed.title,
          embed.url,
          ...(embed.fields?.map((f) => f.name) || []),
          ...(embed.fields?.map((f) => f.value) || []),
        ].filter((text): text is string => typeof text === "string");
        texts.push(...embedTexts);
      }
    });

    return texts.filter(Boolean) as string[];
  },
};

/**
 * Helper to check if text contains search values
 */
const _createTextContainsCheck = (
  values: string | string[],
  text: string,
  caseSensitive = true,
): boolean => {
  const searchText = caseSensitive ? text : text.toLowerCase();
  const searchValues = Array.isArray(values) ? values : [values];

  return searchValues.some((val) => {
    const searchVal = caseSensitive ? val : val.toLowerCase();
    return searchText.includes(searchVal);
  });
};

/**
 * Unified text content filter
 */
const _filterByTextContent = (
  filterValue: string | string[],
  message: Message,
  inverseActive: boolean,
  extractor: TextExtractor,
  caseSensitive = true,
): boolean => {
  const extracted = extractor(message);
  const textArray = Array.isArray(extracted) ? extracted : [extracted];

  const matches = textArray.some((text) =>
    _createTextContainsCheck(filterValue, text, caseSensitive),
  );

  return _applyInverseLogic(matches, inverseActive);
};

const initialState: MessageState = {
  messages: [],
  selectedMessages: [],
  filteredMessages: [],
  filters: [],
  isLoading: null,
  order: SortDirection.ASCENDING,
  orderBy: "timestamp",
  searchCriteria: {
    searchBeforeDate: null,
    searchAfterDate: null,
    searchMessageContent: null,
    selectedHasTypes: [],
    userIds: [],
    mentionIds: [],
    channelIds: [],
    isPinned: IsPinnedType.UNSET,
  },
};

export const messageSlice = createSlice({
  name: "message",
  initialState: initialState,
  reducers: {
    setIsLoading: (state, { payload }: { payload: boolean }): void => {
      state.isLoading = payload;
    },
    setSearchCriteria: (
      state,
      { payload }: { payload: Partial<SearchCriteria> },
    ): void => {
      state.searchCriteria = { ...state.searchCriteria, ...payload };
    },
    setSelected: (state, { payload }: { payload: string[] }): void => {
      state.selectedMessages = payload;
    },
    setOrder: (
      state,
      {
        payload,
      }: { payload: { order: SortDirection; orderBy: keyof Message } },
    ): void => {
      const { order, orderBy } = payload;
      state.order = order;
      state.orderBy = orderBy;
      state.messages = state.messages.sort(
        payload.order === SortDirection.DESCENDING
          ? (a, b) => _descendingComparator(a, b, orderBy)
          : (a, b) => -_descendingComparator(a, b, orderBy),
      );
      state.filteredMessages = state.filteredMessages.sort(
        payload.order === SortDirection.DESCENDING
          ? (a, b) => _descendingComparator(a, b, orderBy)
          : (a, b) => -_descendingComparator(a, b, orderBy),
      );
    },
    setMessages: (state, { payload }: { payload: Message[] }): void => {
      state.messages = payload;
    },
    setFilteredMessages: (state, { payload }: { payload: Message[] }): void => {
      state.filteredMessages = payload;
    },
    _resetMessageData: (state): void => {
      state.messages = [];
      state.selectedMessages = [];
      state.isLoading = null;
    },
    resetFilters: (state): void => {
      state.filters = [];
      state.filteredMessages = [];
    },
    resetAdvancedFilters: (state): void => {
      state.searchCriteria = initialState.searchCriteria;
    },
    updateFilters: (state, { payload }: { payload: Filter }): void => {
      const { filterName, filterValue, filterType } = payload;
      const filteredList = state.filters.filter(
        (x) => x.filterName !== filterName,
      );
      let retFilters: Filter[] = [];
      if (filterType === FilterType.TEXT) {
        if (Number(filterValue?.length) > 0)
          retFilters = [
            ...filteredList,
            {
              filterName: filterName,
              filterValue: filterValue,
              filterType: filterType,
            },
          ];
        else retFilters = [...filteredList];
      } else if (filterType === FilterType.DATE) {
        if (isDate(filterValue) && filterValue.getTime()) {
          retFilters = [
            ...filteredList,
            {
              filterName: filterName,
              filterValue: filterValue,
              filterType: filterType,
            },
          ];
        } else retFilters = [...filteredList];
      } else if (filterType === FilterType.THREAD) {
        if (Number(filterValue?.length) > 0)
          retFilters = [
            ...filteredList.filter((f) => f.filterType !== filterType),
            {
              filterValue: filterValue,
              filterType: filterType,
            },
          ];
        else
          retFilters = [
            ...filteredList.filter((f) => f.filterType !== filterType),
          ];
      } else if (filterType === FilterType.TOGGLE) {
        if (filterValue) {
          // Add the toggle to filters
          retFilters = [
            ...filteredList,
            {
              filterName: filterName,
              filterValue: filterValue,
              filterType: filterType,
            },
          ];
        } else {
          // Remove the toggle from filters
          retFilters = filteredList.filter(
            (filter) => filter.filterName !== filterName,
          );
        }
      } else if (filterType === FilterType.ARRAY) {
        if (filterValue.length) {
          retFilters = [
            ...filteredList.filter((f) => f.filterName !== filterName),
            {
              filterName: filterName,
              filterValue: filterValue,
              filterType: filterType,
            },
          ];
        } else {
          // Remove filter from list
          retFilters = [
            ...filteredList.filter((f) => f.filterName !== filterName),
          ];
        }
      }
      state.filters = retFilters;
    },
  },
});

const _filterMessageType = (
  _filterValue: string[],
  message: Message,
  inverseActive: boolean,
  threads: Channel[],
): boolean => {
  const matches = _filterValue.some(
    (fv) =>
      messageTypeEquals(message.type, fv as MessageType) ||
      (fv === MessageCategory.PINNED && message.pinned) ||
      (fv === MessageCategory.REACTIONS && !!message.reactions?.length) ||
      (fv === MessageCategory.THREAD &&
        threads.some((t) => t.id === message.channel_id)) ||
      (fv === MessageCategory.THREAD_STARTER && message.thread?.id),
  );
  return _applyInverseLogic(matches, inverseActive);
};

const _filterThread = (
  filterValue: string,
  message: Message,
  inverseActive: boolean,
): boolean => {
  const matches =
    message.channel_id === filterValue || message.thread?.id === filterValue;
  return _applyInverseLogic(matches, inverseActive);
};

/**
 * Filter handler map for different filter types
 * Eliminates cascading if-else chains by mapping filter types to their handlers
 */
type FilterHandler = (
  param: Filter,
  message: Message,
  inverseActive: boolean,
  getState: any,
) => boolean;

const FilterHandlers: Record<FilterType, FilterHandler> = {
  [FilterType.TEXT]: (param, message, inverseActive) => {
    // Type guard: ensure filterValue is a string or string array
    if (
      !param.filterValue ||
      (typeof param.filterValue !== "string" &&
        !Array.isArray(param.filterValue))
    ) {
      return true;
    }

    if (param.filterName === FilterName.ATTACHMENT_NAME) {
      return _filterByTextContent(
        param.filterValue,
        message,
        inverseActive,
        TextExtractors.attachments,
        false, // Case insensitive
      );
    }
    if (param.filterName === FilterName.CONTENT) {
      return _filterByTextContent(
        param.filterValue,
        message,
        inverseActive,
        TextExtractors.contentAndEmbeds,
      );
    }
    // Default text filter for other message properties
    return _filterByTextContent(
      param.filterValue,
      message,
      inverseActive,
      TextExtractors.property(param.filterName as keyof Message),
    );
  },

  [FilterType.DATE]: (param, message, inverseActive) => {
    // Type guard: ensure filterValue is a Date
    if (!param.filterValue || !(param.filterValue instanceof Date)) return true;

    if (param.filterName === FilterName.START_TIME) {
      return _filterByTimestamp(
        param.filterValue,
        message,
        inverseActive,
        "after",
      );
    }
    if (param.filterName === FilterName.END_TIME) {
      return _filterByTimestamp(
        param.filterValue,
        message,
        inverseActive,
        "before",
      );
    }
    return true;
  },

  [FilterType.THREAD]: (param, message, inverseActive) => {
    // Type guard: ensure filterValue is a string
    if (!param.filterValue || typeof param.filterValue !== "string")
      return true;

    return _filterThread(param.filterValue, message, inverseActive);
  },

  [FilterType.ARRAY]: (param, message, inverseActive, getState) => {
    if (param.filterName === FilterName.MESSAGE_TYPE) {
      const { threads } = getState().thread;
      return _filterMessageType(
        param.filterValue,
        message,
        inverseActive,
        threads,
      );
    }
    return true;
  },

  [FilterType.TOGGLE]: () => true, // Toggle filters don't filter messages, they just enable/disable features
};

export const {
  setIsLoading,
  setSearchCriteria,
  setSelected,
  setOrder,
  setMessages,
  setFilteredMessages,
  _resetMessageData,
  resetFilters,
  resetAdvancedFilters,
  updateFilters,
} = messageSlice.actions;

export const filterMessages =
  (): AppThunk<Promise<void>> => async (dispatch, getState) => {
    const state = getState().message;
    const inverseActive = state.filters
      .filter((f) => f.filterName)
      .some((filter) => filter.filterName === FilterName.INVERSE);

    const hasNoMeaningfulFilters =
      state.filters.length === 0 ||
      (state.filters.length === 1 && inverseActive);

    // Early return if no meaningful filters
    if (hasNoMeaningfulFilters) {
      dispatch(setFilteredMessages(state.messages));
      dispatch(
        setSelected(
          state.messages
            .filter((m) => state.selectedMessages.some((mId) => m.id === mId))
            .map((m) => m.id),
        ),
      );
      return;
    }

    // Apply all filters to all messages using FilterHandlers map
    const filteredMessages = state.messages.filter((message) =>
      state.filters.every((filter) => {
        if (!filter.filterValue) return true;

        const handler = FilterHandlers[filter.filterType];
        if (!handler) return true;

        return handler(filter, message, inverseActive, getState);
      }),
    );

    // Update selected messages to only include those in filtered results
    const selectedInFiltered = filteredMessages
      .filter((m) => state.selectedMessages.includes(m.id))
      .map((m) => m.id);

    dispatch(setFilteredMessages(filteredMessages));
    dispatch(setSelected(selectedInFiltered));
  };

/**
 * Delete a reaction without changing message state
 * @param channelId
 * @param messageId
 * @param emoji
 * @param userId
 */
export const deleteRawReaction =
  (
    channelId: string,
    messageId: string,
    emoji: string,
    userId: string,
  ): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    const { settings } = getState().app;
    const { token, currentUser } = getState().user;
    const { reactionMap } = getState().export.exportMaps;
    let success = false;

    if (token) {
      ({ success } = await new DiscordService(settings).deleteReaction(
        token,
        channelId,
        messageId,
        emoji,
        userId === currentUser?.id ? "@me" : userId,
      ));
      if (success) {
        const updatedReactionMap = {
          ...reactionMap,
          [messageId]: {
            ...reactionMap[messageId],
            [emoji]: reactionMap[messageId][emoji].filter(
              (er) => er.id !== currentUser?.id,
            ),
          },
        };
        dispatch(setExportReactionMap(updatedReactionMap));
      }
    }
    return success;
  };

export const deleteReaction =
  (
    channelId: string,
    messageId: string,
    emoji: string,
    userId: string,
    withTask?: boolean,
  ): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    const { token, currentUser } = getState().user;
    const { reactionMap } = getState().export.exportMaps;
    const { messages, filteredMessages } = getState().message;
    const message = messages.find((m) => m.id === messageId);
    const reaction = message?.reactions?.find(
      (r) => getEncodedEmoji(r.emoji) === emoji,
    );
    const isBurst = !!reactionMap[messageId]?.[emoji]?.find(
      (r) => r.id === currentUser?.id,
    )?.burst;
    let success = false;

    if (token && message && reaction) {
      if (withTask) {
        dispatch(setIsModifying(true));
      }

      await dispatch(liftThreadRestrictions(channelId, []));
      success = await dispatch(
        deleteRawReaction(channelId, messageId, emoji, userId),
      );
      if (success) {
        const updatedMessage = {
          ...message,

          reactions: message.reactions
            ?.map((r) => {
              if (getEncodedEmoji(r.emoji) === emoji) {
                return {
                  ...r,
                  count_details: {
                    ...r.count_details,
                    normal: r.count_details.normal - (isBurst ? 0 : 1),
                    burst: r.count_details.burst - (isBurst ? 1 : 0),
                  },
                };
              }
              return r;
            })
            ?.filter((r) => r.count_details.normal || r.count_details.burst),
        };
        const updatedMessages = messages.map((m) => {
          if (m.id === messageId) {
            return updatedMessage;
          }
          return m;
        });
        const updatedFilterMessages = filteredMessages.map((message) =>
          message.id === updatedMessage.id ? updatedMessage : message,
        );
        dispatch(setMessages(updatedMessages));
        dispatch(setFilteredMessages(updatedFilterMessages));
      }
      if (withTask) {
        dispatch(setIsModifying(false));
      }
    }
    return success;
  };

export const deleteAttachment =
  (attachment: Attachment): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const message = getState().app.task.entity;
    if (isMessage(message)) {
      const shouldEdit =
        (message.content && message.content.length > 0) ||
        message.attachments.length > 1;

      await dispatch(liftThreadRestrictions(message.channel_id, []));

      dispatch(setIsModifying(true));
      if (shouldEdit) {
        const updatedMessage = {
          ...message,
          attachments: message.attachments.filter(
            (attch) => attch.id !== attachment.id,
          ),
        };
        const success = await dispatch(updateMessage(updatedMessage));
        if (!success) {
          await dispatch(
            notify({
              message: ATTACHMENT_REQUIRES_ENTIRE_MSG_REMOVAL,
              timeout: 0.5,
            }),
          );
        } else {
          dispatch(setModifyEntity(updatedMessage));
        }
      } else {
        const success = await dispatch(deleteMessage(message));
        if (!success) {
          await dispatch(
            notify({
              message: MISSING_PERMISSION_ATTACHMENT,
              timeout: 0.5,
            }),
          );
        } else {
          dispatch(setModifyEntity(null));
        }
      }
      dispatch(setIsModifying(false));
    }
  };

/**
 * Update a message without changing Message State
 * @param message
 * @returns The result of the update
 */
export const updateRawMessage =
  (message: Message): AppThunk<Promise<{ success: boolean; data: Message }>> =>
  async (_dispatch, getState) => {
    const { settings } = getState().app;
    const { token } = getState().user;
    let retObj = { success: false, data: message };

    if (token) {
      const { success, data } = await new DiscordService(settings).editMessage(
        token,
        message.id,
        {
          content: message.content,
          attachments: message.attachments,
        },
        message.channel_id,
      );
      if (success && data) {
        retObj = { ...retObj, success: true, data };
      }
    }

    return retObj;
  };

export const updateMessage =
  (message: Message): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    const { entity: modifyMessage } = getState().app.task;

    if (isMessage(modifyMessage)) {
      const { success, data } = await dispatch(updateRawMessage(message));

      if (success && data) {
        const { messages, filteredMessages } = getState().message;
        const updatedMessage = data;
        const updatedMessages = messages.map((message) =>
          message.id === updatedMessage.id ? updatedMessage : message,
        );
        const updatedFilterMessages = filteredMessages.map((message) =>
          message.id === updatedMessage.id ? updatedMessage : message,
        );
        const updatedModifyMessage =
          modifyMessage?.id === updatedMessage.id
            ? updatedMessage
            : modifyMessage;

        dispatch(setMessages(updatedMessages));
        dispatch(setFilteredMessages(updatedFilterMessages));
        dispatch(setModifyEntity(updatedModifyMessage));

        return true;
      }
    }
    return false;
  };

export const editMessages =
  (messages: Message[], updateText: string): AppThunk =>
  async (dispatch, getState) => {
    dispatch(setIsModifying(true));
    let noPermissionThreadIds: string[] = [];
    for (const message of messages) {
      if (await dispatch(isAppStopped())) break;

      noPermissionThreadIds = await dispatch(
        liftThreadRestrictions(message.channel_id, noPermissionThreadIds),
      );

      dispatch(setModifyEntity(message));

      const isMissingPermission = noPermissionThreadIds.some(
        (tId) => tId === message.channel_id,
      );
      if (isMissingPermission) {
        await dispatch(
          notify({
            message: "Permission missing for message, skipping edit",
            timeout: 1,
          }),
        );
      } else {
        let success = false;

        if (!getState().app.discrubCancelled) {
          success = await dispatch(
            updateMessage({
              ...message,
              content: updateText,
            }),
          );
        }

        if (!success) {
          await dispatch(
            notify({
              message: "You do not have permission to modify this message!",
              timeout: 2,
            }),
          );
        }
      }
    }
    dispatch(resetModify());
    dispatch(setDiscrubCancelled(false));
  };

/**
 * Delete a message without updating Message State
 * @param message
 * @returns The result of the deletion
 */
export const deleteRawMessage =
  (message: Message): AppThunk<Promise<boolean>> =>
  async (_dispatch, getState) => {
    const { settings } = getState().app;
    const { token } = getState().user;

    if (token) {
      const { success } = await new DiscordService(settings).deleteMessage(
        token,
        message.id,
        message.channel_id,
      );
      if (success) {
        return true;
      }
    }

    return false;
  };

export const deleteMessage =
  (message: Message): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    const result = await dispatch(deleteRawMessage(message));

    if (result) {
      const { messages, filteredMessages, selectedMessages } =
        getState().message;
      const updatedMessages = messages.filter(
        ({ id: messageId }) => messageId !== message.id,
      );
      const updatedFilterMessages = filteredMessages.filter(
        ({ id: messageId }) => messageId !== message.id,
      );
      const updatedSelectMessages = selectedMessages.filter(
        (messageId) => messageId !== message.id,
      );

      dispatch(setMessages(updatedMessages));
      dispatch(setFilteredMessages(updatedFilterMessages));
      dispatch(setSelected(updatedSelectMessages));
    }

    return result;
  };

export const deleteMessages =
  (
    messages: Message[],
    deleteConfig: DeleteConfiguration = {
      attachments: true,
      messages: true,
      reactions: false,
      reactingUserIds: [],
      emojis: [],
    },
  ): AppThunk =>
  async (dispatch, getState) => {
    dispatch(setIsModifying(true));
    let noPermissionThreadIds: string[] = [];

    // Check if operation can end early
    const canEndEarly =
      deleteConfig.reactions && !messages.some((m) => m.reactions?.length);
    if (canEndEarly) {
      return;
    }
    // -------------------------------

    for (const [count, currentRow] of messages.entries()) {
      if (await dispatch(isAppStopped())) break;

      noPermissionThreadIds = await dispatch(
        liftThreadRestrictions(currentRow.channel_id, noPermissionThreadIds),
      );

      dispatch(
        setModifyEntity({
          ...currentRow,
          _index: count + 1,
          _total: messages.length,
        }),
      );
      const isMissingPermission = noPermissionThreadIds.some(
        (tId) => tId === currentRow.channel_id,
      );
      if (isMissingPermission) {
        await dispatch(
          notify({
            message: MISSING_PERMISSION_SKIPPING,
            timeout: 1,
          }),
        );
      } else {
        const shouldDelete =
          isRemovableMessage(currentRow) &&
          ((deleteConfig.attachments && deleteConfig.messages) ||
            (currentRow.content.length === 0 && deleteConfig.attachments) ||
            (currentRow.attachments.length === 0 && deleteConfig.messages));
        const shouldEdit = deleteConfig.attachments || deleteConfig.messages;
        const shouldUnReact =
          deleteConfig.reactions &&
          deleteConfig.reactingUserIds.length &&
          deleteConfig.emojis.length;

        if (shouldDelete) {
          if (await dispatch(isAppStopped())) break;
          const success = await dispatch(deleteMessage({ ...currentRow }));

          if (!success) {
            await dispatch(
              notify({
                message: MISSING_PERMISSION_TO_MODIFY,
                timeout: 2,
              }),
            );
          }
        } else if (shouldEdit) {
          if (await dispatch(isAppStopped())) break;
          const success = await dispatch(
            updateMessage({
              ...currentRow,
              ...(deleteConfig.attachments
                ? { attachments: [] }
                : { content: "" }),
            }),
          );
          if (!success) {
            await dispatch(
              notify({
                message: MISSING_PERMISSION_TO_MODIFY,
                timeout: 2,
              }),
            );
          }
        } else if (shouldUnReact) {
          if (await dispatch(isAppStopped())) break;
          const { reactionMap, userMap } = getState().export.exportMaps;
          const { task } = getState().app;
          const reactionMapping = reactionMap[currentRow.id] || {};
          for (const userId of deleteConfig.reactingUserIds) {
            for (const emoji of deleteConfig.emojis) {
              if (await dispatch(isAppStopped())) break;
              const foundReaction = reactionMapping[emoji]?.find(
                (er) => er.id === userId,
              );
              if (foundReaction) {
                const userMapping = userMap[userId];
                dispatch(
                  setModifyEntity({
                    ...task.entity,
                    _data1: userId,
                    _data2: emoji,
                  }),
                );
                const success = await dispatch(
                  deleteReaction(
                    currentRow.channel_id,
                    currentRow.id,
                    emoji,
                    userId,
                  ),
                );
                if (!success) {
                  await dispatch(
                    notify({
                      message: `${REACTION_REMOVE_FAILED_FOR} ${userMapping?.userName || userId}`,
                      timeout: 2,
                    }),
                  );
                }
              }
            }
          }
        } else break;
      }
    }
    dispatch(resetModify());
    dispatch(setDiscrubCancelled(false));
  };

export const resetMessageData = (): AppThunk => (dispatch) => {
  dispatch(_resetMessageData());
  dispatch(resetThreads());
  dispatch(resetExportMaps(["reactionMap"]));
  dispatch(resetStatus());
};

/**
 * Generic pagination helper for fetching data with cursor-based pagination
 * @param fetchFn - Function that fetches a page of data given the last ID
 * @param onBatch - Optional callback to process each batch of results
 * @param pageSize - Expected page size to determine if we've reached the end (default: 100)
 */
const _paginatedFetch =
  <T extends { id: string }>(
    fetchFn: (
      lastId: string | null,
    ) => Promise<{ success: boolean; data?: T[] }>,
    onBatch?: (batch: T[]) => void | Promise<void>,
    pageSize = 100,
  ): AppThunk<Promise<T[]>> =>
  async (dispatch) => {
    const allResults: T[] = [];
    let lastId: string | null = null;
    let reachedEnd = false;

    while (!reachedEnd) {
      if (await dispatch(isAppStopped())) break;

      const { success, data } = await fetchFn(lastId);

      if (success && data && data.length > 0) {
        allResults.push(...data);
        lastId = data[data.length - 1].id;

        // Call batch processor if provided
        if (onBatch) {
          await onBatch(data);
        }

        // Check if we've reached the end (received less than a full page)
        if (data.length < pageSize) {
          reachedEnd = true;
        }
      } else {
        reachedEnd = true;
      }
    }

    return allResults;
  };

const _fetchReactingUserIds =
  (
    message: Message,
    encodedEmoji: string,
  ): AppThunk<Promise<ExportReaction[]>> =>
  async (dispatch, getState) => {
    const exportReactions: ExportReaction[] = [];
    const { settings } = getState().app;
    const { token } = getState().user;

    if (!token) return exportReactions;

    for (const type of [ReactionType.NORMAL, ReactionType.BURST]) {
      const isBurst = type === ReactionType.BURST;

      // Use pagination helper to fetch all users who reacted with this type
      const users = await dispatch(
        _paginatedFetch<User>(
          (lastId) =>
            new DiscordService(settings).getReactions(
              token,
              message.channel_id,
              message.id,
              encodedEmoji,
              type,
              lastId,
            ),
          (batch) => {
            // Update user map incrementally as we process each batch
            const { userMap } = getState().export.exportMaps;
            const updateMap = { ...userMap };
            batch.forEach((u) => {
              updateMap[u.id] = {
                ...getUserMappingData(u),
                guilds: updateMap[u.id]?.guilds || {},
              };
            });
            dispatch(setExportUserMap(updateMap));
          },
        ),
      );

      // Convert users to ExportReaction objects
      users.forEach((u) => {
        exportReactions.push({
          id: u.id,
          burst: isBurst,
        });
      });
    }

    return exportReactions;
  };

const _generateReactionMap =
  (messages: Message[]): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const reactionMap: ExportReactionMap = {};
    const { token } = getState().user;
    const filteredMessages = messages.filter((m) => !!m.reactions?.length);
    for (const [mI, message] of filteredMessages.entries()) {
      reactionMap[message.id] = {};
      if (await dispatch(isAppStopped())) break;

      if (message.reactions?.length && token) {
        for (const [_i, reaction] of message.reactions.entries()) {
          const { emoji } = reaction;
          const encodedEmoji = getEncodedEmoji(emoji);

          dispatch(
            setStatus(
              StatusMessages.retrievingReactionUsers(
                emoji.name || "unknown",
                mI + 1,
                filteredMessages.length,
                !!emoji.id,
              ),
            ),
          );

          if ((await dispatch(isAppStopped())) || !encodedEmoji) break;

          reactionMap[message.id][encodedEmoji] = await dispatch(
            _fetchReactingUserIds(message, encodedEmoji),
          );
        }
      }
    }
    dispatch(resetStatus());
    dispatch(setExportReactionMap(reactionMap));
  };

/**
 * Retrieve message data without mutating MessageState
 * @param guildId
 * @param channelId
 * @param options
 */
export const retrieveMessages =
  (
    guildId: string | null,
    channelId: string | null,
    options: Partial<MessageSearchOptions> = {},
  ): AppThunk<Promise<MessageData & Partial<SearchResultData>>> =>
  async (dispatch, getState) => {
    const { token } = getState().user;
    const { settings } = getState().app;
    const searchCriteria: SearchCriteria = {
      ...getState().message.searchCriteria,
      ...(options.searchCriteriaOverrides || {}),
    };

    let payload: MessageData & Partial<SearchResultData> = {
      messages: [],
      threads: [],
      totalMessages: 0,
      offset: 0,
      searchCriteria: searchCriteria,
    };

    if (token) {
      if (isCriteriaActive(searchCriteria)) {
        payload = await dispatch(
          _getSearchMessages(channelId, guildId, searchCriteria, options),
        );
      } else if (channelId) {
        payload = await dispatch(_getMessages(channelId));
      }

      if (!getState().app.discrubCancelled) {
        const isReactionRemovalMode = !!settings.purgeReactionRemovalFrom;
        const reactionsEnabled = stringToBool(settings.reactionsEnabled);
        const requiresReactionMap =
          isReactionRemovalMode ||
          (!options.excludeReactions && reactionsEnabled);
        if (requiresReactionMap) {
          await dispatch(_generateReactionMap(payload.messages));
        }
        if (!options.excludeUserLookups) {
          await dispatch(_enrichAllUserData(payload.messages, guildId));
          if (guildId) {
            dispatch(getPreFilterUsers(guildId));
          }
        }
      }
      dispatch(resetStatus());
    }

    return payload;
  };

export const getMessageData =
  (
    guildId: string | null,
    channelId: string | null,
    options: Partial<MessageSearchOptions> = {},
  ): AppThunk<Promise<MessageData & Partial<SearchResultData>>> =>
  async (dispatch, _getState) => {
    dispatch(resetMessageData());
    dispatch(setIsLoading(true));

    const payload = await dispatch(
      retrieveMessages(guildId, channelId, options),
    );

    dispatch(setThreads(payload.threads));
    dispatch(setMessages(getSortedMessages(payload.messages)));
    dispatch(setIsLoading(false));
    dispatch(resetStatus());

    dispatch(setDiscrubCancelled(false)); // TODO: What if we are exporting?

    return payload;
  };

/**
 * Consolidated user data enrichment function
 * Collects user IDs from messages, mentions, and reactions, then enriches with display names and guild data
 * @param messages - Messages to extract user data from
 * @param guildId - Guild ID for fetching server-specific data (nicknames, roles, etc.)
 */
const _enrichAllUserData =
  (messages: Message[], guildId: string | null): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const { userMap: existingUserMap, reactionMap } =
      getState().export.exportMaps;
    const { settings } = getState().app;
    const { token } = getState().user;
    const { appUserDataRefreshRate, displayNameLookup, serverNickNameLookup } =
      settings;

    if (!token) return;

    const defaultMapping = {
      userName: null,
      displayName: null,
      avatar: null,
      guilds: {},
    };

    // Step 1: Collect all user IDs from messages, mentions, and reactions
    const userMap: ExportUserMap = {};
    const reactionsEnabled = stringToBool(settings.reactionsEnabled);

    messages.forEach((message) => {
      const { content, author, reactions } = message;
      const userId = author.id;

      // Add message author
      if (!userMap[userId]) {
        userMap[userId] = existingUserMap[userId] || {
          ...defaultMapping,
          userName: author.username,
          displayName: author.global_name,
          avatar: author.avatar,
        };
      }

      // Add mentioned users
      Array.from(content.matchAll(MessageRegex.USER_MENTION))?.forEach(
        ({ groups: userMentionGroups }) => {
          const mentionId = userMentionGroups?.user_id;
          if (mentionId && !userMap[mentionId]) {
            userMap[mentionId] = existingUserMap[mentionId] || defaultMapping;
          }
        },
      );

      // Add reacting users
      if (reactionsEnabled) {
        for (const reaction of reactions || []) {
          const encodedEmoji = getEncodedEmoji(reaction.emoji);
          if (encodedEmoji) {
            const exportReactions =
              reactionMap[message.id]?.[encodedEmoji] || [];
            exportReactions.forEach(({ id: reactingUserId }) => {
              if (!userMap[reactingUserId]) {
                userMap[reactingUserId] =
                  existingUserMap[reactingUserId] || defaultMapping;
              }
            });
          }
        }
      }
    });

    // Step 2: Enrich user data (display names and guild data) in a single loop
    const updateMap = { ...userMap };
    const userIds = Object.keys(updateMap);
    const shouldFetchDisplayNames = stringToBool(displayNameLookup);
    const shouldFetchGuildData = guildId && stringToBool(serverNickNameLookup);

    for (const userId of userIds) {
      if (await dispatch(isAppStopped())) break;

      const currentMapping = existingUserMap[userId] || updateMap[userId];
      const { userName, displayName, timestamp, guilds } = currentMapping;

      // Check if user display name needs fetching
      const needsDisplayName =
        shouldFetchDisplayNames &&
        ((!userName && !displayName) ||
          isUserDataStale(timestamp, appUserDataRefreshRate));

      // Check if guild data needs fetching
      const needsGuildData =
        shouldFetchGuildData &&
        (!guilds[guildId] ||
          isUserDataStale(guilds[guildId]?.timestamp, appUserDataRefreshRate));

      // Fetch display name if needed
      if (needsDisplayName) {
        dispatch(
          setStatus(StatusMessages.retrievingUserAlias(userName || userId)),
        );
        const { success, data } = await new DiscordService(settings).getUser(
          token,
          userId,
        );
        if (success && data) {
          updateMap[userId] = {
            ...currentMapping,
            ...getUserMappingData(data),
          };
        } else {
          console.error(`Unable to retrieve data from userId: ${userId}`);
        }
      }

      // Fetch guild data if needed
      if (needsGuildData) {
        const updatedMapping = updateMap[userId];
        dispatch(
          setStatus(
            StatusMessages.retrievingServerData(
              updatedMapping.userName || userId,
            ),
          ),
        );
        const { success, data } = await new DiscordService(
          settings,
        ).fetchGuildUser(guildId, userId, token);

        if (success && data) {
          updateMap[userId] = {
            ...updatedMapping,
            guilds: {
              ...updatedMapping.guilds,
              [guildId]: getGMOMappingData(data),
            },
          };
        } else {
          console.error(
            `Unable to retrieve guild user data from userId ${userId} and guildId ${guildId}`,
          );
          updateMap[userId] = {
            ...updatedMapping,
            guilds: {
              ...updatedMapping.guilds,
              [guildId]: defaultGMOMappingData,
            },
          };
        }
      }
    }

    // Step 3: Single dispatch to update the user map
    dispatch(resetStatus());
    dispatch(setExportUserMap({ ...existingUserMap, ...updateMap }));
  };

/**
 * Attempt to resolve reaction data for the provided messages. Used for when messages are obtained using Discords search API
 * @param messages
 */
const _resolveMessageReactions =
  (messages: Message[]): AppThunk<Promise<Message[]>> =>
  async (dispatch, getState) => {
    const { settings } = getState().app;
    const { token } = getState().user;
    const trackMap: Record<string, Reaction[]> = {};
    let retArr: Message[] = [...messages];

    if (token) {
      for (const [i, message] of messages.entries()) {
        if (await dispatch(isAppStopped())) break;

        if (!trackMap[message.id]) {
          dispatch(
            setStatus(
              StatusMessages.searchingReactions(i + 1, messages.length),
            ),
          );
          const { success, data } = await new DiscordService(
            settings,
          ).fetchMessageData(
            token,
            message.id,
            message.channel_id,
            QueryStringParam.AROUND,
          );

          if (success && data) {
            data.forEach((m) => {
              trackMap[m.id] = m.reactions || [];
            });
          }
        }
      }
      dispatch(resetStatus());
      retArr = messages.map((message) => ({
        ...message,
        reactions: trackMap[message.id],
      }));
    }

    return retArr;
  };

/**
 * Calculate the next search offset and criteria for paginated search
 * @param message - Last message from current batch (used for timestamp when resetting offset)
 * @param offset - Current search offset
 * @param totalMessages - Total messages available
 * @param isEndConditionMet - Whether end condition was already met
 * @param searchCriteria - Current search criteria
 * @param endOffSet - Optional limit on how far to search
 */
const _getNextSearchData = (
  message: Message,
  offset: number,
  totalMessages: number,
  isEndConditionMet: boolean,
  searchCriteria: SearchCriteria,
  endOffSet?: number,
) => {
  const nextOffSet = offset + OFFSET_INCREMENT;

  // Check completion conditions
  const reachedEndOffset =
    !!endOffSet && isSearchComplete(nextOffSet, endOffSet);
  const reachedAllResults = isSearchComplete(nextOffSet, totalMessages);
  const shouldStop = isEndConditionMet || reachedEndOffset || reachedAllResults;

  // Handle max offset - need to reset with new before date
  if (offset === MAX_OFFSET) {
    return {
      offset: START_OFFSET,
      isEndConditionMet: shouldStop,
      searchCriteria: {
        ...searchCriteria,
        searchBeforeDate: parseISO(message.timestamp),
      },
    };
  }

  // Continue with next offset or reset if all results found
  return {
    offset: reachedAllResults ? START_OFFSET : nextOffSet,
    isEndConditionMet: shouldStop,
    searchCriteria,
  };
};

const _getNextSearchStatus = (
  threads: Channel[],
  messages: Message[],
  totalMessages: number,
  channel?: Channel,
) => {
  if (isGuildForum(channel)) {
    return StatusMessages.retrievedThreads(threads.length);
  } else {
    return StatusMessages.retrievedSearchResults(
      messages.length,
      totalMessages,
    );
  }
};

/**
 * Find a channel by ID across both guild channels and DMs
 * @param channelId - The channel ID to search for
 */
const _findChannel =
  (channelId: string | null): AppThunk<Channel | undefined> =>
  (_, getState) => {
    if (!channelId) return undefined;
    const { channels } = getState().channel;
    const { dms } = getState().dm;
    return [...channels, ...dms].find((c) => c.id === channelId);
  };

const _getSearchMessages =
  (
    channelId: string | null,
    guildId: string | null,
    searchCriteria: SearchCriteria,
    {
      excludeReactions,
      startOffSet,
      endOffSet,
    }: Partial<MessageSearchOptions> = {},
  ): AppThunk<Promise<MessageData & SearchResultData>> =>
  async (dispatch, getState) => {
    const { settings } = getState().app;
    const { token } = getState().user;
    const channel = dispatch(_findChannel(channelId));

    let knownMessages: Message[] = [];
    let knownThreads: Channel[] = [];
    let { offset, isEndConditionMet, criteria, totalMessages } = {
      offset: startOffSet || 0,
      isEndConditionMet: false,
      criteria: { ...searchCriteria },
      totalMessages: 0,
    };

    if (token) {
      while (!isEndConditionMet) {
        if (await dispatch(isAppStopped())) break;

        const { success, data } = await new DiscordService(
          settings,
        ).fetchSearchMessageData(token, offset, channelId, guildId, criteria);

        if (success && data) {
          let { total_results, messages = [], threads = [] } = data;
          const isResultsFound = !!total_results || messages.length > 0;

          // Ensure totalMessages is up-to-date so that _getSearchData can assign the correct offset
          totalMessages = total_results;

          if (!isResultsFound) {
            break;
          }

          for (const t of threads) {
            const isKnownThread = knownThreads.some((k) => k.id === t.id);
            if (!isKnownThread) {
              knownThreads = [...knownThreads, t];
            }
          }

          messages = messages.flat();
          const lastMessage = messages[messages.length - 1];
          ({
            isEndConditionMet,
            offset,
            searchCriteria: criteria,
          } = _getNextSearchData(
            lastMessage,
            offset,
            totalMessages,
            isEndConditionMet,
            criteria,
            endOffSet,
          ));

          knownMessages = [
            ...knownMessages,
            ...messages.filter((m) => _messageTypeAllowed(m.type)),
          ];

          const status = _getNextSearchStatus(
            knownThreads,
            knownMessages,
            totalMessages,
            channel,
          );
          dispatch(setStatus(status));
        } else {
          isEndConditionMet = true;
        }
      }

      const reactionsEnabled = stringToBool(settings.reactionsEnabled);
      const isReactionRemovalMode = !!settings.purgeReactionRemovalFrom;
      if (isReactionRemovalMode || (!excludeReactions && reactionsEnabled)) {
        knownMessages = await dispatch(_resolveMessageReactions(knownMessages));
      }
    }

    return {
      messages: knownMessages,
      threads: knownThreads,
      offset: offset, // The next offset to use for an additional search
      searchCriteria: criteria, // The Search Criteria at the time the search ended (mutated by _getNextSearchData)
      totalMessages: totalMessages, // The total amount of messages that exist for the search
    };
  };

const _messageTypeAllowed = (type: number) => {
  return [
    MessageType.DEFAULT,
    MessageType.CHANNEL_PINNED_MESSAGE,
    MessageType.USER_JOIN,
    MessageType.GUILD_BOOST,
    MessageType.GUILD_BOOST_TIER_1,
    MessageType.GUILD_BOOST_TIER_2,
    MessageType.GUILD_BOOST_TIER_3,
    MessageType.CHANNEL_FOLLOW_ADD,
    MessageType.THREAD_CREATED,
    MessageType.REPLY,
    MessageType.CHAT_INPUT_COMMAND,
    MessageType.GUILD_INVITE_REMINDER,
    MessageType.CONTEXT_MENU_COMMAND,
    MessageType.AUTO_MODERATION_ACTION,
    MessageType.CALL,
  ].some((t) => messageTypeEquals(type, t));
};

const _getMessages =
  (channelId: string): AppThunk<Promise<MessageData>> =>
  async (dispatch, getState) => {
    const { searchCriteria } = getState().message;
    const channel = dispatch(_findChannel(channelId));
    const trackedThreads: Channel[] = [];
    let messages: Message[] = [];

    if (channel) {
      if (isGuildForum(channel)) {
        const { threads } = await dispatch(
          _getSearchMessages(
            channelId,
            channel.guild_id || null,
            searchCriteria,
          ),
        );
        threads.forEach((t) => {
          if (!trackedThreads.some((tt) => tt.id === t.id)) {
            trackedThreads.push(t);
          }
        });
      } else {
        messages = [
          ...messages,
          ...(await dispatch(_getMessagesFromChannel(channelId))),
        ];
      }

      if (!isDm(channel)) {
        const threadsFromMessages = getThreadsFromMessages({
          messages,
          knownThreads: trackedThreads,
        });
        threadsFromMessages.forEach((ft) => trackedThreads.push(ft));

        const archivedThreads = await dispatch(
          getArchivedThreads({ channelId, knownThreads: trackedThreads }),
        );
        archivedThreads.forEach((at) => trackedThreads.push(at));

        for (const thread of trackedThreads) {
          dispatch(
            setStatus(
              StatusMessages.retrievingThreadMessages(
                getThreadEntityName(thread),
              ),
            ),
          );
          messages = [
            ...messages,
            ...(await dispatch(_getMessagesFromChannel(thread.id))),
          ];
        }
      }
    }
    return {
      messages,
      threads: trackedThreads,
    };
  };

const _getMessagesFromChannel =
  (channelId: string): AppThunk<Promise<Message[]>> =>
  async (dispatch, getState) => {
    const { settings } = getState().app;
    const { token } = getState().user;

    if (!token) return [];

    let messageCount = 0;
    const messages = await dispatch(
      _paginatedFetch<Message>(
        (lastId) =>
          new DiscordService(settings).fetchMessageData(
            token,
            lastId || "",
            channelId,
          ),
        (batch) => {
          // Only update status if batch has valid messages
          const hasValidMessages = batch[0]?.content || batch[0]?.attachments;
          if (hasValidMessages) {
            messageCount += batch.length;
            dispatch(setStatus(StatusMessages.retrievedMessages(messageCount)));
          }
        },
      ),
    );

    // Filter to only allowed message types
    return messages.filter((m) => _messageTypeAllowed(m.type));
  };

export default messageSlice.reducer;
