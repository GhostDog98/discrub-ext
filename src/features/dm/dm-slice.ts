import { createSlice } from "@reduxjs/toolkit";
import { resetFilters, resetMessageData } from "../message/message-slice";
import type { Channel } from "discrub-lib/types/discord-types";
import { getDmName, getDmRecipients } from "discrub-lib/discrub-utils";
import { DmState, SetSelectedDmsProps } from "./dm-types";
import { AppThunk } from "../../app/store";
import { DiscordService } from "discrub-lib/discord-service";
import { resetPurgeRemovalFrom } from "../app/app-slice.ts";

const initialState: DmState = {
  dms: [],
  selectedDms: [],
  isLoading: null,
  preFilterUsers: [],
};

export const dmSlice = createSlice({
  name: "dm",
  initialState: initialState,
  reducers: {
    setIsLoading: (state, { payload }: { payload: boolean }): void => {
      state.isLoading = payload;
    },
    setDms: (state, { payload }: { payload: Channel[] }): void => {
      state.dms = payload.map((dm) => ({
        ...dm,
        name: getDmName(dm),
      }));
    },
    resetDm: (state): void => {
      state.preFilterUsers = [];
      state.selectedDms = [];
    },
    setSelectedDms: (
      state,
      { payload }: { payload: SetSelectedDmsProps },
    ): void => {
      const { dmIds, preFilterUser } = payload;
      const selectedDms = state.dms.filter((dm) =>
        dmIds.some((id) => id === dm.id),
      );

      state.selectedDms = selectedDms;
      const recipients = getDmRecipients(selectedDms);
      state.preFilterUsers = [...recipients, preFilterUser];
    },
  },
});

export const { setIsLoading, setDms, resetDm, setSelectedDms } =
  dmSlice.actions;

export const getDms = (): AppThunk => async (dispatch, getState) => {
  const { settings } = getState().app;
  const { token } = getState().user;
  if (token) {
    dispatch(setIsLoading(true));
    const { success, data } = await new DiscordService(
      settings,
    ).fetchDirectMessages(token);
    if (success && data) {
      dispatch(setDms(data));
      dispatch(setIsLoading(false));
    }
  }
};

export const mutateSelectedDms =
  (dmIds: string[]): AppThunk =>
  (dispatch, getState) => {
    const { currentUser } = getState().user;
    if (currentUser) {
      dispatch(resetPurgeRemovalFrom());
      dispatch(resetMessageData());
      dispatch(resetFilters());
      dispatch(
        setSelectedDms({
          preFilterUser: { name: currentUser.username, id: currentUser.id },
          dmIds,
        }),
      );
    }
  };

export default dmSlice.reducer;
