import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";
import "./index.css";
import App from "./App";
import { SignupProvider } from "./newsletter/store";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SignupProvider>
      <App />
    </SignupProvider>
  </StrictMode>,
);
