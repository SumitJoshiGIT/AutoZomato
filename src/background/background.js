class AutoZomatoBackground {
    constructor() {
        this.isProcessing = false;
        this.processingTabs = new Map();
        this.allResults = [];
        this.progress = { current: 0, total: 0 };
        this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
        this.logs = []; // Store logs for state restoration
        this.tabStatuses = []; // Store tab statuses for state restoratio
        this.expiryDate = new Date('2025-07-09T00:00:00Z'); // Hardcoded expiry date
        this.isExpired = new Date() > this.expiryDate;
        this.config = {
            maxTabs: 7,
            urls: [],
            autoReply: false,
            autoClose: false,
            promptContext: {}
        };
        
        this.setupMessageListener();
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.action) {
                case 'startProcessing':
                    this.startProcessing(message.data);
                    sendResponse({ success: true });
                    break;
                case 'stopProcessing':
                    this.stopProcessing();
                    sendResponse({ success: true });
                    break;
                case 'downloadResults':
                    this.downloadResults();
                    sendResponse({ success: true });
                    break;
                case 'getProcessingState':
                    sendResponse({
                        isProcessing: this.isProcessing,
                        progress: this.progress,
                        results: this.results,
                        logs: this.logs,
                        tabStatuses: this.tabStatuses,
                        isExpired: this.isExpired
                    });
                    break;
                case 'loadSettingsFromJson':
                    this.loadSettingsFromJson().then(result => sendResponse(result));
                    return true; // Keep message channel open for async response
                case 'saveSettingsToJson':
                    this.saveSettingsToJson(message.settings).then(result => sendResponse(result));
                    return true; // Keep message channel open for async response
                case 'tabCompleted':
                    this.handleTabCompleted(sender.tab.id, message.data);
                    break;
                case 'tabError':
                    this.handleTabError(sender.tab.id, message.error);
                    break;
                case 'log': // Listen for logs from popup
                    this.addLog(message.message, message.type, message.timestamp, false); // Don't re-broadcast to popup
                    break;
                case 'clearLogs':
                    this.logs = [];
                    break;
                case 'updateConfig':
                    this.updateConfig(message.data);
                    sendResponse({ success: true });
                    break;
            }
        });

        // Handle tab removal
        chrome.tabs.onRemoved.addListener((tabId) => {
            if (this.processingTabs.has(tabId)) {
                this.processingTabs.delete(tabId);
                this.checkProcessingComplete();
            }
        });
    }

    broadcastState() {
        chrome.runtime.sendMessage({
            action: 'updateState',
            data: {
                isProcessing: this.isProcessing,
                progress: this.progress,
                results: this.results,
                logs: this.logs,
                tabStatuses: this.tabStatuses,
                isExpired: this.isExpired
            }
        });
    }

    updateConfig(newConfig) {
        if (newConfig.hasOwnProperty('autoClose')) {
            const changed = this.config.autoClose !== newConfig.autoClose;
            if (changed) {
                this.config.autoClose = newConfig.autoClose;
                this.addLog(`🔧 Setting updated: Auto-Close is now ${this.config.autoClose ? 'ON' : 'OFF'}.`);
            }
        }
        if (newConfig.hasOwnProperty('autoReply')) {
            const changed = this.config.autoReply !== newConfig.autoReply;
            if (changed) {
                this.config.autoReply = newConfig.autoReply;
                this.addLog(`🔧 Setting updated: Auto-Reply is now ${this.config.autoReply ? 'ON' : 'OFF'}.`);
            }
        }
    }

    async startProcessing(data) {
        if (this.isExpired) {
            this.addLog('❌ Extension trial has expired. Please contact the developer for a new version.', 'error');
            this.broadcastState();
            return;
        }

        if (this.isProcessing) return;
        
        this.isProcessing = true;
        this.processingStartTime = Date.now();
        
        // Store configuration from popup
        this.config = {
            urls: data.urls || [],
            autoReply: data.autoReply || false,
            autoClose: data.autoClose || false,
            // Max tabs is not configurable in the new UI, so we can hardcode or use a default
            maxTabs: 7, 
            // Prompt context is no longer needed from the UI
        };
        
        this.allResults = [];
        this.processingTabs.clear();
        this.progress = { current: 0, total: this.config.urls.length };
        this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
        this.logs = []; // Reset logs for new processing
        this.tabStatuses = []; // Reset tab statuses
        
        this.addLog(`🚀 Processing started: ${this.config.urls.length} URLs, Auto-Reply: ${this.config.autoReply}, Auto-Close: ${this.config.autoClose}`);
        
        try {
            // Switch to sequential processing
            this.processUrlsSequentially();
        } catch (error) {
            console.error('Error during processing:', error);
            this.addLog(`Processing error: ${error.message}`, 'error');
            this.sendMessageToPopup('error', error.message);
            this.isProcessing = false;
        }
    }

    async processUrlsSequentially() {
        const urls = this.config.urls;

        for (let i = 0; i < urls.length; i++) {
            if (!this.isProcessing) {
                this.addLog('Processing stopped by user.', 'warning');
                break;
            }

            const url = urls[i];
            this.addLog(`Processing URL ${i + 1}/${urls.length}: ${url}`);

            // This promise will resolve when the current tab is finished.
            // We create a resolver function and store it, so it can be called from handleTabCompleted/handleTabError
            await new Promise(async (resolve) => {
                this.currentTabResolver = resolve;
                await this.openTabForProcessing(url, i, this.config);
            });

            // Clean up resolver for the next iteration
            this.currentTabResolver = null;

            // Small delay between tabs if needed, especially if not auto-closing
            if (this.isProcessing && i < urls.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1-second delay
            }
        }

        // This part runs after the loop is finished or broken
        if (this.isProcessing) {
            this.completeProcessing();
        }
    }

    completeProcessing() {
        // This function contains the logic that was previously at the end of processUrlsBatch
        const processingDuration = Date.now() - this.processingStartTime;
        const durationSeconds = Math.floor(processingDuration / 1000);
        const durationMinutes = Math.floor(durationSeconds / 60);
        const remainingSeconds = durationSeconds % 60;
        const durationString = durationMinutes > 0 ?
            `${durationMinutes}m ${remainingSeconds}s` : `${durationSeconds}s`;

        this.addLog(`🎉 Processing completed in ${durationString}! Final stats: ${this.results.totalReviews} reviews, ${this.results.successfulReplies} replies, ${this.results.errors} errors`);

        this.sendMessageToPopup('processingComplete', {
            results: this.allResults,
            processingTime: processingDuration,
            stats: {
                totalReviews: this.results.totalReviews,
                successfulReplies: this.results.successfulReplies,
                errors: this.results.errors,
                urlsProcessed: this.config.urls.length,
                duration: durationString
            }
        });
        this.isProcessing = false;
    }

    async processUrlsBatch() {
        // This function is no longer used, but we'll keep it for reference or future changes.
        // The logic has been moved to processUrlsSequentially.
    }

    async openTabForProcessing(url, index, config) {
        try {
            const tab = await chrome.tabs.create({ url: url, active: false });
            
            this.processingTabs.set(tab.id, {
                url: url,
                index: index,
                status: 'loading',
                startTime: Date.now(),
                config: config // Store config with the tab
            });
            
            this.addLog(`Opening tab for: ${url}`);
            this.updateTabStatusTracking(tab.id, url, 'processing');
            this.sendMessageToPopup('updateTabStatus', {
                tabId: tab.id,
                url: url,
                status: 'processing'
            });
            
            // Inject content script and start processing
            setTimeout(async () => {
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: (config) => {
                            // This code runs in the content script context
                            window.autoZomatoConfig = config;
                        },
                        args: [config] // Pass the entire config object
                    });

                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['src/content/content.js'],
                    });
                    
                    this.addLog(`Script injected successfully into tab ${tab.id}`);
                } catch (error) {
                    console.error(`Error injecting script into tab ${tab.id}:`, error);
                    this.handleTabError(tab.id, `Failed to inject script: ${error.message}`);
                }
            }, 2000); // Wait for page to load
            
        } catch (error) {
            console.error('Error opening tab:', error);
            this.addLog(`Error opening tab for ${url}: ${error.message}`, 'error');
            this.sendMessageToPopup('updateTabStatus', {
                tabId: -1,
                url: url,
                status: 'error',
                data: { error: 'Failed to open tab' }
            });
        }
    }

    handleTabCompleted(tabId, data) {
        const tabInfo = this.processingTabs.get(tabId);
        if (!tabInfo) return;
        
        this.addLog(`Tab ${tabId} completed processing - ${data.reviewCount} reviews, ${data.repliesCount} replies`);
        
        // Add results to global results
        this.allResults.push(...data.results);
        
        // Update results totals
        this.results.totalReviews += data.reviewCount || 0;
        this.results.successfulReplies += data.repliesCount || 0;
        
        // Update tab status tracking
        this.updateTabStatusTracking(tabId, tabInfo.url, 'completed', {
            reviewCount: data.reviewCount,
            repliesCount: data.repliesCount
        });
        
        // Update popup with completion status
        this.sendMessageToPopup('updateTabStatus', {
            tabId: tabId,
            url: tabInfo.url,
            status: 'completed',
            data: {
                reviewCount: data.reviewCount,
                repliesCount: data.repliesCount
            }
        });
        
        // Update overall progress
        this.progress.current++;
        this.sendMessageToPopup('updateProgress', {
            current: this.progress.current,
            total: this.config.urls.length
        });
        
        // Mark tab as completed
        tabInfo.status = 'completed';

        // If we are in sequential mode, resolve the promise to unblock the loop
        if (this.currentTabResolver) {
            this.currentTabResolver();
        }

        // Close the tab if auto-close is enabled
        if (tabInfo.config.autoClose) {
            this.addLog(`Auto-closing completed tab ${tabId}`);
            setTimeout(() => {
                chrome.tabs.remove(tabId);
            }, 1000); // Delay to allow user to see status
        } else {
            this.addLog(`Tab ${tabId} left open for inspection.`);
        }
    }

    handleTabError(tabId, error) {
        const tabInfo = this.processingTabs.get(tabId);
        if (!tabInfo) return;
        
        this.addLog(`Tab ${tabId} error: ${error}`, 'error');
        this.results.errors += 1;
        
        // Update tab status tracking
        this.updateTabStatusTracking(tabId, tabInfo.url, 'error', { error: error });

        // Update popup with error status
        this.sendMessageToPopup('updateTabStatus', {
            tabId: tabId,
            url: tabInfo.url,
            status: 'error',
            data: { error: error }
        });

        // Mark tab as errored
        tabInfo.status = 'error';

        // If we are in sequential mode, resolve the promise to unblock the loop
        if (this.currentTabResolver) {
            this.currentTabResolver();
        }

        // Close the tab if auto-close is enabled
        if (tabInfo.config.autoClose) {
            this.addLog(`Auto-closing error tab ${tabId}`, 'warning');
            setTimeout(() => {
                chrome.tabs.remove(tabId);
            }, 1000);
        } else {
            this.addLog(`Tab ${tabId} left open for inspection after error.`);
        }
    }

    async waitForTabCompletion() {
        // Wait for at least one tab to complete
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const activeTabs = Array.from(this.processingTabs.values()).filter(
                    t => t.status === 'loading' || t.status === 'processing'
                );
                
                if (activeTabs.length < this.config.maxTabs) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 1000);
        });
    }

    async waitForAllTabsComplete() {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const activeTabs = Array.from(this.processingTabs.values()).filter(
                    t => t.status === 'loading' || t.status === 'processing'
                );
                
                if (activeTabs.length === 0) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 1000);
        });
    }

    checkProcessingComplete() {
        const activeTabs = Array.from(this.processingTabs.values()).filter(
            t => t.status === 'loading' || t.status === 'processing'
        );
        
        if (activeTabs.length === 0 && this.isProcessing) {
            this.sendMessageToPopup('processingComplete', { results: this.allResults });
            this.isProcessing = false;
        }
    }

    stopProcessing() {
        this.addLog('Stopping processing...');
        this.isProcessing = false;
        
        // Close all processing tabs
        for (const tabId of this.processingTabs.keys()) {
            try {
                chrome.tabs.remove(tabId);
            } catch (e) {
                // Ignore errors for tabs that might already be closed
            }
        }
        this.processingTabs.clear();
    }

    sendMessageToPopup(action, data) {
        // Try to send message to popup
        chrome.runtime.sendMessage({ action, ...data }).catch(() => {
            // Popup might be closed, that's okay
        });
    }

    // Log handling
    addLog(message, type = 'info', timestamp = null, notifyPopup = true) {
        const logEntry = {
            message,
            type,
            timestamp: timestamp || new Date().toISOString()
        };
        this.logs.push(logEntry);

        // Keep logs from getting too large
        if (this.logs.length > 200) {
            this.logs.shift();
        }

        if (notifyPopup) {
            this.sendMessageToPopup('log', logEntry);
        }
    }

    updateTabStatusTracking(tabId, url, status, data = {}) {
        const existingStatusIndex = this.tabStatuses.findIndex(t => t.tabId === tabId);
        const statusEntry = { tabId, url, status, data };

        if (existingStatusIndex > -1) {
            this.tabStatuses[existingStatusIndex] = statusEntry;
        } else {
            this.tabStatuses.push(statusEntry);
        }
    }

    // File I/O for settings and results is no longer needed here
    // as settings are simplified and results are handled by content scripts.
    // downloadResults() can be simplified or removed if not used.
    async downloadResults() {
        this.addLog('Creating download for results...');
        const blob = new Blob([JSON.stringify(this.allResults, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        chrome.downloads.download({
            url: url,
            filename: `autozomato_results_${Date.now()}.json`
        });
    }
}

new AutoZomatoBackground();
