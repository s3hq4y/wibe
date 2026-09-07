import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Alert from "../../components/gui/Alert";
import { TabGroup } from "../../components/ui/TabGroup";
import { useNavigationListener } from "../../hooks/useNavigationListener";
import { bottomTabSections, getAllTabs, topTabSections } from "./configTabs";
import { t } from "../../i18n";

function ConfigPage() {
  useNavigationListener();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "settings";

  const allTabs = getAllTabs();

  const handleTabClick = (tabId: string) => {
    if (tabId === "back") {
      navigate("/");
    } else {
      navigate(`/config?tab=${tabId}`);
    }
  };

  return (
    <div className="flex h-full flex-row overflow-hidden">
      {/* Vertical Sidebar - full height */}
      <div className="bg-vsc-background flex w-12 flex-shrink-0 flex-col border-0 md:w-40">
        <div className="border-r-border flex flex-1 flex-col overflow-y-auto border-b-0 border-l-0 border-r-2 border-t-0 border-solid p-2 text-xs">
          {topTabSections.map((section) => (
            <React.Fragment key={section.id}>
              <TabGroup
                tabs={section.tabs}
                activeTab={activeTab}
                onTabClick={handleTabClick}
                showTopDivider={section.showTopDivider}
                showBottomDivider={section.showBottomDivider}
                className={section.className}
              />
            </React.Fragment>
          ))}

          <div className="flex-1" />

          {/* mt-auto 把这一组顶到底部：上面的 flex-1 占位只有在整条百分比高度链
              都能确定时才生效（唯一确定高度的是 Layout 里 height:100vh 的 GridDiv），
              链一断占位就塌成 0。mt-auto 不依赖父链，两种情况都能贴底。 */}
          <div className="mt-auto flex flex-col gap-0.5">
            {bottomTabSections.map((section) => (
              <TabGroup
                key={section.id}
                tabs={section.tabs}
                activeTab={activeTab}
                onTabClick={handleTabClick}
                showTopDivider={section.showTopDivider}
                showBottomDivider={section.showBottomDivider}
                className={section.className}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Alert for small screens (sm and below) */}
        <div className="block px-4 py-4 sm:hidden">
          <Alert type="warning" className="max-w-md">
            <div className="flex flex-col">
              <div className="font-medium">{t("Screen width too small")}</div>
              <div className="text-description mt-1 text-sm">
                {t("To view settings, please expand the sidebar by dragging the left/right border")}</div>
            </div>
          </Alert>
        </div>

        {/* Tab Content for larger screens (md and above) */}
        <div className="thin-scrollbar relative hidden flex-1 overflow-y-auto sm:block">
          <div className="space-y-6 px-4 py-4">
            {allTabs.find((tab) => tab.id === activeTab)?.component}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConfigPage;
