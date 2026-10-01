import { describe, expect, it } from "vite-plus/test";

import {
  parseRepositoryInput,
  pastedContextRepositoryEntry,
  repositoryContextRecord,
  splitContextRepositoryOwnerQuery,
} from "./contextRepositories.ts";

describe("parseRepositoryInput", () => {
  it("reads owner/repo shorthand without guessing a remote", () => {
    expect(parseRepositoryInput("acme/api")).toEqual({
      nameWithOwner: "acme/api",
      remoteUrl: null,
    });
  });

  it("reads GitHub browser and clone URLs as the repository", () => {
    for (const input of [
      "https://github.com/acme/api",
      "https://github.com/acme/api.git",
      "https://github.com/acme/api/tree/main/src",
    ]) {
      expect(parseRepositoryInput(input)).toEqual({
        nameWithOwner: "acme/api",
        remoteUrl: "https://github.com/acme/api",
      });
    }
  });

  it("keeps other hosts' URLs, minus credentials", () => {
    expect(parseRepositoryInput("https://me:tok@gitlab.com/group/sub/api.git")).toEqual({
      nameWithOwner: "group/sub/api",
      remoteUrl: "https://gitlab.com/group/sub/api.git",
    });
    expect(parseRepositoryInput("git@github.com:acme/api.git")).toEqual({
      nameWithOwner: "acme/api",
      remoteUrl: "git@github.com:acme/api.git",
    });
  });

  it("ignores text that is not a repository", () => {
    expect(parseRepositoryInput("api")).toBeNull();
    expect(parseRepositoryInput("fix the api")).toBeNull();
  });
});

describe("repositoryContextRecord", () => {
  it("clones into a folder named after the repository", () => {
    const record = repositoryContextRecord({
      nameWithOwner: "Acme/Platform.API",
      remoteUrl: "https://github.com/Acme/Platform.API",
    });
    expect(record.directoryName).toBe("Platform.API");
    expect(record.contextId).toBe("repository_acme-platform-api");
    expect(record.label).toBe("Acme/Platform.API");
  });
});

describe("splitContextRepositoryOwnerQuery", () => {
  it("searches another owner after a slash, and the default owner otherwise", () => {
    expect(splitContextRepositoryOwnerQuery("acme/Api", "me")).toEqual({
      owner: "acme",
      filter: "api",
    });
    expect(splitContextRepositoryOwnerQuery("Web", "me")).toEqual({ owner: "me", filter: "web" });
  });
});

describe("pastedContextRepositoryEntry", () => {
  it("offers an owner/repo the list does not contain, on GitHub", () => {
    expect(pastedContextRepositoryEntry("acme/api", [])).toEqual({
      nameWithOwner: "acme/api",
      remoteUrl: "https://github.com/acme/api",
    });
  });

  it("leaves an owner/repo that is already listed to its row", () => {
    expect(pastedContextRepositoryEntry("acme/api", [{ nameWithOwner: "Acme/API" }])).toBeNull();
  });

  it("always offers a pasted clone URL", () => {
    expect(
      pastedContextRepositoryEntry("git@gitlab.com:acme/api.git", [{ nameWithOwner: "acme/api" }]),
    ).toEqual({ nameWithOwner: "acme/api", remoteUrl: "git@gitlab.com:acme/api.git" });
  });
});
