import { RootState } from "../../app/store";
import {
  setIsLoading as setIsLoadingAction,
  setChannels as setChannelsAction,
  setChannel as setChannelAction,
  resetChannel as resetChannelAction,
  setSelectedExportChannels as setSelectedExportChannelsAction,
  getChannels as getChannelsAction,
  changeChannel as changeChannelAction,
  loadChannel as loadChannelAction,
} from "./channel-slice";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import type { Channel } from "discrub-lib/types/discord-types";

const useChannelSlice = () => {
  const dispatch = useAppDispatch();

  const useChannels = (): Channel[] =>
    useAppSelector((state: RootState) => state.channel.channels);

  const useSelectedChannel = (): Channel | null | undefined =>
    useAppSelector((state: RootState) => state.channel.selectedChannel);

  const useIsLoading = (): boolean | null | undefined =>
    useAppSelector((state: RootState) => state.channel.isLoading);

  const useSelectedExportChannels = (): string[] =>
    useAppSelector((state: RootState) => state.channel.selectedExportChannels);

  const state = {
    channels: useChannels,
    selectedChannel: useSelectedChannel,
    isLoading: useIsLoading,
    selectedExportChannels: useSelectedExportChannels,
  };

  const setIsLoading = (value: boolean): void => {
    dispatch(setIsLoadingAction(value));
  };
  const setChannels = (channels: Channel[]): void => {
    dispatch(setChannelsAction(channels));
  };
  const setChannel = (channelId: string): void => {
    dispatch(setChannelAction(channelId));
  };
  const resetChannel = (): void => {
    dispatch(resetChannelAction());
  };
  const setSelectedExportChannels = (channelIds: string[]): void => {
    dispatch(setSelectedExportChannelsAction(channelIds));
  };
  const getChannels = (guildId: string): void => {
    dispatch(getChannelsAction(guildId));
  };

  const changeChannel = (channelId: string | null): void => {
    dispatch(changeChannelAction(channelId));
  };

  const loadChannel = (channelId: string): void => {
    dispatch(loadChannelAction(channelId));
  };

  return {
    state,
    setIsLoading,
    setChannels,
    setChannel,
    resetChannel,
    setSelectedExportChannels,
    getChannels,
    changeChannel,
    loadChannel,
  };
};

export { useChannelSlice };
