import fs from "fs";
import { IDE } from "..";
import { getGlobalIncontrolIgnorePath } from "../util/paths";
import { gitIgArrayFromFile } from "./ignore";

export const getGlobalIncontrolIgArray = () => {
  const contents = fs.readFileSync(getGlobalIncontrolIgnorePath(), "utf8");
  return gitIgArrayFromFile(contents);
};

export const getWorkspaceIncontrolIgArray = async (ide: IDE) => {
  const dirs = await ide.getWorkspaceDirs();
  return await dirs.reduce(
    async (accPromise, dir) => {
      const acc = await accPromise;
      try {
        const contents = await ide.readFile(`${dir}/.incontrolignore`);
        return [...acc, ...gitIgArrayFromFile(contents)];
      } catch (err) {
        // Fall back to the pre-rebrand .continueignore convention.
        try {
          const contents = await ide.readFile(`${dir}/.continueignore`);
          return [...acc, ...gitIgArrayFromFile(contents)];
        } catch (legacyErr) {
          console.error(legacyErr);
          return acc;
        }
      }
    },
    Promise.resolve([] as string[]),
  );
};
