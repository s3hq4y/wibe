import { ModelRole } from "@incontrol/config-yaml";
import { ArrowPathIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import { ModelDescription } from "core";
import { useContext, useState } from "react";
import Shortcut from "../../../components/gui/Shortcut";
import { useEditModel } from "../../../components/mainInput/Lump/useEditBlock";
import { Button, Card, Divider, Toggle } from "../../../components/ui";
import { useAuth } from "../../../context/Auth";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import { updateSelectedModelByRole } from "../../../redux/thunks/updateSelectedModelByRole";
import { getMetaKeyLabel, isJetBrains } from "../../../util";
import { cn } from "../../../util/cn";
import { ConfigHeader } from "../components/ConfigHeader";
import { ModelRoleRow } from "../components/ModelRoleRow";
import { t } from "../../../i18n";

export function ModelsSection() {
  const { selectedProfile, refreshModels } = useAuth();
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);

  const config = useAppSelector((state) => state.config.config);
  const configLoading = useAppSelector((state) => state.config.loading);
  const jetbrains = isJetBrains();
  const metaKey = getMetaKeyLabel();
  const [showAdditionalRoles, setShowAdditionalRoles] = useState(false);

  function handleRoleUpdate(role: ModelRole, model: ModelDescription | null) {
    if (!model) {
      return;
    }

    void dispatch(
      updateSelectedModelByRole({
        role,
        selectedProfile,
        modelTitle: model.title,
      }),
    );
  }

  const handleConfigureModel = useEditModel();

  // Models are declared by hand in config.yaml. There is no provider picker /
  // "Add model" form any more: the "+" button and the card below simply open
  // the active config file in the editor.
  function handleOpenConfig() {
    if (selectedProfile?.uri) {
      ideMessenger.post("openFile", { path: selectedProfile.uri });
    } else {
      ideMessenger.post("config/openProfile", { profileId: undefined });
    }
  }

  // Manual refresh for when the file on disk already changed (edited outside
  // the editor, AUTODETECT provider restarted, synced web models, ...) and the
  // user does not want to re-save config.yaml just to trigger the watcher.
  function handleRefreshModels() {
    if (configLoading) {
      return;
    }
    void refreshModels("Manual refresh from Models tab");
  }

  return (
    <div className="space-y-4">
      <ConfigHeader
        title={t("Models")}
        onAddClick={handleOpenConfig}
        addButtonTooltip={t("Add a model in config.yaml")}
      />

      <Card>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {t("Models are configured in config.yaml")}
              </span>
              <span className="text-description mt-1 text-xs">
                {t(
                  "Add or change providers, API keys and models under the `models:` key, then save the file - the list below reloads automatically. Changed something outside the editor? Use Refresh to reload it now.",
                )}
              </span>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRefreshModels}
                disabled={configLoading}
                title={t("Refresh available models")}
                className="flex items-center gap-1.5"
              >
                <ArrowPathIcon
                  className={cn(
                    "h-3.5 w-3.5",
                    configLoading && "animate-spin-slow",
                  )}
                />
                <span>
                  {configLoading ? t("Refreshing…") : t("Refresh")}
                </span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleOpenConfig}
                className="flex items-center gap-1.5"
              >
                <PencilSquareIcon className="h-3.5 w-3.5" />
                <span>{t("Open config.yaml")}</span>
              </Button>
            </div>
          </div>
          <pre className="bg-input text-description m-0 overflow-x-auto rounded p-2 text-[11px] leading-snug">
{`models:
  - name: My model
    provider: openai        # anthropic, ollama, gemini, ... (or any OpenAI-compatible)
    model: gpt-4o
    apiBase: https://api.openai.com/v1
    apiKey: \${{ secrets.OPENAI_API_KEY }}
    roles: [chat, edit, apply]`}
          </pre>
        </div>
      </Card>

      <Card>
        <ModelRoleRow
          role="chat"
          displayName="Chat"
          shortcut={
            <span className="text-2xs text-description-muted">
              (<Shortcut>{`cmd ${jetbrains ? "J" : "L"}`}</Shortcut>)
            </span>
          }
          description={
            <span>
              {t("Used in Chat, Plan, Agent mode (")}<a
                target="_blank"
                rel="noopener noreferrer"
                className="text-inherit underline hover:brightness-125"
              >
                {t("Learn more")}</a>
              )
            </span>
          }
          models={config.modelsByRole.chat}
          selectedModel={config.selectedModelByRole.chat ?? undefined}
          onSelect={(model) => handleRoleUpdate("chat", model)}
          onConfigure={handleConfigureModel}
        />

        <Divider />

        <ModelRoleRow
          role="autocomplete"
          displayName="Autocomplete"
          description={
            <span>
              {t("Used in inline code completions as you type (")}<a
                target="_blank"
                rel="noopener noreferrer"
                className="text-inherit underline hover:brightness-125"
              >
                {t("Learn more")}</a>
              )
            </span>
          }
          models={config.modelsByRole.autocomplete}
          selectedModel={config.selectedModelByRole.autocomplete ?? undefined}
          onSelect={(model) => handleRoleUpdate("autocomplete", model)}
          onConfigure={handleConfigureModel}
        />

        {/* Jetbrains has a model selector inline */}
        {!jetbrains && (
          <>
            <Divider />
            <ModelRoleRow
              role="edit"
              displayName="Edit"
              shortcut={
                <span className="text-2xs text-description-muted">
                  (<Shortcut>cmd I</Shortcut>)
                </span>
              }
              description={
                <span>
                  {t("Used to transform a selected section of code (")}<a
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-inherit underline hover:brightness-125"
                  >
                    {t("Learn more")}</a>
                  )
                </span>
              }
              models={config.modelsByRole.edit}
              selectedModel={config.selectedModelByRole.edit ?? undefined}
              onSelect={(model) => handleRoleUpdate("edit", model)}
              onConfigure={handleConfigureModel}
            />
          </>
        )}
      </Card>

      <Card>
        <Toggle
          isOpen={showAdditionalRoles}
          onToggle={() => setShowAdditionalRoles(!showAdditionalRoles)}
          title={t("Additional model roles")}
          subtitle="Apply, Embed, Rerank"
        >
          <div className="flex flex-col">
            <ModelRoleRow
              role="apply"
              displayName="Apply"
              description="Used to apply generated codeblocks to files"
              models={config.modelsByRole.apply}
              selectedModel={config.selectedModelByRole.apply ?? undefined}
              onSelect={(model) => handleRoleUpdate("apply", model)}
              onConfigure={handleConfigureModel}
            />

            <Divider />

            <ModelRoleRow
              role="embed"
              displayName="Embed"
              description="Embeddings model (available to custom context providers / tools)"
              models={config.modelsByRole.embed}
              selectedModel={config.selectedModelByRole.embed ?? undefined}
              onSelect={(model) => handleRoleUpdate("embed", model)}
              onConfigure={handleConfigureModel}
            />

            <Divider />

            <ModelRoleRow
              role="rerank"
              displayName="Rerank"
              description="Used for reranking retrieved context items"
              models={config.modelsByRole.rerank}
              selectedModel={config.selectedModelByRole.rerank ?? undefined}
              onSelect={(model) => handleRoleUpdate("rerank", model)}
              onConfigure={handleConfigureModel}
            />
          </div>
        </Toggle>
      </Card>
    </div>
  );
}
