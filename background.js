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
