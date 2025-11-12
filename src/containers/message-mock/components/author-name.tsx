import {
  formatUserData,
  getColor,
  getHighestRoles,
  getRoleNames,
} from "discrub-lib/discrub-utils";
import type { ResolvedFilePathObject } from "discrub-lib/types/discrub-types";
import CheckIcon from "@mui/icons-material/Check";
import type { Message, Role, Guild } from "discrub-lib/types/discord-types";
import type { ExportUserMap } from "discrub-lib/types/discrub-types";

export type AuthorNameProps = {
  msg: Message;
  userMap: ExportUserMap;
  selectedGuild?: Guild | null;
  getRolePath: (x: string, y?: string | null) => ResolvedFilePathObject;
};

const AuthorName = ({
  msg,
  userMap,
  selectedGuild,
  getRolePath,
}: AuthorNameProps) => {
  const author = msg.author;

  const {
    roles: guildRoles,
    nick: guildNickname,
    joinedAt,
  } = userMap[author.id]?.guilds[String(selectedGuild?.id)] || {};

  let roleNames: string[] = [];
  let colorRole: Role | null | undefined = null;
  let iconRole: Role | null | undefined = null;

  if (selectedGuild) {
    const highestRole = getHighestRoles(guildRoles, selectedGuild);
    if (highestRole) {
      colorRole = highestRole.colorRole;
      iconRole = highestRole.iconRole;
    }
    roleNames = getRoleNames(guildRoles, selectedGuild);
  }

  const { local, remote }: ResolvedFilePathObject = iconRole
    ? getRolePath(iconRole.id, iconRole.icon)
    : { local: undefined, remote: undefined };

  return (
    <>
      <strong
        title={formatUserData({
          userId: author.id,
          userName: author.username,
          displayName: author.global_name,
          guildNickname,
          joinedAt,
          roleNames,
        })}
        style={{ color: colorRole ? getColor(colorRole.color) : undefined }}
      >
        {guildNickname || author.global_name || author.username}
      </strong>
      {iconRole && (
        <img
          title={iconRole.name}
          style={{ width: "20px", height: "20px" }}
          src={local || remote}
          alt="role-icon"
        />
      )}
      {!iconRole && msg.author.bot && (
        <span
          title="Verified Bot"
          style={{
            color: "#FFF !important",
            backgroundColor: "#5865f2",
            borderRadius: "5px",
            display: "inline-flex",
            fontSize: "10px",
            alignItems: "center",
            justifyContent: "center",
            height: "16px",
            width: "38px",
            gap: "2px",
            wordBreak: "keep-all",
          }}
        >
          <CheckIcon sx={{ width: "12px !important" }} /> APP
        </span>
      )}
    </>
  );
};
export default AuthorName;
