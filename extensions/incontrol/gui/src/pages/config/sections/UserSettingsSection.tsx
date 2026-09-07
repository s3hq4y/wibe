import {
  SharedConfigSchema,
  modifyAnyConfigWithSharedConfig,
} from "core/config/sharedConfig";
import { useContext, useEffect, useState } from "react";
import { Card, Toggle, useFontSize } from "../../../components/ui";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import { updateConfig } from "../../../redux/slices/configSlice";
import { setLocalStorage } from "../../../util/localStorage";
import { ConfigHeader } from "../components/ConfigHeader";
import { UserSetting } from "../components/UserSetting";
import { MANUAL_SYSTEM_PROMPT_TEMPLATE } from "../../../util/systemPromptTemplate";
import { t } from "../../../i18n";

export function UserSettingsSection() {
  /////// User settings section //////
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const config = useAppSelector((state) => state.config.config);

  const [showExperimental, setShowExperimental] = useState(false);

  function handleUpdate(sharedConfig: SharedConfigSchema) {
    // Optimistic update
    const updatedConfig = modifyAnyConfigWithSharedConfig(config, sharedConfig);
    dispatch(updateConfig(updatedConfig));
    // IMPORTANT no need for model role updates (separate logic for selected model roles)
    // simply because this function won't be used to update model roles

    // Actual update to core which propagates back with config update event
    ideMessenger.post("config/updateSharedConfig", sharedConfig);
  }

  // Disable autocomplete
  const disableAutocompleteInFiles = (
    config.tabAutocompleteOptions?.disableInFiles ?? []
  ).join(", ");
  const [formDisableAutocomplete, setFormDisableAutocomplete] = useState(
    disableAutocompleteInFiles,
  );

  useEffect(() => {
    // Necessary so that reformatted/trimmed values don't cause dirty state
    setFormDisableAutocomplete(disableAutocompleteInFiles);
  }, [disableAutocompleteInFiles]);

  // Manual system prompt
  const manualSystemMessage = config.ui?.manualSystemMessage ?? "";
  const [formManualSystemMessage, setFormManualSystemMessage] = useState(
    manualSystemMessage,
  );

  useEffect(() => {
    setFormManualSystemMessage(manualSystemMessage);
  }, [manualSystemMessage]);

  // Workspace prompts
  const promptPath = config.experimental?.promptPath || "";

  // TODO defaults are in multiple places, should be consolidated and probably not explicit here
  const showSessionTabs = config.ui?.showSessionTabs ?? false;
  const continueAfterToolRejection =
    config.ui?.continueAfterToolRejection ?? false;
  const codeWrap = config.ui?.codeWrap ?? false;
  const showChatScrollbar = config.ui?.showChatScrollbar ?? false;
  const readResponseTTS = config.experimental?.readResponseTTS ?? false;
  const displayRawMarkdown = config.ui?.displayRawMarkdown ?? false;
  const disableSessionTitles = config.disableSessionTitles ?? false;
  const useCurrentFileAsContext =
    config.experimental?.useCurrentFileAsContext ?? false;
  const enableExperimentalTools =
    config.experimental?.enableExperimentalTools ?? false;
  const onlyUseSystemMessageTools =
    config.experimental?.onlyUseSystemMessageTools ?? false;
  const slimToolDescriptions =
      config.experimental?.slimToolDescriptions ?? false;
    const allowAnonymousTelemetry = config.allowAnonymousTelemetry ?? false;

    const goalNudgeMessage = config.experimental?.goalNudgeMessage ?? "";
    const [formGoalNudgeMessage, setFormGoalNudgeMessage] =
      useState(goalNudgeMessage);

    useEffect(() => {
      setFormGoalNudgeMessage(goalNudgeMessage);
    }, [goalNudgeMessage]);

    const maxGoalNudges = config.experimental?.maxGoalNudges ?? 5;

  const useAutocompleteMultilineCompletions =
    config.tabAutocompleteOptions?.multilineCompletions ?? "auto";
  const modelTimeout = config.tabAutocompleteOptions?.modelTimeout ?? 150;
  const debounceDelay = config.tabAutocompleteOptions?.debounceDelay ?? 250;
  const fontSize = useFontSize();

  const cancelChangeDisableAutocomplete = () => {
    setFormDisableAutocomplete(disableAutocompleteInFiles);
  };
  const handleDisableAutocompleteSubmit = () => {
    handleUpdate({
      disableAutocompleteInFiles: formDisableAutocomplete
        .split(",")
        .map((val) => val.trim())
        .filter((val) => !!val),
    });
  };

  const cancelManualSystemMessage = () => {
    setFormManualSystemMessage(manualSystemMessage);
  };
  const saveManualSystemMessage = () => {
      handleUpdate({ manualSystemMessage: formManualSystemMessage });
    };

    const cancelGoalNudgeMessage = () => {
      setFormGoalNudgeMessage(goalNudgeMessage);
    };
    const saveGoalNudgeMessage = () => {
      handleUpdate({ goalNudgeMessage: formGoalNudgeMessage });
    };

  const disableTelemetryToggle = false;

  return (
    <div>
      <div className="flex flex-col">
        <ConfigHeader title={t("User Settings")} />
        <div className="space-y-6">
          {/* Chat Interface Settings */}
          <div>
            <ConfigHeader title={t("Chat")} variant="sm" />
            <Card>
              <div className="flex flex-col gap-4">
                <UserSetting
                  type="toggle"
                  title={t("Show Session Tabs")}
                  description="Displays tabs above the chat as an alternative way to organize and access your sessions."
                  value={showSessionTabs}
                  onChange={(value) => handleUpdate({ showSessionTabs: value })}
                />
                <UserSetting
                  type="toggle"
                  title={t("Wrap Codeblocks")}
                  description="Wraps long lines in code blocks instead of showing horizontal scroll."
                  value={codeWrap}
                  onChange={(value) => handleUpdate({ codeWrap: value })}
                />
                <UserSetting
                  type="toggle"
                  title={t("Show Chat Scrollbar")}
                  description="Enables a scrollbar in the chat window."
                  value={showChatScrollbar}
                  onChange={(value) =>
                    handleUpdate({ showChatScrollbar: value })
                  }
                />
                <UserSetting
                  type="toggle"
                  title={t("Text-to-Speech Output")}
                  description="Reads LLM responses aloud with TTS."
                  value={readResponseTTS}
                  onChange={(value) => handleUpdate({ readResponseTTS: value })}
                />
                <UserSetting
                  type="toggle"
                  title={t("Enable Session Titles")}
                  description="Generates summary titles for each chat session after the first message, using the current Chat model."
                  value={!disableSessionTitles}
                  onChange={(value) =>
                    handleUpdate({ disableSessionTitles: !value })
                  }
                />
                <UserSetting
                  type="toggle"
                  title={t("Format Markdown")}
                  description="If off, shows responses as raw text."
                  value={!displayRawMarkdown}
                  onChange={(value) =>
                    handleUpdate({ displayRawMarkdown: !value })
                  }
                />
                <UserSetting
                  type="textarea"
                  title={t("Manual System Prompt")}
                  description="Saved globally. In chat, use the toolbar button to send it with your next message; it is never sent automatically. With the box left empty, the built-in tool template is used instead."
                  action={{
                    label: t("Insert tool template"),
                    onClick: () =>
                      setFormManualSystemMessage(
                        MANUAL_SYSTEM_PROMPT_TEMPLATE.trim(),
                      ),
                  }}
                  placeholder={t("Enter the system prompt to use for this session...")}
                  value={formManualSystemMessage}
                  onChange={setFormManualSystemMessage}
                  onSubmit={saveManualSystemMessage}
                  onCancel={cancelManualSystemMessage}
                  isDirty={formManualSystemMessage !== manualSystemMessage}
                  isValid={true}
                />
              </div>
            </Card>
          </div>

          {/* Appearance Settings */}
          <div>
            <ConfigHeader title={t("Appearance")} variant="sm" />
            <Card>
              <div className="flex flex-col gap-4">
                <UserSetting
                  type="number"
                  title={t("Font Size")}
                  description="Specifies base font size for UI elements."
                  value={fontSize}
                  onChange={(val) => {
                    setLocalStorage("fontSize", val);
                    handleUpdate({ fontSize: val });
                  }}
                  min={7}
                  max={50}
                />
              </div>
            </Card>
          </div>

          {/* Autocomplete Settings */}
          <div>
            <ConfigHeader title={t("Autocomplete")} variant="sm" />
            <Card>
              <div className="flex flex-col gap-4">
                <UserSetting
                  type="select"
                  title={t("Multiline Autocompletions")}
                  description="Controls multiline completions for autocomplete."
                  value={useAutocompleteMultilineCompletions}
                  onChange={(value) =>
                    handleUpdate({
                      useAutocompleteMultilineCompletions: value as
                        | "auto"
                        | "always"
                        | "never",
                    })
                  }
                  options={[
                    { label: t("Auto"), value: "auto" },
                    { label: t("Always"), value: "always" },
                    { label: t("Never"), value: "never" },
                  ]}
                />
                <UserSetting
                  type="number"
                  title={t("Autocomplete Timeout (ms)")}
                  description="Maximum time in milliseconds for autocomplete request/retrieval."
                  value={modelTimeout}
                  onChange={(val) => handleUpdate({ modelTimeout: val })}
                  min={100}
                  max={5000}
                />
                <UserSetting
                  type="number"
                  title={t("Autocomplete Debounce (ms)")}
                  description="Minimum time in milliseconds to trigger an autocomplete request after a change."
                  value={debounceDelay}
                  onChange={(val) => handleUpdate({ debounceDelay: val })}
                  min={0}
                  max={2500}
                />
                <UserSetting
                  type="input"
                  title={t("Disable autocomplete in files")}
                  description="List of comma-separated glob pattern to disable autocomplete in matching files."
                  placeholder="**/*.(txt,md)"
                  value={formDisableAutocomplete}
                  onChange={setFormDisableAutocomplete}
                  onSubmit={handleDisableAutocompleteSubmit}
                  onCancel={cancelChangeDisableAutocomplete}
                  isDirty={
                    formDisableAutocomplete !== disableAutocompleteInFiles
                  }
                  isValid={formDisableAutocomplete.trim() !== ""}
                />
              </div>
            </Card>
          </div>

          {/* Experimental Settings */}
          <div>
            <ConfigHeader title={t("Experimental")} variant="sm" />
            <Card>
              <Toggle
                isOpen={showExperimental}
                onToggle={() => setShowExperimental(!showExperimental)}
                title={t("Show Experimental Settings")}
              >
                <div className="flex flex-col gap-x-1 gap-y-4">
                  <UserSetting
                    type="toggle"
                    title={t("Add Current File by Default")}
                    description=" the currently open file is added as context in every new conversation."
                    value={useCurrentFileAsContext}
                    onChange={(value) =>
                      handleUpdate({ useCurrentFileAsContext: value })
                    }
                  />
                  <UserSetting
                    type="toggle"
                    title={t("Enable experimental tools")}
                    description=" enables access to experimental tools that are still in development."
                    value={enableExperimentalTools}
                    onChange={(value) =>
                      handleUpdate({ enableExperimentalTools: value })
                    }
                  />
                  <UserSetting
                    type="toggle"
                    title={t("Only use system message tools")}
                    description=" incontrol will not attempt to use native tool calling and will only use system message tools."
                    value={onlyUseSystemMessageTools}
                    onChange={(value) =>
                      handleUpdate({ onlyUseSystemMessageTools: value })
                    }
                  />
                  <UserSetting
                                      type="toggle"
                                      title={t("Slim tool descriptions")}
                                      description=" tools are listed as one-line summaries; the model can call get_tool_usage for full usage docs. Shrinks the prompt when using system message tools."
                                      value={slimToolDescriptions}
                                      onChange={(value) =>
                                        handleUpdate({ slimToolDescriptions: value })
                                      }
                                    />
                                    <UserSetting
                                      type="textarea"
                                      title="Goal Nudge Message"
                                      description="Custom nudge message sent to the model when the session goal is not yet complete. Use {{goal}} to insert the goal text. Leave empty to use the built-in message."
                                      placeholder="Your goal is: {{goal}} ..."
                                      value={formGoalNudgeMessage}
                                      onChange={setFormGoalNudgeMessage}
                                      onSubmit={saveGoalNudgeMessage}
                                      onCancel={cancelGoalNudgeMessage}
                                      isDirty={formGoalNudgeMessage !== goalNudgeMessage}
                                      isValid={true}
                                    />
                  <UserSetting
                    type="number"
                    title="Goal Nudge Count"
                    description="How many times the agent may re-send the session goal when the model ends a turn without calling a tool. 0 disables the auto-continue behaviour."
                    value={maxGoalNudges}
                    onChange={(value) => handleUpdate({ maxGoalNudges: value })}
                    min={0}
                    max={50}
                  />
                  <UserSetting
                    type="toggle"
                    title={t("Stream after tool rejection")}
                    description=" streaming will continue after the tool call is rejected."
                    value={continueAfterToolRejection}
                    onChange={(value) =>
                      handleUpdate({ continueAfterToolRejection: value })
                    }
                  />
                </div>
              </Toggle>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
