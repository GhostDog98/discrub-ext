import { getIconUrl } from "../utils";
import type { Guild, Channel } from "discrub-lib/types/discord-types";

type EntityIconProps = {
  entity: Guild | Channel;
};
const EntityIcon = ({ entity }: EntityIconProps) => {
  return (
    <img
      style={{ width: "24px", height: "24px", borderRadius: "50px" }}
      src={getIconUrl(entity)}
      alt="guild-icon"
    />
  );
};

export default EntityIcon;
