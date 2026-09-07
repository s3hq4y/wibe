import {
  NumberedListIcon,
  PaintBrushIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import { useContext, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Shortcut from "../../../components/gui/Shortcut";
import { Card } from "../../../components/ui";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppSelector } from "../../../redux/hooks";
import { isJetBrains } from "../../../util";
import { ROUTES } from "../../../util/navigation";
import { ConfigHeader } from "../components/ConfigHeader";
import { ConfigRow } from "../components/ConfigRow";
import { t } from "../../../i18n";

interface KeyboardShortcutProps {
  shortcut: string;
  description: string;
  isEven: boolean;
}

function KeyboardShortcut(props: KeyboardShortcutProps) {
  return (
    <div
      className={`flex flex-col items-start p-3 sm:flex-row sm:items-center ${props.isEven ? "" : "bg-vsc-editor-background/50"}`}
    >
      <div className="w-full flex-grow pb-2 pr-4 sm:w-auto sm:pb-0">
        <span className="block break-words text-sm">{props.description}:</span>
      </div>
      <div className="flex-shrink-0 whitespace-nowrap">
        <Shortcut>{props.shortcut}</Shortcut>
      </div>
    </div>
  );
}

// Shortcut strings will be rendered correctly based on the platform by the Shortcut component
const vscodeShortcuts: Omit<KeyboardShortcutProps, "isEven">[] = [
  {
    shortcut: "cmd '",
    description: t("Toggle Selected Model"),
  },
  {
    shortcut: "cmd I",
    description: t("Edit highlighted code"),
  },
  {
    shortcut: "cmd L",
    description:
      t("New Chat / New Chat With Selected Code / Close incontrol Sidebar If Chat Already In Focus"),
  },
  {
    shortcut: "cmd backspace",
    description: t("Cancel response"),
  },
  {
    shortcut: "cmd shift I",
    description: t("Toggle inline edit focus"),
  },
  {
    shortcut: "cmd shift L",
    description:
      t("Focus Current Chat / Add Selected Code To Current Chat / Close incontrol Sidebar If Chat Already In Focus"),
  },
  {
    shortcut: "cmd shift R",
    description: t("Debug Terminal"),
  },
  {
    shortcut: "cmd shift backspace",
    description: t("Reject Diff"),
  },
  {
    shortcut: "cmd shift enter",
    description: t("Accept Diff"),
  },
  {
    shortcut: "alt cmd N",
    description: t("Reject Top Change in Diff"),
  },
  {
    shortcut: "alt cmd Y",
    description: t("Accept Top Change in Diff"),
  },
  {
    shortcut: "cmd K cmd A",
    description: t("Toggle Autocomplete Enabled"),
  },
  {
    shortcut: "cmd alt space",
    description: t("Force an Autocomplete Trigger"),
  },
  {
    shortcut: "cmd K cmd M",
    description: t("Toggle Full Screen"),
  },
];

const jetbrainsShortcuts: Omit<KeyboardShortcutProps, "isEven">[] = [
  {
    shortcut: "cmd '",
    description: t("Toggle Selected Model"),
  },
  {
    shortcut: "cmd I",
    description: t("Edit highlighted code"),
  },
  {
    shortcut: "cmd J",
    description:
      t("New Chat / New Chat With Selected Code / Close incontrol Sidebar If Chat Already In Focus"),
  },
  {
    shortcut: "cmd backspace",
    description: t("Cancel response"),
  },
  {
    shortcut: "cmd shift I",
    description: t("Toggle inline edit focus"),
  },
  {
    shortcut: "cmd shift J",
    description:
      t("Focus Current Chat / Add Selected Code To Current Chat / Close incontrol Sidebar If Chat Already In Focus"),
  },
  {
    shortcut: "cmd shift backspace",
    description: t("Reject Diff"),
  },
  {
    shortcut: "cmd shift enter",
    description: t("Accept Diff"),
  },
  {
    shortcut: "alt shift J",
    description: t("Quick Input"),
  },
  {
    shortcut: "alt cmd J",
    description: t("Toggle Sidebar"),
  },
];

export function HelpSection() {
  const ideMessenger = useContext(IdeMessengerContext);
  const navigate = useNavigate();

  const currentSession = useAppSelector((state) => state.session);

  const shortcuts = useMemo(() => {
    return isJetBrains() ? jetbrainsShortcuts : vscodeShortcuts;
  }, []);

  const handleViewSessionData = async () => {
    const sessionData = await ideMessenger.request("history/load", {
      id: currentSession.id,
    });

    if (sessionData.status === "success") {
      await ideMessenger.request("showVirtualFile", {
        name: `${sessionData.content.title}.json`,
        content: JSON.stringify(sessionData.content, null, 2),
      });
    }
  };

  return (
    <div className="flex flex-col">
      <ConfigHeader title={t("Help Center")} />
      <div className="space-y-6">
        {/* Tools */}
        <div>
          <h3 className="mb-3 text-base font-medium">{t("Tools")}</h3>
          <Card className="!p-0">
            <div className="flex flex-col">
              <ConfigRow
                title={t("Token usage")}
                description="Daily token usage across models"
                icon={TableCellsIcon}
                onClick={() => navigate(ROUTES.STATS)}
              />

              {currentSession.history.length > 0 &&
                !currentSession.isStreaming && (
                  <ConfigRow
                    title={t("View current session history")}
                    description="Open the current chat session file for troubleshooting"
                    icon={NumberedListIcon}
                    onClick={handleViewSessionData}
                  />
                )}

              {process.env.NODE_ENV === "development" && (
                <ConfigRow
                  title={t("Theme Test Page")}
                  description="Development page for testing themes"
                  icon={PaintBrushIcon}
                  onClick={async () => {
                    navigate(ROUTES.THEME);
                  }}
                />
              )}
            </div>
          </Card>
        </div>

        {/* Keyboard Shortcuts */}
        <div>
          <h3 className="mb-3 text-base font-medium">{t("Keyboard Shortcuts")}</h3>
          <Card className="!p-0">
            <div className="overflow-hidden rounded-md border border-gray-600">
              {shortcuts.map((shortcut, i) => {
                return (
                  <KeyboardShortcut
                    key={i}
                    shortcut={shortcut.shortcut}
                    description={shortcut.description}
                    isEven={i % 2 === 0}
                  />
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
