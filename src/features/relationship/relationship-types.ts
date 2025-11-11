export type RelationshipState = {
  isLoading?: boolean | null;
  friends: unknown[];
};

export type AddFriendProps = {
  username: string;
  discriminator: string;
};
