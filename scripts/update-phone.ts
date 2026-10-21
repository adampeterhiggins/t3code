// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone native build bootstrap uses Node subprocesses and terminal output.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { loadRepoEnv } from "./lib/public-config.ts";

const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const mobile = NodePath.join(root, "apps/mobile");
const config = loadRepoEnv();

function required(name: string) {
  const value = config[name]?.trim();
  if (!value) throw new Error(`Set ${name} in the repository's gitignored .env.local first.`);
  return value;
}

function main() {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone build bootstrap has no Effect runtime.
  if (NodeOS.platform() !== "darwin") throw new Error("make phone requires macOS and Xcode.");
  const team = required("T3CODE_IOS_TEAM_ID");
  const device = required("T3CODE_IOS_DEVICE_ID");
  const bundle = required("T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID");
  if (!/^[A-Z0-9]{10}$/.test(team))
    throw new Error("T3CODE_IOS_TEAM_ID must be a 10-character Team ID.");
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundle)) {
    throw new Error("T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID must be a reverse-DNS bundle identifier.");
  }
  if (!config.T3CODE_RELAY_URL?.trim() || !config.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()) {
    throw new Error("T3 Connect configuration is missing. Copy .env.example to .env first.");
  }

  const env = {
    ...process.env,
    ...config,
    APP_VARIANT: "production",
    T3CODE_IOS_PERSONAL_TEAM: "1",
    T3CODE_MOBILE_UPDATES_ENABLED: "0",
    EXPO_NO_GIT_STATUS: "1",
  };
  function run(command: string, args: string[], cwd = root) {
    NodeChildProcess.execFileSync(command, args, { cwd, env, stdio: "inherit" });
  }

  // Fail before regenerating native files if Xcode cannot see the phone.
  run("xcrun", ["devicectl", "device", "info", "details", "--device", device]);
  run(
    NodePath.join(mobile, "node_modules/.bin/expo"),
    ["prebuild", "--clean", "--platform", "ios", "--no-install"],
    mobile,
  );
  run("pod", ["install"], NodePath.join(mobile, "ios"));

  const derived = NodePath.join(root, ".t3/mobile-release");
  NodeFS.mkdirSync(derived, { recursive: true });
  run(
    "xcodebuild",
    [
      "-workspace",
      "T3Code.xcworkspace",
      "-scheme",
      "T3Code",
      "-configuration",
      "Release",
      "-destination",
      `id=${device}`,
      "-derivedDataPath",
      derived,
      "-allowProvisioningUpdates",
      "-allowProvisioningDeviceRegistration",
      `DEVELOPMENT_TEAM=${team}`,
      "CODE_SIGN_STYLE=Automatic",
      "build",
    ],
    NodePath.join(mobile, "ios"),
  );
  run("xcrun", [
    "devicectl",
    "device",
    "install",
    "app",
    "--device",
    device,
    NodePath.join(derived, "Build/Products/Release-iphoneos/T3Code.app"),
  ]);
  console.log(`Installed ${bundle}. Open T3 Code on your phone.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
