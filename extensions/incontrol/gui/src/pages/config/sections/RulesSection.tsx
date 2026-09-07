import { parseConfigYaml } from "@incontrol/config-yaml";
import {
  ArrowsPointingOutIcon,
  BookmarkIcon as BookmarkOutline,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { BookmarkIcon as BookmarkSolid } from "@heroicons/react/24/solid";
import {
  BrowserSerializedIncontrolConfig,
  RuleSource,
  RuleWithSource,
  Skill,
  SlashCommandDescWithSource,
} from "core";
import { getRuleDisplayName } from "core/llm/rules/rules-utils";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DropdownButton } from "../../../components/DropdownButton";
import AddRuleDialog from "../../../components/dialogs/AddRuleDialog";
import EditSkillDialog from "../../../components/dialogs/EditSkillDialog";
import ConfirmationDialog from "../../../components/dialogs/ConfirmationDialog";
import HeaderButtonWithToolTip from "../../../components/gui/HeaderButtonWithToolTip";
import Switch from "../../../components/gui/Switch";
import {
  useEditBlock,
  useOpenRule,
} from "../../../components/mainInput/Lump/useEditBlock";
import { useMainEditor } from "../../../components/mainInput/TipTapEditor";
import { Card, EmptyState } from "../../../components/ui";
import { useAuth } from "../../../context/Auth";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useBookmarkedSlashCommands } from "../../../hooks/useBookmarkedSlashCommands";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";

import {
  DEFAULT_RULE_SETTING,
  setDialogMessage,
  setShowDialog,
  toggleRuleSetting,
} from "../../../redux/slices/uiSlice";
import { fontSize } from "../../../util";
import { ConfigHeader } from "../components/ConfigHeader";
import { t } from "../../../i18n";

interface PromptCommandWithSlug extends SlashCommandDescWithSource {
  slug?: string;
}

interface PromptRowProps {
  prompt: PromptCommandWithSlug;
  isBookmarked: boolean;
  setIsBookmarked: (isBookmarked: boolean) => void;
  onEdit?: () => void;
}

/**
 * Displays a single prompt row with bookmark and edit controls
 */
function PromptRow({
  prompt,
  isBookmarked,
  setIsBookmarked,
  onEdit,
}: PromptRowProps) {
  const { mainEditor } = useMainEditor();

  const handlePromptClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    mainEditor?.commands.insertPrompt({
      title: prompt.name,
      description: prompt.description,
      content: prompt.prompt,
    });
  };

  const handleBookmarkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsBookmarked(!isBookmarked);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onEdit) {
      onEdit();
    }
  };

  const canEdit = prompt.source !== "built-in";

  return (
    <div
      className="hover:bg-list-active hover:text-list-active-foreground flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:cursor-pointer"
      onClick={handlePromptClick}
      style={{
        fontSize: fontSize(-3),
      }}
    >
      <div className="flex min-w-0 flex-col">
        <span className="text-vscForeground shrink-0 font-medium">
          {prompt.name}
        </span>
        <span className="line-clamp-2 text-[11px] text-gray-400">
          {prompt.description}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {canEdit && (
          <PencilIcon
            className={`h-3 w-3 cursor-pointer text-gray-400 hover:brightness-125`}
            onClick={canEdit ? handleEditClick : undefined}
            aria-disabled={!canEdit}
          />
        )}
        <div
          onClick={handleBookmarkClick}
          className="cursor-pointer pt-0.5 text-gray-400 hover:brightness-125"
        >
          {isBookmarked ? (
            <BookmarkSolid className="h-3 w-3" />
          ) : (
            <BookmarkOutline className="h-3 w-3" />
          )}
        </div>
      </div>
    </div>
  );
}

interface RuleCardProps {
  rule: RuleWithSource;
}

const RuleCard: React.FC<RuleCardProps> = ({ rule }) => {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const policy = useAppSelector((state) =>
    rule.name
      ? state.ui.ruleSettings[rule.name] || DEFAULT_RULE_SETTING
      : undefined,
  );

  const isDisabled = policy === "off";
  const openRule = useOpenRule();
  const handleTogglePolicy = () => {
    if (rule.name) {
      dispatch(toggleRuleSetting(rule.name));
    }
  };

  const title = useMemo(() => {
    return getRuleDisplayName(rule);
  }, [rule]);

  function onClickExpand() {
    dispatch(setShowDialog(true));
    dispatch(
      setDialogMessage(
        <div className="max-h-4/5 p-4">
          <h3>{title}</h3>
          <pre className="max-w-full overflow-scroll">{rule.rule}</pre>
        </div>,
      ),
    );
  }

  const handleDelete = () => {
    if (!rule.sourceFile) {
      return;
    }

    dispatch(
      setDialogMessage(
        <ConfirmationDialog
          title={t("Delete Rule")}
          text="Are you sure you want to delete this rule file?"
          confirmText="Delete"
          onConfirm={async () => {
            try {
              await ideMessenger.request("config/deleteRule", {
                filepath: rule.sourceFile!,
              });
            } catch (error) {
              console.error("Failed to delete rule file:", error);
            }
          }}
        />,
      ),
    );
    dispatch(setShowDialog(true));
  };

  const canDeleteRule = !!rule.sourceFile;

  const smallFont = fontSize(-2);
  const tinyFont = fontSize(-3);
  return (
    <div
      className={`border-border flex flex-col rounded-sm px-2 py-1.5 transition-colors ${isDisabled ? "opacity-50" : ""}`}
    >
      <div className="flex flex-col">
        <div className="flex flex-row justify-between gap-1">
          <span
            className={`line-clamp-2 ${isDisabled ? "text-gray-400" : "text-vsc-foreground"}`}
            style={{
              fontSize: smallFont,
            }}
          >
            {title}
          </span>
          <div className="flex flex-row items-center gap-2">
            {rule.name && policy && (
              <div className="flex cursor-pointer flex-row items-center justify-end gap-1 px-2 py-0.5">
                <Switch
                  isToggled={policy === "on"}
                  onToggle={() => handleTogglePolicy()}
                  size={10}
                  text=""
                />
              </div>
            )}
            <div className="flex flex-row items-start gap-1">
              <HeaderButtonWithToolTip onClick={onClickExpand} text="Expand">
                <ArrowsPointingOutIcon className="h-3 w-3 text-gray-400" />
              </HeaderButtonWithToolTip>{" "}
              <HeaderButtonWithToolTip
                onClick={() => openRule(rule)}
                text="Edit"
              >
                <PencilIcon className="h-3 w-3 text-gray-400" />
              </HeaderButtonWithToolTip>
              {canDeleteRule && (
                <HeaderButtonWithToolTip onClick={handleDelete} text="Delete">
                  <TrashIcon className="h-3 w-3 text-gray-400" />
                </HeaderButtonWithToolTip>
              )}
            </div>
          </div>
        </div>

        <span
          style={{
            fontSize: tinyFont,
          }}
          className={`mt-1 line-clamp-3 ${isDisabled ? "text-gray-500" : "text-gray-400"}`}
        >
          {rule.rule}
        </span>
        {rule.globs ? (
          <div
            style={{
              fontSize: tinyFont,
            }}
            className="mt-1.5 flex flex-col gap-1"
          >
            <span className="italic">{t("Applies to files")}</span>
            <code
              className={`line-clamp-1 px-1 py-0.5 ${isDisabled ? "text-gray-500" : "text-gray-400"}`}
            >
              {rule.globs}
            </code>
          </div>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Section that displays all available prompts with bookmarking functionality
 */
function PromptsSubSection() {
  const { selectedProfile } = useAuth();
  const { isCommandBookmarked, toggleBookmark } = useBookmarkedSlashCommands();
  const ideMessenger = useContext(IdeMessengerContext);

  const slashCommands = useAppSelector(
    (state) => state.config.config.slashCommands ?? [],
  );

  const editBlock = useEditBlock();

  const handleEdit = (prompt: PromptCommandWithSlug) => {
    editBlock(prompt.slug, prompt.sourceFile);
  };

  const handleAddPrompt = () => {
    void ideMessenger.request("config/addLocalWorkspaceBlock", {
      blockType: "prompts",
    });
  };

  const sortedCommands = useMemo(() => {
    const promptsWithSlug: PromptCommandWithSlug[] =
      structuredClone(slashCommands);
    // get the slugs from rawYaml
    if (selectedProfile?.rawYaml) {
      const parsed = parseConfigYaml(selectedProfile.rawYaml);
      const parsedPrompts = parsed.prompts ?? [];

      let index = 0;
      for (const commandWithSlug of promptsWithSlug) {
        // skip for local prompt files
        if (commandWithSlug.sourceFile) continue;

        const yamlPrompt = parsedPrompts[index];
        if (yamlPrompt) {
          if ("uses" in yamlPrompt) {
            commandWithSlug.slug = yamlPrompt.uses;
          } else {
            commandWithSlug.slug = `${selectedProfile?.fullSlug.ownerSlug}/${selectedProfile?.fullSlug.packageSlug}`;
          }
        }
        index = index + 1;
      }
    }
    return promptsWithSlug.sort((a, b) => {
      const aBookmarked = isCommandBookmarked(a.name);
      const bBookmarked = isCommandBookmarked(b.name);
      if (aBookmarked && !bBookmarked) return -1;
      if (!aBookmarked && bBookmarked) return 1;
      return 0;
    });
  }, [slashCommands, isCommandBookmarked, selectedProfile]);

  return (
    <div>
      <ConfigHeader
        title={t("Prompts")}
        variant="sm"
        onAddClick={handleAddPrompt}
        addButtonTooltip="Add prompt"
      />

      {sortedCommands.length > 0 ? (
        <Card>
          <div>
            {sortedCommands.map((prompt) => (
              <PromptRow
                key={prompt.name}
                prompt={prompt}
                isBookmarked={isCommandBookmarked(prompt.name)}
                setIsBookmarked={() => toggleBookmark(prompt)}
                onEdit={() => handleEdit(prompt)}
              />
            ))}
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState message="No prompts configured. Click the + button to add your first prompt." />
        </Card>
      )}
    </div>
  );
}

// Define dropdown options for global rules
const globalRulesOptions = [
  { value: "workspace", label: t("Current workspace") },
  { value: "global", label: t("Global") },
];

function RulesSubSection() {
  const { selectedProfile } = useAuth();
  const config = useAppSelector((store) => store.config.config);
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();
  const [globalRulesMode, setGlobalRulesMode] = useState<string>("workspace");
  const configLoading = useAppSelector((store) => store.config.loading);
  const [rulesVersion, setRulesVersion] = useState(0);

  const handleAddRule = (mode?: string) => {
    const currentMode = mode || globalRulesMode;
    dispatch(setShowDialog(true));
    dispatch(
      setDialogMessage(
        <AddRuleDialog
          mode={currentMode === "global" ? "global" : "workspace"}
        />,
      ),
    );
  };

  const handleOptionClick = (value: string) => {
    setGlobalRulesMode(value);
    handleAddRule(value);
  };

  const sortedRules: RuleWithSource[] = useMemo(() => {
    const rules = [...config.rules.map((rule) => ({ ...rule }))];

    // Use profile rawYaml to infer slugs
    if (selectedProfile?.rawYaml) {
      try {
        const parsed = parseConfigYaml(selectedProfile.rawYaml);
        const parsedRules = parsed?.rules ?? [];
        let index = 0;
        for (const rule of rules) {
          if (rule.source === "rules-block") {
            let slug: string | undefined = undefined;
            const yamlRule = parsedRules[index];
            if (yamlRule) {
              if (typeof yamlRule !== "string" && "uses" in yamlRule) {
                slug = yamlRule.uses;
              } else {
                slug = `${selectedProfile?.fullSlug.ownerSlug}/${selectedProfile?.fullSlug.packageSlug}`;
              }
            }
            if (slug) {
              rule.slug = slug;
            }

            index++;
          }
        }
      } catch (e) {
        console.error(
          "Rules notch section: failed to parse selected profile",
          e,
        );
      }
    }

    return rules;
  }, [config, selectedProfile, rulesVersion]);

  return (
    <div>
      <DropdownButton
        title={t("Rules")}
        variant="sm"
        options={globalRulesOptions}
        onOptionClick={handleOptionClick}
        addButtonTooltip="Add rules"
      />

      <Card>
        {sortedRules.length > 0 ? (
          <div className="flex flex-col gap-3">
            {sortedRules.map((rule, index) => (
              <RuleCard key={index} rule={rule} />
            ))}
            {configLoading && (
              <div className="px-2 py-1.5 text-xs opacity-65">
                {t("Reloading rules from your config...")}</div>
            )}
          </div>
        ) : (
          <EmptyState message="No rules configured. Click the + button to add your first rule." />
        )}
      </Card>
    </div>
  );
}

function SkillsSubSection() {
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [dialogState, setDialogState] = useState<
    | { mode: "create"; scope: "global" | "workspace" }
    | { mode: "edit"; skill: Skill }
    | null
  >(null);

  const refresh = useCallback(async () => {
    try {
      const res = await ideMessenger.request("skills/list", undefined);
      if (res.status === "error") {
        throw new Error(res.error);
      }
      setSkills(res.content.result);
    } catch (error) {
      console.error("Failed to load skills:", error);
      setSkills([]);
    }
  }, [ideMessenger]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleToggle = async (skill: Skill) => {
    try {
      await ideMessenger.request("skills/setDisabled", {
        name: skill.name,
        disabled: !skill.disabled,
      });
      void refresh();
    } catch (error) {
      console.error("Failed to update skill availability:", error);
    }
  };

  const handleDelete = (skill: Skill) => {
    dispatch(
      setDialogMessage(
        <ConfirmationDialog
          title={t("Delete Skill")}
          text="Are you sure you want to delete this skill? Supporting files in the skill directory are kept."
          confirmText="Delete"
          onConfirm={async () => {
            try {
              await ideMessenger.request("skills/delete", {
                path: skill.fileUri ?? skill.path,
              });
              void refresh();
            } catch (error) {
              console.error("Failed to delete skill:", error);
            }
          }}
        />,
      ),
    );
    dispatch(setShowDialog(true));
  };

  return (
    <div>
      <DropdownButton
        title={t("Skills")}
        variant="sm"
        options={[
          { value: "global", label: t("Global") },
          { value: "workspace", label: t("Current workspace") },
        ]}
        onOptionClick={(value) =>
          setDialogState({
            mode: "create",
            scope: value === "workspace" ? "workspace" : "global",
          })
        }
        addButtonTooltip="Add skills"
      />

      <Card>
        {skills === null ? (
          <div className="px-2 py-1.5 text-xs opacity-65">
            {t("Loading skills...")}</div>
        ) : skills.length > 0 ? (
          <div className="flex flex-col gap-3">
            {skills.map((skill) => (
              <div
                key={`${skill.name}-${skill.path}`}
                className={`border-border flex flex-col rounded-sm px-2 py-1.5 ${skill.disabled ? "opacity-50" : ""}`}
              >
                <div className="flex flex-row items-center justify-between gap-1">
                  <span
                    className="text-vsc-foreground line-clamp-2"
                    style={{
                      fontSize: fontSize(-3),
                    }}
                  >
                    {skill.name}
                  </span>
                  <div className="flex flex-row items-center gap-2">
                    <Switch
                      isToggled={!skill.disabled}
                      onToggle={() => void handleToggle(skill)}
                      size={10}
                      text=""
                    />
                    <HeaderButtonWithToolTip
                      text="Edit"
                      onClick={() => setDialogState({ mode: "edit", skill })}
                    >
                      <PencilIcon className="h-3 w-3 text-gray-400" />
                    </HeaderButtonWithToolTip>
                    <HeaderButtonWithToolTip
                      text="Delete"
                      onClick={() => handleDelete(skill)}
                    >
                      <TrashIcon className="h-3 w-3 text-gray-400" />
                    </HeaderButtonWithToolTip>
                  </div>
                </div>
                <span
                  className="mt-1 line-clamp-3 text-gray-400"
                  style={{
                    fontSize: fontSize(-3),
                  }}
                >
                  {skill.description}
                </span>
                <span
                  className="mt-1.5 line-clamp-1 italic text-gray-500"
                  style={{
                    fontSize: fontSize(-4),
                  }}
                >
                  {skill.path}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message="No skills found. Use the + button to create one, or add a SKILL.md under .incontrol/skills/." />
        )}
      </Card>

      {dialogState && (
        <EditSkillDialog
          mode={dialogState.mode}
          skill={dialogState.mode === "edit" ? dialogState.skill : undefined}
          scope={
            dialogState.mode === "create" ? dialogState.scope : undefined
          }
          onClose={() => setDialogState(null)}
          onSaved={() => {
            setDialogState(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

export function RulesSection() {
  return (
    <>
      <ConfigHeader title={t("Rules")} />

      <div className="space-y-6">
        <RulesSubSection />
        <PromptsSubSection />
        <SkillsSubSection />
      </div>
    </>
  );
}
