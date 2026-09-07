import { ConversationStarterCards } from "../../components/ConversationStarters";
import { SystemPromptKickoffCard } from "./SystemPromptKickoffCard";

export function EmptyChatBody() {
  // 不要加 w-full：块级 flex 容器在 auto 宽度下已经填满父级内容区；再叠 width:100%
  // 会让「100% 父内容宽 + 左右 mx-2(16px)」溢出容器 16px，右侧（含卡片右边框）
  // 被 overflow 裁掉。根因是全站缺 box-sizing 重置，已由 gui/src/index.css 修掉。
  return (
    <div className="mx-2 mt-2 flex flex-col gap-3">
      <SystemPromptKickoffCard />
      <ConversationStarterCards />
    </div>
  );
}
