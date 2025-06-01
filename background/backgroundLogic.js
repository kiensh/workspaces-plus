const BackgroundLogic = {
  init() {
    BackgroundLogic.initializeListeners();
    BackgroundLogic.initializeContextMenu();
  },

  initializeListeners() {
    // browser.windows.onRemoved.addListener(BackgroundLogic.tearDownWindow);

    browser.windows.onFocusChanged.addListener((windowId) => {
      if (windowId != browser.windows.WINDOW_ID_NONE) {
        BackgroundLogic.updateContextMenu();
        BackgroundLogic.updateBadgeText();
      }
    });

    browser.tabs.onCreated.addListener(BackgroundLogic.updateContextMenu);
    browser.tabs.onRemoved.addListener(BackgroundLogic.updateContextMenu);

    browser.omnibox.onInputChanged.addListener(
      BackgroundLogic.handleAwesomebarSearch,
    );
    browser.omnibox.onInputEntered.addListener(
      BackgroundLogic.handleAwesomebarSelection,
    );
  },

  async getWorkspacesForCurrentWindow() {
    return await BackgroundLogic.getWorkspacesForWindow(
      await BackgroundLogic.getCurrentWindowId(),
    );
  },

  async getWorkspacesForWindow(windowId) {
    const workspaces = await WorkspaceStorage.fetchWorkspacesForWindow(windowId);
    if (workspaces.length > 0) return workspaces;
    return [await BackgroundLogic.createNewWorkspace(true)];
  },

  async changeWorkspaceOrder(orderedWorkspaceIds) {
    const windowId = await BackgroundLogic.getCurrentWindowId();
    await WorkspaceStorage.changeWorkspaceOrder(windowId, orderedWorkspaceIds);
  },

  /**
   * Returns the currently active workspace for the given window.
   * If no workspace is active, it returns the first one.
   * @param {number} windowId - The ID of the window for which to get the active workspace.
   * @returns {Promise<Workspace>} A promise that resolves to the active workspace for the given window.
   */
  async getCurrentWorkspaceForWindow(windowId) {
    const workspaces = await BackgroundLogic.getWorkspacesForWindow(windowId);

    return workspaces.find((workspace) => workspace.active);
  },

  async createNewWorkspace(active) {
    const windowId = await BackgroundLogic.getCurrentWindowId();
    const nextNumber =
      (await WorkspaceStorage.fetchWorkspacesCountForWindow(windowId)) + 1;

    const workspace = await Workspace.create(
      windowId,
      `Workspace ${nextNumber}`,
      active || false,
    );

    // Re-render context menu
    BackgroundLogic.updateContextMenu();
    await BackgroundLogic.updateBadgeText();

    return workspace;
  },

  async cloneWorkspace(active) {
    const windowId = await BackgroundLogic.getCurrentWindowId();
    const currentWorkspace =
      await BackgroundLogic.getCurrentWorkspaceForWindow(windowId);
    const nextNumber =
      (await WorkspaceStorage.fetchWorkspacesCountForWindow(windowId)) + 1;

    const workspace = await Workspace.create(
      windowId,
      `Workspace ${nextNumber}`,
      active || false,
      await currentWorkspace.getTabs(),
    );

    // Re-render context menu
    BackgroundLogic.updateContextMenu();
    await BackgroundLogic.updateBadgeText();

    return workspace;
  },

  async createNewWorkspaceAndSwitch(active) {
    const workspace = await BackgroundLogic.createNewWorkspace(active);
    await BackgroundLogic.switchToWorkspace(workspace.id);
  },

  async cloneWorkspaceAndSwitch(active) {
    const workspace = await BackgroundLogic.cloneWorkspace(active);
    await BackgroundLogic.switchToWorkspace(workspace.id);
  },

  async switchToWorkspace(workspaceId) {
    const windowId = await BackgroundLogic.getCurrentWindowId();

    const oldWorkspace =
      await BackgroundLogic.getCurrentWorkspaceForWindow(windowId);
    const newWorkspace = await Workspace.find(workspaceId);

    if (oldWorkspace.id == newWorkspace.id) {
      // Nothing to do here
      return;
    }

    // Since we're gonna be closing all open tabs, we need to show the new ones first.
    // However, we first need to prepare the old one, so it can tell which tabs were the original ones and which were opened by the new workspace.
    await oldWorkspace.prepareToHide();
    await newWorkspace.show();
    await oldWorkspace.hide();

    BackgroundLogic.updateContextMenu();
    await BackgroundLogic.updateBadgeText();
  },

  async renameWorkspace(workspaceId, workspaceName) {
    const workspace = await Workspace.find(workspaceId);

    await workspace.rename(workspaceName);

    // Re-render context menu
    BackgroundLogic.updateContextMenu();
    await BackgroundLogic.updateBadgeText();
  },

  async deleteWorkspace(workspaceId) {
    const windowId = await BackgroundLogic.getCurrentWindowId();
    const currentWorkspace =
      await BackgroundLogic.getCurrentWorkspaceForWindow(windowId);
    const workspaceToDelete = await Workspace.find(workspaceId);

    if (currentWorkspace.id == workspaceId) {
      const nextWorkspaceId = await WorkspaceStorage.fetchNextWorkspaceId(
        windowId,
        workspaceId,
      );
      await BackgroundLogic.switchToWorkspace(nextWorkspaceId);
    }

    await workspaceToDelete.delete();

    // Re-render context menu
    BackgroundLogic.updateContextMenu();
    await BackgroundLogic.updateBadgeText();
  },

  async moveTabToWorkspace(tab, destinationWorkspace) {
    const windowId = await BackgroundLogic.getCurrentWindowId();
    const currentWorkspace =
      await BackgroundLogic.getCurrentWorkspaceForWindow(windowId);

    // Attach tab to destination workspace
    await destinationWorkspace.attachTab(tab);

    // If this is the last tab of the window, we need to switch workspaces
    const tabsInCurrentWindow = await browser.tabs.query({
      windowId: windowId,
      pinned: false,
    });

    if (tabsInCurrentWindow.length == 1) {
      await BackgroundLogic.switchToWorkspace(destinationWorkspace.id);
    }

    // Finally, detach tab from source workspace
    await currentWorkspace.detachTab(tab);
  },

  tearDownWindow(windowId) {
    // Don't tear down if the user is closing the browser
    setTimeout(() => {
      WorkspaceStorage.tearDownWindow(windowId);
    }, 5000);
  },

  async getCurrentWindowId() {
    const currentWindow = await browser.windows.getCurrent();

    return currentWindow.id;
  },

  async initializeContextMenu() {
    const menuId = Util.generateUUID();

    browser.menus.create({
      id: menuId,
      title: "Send Tab to Workspace",
      contexts: ["tab"],
    });

    const workspaces = await BackgroundLogic.getWorkspacesForCurrentWindow();
    const workspaceObjects = await Promise.all(
      workspaces.map((workspace) => workspace.toObject()),
    );
    workspaceObjects.forEach((workspace) => {
      browser.menus.create({
        title: `${workspace.name} (${workspace.tabCount} tabs)`,
        parentId: menuId,
        id: workspace.id,
        enabled: !workspace.active,
        onclick: BackgroundLogic.handleContextMenuClick,
      });
    });

    browser.menus.create({
      parentId: menuId,
      type: "separator",
    });

    browser.menus.create({
      title: "Create new workspace",
      parentId: menuId,
      id: "new-" + menuId,
      onclick: BackgroundLogic.handleContextMenuClick,
    });
  },

  updateContextMenu: Util.debounce(async () => {
    await browser.menus.removeAll();
    await BackgroundLogic.initializeContextMenu();
  }, 250),

  async handleContextMenuClick(menu, _tab) {
    let destinationWorkspace;
    const selected_tabs = await browser.tabs.query({ currentWindow: true, highlighted: true });

    if (menu.menuItemId.substring(0, 3) == "new") {
      destinationWorkspace = await BackgroundLogic.createNewWorkspace(false);
    } else {
      destinationWorkspace = await Workspace.find(menu.menuItemId);
    }

    for (const t of selected_tabs) {
      await BackgroundLogic.moveTabToWorkspace(t, destinationWorkspace);
    }
  },

  async handleAwesomebarSearch(text, suggest) {
    suggest(await BackgroundLogic.searchTabs(text));
  },

  async handleAwesomebarSelection(content, _disposition) {
    let windowId, workspaceId, tabIndex;
    [windowId, workspaceId, tabIndex] = content.split(":");

    await browser.windows.update(parseInt(windowId), { focused: true });

    const workspace = await Workspace.find(workspaceId);
    await BackgroundLogic.switchToWorkspace(workspace.id);

    const matchedTabs = await browser.tabs.query({
      windowId: parseInt(windowId),
      index: parseInt(tabIndex),
    });

    if (matchedTabs.length > 0) {
      await browser.tabs.update(matchedTabs[0].id, { active: true });
    }
  },

  async searchTabs(text) {
    if (text.length < 3) {
      return [];
    }

    const windows = await browser.windows.getAll({ windowTypes: ["normal"] });
    const promises = windows.map((windowInfo) =>
      BackgroundLogic.searchTabsInWindow(text, windowInfo.id),
    );

    return Util.flattenArray(await Promise.all(promises));
  },

  async searchTabsInWindow(text, windowId) {
    const suggestions = [];

    const workspaces = await BackgroundLogic.getWorkspacesForWindow(windowId);
    const promises = workspaces.map(async (workspace) => {
      const tabs = await workspace.getTabs();
      tabs.forEach((tab) => {
        if (Util.matchesQuery(tab.title, text)) {
          suggestions.push({
            content: `${windowId}:${workspace.id}:${tab.index}`,
            description: tab.title,
          });
        }
      });
    });

    await Promise.all(promises);
    return suggestions;
  },

  async updateBadgeText() {
    const windowId = await BackgroundLogic.getCurrentWindowId();
    const currentWorkspace =
      await BackgroundLogic.getCurrentWorkspaceForWindow(windowId);
    browser.browserAction.setBadgeText({
      text: currentWorkspace.name.toUpperCase().substring(0, 4),
    });
    browser.browserAction.setBadgeBackgroundColor({ color: "#121212" });
  },
};

BackgroundLogic.init();
