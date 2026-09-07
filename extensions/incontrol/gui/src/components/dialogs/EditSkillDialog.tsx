import { Skill } from "core";
import { useContext, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";

interface EditSkillDialogProps {
  mode: "create" | "edit";
  skill?: Skill;
  scope?: "global" | "workspace";
  onClose: () => void;
  onSaved: () => void;
}

export default function EditSkillDialog({
  mode,
  skill,
  scope,
  onClose,
  onSaved,
}: EditSkillDialogProps) {
  const ideMessenger = useContext(IdeMessengerContext);
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [content, setContent] = useState(skill?.rawContent ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    setError(null);
    if (mode === "create" && !name.trim()) {
      setError("Skill name is required.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "create") {
        await ideMessenger.request("skills/create", {
          name: name.trim(),
          description: description.trim() || undefined,
          scope: scope ?? "global",
        });
      } else if (skill) {
        await ideMessenger.request("skills/write", {
          path: skill.fileUri ?? skill.path,
          content,
        });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-editor-widgetBackground border-command-border max-h-[85vh] w-[720px] max-w-[90vw] overflow-auto rounded-md border p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">
            {mode === "create" ? "New skill" : `Edit skill: ${skill?.name}`}
          </h3>
          <button
            onClick={onClose}
            className="cursor-pointer text-xs text-gray-400 hover:text-foreground"
          >
            {"\u2715"}
          </button>
        </div>

        {mode === "create" ? (
          <div className="mb-2 flex flex-col gap-2">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Name</label>
              <input
                className="bg-input border-command-border text-foreground w-full rounded border px-2 py-1.5 text-xs"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-skill"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">
                Description
              </label>
              <input
                className="bg-input border-command-border text-foreground w-full rounded border px-2 py-1.5 text-xs"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="When the model should use this skill"
              />
            </div>
            <p className="text-description text-[11px]">
              Created in{" "}
              {scope === "workspace"
                ? "the workspace .incontrol/skills folder"
                : "the global ~/.incontrol/skills folder"}
              . Edit the generated SKILL.md afterwards to fill in the steps.
            </p>
          </div>
        ) : (
          <p className="text-description mb-2 text-xs">
            Raw SKILL.md content. Keep the frontmatter (name and description)
            intact.
          </p>
        )}

        {mode === "edit" && (
          <textarea
            className="bg-input border-command-border text-foreground h-[360px] w-full resize-y rounded border p-2 font-mono text-xs"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="border-command-border text-description hover:text-foreground cursor-pointer rounded border px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={busy}
            className="bg-button-background text-button-foreground cursor-pointer rounded px-3 py-1.5 text-xs hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
