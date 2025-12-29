import { createSlice } from "@reduxjs/toolkit";
import {
  ArchivedThreadProps,
  ThreadState,
  ThreadsFromMessagesProps,
} from "./thread-types";
import { AppThunk } from "../../app/store";
import type { Channel } from "discrub-lib/types/discord-types";
import { DiscordService } from "discrub-lib/discord-service";
import { setStatus } from "../app/app-slice.ts";
import { getThreadEntityName, getThreadsFromMessages as getThreadsFromMessagesUtil, filterDuplicateThreads } from "discrub-lib/discrub-utils";

const initialState: ThreadState = { threads: [] };

export const threadSlice = createSlice({
  name: "thread",
  initialState: initialState,
  reducers: {
    setThreads: (state, { payload }: { payload: Channel[] }): void => {
      state.threads = payload;
    },
    resetThreads: (state): void => {
      state.threads = [];
    },
  },
});

export const { setThreads, resetThreads } = threadSlice.actions;

export const getArchivedThreads =
  ({
    channelId,
    knownThreads,
  }: ArchivedThreadProps): AppThunk<Promise<Channel[]>> =>
  async (dispatch, getState) => {
    const { token } = getState().user;
    const { discrubCancelled, settings } = getState().app;

    if (!discrubCancelled && token) {
      const threadArr: Channel[] = [];

      const { success: publicSuccess, data: publicData } =
        await new DiscordService(settings).fetchPublicThreads(token, channelId);
      const { success: privateSuccess, data: privateData } =
        await new DiscordService(settings).fetchPrivateThreads(
          token,
          channelId,
        );

      if (publicSuccess && publicData) {
        threadArr.push(...publicData.threads);
      }
      if (privateSuccess && privateData) {
        threadArr.push(...privateData.threads);
      }

      if (threadArr.length) {
        dispatch(setStatus(`Retrieved ${threadArr.length} archived threads`));
      }

      return filterDuplicateThreads(threadArr, knownThreads);
    } else {
      return [];
    }
  };

export const unarchiveThread =
  (threadId: string): AppThunk<Promise<Channel | null | undefined>> =>
  async (dispatch, getState) => {
    const { token } = getState().user;
    const { settings } = getState().app;
    if (threadId && token) {
      const { success, data } = await new DiscordService(settings).editChannel(
        token,
        threadId,
        {
          archived: false,
          locked: false,
        },
      );
      const { threads } = getState().thread;
      const foundThread = threads.find((t) => t.id === threadId);
      if (success) {
        if (data) {
          const status = `Successfully un-archived thread - ${getThreadEntityName(data)}`;
          dispatch(setStatus(status));
          dispatch(
            setThreads(
              threads.map((thread) => {
                if (thread.id === data.id) {
                  return data;
                } else return thread;
              }),
            ),
          );
        }
        return data;
      } else {
        const status = `Failed to un-archive thread - ${foundThread ? getThreadEntityName(foundThread) : threadId}`;
        dispatch(setStatus(status));
      }
    }
  };

/**
 * Attempt to lift restrictions for a Thread
 * @param threadId
 * @param skipIds An array of thread id that should be skipped
 * @param threads An optional array of Thread that can be referenced, only use this parameter to override the threads that exist in Thread State
 * @returns The skipIds array, appended with the thread ids that failed to have their restrictions lifted.
 */
export const liftThreadRestrictions =
  (
    threadId: string,
    skipIds: string[],
    threads?: Channel[],
  ): AppThunk<Promise<string[]>> =>
  async (dispatch, getState) => {
    const threadList = threads || getState().thread.threads;
    const foundThread = threadList.find((t) => t.id === threadId);
    const retArr = [...skipIds];
    const removeRestriction =
      foundThread &&
      (foundThread.thread_metadata?.archived ||
        foundThread.thread_metadata?.locked) &&
      !skipIds.some((skipId) => skipId === foundThread.id);

    if (removeRestriction) {
      const thread = await dispatch(unarchiveThread(foundThread.id));
      if (!thread) {
        retArr.push(foundThread.id);
      }
    }
    return retArr;
  };

export const getThreadsFromMessages = ({
  messages,
  knownThreads,
}: ThreadsFromMessagesProps): Channel[] => {
  return getThreadsFromMessagesUtil(messages, knownThreads);
};

export default threadSlice.reducer;
