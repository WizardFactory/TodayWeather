import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Place } from "@todayweather/core";
import type { DisplayPreferences } from "./display";
import type { SavedState } from "./state";
import type { Capabilities } from "./api";
export type AppContextValue = {
  state: SavedState;
  display: DisplayPreferences;
  setDisplay: Dispatch<SetStateAction<DisplayPreferences>>;
  setState: Dispatch<SetStateAction<SavedState>>;
  select: (place: Place) => void;
  notify: (text: string) => void;
  capabilities?: Capabilities;
  storageOk: boolean;
  contentInert: boolean;
  installPrompt?: { prompt: () => Promise<void> };
  updateReady: boolean;
  applyUpdate: () => void;
};
export const AppContext = createContext<AppContextValue>(null!);
export const useApp = () => useContext(AppContext);
