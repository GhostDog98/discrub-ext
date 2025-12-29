import { createSlice } from "@reduxjs/toolkit";
import { getChannels, resetChannel } from "../channel/channel-slice";
import {
  resetAdvancedFilters,
  resetFilters,
  resetMessageData,
} from "../message/message-slice";
import type { Guild } from "discrub-lib/types/discord-types";
import { normalizeGuild, createPreFilterUsers } from "discrub-lib/discrub-utils";
import { GuildState } from "./guild-types";
import { PreFilterUser } from "../dm/dm-types";
import { AppThunk } from "../../app/store";
import { DiscordService } from "discrub-lib/discord-service";
import { resetPurgeRemovalFrom } from "../app/app-slice.ts";

const initialState: GuildState = {
  guilds: [],
  selectedGuild: null,
  preFilterUsers: [],
  isLoading: null,
};

export const guildSlice = createSlice({
  name: "guild",
  initialState: initialState,
  reducers: {
    setIsLoading: (
      state,
      { payload }: { payload: boolean | null | undefined },
    ): void => {
      state.isLoading = payload;
    },
    setGuilds: (state, { payload }: { payload: Guild[] }): void => {
      state.guilds = payload;
    },
    setGuild: (
      state,
      { payload }: { payload: string | null | undefined },
    ): void => {
      state.selectedGuild = state.guilds.find((guild) => guild.id === payload);
    },
    resetGuild: (state): void => {
      state.selectedGuild = null;
    },
    setPreFilterUsers: (
      state,
      { payload }: { payload: PreFilterUser[] },
    ): void => {
      state.preFilterUsers = payload;
    },
  },
});

export const {
  setIsLoading,
  setGuilds,
  setGuild,
  resetGuild,
  setPreFilterUsers,
} = guildSlice.actions;

export const getRoles =
  (guildId: string): AppThunk =>
  async (dispatch, getState) => {
    const { settings } = getState().app;
    const { guilds } = getState().guild;
    const { token } = getState().user;
    const guild = guilds.find((g) => g.id === guildId);
    const shouldFetchRoles = guild && !guild.roles.length;

    if (token && shouldFetchRoles) {
      const { data, success } = await new DiscordService(settings).fetchRoles(
        guildId,
        token,
      );
      if (success && data) {
        const updatedGuilds = guilds.map((g) => {
          if (g.id === guildId) {
            return { ...g, roles: data };
          } else {
            return g;
          }
        });
        dispatch(setGuilds(updatedGuilds));
      }
    }
  };

export const getGuilds = (): AppThunk => async (dispatch, getState) => {
  const { settings } = getState().app;
  const { token } = getState().user;
  if (token) {
    dispatch(setIsLoading(true));
    const { success, data } = await new DiscordService(settings).fetchGuilds(
      token,
    );
    if (success && data) {
      dispatch(setGuilds(data.map(normalizeGuild)));
    } else {
      dispatch(setGuilds([]));
    }
    dispatch(setIsLoading(false));
  }
};

export const changeGuild =
  (guildId?: string | null): AppThunk =>
  async (dispatch) => {
    if (guildId) {
      dispatch(setGuild(guildId));
      await dispatch(getRoles(guildId));
      await dispatch(getChannels(guildId));
      dispatch(getPreFilterUsers(guildId));
    } else {
      dispatch(resetGuild());
    }
    dispatch(resetChannel());
    dispatch(resetFilters());
    dispatch(resetAdvancedFilters());
    dispatch(resetPurgeRemovalFrom());
    dispatch(resetMessageData());
  };

export const getPreFilterUsers =
  (guildId: string): AppThunk =>
  (dispatch, getState) => {
    const { currentUser } = getState().user;
    const { userMap } = getState().export.exportMaps;
    if (currentUser) {
      const preFilterUsers = createPreFilterUsers(
        userMap,
        guildId,
        currentUser.id,
        currentUser.username,
      );
      dispatch(setPreFilterUsers(preFilterUsers));
    }
  };

export default guildSlice.reducer;
