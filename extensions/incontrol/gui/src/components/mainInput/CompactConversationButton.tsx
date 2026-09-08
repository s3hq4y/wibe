import { ArrowsPointingInIcon } from "@heroicons/react/24/outline";
import { useAppSelector } from "../../redux/hooks";
import { useCompactConversation } from "../../util/compactConversation";
import { Button } from "../ui";
import { t } from "../../i18n";

/**
 * 手动「压缩会话」按钮（需求 2 的入口）。
 *
 * 点击后会对当前会话做一次压缩：用聊天模型生成一份结构化摘要，挂到最近一条
 * AI 回复上，并把「压缩完成」事件发给扩展 —— 扩展侧随后会：
 *   1) 把摘要复制到剪贴板；
 *   2) 若该 IDE 会话已绑定 uwa 网页对话，把摘要 + 系统提示词发送到一个全新
 *      的网页对话，并把本会话绑定 URL 更新为新对话（后续续聊自动落在新对话）。
 *
 * 按钮显示在聊天界面输入区上方的工具行；压缩期间禁用，避免并发触发。
 */
export default function CompactConversationButton() {
  const history = useAppSelector((state) => state.session.history);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const isInEdit = useAppSelector((state) => state.session.isInEdit);
  const compactionLoading = useAppSelector(
    (state) => state.session.compactionLoading,
  );
  const compactConversation = useCompactConversation();

  if (!history?.length) {
    return null;
  }

  // 摘要挂在「最近的 AI 回复」上，因此压缩目标取最后一条 assistant 消息。
  let index = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (String(history[i].message.role ?? "").toLowerCase() === "assistant") {
      index = i;
      break;
    }
  }
  if (index < 0) {
    return null;
  }

  const loading = !!compactionLoading?.[index];
  const disabled = isStreaming || isInEdit || loading;

  return (
    <Button
      size="sm"
      variant="secondary"
      type="button"
      disabled={disabled}
      data-testid="compact-conversation-button"
      title="Compact conversation: summarize it with AI (copies summary), then start a fresh uwa web conversation with the summary and update this session's bound URL. The session must already be bound to a web conversation."
      onClick={() => void compactConversation(index)}
    >
      <ArrowsPointingInIcon className="h-3.5 w-3.5" />
      <span className="hidden md:inline">{t("Compact conversation")}</span>
    </Button>
  );
}
