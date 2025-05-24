const WorkspaceStorage = {
  async fetchWorkspaceState(workspaceId) {
    const key = WorkspaceStorage._getKeyForWorkspace(workspaceId);
    const results = await browser.storage.local.get(key);

    if (results[key]) {
      return results[key];
    } else {
      throw `Workspace ${workspaceId} has no state.`;
    }
  },

  async storeWorkspaceState(workspaceId, state) {
    const key = WorkspaceStorage._getKeyForWorkspace(workspaceId);
    await browser.storage.local.set({
      [key]: state,
    });
  },

  async deleteWorkspaceState(workspaceId) {
    const key = WorkspaceStorage._getKeyForWorkspace(workspaceId);
    await browser.storage.local.remove(key);
  },

  async fetchWorkspacesCountForWindow(windowId) {
    const key = WorkspaceStorage._getKeyForWindow(windowId);
    const results = await browser.storage.local.get(key);

    const workspaceIds = results[key] || [];

    return workspaceIds.length;
  },
  async changeWorkspaceOrder(windowId, orderedWorkspaceIds) {
    const key = WorkspaceStorage._getKeyForWindow(windowId);
    await browser.storage.local.set({
      [key]: orderedWorkspaceIds,
    });
  },

  async fetchWorkspacesForWindow(windowId) {
    const key = WorkspaceStorage._getKeyForWindow(windowId);
    const results = await browser.storage.local.get(key);

    const workspaceIds = results[key] || [];
    const promises = workspaceIds.map(async (workspaceId) => {
      const state = await WorkspaceStorage.fetchWorkspaceState(workspaceId);
      return new Workspace(workspaceId, state);
    });

    return await Promise.all(promises);
  },

  async registerWorkspaceToWindow(windowId, workspaceId) {
    const key = WorkspaceStorage._getKeyForWindow(windowId);
    const results = await browser.storage.local.get(key);
    const workspacesForWindow = results[key] || [];

    workspacesForWindow.push(workspaceId);
    await browser.storage.local.set({
      [key]: workspacesForWindow,
    });
  },

  async unregisterWorkspaceToWindow(windowId, workspaceId) {
    const key = WorkspaceStorage._getKeyForWindow(windowId);
    const results = await browser.storage.local.get(key);
    const workspacesForWindow = results[key] || [];

    const index = workspacesForWindow.findIndex(
      (aWorkspaceId) => aWorkspaceId == workspaceId,
    );
    workspacesForWindow.splice(index, 1);

    await browser.storage.local.set({
      [key]: workspacesForWindow,
    });
  },

  async fetchNextWorkspaceId(windowId, referenceWorkspaceId) {
    const key = WorkspaceStorage._getKeyForWindow(windowId);
    const results = await browser.storage.local.get(key);

    const workspaceIds = results[key] || [];
    const index = workspaceIds.findIndex(
      (aWorkspaceId) => aWorkspaceId == referenceWorkspaceId,
    );

    if (index == -1 || workspaceIds.length == 1) {
      throw "There is no other workspace";
    }

    const nextIndex = index < workspaceIds.length - 1 ? index + 1 : index - 1;
    return workspaceIds[nextIndex];
  },

  async tearDownWindow(windowId) {
    // Fetch workspaces in closed window
    const key = WorkspaceStorage._getKeyForWindow(windowId);
    const results = await browser.storage.local.get(key);
    const workspaceIds = results[key] || [];

    // Remove entry in windows list
    await browser.storage.local.remove(key);

    // Then remove the state of all the workspaces in the window
    const promises = workspaceIds.map(WorkspaceStorage.deleteWorkspaceState);

    await Promise.all(promises);
  },

  _getKeyForWorkspace(workspaceId) {
    return `workspaces@${workspaceId}`;
  },
  _getKeyForWindow(windowId) {
    return `windows@0`;
  },
};
