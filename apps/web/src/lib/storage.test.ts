import { afterEach, describe, expect, it } from "vite-plus/test";

import { browserLocalStorage } from "./storage";

describe("browserLocalStorage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("returns null when reading localStorage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("sandboxed", "SecurityError");
      },
    });

    expect(browserLocalStorage()).toBeNull();
  });
});
