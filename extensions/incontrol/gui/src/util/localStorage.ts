import { JSONContent } from "@tiptap/react";

type LocalStorageTypes = {
  isExploreDialogOpen: boolean;
  hasDismissedExploreDialog: boolean;
  ide: "vscode" | "jetbrains";
  vsCodeUriScheme: string;
  fontSize: number;
  [key: `inputHistory_${string}`]: JSONContent[];
  extensionVersion: string;
  shownProfilesIntroduction: boolean;
  disableIndexing: boolean;
  customBaseAgentSystemMessage: string;
};

export enum LocalStorageKey {
  IsExploreDialogOpen = "isExploreDialogOpen",
  HasDismissedExploreDialog = "hasDismissedExploreDialog",
}

export function getLocalStorage<T extends keyof LocalStorageTypes>(
  key: T,
): LocalStorageTypes[T] | undefined {
  const value = localStorage.getItem(key);

  if (value === null) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.error(
      `Error parsing ${key} from local storage. Value was ${value}\n\n`,
      error,
    );
    return undefined;
  }
}

export function setLocalStorage<T extends keyof LocalStorageTypes>(
  key: T,
  value: LocalStorageTypes[T],
): void {
  localStorage.setItem(key, JSON.stringify(value));

  // Dispatch custom event to notify current tab listeners
  window.dispatchEvent(
    new CustomEvent("localStorageChange", {
      detail: { key, value },
    }),
  );
}
