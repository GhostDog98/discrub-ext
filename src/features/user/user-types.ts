import type { User } from "discrub-lib/types/discord-types";

export type UserState = {
  currentUser?: User | null;
  token?: string | null;
  isLoading?: boolean | null;
};
