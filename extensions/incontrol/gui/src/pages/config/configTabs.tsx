import {
  ArrowLeftIcon,
  Cog6ToothIcon,
  CubeIcon,
  DocumentIcon,
  PencilIcon,
  QuestionMarkCircleIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { ConfigSection } from "./components/ConfigSection";
import { ConfigsSection } from "./sections/ConfigsSection";
import { HelpSection } from "./sections/HelpSection";
import { ModelsSection } from "./sections/ModelsSection";
import { RulesSection } from "./sections/RulesSection";
import { ToolsSection } from "./sections/ToolsSection";
import { UserSettingsSection } from "./sections/UserSettingsSection";
import { t } from "../../i18n";

interface TabOption {
  id: string;
  label: string;
  component: React.ReactNode;
  icon: React.ReactNode;
}

interface TabSection {
  id: string;
  tabs: TabOption[];
  showTopDivider?: boolean;
  showBottomDivider?: boolean;
  className?: string;
}

export const topTabSections: TabSection[] = [
  {
    id: "top",
    tabs: [
      {
        id: "back",
        label: t("Back"),
        component: <div />,
        icon: <ArrowLeftIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />,
      },
    ],
  },
  {
    id: "blocks",
    showTopDivider: true,
    tabs: [
      {
        id: "models",
        label: t("Models"),
        component: (
          <ConfigSection>
            <ModelsSection />
          </ConfigSection>
        ),
        icon: <CubeIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />,
      },
      {
        id: "rules",
        label: t("Rules"),
        component: (
          <ConfigSection>
            <RulesSection />
          </ConfigSection>
        ),
        icon: <PencilIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />,
      },
      {
        id: "tools",
        label: t("Tools"),
        component: (
          <ConfigSection>
            <ToolsSection />
          </ConfigSection>
        ),
        icon: (
          <WrenchScrewdriverIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />
        ),
      },
    ],
  },
  {
    id: "agents-orgs",
    showTopDivider: true,
    tabs: [
      {
        id: "configs",
        label: t("Configs"),
        component: (
          <ConfigSection>
            <ConfigsSection />
          </ConfigSection>
        ),
        icon: <DocumentIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />,
      },
    ],
  },
];

export const bottomTabSections: TabSection[] = [
  {
    id: "bottom",
    tabs: [
      {
        id: "settings",
        label: t("Settings"),
        component: (
          <ConfigSection>
            <UserSettingsSection />
          </ConfigSection>
        ),
        icon: <Cog6ToothIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />,
      },
      {
        id: "help",
        label: t("Help"),
        component: (
          <ConfigSection>
            <HelpSection />
          </ConfigSection>
        ),
        icon: (
          <QuestionMarkCircleIcon className="xs:h-4 xs:w-4 h-3 w-3 flex-shrink-0" />
        ),
      },
    ],
  },
];

export const getAllTabs = (): TabOption[] => {
  return [...topTabSections, ...bottomTabSections].flatMap(
    (section) => section.tabs,
  );
};
