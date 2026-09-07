import { useContext, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/Auth";
import { useAppSelector } from "../../redux/hooks";
import { CONFIG_ROUTES } from "../../util/navigation";
import Alert from "../gui/Alert";
import { t } from "../../i18n";

export const FatalErrorIndicator = () => {
  const { refreshProfiles } = useAuth();
  const configError = useAppSelector((store) => store.config.configError);
  const location = useLocation();
  const navigate = useNavigate();

  const hasFatalErrors = useMemo(() => {
    return configError?.some((error) => error.fatal);
  }, [configError]);

  const configLoading = useAppSelector((state) => state.config.loading);
  const showConfigPage = () => {
    navigate(CONFIG_ROUTES.CONFIGS);
  };
  const currentPath = `${location.pathname}${location.search}`;

  const { selectedProfile } = useAuth();

  if (!hasFatalErrors) {
    return null;
  }

  const displayName = selectedProfile
    ? (selectedProfile.title ??
      `${selectedProfile.fullSlug?.ownerSlug}/${selectedProfile.fullSlug?.packageSlug}`)
    : "config";

  return (
    <Alert type="error" className="mx-2 my-1 px-2">
      <span>{`Error loading`}</span>{" "}
      <span className="italic">{displayName}</span>
      {". "}
      <span>{`Chat is disabled until a model is available.`}</span>
      <div className="mt-2 flex flex-row flex-wrap items-center gap-x-3 gap-y-1.5">
        {configLoading ? (
          <div>{t("Reloading...")}</div>
        ) : (
          <div
            className={`cursor-pointer underline`}
            onClick={() => {
              refreshProfiles("Clicked reload in fatal indicator");
            }}
          >
            {t("Reload")}</div>
        )}
        {currentPath !== CONFIG_ROUTES.CONFIGS && (
          <div onClick={showConfigPage} className="cursor-pointer underline">
            View
          </div>
        )}
      </div>
    </Alert>
  );
};
