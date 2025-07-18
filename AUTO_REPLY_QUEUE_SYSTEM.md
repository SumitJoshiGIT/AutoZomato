# AutoZomato Auto-Reply Queue System

## Overview

The AutoZomato extension now uses an advanced queue-based system for handling automatic replies. This system ensures that replies are published with proper timing and doesn't interfere with the review scraping process.

## How It Works

### 1. **Queue-Based Processing**
- Reviews are processed and replies are generated immediately
- Instead of clicking "Publish" right away, reviews are added to a queue
- A separate async processor handles the queue with configurable delays

### 2. **Async Reply Processor**
- Runs independently from the review scraping process
- Takes reviews from the queue one by one
- Clicks "Publish" with the configured wait time between each action
- Continues until the queue is empty and no new reviews are being scraped

### 3. **Smart Queue Management**
- Automatically starts when the first review is queued
- Stops when the queue is empty
- Resets when a new processing session starts
- Handles interruptions gracefully

## Key Components

### Global Variables
```javascript
autoReplyQueue = []                    // Queue storing reviews waiting for auto-reply
autoReplyProcessorRunning = false     // Flag to prevent multiple processors
autoReplyProcessorStopped = false     // Flag to stop the processor
```

### Queue Item Structure
```javascript
{
    reviewId: "review_123",           // Unique review identifier
    publishBtn: DOMElement,           // Reference to the publish button
    timestamp: 1642608000000          // When the review was queued
}
```

### Core Functions

#### `startAutoReplyProcessor()`
- Starts the async processor if not already running
- Processes queue items with configurable delays
- Updates UI indicators and sends progress updates
- Handles errors gracefully

#### `stopAutoReplyProcessor()`
- Stops the processor and clears the queue
- Used when starting new processing sessions

#### `getAutoReplyQueueStatus()`
- Returns current queue status for debugging
- Accessible via `window.autoZomatoDebug.getQueueStatus()`

## Benefits

### 1. **No Interference**
- Review scraping and reply generation happen independently
- No blocking between processes
- Smooth user experience

### 2. **Proper Timing**
- Configurable delays between each publish action
- Appears more natural to avoid detection
- Respects user-defined wait times

### 3. **Reliable Processing**
- Handles missing DOM elements gracefully
- Maintains state across page updates
- Provides detailed logging for debugging

### 4. **Progress Tracking**
- Real-time queue status updates
- Visual indicators showing current progress
- Background script integration for dashboard updates

## Configuration

### Wait Time Setting
- Configured in Processing Settings (default: 3 seconds)
- Applied between each publish action
- Can be changed during processing via settings

### Auto-Reply Toggle
- When enabled: Reviews are automatically queued and published
- When disabled: Reviews are processed but not published
- Can be toggled in settings

## Debug Tools

Access debugging tools via browser console:

```javascript
// Get current queue status
window.autoZomatoDebug.getQueueStatus()

// View current queue contents
window.autoZomatoDebug.getQueue()

// Get processor state
window.autoZomatoDebug.getProcessorState()

// Stop processor manually
window.autoZomatoDebug.stopProcessor()

// Clear queue manually
window.autoZomatoDebug.clearQueue()
```

## Flow Diagram

```
Review Scraped → Reply Generated → Added to Queue
                                      ↓
                                 Queue Processor
                                      ↓
                              Wait for Delay Time
                                      ↓
                              Click Publish Button
                                      ↓
                              Update Progress UI
                                      ↓
                           Check for More in Queue
                                      ↓
                              Process Next Review
```

## Error Handling

- **Missing DOM Elements**: Logged as warnings, processing continues
- **Processor Crashes**: Automatically resets state for next session
- **Queue Overflow**: Prevents memory issues with proper cleanup
- **Page Navigation**: Resets queue system for new pages

## Status Updates

The system provides several status updates:

1. **auto-publishing**: Currently publishing replies from queue
2. **auto-reply-completed**: All queued replies have been published
3. **Visual Indicators**: Real-time progress shown in extension indicator

## Logging

Comprehensive logging is provided for debugging:

- Queue additions: When reviews are added to queue
- Processing start/stop: Processor lifecycle events
- Publish actions: When each reply is published
- Errors: Any issues during processing
- Progress updates: Real-time status information

## Migration from Previous System

The new queue system replaces the old immediate-publish approach:

- **Old**: `publishBtn.click()` called immediately after reply generation
- **New**: Reviews queued and processed asynchronously with proper timing
- **Benefits**: No interference, better timing, more reliable

## Testing

To test the queue system:

1. Enable auto-reply in settings
2. Set a reasonable wait time (3-10 seconds)
3. Start processing on a page with multiple reviews
4. Monitor console logs for queue activity
5. Use debug tools to inspect queue status

The system is now ready for production use with improved reliability and timing control.
