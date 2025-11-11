import { RootState } from "../../app/store";
import {
  setIsLoading as setIsLoadingAction,
  setToken as setTokenAction,
  setCurrentUser as setCurrentUserAction,
  getUserData as getUserDataAction,
  getUserDataManaully as getUserDataManaullyAction,
  clearUserMapping as clearUserMappingAction,
  createUserMapping as createUserMappingAction,
} from "./user-slice";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import type { User } from "discrub-lib/types/discord-types";

const useUserSlice = () => {
  const dispatch = useAppDispatch();

  const useCurrentUser = (): User | null | undefined =>
    useAppSelector((state: RootState) => state.user.currentUser);

  const useToken = (): string | null | undefined =>
    useAppSelector((state: RootState) => state.user.token);

  const useIsLoading = (): boolean | null | undefined =>
    useAppSelector((state: RootState) => state.user.isLoading);

  const state = {
    currentUser: useCurrentUser,
    token: useToken,
    isLoading: useIsLoading,
  };

  const setIsLoading = (value: boolean): void => {
    dispatch(setIsLoadingAction(value));
  };

  const setToken = (value?: string | null): void => {
    dispatch(setTokenAction(value));
  };

  const setCurrentUser = (value: User): void => {
    dispatch(setCurrentUserAction(value));
  };

  const getUserData = (): void => {
    dispatch(getUserDataAction());
  };

  const getUserDataManaully = async (token: string): Promise<boolean> => {
    return dispatch(getUserDataManaullyAction(token));
  };

  const clearUserMapping = (userId: string) => {
    dispatch(clearUserMappingAction(userId));
  };

  const createUserMapping = (userId: string, guildId: string) => {
    dispatch(createUserMappingAction(userId, guildId));
  };

  return {
    state,
    setIsLoading,
    setToken,
    setCurrentUser,
    getUserData,
    getUserDataManaully,
    clearUserMapping,
    createUserMapping,
  };
};

export { useUserSlice };
