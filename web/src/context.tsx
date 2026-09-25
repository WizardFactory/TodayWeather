import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Place } from "@todayweather/core";
import type { SavedState } from "./state";
import type { Capabilities } from "./api";
export type AppContextValue = {
  state: SavedState;
  setState: Dispatch<SetStateAction<SavedState>>;
  select: (place: Place) => void;
  notify: (text: string) => void;
  capabilities?: Capabilities;
  storageOk: boolean;
  installPrompt?: { prompt: () => Promise<void> };
  updateReady: boolean;
  applyUpdate: () => void;
};
export const AppContext = createContext<AppContextValue>(null!);
export const useApp = () => useContext(AppContext);
