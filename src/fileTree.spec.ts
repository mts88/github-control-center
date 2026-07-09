import { describe, expect, it } from "vitest";
import { buildFileTree } from "./fileTree";
import type { IPrFile } from "./types";

function buildFile(path: string): IPrFile {
  return { path, changeType: "MODIFIED", additions: 1, deletions: 0, viewedState: "UNVIEWED" };
}

describe("buildFileTree", () => {
  it("should nest files under their directories", () => {
    const root = buildFileTree([buildFile("src/app.ts"), buildFile("src/api/client.ts")]);

    expect(root.folders).toHaveLength(1);
    expect(root.folders[0].name).toBe("src");
    expect(root.folders[0].files.map((file) => file.path)).toEqual(["src/app.ts"]);
    expect(root.folders[0].folders[0].name).toBe("api");
    expect(root.folders[0].folders[0].files.map((file) => file.path)).toEqual(["src/api/client.ts"]);
  });

  it("should keep root files at the root", () => {
    const root = buildFileTree([buildFile("README.md"), buildFile("src/app.ts")]);

    expect(root.files.map((file) => file.path)).toEqual(["README.md"]);
    expect(root.folders.map((folder) => folder.name)).toEqual(["src"]);
  });

  it("should sort folders before files, each alphabetically", () => {
    const root = buildFileTree([buildFile("zeta.ts"), buildFile("alpha.ts"), buildFile("lib/z.ts"), buildFile("core/a.ts")]);

    expect(root.folders.map((folder) => folder.name)).toEqual(["core", "lib"]);
    expect(root.files.map((file) => file.path)).toEqual(["alpha.ts", "zeta.ts"]);
  });

  it("should sort files by basename within a folder", () => {
    const root = buildFileTree([buildFile("src/zeta.ts"), buildFile("src/alpha.ts")]);

    expect(root.folders[0].files.map((file) => file.path)).toEqual(["src/alpha.ts", "src/zeta.ts"]);
  });

  it("should compact single-child folder chains into one node with the joined name", () => {
    const root = buildFileTree([buildFile("src/utils/helpers/format.ts")]);

    expect(root.folders).toHaveLength(1);
    expect(root.folders[0].name).toBe("src/utils/helpers");
    expect(root.folders[0].files.map((file) => file.path)).toEqual(["src/utils/helpers/format.ts"]);
  });

  it("should not compact a folder that directly contains files", () => {
    const root = buildFileTree([buildFile("src/index.ts"), buildFile("src/utils/format.ts")]);

    const src = root.folders[0];
    expect(src.name).toBe("src");
    expect(src.files.map((file) => file.path)).toEqual(["src/index.ts"]);
    expect(src.folders[0].name).toBe("utils");
  });

  it("should not compact a folder with multiple child folders", () => {
    const root = buildFileTree([buildFile("src/api/client.ts"), buildFile("src/ui/view.ts")]);

    const src = root.folders[0];
    expect(src.name).toBe("src");
    expect(src.folders.map((folder) => folder.name)).toEqual(["api", "ui"]);
  });

  it("should keep the full uncompacted path on compacted nodes", () => {
    const root = buildFileTree([buildFile("src/utils/helpers/format.ts")]);

    expect(root.folders[0].path).toBe("src/utils/helpers");
  });

  it("should return an empty root for no files", () => {
    expect(buildFileTree([])).toEqual({ name: "", path: "", folders: [], files: [] });
  });
});
