import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

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
    // Handle terminal input
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

    // Handle terminal resize
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

    // Listen for terminal output from backend
    listen("terminal-output", (event: any) => {
      const { session_id, data } = event.payload;
      if (session_id === this.sessionId) {
        this.terminal.write(data);
      }
    });

    // Listen for terminal exit
    listen("terminal-exit", (event: any) => {
      const sessionId = event.payload;
      if (sessionId === this.sessionId) {
        this.terminal.write("\r\n\x1b[31mTerminal session ended\x1b[0m\r\n");
        this.sessionId = null;
      }
    });

    // Handle window resize
    window.addEventListener("resize", () => {
      this.fitTerminal();
    });
  }

  public async initialize(container: HTMLElement) {
    this.terminalElement = container;
    this.terminal.open(container);
    this.fitTerminal();

    try {
      this.sessionId = await invoke("create_terminal_session");
      this.terminal.focus();
    } catch (error) {
      console.error("Failed to create terminal session:", error);
      this.terminal.write(
        "\r\n\x1b[31mFailed to create terminal session\x1b[0m\r\n",
      );
    }
  }

  private fitTerminal() {
    if (this.terminalElement && this.terminal.element) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        this.fitAddon.fit();
      }, 10);
    }
  }

  public async createNewSession() {
    try {
      if (this.sessionId) {
        await invoke("close_terminal_session", { sessionId: this.sessionId });
      }

      this.terminal.clear();
      this.sessionId = await invoke("create_terminal_session");
      this.terminal.focus();
    } catch (error) {
      console.error("Failed to create new terminal session:", error);
      this.terminal.write(
        "\r\n\x1b[31mFailed to create new terminal session\x1b[0m\r\n",
      );
    }
  }

  public async closeSession() {
    if (this.sessionId) {
      try {
        await invoke("close_terminal_session", { sessionId: this.sessionId });
        this.sessionId = null;
        this.terminal.clear();
      } catch (error) {
        console.error("Failed to close terminal session:", error);
      }
    }
  }

  public focus() {
    this.terminal.focus();
  }

  public clear() {
    this.terminal.clear();
  }

  public zoomIn() {
    if (this.currentFontSize < this.maxFontSize) {
      this.currentFontSize += this.fontSizeStep;
      this.updateFontSize();
    }
  }

  public zoomOut() {
    if (this.currentFontSize > this.minFontSize) {
      this.currentFontSize -= this.fontSizeStep;
      this.updateFontSize();
    }
  }

  public resetZoom() {
    this.currentFontSize = 14;
    this.updateFontSize();
  }

  private updateFontSize() {
    this.terminal.options.fontSize = this.currentFontSize;
    this.fitTerminal();
    this.updateZoomDisplay();
  }

  private updateZoomDisplay() {
    const zoomDisplay = document.getElementById("zoom-display");
    if (zoomDisplay) {
      const percentage = Math.round((this.currentFontSize / 14) * 100);
      zoomDisplay.textContent = `${percentage}%`;
    }
  }

  public getCurrentFontSize(): number {
    return this.currentFontSize;
  }

  public getTabId(): string {
    return this.tabId;
  }

  public dispose() {
    this.closeSession();
    this.terminal.dispose();
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
    this.createInitialTab();
  }

  private generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private async createInitialTab() {
    const tabId = this.generateTabId();
    await this.createTab(tabId, "Terminal");
    this.setActiveTab(tabId);
  }

  public async createTab(id?: string, title?: string): Promise<string> {
    const tabId = id || this.generateTabId();
    const tabTitle = title || `Terminal ${this.tabCounter}`;
    this.tabCounter++;

    // Create terminal container
    const terminalElement = document.createElement("div");
    terminalElement.className = "terminal-content";
    terminalElement.style.display = "none";
    terminalElement.style.height = "100%";
    terminalElement.style.width = "100%";

    // Create terminal manager
    const terminalManager = new TerminalManager(tabId);

    // Store tab data
    const tabData: TabData = {
      id: tabId,
      title: tabTitle,
      terminalManager,
      element: terminalElement,
    };

    this.tabs.set(tabId, tabData);
    this.tabOrder.push(tabId);

    // Add to DOM
    const container = document.getElementById("terminal-container");
    if (container) {
      container.appendChild(terminalElement);
      await terminalManager.initialize(terminalElement);
    }

    this.updateTabsUI();
    return tabId;
  }

  public closeTab(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // Don't close the last tab
    if (this.tabs.size <= 1) return;

    // Dispose terminal
    tab.terminalManager.dispose();

    // Remove from DOM
    tab.element.remove();

    // Remove from tabs and order
    this.tabs.delete(tabId);
    this.tabOrder = this.tabOrder.filter((id) => id !== tabId);

    // If this was the active tab, switch to another
    if (this.activeTabId === tabId) {
      if (this.tabOrder.length > 0) {
        this.setActiveTab(this.tabOrder[0]);
      }
    }

    this.updateTabsUI();
  }

  public setActiveTab(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // Hide all terminals
    this.tabs.forEach((tabData) => {
      tabData.element.style.display = "none";
    });

    // Show active terminal
    tab.element.style.display = "block";
    this.activeTabId = tabId;

    // Focus terminal
    setTimeout(() => {
      tab.terminalManager.focus();
    }, 10);

    this.updateTabsUI();
  }

  public getActiveTab(): TabData | null {
    return this.activeTabId ? this.tabs.get(this.activeTabId) || null : null;
  }

  public getAllTabs(): TabData[] {
    return this.tabOrder.map((id) => this.tabs.get(id)!).filter(Boolean);
  }

  public renameTab(tabId: string, newTitle: string) {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.title = newTitle;
      this.updateTabsUI();
    }
  }

  public moveTab(fromIndex: number, toIndex: number) {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= this.tabOrder.length ||
      toIndex >= this.tabOrder.length
    ) {
      return;
    }

    const [movedId] = this.tabOrder.splice(fromIndex, 1);
    this.tabOrder.splice(toIndex, 0, movedId);
    this.updateTabsUI();
  }

  public getTabIndex(tabId: string): number {
    return this.tabOrder.indexOf(tabId);
  }

  private startRenaming(tabId: string, titleElement: HTMLElement) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const input = document.createElement("input");
    input.type = "text";
    input.value = tab.title;
    input.className = "tab-title-input";
    input.style.cssText = `
      background: transparent;
      border: 1px solid #7aa2f7;
      border-radius: 3px;
      color: #c0caf5;
      font-size: 12px;
      font-family: inherit;
      padding: 2px 4px;
      width: 100%;
      outline: none;
    `;

    const finishRename = () => {
      const newTitle =
        input.value.trim() || `Terminal ${this.getTabIndex(tabId) + 1}`;
      this.renameTab(tabId, newTitle);
    };

    const cancelRename = () => {
      this.updateTabsUI();
    };

    input.addEventListener("blur", finishRename);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finishRename();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelRename();
      }
    });

    titleElement.innerHTML = "";
    titleElement.appendChild(input);
    input.focus();
    input.select();
  }

  private updateTabsUI() {
    this.renderTabs();
    this.updateActiveTabStyles();
  }

  private renderTabs() {
    const tabsContainer = document.getElementById("tabs-container");
    if (!tabsContainer) return;

    // Show/hide tabs based on count
    const tabsHeader = document.getElementById("tabs-header");
    if (tabsHeader) {
      tabsHeader.style.display = this.tabs.size > 1 ? "flex" : "none";
    }

    // Clear existing tabs
    tabsContainer.innerHTML = "";

    // Create tab elements in order
    this.tabOrder.forEach((tabId) => {
      const tab = this.tabs.get(tabId);
      if (!tab) return;

      const tabElement = document.createElement("div");
      tabElement.className = "tab";
      tabElement.dataset.tabId = tab.id;
      tabElement.draggable = true;

      if (tab.id === this.activeTabId) {
        tabElement.classList.add("active");
      }

      tabElement.innerHTML = `
        <span class="tab-title">${tab.title}</span>
        <button class="tab-close" title="Close tab">&times;</button>
      `;

      // Tab click handler
      tabElement.addEventListener("click", (e) => {
        if (
          !(e.target as HTMLElement).classList.contains("tab-close") &&
          !(e.target as HTMLElement).classList.contains("tab-title-input")
        ) {
          this.setActiveTab(tab.id);
        }
      });

      // Tab double-click to rename
      const titleSpan = tabElement.querySelector(".tab-title");
      if (titleSpan) {
        titleSpan.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          this.startRenaming(tab.id, titleSpan as HTMLElement);
        });
      }

      // Tab close handler
      const closeBtn = tabElement.querySelector(".tab-close");
      if (closeBtn) {
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.closeTab(tab.id);
        });
      }

      // Drag and drop handlers
      tabElement.addEventListener("dragstart", (e) => {
        this.dragState.isDragging = true;
        this.dragState.draggedTabId = tab.id;
        this.dragState.dragStartX = e.clientX;
        tabElement.classList.add("dragging");
        e.dataTransfer!.effectAllowed = "move";
      });

      tabElement.addEventListener("dragend", () => {
        this.dragState.isDragging = false;
        this.dragState.draggedTabId = null;
        this.dragState.dragOverTabId = null;
        tabElement.classList.remove("dragging");
        document.querySelectorAll(".tab").forEach((t) => {
          t.classList.remove("drag-over");
        });
      });

      tabElement.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (
          this.dragState.draggedTabId &&
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
          const fromIndex = this.getTabIndex(this.dragState.draggedTabId);
          const toIndex = this.getTabIndex(tab.id);
          this.moveTab(fromIndex, toIndex);
        }
        tabElement.classList.remove("drag-over");
      });

      tabsContainer.appendChild(tabElement);
    });
  }

  private updateActiveTabStyles() {
    const tabs = document.querySelectorAll(".tab");
    tabs.forEach((tab) => {
      const tabId = (tab as HTMLElement).dataset.tabId;
      if (tabId === this.activeTabId) {
        tab.classList.add("active");
      } else {
        tab.classList.remove("active");
      }
    });
  }

  public async createNewTab(): Promise<string> {
    const tabId = await this.createTab();
    this.setActiveTab(tabId);
    return tabId;
  }
}

// Application state
let tabManager: TabManager;

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

function setupEventHandlers() {
  const newTabBtn = document.getElementById("new-tab-btn");

  if (newTabBtn) {
    newTabBtn.addEventListener("click", () => {
      tabManager.createNewTab();
    });
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case "t":
          e.preventDefault();
          tabManager.createNewTab();
          break;
        case "w": {
          e.preventDefault();
          const activeTab = tabManager.getActiveTab();
          if (activeTab && tabManager.getAllTabs().length > 1) {
            tabManager.closeTab(activeTab.id);
          } else if (activeTab) {
            activeTab.terminalManager.closeSession();
          }
          break;
        }
        case "n": {
          e.preventDefault();
          const activeTab = tabManager.getActiveTab();
          if (activeTab) {
            activeTab.terminalManager.createNewSession();
          }
          break;
        }
        case "k": {
          e.preventDefault();
          const activeTab = tabManager.getActiveTab();
          if (activeTab) {
            activeTab.terminalManager.clear();
          }
          break;
        }
        case "=":
        case "+": {
          e.preventDefault();
          const activeTab = tabManager.getActiveTab();
          if (activeTab) {
            activeTab.terminalManager.zoomIn();
          }
          break;
        }
        case "-": {
          e.preventDefault();
          const activeTab = tabManager.getActiveTab();
          if (activeTab) {
            activeTab.terminalManager.zoomOut();
          }
          break;
        }
        case "0": {
          e.preventDefault();
          const activeTab = tabManager.getActiveTab();
          if (activeTab) {
            activeTab.terminalManager.resetZoom();
          }
          break;
        }
        case "ArrowLeft": {
          if (e.shiftKey) {
            e.preventDefault();
            const activeTab = tabManager.getActiveTab();
            if (activeTab) {
              const currentIndex = tabManager.getTabIndex(activeTab.id);
              if (currentIndex > 0) {
                tabManager.moveTab(currentIndex, currentIndex - 1);
              }
            }
          }
          break;
        }
        case "ArrowRight": {
          if (e.shiftKey) {
            e.preventDefault();
            const activeTab = tabManager.getActiveTab();
            if (activeTab) {
              const currentIndex = tabManager.getTabIndex(activeTab.id);
              const maxIndex = tabManager.getAllTabs().length - 1;
              if (currentIndex < maxIndex) {
                tabManager.moveTab(currentIndex, currentIndex + 1);
              }
            }
          }
          break;
        }
      }
    }

    // Tab switching with Ctrl+1, Ctrl+2, etc.
    if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      const tabIndex = parseInt(e.key) - 1;
      const tabs = tabManager.getAllTabs();
      if (tabs[tabIndex]) {
        tabManager.setActiveTab(tabs[tabIndex].id);
      }
    }
  });
}

// Initialize the application
window.addEventListener("DOMContentLoaded", async () => {
  createUI();
  setupEventHandlers();

  tabManager = new TabManager();
});

// Handle app focus
window.addEventListener("focus", () => {
  const activeTab = tabManager?.getActiveTab();
  if (activeTab) {
    activeTab.terminalManager.focus();
  }
});

// Prevent context menu on terminal
document.addEventListener("contextmenu", (e) => {
  const terminalContainer = document.getElementById("terminal-container");
  if (terminalContainer && terminalContainer.contains(e.target as Node)) {
    e.preventDefault();
  }
});
