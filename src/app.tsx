import { ThemeProvider } from "@mui/material/styles";
import { theme } from "./theme";
import { GlobalStyles } from "@mui/material";
import { scrollbarOverrides, audioOverrides } from "./theme";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFnsV3";
import DiscrubDialog from "./containers/discrub-dialog/discrub-dialog";

function App() {
  return (
    <>
      <GlobalStyles
        styles={{
          ...scrollbarOverrides,
          ...audioOverrides,
        }}
      />
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDateFns}>
          <DiscrubDialog />
        </LocalizationProvider>
      </ThemeProvider>
    </>
  );
}

export default App;
