class AutoZomatoBackground {
    constructor() {
        this.isProcessing = false;
        this.processingTabs = new Map();
        this.allResults = [];
        this.detailedReviewLogs = []; // Store detailed review logs for Excel export
        this.progress = { current: 0, total: 0 };
        this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
        this.logs = []; // Store logs for state restoration
        this.tabStatuses = []; // Store tab statuses for state restoration
        this.expiryDate = new Date('2025-07-19T00:00:00Z'); // Hardcoded expiry date
        this.isExpired = new Date() > this.expiryDate;
        this.config = {
            maxTabs: 7,
            urls: [],
            autoReply: false,
            autoClose: false,
            promptContext: {},
            gptMode: {
                enabled: false,
                apiKey: '',
                keyName: 'AutoZomato GPT Key',
                model: 'gpt-4o-mini'
            }
        };
        
        // Load prompt context from settings.json
        this.loadPromptContext();
        
        this.setupMessageListener();
        this.setupActionHandler();
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.action) {
                case 'startProcessing':
                    console.log('[Background] Received startProcessing with:', {
                        urls: message.urls?.length || 0,
                        autoReply: message.autoReply,
                        autoClose: message.autoClose,
                        dateRange: message.dateRange
                    });
                    this.startProcessing({
                        urls: message.urls || [],
                        autoReply: message.autoReply !== undefined ? message.autoReply : false,
                        autoClose: message.autoClose !== undefined ? message.autoClose : false,
                        gptMode: message.gptMode || {},
                        dateRange: message.dateRange || {}
                    });
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
                case 'reloadConfiguration':
                    console.log('[Background] Reloading configuration from settings.json...');
                    this.loadPromptContext().then(async () => {
                        console.log('[Background] Configuration reloaded successfully:', this.config);
                        
                        // Update all active content scripts with new configuration
                        try {
                            const tabs = await chrome.tabs.query({});
                            const updatePromises = tabs.map(async (tab) => {
                                try {
                                    if (tab.url && (tab.url.includes('zomato.com') || tab.url.includes('file://'))) {
                                        console.log(`[Background] Updating config for tab ${tab.id}: ${tab.url}`);
                                        await chrome.tabs.sendMessage(tab.id, {
                                            action: 'updateConfiguration',
                                            config: this.config,
                                            promptContext: this.promptContext
                                        });
                                    }
                                } catch (tabError) {
                                    console.log(`[Background] Could not update tab ${tab.id}:`, tabError.message);
                                    // Tab might not have content script loaded, ignore error
                                }
                            });
                            
                            await Promise.allSettled(updatePromises);
                            console.log('[Background] Configuration update sent to all active tabs');
                        } catch (error) {
                            console.warn('[Background] Error updating tabs with new config:', error);
                        }
                        
                        sendResponse({ success: true, config: this.config });
                    }).catch(error => {
                        console.error('[Background] Configuration reload failed:', error);
                        sendResponse({ success: false, error: error.message });
                    });
                    return true; // Keep message channel open for async response
                case 'tabCompleted':
                    this.handleTabCompleted(sender.tab.id, message.data);
                    break;
                case 'tabError':
                    this.handleTabError(sender.tab.id, message.error);
                    break;
                case 'reviewProcessed':
                    // Forward real-time review data to dashboard
                    console.log('[Background] Received reviewProcessed message from content script:', message.reviewData);
                    this.forwardReviewProcessedToTabs(message.reviewData);
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
                case 'fetchRestaurantName':
                    this.fetchRestaurantName(message.url).then(result => sendResponse(result));
                    return true; // Keep message channel open for async response
                case 'updateRestaurantName':
                    this.handleRestaurantNameUpdate(sender.tab.id, message.restaurantName, message.url);
                    break;
                case 'updateTabProgress':
                    this.handleTabProgressUpdate(sender.tab.id, message);
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

    setupActionHandler() {
        // Handle extension icon click to open control panel
        chrome.action.onClicked.addListener((tab) => {
            chrome.tabs.create({
                url: chrome.runtime.getURL('src/page/page.html')
            });
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
        
        // Ensure we have the latest GPT configuration from Chrome storage
        await this.loadPromptContext();
        
        // Store configuration from popup
        this.config = {
            urls: data.urls || [],
            autoReply: data.autoReply || false,
            autoClose: data.autoClose || false,
            gptMode: data.gptMode || this.config.gptMode || { // Use passed gptMode or fallback to loaded
                enabled: false,
                apiKey: '',
                keyName: 'AutoZomato GPT Key',
                model: 'gpt-4o-mini'
            },
            dateRange: data.dateRange || {
                startDate: '',
                endDate: ''
            },
            // Max tabs is not configurable in the new UI, so we can hardcode or use a default
            maxTabs: 7, 
            // Load prompt context from settings
            promptContext: this.promptContext || {}
        };
        
        console.log('[Background] Final processing configuration:', {
            ...this.config,
            gptMode: {
                ...this.config.gptMode,
                apiKey: this.config.gptMode.apiKey ? '***masked***' : ''
            }
        });
        
        this.allResults = [];
        this.detailedReviewLogs = []; // Reset detailed review logs
        this.processingTabs.clear();
        this.progress = { current: 0, total: this.config.urls.length };
        this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
        this.logs = []; // Reset logs for new processing
        this.tabStatuses = []; // Reset tab statuses
        
        const gptModeStatus = this.config.gptMode.enabled ? `GPT-${this.config.gptMode.model}` : 'Ollama';
        this.addLog(`🚀 Processing started: ${this.config.urls.length} URLs, Auto-Reply: ${this.config.autoReply}, Auto-Close: ${this.config.autoClose}, AI Mode: ${gptModeStatus}`);
        
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
                    // First, inject the config into the page
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: (config) => {
                            // This code runs in the content script context
                            window.autoZomatoConfig = config;
                            console.log('[AutoZomato Background] Config injected:', config);
                        },
                        args: [config] // Pass the entire config object
                    });

                    // Then inject the content script (which will auto-start processing)
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
        
        // Prevent duplicate completion handling
        if (tabInfo.status === 'completed') {
            this.addLog(`Tab ${tabId} already completed, ignoring duplicate completion`, 'warning');
            return;
        }
        
        // Use restaurant name from data if available, otherwise from tabInfo
        const restaurantName = data.restaurantName || tabInfo.restaurantName || this.extractRestaurantNameFromUrl(tabInfo.url);
        
        this.addLog(`${restaurantName} completed processing - ${data.reviewCount} reviews, ${data.repliesCount} replies`);
        console.log(`[Background] Tab ${tabId} completion data:`, {
            reviewCount: data.reviewCount,
            repliesCount: data.repliesCount,
            resultsLength: data.results?.length || 0,
            detailedLogLength: data.detailedReviewLog?.length || 0
        });
        
        // Add results to global results with duplicate prevention
        if (data.results && Array.isArray(data.results)) {
            const existingReviewIds = new Set(this.allResults.map(r => r.reviewId));
            const newResults = data.results.filter(result => !existingReviewIds.has(result.reviewId));
            
            if (newResults.length !== data.results.length) {
                this.addLog(`Filtered out ${data.results.length - newResults.length} duplicate reviews from ${restaurantName}`);
            }
            
            this.allResults.push(...newResults);
            this.addLog(`Added ${newResults.length} new results from ${restaurantName} (${data.results.length} total processed)`);
        }
        
        // Store detailed review logs if available with duplicate prevention
        if (data.detailedReviewLog && Array.isArray(data.detailedReviewLog)) {
            const existingLogReviewIds = new Set(this.detailedReviewLogs.map(log => log.reviewId));
            
            // Add URL and timestamp to each log entry and filter duplicates
            const enrichedLogs = data.detailedReviewLog
                .filter(log => !existingLogReviewIds.has(log.reviewId))
                .map(log => ({
                    ...log,
                    url: tabInfo.url,
                    timestamp: new Date().toISOString(),
                    restaurantName: restaurantName
                }));
            
            if (enrichedLogs.length !== data.detailedReviewLog.length) {
                this.addLog(`Filtered out ${data.detailedReviewLog.length - enrichedLogs.length} duplicate detailed logs from ${restaurantName}`);
            }
            
            this.detailedReviewLogs.push(...enrichedLogs);
            this.addLog(`Added ${enrichedLogs.length} detailed review logs from ${restaurantName}`);
        }
        
        // Update results totals
        this.results.totalReviews += data.reviewCount || 0;
        this.results.successfulReplies += data.repliesCount || 0;
        
        // Send individual tab result to dashboard immediately
        const tabResult = {
            tabId: tabId,
            url: tabInfo.url,
            restaurantName: restaurantName,
            reviewCount: data.reviewCount || 0,
            repliesCount: data.repliesCount || 0,
            results: data.results || [],
            detailedReviewLog: data.detailedReviewLog || [],
            timestamp: new Date().toISOString(),
            status: 'completed'
        };
        
        this.sendMessageToPopup({
            action: 'tabResultReady',
            tabResult: tabResult
        });
        
        // Update tab status tracking
        this.updateTabStatusTracking(tabId, tabInfo.url, 'completed', {
            reviewCount: data.reviewCount,
            repliesCount: data.repliesCount,
            restaurantName: restaurantName
        });
        
        // Update popup with completion status
        this.sendMessageToPopup('updateTabStatus', {
            tabId: tabId,
            url: tabInfo.url,
            status: 'completed',
            restaurantName: restaurantName,
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
        tabInfo.restaurantName = restaurantName;

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
        console.log('[Background] sendMessageToPopup called:', action, data);
        
        // Send to any dashboard pages
        chrome.tabs.query({ url: chrome.runtime.getURL('src/page/page.html') }, (tabs) => {
            console.log('[Background] Found dashboard tabs:', tabs.length);
            tabs.forEach(tab => {
                console.log('[Background] Sending message to dashboard tab:', tab.id, { action, ...data });
                chrome.tabs.sendMessage(tab.id, { action, ...data }).catch((error) => {
                    console.warn('[Background] Failed to send message to dashboard tab:', error);
                });
            });
        });
        
        // Also try to send message to popup (for backward compatibility)
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

    handleRestaurantNameUpdate(tabId, restaurantName, url) {
        const tabInfo = this.processingTabs.get(tabId);
        if (!tabInfo) return;
        
        // Store restaurant name for this tab
        tabInfo.restaurantName = restaurantName;
        
        // Update tab status tracking with restaurant name
        this.updateTabStatusTracking(tabId, url, 'processing', { 
            restaurantName: restaurantName 
        });
        
        // Send restaurant name update to dashboard
        this.sendMessageToPopup('updateRestaurantName', {
            tabId: tabId,
            url: url,
            restaurantName: restaurantName
        });
        
        this.addLog(`Restaurant name updated for tab ${tabId}: ${restaurantName}`);
    }

    handleTabProgressUpdate(tabId, data) {
        console.log('[Background] Received tab progress update:', tabId, data);
        const tabInfo = this.processingTabs.get(tabId);
        if (!tabInfo) {
            console.warn('[Background] Tab info not found for:', tabId);
            return;
        }
        
        // Update tab info with progress data
        tabInfo.progress = data.progress;
        tabInfo.restaurantName = data.restaurantName;
        
        // Update tab status tracking
        this.updateTabStatusTracking(tabId, data.url, data.status, {
            restaurantName: data.restaurantName,
            progress: data.progress
        });
        
        // Send progress update to dashboard
        console.log('[Background] Forwarding progress update to dashboard:', data);
        this.sendMessageToPopup('updateTabProgress', {
            tabId: tabId,
            url: data.url,
            restaurantName: data.restaurantName,
            progress: data.progress,
            status: data.status
        });
        
        console.log(`Tab ${tabId} progress: ${data.progress.current}/${data.progress.total} - ${data.restaurantName}`);
    }

    extractRestaurantNameFromUrl(url) {
        try {
            // Try to extract restaurant name from the URL
            if (url.includes('entity_id=')) {
                // For reviews_new.php URLs, we might not have the name in the URL
                return 'Unknown Restaurant';
            }
            
            // For regular restaurant URLs like /restaurant/name/id
            const match = url.match(/\/restaurant\/([^\/]+)\/\d+/);
            if (match) {
                return decodeURIComponent(match[1]).replace(/-/g, ' ');
            }
            
            return 'Unknown Restaurant';
        } catch (error) {
            return 'Unknown Restaurant';
        }
    }

    async downloadResults() {
        this.addLog('Creating Excel download for results...');
        
        try {
            // Create Excel-compatible CSV content
            const csvContent = this.generateExcelCSV();
            
            // Create data URL instead of blob URL
            const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            
            chrome.downloads.download({
                url: dataUrl,
                filename: `autozomato_results_${timestamp}.csv`
            });
            
            this.addLog('Excel file download initiated');
        } catch (error) {
            this.addLog('Error creating Excel file: ' + error.message, 'error');
            console.error('Excel export error:', error);
        }
    }

    generateExcelCSV() {
        // CSV Headers
        const headers = [
            'Restaurant Name',
            'Customer Name',
            'Extracted Name',
            'Review ID',
            'Review Text',
            'Rating',
            'Adjusted Rating',
            'Sentiment',
            'Complaint ID',
            'Name Confidence',
            'Generated Reply',
            'Replied Status',
            'Included in Auto-Reply',
            'URL',
            'Timestamp'
        ];
        
        // Convert detailed review logs to CSV rows
        const rows = this.detailedReviewLogs.map(log => [
            this.escapeCsvValue(log.restaurantName || 'Unknown Restaurant'),
            this.escapeCsvValue(log.customerName || ''),
            this.escapeCsvValue(log.extractedName || ''),
            this.escapeCsvValue(log.reviewId || ''),
            this.escapeCsvValue(log.reviewText || ''),
            this.escapeCsvValue(log.rating || 'N/A'),
            this.escapeCsvValue(log.adjustedRating || ''),
            this.escapeCsvValue(log.sentiment || 'Unknown'),
            this.escapeCsvValue(log.complaintId || 'None'),
            this.escapeCsvValue(Math.round((log.confidence || 0) * 100) + '%'),
            this.escapeCsvValue(log.reply || ''),
            log.replied ? 'Yes' : 'No',
            log.includeInAutoReply ? 'Yes' : 'No',
            this.escapeCsvValue(log.url || ''),
            this.escapeCsvValue(log.timestamp || '')
        ]);
        
        // Add summary row if no detailed logs
        if (rows.length === 0) {
            rows.push([
                'No detailed review data available',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                new Date().toISOString()
            ]);
        }
        
        // Combine headers and rows
        const csvLines = [headers, ...rows];
        
        // Convert to CSV string
        return csvLines.map(row => row.join(',')).join('\n');
    }

    escapeCsvValue(value) {
        if (value === null || value === undefined) {
            return '';
        }
        
        const stringValue = String(value);
        
        // If value contains comma, quote, or newline, wrap in quotes and escape quotes
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return '"' + stringValue.replace(/"/g, '""') + '"';
        }
        
        return stringValue;
    }

    async loadSettingsFromJson() {
        try {
            const response = await fetch(chrome.runtime.getURL('settings.json'));
            if (response.ok) {
                const settings = await response.json();
                return { success: true, settings };
            } else {
                return { success: false, error: 'Settings file not found' };
            }
        } catch (error) {
            console.error('Error loading settings.json:', error);
            return { success: false, error: error.message };
        }
    }

    async saveSettingsToJson(settings) {
        // Note: Chrome extensions cannot write to files directly for security reasons
        // This method is here for completeness but won't work
        try {
            // This would require additional permissions and is not recommended
            // for security reasons in Chrome extensions
            return { success: false, error: 'Saving settings to file is not supported in Chrome extensions' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async fetchRestaurantName(url) {
        try {
            // Create a temporary tab to fetch the restaurant name
            const tab = await chrome.tabs.create({ url: url, active: false });
            
            // Wait for the page to load
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Try to extract the restaurant name
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    // Try multiple selectors for restaurant name
                    const selectors = [
                        '#res-main-name .header',
                        '.res-main-name .header',
                        '.restaurant-name',
                        '.res-name',
                        'h1[data-testid="restaurant-name"]',
                        '.restaurant-header h1',
                        '.page-header h1'
                    ];
                    
                    for (const selector of selectors) {
                        const element = document.querySelector(selector);
                        if (element) {
                            return element.textContent.trim();
                        }
                    }
                    
                    // Fallback to page title if no specific element found
                    const title = document.title;
                    if (title && !title.includes('Zomato')) {
                        return title.split(' - ')[0].trim();
                    }
                    
                    return null;
                }
            });
            
            // Close the temporary tab
            await chrome.tabs.remove(tab.id);
            
            const restaurantName = results && results[0] && results[0].result;
            if (restaurantName) {
                return { success: true, name: restaurantName };
            } else {
                return { success: false, error: 'Restaurant name not found' };
            }
            
        } catch (error) {
            console.error('Error fetching restaurant name:', error);
            return { success: false, error: error.message };
        }
    }

    async loadPromptContext() {
        try {
            const settingsResult = await this.loadSettingsFromJson();
            if (settingsResult.success) {
                console.log('[AutoZomato] Raw settings loaded from settings.json:', settingsResult.settings);
                
                // Load prompt context
                if (settingsResult.settings.promptContext) {
                    this.promptContext = settingsResult.settings.promptContext;
                    this.config.promptContext = this.promptContext;
                    console.log('[AutoZomato] Loaded prompt context from settings.json:', this.promptContext);
                } else {
                    console.log('[AutoZomato] No prompt context found in settings.json, using defaults');
                    this.promptContext = {};
                }
                
                // Load GPT mode configuration from Chrome storage FIRST (page.html interface has priority)
                try {
                    const chromeStorageGpt = await chrome.storage.local.get([
                        'gptModeEnabled', 'gptApiKey', 'gptKeyName', 'gptModel'
                    ]);
                    
                    console.log('[AutoZomato] Chrome storage GPT settings:', {
                        enabled: chromeStorageGpt.gptModeEnabled,
                        hasApiKey: !!chromeStorageGpt.gptApiKey,
                        keyName: chromeStorageGpt.gptKeyName,
                        model: chromeStorageGpt.gptModel
                    });
                    
                    // Check if Chrome storage has GPT configuration (from page.html interface)
                    const hasChromeGptConfig = chromeStorageGpt.gptModeEnabled !== undefined || 
                                             chromeStorageGpt.gptApiKey !== undefined;
                    
                    if (hasChromeGptConfig) {
                        // Use Chrome storage configuration (from page.html)
                        this.config.gptMode = {
                            enabled: chromeStorageGpt.gptModeEnabled || false,
                            apiKey: chromeStorageGpt.gptApiKey || '',
                            keyName: chromeStorageGpt.gptKeyName || 'AutoZomato GPT Key',
                            model: chromeStorageGpt.gptModel || 'gpt-4o-mini'
                        };
                        
                        console.log('[AutoZomato] ✓ Using GPT configuration from Chrome storage (page.html interface):');
                        console.log('  - Enabled:', this.config.gptMode.enabled);
                        console.log('  - Has API key:', !!this.config.gptMode.apiKey && this.config.gptMode.apiKey !== 'YOUR_OPENAI_API_KEY_HERE');
                        console.log('  - API key length:', this.config.gptMode.apiKey?.length || 0);
                        console.log('  - Model:', this.config.gptMode.model);
                        
                    } else if (settingsResult.settings.gptMode) {
                        // Fallback to settings.json if no Chrome storage config
                        const originalGptConfig = JSON.parse(JSON.stringify(this.config.gptMode)); // Deep copy
                        this.config.gptMode = {
                            ...this.config.gptMode, // Keep defaults
                            ...settingsResult.settings.gptMode // Override with settings.json values
                        };
                        
                        console.log('[AutoZomato] ⚠ Using GPT configuration from settings.json (fallback):');
                        console.log('  - Original config:', originalGptConfig);
                        console.log('  - From settings.json:', settingsResult.settings.gptMode);
                        console.log('  - Final merged config:', this.config.gptMode);
                        console.log('  - Enabled:', this.config.gptMode.enabled);
                        console.log('  - Has API key:', !!this.config.gptMode.apiKey && this.config.gptMode.apiKey !== 'YOUR_OPENAI_API_KEY_HERE');
                        console.log('  - API key length:', this.config.gptMode.apiKey?.length || 0);
                        console.log('  - Model:', this.config.gptMode.model);
                    } else {
                        console.log('[AutoZomato] ℹ No GPT mode configuration found in Chrome storage or settings.json, using defaults');
                    }
                    
                } catch (chromeStorageError) {
                    console.error('[AutoZomato] Error loading GPT config from Chrome storage:', chromeStorageError);
                    
                    // Fallback to settings.json if Chrome storage fails
                    if (settingsResult.settings.gptMode) {
                        this.config.gptMode = {
                            ...this.config.gptMode,
                            ...settingsResult.settings.gptMode
                        };
                        console.log('[AutoZomato] Using settings.json GPT config as fallback');
                    }
                }
            } else {
                console.log('[AutoZomato] Failed to load settings.json, using defaults:', settingsResult.error);
                this.promptContext = {};
            }
        } catch (error) {
            console.error('[AutoZomato] Error loading prompt context:', error);
            this.promptContext = {};
        }
    }

    forwardReviewProcessedToTabs(reviewData) {
        // Forward review processing data to all dashboard tabs
        console.log('[Background] Forwarding reviewProcessed to dashboard tabs:', reviewData);
        chrome.tabs.query({}, (tabs) => {
            const dashboardTabs = tabs.filter(tab => tab.url && tab.url.includes('page.html'));
            console.log('[Background] Found dashboard tabs:', dashboardTabs.length);
            console.log('[Background] Dashboard tab URLs:', dashboardTabs.map(tab => tab.url));
            
            dashboardTabs.forEach(tab => {
                console.log('[Background] Sending reviewProcessed to tab:', tab.id);
                chrome.tabs.sendMessage(tab.id, {
                    action: 'reviewProcessed',
                    reviewData: reviewData
                }).catch((error) => {
                    console.log('[Background] Error sending message to tab:', tab.id, error);
                });
            });
        });
    }
}

new AutoZomatoBackground();
