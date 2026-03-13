"use strict";

// ─── Chrome Tab Group Colors → CSS ──────────────────────────

var GROUP_COLORS = {
  grey:   { bg: "#dadce0", text: "#202124" },
  blue:   { bg: "#8ab4f8", text: "#174ea6" },
  red:    { bg: "#f28b82", text: "#a50e0e" },
  yellow: { bg: "#fdd663", text: "#594300" },
  green:  { bg: "#81c995", text: "#0d652d" },
  pink:   { bg: "#ff8bcb", text: "#7c2950" },
  purple: { bg: "#c58af9", text: "#4a148c" },
  cyan:   { bg: "#78d9ec", text: "#0e4f5c" },
  orange: { bg: "#fcad70", text: "#6b3205" }
};

var STORAGE_KEYS = {
  customNames:       "pb_custom_names",
  tabHomes:          "pb_tab_homes",
  collapsedSections: "pb_collapsed_sections",
  collapsedGroups:   "pb_collapsed_groups",
  activeView:        "pb_active_view",
  pinnedInGroup:     "pb_pinned_in_group",
  savedGroups:       "pb_saved_groups",
  expandedBookmarks: "pb_expanded_bookmarks"
};

// ─── State ──────────────────────────────────────────────────

var windowId = null;
var customNames = {};
var collapsedSections = {};
var collapsedGroups = {};
var refreshTimer = null;
var dragData = null;
var activeView = "tabs";
var tabHomes = {}; // tabId → homeUrl (runtime)
var homeEntries = []; // [{homeUrl, lastTabUrl}] (persisted for cross-restart recovery)
var pinnedInGroupIds = {}; // tabId → true (runtime)
var pinnedInGroupEntries = []; // [{url, groupId}] (persisted for cross-restart recovery)
var savedGroups = [];
var expandedBookmarks = {}; // bookmarkNodeId → true

// ─── Init ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function() {
  // Notify background script that the panel is open
  chrome.runtime.connect({ name: "pixel-bar-panel" });

  chrome.windows.getCurrent(function(win) {
    windowId = win.id;
    chrome.storage.local.get(
      [STORAGE_KEYS.customNames, STORAGE_KEYS.tabHomes,
       STORAGE_KEYS.collapsedSections, STORAGE_KEYS.collapsedGroups,
       STORAGE_KEYS.activeView, STORAGE_KEYS.pinnedInGroup,
       STORAGE_KEYS.savedGroups, STORAGE_KEYS.expandedBookmarks],
      function(data) {
        customNames       = data[STORAGE_KEYS.customNames] || {};
        homeEntries       = data[STORAGE_KEYS.tabHomes] || [];
        if (!Array.isArray(homeEntries)) homeEntries = [];
        collapsedSections = data[STORAGE_KEYS.collapsedSections] || {};
        collapsedGroups   = data[STORAGE_KEYS.collapsedGroups] || {};
        activeView        = data[STORAGE_KEYS.activeView] || "tabs";
        pinnedInGroupEntries = data[STORAGE_KEYS.pinnedInGroup] || [];
        if (!Array.isArray(pinnedInGroupEntries)) pinnedInGroupEntries = [];
        savedGroups = data[STORAGE_KEYS.savedGroups] || [];
        expandedBookmarks = data[STORAGE_KEYS.expandedBookmarks] || {};
        applySectionCollapseStates();
        setupViewNav();
        setupBookmarksToolbar();
        setupContextMenu();
        setupGroupContextMenu();
        setupClearDataMenu();
        setupToolbar();
        switchView(activeView);
        refresh();
        setupChromeListeners();
        setupSectionToggles();
      }
    );
  });
});

// ─── View Navigation ────────────────────────────────────────

function setupViewNav() {
  document.querySelectorAll(".view-tab").forEach(function(btn) {
    btn.addEventListener("click", function() {
      switchView(btn.getAttribute("data-view"));
    });
  });
}

function switchView(viewName) {
  activeView = viewName;
  chrome.storage.local.set(makeObj(STORAGE_KEYS.activeView, viewName));

  // Update nav buttons
  document.querySelectorAll(".view-tab").forEach(function(btn) {
    btn.classList.toggle("active", btn.getAttribute("data-view") === viewName);
  });

  // Update view panels
  document.querySelectorAll(".view").forEach(function(v) {
    v.classList.remove("active");
  });
  var target = document.getElementById("view-" + viewName);
  if (target) target.classList.add("active");

  // Render the view content on switch
  if (viewName === "bookmarks") {
    renderBookmarks();
  } else if (viewName === "history") {
    renderRecentlyClosed();
  }
}

// ─── Refresh ────────────────────────────────────────────────

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 80);
}

function refresh() {
  chrome.tabs.query({ windowId: windowId }, function(tabs) {
    chrome.tabGroups.query({ windowId: windowId }, function(groups) {
      // Prune selected IDs that no longer exist
      var currentIds = tabs.map(function(t) { return t.id; });
      selectedTabIds = selectedTabIds.filter(function(id) {
        return currentIds.indexOf(id) !== -1;
      });
      // Rebuild tab-home associations
      rebuildTabHomes(tabs);
      // Rebuild pinned-in-group tab IDs (handles restart recovery)
      rebuildPinnedInGroupIds(tabs);

      var pinnedTabs = [];
      var groupedTabs = {};
      var ungroupedTabs = [];

      tabs.forEach(function(tab) {
        if (tab.pinned) {
          pinnedTabs.push(tab);
        } else if (tab.groupId !== -1) {
          if (!groupedTabs[tab.groupId]) groupedTabs[tab.groupId] = [];
          groupedTabs[tab.groupId].push(tab);
        } else {
          ungroupedTabs.push(tab);
        }
      });

      // Sort groups by their position in the tab strip
      groups.sort(function(a, b) {
        var aTabs = groupedTabs[a.id] || [];
        var bTabs = groupedTabs[b.id] || [];
        var aIdx = aTabs.length > 0 ? aTabs[0].index : Infinity;
        var bIdx = bTabs.length > 0 ? bTabs[0].index : Infinity;
        return aIdx - bIdx;
      });

      renderPinnedTabs(pinnedTabs);
      renderTabGroups(groups, groupedTabs);
      renderUngroupedTabs(ungroupedTabs);
      renderSavedGroups();
      updateSelectionVisuals();
      attachFaviconErrorHandlers(document);
    });
  });
}

// ─── Pinned Tabs ────────────────────────────────────────────

function renderPinnedTabs(tabs) {
  var container = document.getElementById("pinned-tabs");
  container.innerHTML = "";
  tabs.forEach(function(tab) {
    var el = document.createElement("div");
    el.className = "pinned-tab" + (tab.active ? " active" : "");
    el.title = getTabDisplayName(tab);
    el.setAttribute("data-tab-id", tab.id);
    el.draggable = true;
    el.innerHTML = faviconHTML(tab, true);
    if (tab.audible) {
      el.innerHTML += "<span class=\"audio-indicator\">&#128266;</span>";
    }
    el.addEventListener("click", function() { activateTab(tab.id); });
    el.addEventListener("auxclick", function(e) {
      if (e.button === 1) closeTab(tab.id);
    });

    // Drag-and-drop for pinned tab reordering
    el.addEventListener("dragstart", function(e) {
      dragData = { type: "pinned", tabId: tab.id, index: tab.index };
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", function() {
      el.classList.remove("dragging");
      clearDropIndicators();
      dragData = null;
    });
    el.addEventListener("dragover", function(e) {
      if (!dragData || dragData.type !== "pinned") return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      clearDropIndicators();
      var rect = el.getBoundingClientRect();
      var midX = rect.left + rect.width / 2;
      if (e.clientX < midX) {
        el.classList.add("drop-left");
      } else {
        el.classList.add("drop-right");
      }
    });
    el.addEventListener("dragleave", function() { clearDropIndicators(); });
    el.addEventListener("drop", function(e) {
      e.preventDefault();
      e.stopPropagation();
      clearDropIndicators();
      if (!dragData || dragData.type !== "pinned") return;
      if (dragData.tabId === tab.id) return;
      var rect = el.getBoundingClientRect();
      var midX = rect.left + rect.width / 2;
      var targetIndex = e.clientX < midX ? tab.index : tab.index + 1;
      chrome.tabs.move(dragData.tabId, { index: targetIndex }, function() {
        scheduleRefresh();
      });
    });

    container.appendChild(el);
  });

}

// ─── Tab Groups ─────────────────────────────────────────────

function renderTabGroups(groups, groupedTabs) {
  var container = document.getElementById("tab-groups");
  container.innerHTML = "";

  groups.forEach(function(group) {
    var tabs = groupedTabs[group.id] || [];
    var colorObj = GROUP_COLORS[group.color] || GROUP_COLORS.grey;
    var isCollapsed = collapsedGroups[group.id] === true;

    // Split tabs into pinned-in-group and normal
    var pinnedTabs = [];
    var normalTabs = [];
    tabs.forEach(function(tab) {
      if (isTabPinnedInGroup(tab)) {
        pinnedTabs.push(tab);
      } else {
        normalTabs.push(tab);
      }
    });

    var groupEl = document.createElement("div");
    groupEl.className = "tab-group" + (isCollapsed ? " collapsed" : "");
    groupEl.setAttribute("data-group-id", group.id);

    // Header
    var header = document.createElement("div");
    header.className = "group-header";
    header.draggable = true;
    header.setAttribute("data-group-id", group.id);
    header.style.background = colorObj.bg;
    header.style.color = colorObj.text;
    header.innerHTML =
      "<span class=\"group-collapse\">&#9660;</span>" +
      "<span class=\"group-title\">" + escapeHTML(group.title || "Unnamed") + "</span>" +
      "<span class=\"group-count\">" + tabs.length + "</span>" +
      "<span class=\"group-actions\">" +
        "<button class=\"group-action-btn group-save-btn\" title=\"Save group snapshot\">&#128190;</button>" +
        "<button class=\"group-action-btn group-restore-btn\" title=\"Restore saved tabs\" style=\"display:none\">&#8634;</button>" +
        "<button class=\"group-action-btn group-rename-btn\" title=\"Rename group\">&#9998;</button>" +
        "<button class=\"group-action-btn group-close-btn\" title=\"Close &amp; save group\">&#10005;</button>" +
      "</span>";

    header.addEventListener("click", function(e) {
      if (e.target.closest(".group-actions")) return;
      toggleGroupCollapse(group.id, groupEl);
    });

    header.addEventListener("contextmenu", function(e) {
      showGroupContextMenu(e, group, tabs);
    });

    header.querySelector(".group-save-btn").addEventListener("click", function(e) {
      e.stopPropagation();
      saveTabGroup(group, tabs);
      // Show restore button after saving
      var restoreBtn = header.querySelector(".group-restore-btn");
      if (restoreBtn) restoreBtn.style.display = "";
    });

    // Show restore button if a saved snapshot exists for this group
    var savedSnapshot = findSavedGroup(group);
    var restoreBtn = header.querySelector(".group-restore-btn");
    if (savedSnapshot && restoreBtn) {
      restoreBtn.style.display = "";
    }
    restoreBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      restoreGroupSnapshot(group);
    });

    header.querySelector(".group-rename-btn").addEventListener("click", function(e) {
      e.stopPropagation();
      startGroupRename(group, header.querySelector(".group-title"));
    });

    header.querySelector(".group-close-btn").addEventListener("click", function(e) {
      e.stopPropagation();
      closeAndSaveGroup(group, tabs);
    });

    // Drag for group reorder
    header.addEventListener("dragstart", function(e) {
      dragData = { type: "group", groupId: group.id };
      e.dataTransfer.effectAllowed = "move";
      header.classList.add("dragging");
    });
    header.addEventListener("dragend", function() {
      header.classList.remove("dragging");
      clearDropIndicators();
      dragData = null;
    });
    header.addEventListener("dragover", function(e) { handleGroupDragOver(e, header); });
    header.addEventListener("dragleave", function() { clearDropIndicators(); });
    header.addEventListener("drop", function(e) { handleGroupDrop(e, group); });

    // Group top area: header + pinned tabs share a colored background
    var groupTop = document.createElement("div");
    groupTop.className = "group-top";
    groupTop.style.background = colorObj.bg + "26"; // ~15% opacity via hex alpha
    groupTop.appendChild(header);

    // Pinned-in-group tabs — compact favicon row
    if (pinnedTabs.length > 0) {
      var pinnedRow = document.createElement("div");
      pinnedRow.className = "group-pinned-tabs";
      pinnedTabs.forEach(function(tab) {
        var el = document.createElement("div");
        el.className = "group-pinned-tab" + (tab.active ? " active" : "");
        el.title = getTabDisplayName(tab);
        el.setAttribute("data-tab-id", tab.id);
        el.draggable = true;
        el.innerHTML = faviconHTML(tab, true);
        if (tab.audible) {
          el.innerHTML += "<span class=\"audio-indicator\">&#128266;</span>";
        }
        el.addEventListener("click", function() { activateTab(tab.id); });
        el.addEventListener("auxclick", function(e) {
          if (e.button === 1) closeTab(tab.id);
        });
        el.addEventListener("contextmenu", function(e) {
          showContextMenu(e, tab);
        });

        // Drag-and-drop for reordering within pinned-in-group row
        el.addEventListener("dragstart", function(e) {
          dragData = { type: "group-pinned", tabId: tab.id, groupId: group.id, index: tab.index };
          e.dataTransfer.effectAllowed = "move";
          el.classList.add("dragging");
        });
        el.addEventListener("dragend", function() {
          el.classList.remove("dragging");
          clearDropIndicators();
          dragData = null;
        });
        el.addEventListener("dragover", function(e) {
          if (!dragData || dragData.type !== "group-pinned") return;
          if (dragData.groupId !== group.id) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          clearDropIndicators();
          var rect = el.getBoundingClientRect();
          var midX = rect.left + rect.width / 2;
          if (e.clientX < midX) {
            el.classList.add("drop-left");
          } else {
            el.classList.add("drop-right");
          }
        });
        el.addEventListener("dragleave", function() { clearDropIndicators(); });
        el.addEventListener("drop", function(e) {
          e.preventDefault();
          e.stopPropagation();
          clearDropIndicators();
          if (!dragData || dragData.type !== "group-pinned") return;
          if (dragData.tabId === tab.id) return;
          if (dragData.groupId !== group.id) return;
          var rect = el.getBoundingClientRect();
          var midX = rect.left + rect.width / 2;
          var targetIndex = e.clientX < midX ? tab.index : tab.index + 1;
          chrome.tabs.move(dragData.tabId, { index: targetIndex }, function() {
            scheduleRefresh();
          });
        });

        pinnedRow.appendChild(el);
      });
      groupTop.appendChild(pinnedRow);
    }

    groupEl.appendChild(groupTop);

    // Body wrap for collapse animation (single child needed for grid 0fr trick)
    var bodyWrap = document.createElement("div");
    bodyWrap.className = "group-body-wrap";

    var body = document.createElement("div");
    body.className = "group-body tab-list";
    body.setAttribute("data-group-id", group.id);
    normalTabs.forEach(function(tab) {
      body.appendChild(createTabElement(tab));
    });

    // Drop zone for tabs dragged into this group
    body.addEventListener("dragover", function(e) { handleTabListDragOver(e, body); });
    body.addEventListener("dragleave", function(e) {
      if (!body.contains(e.relatedTarget)) {
        body.classList.remove("drop-target");
        clearDropIndicators();
      }
    });
    body.addEventListener("drop", function(e) { handleTabListDrop(e, group.id); });

    bodyWrap.appendChild(body);
    groupEl.appendChild(bodyWrap);
    container.appendChild(groupEl);
  });
}

// ─── Ungrouped Tabs ─────────────────────────────────────────

function renderUngroupedTabs(tabs) {
  var section = document.getElementById("ungrouped-tabs");
  var body = section.querySelector(".section-body");
  var count = section.querySelector(".section-count");
  body.innerHTML = "";
  count.textContent = tabs.length;

  if (tabs.length === 0) {
    body.innerHTML = "<div class=\"empty-message\">No ungrouped tabs</div>";
    return;
  }

  tabs.forEach(function(tab) {
    body.appendChild(createTabElement(tab));
  });

  // Drop zone for ungrouping
  body.addEventListener("dragover", function(e) { handleTabListDragOver(e, body); });
  body.addEventListener("dragleave", function(e) {
    if (!body.contains(e.relatedTarget)) {
      body.classList.remove("drop-target");
      clearDropIndicators();
    }
  });
  body.addEventListener("drop", function(e) { handleTabListDrop(e, -1); });
}

// ─── Create Tab Element ─────────────────────────────────────

function createTabElement(tab) {
  var el = document.createElement("div");
  el.className = "tab-item" + (tab.active ? " active" : "");
  el.setAttribute("data-tab-id", tab.id);
  el.draggable = true;

  var title = getTabDisplayName(tab);
  var homeUrl = getTabHomeUrl(tab);
  var hasCustomName = !!(tabHomes[tab.id] && customNames[tabHomes[tab.id]]);

  el.innerHTML =
    "<button class=\"tab-set-home\" title=\"Set current page as home\">&#8962;</button>" +
    "<span class=\"tab-favicon-wrap" + (homeUrl ? " strayed" : "") + "\">" +
      faviconHTML(tab, false) +
      (homeUrl ? "<span class=\"stray-badge\" title=\"Return to saved page\">&#8617;</span>" : "") +
    "</span>" +
    "<span class=\"tab-title\" title=\"" + escapeAttr(tab.title || "") + "\">" +
      escapeHTML(title) +
    "</span>" +
    (tab.audible ? "<span class=\"tab-audio\">&#128266;</span>" : "") +
    "<button class=\"tab-close\" title=\"Close tab\">&times;</button>";

  el.addEventListener("click", function(e) {
    handleTabClick(e, tab);
  });

  el.addEventListener("contextmenu", function(e) {
    showContextMenu(e, tab);
  });

  el.querySelector(".tab-close").addEventListener("click", function(e) {
    e.stopPropagation();
    closeTab(tab.id);
  });

  // Stray badge — click favicon area to navigate back to saved URL
  var strayBadge = el.querySelector(".stray-badge");
  if (strayBadge) {
    var faviconWrap = el.querySelector(".tab-favicon-wrap");
    faviconWrap.addEventListener("click", function(e) {
      e.stopPropagation();
      chrome.tabs.update(tab.id, { url: homeUrl });
    });
  }

  // Set home button — set or update home URL to current page
  var setHomeBtn = el.querySelector(".tab-set-home");
  setHomeBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    var oldHome = tabHomes[tab.id];
    if (oldHome && customNames[oldHome]) {
      // Move the custom name to the new URL
      var name = customNames[oldHome];
      delete customNames[oldHome];
      customNames[tab.url] = name;
      chrome.storage.local.set(makeObj(STORAGE_KEYS.customNames, customNames));
    }
    tabHomes[tab.id] = tab.url;
    chrome.tabs.query({ windowId: windowId }, function(allTabs) {
      persistHomeEntries(allTabs);
    });
    scheduleRefresh();
  });

  // Double-click to rename
  el.querySelector(".tab-title").addEventListener("dblclick", function(e) {
    e.stopPropagation();
    startRename(tab, el.querySelector(".tab-title"));
  });

  // Drag
  el.addEventListener("dragstart", function(e) {
    dragData = { type: "tab", tabId: tab.id, groupId: tab.groupId };
    e.dataTransfer.effectAllowed = "move";
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", function() {
    el.classList.remove("dragging");
    clearDropIndicators();
    dragData = null;
  });
  el.addEventListener("dragover", function(e) { handleTabDragOver(e, el); });
  el.addEventListener("dragleave", function() { clearDropIndicators(); });
  el.addEventListener("drop", function(e) { handleTabDrop(e, tab); });

  return el;
}

// ─── Multi-Select & Context Menu ────────────────────────────

var selectedTabIds = [];
var lastClickedTabId = null;

function getSelectedTabIds() {
  return selectedTabIds.length > 0 ? selectedTabIds.slice() : [];
}

function clearSelection() {
  selectedTabIds = [];
  lastClickedTabId = null;
  document.querySelectorAll(".tab-item.selected").forEach(function(el) {
    el.classList.remove("selected");
  });
}

function handleTabClick(e, tab) {
  if (e.target.classList.contains("tab-close") || e.target.classList.contains("tab-set-home") || e.target.closest(".tab-favicon-wrap .stray-badge")) return;

  var metaKey = e.metaKey || e.ctrlKey;
  var shiftKey = e.shiftKey;

  if (metaKey) {
    // Toggle selection
    var idx = selectedTabIds.indexOf(tab.id);
    if (idx === -1) {
      selectedTabIds.push(tab.id);
    } else {
      selectedTabIds.splice(idx, 1);
    }
    lastClickedTabId = tab.id;
    updateSelectionVisuals();
  } else if (shiftKey && lastClickedTabId !== null) {
    // Range select
    var allItems = Array.from(document.querySelectorAll("#view-tabs .tab-item[data-tab-id]"));
    var startIdx = -1, endIdx = -1;
    for (var i = 0; i < allItems.length; i++) {
      var itemId = parseInt(allItems[i].getAttribute("data-tab-id"), 10);
      if (itemId === lastClickedTabId) startIdx = i;
      if (itemId === tab.id) endIdx = i;
    }
    if (startIdx !== -1 && endIdx !== -1) {
      var lo = Math.min(startIdx, endIdx);
      var hi = Math.max(startIdx, endIdx);
      selectedTabIds = [];
      for (var j = lo; j <= hi; j++) {
        selectedTabIds.push(parseInt(allItems[j].getAttribute("data-tab-id"), 10));
      }
    }
    updateSelectionVisuals();
  } else {
    // Normal click — activate tab, clear selection
    clearSelection();
    lastClickedTabId = tab.id;
    activateTab(tab.id);
  }
}

function updateSelectionVisuals() {
  document.querySelectorAll(".tab-item[data-tab-id]").forEach(function(el) {
    var id = parseInt(el.getAttribute("data-tab-id"), 10);
    el.classList.toggle("selected", selectedTabIds.indexOf(id) !== -1);
  });
}

function setupContextMenu() {
  var menu = document.getElementById("context-menu");

  // Close menu on outside click
  document.addEventListener("click", function() {
    menu.classList.add("hidden");
  });

  // Prevent context menu from closing itself
  menu.addEventListener("click", function(e) {
    e.stopPropagation();
  });

  // Close on Escape
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      menu.classList.add("hidden");
      document.getElementById("group-context-menu").classList.add("hidden");
      document.getElementById("clear-data-menu").classList.add("hidden");
      groupContextTarget = null;
    }
  });

  // Action handlers
  menu.querySelectorAll(".ctx-item[data-action]").forEach(function(item) {
    item.addEventListener("click", function() {
      var action = item.getAttribute("data-action");
      handleContextAction(action);
      menu.classList.add("hidden");
    });
  });
}

function showContextMenu(e, tab) {
  e.preventDefault();
  e.stopPropagation();

  // Close group context menu if open
  document.getElementById("group-context-menu").classList.add("hidden");
  groupContextTarget = null;

  // If right-clicked tab isn't in selection, select only that tab
  if (selectedTabIds.indexOf(tab.id) === -1) {
    selectedTabIds = [tab.id];
    lastClickedTabId = tab.id;
    updateSelectionVisuals();
  }

  var menu = document.getElementById("context-menu");
  var groupList = document.getElementById("ctx-group-list");
  var groupArrow = document.getElementById("ctx-group-arrow");
  var groupTrigger = document.getElementById("ctx-add-to-group");

  // Reset expand state
  groupList.classList.add("hidden");
  groupArrow.classList.remove("expanded");

  // Update pin label
  var pinItem = menu.querySelector("[data-action=\"pin\"]");
  chrome.tabs.get(tab.id, function(t) {
    pinItem.textContent = t.pinned ? "Unpin" : "Pin";
  });

  // Update pin-in-group label and visibility
  var pinInGroupItem = menu.querySelector("[data-action=\"pin-in-group\"]");
  if (tab.groupId !== -1) {
    pinInGroupItem.style.display = "";
    pinInGroupItem.textContent = isTabPinnedInGroup(tab) ? "Unpin in Group" : "Pin in Group";
  } else {
    pinInGroupItem.style.display = "none";
  }

  // Update mute label
  var muteItem = menu.querySelector("[data-action=\"mute\"]");
  chrome.tabs.get(tab.id, function(t) {
    muteItem.textContent = t.mutedInfo && t.mutedInfo.muted ? "Unmute Site" : "Mute Site";
  });

  // Build group list
  groupList.innerHTML = "";
  chrome.tabGroups.query({ windowId: windowId }, function(groups) {
    var newGroupItem = document.createElement("div");
    newGroupItem.className = "ctx-item";
    newGroupItem.textContent = "New Group";
    newGroupItem.addEventListener("click", function(ev) {
      ev.stopPropagation();
      addSelectionToNewGroup();
      menu.classList.add("hidden");
    });
    groupList.appendChild(newGroupItem);

    if (groups.length > 0) {
      var sep = document.createElement("div");
      sep.className = "ctx-separator";
      groupList.appendChild(sep);
    }
    groups.forEach(function(group) {
      var colorObj = GROUP_COLORS[group.color] || GROUP_COLORS.grey;
      var groupItem = document.createElement("div");
      groupItem.className = "ctx-item";
      groupItem.innerHTML =
        "<span class=\"ctx-group-dot\" style=\"background:" + colorObj.bg + "\"></span>" +
        escapeHTML(group.title || "Unnamed");
      groupItem.addEventListener("click", function(ev) {
        ev.stopPropagation();
        addSelectionToGroup(group.id);
        menu.classList.add("hidden");
      });
      groupList.appendChild(groupItem);
    });

    // Toggle expand on click
    groupTrigger.onclick = function(ev) {
      ev.stopPropagation();
      var isHidden = groupList.classList.toggle("hidden");
      groupArrow.classList.toggle("expanded", !isHidden);
      // Reposition if menu overflows after expanding
      repositionMenu(menu);
    };

    // Position menu
    positionMenu(menu, e.clientX, e.clientY);
  });
}

function positionMenu(menu, x, y) {
  menu.classList.remove("hidden");
  menu.style.left = "0px";
  menu.style.top = "0px";
  var rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
  if (y < 0) y = 4;
  menu.style.left = x + "px";
  menu.style.top = y + "px";
}

function repositionMenu(menu) {
  var rect = menu.getBoundingClientRect();
  var x = rect.left;
  var y = rect.top;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
  if (y < 0) y = 4;
  menu.style.top = y + "px";
}

function handleContextAction(action) {
  var ids = getSelectedTabIds();
  if (ids.length === 0) return;

  switch (action) {
    case "new-tab-below":
      chrome.tabs.get(ids[ids.length - 1], function(t) {
        chrome.tabs.create({ index: t.index + 1 });
      });
      clearSelection();
      break;

    case "move-to-window":
      chrome.windows.create({ tabId: ids[0] }, function(newWin) {
        if (ids.length > 1) {
          var rest = ids.slice(1);
          chrome.tabs.move(rest, { windowId: newWin.id, index: -1 });
        }
      });
      clearSelection();
      break;

    case "reload":
      ids.forEach(function(id) { chrome.tabs.reload(id); });
      break;

    case "duplicate":
      ids.forEach(function(id) { chrome.tabs.duplicate(id); });
      break;

    case "pin":
      chrome.tabs.get(ids[0], function(t) {
        var shouldPin = !t.pinned;
        ids.forEach(function(id) {
          chrome.tabs.update(id, { pinned: shouldPin });
        });
      });
      clearSelection();
      break;

    case "pin-in-group":
      ids.forEach(function(id) {
        chrome.tabs.get(id, function(t) {
          if (t.groupId !== -1) {
            togglePinInGroup(t);
          }
        });
      });
      clearSelection();
      break;

    case "mute":
      chrome.tabs.get(ids[0], function(t) {
        var shouldMute = !(t.mutedInfo && t.mutedInfo.muted);
        ids.forEach(function(id) {
          chrome.tabs.update(id, { muted: shouldMute });
        });
      });
      break;

    case "close":
      chrome.tabs.remove(ids);
      clearSelection();
      break;

    case "close-others":
      chrome.tabs.query({ windowId: windowId, pinned: false }, function(tabs) {
        var toClose = [];
        tabs.forEach(function(t) {
          if (ids.indexOf(t.id) === -1) toClose.push(t.id);
        });
        chrome.tabs.remove(toClose);
      });
      clearSelection();
      break;
  }
}

function addSelectionToNewGroup() {
  var ids = getSelectedTabIds();
  if (ids.length === 0) return;
  chrome.tabs.group({ tabIds: ids }, function(groupId) {
    chrome.tabGroups.update(groupId, { title: "", color: "grey" }, function(group) {
      clearSelection();
      // Wait for refresh to render the new group header, then show the menu
      var onRefreshed = function() {
        var header = document.querySelector(".group-header[data-group-id=\"" + groupId + "\"]");
        if (header) {
          var rect = header.getBoundingClientRect();
          chrome.tabs.query({ groupId: groupId }, function(tabs) {
            showGroupContextMenu(
              { preventDefault: function(){}, stopPropagation: function(){}, clientX: rect.left, clientY: rect.bottom },
              group,
              tabs
            );
          });
        }
      };
      // Small delay to let scheduleRefresh render the DOM
      setTimeout(onRefreshed, 150);
    });
  });
}

function addSelectionToGroup(groupId) {
  var ids = getSelectedTabIds();
  if (ids.length === 0) return;
  chrome.tabs.group({ tabIds: ids, groupId: groupId }, function() {
    clearSelection();
    scheduleRefresh();
  });
}

// ─── Group Context Menu ─────────────────────────────────────

var groupContextTarget = null; // { group, tabs }

function showGroupContextMenu(e, group, tabs) {
  e.preventDefault();
  e.stopPropagation();

  // Close tab context menu if open
  document.getElementById("context-menu").classList.add("hidden");

  groupContextTarget = { group: group, tabs: tabs };

  var menu = document.getElementById("group-context-menu");
  var nameInput = document.getElementById("ctx-group-name-input");
  var colorRow = document.getElementById("ctx-color-row");

  // Set name
  nameInput.value = group.title || "";

  // Build color swatches
  colorRow.innerHTML = "";
  var colorNames = Object.keys(GROUP_COLORS);
  colorNames.forEach(function(colorName) {
    var swatch = document.createElement("div");
    swatch.className = "ctx-color-swatch" + (colorName === group.color ? " active" : "");
    swatch.style.background = GROUP_COLORS[colorName].bg;
    swatch.title = colorName.charAt(0).toUpperCase() + colorName.slice(1);
    swatch.addEventListener("click", function(ev) {
      ev.stopPropagation();
      chrome.tabGroups.update(group.id, { color: colorName }, function() {
        scheduleRefresh();
      });
      colorRow.querySelectorAll(".ctx-color-swatch").forEach(function(s) {
        s.classList.remove("active");
      });
      swatch.classList.add("active");
      groupContextTarget.group.color = colorName;
    });
    colorRow.appendChild(swatch);
  });

  // Name input — apply on Enter or blur
  nameInput.onkeydown = function(ev) {
    ev.stopPropagation();
    if (ev.key === "Enter") {
      chrome.tabGroups.update(group.id, { title: nameInput.value.trim() });
      menu.classList.add("hidden");
      scheduleRefresh();
    } else if (ev.key === "Escape") {
      menu.classList.add("hidden");
    }
  };
  nameInput.onclick = function(ev) { ev.stopPropagation(); };

  // Position and show
  positionMenu(menu, e.clientX, e.clientY);

  // Focus name input after showing
  setTimeout(function() { nameInput.focus(); nameInput.select(); }, 0);
}

function setupGroupContextMenu() {
  var menu = document.getElementById("group-context-menu");

  // Close on outside click
  document.addEventListener("click", function() {
    if (!menu.classList.contains("hidden")) {
      // Apply name change on close
      var nameInput = document.getElementById("ctx-group-name-input");
      if (groupContextTarget) {
        var newName = nameInput.value.trim();
        if (newName !== (groupContextTarget.group.title || "")) {
          chrome.tabGroups.update(groupContextTarget.group.id, { title: newName });
          scheduleRefresh();
        }
      }
      menu.classList.add("hidden");
      groupContextTarget = null;
    }
  });

  menu.addEventListener("click", function(e) {
    e.stopPropagation();
  });

  // Action handlers
  menu.querySelectorAll("[data-group-action]").forEach(function(item) {
    item.addEventListener("click", function(e) {
      e.stopPropagation();
      var action = item.getAttribute("data-group-action");
      handleGroupContextAction(action);
      menu.classList.add("hidden");
      groupContextTarget = null;
    });
  });
}

function handleGroupContextAction(action) {
  if (!groupContextTarget) return;
  var group = groupContextTarget.group;
  var tabs = groupContextTarget.tabs;
  var tabIds = tabs.map(function(t) { return t.id; });

  switch (action) {
    case "new-tab-in-group":
      chrome.tabs.create({ active: true }, function(tab) {
        chrome.tabs.group({ tabIds: [tab.id], groupId: group.id });
      });
      break;

    case "move-group-to-window":
      if (tabIds.length > 0) {
        chrome.windows.create({ tabId: tabIds[0] }, function(newWin) {
          if (tabIds.length > 1) {
            chrome.tabs.move(tabIds.slice(1), { windowId: newWin.id, index: -1 }, function() {
              chrome.tabs.group({ tabIds: tabIds, createProperties: { windowId: newWin.id } }, function(newGroupId) {
                chrome.tabGroups.update(newGroupId, { title: group.title || "", color: group.color });
              });
            });
          } else {
            chrome.tabs.group({ tabIds: tabIds, createProperties: { windowId: newWin.id } }, function(newGroupId) {
              chrome.tabGroups.update(newGroupId, { title: group.title || "", color: group.color });
            });
          }
        });
      }
      break;

    case "ungroup":
      if (tabIds.length > 0) {
        chrome.tabs.ungroup(tabIds, function() { scheduleRefresh(); });
      }
      break;

    case "save-group":
      saveTabGroup(group, tabs);
      break;

    case "close-group":
      closeAndSaveGroup(group, tabs);
      break;

    case "delete-group":
      if (tabIds.length > 0) {
        chrome.tabs.remove(tabIds);
      }
      break;
  }
}

// ─── Saved Groups ───────────────────────────────────────────

function renderSavedGroups() {
  var section = document.getElementById("saved-groups");
  var body = section.querySelector(".section-body");
  var count = section.querySelector(".section-count");
  body.innerHTML = "";
  count.textContent = savedGroups.length || "";

  if (savedGroups.length === 0) {
    body.innerHTML = "<div class=\"empty-message\">Save a tab group using the &#128190; icon</div>";
    return;
  }

  savedGroups.forEach(function(sg, index) {
    var colorObj = GROUP_COLORS[sg.color] || GROUP_COLORS.grey;
    var el = document.createElement("div");
    el.className = "saved-group-item collapsed";
    el.setAttribute("data-saved-index", index);
    el.draggable = true;
    var header = document.createElement("div");
    header.className = "saved-group-header";
    header.innerHTML =
      "<span class=\"saved-group-collapse\">&#9660;</span>" +
      "<span class=\"saved-group-dot\" style=\"background:" + colorObj.bg + "\"></span>" +
      "<span class=\"saved-group-name\">" + escapeHTML(sg.name || "Unnamed") + "</span>" +
      "<span class=\"saved-group-tab-count\">" + sg.urls.length + "</span>" +
      "<span class=\"saved-group-actions\">" +
        "<button class=\"restore-btn\" title=\"Restore group\">&#8634;</button>" +
        "<button class=\"delete-btn\" title=\"Delete\">&#10005;</button>" +
      "</span>";
    el.appendChild(header);

    var urlList = document.createElement("div");
    urlList.className = "saved-group-urls";
    sg.urls.forEach(function(url) {
      var urlEl = document.createElement("div");
      urlEl.className = "saved-group-url";
      var title = "";
      try { title = new URL(url).hostname.replace(/^www\./, ""); } catch(e) { title = url; }
      urlEl.innerHTML = faviconHTMLFromUrl(url) +
        "<span class=\"saved-group-url-title\">" + escapeHTML(title) + "</span>";
      urlList.appendChild(urlEl);
    });
    el.appendChild(urlList);

    header.querySelector(".restore-btn").addEventListener("click", function(e) {
      e.stopPropagation();
      restoreSavedGroup(sg);
    });
    header.querySelector(".delete-btn").addEventListener("click", function(e) {
      e.stopPropagation();
      deleteSavedGroup(index);
    });
    header.addEventListener("click", function(e) {
      if (e.target.closest("button")) return;
      el.classList.toggle("collapsed");
    });

    // Drag-and-drop for saved group reordering
    el.addEventListener("dragstart", function(e) {
      dragData = { type: "saved-group", index: index };
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", function() {
      el.classList.remove("dragging");
      clearDropIndicators();
      dragData = null;
    });
    el.addEventListener("dragover", function(e) {
      if (!dragData || dragData.type !== "saved-group") return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      clearDropIndicators();
      var rect = el.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        el.classList.add("drop-above");
      } else {
        el.classList.add("drop-below");
      }
    });
    el.addEventListener("dragleave", function() { clearDropIndicators(); });
    el.addEventListener("drop", function(e) {
      e.preventDefault();
      e.stopPropagation();
      clearDropIndicators();
      if (!dragData || dragData.type !== "saved-group") return;
      if (dragData.index === index) return;
      var rect = el.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      var targetIndex = e.clientY < midY ? index : index + 1;
      var fromIndex = dragData.index;
      var item = savedGroups.splice(fromIndex, 1)[0];
      if (targetIndex > fromIndex) targetIndex--;
      savedGroups.splice(targetIndex, 0, item);
      chrome.storage.local.set(makeObj(STORAGE_KEYS.savedGroups, savedGroups));
      renderSavedGroups();
    });

    body.appendChild(el);
  });
  attachFaviconErrorHandlers(body);
}

function saveTabGroup(group, tabs) {
  var urls = tabs.map(function(t) { return t.url; });

  // Set home URLs for all tabs in the group so restore can navigate them back
  tabs.forEach(function(t) {
    tabHomes[t.id] = t.url;
  });
  // Persist with the group tabs (enough context for these entries)
  chrome.tabs.query({ windowId: windowId }, function(allTabs) {
    persistHomeEntries(allTabs);
  });

  // Update if already saved with same name and color
  var existingIndex = -1;
  for (var i = 0; i < savedGroups.length; i++) {
    if (savedGroups[i].name === (group.title || "Unnamed") && savedGroups[i].color === (group.color || "grey")) {
      existingIndex = i;
      break;
    }
  }

  var entry = {
    name: group.title || "Unnamed",
    color: group.color || "grey",
    urls: urls,
    savedAt: Date.now()
  };

  if (existingIndex >= 0) {
    savedGroups[existingIndex] = entry;
  } else {
    savedGroups.push(entry);
  }

  chrome.storage.local.set(makeObj(STORAGE_KEYS.savedGroups, savedGroups));
  scheduleRefresh();
}

function restoreSavedGroup(sg) {
  // Check if a group with the same name and color already exists
  chrome.tabGroups.query({ windowId: windowId }, function(groups) {
    var existing = null;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].title === sg.name && groups[i].color === sg.color) {
        existing = groups[i];
        break;
      }
    }

    if (existing) {
      // Group already open — move to front, expand, activate first tab, then tidy
      chrome.tabGroups.update(existing.id, { collapsed: false });
      chrome.tabs.query({ groupId: existing.id }, function(tabs) {
        if (tabs.length > 0) {
          // Move group tabs to the start (after pinned tabs)
          var moveIds = tabs.map(function(t) { return t.id; });
          chrome.tabs.move(moveIds, { index: 0 }, function() {
            chrome.tabs.update(moveIds[0], { active: true }, function() {
              chrome.runtime.sendMessage({ action: "tidy-tab-bar", windowId: windowId });
            });
          });
        }
      });
      collapsedGroups[existing.id] = false;
      chrome.storage.local.set(makeObj(STORAGE_KEYS.collapsedGroups, collapsedGroups));
      scheduleRefresh();
      return;
    }

    // Not open — create the tabs at the front and group them
    var tabIds = [];
    var remaining = sg.urls.length;
    sg.urls.forEach(function(url, i) {
      chrome.tabs.create({ url: url, active: false, index: i }, function(tab) {
        tabIds.push(tab.id);
        remaining--;
        if (remaining === 0) {
          chrome.tabs.group({ tabIds: tabIds }, function(groupId) {
            chrome.tabGroups.update(groupId, {
              title: sg.name,
              color: sg.color
            });
            // Activate first tab and tidy
            chrome.tabs.update(tabIds[0], { active: true }, function() {
              chrome.runtime.sendMessage({ action: "tidy-tab-bar", windowId: windowId });
            });
            scheduleRefresh();
          });
        }
      });
    });
  });
}

function findSavedGroup(group) {
  var name = group.title || "Unnamed";
  var color = group.color || "grey";
  for (var i = 0; i < savedGroups.length; i++) {
    if (savedGroups[i].name === name && savedGroups[i].color === color) {
      return savedGroups[i];
    }
  }
  return null;
}

function restoreGroupSnapshot(group) {
  var sg = findSavedGroup(group);
  if (!sg) return;

  chrome.tabs.query({ groupId: group.id }, function(currentTabs) {
    // Step 1: Navigate any tabs with a home URL back home
    var savedUrlSet = {};
    sg.urls.forEach(function(url) { savedUrlSet[url] = true; });

    var tabsToNavigate = [];

    currentTabs.forEach(function(tab) {
      var homeUrl = tabHomes[tab.id];
      if (homeUrl && savedUrlSet[homeUrl] && tab.url !== homeUrl) {
        tabsToNavigate.push({ id: tab.id, url: homeUrl });
      }
    });

    if (tabsToNavigate.length === 0) {
      restoreGroupSnapshotStep2(group, sg);
      return;
    }

    // Navigate tabs home and wait for them to complete loading
    var loadedCount = 0;
    var targetCount = tabsToNavigate.length;

    function onTabUpdated(tabId, changeInfo) {
      if (changeInfo.url) {
        // Check if this is one of our tabs
        for (var i = 0; i < tabsToNavigate.length; i++) {
          if (tabsToNavigate[i].id === tabId) {
            loadedCount++;
            if (loadedCount >= targetCount) {
              chrome.tabs.onUpdated.removeListener(onTabUpdated);
              restoreGroupSnapshotStep2(group, sg);
            }
            return;
          }
        }
      }
    }

    chrome.tabs.onUpdated.addListener(onTabUpdated);

    tabsToNavigate.forEach(function(t) {
      chrome.tabs.update(t.id, { url: t.url });
    });
  });
}

function restoreGroupSnapshotStep2(group, sg) {
  chrome.tabs.query({ groupId: group.id }, function(currentTabs) {
    // Find which saved URLs are still missing
    // Match by exact URL or by tabHomes (tab navigated away but originally was this URL)
    var matchedTabIds = {};
    var missingUrls = [];

    sg.urls.forEach(function(url) {
      var found = false;
      for (var i = 0; i < currentTabs.length; i++) {
        if (matchedTabIds[currentTabs[i].id]) continue;
        if (currentTabs[i].url === url || tabHomes[currentTabs[i].id] === url) {
          matchedTabIds[currentTabs[i].id] = true;
          found = true;
          break;
        }
      }
      if (!found) missingUrls.push(url);
    });

    if (missingUrls.length === 0) {
      reorderGroupToSnapshot(group, sg, currentTabs);
      return;
    }

    // Create only the truly missing tabs at the top of the group
    var groupStartIndex = Math.min.apply(null, currentTabs.map(function(t) { return t.index; }));
    var newTabIds = [];
    var remaining = missingUrls.length;

    missingUrls.forEach(function(url, i) {
      chrome.tabs.create({ url: url, active: false, index: groupStartIndex + i }, function(tab) {
        newTabIds.push(tab.id);
        remaining--;
        if (remaining === 0) {
          chrome.tabs.group({ tabIds: newTabIds, groupId: group.id }, function() {
            chrome.tabs.query({ groupId: group.id }, function(updatedTabs) {
              reorderGroupToSnapshot(group, sg, updatedTabs);
            });
          });
        }
      });
    });
  });
}

function reorderGroupToSnapshot(group, sg, currentTabs) {
  var groupStartIndex = Math.min.apply(null, currentTabs.map(function(t) { return t.index; }));

  // Build order: saved URLs first (in saved order), then non-saved tabs
  var orderedIds = [];
  var usedIds = {};

  sg.urls.forEach(function(url) {
    for (var i = 0; i < currentTabs.length; i++) {
      if (currentTabs[i].url === url && !usedIds[currentTabs[i].id]) {
        orderedIds.push(currentTabs[i].id);
        usedIds[currentTabs[i].id] = true;
        break;
      }
    }
  });

  // Append tabs not in the snapshot (user-added)
  currentTabs.forEach(function(t) {
    if (!usedIds[t.id]) orderedIds.push(t.id);
  });

  if (orderedIds.length === 0) return;

  // Move sequentially to preserve order
  var moveIndex = 0;
  function moveNext() {
    if (moveIndex >= orderedIds.length) {
      scheduleRefresh();
      return;
    }
    chrome.tabs.move(orderedIds[moveIndex], { index: groupStartIndex + moveIndex }, function() {
      moveIndex++;
      moveNext();
    });
  }
  moveNext();
}

function closeAndSaveGroup(group, tabs) {
  saveTabGroup(group, tabs);
  var tabIds = tabs.map(function(t) { return t.id; });
  if (tabIds.length > 0) {
    chrome.tabs.remove(tabIds);
  }
}

function deleteSavedGroup(index) {
  savedGroups.splice(index, 1);
  chrome.storage.local.set(makeObj(STORAGE_KEYS.savedGroups, savedGroups));
  renderSavedGroups();
}

// ─── Bookmarks Toolbar ──────────────────────────────────────

function setupBookmarksToolbar() {
  document.getElementById("bookmarks-collapse-all").addEventListener("click", function() {
    document.querySelectorAll("#bookmarks-content .bookmark-folder").forEach(function(folder) {
      folder.classList.add("collapsed");
    });
    expandedBookmarks = {};
    chrome.storage.local.set(makeObj(STORAGE_KEYS.expandedBookmarks, expandedBookmarks));
  });
}

// ─── Bookmarks ──────────────────────────────────────────────

function renderBookmarks() {
  var container = document.getElementById("bookmarks-content");
  container.innerHTML = "";

  // Get Bookmarks Bar (id "1")
  chrome.bookmarks.getSubTree("1", function(results) {
    if (!results || !results[0]) return;
    var children = results[0].children || [];
    renderBookmarkNodes(children, container, 0);
    attachFaviconErrorHandlers(container);
  });
}

function renderBookmarkNodes(nodes, container, depth) {
  nodes.forEach(function(node) {
    if (node.url) {
      var el = document.createElement("div");
      el.className = "bookmark-item";
      if (depth > 0) el.style.paddingLeft = (22 + depth * 14) + "px";
      el.innerHTML =
        faviconHTMLFromUrl(node.url) +
        "<span class=\"bookmark-title\">" + escapeHTML(node.title || node.url) + "</span>";
      el.addEventListener("click", function() {
        chrome.tabs.create({ url: node.url });
      });
      container.appendChild(el);
    } else if (node.children) {
      var folder = document.createElement("div");
      folder.className = "bookmark-folder";
      if (!expandedBookmarks[node.id]) folder.classList.add("collapsed");
      if (depth > 0) folder.style.paddingLeft = (depth * 14) + "px";

      var header = document.createElement("div");
      header.className = "bookmark-folder-header";
      header.innerHTML =
        "<span class=\"bookmark-folder-arrow\">&#9660;</span>" +
        "<span class=\"bookmark-folder-icon\">&#128193;</span>" +
        "<span>" + escapeHTML(node.title || "Folder") + "</span>";

      var childContainer = document.createElement("div");
      childContainer.className = "bookmark-folder-children";

      (function(nodeId) {
        header.addEventListener("click", function() {
          folder.classList.toggle("collapsed");
          if (folder.classList.contains("collapsed")) {
            delete expandedBookmarks[nodeId];
          } else {
            expandedBookmarks[nodeId] = true;
          }
          chrome.storage.local.set(makeObj(STORAGE_KEYS.expandedBookmarks, expandedBookmarks));
        });
      })(node.id);

      folder.appendChild(header);
      folder.appendChild(childContainer);
      container.appendChild(folder);

      renderBookmarkNodes(node.children, childContainer, depth + 1);
    }
  });
}

// ─── Recently Closed ────────────────────────────────────────

function renderRecentlyClosed() {
  var container = document.getElementById("history-content");
  container.innerHTML = "";

  chrome.sessions.getRecentlyClosed({ maxResults: 25 }, function(sessions) {
    var items = [];
    (sessions || []).forEach(function(session) {
      if (session.tab) {
        items.push(session.tab);
      } else if (session.window && session.window.tabs) {
        session.window.tabs.forEach(function(t) { items.push(t); });
      }
    });

    if (items.length === 0) {
      container.innerHTML = "<div class=\"empty-message\">No recently closed tabs</div>";
      return;
    }

    items.forEach(function(tab) {
      var el = document.createElement("div");
      el.className = "recent-item";
      el.innerHTML =
        faviconHTMLFromUrl(tab.url || "") +
        "<span class=\"recent-title\" title=\"" + escapeAttr(tab.url || "") + "\">" +
          escapeHTML(tab.title || tab.url || "Untitled") +
        "</span>";
      el.addEventListener("click", function() {
        if (tab.sessionId) {
          chrome.sessions.restore(tab.sessionId);
        } else {
          chrome.tabs.create({ url: tab.url });
        }
      });
      container.appendChild(el);
    });
    attachFaviconErrorHandlers(container);
  });
}

// ─── Drag & Drop — Tabs ────────────────────────────────────

function handleTabDragOver(e, el) {
  if (!dragData || dragData.type !== "tab") return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  clearDropIndicators();
  var rect = el.getBoundingClientRect();
  var midY = rect.top + rect.height / 2;
  if (e.clientY < midY) {
    el.classList.add("drop-above");
  } else {
    el.classList.add("drop-below");
  }
}

function handleTabDrop(e, targetTab) {
  e.preventDefault();
  e.stopPropagation();
  clearDropIndicators();
  if (!dragData || dragData.type !== "tab") return;
  if (dragData.tabId === targetTab.id) return;

  var tabId = dragData.tabId;
  var rect = e.currentTarget.getBoundingClientRect();
  var midY = rect.top + rect.height / 2;
  var insertBefore = e.clientY < midY;
  var targetIndex = insertBefore ? targetTab.index : targetTab.index + 1;

  chrome.tabs.move(tabId, { index: targetIndex }, function() {
    if (targetTab.groupId !== -1) {
      chrome.tabs.group({ tabIds: [tabId], groupId: targetTab.groupId }, function() {
        scheduleRefresh();
      });
    } else if (dragData.groupId !== -1) {
      chrome.tabs.ungroup([tabId], function() {
        scheduleRefresh();
      });
    } else {
      scheduleRefresh();
    }
  });
}

function handleTabListDragOver(e, listEl) {
  if (!dragData || dragData.type !== "tab") return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  if (e.target === listEl || e.target.classList.contains("empty-message")) {
    listEl.classList.add("drop-target");
  }
}

function handleTabListDrop(e, targetGroupId) {
  e.preventDefault();
  clearDropIndicators();
  if (!dragData || dragData.type !== "tab") return;

  var tabId = dragData.tabId;

  if (targetGroupId === -1) {
    chrome.tabs.ungroup([tabId], function() { scheduleRefresh(); });
  } else {
    chrome.tabs.group({ tabIds: [tabId], groupId: targetGroupId }, function() {
      scheduleRefresh();
    });
  }
}

// ─── Drag & Drop — Groups ──────────────────────────────────

function handleGroupDragOver(e, header) {
  if (!dragData || dragData.type !== "group") return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  clearDropIndicators();
  var rect = header.getBoundingClientRect();
  var midY = rect.top + rect.height / 2;
  if (e.clientY < midY) {
    header.classList.add("drop-above");
  } else {
    header.classList.add("drop-below");
  }
}

function handleGroupDrop(e, targetGroup) {
  e.preventDefault();
  e.stopPropagation();
  clearDropIndicators();
  if (!dragData || dragData.type !== "group") return;
  if (dragData.groupId === targetGroup.id) return;

  var movedGroupId = dragData.groupId;
  var rect = e.currentTarget.getBoundingClientRect();
  var midY = rect.top + rect.height / 2;
  var dropAbove = e.clientY < midY;

  // tabGroups.move uses tab indices, not group indices
  // Get the first tab of the target group to determine position
  chrome.tabs.query({ windowId: windowId }, function(allTabs) {
    var targetGroupTabs = allTabs.filter(function(t) { return t.groupId === targetGroup.id; });
    if (targetGroupTabs.length === 0) return;

    var targetIndex;
    if (dropAbove) {
      targetIndex = targetGroupTabs[0].index;
    } else {
      targetIndex = targetGroupTabs[targetGroupTabs.length - 1].index + 1;
    }

    chrome.tabGroups.move(movedGroupId, { index: targetIndex }, function() {
      void chrome.runtime.lastError; // Suppress intermittent index errors
      scheduleRefresh();
    });
  });
}

function clearDropIndicators() {
  document.querySelectorAll(".drop-above, .drop-below, .drop-target, .drop-left, .drop-right").forEach(function(el) {
    el.classList.remove("drop-above", "drop-below", "drop-target", "drop-left", "drop-right");
  });
}

// ─── Tab Actions ────────────────────────────────────────────

function activateTab(tabId) {
  chrome.tabs.update(tabId, { active: true });
}

function closeTab(tabId) {
  chrome.tabs.remove(tabId);
}

// ─── Rename ─────────────────────────────────────────────────

function startRename(tab, titleEl) {
  var container = document.getElementById("rename-input-container");
  var input = document.getElementById("rename-input");
  var rect = titleEl.getBoundingClientRect();

  container.classList.remove("hidden");
  container.style.top = rect.top + "px";
  container.style.left = rect.left + "px";
  container.style.width = rect.width + "px";

  input.value = getTabDisplayName(tab);
  input.focus();
  input.select();

  function finish(save) {
    container.classList.add("hidden");
    input.removeEventListener("keydown", onKey);
    input.removeEventListener("blur", onBlur);
    if (save) {
      var newName = input.value.trim();
      if (newName && newName !== tab.title) {
        customNames[tab.url] = newName;
        tabHomes[tab.id] = tab.url;
      } else {
        delete customNames[tab.url];
        delete tabHomes[tab.id];
      }
      chrome.storage.local.set(makeObj(STORAGE_KEYS.customNames, customNames));
      scheduleRefresh();
    }
  }

  function onKey(e) {
    if (e.key === "Enter") { finish(true); }
    else if (e.key === "Escape") { finish(false); }
  }

  function onBlur() { finish(true); }

  input.addEventListener("keydown", onKey);
  input.addEventListener("blur", onBlur);
}

function getTabDisplayName(tab) {
  // If this tab has a home URL, show the custom name for the home
  var homeUrl = tabHomes[tab.id];
  if (homeUrl && customNames[homeUrl]) {
    return customNames[homeUrl];
  }
  return customNames[tab.url] || tab.title || tab.url || "New Tab";
}

function getTabHomeUrl(tab) {
  var homeUrl = tabHomes[tab.id];
  if (homeUrl && tab.url !== homeUrl) {
    return homeUrl;
  }
  return null;
}

// ─── Tab Home Persistence ───────────────────────────────────

function rebuildTabHomes(tabs) {
  // Prune stale tab IDs
  var currentIds = {};
  tabs.forEach(function(t) { currentIds[t.id] = true; });
  Object.keys(tabHomes).forEach(function(id) {
    if (!currentIds[id]) delete tabHomes[id];
  });

  // Direct match: tabs sitting on a custom-named URL
  tabs.forEach(function(tab) {
    if (!tabHomes[tab.id] && customNames[tab.url]) {
      tabHomes[tab.id] = tab.url;
    }
  });

  // Recovery: match orphaned homes to tabs using homeEntries
  var claimedHomes = {};
  Object.keys(tabHomes).forEach(function(id) {
    claimedHomes[tabHomes[id]] = true;
  });

  homeEntries.forEach(function(entry) {
    if (claimedHomes[entry.homeUrl]) return;
    // Try matching by lastTabUrl
    for (var i = 0; i < tabs.length; i++) {
      if (!tabHomes[tabs[i].id] && tabs[i].url === entry.lastTabUrl) {
        tabHomes[tabs[i].id] = entry.homeUrl;
        claimedHomes[entry.homeUrl] = true;
        break;
      }
    }
  });

  // Persist: always save with actual current tab URLs
  persistHomeEntries(tabs);
}

function persistHomeEntries(tabs) {
  var entries = [];
  Object.keys(tabHomes).forEach(function(tabId) {
    var homeUrl = tabHomes[tabId];
    var currentUrl = homeUrl;
    for (var i = 0; i < tabs.length; i++) {
      if (String(tabs[i].id) === String(tabId)) {
        currentUrl = tabs[i].url;
        break;
      }
    }
    entries.push({ homeUrl: homeUrl, lastTabUrl: currentUrl });
  });
  homeEntries = entries;
  chrome.storage.local.set(makeObj(STORAGE_KEYS.tabHomes, homeEntries));
}

// ─── Group Management ───────────────────────────────────────

function startGroupRename(group, titleEl) {
  var container = document.getElementById("rename-input-container");
  var input = document.getElementById("rename-input");
  var rect = titleEl.getBoundingClientRect();

  container.classList.remove("hidden");
  container.style.top = rect.top + "px";
  container.style.left = rect.left + "px";
  container.style.width = rect.width + "px";

  input.value = group.title || "";
  input.focus();
  input.select();

  function finish(save) {
    container.classList.add("hidden");
    input.removeEventListener("keydown", onKey);
    input.removeEventListener("blur", onBlur);
    if (save) {
      var newName = input.value.trim();
      chrome.tabGroups.update(group.id, { title: newName });
      scheduleRefresh();
    }
  }

  function onKey(e) {
    if (e.key === "Enter") { finish(true); }
    else if (e.key === "Escape") { finish(false); }
  }

  function onBlur() { finish(true); }

  input.addEventListener("keydown", onKey);
  input.addEventListener("blur", onBlur);
}

// ─── Pinned in Group ────────────────────────────────────────

function isTabPinnedInGroup(tab) {
  return tab.groupId !== -1 && pinnedInGroupIds[tab.id] === true;
}

function togglePinInGroup(tab) {
  if (pinnedInGroupIds[tab.id]) {
    delete pinnedInGroupIds[tab.id];
  } else {
    pinnedInGroupIds[tab.id] = true;
  }
  persistPinnedInGroup();
  // Move pinned tabs to the start of their group
  enforcePinnedPosition(tab.groupId);
  scheduleRefresh();
}

function persistPinnedInGroup() {
  var ids = Object.keys(pinnedInGroupIds);
  if (ids.length === 0) {
    pinnedInGroupEntries = [];
    chrome.storage.local.set(makeObj(STORAGE_KEYS.pinnedInGroup, pinnedInGroupEntries));
    return;
  }
  // Collect current URLs for cross-restart recovery
  var entries = [];
  var remaining = ids.length;
  ids.forEach(function(tabId) {
    chrome.tabs.get(parseInt(tabId, 10), function(tab) {
      if (!chrome.runtime.lastError && tab) {
        entries.push({ url: tab.url, groupId: tab.groupId });
      }
      remaining--;
      if (remaining === 0) {
        pinnedInGroupEntries = entries;
        chrome.storage.local.set(makeObj(STORAGE_KEYS.pinnedInGroup, pinnedInGroupEntries));
      }
    });
  });
}

function rebuildPinnedInGroupIds(tabs) {
  // Prune stale tab IDs
  var currentIds = {};
  tabs.forEach(function(t) { currentIds[t.id] = true; });
  Object.keys(pinnedInGroupIds).forEach(function(id) {
    if (!currentIds[id]) delete pinnedInGroupIds[id];
  });

  // Recovery: if pinnedInGroupIds is empty but we have persisted entries, try to match
  if (Object.keys(pinnedInGroupIds).length === 0 && pinnedInGroupEntries.length > 0) {
    var claimed = {};
    pinnedInGroupEntries.forEach(function(entry) {
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        if (!claimed[t.id] && t.groupId !== -1 && t.url === entry.url) {
          pinnedInGroupIds[t.id] = true;
          claimed[t.id] = true;
          break;
        }
      }
    });
  }
}

function enforcePinnedPosition(groupId) {
  chrome.tabs.query({ windowId: windowId }, function(allTabs) {
    var groupTabs = allTabs.filter(function(t) { return t.groupId === groupId; });
    if (groupTabs.length === 0) return;

    // Find the first index in this group
    var firstIndex = groupTabs[0].index;

    // Collect pinned tabs that are not already at the front
    var pinnedTabsInGroup = groupTabs.filter(function(t) {
      return pinnedInGroupIds[t.id] === true;
    });

    // Move each pinned tab to the front of the group, in order
    var moveIndex = firstIndex;
    pinnedTabsInGroup.forEach(function(tab) {
      if (tab.index !== moveIndex) {
        chrome.tabs.move(tab.id, { index: moveIndex });
      }
      moveIndex++;
    });
  });
}

// ─── Clear Site Data ────────────────────────────────────────

function getActiveTabOrigin(callback) {
  chrome.tabs.query({ active: true, windowId: windowId }, function(tabs) {
    if (tabs.length === 0) return callback(null, null);
    var tab = tabs[0];
    try {
      var url = new URL(tab.url);
      callback(url.origin, tab.id);
    } catch(e) {
      callback(null, null);
    }
  });
}

function clearSiteData(options) {
  var defaults = {
    cache: true,
    cacheStorage: true,
    cookies: true,
    indexedDB: true,
    localStorage: true,
    sessionStorage: true
  };
  var opts = options || defaults;

  getActiveTabOrigin(function(origin, tabId) {
    if (!origin || !tabId) return;

    // Visual feedback
    var btn = document.getElementById("toolbar-clear-data");
    if (btn) {
      btn.classList.add("clearing");
      btn.innerHTML = "&#10003;";
      setTimeout(function() {
        btn.classList.remove("clearing");
        btn.innerHTML = "<span class='clear-icon-cookie'>&#127850;</span><span class='clear-icon-trash'>&#9940;</span>";
      }, 800);
    }

    var pending = 0;
    var done = function() {
      pending--;
      if (pending === 0) {
        chrome.tabs.reload(tabId);
      }
    };

    // Cookies — use chrome.cookies API to remove ALL cookies for the domain
    // regardless of path (browsingData.remove may miss path-scoped cookies)
    if (opts.cookies) {
      pending++;
      var url = new URL(origin);
      chrome.cookies.getAll({ domain: url.hostname }, function(cookies) {
        if (!cookies || cookies.length === 0) { done(); return; }
        var cookiePending = cookies.length;
        var cookieDone = function() {
          cookiePending--;
          if (cookiePending === 0) done();
        };
        cookies.forEach(function(cookie) {
          var protocol = cookie.secure ? "https://" : "http://";
          var cookieUrl = protocol + cookie.domain.replace(/^\./, "") + cookie.path;
          chrome.cookies.remove({ url: cookieUrl, name: cookie.name }, cookieDone);
        });
      });
    }

    // Origin-scoped data via browsingData API
    var browsingDataTypes = {};
    if (opts.localStorage) browsingDataTypes.localStorage = true;
    if (opts.cacheStorage) browsingDataTypes.cacheStorage = true;
    if (opts.indexedDB) browsingDataTypes.indexedDB = true;

    if (Object.keys(browsingDataTypes).length > 0) {
      pending++;
      chrome.browsingData.remove({ origins: [origin] }, browsingDataTypes, done);
    }

    // Cache is global (not origin-scoped in browsingData API)
    if (opts.cache) {
      pending++;
      chrome.browsingData.removeCache({}, done);
    }

    // Session storage via scripting (not in browsingData API)
    if (opts.sessionStorage) {
      pending++;
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function() { sessionStorage.clear(); }
      }, function() {
        void chrome.runtime.lastError;
        done();
      });
    }

    // If nothing was selected, just reload
    if (pending === 0) {
      chrome.tabs.reload(tabId);
    }
  });
}

function showClearDataMenu(e) {
  // Close other menus
  document.getElementById("context-menu").classList.add("hidden");
  document.getElementById("group-context-menu").classList.add("hidden");

  var menu = document.getElementById("clear-data-menu");
  var list = document.getElementById("clear-data-list");
  var header = menu.querySelector(".ctx-clear-header");
  list.innerHTML = "";

  getActiveTabOrigin(function(origin, tabId) {
    if (!origin || !tabId) return;

    // Set header to show the origin
    try {
      header.textContent = new URL(origin).host;
    } catch(err) {
      header.textContent = "Clear Site Data";
    }

    var sections = [
      { key: "cache", label: "Cache", icon: "" },
      { key: "cacheStorage", label: "Cache Storage", icon: "" },
      { key: "cookies", label: "Cookies", icon: "" },
      { key: "indexedDB", label: "IndexedDB", icon: "" },
      { key: "localStorage", label: "Local Storage", icon: "" },
      { key: "sessionStorage", label: "Session Storage", icon: "" }
    ];

    // Track how many async queries are outstanding
    // 4 callbacks: cookies, scripting (localStorage+sessionStorage), cacheStorage, indexedDB
    var remaining = 4;
    var siteData = {
      cache: null,
      cacheStorage: [],
      cookies: [],
      indexedDB: [],
      localStorage: [],
      sessionStorage: []
    };

    var renderAll = function() {
      list.innerHTML = "";
      sections.forEach(function(sec) {
        var section = document.createElement("div");
        section.className = "ctx-clear-section";

        var items = siteData[sec.key];
        var countText = "";
        if (sec.key === "cache") {
          countText = "global";
        } else if (items) {
          countText = items.length.toString();
        }

        var headerEl = document.createElement("label");
        headerEl.className = "ctx-clear-section-header";
        var countDisplay = sec.key === "cache" ? "global" : (items ? items.length.toString() : "0");
        headerEl.innerHTML =
          "<input type=\"checkbox\" data-clear=\"" + sec.key + "\" checked />" +
          "<span class=\"ctx-clear-label\">" + escapeHTML(sec.label) + "</span>" +
          "<span class=\"ctx-clear-count\">(" + countDisplay + ")</span>" +
          "<span class=\"ctx-clear-arrow\">&#9656;</span>";
        section.appendChild(headerEl);

        // Details list — collapsed by default
        var details = document.createElement("div");
        details.className = "ctx-clear-details collapsed";

        if (sec.key === "cache") {
          var note = document.createElement("div");
          note.className = "ctx-clear-detail";
          note.textContent = "HTTP cache (all sites)";
          details.appendChild(note);
        } else if (items && items.length > 0) {
          var maxShow = 15;
          var shown = items.slice(0, maxShow);
          shown.forEach(function(name) {
            var detail = document.createElement("div");
            detail.className = "ctx-clear-detail";
            detail.textContent = name;
            detail.title = name;
            details.appendChild(detail);
          });
          if (items.length > maxShow) {
            var more = document.createElement("div");
            more.className = "ctx-clear-detail";
            more.textContent = "+" + (items.length - maxShow) + " more";
            details.appendChild(more);
          }
        } else {
          var empty = document.createElement("div");
          empty.className = "ctx-clear-empty";
          empty.textContent = "None";
          details.appendChild(empty);
        }

        section.appendChild(details);

        // Click header to expand/collapse details (but not checkbox clicks)
        headerEl.addEventListener("click", function(e) {
          if (e.target.tagName === "INPUT") return;
          e.preventDefault();
          details.classList.toggle("collapsed");
          var arrow = headerEl.querySelector(".ctx-clear-arrow");
          if (arrow) arrow.classList.toggle("expanded");
        });
        list.appendChild(section);
      });

      // Reposition after content renders
      repositionMenu(menu);
    };

    var onQueryDone = function() {
      remaining--;
      if (remaining <= 0) renderAll();
    };

    // Query cookies
    try {
      var url = new URL(origin);
      chrome.cookies.getAll({ domain: url.hostname }, function(cookies) {
        siteData.cookies = (cookies || []).map(function(c) { return c.name; });
        onQueryDone();
      });
    } catch(err) {
      onQueryDone();
    }

    // Query cacheStorage, localStorage, sessionStorage via scripting
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function() {
        var result = { cacheStorage: [], localStorage: [], sessionStorage: [] };
        try { result.localStorage = Object.keys(localStorage); } catch(e) {}
        try { result.sessionStorage = Object.keys(sessionStorage); } catch(e) {}
        return result;
      }
    }, function(results) {
      if (!chrome.runtime.lastError && results && results[0] && results[0].result) {
        var r = results[0].result;
        siteData.localStorage = r.localStorage || [];
        siteData.sessionStorage = r.sessionStorage || [];
      }
      onQueryDone();

      // cacheStorage needs a separate async call inside the page
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function() {
          return caches.keys().then(function(names) { return names; });
        }
      }, function(cacheResults) {
        if (!chrome.runtime.lastError && cacheResults && cacheResults[0] && cacheResults[0].result) {
          siteData.cacheStorage = cacheResults[0].result;
        }
        onQueryDone();
      });
    });

    // Query indexedDB database names via scripting
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function() {
        return indexedDB.databases().then(function(dbs) {
          return dbs.map(function(db) { return db.name; });
        });
      }
    }, function(idbResults) {
      if (!chrome.runtime.lastError && idbResults && idbResults[0] && idbResults[0].result) {
        siteData.indexedDB = idbResults[0].result;
      }
      onQueryDone();
    });

    positionMenu(menu, 4, e.clientY);
  });
}

function setupClearDataMenu() {
  var menu = document.getElementById("clear-data-menu");

  document.addEventListener("click", function() {
    menu.classList.add("hidden");
  });

  menu.addEventListener("click", function(e) {
    e.stopPropagation();
  });

  document.getElementById("clear-data-close").addEventListener("click", function() {
    menu.classList.add("hidden");
  });

  document.getElementById("ctx-clear-selected").addEventListener("click", function() {
    var opts = {};
    menu.querySelectorAll("input[data-clear]").forEach(function(cb) {
      opts[cb.getAttribute("data-clear")] = cb.checked;
    });
    clearSiteData(opts);
    menu.classList.add("hidden");
  });
}

// ─── Toolbar ────────────────────────────────────────────────

function setupToolbar() {
  // Clear site data button
  var clearBtn = document.getElementById("toolbar-clear-data");
  clearBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    showClearDataMenu(e);
  });
  clearBtn.addEventListener("contextmenu", function(e) {
    e.preventDefault();
    e.stopPropagation();
  });

  // Tidy tab bar button — also collapse sidebar groups
  document.getElementById("tidy-tab-bar").addEventListener("click", function() {
    chrome.runtime.sendMessage({ action: "tidy-tab-bar", windowId: windowId });
    // Collapse all sidebar groups
    document.querySelectorAll(".tab-group:not(.collapsed)").forEach(function(groupEl) {
      var groupId = parseInt(groupEl.getAttribute("data-group-id"), 10);
      if (!isNaN(groupId)) {
        groupEl.classList.add("collapsed");
        collapsedGroups[groupId] = true;
      }
    });
    chrome.storage.local.set(makeObj(STORAGE_KEYS.collapsedGroups, collapsedGroups));
    // Collapse all expanded saved groups
    document.querySelectorAll(".saved-group-item:not(.collapsed)").forEach(function(el) {
      el.classList.add("collapsed");
    });
  });

  // Merge duplicates button
  document.getElementById("merge-duplicates").addEventListener("click", function() {
    mergeDuplicateGroups();
  });

  // Close all ungrouped tabs
  document.getElementById("close-ungrouped").addEventListener("click", function(e) {
    e.stopPropagation();
    chrome.tabs.query({ windowId: windowId }, function(tabs) {
      var ungroupedIds = tabs.filter(function(t) {
        return !t.pinned && t.groupId === -1;
      }).map(function(t) { return t.id; });
      if (ungroupedIds.length > 0) {
        chrome.tabs.remove(ungroupedIds);
      }
    });
  });
}

function mergeDuplicateGroups() {
  // Get all tabs and groups in one go to avoid async races
  chrome.tabs.query({ windowId: windowId }, function(allTabs) {
    if (chrome.runtime.lastError) return;
    chrome.tabGroups.query({ windowId: windowId }, function(groups) {
      if (chrome.runtime.lastError) return;

      // Build a map of groupId → tabs
      var tabsByGroup = {};
      allTabs.forEach(function(tab) {
        if (tab.groupId === -1) return;
        if (!tabsByGroup[tab.groupId]) tabsByGroup[tab.groupId] = [];
        tabsByGroup[tab.groupId].push(tab);
      });

      // Group chrome groups by name+color key
      var groupMap = {};
      groups.forEach(function(group) {
        var key = (group.title || "") + ":" + (group.color || "grey");
        if (!groupMap[key]) groupMap[key] = [];
        groupMap[key].push(group);
      });

      var tabsToClose = [];
      var tabsToMove = []; // {tabId, groupId}

      Object.keys(groupMap).forEach(function(key) {
        var dupes = groupMap[key];
        if (dupes.length <= 1) return;

        // Keep the first group, merge the rest into it
        var keepGroup = dupes[0];
        var keepTabs = tabsByGroup[keepGroup.id] || [];
        var keepUrls = {};
        keepTabs.forEach(function(t) { keepUrls[t.url] = true; });

        for (var i = 1; i < dupes.length; i++) {
          var dupeTabs = tabsByGroup[dupes[i].id] || [];
          dupeTabs.forEach(function(t) {
            if (keepUrls[t.url]) {
              // Duplicate URL — close it
              tabsToClose.push(t.id);
            } else {
              // Unique URL — move it to the keep group
              tabsToMove.push({ tabId: t.id, groupId: keepGroup.id });
              keepUrls[t.url] = true;
            }
          });
        }
      });

      // Also close duplicate URLs within the same group
      Object.keys(tabsByGroup).forEach(function(groupId) {
        var tabs = tabsByGroup[groupId];
        var seen = {};
        tabs.forEach(function(t) {
          if (seen[t.url]) {
            tabsToClose.push(t.id);
          } else {
            seen[t.url] = true;
          }
        });
      });

      // Close ungrouped tabs whose URL already exists in a group
      var allGroupedUrls = {};
      Object.keys(tabsByGroup).forEach(function(groupId) {
        tabsByGroup[groupId].forEach(function(t) {
          allGroupedUrls[t.url] = true;
        });
      });
      allTabs.forEach(function(tab) {
        if (!tab.pinned && tab.groupId === -1 && allGroupedUrls[tab.url]) {
          tabsToClose.push(tab.id);
        }
      });

      // Execute moves first, then closes
      if (tabsToMove.length > 0) {
        // Group moves by target group
        var movesByGroup = {};
        tabsToMove.forEach(function(m) {
          if (!movesByGroup[m.groupId]) movesByGroup[m.groupId] = [];
          movesByGroup[m.groupId].push(m.tabId);
        });
        Object.keys(movesByGroup).forEach(function(gid) {
          chrome.tabs.group({ tabIds: movesByGroup[gid], groupId: parseInt(gid, 10) });
        });
      }

      if (tabsToClose.length > 0) {
        // Small delay to let moves complete
        setTimeout(function() {
          chrome.tabs.remove(tabsToClose);
        }, 100);
      }
    });
  });
}

// ─── Section Toggles ───────────────────────────────────────

function setupSectionToggles() {
  document.querySelectorAll(".section-header[data-section]").forEach(function(header) {
    header.addEventListener("click", function() {
      var section = header.closest(".section");
      var key = header.getAttribute("data-section");
      section.classList.toggle("collapsed");
      collapsedSections[key] = section.classList.contains("collapsed");
      chrome.storage.local.set(makeObj(STORAGE_KEYS.collapsedSections, collapsedSections));
    });
  });
}

function applySectionCollapseStates() {
  Object.keys(collapsedSections).forEach(function(key) {
    if (collapsedSections[key]) {
      var header = document.querySelector("[data-section=\"" + key + "\"]");
      if (header) header.closest(".section").classList.add("collapsed");
    }
  });
}

function toggleGroupCollapse(groupId, groupEl) {
  groupEl.classList.toggle("collapsed");
  collapsedGroups[groupId] = groupEl.classList.contains("collapsed");
  chrome.storage.local.set(makeObj(STORAGE_KEYS.collapsedGroups, collapsedGroups));
}

// ─── Chrome Listeners ──────────────────────────────────────

function setupChromeListeners() {
  chrome.tabs.onCreated.addListener(scheduleRefresh);
  chrome.tabs.onRemoved.addListener(function(tabId) {
    delete tabHomes[tabId];
    if (pinnedInGroupIds[tabId]) {
      delete pinnedInGroupIds[tabId];
      persistPinnedInGroup();
    }
    scheduleRefresh();
    if (activeView === "history") {
      setTimeout(renderRecentlyClosed, 200);
    }
  });
  chrome.tabs.onUpdated.addListener(scheduleRefresh);
  chrome.tabs.onMoved.addListener(scheduleRefresh);
  chrome.tabs.onActivated.addListener(scheduleRefresh);
  chrome.tabs.onAttached.addListener(scheduleRefresh);
  chrome.tabs.onDetached.addListener(scheduleRefresh);

  chrome.tabGroups.onCreated.addListener(scheduleRefresh);
  chrome.tabGroups.onRemoved.addListener(scheduleRefresh);
  chrome.tabGroups.onUpdated.addListener(scheduleRefresh);
  chrome.tabGroups.onMoved.addListener(scheduleRefresh);

  chrome.bookmarks.onCreated.addListener(function() {
    if (activeView === "bookmarks") renderBookmarks();
  });
  chrome.bookmarks.onRemoved.addListener(function() {
    if (activeView === "bookmarks") renderBookmarks();
  });
  chrome.bookmarks.onChanged.addListener(function() {
    if (activeView === "bookmarks") renderBookmarks();
  });
}

// ─── Helpers ────────────────────────────────────────────────

function faviconHTML(tab, isPinned) {
  if (tab.favIconUrl && tab.favIconUrl.indexOf("chrome://") !== 0) {
    return "<img class=\"tab-favicon\" src=\"" + escapeAttr(tab.favIconUrl) + "\" />";
  }
  return defaultFaviconHTML();
}

function faviconHTMLFromUrl(url) {
  if (url && url.indexOf("chrome://") !== 0 && url.indexOf("about:") !== 0) {
    var domain = "";
    try { domain = new URL(url).hostname; } catch(e) {}
    if (domain) {
      return "<img class=\"bookmark-favicon\" src=\"https://www.google.com/s2/favicons?domain=" + encodeURIComponent(domain) + "&sz=16\" />";
    }
  }
  return defaultFaviconHTML();
}

function attachFaviconErrorHandlers(container) {
  container.querySelectorAll("img.tab-favicon, img.bookmark-favicon").forEach(function(img) {
    if (img._faviconHandled) return;
    img._faviconHandled = true;
    img.addEventListener("error", function() {
      var fallback = document.createElement("span");
      fallback.className = "default-favicon";
      fallback.innerHTML = "&#9679;";
      img.parentNode.replaceChild(fallback, img);
    });
  });
}

function defaultFaviconHTML() {
  return "<span class=\"default-favicon\">&#9679;</span>";
}

function escapeHTML(str) {
  var div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function makeObj(key, value) {
  var obj = {};
  obj[key] = value;
  return obj;
}
