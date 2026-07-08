export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  description?: string;
  iconPath?: unknown;
  tooltip?: string;
  command?: { command: string; title: string; arguments?: unknown[] };

  constructor(
    public readonly label: string,
    public readonly collapsibleState?: TreeItemCollapsibleState,
  ) {}
}

export class ThemeIcon {
  constructor(
    public readonly id: string,
    public readonly color?: ThemeColor,
  ) {}
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

interface IListener<TEvent> {
  (event: TEvent): void;
}

export class EventEmitter<TEvent> {
  private readonly listeners: Array<IListener<TEvent>> = [];

  event = (listener: IListener<TEvent>) => {
    this.listeners.push(listener);
    return { dispose: (): void => undefined };
  };

  fire(event: TEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export const authentication = {
  getSession: async (): Promise<undefined> => undefined,
  onDidChangeSessions: (): { dispose(): void } => ({ dispose: (): void => undefined }),
};
