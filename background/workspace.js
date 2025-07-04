class Workspace {
  constructor(id, state) {
    this.id = id;

    if (state) {
      this.name = state.name;
      this.active = state.active;
      this.hiddenTabs = state.hiddenTabs;
      this.windowId = state.windowId;
    }
  }

  static async create(windowId, name, active, tabs = []) {
    const workspace = new Workspace(Util.generateUUID(), {
      name: name,
      active: active || false,
      hiddenTabs: tabs,
      windowId: windowId,
    });

    await workspace.storeState();
    await WorkspaceStorage.registerWorkspaceToWindow(windowId, workspace.id);

    return workspace;
  }

  static async find(workspaceId) {
    const workspace = new Workspace(workspaceId);
    await workspace.refreshState();

    return workspace;
  }

  async rename(newName) {
    this.name = newName;
    await this.storeState();
  }

  async getTabs() {
    if (this.active) {
      // Not counting pinned tabs. Should we?
      const tabs = await browser.tabs.query({
        pinned: false,
        windowId: this.windowId,
      });

      return tabs;
    } else {
      return this.hiddenTabs;
    }
  }

  async toObject() {
    const obj = Object.assign({}, this);
    obj.tabCount = (await this.getTabs()).length;

    return obj;
  }

  // Store hidden tabs in storage
  async prepareToHide() {
    const tabs = await browser.tabs.query({
      windowId: this.windowId,
      pinned: false,
    });

    tabs.forEach((tab) => {
      const tabData = {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        cookieStoreId: tab.cookieStoreId,
      };
      this.hiddenTabs.push(tabData);
    });
  }

  // Then remove the tabs from the window
  async hide() {
    this.active = false;
    await this.storeState();

    const tabIds = this.hiddenTabs.map((tab) => tab.id);
    await browser.tabs.remove(tabIds);
  }

  async show() {
    const tabs = this.hiddenTabs.filter((tab) =>
      Util.isPermissibleURL(tab.url),
    );

    if (tabs.length == 0) {
      tabs.push({
        url: null,
        active: true,
      });
    }

    const promises = tabs.map((tab) => {
      return browser.tabs
        .create({
          url: tab.url,
          title: tab.active != true ? tab.title : null,
          active: tab.active,
          cookieStoreId: tab.cookieStoreId,
          discarded: tab.active != true,
        })
        .catch(() => {
          browser.notifications &&
            browser.notifications.create({
              type: "basic",
              iconUrl: browser.runtime.getURL("icons/container-site-d-48.png"),
              title: "Workspaces+",
              message: `Failed to create tab: ${tab.url || "Unknown URL"}`,
            });
        });
    });

    await Promise.all(promises);

    this.hiddenTabs = [];
    this.active = true;
    await this.storeState();
  }

  // Then remove the tabs from the window
  async delete() {
    await WorkspaceStorage.deleteWorkspaceState(this.id);
    await WorkspaceStorage.unregisterWorkspaceToWindow(this.windowId, this.id);
  }

  async attachTab(tab) {
    this.hiddenTabs.push(tab);

    await this.storeState();
  }

  async detachTab(tab) {
    // We need to refresh the state because if the active workspace was switched we might have an old reference
    await this.refreshState();

    if (this.active) {
      // If the workspace is currently active, simply remove the tab.
      await browser.tabs.remove(tab.id);
    } else {
      // Otherwise, forget it from hiddenTabs
      const index = this.hiddenTabs.findIndex(
        (hiddenTab) => hiddenTab.id == tab.id,
      );
      if (index > -1) {
        this.hiddenTabs.splice(index, 1);
        await this.storeState();
      }
    }
  }

  async refreshState() {
    const state = await WorkspaceStorage.fetchWorkspaceState(this.id);

    this.name = state.name;
    this.active = state.active;
    this.hiddenTabs = state.hiddenTabs;
    this.windowId = state.windowId;

    // For backwards compatibility
    if (!this.windowId) {
      console.log("Backwards compatibility for", this.name);
      this.windowId = (await browser.windows.getCurrent()).id;
      await this.storeState();
    }
  }

  async storeState() {
    await WorkspaceStorage.storeWorkspaceState(this.id, {
      name: this.name,
      active: this.active,
      hiddenTabs: this.hiddenTabs,
      windowId: this.windowId,
    });
  }
}
