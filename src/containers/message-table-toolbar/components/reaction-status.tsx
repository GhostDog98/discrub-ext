import Box from "@mui/material/Box";
import { Typography } from "@mui/material";
import type { ExportUserMap } from "discrub-lib/types/discrub-types";
import {
  getEncodedEmoji,
  resolveAvatarUrl,
  resolveEmojiUrl,
} from "discrub-lib/discrub-utils";
import { ImgAdornment } from "discrub-ui-components";
import type { Emoji } from "discrub-lib/types/discord-types";
import { AppTaskEntity } from "../../../features/app/app-types.ts";

type ReactionStatusProps = {
  emojisInUse: Emoji[];
  entity: AppTaskEntity;
  userMap: ExportUserMap;
};

const ReactionStatus = ({
  emojisInUse,
  entity,
  userMap,
}: ReactionStatusProps) => {
  const emoji = emojisInUse.find(
    (emoji) => getEncodedEmoji(emoji) === entity?._data2,
  );
  const user = entity?._data1 ? userMap[entity._data1] : null;

  return (
    <Box display="flex" flexDirection="row" gap={1} alignItems="center">
      <Typography variant="body2">Removing reaction </Typography>
      {emoji?.id ? (
        <ImgAdornment src={resolveEmojiUrl(emoji?.id)?.remote || ""} />
      ) : (
        `${emoji?.name || ""}`
      )}

      <Typography variant="body2"> for</Typography>
      {user && entity?._data1 ? (
        <ImgAdornment
          src={resolveAvatarUrl(entity._data1, user.avatar).remote || ""}
        />
      ) : (
        ""
      )}

      <Typography variant="body2" sx={{ fontWeight: "bold" }}>
        {user?.userName || entity?._data1}
      </Typography>
    </Box>
  );
};
export default ReactionStatus;
