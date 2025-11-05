import { EnhancedAutocomplete, Tooltip } from "discrub-lib/common";
import { useMessageSlice } from "../../../features/message/use-message-slice";
import { HasType as HasTypeEnum } from "../../../enum/has-type";

type HasTypeProps = {
  disabled: boolean;
};

function HasType({ disabled }: HasTypeProps) {
  const { state: messageState, setSearchCriteria } = useMessageSlice();
  const searchCriteria = messageState.searchCriteria();
  const { selectedHasTypes } = searchCriteria;

  return (
    <Tooltip
      title="Messages Containing"
      description="Messages that contain the specified type(s)."
      placement="left"
    >
      <EnhancedAutocomplete
        label="Messages Containing"
        value={selectedHasTypes}
        options={Object.values(HasTypeEnum)}
        disabled={disabled}
        multiple
        getOptionLabel={(option) => option}
        onChange={(value) => {
          if (Array.isArray(value)) {
            setSearchCriteria({ selectedHasTypes: value as HasTypeEnum[] });
          }
        }}
      />
    </Tooltip>
  );
}

export default HasType;
