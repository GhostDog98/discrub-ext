import { useState } from "react";
import { useMessageSlice } from "../../../features/message/use-message-slice.ts";
import { useDmSlice } from "../../../features/dm/use-dm-slice.ts";
import { useGuildSlice } from "../../../features/guild/use-guild-slice.ts";
import { EnhancedAutocomplete, Tooltip } from "discrub-lib/common";
import { useUserSlice } from "../../../features/user/use-user-slice.ts";
import { filterBoth, getEntityHint } from "discrub-lib/discrub-utils";
import { EntityHint } from "discrub-lib/discrub-enum";

type MentionedUsersProps = {
  isDm?: boolean;
  disabled?: boolean;
};

function MentionedUsers({
  isDm = false,
  disabled = false,
}: MentionedUsersProps) {
  const [filterUsers, setFilterUsers] = useState<string[]>([]);

  const { clearUserMapping, createUserMapping } = useUserSlice();

  const { state: messageState, setSearchCriteria } = useMessageSlice();
  const { mentionIds } = messageState.searchCriteria();

  const { state: dmState } = useDmSlice();
  const dmPreFilterUsers = dmState.preFilterUsers();

  const { state: guildState } = useGuildSlice();
  const preFilterUsers = guildState.preFilterUsers();
  const selectedGuild = guildState.selectedGuild();

  const users = isDm ? dmPreFilterUsers : preFilterUsers;

  const handleSelectAll = () => {
    if (mentionIds.length !== users.length) {
      setSearchCriteria({ mentionIds: users.map((u) => u.id) });
    } else {
      setSearchCriteria({ mentionIds: [] });
      setFilterUsers([]);
    }
  };

  return (
    <Tooltip
      title="Mentions By"
      description="Messages that mention the specified User(s)."
      secondaryDescription={!isDm ? getEntityHint(EntityHint.USER) : undefined}
      placement="left"
    >
      <EnhancedAutocomplete
        disabled={disabled}
        label="Mentions By"
        onChange={(value) => {
          if (Array.isArray(value)) {
            if (selectedGuild) {
              filterBoth(
                value,
                mentionIds,
                users.map(({ id }) => id),
              ).forEach((id) => createUserMapping(id, selectedGuild.id));
            }
            setFilterUsers(value);
            setSearchCriteria({ mentionIds: value });
          }
        }}
        onInputChange={(value) => {
          if (Array.isArray(value) && !filterUsers.length) {
            setSearchCriteria({ mentionIds: value });
          }
        }}
        freeSolo={!isDm}
        options={users?.map((user) => user.id)}
        value={mentionIds}
        multiple
        getOptionLabel={(id) => {
          return users.find((user) => user.id === id)?.name || id;
        }}
        onSelectAll={handleSelectAll}
        onOptionRemoval={!isDm ? clearUserMapping : undefined}
      />
    </Tooltip>
  );
}

export default MentionedUsers;
