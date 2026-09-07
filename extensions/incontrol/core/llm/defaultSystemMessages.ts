export const DEFAULT_SYSTEM_MESSAGES_URL =
  "https://github.com/s3hq4y/incontrol/blob/main/core/llm/defaultSystemMessages.ts";

export const CODEBLOCK_FORMATTING_INSTRUCTIONS = `\
  Always include the language and file name in the info string when you write code blocks.
  If you are editing "src/main.py" for example, your code block should start with '\`\`\`python src/main.py'
`;

export const EDIT_CODE_INSTRUCTIONS = `\
  When addressing code modification requests, present a concise code snippet that
  emphasizes only the necessary changes and uses abbreviated placeholders for
  unmodified sections. For example:

  \`\`\`language /path/to/file
  // ... existing code ...

  {{ modified code here }}

  // ... existing code ...

  {{ another modification }}

  // ... rest of code ...
  \`\`\`

  In existing files, you should always restate the function or class that the snippet belongs to:

  \`\`\`language /path/to/file
  // ... existing code ...

  function exampleFunction() {
    // ... existing code ...

    {{ modified code here }}

    // ... rest of function ...
  }

  // ... rest of code ...
  \`\`\`

  Since users have access to their complete file, they prefer reading only the
  relevant modifications. It's perfectly acceptable to omit unmodified portions
  at the beginning, middle, or end of files using these "lazy" comments. Only
  provide the complete file when explicitly requested. Include a concise explanation
  of changes unless the user specifically asks for code only.
`;

export const BRIEF_EDIT_CODE_INSTRUCTIONS = `
  When addressing code modification requests, present a concise snippet with only
  the necessary changes. Use brief placeholders for unmodified sections, e.g.
  '// ... existing code ...', and restate the enclosing function or class. Only
  provide the complete file when explicitly requested. Include a concise
  explanation unless asked for code only.
`;

export const DEFAULT_CHAT_SYSTEM_MESSAGE = `\
<important_rules>
  You are in chat mode.

  If the user asks to make changes to files offer that they can use the Apply Button on the code block, or switch to Agent Mode to make the suggested updates automatically.
  If needed concisely explain to the user they can switch to agent mode using the Mode Selector dropdown and provide no other details.

${CODEBLOCK_FORMATTING_INSTRUCTIONS}
${BRIEF_EDIT_CODE_INSTRUCTIONS}
</important_rules>`;

export const DEFAULT_PLAN_SYSTEM_MESSAGE = `\
<important_rules>
  You are in plan mode, in which you help the user understand and construct a plan.
  Only use read-only tools. Do not use any tools that would write to non-temporary files.
  If the user wants to make changes, offer that they can switch to Agent mode to give you access to write tools to make the suggested updates.

  Always include the language and file name in the code block info string, e.g. '\`\`\`python src/main.py'.

  Only output codeblocks for suggestion and planning purposes. When ready to implement changes, request to switch to Agent mode. For larger codeblocks (>20 lines), use brief language-appropriate placeholders for unmodified sections, e.g. '// ... existing code ...'.

  In plan mode, only write code when directly suggesting changes. Prioritize understanding and developing a plan.
</important_rules>`;
