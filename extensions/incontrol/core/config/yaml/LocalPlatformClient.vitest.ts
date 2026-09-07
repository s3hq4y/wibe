import { FQSN, SecretResult, SecretType } from "@incontrol/config-yaml";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  Mock,
  test,
  vi,
} from "vitest";
import { IDE } from "../..";
import { LocalPlatformClient } from "./LocalPlatformClient";

vi.mock("../../util/paths", { spy: true });

describe("LocalPlatformClient", () => {
  const testFQSN: FQSN = {
    packageSlugs: [
      {
        ownerSlug: "test-owner-slug",
        packageSlug: "test-package-slug",
      },
    ],
    secretName: "TEST_CONTINUE_SECRET_KEY",
  };
  const testFQSN2: FQSN = {
    packageSlugs: [
      {
        ownerSlug: "test-owner-slug-2",
        packageSlug: "test-package-slug-2",
      },
    ],
    secretName: "TEST_WORKSPACE_SECRET_KEY",
  };

  let testIde: IDE;
  beforeEach(
    /**dynamic import before each test for test isolation */
    async () => {
      const testFixtures = await import("../../test/fixtures");
      testIde = testFixtures.testIde;
    },
    30_000,
  );

  let secretValue: string;
  let envKeyValues: Record<string, unknown>;
  let envKeyValuesString: string;
  beforeEach(
    /**generate unique env key value pairs for each test */
    () => {
      secretValue = Math.floor(Math.random() * 100) + "";
      envKeyValues = {
        TEST_CONTINUE_SECRET_KEY: secretValue,
        TEST_WORKSPACE_SECRET_KEY: secretValue + "-workspace",
      };
      envKeyValuesString = Object.entries(envKeyValues)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
    },
  );

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.resetModules(); // clear dynamic imported module cache
  });

  test(
    "should not be able to resolve FQSNs if they do not exist",
    async () => {
      const localPlatformClient = new LocalPlatformClient(testIde);
      const resolvedFQSNs = await localPlatformClient.resolveFQSNs([testFQSN]);

      expect(resolvedFQSNs.length).toBeGreaterThan(0);
      expect(resolvedFQSNs[0]?.found).toBeUndefined();
    },
    30_000,
  );

  describe("searches for secrets in local .env files", () => {
    let getIncontrolDotEnv: Mock;
    beforeEach(async () => {
      const utilPaths = await import("../../util/paths");
      getIncontrolDotEnv = vi.fn(() => envKeyValues);
      utilPaths.getIncontrolDotEnv = getIncontrolDotEnv;
    });

    test("should be able to get secrets from ~/.continue/.env files", async () => {
      const localPlatformClient = new LocalPlatformClient(testIde);
      const resolvedFQSNs = await localPlatformClient.resolveFQSNs([testFQSN]);
      expect(getIncontrolDotEnv).toHaveBeenCalled();
      expect(resolvedFQSNs.length).toBe(1);
      expect(
        (resolvedFQSNs[0] as SecretResult & { value: unknown })?.value,
      ).toBe(secretValue);
    });
  });

  describe("should be able to get secrets from workspace .env files", () => {
    test("should get secrets from <workspace>/.continue/.env and <workspace>/.env", async () => {
      const originalIdeFileExists = testIde.fileExists;
      testIde.fileExists = vi.fn(async (fileUri: string) =>
        fileUri.includes(".env") ? true : originalIdeFileExists(fileUri),
      );

      const originalIdeReadFile = testIde.readFile;
      const randomValueForIncontrolDirDotEnv =
        "continue-dir-" + Math.floor(Math.random() * 100);
      const randomValueForWorkspaceDotEnv =
        "dotenv-" + Math.floor(Math.random() * 100);

      testIde.readFile = vi.fn(async (fileUri: string) => {
        // fileUri should contain .continue/.env and not .env
        if (fileUri.match(/.*(\.incontrol|\.continue)\/\.env.*/gi)?.length) {
          return (
            envKeyValuesString.split("\n")[0] + randomValueForIncontrolDirDotEnv
          );
        }
        // fileUri should contain .env outside the config dirs
        else if (
          fileUri.match(/.*(?<!\.incontrol\/)(?<!\.continue\/)\.env.*/gi)
            ?.length
        ) {
          return (
            envKeyValuesString.split("\n")[1] + randomValueForWorkspaceDotEnv
          );
        }
        return originalIdeReadFile(fileUri);
      });

      const localPlatformClient = new LocalPlatformClient(testIde);
      const resolvedFQSNs = await localPlatformClient.resolveFQSNs([
        testFQSN,
        testFQSN2,
      ]);

      // both the secrets should be present as they are retrieved from different files

      expect(resolvedFQSNs.length).toBe(2);

      const incontrolDirSecretValue = (
        resolvedFQSNs[0] as SecretResult & { value: unknown }
      )?.value;
      const dotEnvSecretValue = (
        resolvedFQSNs[1] as SecretResult & { value: unknown }
      )?.value;
      expect(incontrolDirSecretValue).toContain(secretValue);
      expect(incontrolDirSecretValue).toContain(randomValueForIncontrolDirDotEnv);
      expect(dotEnvSecretValue).toContain(secretValue + "-workspace");
      expect(dotEnvSecretValue).toContain(randomValueForWorkspaceDotEnv);
    });

    test("should first get secrets from <workspace>/.incontrol/.env and then <workspace>/.env", async () => {
      const originalIdeFileExists = testIde.fileExists;
      testIde.fileExists = vi.fn(async (fileUri: string) =>
        fileUri.includes(".env") ? true : originalIdeFileExists(fileUri),
      );

      const randomValueForIncontrolDirDotEnv =
        "continue-dir-" + Math.floor(Math.random() * 100);
      const randomValueForWorkspaceDotEnv =
        "dotenv-" + Math.floor(Math.random() * 100);

      const originalIdeReadFile = testIde.readFile;
      testIde.readFile = vi.fn(async (fileUri: string) => {
        // fileUri should contain .continue/.env and not .env
        if (fileUri.match(/.*(\.incontrol|\.continue)\/\.env.*/gi)?.length) {
          return (
            envKeyValuesString.split("\n")[0] + randomValueForIncontrolDirDotEnv
          );
        }
        // fileUri should contain .env outside the config dirs
        else if (
          fileUri.match(/.*(?<!\.incontrol\/)(?<!\.continue\/)\.env.*/gi)
            ?.length
        ) {
          return (
            envKeyValuesString.split("\n")[0] + randomValueForWorkspaceDotEnv
          );
        }
        return originalIdeReadFile(fileUri);
      });

      const localPlatformClient = new LocalPlatformClient(testIde);
      const resolvedFQSNs = await localPlatformClient.resolveFQSNs([testFQSN]);

      expect(resolvedFQSNs.length).toBe(1);
      expect(
        (resolvedFQSNs[0] as SecretResult & { value: unknown })?.value,
      ).toContain(secretValue);
      // we check that workspace <workspace>.continue/.env does not override the <workspace>/.env secret
      expect(
        (resolvedFQSNs[0] as SecretResult & { value: unknown })?.value,
      ).toContain(randomValueForIncontrolDirDotEnv);
      expect(
        (resolvedFQSNs[0] as SecretResult & { value: unknown })?.value,
      ).not.toContain(randomValueForWorkspaceDotEnv);
    });
  });

  describe("should be able to get secrets from process.env", () => {
    const ogProcessEnv = { ...process.env };

    beforeEach(async () => {
      // Ensure secrets are not found in local .env files
      const utilPaths = await import("../../util/paths");
      utilPaths.getIncontrolDotEnv = vi.fn(() => ({}));

      // Ensure secrets are not found in workspace .env files
      testIde.fileExists = vi.fn(async () => false);
      testIde.readFile = vi.fn(async () => "");

      // Clear any potentially set process.env variables from previous tests in this block
      delete process.env[testFQSN.secretName];
      delete process.env[testFQSN2.secretName];
    });

    afterEach(() => {
      // Restore original process.env
      process.env = { ...ogProcessEnv };
    });

    test("should resolve secret from process.env if not found elsewhere", async () => {
      const processEnvSecretValue = "secret-from-process-env";
      process.env[testFQSN.secretName] = processEnvSecretValue;

      const localPlatformClient = new LocalPlatformClient(testIde);
      const resolvedFQSNs = await localPlatformClient.resolveFQSNs([testFQSN]);

      expect(resolvedFQSNs.length).toBe(1);
      const result = resolvedFQSNs[0];
      expect(result?.found).toBe(true);
      expect((result as SecretResult & { value: unknown })?.value).toBe(
        processEnvSecretValue,
      );
      expect(result?.secretLocation?.secretType).toBe(SecretType.ProcessEnv);
      // Check if the specific ProcessEnvSecretLocation is correctly formed
      expect(result?.secretLocation).toEqual(
        expect.objectContaining({
          secretName: testFQSN.secretName,
          secretType: SecretType.ProcessEnv,
        }),
      );
    });

    test("should return not found if secret is not in process.env or other locations", async () => {
      // Ensure it's not in process.env
      expect(process.env[testFQSN.secretName]).toBeUndefined();

      const localPlatformClient = new LocalPlatformClient(testIde);
      const resolvedFQSNs = await localPlatformClient.resolveFQSNs([testFQSN]);

      expect(resolvedFQSNs.length).toBe(1);
      expect(resolvedFQSNs[0]).toBeUndefined();
    });

    test("should prioritize local ~/.continue/.env file over process.env", async () => {
      const localEnvFileValue = "secret-from-local-dot-continue-env";
      const utilPaths = await import("../../util/paths");
      utilPaths.getIncontrolDotEnv = vi.fn(() => ({
        [testFQSN.secretName]: localEnvFileValue,
      }));

      process.env[testFQSN.secretName] =
        "secret-from-process-env-should-be-ignored";

      const localPlatformClient = new LocalPlatformClient(testIde);
      const resolvedFQSNs = await localPlatformClient.resolveFQSNs([testFQSN]);

      expect(resolvedFQSNs.length).toBe(1);
      const result = resolvedFQSNs[0];
      expect(result?.found).toBe(true);
      expect((result as SecretResult & { value: unknown })?.value).toBe(
        localEnvFileValue,
      );
      expect(result?.secretLocation?.secretType).toBe(SecretType.LocalEnv);
    });

    test("should prioritize workspace .env files over process.env", async () => {
      const workspaceIncontrolEnvValue = "secret-from-workspace-continue-env";
      testIde.fileExists = vi.fn(async (fileUri: string) =>
        // Only mock existence for <workspace>/.continue/.env
        fileUri.includes(".continue/.env"),
      );
      testIde.readFile = vi.fn(async (fileUri: string) => {
        if (fileUri.includes(".continue/.env")) {
          return `${testFQSN.secretName}=${workspaceIncontrolEnvValue}`;
        }
        return "";
      });

      process.env[testFQSN.secretName] =
        "secret-from-process-env-should-be-ignored";

      const localPlatformClient = new LocalPlatformClient(testIde);
      const resolvedFQSNs = await localPlatformClient.resolveFQSNs([testFQSN]);

      expect(resolvedFQSNs.length).toBe(1);
      const result = resolvedFQSNs[0];
      expect(result?.found).toBe(true);
      expect((result as SecretResult & { value: unknown })?.value).toBe(
        workspaceIncontrolEnvValue,
      );
      // This should be LocalEnv because findSecretInEnvFiles returns LocalEnv for workspace files too
      expect(result?.secretLocation?.secretType).toBe(SecretType.LocalEnv);
    });
  });
});
