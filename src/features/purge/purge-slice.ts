import { createSlice } from "@reduxjs/toolkit";
import { retrieveMessages } from "../message/message-slice";
import { liftThreadRestrictions } from "../thread/thread-slice";
import {
  isAppStopped,
  resetModify,
  setDiscrubCancelled,
  setIsModifying,
  setModifyEntity,
} from "../app/app-slice";
import { PurgeState } from "./purge-types";
import { AppThunk } from "../../app/store";
import type { Channel, Message, Guild } from "discrub-lib/types/discord-types";
import { isSearchComplete } from "discrub-lib/discrub-utils";
import { isGuild } from "discrub-lib/discrub-guards";
import { MessageData, SearchResultData } from "../message/message-types.ts";
import { OFFSET_INCREMENT, START_OFFSET } from "../message/contants.ts";
import {
  PurgeService,
  DiscordServiceAdapter,
  ThreadManagerAdapter,
  ModificationProgressManagerAdapter,
} from "discrub-lib/messages";

const initialState: PurgeState = {
  isLoading: null,
};

/**
 * Helper to create PurgeService for purge operations
 */
const createPurgeService = (dispatch: any, getState: () => any) => {
  const state = getState();
  const { token, currentUser } = state.user;
  const { settings } = state.app;
  const { purgeRetainAttachedMedia, purgeReactionRemovalFrom } = settings;
  const { reactionMap } = state.export.exportMaps;

  if (!token) {
    throw new Error("No token available");
  }

  const apiClient = new DiscordServiceAdapter(settings);
  const threadManager = ThreadManagerAdapter.fromReduxDispatch(
    async (channelId: string, knownNoPermissionIds: string[]) =>
      await dispatch(liftThreadRestrictions(channelId, knownNoPermissionIds)),
  );
  const progressManager = ModificationProgressManagerAdapter.fromReduxDispatch(
    (isModifying: boolean) => dispatch(setIsModifying(isModifying)),
    (entity: any) => dispatch(setModifyEntity(entity)),
  );

  return new PurgeService({
    apiClient,
    token,
    threadManager,
    progressManager,
    currentUserId: currentUser?.id,
    existingReactionMap: reactionMap,
    shouldStop: async () => await dispatch(isAppStopped()),
    settings: {
      retainAttachedMedia: purgeRetainAttachedMedia === "true",
      reactionRemovalFrom: purgeReactionRemovalFrom
        ? purgeReactionRemovalFrom.split(",").filter((id: string) => id.trim())
        : [],
    },
  });
};

export const purgeSlice = createSlice({
  name: "purge",
  initialState: initialState,
  reducers: {
    setIsLoading: (state, { payload }: { payload: boolean }): void => {
      state.isLoading = payload;
    },
  },
});

export const { setIsLoading } = purgeSlice.actions;

/**
 * Purge messages from an array of DMs or Guilds.
 * @param entities
 */
export const purge =
  (entities: Channel[] | Guild[]): AppThunk =>
  async (dispatch, getState) => {
    const { searchCriteria } = getState().message;

    dispatch(setIsModifying(true));
    for (const entity of entities) {
      if (await dispatch(isAppStopped())) break;
      let payload: MessageData & Partial<SearchResultData> = {
        messages: [],
        threads: [],
        totalMessages: 0,
        offset: START_OFFSET,
        searchCriteria: searchCriteria,
      };

      const guildId = isGuild(entity) ? entity.id : null;
      const channelId = isGuild(entity) ? null : entity.id;

      let isResetPurge = false;
      let skipThreadIds: string[] = [];
      const trackedMessageIds: string[] = [];
      let trackedTotalMessages = payload.totalMessages;

      do {
        const offset = payload.offset || START_OFFSET;

        // Prepare to end Purge if no new messages are found on next reset
        if (offset === START_OFFSET) isResetPurge = true;
        //

        dispatch(
          setModifyEntity({ _offset: offset, _total: payload.totalMessages }),
        );

        const options = {
          excludeReactions: true,
          excludeUserLookups: true,
          startOffSet: offset,
          endOffSet: offset + OFFSET_INCREMENT,
          searchCriteriaOverrides: { ...(payload.searchCriteria || {}) },
        };

        payload = await dispatch(retrieveMessages(guildId, channelId, options));

        // Check if Discord search total_results has updated
        const isTotalMessagesUpdated =
          trackedTotalMessages !== START_OFFSET &&
          payload.totalMessages !== trackedTotalMessages;
        if (isTotalMessagesUpdated) {
          payload.offset = START_OFFSET; // Since messages have shifted, we should reset the offset
          isResetPurge = false; // Since messages have shifted, Purge should not end
        }
        //

        // Capture the total amount of messages found by the search
        trackedTotalMessages = payload.totalMessages;
        //

        // Message ids where a delete attempt should not occur
        const skipMessageIds = [...trackedMessageIds];
        //

        payload.messages.forEach((m) => {
          if (!trackedMessageIds.some((id) => id === m.id)) {
            trackedMessageIds.push(m.id);
            isResetPurge = false; // Unique Messages still exist, Purge should not end
          }
        });

        // We have restarted twice without seeing a unique message, Purge is complete.
        if (payload.offset === START_OFFSET && isResetPurge) break;
        //

        const result = await dispatch(
          _purgeMessages(payload.messages, skipThreadIds, skipMessageIds, {
            totalMessages: payload.totalMessages,
          }),
        );
        skipThreadIds = result.skipThreadIds;
      } while (!isSearchComplete(payload.offset, payload.totalMessages));
    }
    dispatch(resetModify());
    dispatch(setDiscrubCancelled(false));
  };

export const _purgeMessages =
  (
    messages: Message[],
    skipThreadIds: string[],
    skipMessageIds: string[],
    { totalMessages }: Partial<SearchResultData> = {},
  ): AppThunk<
    Promise<{ skipThreadIds: string[]; processedCount: number; removedCount: number }>
  > =>
  async (dispatch, getState) => {
    const purgeService = createPurgeService(dispatch, getState);
    return await purgeService.processMessages(
      messages,
      skipThreadIds,
      skipMessageIds,
      totalMessages,
    );
  };

export default purgeSlice.reducer;
