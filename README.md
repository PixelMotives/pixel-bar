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

### Saved Groups
- Save any tab group using the floppy disk icon on the group header
- Close a group (X button) to auto-save it and close all its tabs
- Restore a saved group — if it's already open, it focuses it instead of duplicating
- Delete saved groups you no longer need

### Group Management
- Rename groups inline (pencil icon)
- Save groups for later (floppy disk icon)
- Close and save groups (X icon — saves then closes all tabs)

### Bookmarks
- Browse your Bookmarks Bar in a dedicated view
- Collapsible folder tree
- Click any bookmark to open it

### Recently Closed
- View last 25 recently closed tabs
- Click to restore

### General
- Three-view navigation: Tabs, Bookmarks, History
- Active view remembered across sessions
- Pinned tabs always visible across all views
- Side panel width adjustable via Chrome's native resize handle
- Side panel state persists across Chrome restarts
- Dark theme

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
- `storage` — Persist settings, saved groups, and custom tab names
- `sidePanel` — Use Chrome's Side Panel API
