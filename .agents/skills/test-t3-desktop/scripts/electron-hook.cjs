// Dev-only instrumentation, explicitly loaded via NODE_OPTIONS. Never load in production.
// Delay Electron access: this preload also runs in plain Node, where require("electron") fails.
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (request, ...args) {
  const result = originalLoad.call(this, request, ...args);
  if (request === "electron" && process.versions.electron && result?.app) {
    Module._load = originalLoad;
    install(result);
  }
  return result;
};

function install(electron) {
  const http = require("node:http");
  const fs = require("node:fs/promises");
  const port = 47999;
  const shortcuts = new Map();
  const windows = () => electron.BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  const pick = (which) => {
    if (!which) throw new Error("Supply which=<unique URL substring>; inspect /list first");
    const matches = windows().filter((win) => win.webContents.getURL().includes(which));
    if (matches.length !== 1) throw new Error(`Expected one window, found ${matches.length}`);
    return matches[0];
  };
  const body = async (req) => {
    let value = "";
    for await (const chunk of req) {
      value += chunk;
      if (value.length > 1024 * 1024) throw new Error("Body exceeds 1 MiB");
    }
    return value;
  };

  // Run before application ready listeners register their shortcuts.
  electron.app.prependOnceListener("ready", () => {
    const register = electron.globalShortcut.register.bind(electron.globalShortcut);
    electron.globalShortcut.register = (accelerator, callback) => {
      const registered = register(accelerator, callback);
      if (registered) shortcuts.set(accelerator, callback);
      return registered;
    };
    const unregister = electron.globalShortcut.unregister.bind(electron.globalShortcut);
    electron.globalShortcut.unregister = (accelerator) => {
      shortcuts.delete(accelerator);
      return unregister(accelerator);
    };
    const unregisterAll = electron.globalShortcut.unregisterAll.bind(electron.globalShortcut);
    electron.globalShortcut.unregisterAll = () => {
      shortcuts.clear();
      return unregisterAll();
    };

    const server = http.createServer(async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      // This endpoint executes trusted local test code. Reject browser-originated requests
      // and DNS rebinding; loopback binding alone does not prevent either.
      if (
        req.headers.host !== `127.0.0.1:${port}` ||
        req.headers.origin ||
        req.headers["sec-fetch-mode"]
      ) {
        res.writeHead(403).end(JSON.stringify({ error: "Use a local CLI client" }));
        return;
      }
      try {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        let result;
        switch (`${req.method} ${url.pathname}`) {
          case "GET /list":
            result = windows().map((win) => ({
              id: win.id,
              url: win.webContents.getURL(),
              visible: win.isVisible(),
              bounds: win.getBounds(),
            }));
            break;
          case "POST /toggle": {
            const callback = shortcuts.get(url.searchParams.get("acc"));
            if (!callback)
              throw new Error(`Unknown shortcut; registered: ${[...shortcuts.keys()]}`);
            await callback();
            result = "ok";
            break;
          }
          case "POST /capture": {
            const win = pick(url.searchParams.get("which"));
            const out = url.searchParams.get("out");
            if (!out) throw new Error("Supply out=<absolute PNG path>");
            const image = await win.webContents.capturePage();
            await fs.writeFile(out, image.toPNG());
            result = { out, size: image.getSize() };
            break;
          }
          case "POST /eval":
            result = await pick(url.searchParams.get("which")).webContents.executeJavaScript(
              await body(req),
              true,
            );
            break;
          case "POST /maineval":
            // Function has no CommonJS require; use /capture for filesystem output.
            result = await new Function(
              "electron",
              `return (async () => {${await body(req)}\n})()`,
            )(electron);
            break;
          case "POST /input": {
            const contents = pick(url.searchParams.get("which")).webContents;
            const events = JSON.parse(await body(req));
            if (!Array.isArray(events)) throw new Error("Expected an array of input events");
            for (const event of events) contents.sendInputEvent(event);
            result = "ok";
            break;
          }
          default:
            res.writeHead(404).end(JSON.stringify({ error: "Unknown route or method" }));
            return;
        }
        res.end(JSON.stringify(result ?? null));
      } catch (error) {
        res.writeHead(500).end(JSON.stringify({ error: String(error) }));
      }
    });
    server.on("error", (error) => console.error("[electron-hook]", error));
    server.listen(port, "127.0.0.1", () => console.error(`[electron-hook] 127.0.0.1:${port}`));
    electron.app.once("will-quit", () => server.close());
  });
}
