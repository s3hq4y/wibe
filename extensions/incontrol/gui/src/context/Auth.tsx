import { ProfileDescription } from "core/config/ProfileLifecycleManager";
import { RefreshModelsResult } from "core/protocol/core";
import React, { createContext, useCallback, useContext } from "react";
import { t } from "../i18n";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { setConfigLoading } from "../redux/slices/configSlice";
import {
  selectProfiles,
  selectSelectedProfile,
} from "../redux/slices/profilesSlice";
import { IdeMessengerContext } from "./IdeMessenger";

interface AuthContextType {
  selectedProfile: ProfileDescription | null;
  profiles: ProfileDescription[] | null;
  refreshProfiles: (reason?: string) => Promise<void>;
  /**
   * Re-read the active profile's config so the available-model list updates on
   * demand, instead of only when config.yaml is edited and saved.
   */
  refreshModels: (reason?: string) => Promise<RefreshModelsResult | undefined>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);

  // Profiles
  const profiles = useAppSelector(selectProfiles);
  const selectedProfile = useAppSelector(selectSelectedProfile);

  const refreshProfiles = useCallback(
    async (reason?: string) => {
      try {
        dispatch(setConfigLoading(true));
        await ideMessenger.request("config/refreshProfiles", {
          reason,
        });
        ideMessenger.post("showToast", ["info", "Config refreshed"]);
      } catch (e) {
        console.error("Failed to refresh profiles", e);
        ideMessenger.post("showToast", ["error", "Failed to refresh config"]);
      } finally {
        dispatch(setConfigLoading(false));
      }
    },
    [ideMessenger],
  );

  const refreshModels = useCallback(
    async (reason?: string) => {
      try {
        dispatch(setConfigLoading(true));
        const response = await ideMessenger.request("config/refreshModels", {
          reason,
        });
        if (response.status !== "success") {
          throw response.error;
        }

        const result = response.content;
        if (!result?.ok) {
          const detail = result?.errors?.[0]?.message;
          ideMessenger.post("showToast", [
            "error",
            detail
              ? t("Failed to refresh models: {0}", detail)
              : t("Failed to refresh models"),
          ]);
          return result;
        }

        ideMessenger.post("showToast", [
          "info",
          result.modelCount > 0
            ? t("Models refreshed: {0} available", result.modelCount)
            : t("Models refreshed, but none are configured yet"),
        ]);
        return result;
      } catch (e) {
        console.error("Failed to refresh models", e);
        ideMessenger.post("showToast", [
          "error",
          t(
            "Failed to refresh models: {0}",
            e instanceof Error ? e.message : String(e),
          ),
        ]);
        return undefined;
      } finally {
        dispatch(setConfigLoading(false));
      }
    },
    [dispatch, ideMessenger],
  );

  return (
    <AuthContext.Provider
      value={{
        selectedProfile,
        profiles: profiles ?? [],
        refreshProfiles,
        refreshModels,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
