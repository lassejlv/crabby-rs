import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { getVersion } from "@tauri-apps/api/app";
import { message } from "@tauri-apps/plugin-dialog";

// Command system interfaces
interface Command {
  id: string;
  title: string;
  description?: string;
  category?: string;
  shortcut?: string;
  icon?: string;
  action: () => void | Promise<void>;
}

interface CommandGroup {
  name: string;
  commands: Command[];
}

interface TabData {
  id: string;
  title: string;
  terminalManager: TerminalManager;
  element: HTMLElement;
}

interface DragState {
  isDragging: boolean;
  draggedTabId: string | null;
  dragStartX: number;
  dragOverTabId: string | null;
}

// Command system classes
class CommandManager {
  private commands: Map<string, Command> = new Map();
  private commandGroups: Map<string, CommandGroup> = new Map();

  registerCommand(command: Command): void {
    this.commands.set(command.id, command);
  }

  unregisterCommand(id: string): void {
    this.commands.delete(id);
  }

  getCommand(id: string): Command | undefined {
    return this.commands.get(id);
  }

  getAllCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  searchCommands(query: string): Command[] {
    const normalizedQuery = query.toLowerCase();
    return this.getAllCommands().filter(
      (command) =>
        command.title.toLowerCase().includes(normalizedQuery) ||
        command.description?.toLowerCase().includes(normalizedQuery) ||
        command.category?.toLowerCase().includes(normalizedQuery),
    );
  }

  executeCommand(id: string): void {
    const command = this.commands.get(id);
    if (command) {
      command.action();
    }
  }

  registerCommandGroup(group: CommandGroup): void {
    this.commandGroups.set(group.name, group);
    group.commands.forEach((command) => this.registerCommand(command));
  }

  getCommandGroups(): CommandGroup[] {
    return Array.from(this.commandGroups.values());
  }
}

class CommandPalette {
  private isVisible: boolean = false;
  private overlay: HTMLElement | null = null;
  private searchInput: HTMLElement | null = null;
  private commandList: HTMLElement | null = null;
  private selectedIndex: number = 0;
  private filteredCommands: Command[] = [];
  private commandManager: CommandManager;

  constructor(commandManager: CommandManager) {
    this.commandManager = commandManager;
    this.createPaletteHTML();
    this.setupEventListeners();
  }

  private createPaletteHTML(): void {
    const overlay = document.createElement("div");
    overlay.id = "command-palette-overlay";
    overlay.innerHTML = `
      <div id="command-palette">
        <div id="command-search-container">
          <div id="command-search-icon">⌘</div>
          <input
            type="text"
            id="command-search-input"
            placeholder="Type a command or search..."
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div id="command-results">
          <div id="command-list"></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.searchInput = overlay.querySelector("#command-search-input");
    this.commandList = overlay.querySelector("#command-list");
  }

  private setupEventListeners(): void {
    // Search input events
    this.searchInput?.addEventListener("input", (e) => {
      const query = (e.target as HTMLInputElement).value;
      this.updateResults(query);
    });

    this.searchInput?.addEventListener("keydown", (e) => {
      this.handleKeydown(e as KeyboardEvent);
    });

    // Overlay click to close
    this.overlay?.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });

    // Global escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isVisible) {
        this.hide();
      }
    });
  }

  private handleKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.selectedIndex = Math.min(
          this.selectedIndex + 1,
          this.filteredCommands.length - 1,
        );
        this.updateSelection();
        break;
      case "ArrowUp":
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.updateSelection();
        break;
      case "Enter":
        e.preventDefault();
        this.executeSelectedCommand();
        break;
      case "Escape":
        e.preventDefault();
        this.hide();
        break;
    }
  }

  private updateResults(query: string): void {
    this.filteredCommands = query.trim()
      ? this.commandManager.searchCommands(query)
      : this.commandManager.getAllCommands();

    this.selectedIndex = 0;
    this.renderResults();
  }

  private renderResults(): void {
    if (!this.commandList) return;

    if (this.filteredCommands.length === 0) {
      this.commandList.innerHTML =
        '<div class="command-item-empty">No commands found</div>';
      return;
    }

    this.commandList.innerHTML = this.filteredCommands
      .map(
        (command, index) => `
        <div class="command-item ${index === this.selectedIndex ? "selected" : ""}" data-index="${index}">
          <div class="command-item-content">
            <div class="command-item-title">
              ${command.icon ? `<span class="command-item-icon">${command.icon}</span>` : ""}
              ${command.title}
            </div>
            ${command.description ? `<div class="command-item-description">${command.description}</div>` : ""}
            ${command.shortcut ? `<div class="command-item-shortcut">${command.shortcut}</div>` : ""}
          </div>
          ${command.category ? `<div class="command-item-category">${command.category}</div>` : ""}
        </div>
      `,
      )
      .join("");

    // Add click handlers
    this.commandList
      .querySelectorAll(".command-item")
      .forEach((item, index) => {
        item.addEventListener("click", () => {
          this.selectedIndex = index;
          this.executeSelectedCommand();
        });
      });
  }

  private updateSelection(): void {
    const items = this.commandList?.querySelectorAll(".command-item");
    items?.forEach((item, index) => {
      item.classList.toggle("selected", index === this.selectedIndex);
    });

    // Scroll selected item into view
    const selectedItem = items?.[this.selectedIndex] as HTMLElement;
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest" });
    }
  }

  private executeSelectedCommand(): void {
    const command = this.filteredCommands[this.selectedIndex];
    if (command) {
      this.hide();
      this.commandManager.executeCommand(command.id);
    }
  }

  show(): void {
    if (this.isVisible) return;

    this.isVisible = true;
    this.overlay?.classList.add("visible");
    this.updateResults("");

    // Focus search input
    setTimeout(() => {
      (this.searchInput as HTMLInputElement)?.focus();
    }, 100);
  }

  hide(): void {
    if (!this.isVisible) return;

    this.isVisible = false;
    this.overlay?.classList.remove("visible");

    // Clear search
    if (this.searchInput) {
      (this.searchInput as HTMLInputElement).value = "";
    }

    // Return focus to terminal
    const activeTab = tabManager?.getActiveTab();
    if (activeTab?.terminalManager) {
      activeTab.terminalManager.focus();
    }
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
}

class TerminalManager {
  private terminal: Terminal;
  private fitAddon: FitAddon;
  private sessionId: string | null = null;
  private terminalElement: HTMLElement | null = null;
  private currentFontSize: number = 14;
  private readonly minFontSize: number = 8;
  private readonly maxFontSize: number = 32;
  private readonly fontSizeStep: number = 2;
  private tabId: string;

  constructor(tabId: string) {
    this.tabId = tabId;
    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: this.currentFontSize,
      fontFamily:
        '"Cascadia Code", "Fira Code", "JetBrains Mono", "SF Mono", Monaco, Consolas, "Ubuntu Mono", monospace',
      theme: {
        background: "#1a1b26",
        foreground: "#c0caf5",
        cursor: "#c0caf5",
        selectionBackground: "#33467c",
        black: "#15161e",
        red: "#f7768e",
        green: "#9ece6a",
        yellow: "#e0af68",
        blue: "#7aa2f7",
        magenta: "#bb9af7",
        cyan: "#7dcfff",
        white: "#a9b1d6",
        brightBlack: "#414868",
        brightRed: "#f7768e",
        brightGreen: "#9ece6a",
        brightYellow: "#e0af68",
        brightBlue: "#7aa2f7",
        brightMagenta: "#bb9af7",
        brightCyan: "#7dcfff",
        brightWhite: "#c0caf5",
      },
      allowProposedApi: true,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    this.setupEventListeners();
  }

  private setupEventListeners() {
    this.terminal.onData(async (data: string) => {
      if (this.sessionId) {
        try {
          await invoke("write_to_terminal", {
            sessionId: this.sessionId,
            data: data,
          });
        } catch (error) {
          console.error("Failed to write to terminal:", error);
        }
      }
    });

    this.terminal.onResize(async ({ cols, rows }) => {
      if (this.sessionId) {
        try {
          await invoke("resize_terminal", {
            sessionId: this.sessionId,
            cols: cols,
            rows: rows,
          });
        } catch (error) {
          console.error("Failed to resize terminal:", error);
        }
      }
    });

    listen("terminal-output", (event: any) => {
      if (event.payload.session_id === this.sessionId) {
        this.terminal.write(event.payload.data);
      }
    });

    window.addEventListener("resize", () => {
      this.fitTerminal();
    });
  }

  async attachTo(container: HTMLElement): Promise<void> {
    try {
      this.terminalElement = container;
      this.terminal.open(container);
      this.fitTerminal();

      const sessionId = await invoke("create_terminal_session", {});
      this.sessionId = sessionId as string;

      this.terminal.focus();
    } catch (error) {
      console.error("Failed to attach terminal:", error);
    }
  }

  fitTerminal(): void {
    if (this.terminalElement) {
      try {
        this.fitAddon.fit();
      } catch (error) {
        console.error("Failed to fit terminal:", error);
      }
    }
  }

  focus(): void {
    this.terminal.focus();
  }

  increaseFontSize(): void {
    if (this.currentFontSize < this.maxFontSize) {
      this.currentFontSize += this.fontSizeStep;
      this.updateFontSize();
    }
  }

  decreaseFontSize(): void {
    if (this.currentFontSize > this.minFontSize) {
      this.currentFontSize -= this.fontSizeStep;
      this.updateFontSize();
    }
  }

  resetFontSize(): void {
    this.currentFontSize = 14;
    this.updateFontSize();
  }

  private updateFontSize(): void {
    this.terminal.options.fontSize = this.currentFontSize;
    this.fitTerminal();
  }

  async dispose(): Promise<void> {
    if (this.sessionId) {
      try {
        await invoke("close_terminal_session", {
          sessionId: this.sessionId,
        });
      } catch (error) {
        console.error("Failed to close terminal session:", error);
      }
    }
    this.terminal.dispose();
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getTabId(): string {
    return this.tabId;
  }
}

class TabManager {
  private tabs: Map<string, TabData> = new Map();
  private activeTabId: string | null = null;
  private tabCounter: number = 1;
  private tabOrder: string[] = [];
  private dragState: DragState = {
    isDragging: false,
    draggedTabId: null,
    dragStartX: 0,
    dragOverTabId: null,
  };

  constructor() {
    this.createNewTab();
  }

  async createNewTab(title?: string): Promise<string> {
    const id = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const defaultTitle = title || `Terminal ${this.tabCounter++}`;

    const terminalManager = new TerminalManager(id);

    const tabElement = document.createElement("div");
    tabElement.className = "tab";
    tabElement.setAttribute("draggable", "true");

    const tab: TabData = {
      id,
      title: defaultTitle,
      terminalManager,
      element: tabElement,
    };

    this.tabs.set(id, tab);
    this.tabOrder.push(id);

    await this.setActiveTab(id);
    this.updateTabsUI();

    return id;
  }

  async setActiveTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;

    // Hide current active tab content
    if (this.activeTabId) {
      const currentTab = this.tabs.get(this.activeTabId);
      if (currentTab) {
        const terminalContainer = document.getElementById("terminal-container");
        if (terminalContainer) {
          terminalContainer.innerHTML = "";
        }
      }
    }

    this.activeTabId = id;

    // Show new active tab content
    const terminalContainer = document.getElementById("terminal-container");
    if (terminalContainer) {
      const terminalElement = document.createElement("div");
      terminalElement.className = "terminal-content";
      terminalContainer.appendChild(terminalElement);

      await tab.terminalManager.attachTo(terminalElement);
    }

    this.updateTabsUI();
  }

  closeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab || this.tabs.size <= 1) return;

    tab.terminalManager.dispose();
    this.tabs.delete(id);

    const index = this.tabOrder.indexOf(id);
    if (index > -1) {
      this.tabOrder.splice(index, 1);
    }

    if (this.activeTabId === id) {
      if (this.tabOrder.length > 0) {
        this.setActiveTab(this.tabOrder[0]);
      }
    }

    this.updateTabsUI();
  }

  getActiveTab(): TabData | null {
    if (this.activeTabId) {
      return this.tabs.get(this.activeTabId) || null;
    }
    return null;
  }

  renameTab(id: string, newTitle: string): void {
    const tab = this.tabs.get(id);
    if (tab) {
      tab.title = newTitle;
      this.updateTabsUI();
    }
  }

  private startRenaming(tabId: string, titleElement: HTMLElement): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const input = document.createElement("input");
    input.type = "text";
    input.value = tab.title;
    input.className = "tab-title-input";

    const finishRename = () => {
      const newTitle = input.value.trim() || tab.title;
      this.renameTab(tabId, newTitle);
      titleElement.textContent = newTitle;
      titleElement.style.display = "";
      input.remove();
    };

    input.addEventListener("blur", finishRename);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finishRename();
      } else if (e.key === "Escape") {
        e.preventDefault();
        titleElement.style.display = "";
        input.remove();
      }
    });

    titleElement.style.display = "none";
    titleElement.parentNode?.insertBefore(input, titleElement.nextSibling);
    input.focus();
    input.select();
  }

  private updateTabsUI(): void {
    this.renderTabs();
    this.updateTabsHeaderVisibility();
  }

  private renderTabs(): void {
    const tabsContainer = document.getElementById("tabs-container");
    if (!tabsContainer) return;

    tabsContainer.innerHTML = "";

    this.tabOrder.forEach((tabId) => {
      const tab = this.tabs.get(tabId);
      if (!tab) return;

      const tabElement = document.createElement("div");
      tabElement.className = `tab ${
        this.activeTabId === tabId ? "active" : ""
      }`;
      tabElement.setAttribute("draggable", "true");
      tabElement.innerHTML = `
        <span class="tab-title" title="${tab.title}">${tab.title}</span>
        <button class="tab-close" title="Close Tab">×</button>
      `;

      tabElement.addEventListener("click", (e) => {
        if (
          !(e.target as HTMLElement).classList.contains("tab-close") &&
          !(e.target as HTMLElement).classList.contains("tab-title-input")
        ) {
          this.setActiveTab(tab.id);
        }
      });

      const titleSpan = tabElement.querySelector(".tab-title");
      if (titleSpan) {
        titleSpan.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          this.startRenaming(tab.id, titleSpan as HTMLElement);
        });
      }

      const closeBtn = tabElement.querySelector(".tab-close");
      if (closeBtn) {
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.closeTab(tab.id);
        });
      }

      tabElement.addEventListener("dragstart", (e) => {
        this.dragState.isDragging = true;
        this.dragState.draggedTabId = tab.id;
        this.dragState.dragStartX = e.clientX;
        tabElement.classList.add("dragging");
      });

      tabElement.addEventListener("dragend", () => {
        this.dragState.isDragging = false;
        this.dragState.draggedTabId = null;
        this.dragState.dragOverTabId = null;
        tabElement.classList.remove("dragging");
        this.clearDragStyles();
      });

      tabElement.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (
          this.dragState.isDragging &&
          this.dragState.draggedTabId !== tab.id
        ) {
          this.dragState.dragOverTabId = tab.id;
          tabElement.classList.add("drag-over");
        }
      });

      tabElement.addEventListener("dragleave", () => {
        tabElement.classList.remove("drag-over");
      });

      tabElement.addEventListener("drop", (e) => {
        e.preventDefault();
        if (
          this.dragState.draggedTabId &&
          this.dragState.draggedTabId !== tab.id
        ) {
          this.reorderTabs(this.dragState.draggedTabId, tab.id);
        }
        this.clearDragStyles();
      });

      tabsContainer.appendChild(tabElement);
    });
  }

  private clearDragStyles(): void {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.remove("dragging", "drag-over");
    });
  }

  private reorderTabs(draggedTabId: string, targetTabId: string): void {
    const draggedIndex = this.tabOrder.indexOf(draggedTabId);
    const targetIndex = this.tabOrder.indexOf(targetTabId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    this.tabOrder.splice(draggedIndex, 1);
    this.tabOrder.splice(targetIndex, 0, draggedTabId);

    this.renderTabs();
  }

  private updateTabsHeaderVisibility(): void {
    const tabsHeader = document.getElementById("tabs-header");
    if (tabsHeader) {
      tabsHeader.style.display = this.tabs.size > 1 ? "flex" : "none";
    }
  }
}

// Global variables
let tabManager: TabManager;
let commandManager: CommandManager;
let commandPalette: CommandPalette;

function createUI() {
  document.body.innerHTML = `
    <div id="app">
      <div id="tabs-header" style="display: none;">
        <div id="tabs-container"></div>
        <button id="new-tab-btn" title="New Tab (Ctrl+T)">+</button>
      </div>
      <div id="terminal-container"></div>
    </div>
  `;
}

function setupDefaultCommands(
  commandManager: CommandManager,
  tabManager: TabManager,
) {
  // Tab management commands
  commandManager.registerCommand({
    id: "tab.new",
    title: "New Tab",
    description: "Create a new terminal tab",
    category: "Tabs",
    shortcut: "Ctrl+T",
    icon: "➕",
    action: async () => {
      await tabManager.createNewTab();
    },
  });

  commandManager.registerCommand({
    id: "tab.close",
    title: "Close Tab",
    description: "Close the current tab",
    category: "Tabs",
    shortcut: "Ctrl+W",
    icon: "✕",
    action: () => {
      const activeTab = tabManager.getActiveTab();
      if (activeTab) {
        tabManager.closeTab(activeTab.id);
      }
    },
  });

  // Terminal commands
  commandManager.registerCommand({
    id: "terminal.font-increase",
    title: "Increase Font Size",
    description: "Make terminal text larger",
    category: "Terminal",
    shortcut: "Ctrl+Plus",
    icon: "🔍",
    action: () => {
      const activeTab = tabManager.getActiveTab();
      if (activeTab?.terminalManager) {
        activeTab.terminalManager.increaseFontSize();
      }
    },
  });

  commandManager.registerCommand({
    id: "terminal.font-decrease",
    title: "Decrease Font Size",
    description: "Make terminal text smaller",
    category: "Terminal",
    shortcut: "Ctrl+Minus",
    icon: "🔍",
    action: () => {
      const activeTab = tabManager.getActiveTab();
      if (activeTab?.terminalManager) {
        activeTab.terminalManager.decreaseFontSize();
      }
    },
  });

  commandManager.registerCommand({
    id: "terminal.font-reset",
    title: "Reset Font Size",
    description: "Reset terminal font to default size",
    category: "Terminal",
    shortcut: "Ctrl+0",
    icon: "↺",
    action: () => {
      const activeTab = tabManager.getActiveTab();
      if (activeTab?.terminalManager) {
        activeTab.terminalManager.resetFontSize();
      }
    },
  });

  // Application commands
  commandManager.registerCommand({
    id: "app.reload",
    title: "Reload Application",
    description: "Reload the terminal application",
    category: "Application",
    shortcut: "Ctrl+R",
    icon: "↻",
    action: () => window.location.reload(),
  });

  commandManager.registerCommand({
    id: "app.about",
    title: "About Crabby",
    description: "Show information about this terminal",
    category: "Application",
    icon: "ℹ️",
    action: async () => {
      const appVersion = await getVersion();

      const messageTXT = `Crabby Terminal\nVersion: ${appVersion}\n\nThis terminal is built with Tauri and Rust.\n\nFor more information, visit the GitHub repository.`;

      await message(messageTXT, {
        title: "About",
        kind: "info",
      });
    },
  });
}

function setupEventHandlers() {
  const newTabBtn = document.getElementById("new-tab-btn");

  if (newTabBtn) {
    newTabBtn.addEventListener("click", () => {
      tabManager.createNewTab();
    });
  }

  // Command palette shortcut
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "p") {
      e.preventDefault();
      commandPalette.toggle();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case "t":
          e.preventDefault();
          tabManager.createNewTab();
          break;
        case "w":
          e.preventDefault();
          const activeTab = tabManager.getActiveTab();
          if (activeTab) {
            tabManager.closeTab(activeTab.id);
          }
          break;
        case "=":
        case "+":
          e.preventDefault();
          const activeTabIncrease = tabManager.getActiveTab();
          if (activeTabIncrease?.terminalManager) {
            activeTabIncrease.terminalManager.increaseFontSize();
          }
          break;
        case "-":
          e.preventDefault();
          const activeTabDecrease = tabManager.getActiveTab();
          if (activeTabDecrease?.terminalManager) {
            activeTabDecrease.terminalManager.decreaseFontSize();
          }
          break;
        case "0":
          e.preventDefault();
          const activeTabReset = tabManager.getActiveTab();
          if (activeTabReset?.terminalManager) {
            activeTabReset.terminalManager.resetFontSize();
          }
          break;
        case "r":
          if (!e.shiftKey) {
            e.preventDefault();
            window.location.reload();
          }
          break;
      }
    }

    // Tab switching with Ctrl+number
    if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      const tabIndex = parseInt(e.key) - 1;
      const tabId = tabManager["tabOrder"][tabIndex];
      if (tabId) {
        tabManager.setActiveTab(tabId);
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  createUI();

  // Initialize command system
  commandManager = new CommandManager();
  commandPalette = new CommandPalette(commandManager);

  // Initialize tab manager
  tabManager = new TabManager();

  // Setup default commands
  setupDefaultCommands(commandManager, tabManager);

  setupEventHandlers();
});
