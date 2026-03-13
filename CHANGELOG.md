# Changelog

All notable changes to Pixel Bar will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.2] - 2026-03-13

### Changed
- **Tab item icon layout** — Close button moved to the left; set-home and return-to-home buttons on the right
- **Saved group counts** — Removed "tabs" suffix to match other count styles

### Fixed
- **Tidy the Tabs reliability** — Added windowId fallback, improved retry logic, and debug logging for Sonoma compatibility

## [0.6.1] - 2026-03-13

### Added
- **Expandable saved groups** — Click a saved group to expand and preview its tabs (favicon + hostname) before restoring
- **Tidy the Tabs** also collapses expanded saved groups

## [0.6.0] - 2026-03-13

### Added
- **Saved Groups** — Save, restore, and manage tab group snapshots from the sidebar
  - Save sets home URLs on all tabs in the group for reliable restore
  - Restore navigates strayed tabs home first, then creates only truly missing tabs
  - Drag-and-drop to reorder saved groups
  - Save (💾), restore (↺), rename (✏), close (✕) buttons on group headers
- **Merge Duplicates** — Toolbar button that merges tab groups with matching name and color, deduplicates URLs within groups, and closes ungrouped tabs already present in a group
- **Close ungrouped tabs** — Trashcan button on the Ungrouped Tabs section header (appears on hover)
- **Home URL improvements** — Set-home button always visible on all tabs; return-to-home button shows for any tab with a home URL
- **Tidy the Tabs** also collapses all sidebar tab groups
- **Bookmark folder persistence** — Expanded/collapsed state of bookmark folders remembered across Chrome restarts; folders default to collapsed
- **Clear site data close button** — × button to dismiss the clear site data menu

### Fixed
- Section header height no longer shifts on hover when action buttons replace the count
- Saved Groups section count stays visible on hover (no action button to swap with)

## [0.5.0] - 2026-03-12

### Added
- **Toolbar** — Dedicated utility row between pinned tabs and view navigation
- **Tidy the Tabs** — Toolbar button that collapses all native tab groups and moves ungrouped tabs to the end of the tab strip
- **Auto-collapse** — Switching tabs automatically collapses other native tab groups, keeping only the active group expanded
- **Clear site data** — Cookie button (🍪⛔) in the toolbar to manage and clear site data for the active tab's origin
- Click opens a detailed menu showing all site data with item counts per category (cookies, cache storage, localStorage, sessionStorage)
- Collapsible sections to inspect individual stored items
- Checkboxes to selectively choose which data types to clear
- "Clear Selected & Reload" button clears chosen data and reloads the page
- Visual feedback (checkmark) on clear action
- Retry logic for tab operations that fail during Chrome animations
- New permissions: `browsingData`, `scripting`, `cookies`, `host_permissions: <all_urls>`

### Fixed
- Group title/color persistence now works correctly (Chrome 146 fixed the `tabGroups.update` repaint bug)
- Favicon error fallback no longer uses inline `onerror` handler (was blocked by MV3 Content Security Policy). Now uses programmatic error listeners via `attachFaviconErrorHandlers()`

## [0.3.0] - 2026-03-10

### Added
- **Pinned-in-group tabs** — Pin tabs within tab groups. Right-click a grouped tab → "Pin in Group" to pin it as a compact favicon-only tile at the top of the group
- Pinned-in-group tabs share a tinted background with the group header in the group's color
- Pinned-in-group tabs remain visible when the group is collapsed
- Drag-and-drop to reorder pinned-in-group tabs within a group
- Pinned-in-group tabs are moved to the front of their group in Chrome's native tab strip
- Pin state persists across page navigation (tracked by tab ID, not URL)
- Cross-restart recovery for pinned-in-group state via URL matching

### Removed
- Saved Groups feature (save, close, restore) — removed to avoid confusion with Chrome's native saved groups which are not accessible via extension APIs
- Close Group button on group headers
- Group title/color persistence across Chrome restarts — removed due to Chrome rendering bug where `chrome.tabGroups.update` updates internal state but the native tab bar doesn't repaint
- Collapse sync with Chrome's native tab groups — same Chrome rendering bug

### Changed
- Group header and pinned-in-group tabs now wrapped in a `.group-top` container with tinted group color background
- Tab context menu now shows "Pin in Group" / "Unpin in Group" for tabs inside a group

## [0.2.1] - 2026-03-05

### Added
- Drag-and-drop to reorder saved groups (persisted to storage)

### Fixed
- Group color picker in context menu now updates the sidebar header immediately
- Saved group tab count and action buttons no longer cause layout shift on hover (matching group header fix)

## [0.2.0] - 2026-03-05

### Added
- Multi-tab selection with Cmd/Ctrl+click (toggle) and Shift+click (range)
- Tab context menu (right-click) with New Tab Below, Add to Group, Move to New Window, Reload, Duplicate, Pin/Unpin, Mute/Unmute, Close, Close Other Tabs
- Add to Group submenu listing New Group and all existing groups with color indicators
- Tab group context menu (right-click group header) with inline rename, color picker, New Tab in Group, Move Group to New Window, Save Group, Close Group, Ungroup, Delete Group
- Creating a new group automatically opens the group context menu with name input focused
- Bookmark folder collapse arrows matching the style used in tab groups and sections
- Collapse All button in the Bookmarks view toolbar

## [0.1.0] - 2026-03-05

### Added
- Vertical tabs sidebar using Chrome's Side Panel API
- Pinned tabs displayed as horizontal icons with drag-and-drop reordering
- Tab groups with color-coded headers matching Chrome's native styling
- Drag-and-drop tabs between groups, within groups, and to ungrouped
- Drag-and-drop to reorder tab groups
- Ungrouped tabs section
- Save tab groups for later restoration
- Close and save groups (auto-saves before closing all tabs)
- Restore saved groups (detects duplicates to avoid re-opening)
- Rename tab groups inline
- Custom tab names via double-click (persisted by URL)
- Bookmarks view showing Bookmarks Bar with collapsible folders
- Recently Closed view with session restore
- Three-view navigation (Tabs, Bookmarks, History) with persistent active view
- Collapsible sections and groups with smooth CSS grid animations
- Dark theme (Catppuccin-inspired)
- Middle-click to close pinned tabs
- Audio indicator on tabs playing sound
- Pixel Motives branded extension icon
