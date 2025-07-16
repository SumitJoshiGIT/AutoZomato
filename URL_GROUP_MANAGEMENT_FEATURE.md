# URL Group Management Feature

## Overview
The AutoZomato extension now includes a comprehensive URL group management system that allows users to organize restaurant URLs into named groups for better organization and selective processing.

## Key Features

### 1. Group Creation and Management
- **Create Groups**: Click the "+ Group" button to create a new group
- **Edit Groups**: Click the edit icon (✏️) next to any group to rename it
- **Delete Groups**: Click the delete icon (🗑️) to remove a group (URLs are moved back to the main list)
- **Group Selection**: Click on a group name to view and manage its URLs

### 2. URL Organization
- **Add to Groups**: Select a group from the dropdown next to any URL in the main list
- **Remove from Groups**: When viewing a group, use the × button to remove URLs from that group
- **Automatic Management**: URLs are automatically moved between the main list and groups

### 3. Selective Processing
- **Checkbox Selection**: Each URL now has a checkbox for individual selection
- **Select All/Deselect All**: Bulk selection controls for convenience
- **Process Selected**: Process only the selected URLs instead of all URLs
- **Group-based Processing**: When viewing a group, selection applies only to that group's URLs

### 4. UI Components

#### Group Section
- Displays all created groups with URL counts
- Visual indication of selected group
- Inline edit and delete actions

#### Enhanced URL Section
- Group selector dropdown to filter view
- Checkboxes for URL selection
- Process Selected button (enabled when URLs are selected)
- Group assignment dropdowns for individual URLs

#### URL Display Modes
- **No Group Selected**: Shows all ungrouped URLs
- **Group Selected**: Shows only URLs in the selected group

### 5. Data Persistence
- Groups and their configurations are automatically saved
- Group assignments persist across browser sessions
- Integration with existing URL and settings storage

## User Workflow Examples

### Creating and Using Groups
1. Click "+ Group" to create a new group
2. Enter a group name (e.g., "Downtown Restaurants")
3. Add URLs to the group using the dropdown next to each URL
4. Select the group to view and manage its URLs
5. Use checkboxes to select specific URLs for processing

### Selective Processing
1. Either select a specific group or work with the main URL list
2. Use checkboxes to select desired URLs
3. Click "Process Selected" to process only the chosen URLs
4. Or use "Select All" and "Process Selected" for group-wide processing

## Technical Implementation

### Data Structure
```javascript
groups: [
  {
    id: "unique_timestamp_id",
    name: "Group Name",
    urls: ["url1", "url2", ...]
  }
]
```

### Storage Integration
- Groups are stored in Chrome's local storage alongside existing data
- Automatic backup and restoration of group configurations
- Compatible with existing settings.json URL loading

### UI Components Added
- Group management section with CRUD operations
- Enhanced URL list with selection capabilities
- Group selector and process controls
- Responsive layout with improved CSS styling

## Benefits
1. **Better Organization**: Logical grouping of related restaurant URLs
2. **Selective Processing**: Process only specific restaurants as needed
3. **Efficient Workflow**: Reduce processing time by targeting specific groups
4. **Visual Management**: Clear overview of group structure and contents
5. **Flexible Operation**: Switch between group-based and individual URL management

This feature enhances the AutoZomato extension by providing sophisticated URL organization capabilities while maintaining the existing functionality and adding new selective processing options.
