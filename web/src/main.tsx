import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { restoreState } from "./state";
import { detectLanguage, setLanguage } from "./i18n";
import { configureFormats } from "./locale";
import "./generated/tokens.css";
import "./style.css";
import { restoreDisplay, applyDisplay } from "./display";
// Apply the saved theme before the first render to avoid a light flash.
let saved: ReturnType<typeof restoreState> | undefined;
try {
  saved = restoreState(localStorage);
  applyDisplay(
    restoreDisplay(localStorage),
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
} catch {
  /* Storage unavailable: the default theme and browser language apply. */
}
// Regional date/number conventions come from the browser locale.
configureFormats(navigator.languages ?? []);
// Render once the UI language (saved, else the browser's) is loaded.
await setLanguage(
  saved?.settings.language ?? detectLanguage(navigator.languages ?? []),
).catch(() => setLanguage("ko"));
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      networkMode: "always",
    },
  },
});
const router = createBrowserRouter([{ path: "*", element: <App /> }]);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
