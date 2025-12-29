import { createSlice } from "@reduxjs/toolkit";
import {
  getSortedMessages,
  sortBy,
  stringToBool,
} from "discrub-lib/discrub-utils";
import { MapUtils } from "discrub-lib/common-utils";
import {
  MessageRetrievalService,
  MessageModificationService,
  ReactionModificationService,
  DiscordServiceAdapter,
  ChannelProviderAdapter,
  ThreadProviderAdapter,
  ThreadManagerAdapter,
  NotificationManagerAdapter,
  ModificationProgressManagerAdapter,
  getEncodedEmoji,
} from "discrub-lib/messages";
import type {
  Attachment,
  Message,
  Channel,
} from "discrub-lib/types/discord-types";
import type { SearchCriteria, Filter } from "discrub-lib/types/discrub-types";
import { IsPinnedType } from "discrub-lib/discord-enum";
import { SortDirection } from "discrub-lib/common-enum";
import {
  getArchivedThreads,
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
import {
  filterMessages as discrubFilterMessages,
  updateFilters as discrubUpdateFilters,
} from "discrub-lib/filtering";
import {
  DeleteConfiguration,
  MessageData,
  MessageSearchOptions,
  MessageState,
  SearchResultData,
} from "./message-types";
import { AppThunk } from "../../app/store";
import { isMessage } from "discrub-lib/discrub-guards";
import {
  ATTACHMENT_REQUIRES_ENTIRE_MSG_REMOVAL,
  MISSING_PERMISSION_ATTACHMENT,
} from "./contants.ts";

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

/**
 * Helper to create common adapters for message services
 */
const createMessageAdapters = (dispatch: any, settings: any) => ({
  apiClient: new DiscordServiceAdapter(settings),
  threadManager: ThreadManagerAdapter.fromReduxDispatch(
    async (channelId: string, knownNoPermissionIds: string[]) =>
      await dispatch(liftThreadRestrictions(channelId, knownNoPermissionIds)),
  ),
  notificationManager: NotificationManagerAdapter.fromReduxDispatch(
    async (params: { message: string; timeout: number }) =>
      await dispatch(notify(params)),
  ),
  progressManager: ModificationProgressManagerAdapter.fromReduxDispatch(
    (isModifying: boolean) => dispatch(setIsModifying(isModifying)),
    (entity: any) => dispatch(setModifyEntity(entity)),
  ),
});

/**
 * Factory to create MessageModificationService
 */
const createMessageService = (dispatch: any, getState: () => any) => {
  const { token } = getState().user;
  const { settings } = getState().app;
  if (!token) return null;

  const adapters = createMessageAdapters(dispatch, settings);
  return new MessageModificationService({ ...adapters, token });
};

/**
 * Factory to create ReactionModificationService
 */
const createReactionService = (dispatch: any, getState: () => any) => {
  const { token, currentUser } = getState().user;
  const { settings } = getState().app;
  if (!token) return null;

  const adapters = createMessageAdapters(dispatch, settings);
  return new ReactionModificationService({
    apiClient: adapters.apiClient,
    token,
    threadManager: adapters.threadManager,
    currentUserId: currentUser?.id,
  });
};

/**
 * Helper to update a message in state by ID
 */
const updateMessageInState = (
  dispatch: any,
  getState: () => any,
  updatedMessage: Message,
) => {
  const { messages, filteredMessages } = getState().message;
  const updatedMessages = messages.map((m: Message) =>
    m.id === updatedMessage.id ? updatedMessage : m,
  );
  const updatedFilteredMessages = filteredMessages.map((m: Message) =>
    m.id === updatedMessage.id ? updatedMessage : m,
  );
  dispatch(setMessages(updatedMessages));
  dispatch(setFilteredMessages(updatedFilteredMessages));
};

/**
 * Helper to remove a message from state by ID
 */
const removeMessageFromState = (
  dispatch: any,
  getState: () => any,
  messageId: string,
) => {
  const { messages, filteredMessages, selectedMessages } = getState().message;
  const updatedMessages = messages.filter((m: Message) => m.id !== messageId);
  const updatedFilteredMessages = filteredMessages.filter(
    (m: Message) => m.id !== messageId,
  );
  const updatedSelectedMessages = selectedMessages.filter(
    (id: string) => id !== messageId,
  );
  dispatch(setMessages(updatedMessages));
  dispatch(setFilteredMessages(updatedFilteredMessages));
  dispatch(setSelected(updatedSelectedMessages));
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
      state.messages = sortBy(state.messages, orderBy, order);
      state.filteredMessages = sortBy(state.filteredMessages, orderBy, order);
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
      // Use the pure updateFilters function from discrub-lib
      state.filters = discrubUpdateFilters(state.filters, payload);
    },
  },
});

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
    const { threads } = getState().thread;

    // Use the pure filterMessages function from discrub-lib
    const result = discrubFilterMessages({
      messages: state.messages,
      filters: state.filters,
      threads,
      selectedMessageIds: state.selectedMessages,
    });

    dispatch(setFilteredMessages(result.filteredMessages));
    dispatch(setSelected(result.selectedMessageIds));
  };

/**
 * Update a message and update message state
 */
export const updateMessage =
  (message: Message): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    const service = createMessageService(dispatch, getState);
    if (!service) return false;

    const { success, data } = await service.editMessage(message, {
      content: message.content,
      attachments: message.attachments,
    });

    if (success && data) {
      updateMessageInState(dispatch, getState, data);

      const { entity: modifyMessage } = getState().app.task;
      if (
        modifyMessage &&
        isMessage(modifyMessage) &&
        modifyMessage.id === data.id
      ) {
        dispatch(setModifyEntity(data));
      }
      return true;
    }
    return false;
  };

/**
 * Delete a message and update message state
 */
export const deleteMessage =
  (message: Message): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    const service = createMessageService(dispatch, getState);
    if (!service) return false;

    const success = await service.deleteMessage(message);

    if (success) {
      removeMessageFromState(dispatch, getState, message.id);
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
    const state = getState();
    const { currentUser } = state.user;
    const { reactionMap } = state.export.exportMaps;
    const { messages } = state.message;
    const message = messages.find((m) => m.id === messageId);
    const reaction = message?.reactions?.find(
      (r) => getEncodedEmoji(r.emoji) === emoji,
    );
    const isBurst = !!reactionMap[messageId]?.[emoji]?.find(
      (r) => r.id === currentUser?.id,
    )?.burst;
    let success = false;

    if (!message || !reaction) return success;

    if (withTask) {
      dispatch(setIsModifying(true));
    }

    // Create service using factory
    const service = createReactionService(dispatch, getState);
    if (!service) return success;

    // Delete reaction using service
    success = await service.deleteReaction(channelId, messageId, emoji, userId);

    if (success) {
      // Update reaction map
      const updatedReactionMap = MapUtils.updateNested(
        reactionMap,
        messageId,
        emoji,
        (reactions) => reactions?.filter((er) => er.id !== userId) || [],
      );
      dispatch(setExportReactionMap(updatedReactionMap));

      // Update message reactions in state
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
      updateMessageInState(dispatch, getState, updatedMessage);
    }

    if (withTask) {
      dispatch(setIsModifying(false));
    }

    return success;
  };

export const deleteAttachment =
  (attachment: Attachment): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state = getState();
    const message = state.app.task.entity;

    if (!isMessage(message)) return;

    dispatch(setIsModifying(true));

    // Create service using factory
    const service = createMessageService(dispatch, getState);
    if (!service) {
      dispatch(setIsModifying(false));
      return;
    }

    // Delete attachment using service
    const { success, shouldDeleteMessage } = await service.deleteAttachment(
      message,
      attachment,
    );

    if (!success) {
      await dispatch(
        notify({
          message: shouldDeleteMessage
            ? MISSING_PERMISSION_ATTACHMENT
            : ATTACHMENT_REQUIRES_ENTIRE_MSG_REMOVAL,
          timeout: 0.5,
        }),
      );
    } else {
      if (shouldDeleteMessage) {
        // Message was deleted - remove from state
        removeMessageFromState(dispatch, getState, message.id);
        dispatch(setModifyEntity(null));
      } else {
        // Message was edited - update in state
        const updatedMessage = {
          ...message,
          attachments: message.attachments.filter(
            (attch) => attch.id !== attachment.id,
          ),
        };
        updateMessageInState(dispatch, getState, updatedMessage);
        dispatch(setModifyEntity(updatedMessage));
      }
    }

    dispatch(setIsModifying(false));
  };

export const editMessages =
  (messages: Message[], updateText: string): AppThunk =>
  async (dispatch, getState) => {
    const { token } = getState().user;
    const { settings } = getState().app;
    if (!token) return;

    // Create service with shouldStop callback
    const adapters = createMessageAdapters(dispatch, settings);
    const service = new MessageModificationService({
      ...adapters,
      token,
      shouldStop: async () => await dispatch(isAppStopped()),
    });

    // Edit messages using service
    await service.editMessages(messages, updateText);

    // Update messages in state
    for (const message of messages) {
      const { messages: stateMessages, filteredMessages } = getState().message;
      const updatedMessages = stateMessages.map((m) =>
        m.id === message.id ? { ...m, content: updateText } : m,
      );
      const updatedFilteredMessages = filteredMessages.map((m) =>
        m.id === message.id ? { ...m, content: updateText } : m,
      );
      dispatch(setMessages(updatedMessages));
      dispatch(setFilteredMessages(updatedFilteredMessages));
    }

    dispatch(resetModify());
    dispatch(setDiscrubCancelled(false));
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
    const state = getState();
    const { token, currentUser } = state.user;
    const { settings } = state.app;
    const { userMap, reactionMap } = state.export.exportMaps;

    if (!token) return;

    // Create service with additional configuration
    const adapters = createMessageAdapters(dispatch, settings);
    const service = new MessageModificationService({
      ...adapters,
      token,
      shouldStop: async () => await dispatch(isAppStopped()),
      currentUserId: currentUser?.id,
      existingReactionMap: reactionMap,
      existingUserMap: userMap,
    });

    // Delete messages using service
    await service.deleteMessages(messages, deleteConfig);

    // Update Redux state - remove deleted messages
    const {
      messages: stateMessages,
      filteredMessages,
      selectedMessages,
    } = getState().message;
    const updatedMessages = stateMessages.filter(
      (m) => !messages.some((dm) => dm.id === m.id),
    );
    const updatedFilteredMessages = filteredMessages.filter(
      (m) => !messages.some((dm) => dm.id === m.id),
    );
    const updatedSelectedMessages = selectedMessages.filter(
      (id) => !messages.some((dm) => dm.id === id),
    );

    dispatch(setMessages(updatedMessages));
    dispatch(setFilteredMessages(updatedFilteredMessages));
    dispatch(setSelected(updatedSelectedMessages));
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
 * Retrieve message data without mutating MessageState
 * Uses MessageRetrievalService from discrub-lib for all message fetching logic
 */
export const retrieveMessages =
  (
    guildId: string | null,
    channelId: string | null,
    options: Partial<MessageSearchOptions> = {},
  ): AppThunk<Promise<MessageData & Partial<SearchResultData>>> =>
  async (dispatch, getState) => {
    const state = getState();
    const { token } = state.user;
    const { settings } = state.app;
    const { userMap, reactionMap } = state.export.exportMaps;

    let payload: MessageData & Partial<SearchResultData> = {
      messages: [],
      threads: [],
      totalMessages: 0,
      offset: 0,
      searchCriteria: {
        ...state.message.searchCriteria,
        ...(options.searchCriteriaOverrides || {}),
      },
    };

    if (!token) {
      return payload;
    }

    // Create adapters for Redux integration
    const apiClient = new DiscordServiceAdapter(settings);
    const channelProvider = ChannelProviderAdapter.fromReduxState(state);
    const threadProvider = ThreadProviderAdapter.fromReduxDispatch(
      async (params: { channelId: string; knownThreads: Channel[] }) =>
        await dispatch(getArchivedThreads(params)),
    );

    // Create message retrieval service
    const service = new MessageRetrievalService({
      apiClient,
      token,
      settings: {
        reactionsEnabled: stringToBool(settings.reactionsEnabled),
        displayNameLookup: stringToBool(settings.displayNameLookup),
        serverNickNameLookup: stringToBool(settings.serverNickNameLookup),
        userDataRefreshRate: Number(settings.appUserDataRefreshRate),
        purgeReactionRemovalFrom: settings.purgeReactionRemovalFrom,
      },
      channelProvider,
      threadProvider,
      existingUserMap: userMap,
      existingReactionMap: reactionMap,
      onStatus: (status: string) => dispatch(setStatus(status)),
      shouldStop: async () => await dispatch(isAppStopped()),
    });

    // Retrieve messages using the service
    const result = await service.retrieveMessages(guildId, channelId, {
      searchCriteria: payload.searchCriteria,
      excludeReactions: options.excludeReactions,
      excludeUserLookups: options.excludeUserLookups,
      startOffset: options.startOffSet,
      endOffset: options.endOffSet,
    });

    // Update Redux state with enriched data
    dispatch(setExportUserMap(result.userMap));
    dispatch(setExportReactionMap(result.reactionMap));
    dispatch(resetStatus());

    if (guildId && !options.excludeUserLookups) {
      dispatch(getPreFilterUsers(guildId));
    }

    // Return payload in expected format
    return {
      messages: result.messages,
      threads: result.threads,
      totalMessages: result.totalMessages,
      offset: result.offset,
      searchCriteria: result.searchCriteria || payload.searchCriteria,
    };
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
    await dispatch(filterMessages());
    dispatch(setIsLoading(false));
    dispatch(resetStatus());

    dispatch(setDiscrubCancelled(false));

    return payload;
  };

export default messageSlice.reducer;
