import {
  FQSN,
  PlatformClient,
  SecretResult,
  SecretType,
} from "@incontrol/config-yaml";
import * as dotenv from "dotenv";
import { IDE } from "../..";
import {
  getIncontrolDotEnv,
  LEGACY_WORKSPACE_CONFIG_DIR_NAME,
  WORKSPACE_CONFIG_DIR_NAME,
} from "../../util/paths";
import { joinPathsToUri } from "../../util/uri";

export class LocalPlatformClient implements PlatformClient {
  constructor(private readonly ide: IDE) {}

  /**
   * searches for the first valid secret file in order of ~/.incontrol/.env, <workspace>/.incontrol/.env, <workspace>/.env
   */
  private async findSecretInEnvFiles(
    fqsn: FQSN,
  ): Promise<SecretResult | undefined> {
    const secretValue =
      this.findSecretInLocalEnvFile(fqsn) ??
      (await this.findSecretInWorkspaceEnvFiles(fqsn, true)) ??
      (await this.findSecretInWorkspaceEnvFiles(fqsn, false));

    if (secretValue) {
      return {
        found: true,
        fqsn,
        value: secretValue,
        secretLocation: {
          secretName: fqsn.secretName,
          secretType: SecretType.LocalEnv,
        },
      };
    }
    return undefined;
  }

  private findSecretInLocalEnvFile(fqsn: FQSN): string | undefined {
    try {
      const dotEnv = getIncontrolDotEnv();
      return dotEnv[fqsn.secretName];
    } catch (error) {
      console.warn(
        `Error reading ~/.incontrol/.env file: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private async findSecretInWorkspaceEnvFiles(
    fqsn: FQSN,
    insideIncontrol: boolean,
  ): Promise<string | undefined> {
    try {
      const workspaceDirs = await this.ide.getWorkspaceDirs();
      // New config dir first, then the legacy one, so existing setups keep working
      const dirPrefixes = insideIncontrol
        ? [WORKSPACE_CONFIG_DIR_NAME, LEGACY_WORKSPACE_CONFIG_DIR_NAME]
        : [""];
      for (const folder of workspaceDirs) {
        for (const prefix of dirPrefixes) {
          const envFilePath = joinPathsToUri(folder, prefix, ".env");
          try {
            const fileExists = await this.ide.fileExists(envFilePath);
            if (fileExists) {
              const envContent = await this.ide.readFile(envFilePath);
              const env = dotenv.parse(envContent);
              if (fqsn.secretName in env) {
                return env[fqsn.secretName];
              }
            }
          } catch (error) {
            console.warn(
              `Error reading workspace .env file at ${envFilePath}: ${error instanceof Error ? error.message : String(error)}`,
            );
            // Continue to next candidate
          }
        }
      }

      return undefined;
    } catch (error) {
      console.warn(
        `Error searching workspace .env files: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  async resolveFQSNs(fqsns: FQSN[]): Promise<(SecretResult | undefined)[]> {
    if (fqsns.length === 0) {
      return [];
    }

    const results: (SecretResult | undefined)[] = [];

    for (let i = 0; i < fqsns.length; i++) {
      let secretResult = await this.findSecretInEnvFiles(fqsns[i]);

      // If not found in .env files, try process.env
      if (!secretResult?.found) {
        const secretValueFromProcessEnv = process.env[fqsns[i].secretName];
        if (secretValueFromProcessEnv !== undefined) {
          secretResult = {
            found: true,
            fqsn: fqsns[i],
            value: secretValueFromProcessEnv,
            secretLocation: {
              secretName: fqsns[i].secretName,
              secretType: SecretType.ProcessEnv as SecretType.ProcessEnv,
            },
          };
        }
      }

      results[i] = secretResult;
    }

    return results;
  }
}
