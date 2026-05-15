import { Plugin, TAbstractFile, TFile, TFolder, View, WorkspaceLeaf } from "obsidian";

type SortOrder =
  | "alphabetical"
  | "alphabeticalReverse"
  | "byModifiedTime"
  | "byModifiedTimeReverse"
  | "byCreatedTime"
  | "byCreatedTimeReverse";

interface FileTreeItem {
  file: TAbstractFile;
  children?: FileTreeItem[];
  vChildren?: { setChildren?: (items: FileTreeItem[]) => void; _children?: FileTreeItem[] };
  sort?: (...args: unknown[]) => unknown;
}

interface FileExplorerView extends View {
  sortOrder: SortOrder;
  fileItems: Record<string, FileTreeItem>;
  requestSort?: () => void;
  sort?: () => void;
}

const LOG = "[interleaved-sort]";

function sortKey(file: TAbstractFile): string {
  return (file instanceof TFile ? file.basename : file.name).toLowerCase();
}

function getMtime(item: FileTreeItem): number {
  const f = item.file;
  return f instanceof TFile ? f.stat.mtime : 0;
}

function getCtime(item: FileTreeItem): number {
  const f = item.file;
  return f instanceof TFile ? f.stat.ctime : 0;
}

function compareItems(order: SortOrder, a: FileTreeItem, b: FileTreeItem): number {
  switch (order) {
    case "alphabetical":
      return sortKey(a.file).localeCompare(sortKey(b.file), undefined, { numeric: true });
    case "alphabeticalReverse":
      return sortKey(b.file).localeCompare(sortKey(a.file), undefined, { numeric: true });
    case "byModifiedTime":
      return getMtime(b) - getMtime(a);
    case "byModifiedTimeReverse":
      return getMtime(a) - getMtime(b);
    case "byCreatedTime":
      return getCtime(b) - getCtime(a);
    case "byCreatedTimeReverse":
      return getCtime(a) - getCtime(b);
    default:
      return sortKey(a.file).localeCompare(sortKey(b.file), undefined, { numeric: true });
  }
}

export default class InterleavedSortPlugin extends Plugin {
  private restorers: Array<() => void> = [];

  async onload() {
    this.app.workspace.onLayoutReady(() => this.tryPatch());
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        if (this.restorers.length === 0) this.tryPatch();
      })
    );
  }

  onunload() {
    while (this.restorers.length > 0) {
      try {
        this.restorers.pop()!();
      } catch (err) {
        console.error(LOG, "restore failed", err);
      }
    }
    this.requestExplorerResort();
  }

  private getExplorerLeaf(): WorkspaceLeaf | null {
    return this.app.workspace.getLeavesOfType("file-explorer")[0] ?? null;
  }

  private getExplorerView(): FileExplorerView | null {
    const leaf = this.getExplorerLeaf();
    return (leaf?.view as unknown as FileExplorerView) ?? null;
  }

  private requestExplorerResort() {
    const view = this.getExplorerView();
    if (!view) return;
    if (typeof view.requestSort === "function") view.requestSort();
    else if (typeof view.sort === "function") view.sort();
  }

  private tryPatch() {
    if (this.restorers.length > 0) return;
    const view = this.getExplorerView();
    if (!view) {
      console.warn(LOG, "no file-explorer view present yet");
      return;
    }

    const rootItem = view.fileItems?.["/"];
    if (!rootItem) {
      console.warn(LOG, "fileItems['/'] not found", Object.keys(view.fileItems ?? {}));
      return;
    }

    const folderProto = Object.getPrototypeOf(rootItem) as FileTreeItem;
    const originalSort = folderProto.sort;
    if (typeof originalSort !== "function") {
      console.warn(LOG, "folder prototype has no sort()", Object.getOwnPropertyNames(folderProto));
      return;
    }

    folderProto.sort = function patchedSort(this: FileTreeItem) {
      const order = view.sortOrder ?? "alphabetical";

      const rawChildren = (this as unknown as { children?: FileTreeItem[] }).children;
      if (!Array.isArray(rawChildren) || !this.vChildren) {
        return (originalSort as (...a: unknown[]) => unknown).apply(this, arguments as unknown as unknown[]);
      }

      const merged = rawChildren.slice().sort((a, b) => compareItems(order, a, b));

      if (typeof this.vChildren.setChildren === "function") {
        this.vChildren.setChildren(merged);
      } else {
        this.vChildren._children = merged;
      }
    };

    this.restorers.push(() => {
      folderProto.sort = originalSort;
    });

    this.requestExplorerResort();
    console.info(LOG, "patched FolderTreeItem.sort; sortOrder=", view.sortOrder);
  }
}
