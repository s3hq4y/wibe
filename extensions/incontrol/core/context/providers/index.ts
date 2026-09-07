import { BaseContextProvider } from "../";
import { ContextProviderName } from "../../";

import ClipboardContextProvider from "./ClipboardContextProvider";

import CurrentFileContextProvider from "./CurrentFileContextProvider";
import DebugLocalsProvider from "./DebugLocalsProvider";
import DiffContextProvider from "./DiffContextProvider";
import DiscordContextProvider from "./DiscordContextProvider";
import FileContextProvider from "./FileContextProvider";
import FileTreeContextProvider from "./FileTreeContextProvider";
import GitCommitContextProvider from "./GitCommitContextProvider";
import GitHubIssuesContextProvider from "./GitHubIssuesContextProvider";
import GitLabMergeRequestContextProvider from "./GitLabMergeRequestContextProvider";
import GoogleContextProvider from "./GoogleContextProvider";
import GreptileContextProvider from "./GreptileContextProvider";
import HttpContextProvider from "./HttpContextProvider";
import JiraIssuesContextProvider from "./JiraIssuesContextProvider/";
import MCPContextProvider from "./MCPContextProvider";
import OpenFilesContextProvider from "./OpenFilesContextProvider";
import OSContextProvider from "./OSContextProvider";
import ProblemsContextProvider from "./ProblemsContextProvider";
import RulesContextProvider from "./RulesContextProvider";
import SearchContextProvider from "./SearchContextProvider";
import TerminalContextProvider from "./TerminalContextProvider";
import URLContextProvider from "./URLContextProvider";
import WebContextProvider from "./WebContextProvider";

/**
 * Note: We are currently omitting the following providers due to bugs:
 * - `CodeOutlineContextProvider`
 * - `CodeHighlightsContextProvider`
 *
 * See this issue for details: https://github.com/s3hq4y/incontrol/issues/1365
 */
export const Providers: (typeof BaseContextProvider)[] = [
  FileContextProvider,
  DiffContextProvider,
  FileTreeContextProvider,
  GitHubIssuesContextProvider,
  GoogleContextProvider,
  TerminalContextProvider,
  DebugLocalsProvider,
  OpenFilesContextProvider,
  HttpContextProvider,
  SearchContextProvider,
  OSContextProvider,
  ProblemsContextProvider,
  GitLabMergeRequestContextProvider,
  JiraIssuesContextProvider,
  CurrentFileContextProvider,
  URLContextProvider,
  DiscordContextProvider,
  GreptileContextProvider,
  WebContextProvider,
  MCPContextProvider,
  GitCommitContextProvider,
  ClipboardContextProvider,
  RulesContextProvider,
];

export function contextProviderClassFromName(
  name: ContextProviderName,
): typeof BaseContextProvider | undefined {
  const provider = Providers.find((cls) => cls.description.title === name);

  return provider;
}
