import { Notice, Plugin, TAbstractFile, TFile, View, WorkspaceLeaf } from "obsidian";

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
  vChildren?: {
    setChildren?: (items: FileTreeItem[]) => void;
    _children?: FileTreeItem[];
    children?: FileTreeItem[];
  };
  sort?: (...args: unknown[]) => unknown;
}

interface FileExplorerView extends View {
  sortOrder?: SortOrder;
  fileItems?: Record<string, FileTreeItem>;
  requestSort?: () => void;
  sort?: () => void;
}

const LOG = "[tm-file-explorer]";

function sortKey(file: TAbstractFile): string {
  return (file instanceof TFile ? file.basename : file.name).toLowerCase();
}

function mtime(item: FileTreeItem): number {
  const f = item.file;
  return f instanceof TFile ? f.stat.mtime : 0;
}

function ctime(item: FileTreeItem): number {
  const f = item.file;
  return f instanceof TFile ? f.stat.ctime : 0;
}

function compareItems(order: SortOrder, a: FileTreeItem, b: FileTreeItem): number {
  switch (order) {
    case "alphabeticalReverse":
      return sortKey(b.file).localeCompare(sortKey(a.file), undefined, { numeric: true });
    case "byModifiedTime":
      return mtime(b) - mtime(a);
    case "byModifiedTimeReverse":
      return mtime(a) - mtime(b);
    case "byCreatedTime":
      return ctime(b) - ctime(a);
    case "byCreatedTimeReverse":
      return ctime(a) - ctime(b);
    case "alphabetical":
    default:
      return sortKey(a.file).localeCompare(sortKey(b.file), undefined, { numeric: true });
  }
}

export default class TMFileExplorerPlugin extends Plugin {
  private restorers: Array<() => void> = [];
  private patchStatus = "not attempted";

  async onload() {
    this.addCommand({
      id: "diagnose",
      name: "Diagnose File Explorer internals",
      callback: () => this.diagnose(),
    });
    this.addCommand({
      id: "reapply",
      name: "Re-apply sort patch",
      callback: () => {
        this.unpatch();
        this.tryPatch();
        new Notice(`${LOG} ${this.patchStatus}`);
      },
    });

    this.app.workspace.onLayoutReady(() => this.tryPatch());
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        if (this.restorers.length === 0) this.tryPatch();
      })
    );
  }

  onunload() {
    this.unpatch();
    this.requestResort();
  }

  private getView(): FileExplorerView | null {
    const leaf: WorkspaceLeaf | undefined = this.app.workspace.getLeavesOfType("file-explorer")[0];
    return (leaf?.view as unknown as FileExplorerView) ?? null;
  }

  private requestResort() {
    const view = this.getView();
    if (!view) return;
    if (typeof view.requestSort === "function") view.requestSort();
    else if (typeof view.sort === "function") view.sort();
  }

  private unpatch() {
    while (this.restorers.length > 0) {
      try {
        this.restorers.pop()!();
      } catch (err) {
        console.error(LOG, "restore failed", err);
      }
    }
    this.patchStatus = "unpatched";
  }

  private tryPatch() {
    if (this.restorers.length > 0) return;
    const view = this.getView();
    if (!view) {
      this.patchStatus = "no file-explorer view";
      console.warn(LOG, this.patchStatus);
      return;
    }

    // Strategy 1: patch FolderTreeItem.prototype.sort
    const rootItem = view.fileItems?.["/"];
    if (rootItem) {
      const proto = Object.getPrototypeOf(rootItem) as FileTreeItem;
      if (typeof proto.sort === "function") {
        this.patchFolderSort(proto, view);
        return;
      }
    }

    // Strategy 2: patch FileExplorerView.prototype methods commonly used to produce sorted children
    const viewProto = Object.getPrototypeOf(view) as Record<string, unknown>;
    const candidateNames = ["getSortedFolderItems", "getSortedFileItems", "sortItems", "sort"];
    for (const name of candidateNames) {
      if (typeof viewProto[name] === "function") {
        this.patchViewMethod(viewProto, name, view);
        return;
      }
    }

    this.patchStatus = "no sort surface found (run Diagnose command)";
    console.warn(LOG, this.patchStatus, {
      viewKeys: Object.getOwnPropertyNames(viewProto),
      rootKeys: rootItem ? Object.getOwnPropertyNames(Object.getPrototypeOf(rootItem)) : null,
    });
  }

  private patchFolderSort(proto: FileTreeItem, view: FileExplorerView) {
    const original = proto.sort!;
    const childrenProp = this.detectChildrenProp(view.fileItems);
    proto.sort = function patchedSort(this: FileTreeItem) {
      const order = view.sortOrder ?? "alphabetical";
      const rawAny = this as unknown as Record<string, unknown>;
      const raw = (childrenProp ? rawAny[childrenProp] : rawAny.children) as FileTreeItem[] | undefined;
      if (!Array.isArray(raw) || !this.vChildren) {
        return (original as (...a: unknown[]) => unknown).apply(this, arguments as unknown as unknown[]);
      }
      const merged = raw.slice().sort((a, b) => compareItems(order, a, b));
      if (typeof this.vChildren.setChildren === "function") {
        this.vChildren.setChildren(merged);
      } else if (this.vChildren._children) {
        this.vChildren._children = merged;
      } else {
        this.vChildren.children = merged;
      }
    };
    this.restorers.push(() => {
      proto.sort = original;
    });
    this.patchStatus = `patched FolderTreeItem.sort (children prop: ${childrenProp ?? "children"})`;
    console.info(LOG, this.patchStatus);
    this.requestResort();
  }

  private patchViewMethod(viewProto: Record<string, unknown>, name: string, view: FileExplorerView) {
    const original = viewProto[name] as (...args: unknown[]) => unknown;
    const plugin = this;
    viewProto[name] = function patched(this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (Array.isArray(result) && result.length > 0 && (result[0] as FileTreeItem).file) {
        const order = view.sortOrder ?? "alphabetical";
        return result.slice().sort((a, b) => compareItems(order, a as FileTreeItem, b as FileTreeItem));
      }
      return result;
    } as unknown;
    this.restorers.push(() => {
      viewProto[name] = original;
    });
    this.patchStatus = `patched view.${name}`;
    console.info(LOG, this.patchStatus);
    this.requestResort();
    void plugin;
  }

  private detectChildrenProp(fileItems: Record<string, FileTreeItem> | undefined): string | null {
    if (!fileItems) return null;
    for (const item of Object.values(fileItems)) {
      const anyItem = item as unknown as Record<string, unknown>;
      for (const k of ["children", "tChildren", "_children"]) {
        const v = anyItem[k];
        if (Array.isArray(v) && v.length > 0 && (v[0] as FileTreeItem).file) return k;
      }
    }
    return null;
  }

  private diagnose() {
    const view = this.getView();
    const lines: string[] = [];
    lines.push(`status: ${this.patchStatus}`);
    if (!view) {
      lines.push("no file-explorer view");
    } else {
      const viewProto = Object.getPrototypeOf(view) as object;
      lines.push(`view prototype: ${Object.getOwnPropertyNames(viewProto).join(", ")}`);
      const root = view.fileItems?.["/"];
      if (root) {
        const rootProto = Object.getPrototypeOf(root) as object;
        lines.push(`root item prototype: ${Object.getOwnPropertyNames(rootProto).join(", ")}`);
        lines.push(`root item own keys: ${Object.keys(root).join(", ")}`);
        const childrenProp = this.detectChildrenProp(view.fileItems);
        lines.push(`detected children prop: ${childrenProp ?? "none"}`);
        if (childrenProp) {
          const c = (root as unknown as Record<string, FileTreeItem[]>)[childrenProp];
          lines.push(`root.${childrenProp} length: ${c?.length ?? "n/a"}`);
        }
        lines.push(`vChildren keys: ${root.vChildren ? Object.keys(root.vChildren).join(", ") : "n/a"}`);
      } else {
        lines.push("no root file item");
      }
      lines.push(`sortOrder: ${view.sortOrder}`);
    }
    const out = lines.join("\n");
    console.group(LOG + " diagnose");
    console.log(out);
    console.log("view:", view);
    console.log("root:", view?.fileItems?.["/"]);
    console.groupEnd();
    new Notice(out, 15000);
  }
}
