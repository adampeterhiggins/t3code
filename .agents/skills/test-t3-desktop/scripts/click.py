#!/usr/bin/env python3
"""Send native Electron pointer events at a unique CSS selector's centre."""

import argparse
import json
import urllib.request


def request(route, data):
    req = urllib.request.Request(
        "http://127.0.0.1:47999" + route, data=data.encode(), method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("which", help="Unique BrowserWindow URL substring from /list")
    parser.add_argument("selector", help="Unique CSS selector; tag ambiguous targets first")
    args = parser.parse_args()
    which = json.dumps(args.which)
    selector = json.dumps(args.selector)
    # Keep geometry and zoom in one main-process call, without exposing Node in the page.
    code = f"const which = {which}; const selector = {selector};\n" + """
const matches = electron.BrowserWindow.getAllWindows().filter(
  w => !w.isDestroyed() && w.webContents.getURL().includes(which));
if (matches.length !== 1) throw new Error('Expected exactly one window');
const wc = matches[0].webContents;
const point = await wc.executeJavaScript(`(() => {
  const matches = document.querySelectorAll(${JSON.stringify(selector)});
  if (matches.length !== 1) throw new Error('Expected exactly one element');
  const el = matches[0];
  el.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'});
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) throw new Error('Element has no area');
  return {x: r.x + r.width / 2, y: r.y + r.height / 2};
})()`);
const zoom = wc.getZoomFactor();
const pointEvent = {x: Math.round(point.x * zoom), y: Math.round(point.y * zoom),
  button: 'left', clickCount: 1};
wc.sendInputEvent({type: 'mouseMove', x: pointEvent.x, y: pointEvent.y});
wc.sendInputEvent({type: 'mouseDown', ...pointEvent});
wc.sendInputEvent({type: 'mouseUp', ...pointEvent});
return pointEvent;
"""
    print(json.dumps(request("/maineval", code)))


if __name__ == "__main__":
    main()
