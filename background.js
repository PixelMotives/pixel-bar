"use strict";

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Track whether the side panel was open when Chrome last closed
chrome.runtime.onInstalled.addListener(function() {
  chrome.storage.local.get("pb_panel_open", function(data) {
    if (data.pb_panel_open === undefined) {
      chrome.storage.local.set({ pb_panel_open: false });
    }
  });
});

// Try to open the side panel for a given window
function tryOpenPanel(windowId) {
  chrome.sidePanel.open({ windowId: windowId }).catch(function() {
    // Silently ignore — window may not be ready
  });
}

// When Chrome starts, re-open the side panel if it was open last session
// Use a flag to avoid re-opening on every new window
var startupHandled = false;

chrome.runtime.onStartup.addListener(function() {
  chrome.storage.local.get("pb_panel_open", function(data) {
    if (!data.pb_panel_open) return;

    // Try immediately
    chrome.windows.getLastFocused(function(win) {
      if (win && win.id) {
        tryOpenPanel(win.id);
        startupHandled = true;
      }
    });

    // Retry after delays in case the window wasn't ready
    setTimeout(function() {
      if (startupHandled) return;
      chrome.windows.getLastFocused(function(win) {
        if (win && win.id) {
          tryOpenPanel(win.id);
          startupHandled = true;
        }
      });
    }, 500);

    setTimeout(function() {
      if (startupHandled) return;
      chrome.windows.getLastFocused(function(win) {
        if (win && win.id) {
          tryOpenPanel(win.id);
          startupHandled = true;
        }
      });
    }, 2000);
  });
});

// Fallback: if a window is created during startup and we haven't opened yet
chrome.windows.onCreated.addListener(function(win) {
  if (startupHandled) return;
  chrome.storage.local.get("pb_panel_open", function(data) {
    if (data.pb_panel_open && !startupHandled) {
      // Small delay to let the window fully initialize
      setTimeout(function() {
        tryOpenPanel(win.id);
        startupHandled = true;
      }, 300);
    }
  });
});

// Handle messages from the side panel
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.action === "tidy-tab-bar") {
    var doTidy = function(wId) {
      console.log("[Pixel Bar] tidy-tab-bar executing, windowId:", wId);
      // Collapse all groups, then move ungrouped tabs to the end
      chrome.tabGroups.query({ windowId: wId }, function(groups) {
        if (chrome.runtime.lastError) {
          console.warn("[Pixel Bar] tabGroups.query error:", chrome.runtime.lastError.message);
          return;
        }
        console.log("[Pixel Bar] Found", groups.length, "groups to tidy");
        var collapsePromises = groups
          .filter(function(g) { return !g.collapsed; })
          .map(function(group) {
            return withRetry(function() {
              return chrome.tabGroups.update(group.id, { collapsed: true });
            });
          });

        Promise.all(collapsePromises).then(function() {
          // Move ungrouped tabs after groups are collapsed
          chrome.tabs.query({ windowId: wId }, function(tabs) {
            if (chrome.runtime.lastError) {
              console.warn("[Pixel Bar] tabs.query error:", chrome.runtime.lastError.message);
              return;
            }
            var ungrouped = tabs.filter(function(t) { return !t.pinned && t.groupId === -1; });
            console.log("[Pixel Bar] Moving", ungrouped.length, "ungrouped tabs");
            ungrouped.forEach(function(tab) {
              withRetry(function() {
                return chrome.tabs.move(tab.id, { index: -1 });
              });
            });
          });
        });
      });
    };

    // Use provided windowId, fall back to current window
    if (msg.windowId) {
      doTidy(msg.windowId);
    } else {
      chrome.windows.getCurrent(function(win) {
        doTidy(win.id);
      });
    }
  }
});

// Retry a promise-returning function when Chrome says tabs are busy
function withRetry(fn, retries) {
  retries = retries || 5;
  return fn().catch(function(e) {
    var msg = String(e);
    if (retries > 0 && (msg.indexOf("cannot be edited") !== -1 || msg.indexOf("No current window") !== -1)) {
      return new Promise(function(resolve) {
        setTimeout(function() { resolve(withRetry(fn, retries - 1)); }, 100);
      });
    }
    console.warn("[Pixel Bar] withRetry failed:", msg);
  });
}

// Auto-collapse other native tab groups when a tab is activated
var autoCollapseEnabled = true;

chrome.tabs.onActivated.addListener(function(activeInfo) {
  if (!autoCollapseEnabled) return;

  chrome.tabs.get(activeInfo.tabId, function(tab) {
    if (chrome.runtime.lastError || !tab) return;

    chrome.tabGroups.query({ windowId: tab.windowId }, function(groups) {
      if (chrome.runtime.lastError) return;
      groups.forEach(function(group) {
        if (group.id !== tab.groupId && !group.collapsed) {
          withRetry(function() {
            return chrome.tabGroups.update(group.id, { collapsed: true });
          });
        }
      });
    });
  });
});

// When side panel connects, mark as open; when it disconnects, mark as closed
chrome.runtime.onConnect.addListener(function(port) {
  if (port.name === "pixel-bar-panel") {
    chrome.storage.local.set({ pb_panel_open: true });
    startupHandled = true;
    port.onDisconnect.addListener(function() {
      chrome.storage.local.set({ pb_panel_open: false });
    });
  }
});
