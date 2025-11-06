import { RootState } from "../../app/store";
import {
  setIsLoading as setIsLoadingAction,
  purge as purgeAction,
} from "./purge-slice";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import type { Channel, Guild } from "discrub-lib/types/discord-types";

const usePurgeSlice = () => {
  const dispatch = useAppDispatch();

  const useIsLoading = (): boolean | Maybe =>
    useAppSelector((state: RootState) => state.purge.isLoading);

  const state = {
    isLoading: useIsLoading,
  };

  const setIsLoading = (value: boolean): void => {
    dispatch(setIsLoadingAction(value));
  };

  /**
   * Iterates through the provided array and deletes every message from each Channel.
   */
  const purge = (entities: Channel[] | Guild[]) => {
    dispatch(purgeAction(entities));
  };

  return {
    state,
    setIsLoading,
    purge,
  };
};

export { usePurgeSlice };
