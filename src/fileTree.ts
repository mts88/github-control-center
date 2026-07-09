import type { IPrFile } from "./types";

export interface IFileTreeFolder {
  /** display name; compacted chains are joined with "/" (e.g. "src/utils") */
  name: string;
  /** full uncompacted path prefix — the stable-id source, never derived from name */
  path: string;
  folders: IFileTreeFolder[];
  files: IPrFile[];
}

export function buildFileTree(files: IPrFile[]): IFileTreeFolder {
  const root: IFileTreeFolder = { name: "", path: "", folders: [], files: [] };
  for (const file of files) {
    const segments = file.path.split("/");
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      let child = node.folders.find((folder) => folder.name === segment);
      if (!child) {
        child = { name: segment, path: node.path ? `${node.path}/${segment}` : segment, folders: [], files: [] };
        node.folders.push(child);
      }
      node = child;
    }
    node.files.push(file);
  }
  compactFolders(root);
  sortFolder(root);
  return root;
}

/** VSCode-explorer style: a folder with exactly one child folder and no files merges into it. */
function compactFolders(folder: IFileTreeFolder): void {
  for (let folderIndex = 0; folderIndex < folder.folders.length; folderIndex++) {
    let child = folder.folders[folderIndex];
    while (child.folders.length === 1 && child.files.length === 0) {
      const onlyChild = child.folders[0];
      child = { name: `${child.name}/${onlyChild.name}`, path: onlyChild.path, folders: onlyChild.folders, files: onlyChild.files };
      folder.folders[folderIndex] = child;
    }
    compactFolders(child);
  }
}

function sortFolder(folder: IFileTreeFolder): void {
  folder.folders.sort((firstFolder, secondFolder) => firstFolder.name.localeCompare(secondFolder.name));
  folder.files.sort((firstFile, secondFile) => basename(firstFile.path).localeCompare(basename(secondFile.path)));
  for (const child of folder.folders) {
    sortFolder(child);
  }
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
