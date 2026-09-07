import { useNavigate } from "react-router-dom";
import { History } from "../../components/History";
import { PageHeader } from "../../components/PageHeader";
import { getFontSize } from "../../util";
import { t } from "../../i18n";

export default function HistoryPage() {
  const navigate = useNavigate();

  return (
    <div
      className="flex flex-1 flex-col overflow-auto"
      style={{ fontSize: getFontSize() }}
    >
      <PageHeader showBorder onTitleClick={() => navigate("/")} title={t("Chat")} />
      <History />
    </div>
  );
}
