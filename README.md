# Pixel Bar - Chrome Extension

A sidebar extension for Chrome that replaces the need for horizontal tabs with a vertical tab panel, plus bookmarks and recently closed tabs.

## Features

### Vertical Tabs
- Pinned tabs displayed as horizontal icons at the top (drag to reorder)
- Tab groups with color-coded headers matching Chrome's native tab group colors
- Drag-and-drop tabs between groups, within groups, or to ungrouped
- Drag-and-drop to reorder tab groups
- Ungrouped tabs in their own section at the bottom
- Double-click any tab title to rename it (persisted by URL)
- Middle-click pinned tabs to close them
- Audio indicator on tabs playing sound
- Smooth collapse/expand animations on groups and sections

### Pinned-in-Group Tabs
- Pin tabs within tab groups for quick access
- Right-click a grouped tab → "Pin in Group" to pin it
- Pinned tabs display as compact favicon-only tiles at the top of the group
- Group header and pinned tabs share a tinted background in the group's color
- Pinned tabs remain visible when the group is collapsed
- Drag to reorder pinned tabs within a group
- Pinned tabs are moved to the front of their group in Chrome's native tab strip
- Pin state persists even when navigating to different pages
- Cross-restart recovery via URL matching

### Multi-Select & Context Menu
- Cmd/Ctrl+click to select individual tabs, Shift+click to select a range
- Right-click selected tabs for a context menu with:
  - New Tab Below
  - Add to Group (New Group or any existing group)
  - Move to New Window
  - Reload, Duplicate, Pin/Unpin, Pin in Group/Unpin in Group, Mute/Unmute
  - Close, Close Other Tabs

### Tab Group Management
- Right-click a group header for a context menu with:
  - Inline rename field (focused automatically)
  - Color picker with all 9 Chrome group colors
  - New Tab in Group
  - Move Group to New Window
  - Ungroup (keeps tabs open), Delete Group (closes tabs)
- Creating a new group opens the rename menu automatically
- Rename groups via hover icon on group headers

### Bookmarks
- Browse your Bookmarks Bar in a dedicated view
- Collapsible folder tree with arrow indicators
- Collapse All button to close all folders at once
- Click any bookmark to open it

### Recently Closed
- View last 25 recently closed tabs
- Click to restore

### General
- Three-view navigation: Tabs, Bookmarks, History
- Active view remembered across sessions
- Pinned tabs always visible across all views
- Side panel width adjustable via Chrome's native resize handle
- Dark theme (Catppuccin-inspired)

## Installation

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this folder
4. Click the Pixel Bar icon in the toolbar to open the sidebar

## File Structure

```
pixel-bar/
  manifest.json    - Extension config (MV3, permissions, side panel)
  background.js    - Service worker (opens side panel on icon click)
  sidepanel.html   - Side panel layout
  sidepanel.js     - All application logic
  sidepanel.css    - Styling (dark theme)
  README.md        - This file
```

## Permissions

- `tabs` — Read and manage tabs
- `tabGroups` — Read and manage tab groups
- `bookmarks` — Read bookmarks for the Bookmarks view
- `sessions` — Access recently closed tabs
- `storage` — Persist settings, pinned-in-group state, and custom tab names
- `sidePanel` — Use Chrome's Side Panel API
