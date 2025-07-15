class PopupController {
    constructor() {
        this.isProcessing = false;
        this.currentProgress = { current: 0, total: 0 };
        this.tabStatuses = new Map();
        this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
        this.urls = [];
        this.groups = []; // Array of group objects: { id, name, urls }
        this.selectedUrls = new Set(); // Set of selected URL indices
        this.selectedGroups = new Set(); // Set of selected group IDs
        this.currentGroupId = null; // Currently selected group for display
        this.restaurantNameMap = new Map(); // Store restaurant ID to name mapping
        this.lastRunDate = null; // Store last run date
        
        this.initializeElements();
        this.bindEvents();
        this.setupMessageListener();
        this.loadStateOnStartup();
    }

    initializeElements() {
        this.elements = {
            // Main controls
            startBtn: document.getElementById('start-btn'),
            stopBtn: document.getElementById('stop-btn'),
            autoReplyToggle: document.getElementById('auto-reply-toggle'),
            autoCloseToggle: document.getElementById('auto-close-toggle'),
            
            // Date range controls
            startDateInput: document.getElementById('start-date-input'),
            endDateInput: document.getElementById('end-date-input'),
            
            // Expiry message
            expiryMessage: document.getElementById('expiry-message'),

            // Group management
            groupList: document.getElementById('group-list'),
            createGroupBtn: document.getElementById('create-group-btn'),
            groupInputContainer: document.getElementById('group-input-container'),
            newGroupName: document.getElementById('new-group-name'),
            saveGroupBtn: document.getElementById('save-group-btn'),
            cancelGroupBtn: document.getElementById('cancel-group-btn'),
            selectAllGroupsBtn: document.getElementById('select-all-groups'),
            deselectAllGroupsBtn: document.getElementById('deselect-all-groups'),
            processSelectedGroupsBtn: document.getElementById('process-selected-groups'),

            // URL management
            urlList: document.getElementById('url-list'),
            newUrlInput: document.getElementById('new-url-input'),
            addUrlBtn: document.getElementById('add-url-btn'),
            clearAllUrlsBtn: document.getElementById('clear-all-urls'),
            selectAllUrlsBtn: document.getElementById('select-all-urls'),
            deselectAllUrlsBtn: document.getElementById('deselect-all-urls'),
            groupSelector: document.getElementById('group-selector'),
            processSelectedBtn: document.getElementById('process-selected-btn'),
            
            // Processing progress
            progressSection: document.getElementById('progress-section'),
            resultsSection: document.getElementById('results-section'),
            overallProgressFill: document.getElementById('overall-progress-fill'),
            overallText: document.getElementById('overall-text'),
            tabProgress: document.getElementById('tab-progress'),
            
            // Logs and Status
            logsContainer: document.getElementById('logs-container'),
            clearLogsBtn: document.getElementById('clear-logs-btn'),
            status: document.getElementById('status'),

            // Results
            totalReviews: document.getElementById('total-reviews'),
            successfulReplies: document.getElementById('successful-replies'),
            errorCount: document.getElementById('error-count'),
            downloadBtn: document.getElementById('download-btn'),
            resultsTimestamp: document.getElementById('results-timestamp'),
            
            // Header
            closePopupBtn: document.getElementById('close-popup-btn'),
        };
    }

    bindEvents() {
        this.elements.startBtn.addEventListener('click', () => this.startProcessing());
        this.elements.stopBtn.addEventListener('click', () => this.stopProcessing());
        this.elements.downloadBtn.addEventListener('click', () => this.downloadResults());
        this.elements.closePopupBtn.addEventListener('click', () => window.close());
        this.elements.clearLogsBtn.addEventListener('click', () => this.clearLogs());
        
        // Group management events
        this.elements.createGroupBtn.addEventListener('click', () => this.showCreateGroupInput());
        this.elements.saveGroupBtn.addEventListener('click', () => this.saveNewGroup());
        this.elements.cancelGroupBtn.addEventListener('click', () => this.hideCreateGroupInput());
        this.elements.selectAllGroupsBtn.addEventListener('click', () => this.selectAllGroups());
        this.elements.deselectAllGroupsBtn.addEventListener('click', () => this.deselectAllGroups());
        this.elements.processSelectedGroupsBtn.addEventListener('click', () => this.processSelectedGroups());
        this.elements.newGroupName.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.saveNewGroup();
            if (e.key === 'Escape') this.hideCreateGroupInput();
        });
        
        // URL management events
        this.elements.addUrlBtn.addEventListener('click', () => this.addUrl());
        this.elements.newUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addUrl();
        });
        this.elements.clearAllUrlsBtn.addEventListener('click', () => this.clearAllUrls());
        this.elements.selectAllUrlsBtn.addEventListener('click', () => this.selectAllUrls());
        this.elements.deselectAllUrlsBtn.addEventListener('click', () => this.deselectAllUrls());
        this.elements.groupSelector.addEventListener('change', () => this.onGroupSelectorChange());
        this.elements.processSelectedBtn.addEventListener('click', () => this.processSelectedUrls());
        
        // Date change events
        this.elements.startDateInput.addEventListener('change', () => this.saveData());
        this.elements.endDateInput.addEventListener('change', () => this.saveData());
        
        // Save toggle states on change
        this.elements.autoReplyToggle.addEventListener('change', () => this.handleToggleChange());
        this.elements.autoCloseToggle.addEventListener('change', () => this.handleToggleChange());
    }

    handleToggleChange() {
        this.saveData(); // Save the state as before

        // Also send a message to the background script to update its live config
        const autoReply = this.elements.autoReplyToggle.checked;
        const autoClose = this.elements.autoCloseToggle.checked;

        chrome.runtime.sendMessage({
            action: 'updateConfig',
            data: {
                autoReply,
                autoClose
            }
        });
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.action) {
                case 'updateState':
                    this.updateFullState(message.data);
                    break;
                case 'updateProgress':
                    this.updateOverallProgress(message.current, message.total);
                    break;
                case 'updateTabStatus':
                    this.updateTabStatus(message.tabId, message.url, message.status, message.data);
                    break;
                case 'processingComplete':
                    this.handleProcessingComplete(message.results);
                    break;
                case 'error':
                    this.handleError(message.error);
                    break;
                case 'log':
                    this.addLogEntry(message.message, message.type, message.timestamp);
                    break;
            }
        });
    }

    updateFullState(state) {
        this.isProcessing = state.isProcessing;
        this.currentProgress = state.progress;
        this.results = state.results;
        this.logs = state.logs;
        this.tabStatuses = new Map(state.tabStatuses.map(s => [s.tabId, s]));

        if (state.isExpired) {
            this.handleExpiry();
        } else {
            this.render();
        }
    }

    render() {
        // Update UI elements based on current state
        this.renderGroupList();
        this.updateGroupSelector();
        this.renderUrlList();
        this.updateProcessSelectedButton();
        this.updateProcessSelectedGroupsButton();
        this.updateStartButtonText();
        
        // Update processing state UI
        if (this.isProcessing) {
            this.elements.startBtn.disabled = true;
            this.elements.stopBtn.disabled = false;
            this.elements.progressSection.style.display = 'block';
            this.elements.resultsSection.style.display = 'none'; // Hide results during processing
            this.updateOverallProgress(this.currentProgress.current, this.currentProgress.total);
        } else {
            this.elements.startBtn.disabled = false;
            this.elements.stopBtn.disabled = true;
            this.elements.progressSection.style.display = 'none';
            
            // Show previous results if available and not processing
            this.showPreviousResults();
        }
        
        // Update results if available
        if (this.results) {
            this.elements.totalReviews.textContent = this.results.totalReviews || 0;
            this.elements.successfulReplies.textContent = this.results.successfulReplies || 0;
            this.elements.errorCount.textContent = this.results.errors || 0;
        }
        
        // Restore logs if available
        if (this.logs && this.logs.length > 0) {
            this.elements.logsContainer.innerHTML = '';
            this.logs.forEach(log => {
                this.addLogEntry(log.message, log.type, log.timestamp);
            });
        }
    }

    handleExpiry() {
        this.elements.expiryMessage.style.display = 'block';
        this.elements.startBtn.disabled = true;
        this.elements.stopBtn.disabled = true;
        this.elements.autoReplyToggle.disabled = true;
        this.elements.autoCloseToggle.disabled = true;
        this.elements.addUrlBtn.disabled = true;
        this.elements.clearAllUrlsBtn.disabled = true;
        this.elements.newUrlInput.disabled = true;
        this.updateStatus('Extension Expired', 'error');
    }

    async loadStateOnStartup() {
        // First, load saved URLs and settings from chrome.storage.local
        await this.loadSavedData();
        
        // Then load URLs from settings.json if available
        await this.loadUrlsFromSettings();
        
        // Request notification permission for completion alerts
        this.requestNotificationPermission();
        
        // Finally, get the processing state
        chrome.runtime.sendMessage({ action: 'getProcessingState' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Error getting processing state:", chrome.runtime.lastError.message);
                return;
            }
            this.updateFullState(response);
        });
    }

    async loadSavedData() {
        try {
            const data = await chrome.storage.local.get([
                'urls', 'groups', 'selectedGroups', 'autoReply', 'autoClose', 'restaurantNameMap', 
                'lastRunDate', 'lastResults', 'lastResultsTimestamp'
            ]);
            
            if (data.urls && Array.isArray(data.urls)) {
                this.urls = data.urls;
                this.addLog(`Loaded ${this.urls.length} URLs from previous session`, 'info');
            }
            
            if (data.groups && Array.isArray(data.groups)) {
                this.groups = data.groups;
                this.addLog(`Loaded ${this.groups.length} groups from previous session`, 'info');
            }
            
            if (data.selectedGroups && Array.isArray(data.selectedGroups)) {
                this.selectedGroups = new Set(data.selectedGroups);
                this.addLog(`Restored selection of ${this.selectedGroups.size} groups`, 'info');
            }
            
            if (data.autoReply !== undefined) {
                this.elements.autoReplyToggle.checked = data.autoReply;
            }
            
            if (data.autoClose !== undefined) {
                this.elements.autoCloseToggle.checked = data.autoClose;
            }
            
            if (data.restaurantNameMap) {
                this.restaurantNameMap = new Map(Object.entries(data.restaurantNameMap));
            }
            
            if (data.lastRunDate) {
                this.lastRunDate = data.lastRunDate;
            }
            
            // Restore last results if available
            if (data.lastResults && data.lastResultsTimestamp) {
                this.results = data.lastResults;
                this.lastResultsTimestamp = data.lastResultsTimestamp;
                this.showPreviousResults();
            }
            
            this.initializeDateInputs();
            this.renderGroupList();
            this.updateGroupSelector();
            this.renderUrlList();
        } catch (error) {
            console.error('Error loading saved data:', error);
            this.addLog('Error loading saved settings', 'warning');
        }
    }

    initializeDateInputs() {
        // Set end date to current date
        const today = new Date().toISOString().split('T')[0];
        this.elements.endDateInput.value = today;
        
        // Set start date to last run date or default to beginning of current year
        if (this.lastRunDate) {
            this.elements.startDateInput.value = this.lastRunDate;
        } else {
            const startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
            this.elements.startDateInput.value = startOfYear;
        }
    }

    async loadUrlsFromSettings() {
        try {
            // Try to load settings through background script
            const response = await chrome.runtime.sendMessage({ action: 'loadSettingsFromJson' });
            if (response && response.success && response.settings && response.settings.urls) {
                // Merge with existing URLs, avoiding duplicates
                response.settings.urls.forEach(url => {
                    if (!this.urls.includes(url)) {
                        this.urls.push(url);
                    }
                });
                this.renderUrlList();
                this.addLog(`Loaded ${response.settings.urls.length} URLs from settings.json`, 'info');
            }
        } catch (error) {
            // If background script method fails, try direct fetch
            try {
                const response = await fetch('/settings.json');
                if (response.ok) {
                    const settings = await response.json();
                    if (settings.urls && Array.isArray(settings.urls)) {
                        // Merge with existing URLs, avoiding duplicates
                        settings.urls.forEach(url => {
                            if (!this.urls.includes(url)) {
                                this.urls.push(url);
                            }
                        });
                        this.renderUrlList();
                        this.addLog(`Loaded ${settings.urls.length} URLs from settings.json`, 'info');
                    }
                }
            } catch (error2) {
                console.log('settings.json not found or not accessible, using stored URLs only');
            }
        }
    }

    async saveData() {
        const state = {
            urls: this.urls,
            groups: this.groups,
            selectedGroups: Array.from(this.selectedGroups), // Convert Set to Array for storage
            autoReply: this.elements.autoReplyToggle.checked,
            autoClose: this.elements.autoCloseToggle.checked,
            restaurantNameMap: Object.fromEntries(this.restaurantNameMap),
            lastRunDate: this.elements.startDateInput?.value || null,
            lastResults: this.results, // Save the last processing results
            lastResultsTimestamp: this.lastResultsTimestamp || null, // Save when results were generated
        };

        try {
            await chrome.storage.local.set(state);
        } catch (error) {
            console.error('Error saving data:', error);
            this.addLog('Error saving settings', 'error');
        }
    }

    async restoreProcessingState() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getProcessingState' });
            
            if (response && response.isProcessing) {
                this.isProcessing = true;
                this.urls = response.urls || [];
                this.currentProgress = response.progress || { current: 0, total: 0 };
                this.results = response.results || { totalReviews: 0, successfulReplies: 0, errors: 0 };

                this.elements.startBtn.disabled = true;
                this.elements.stopBtn.disabled = false;
                this.elements.progressSection.style.display = 'block';

                this.renderUrlList();
                this.updateOverallProgress(this.currentProgress.current, this.currentProgress.total);

                if (response.tabStatuses) {
                    response.tabStatuses.forEach(tabStatus => {
                        this.updateTabStatus(tabStatus.tabId, tabStatus.url, tabStatus.status, tabStatus.data);
                    });
                }

                if (response.logs) {
                    this.elements.logsContainer.innerHTML = ''; // Clear before restoring
                    response.logs.forEach(log => {
                        this.addLogEntry(log.message, log.type, log.timestamp);
                    });
                }
                
                this.updateStatus('Processing in progress...');
                this.addLog('Restored active processing state', 'info');
            }
        } catch (error) {
            console.error('Error restoring state:', error);
            this.addLog('Could not restore processing state', 'warning');
        }
    }

    getSelectedUrls() {
        // If no URLs are selected, return all URLs (backwards compatibility)
        if (this.selectedUrls.size === 0) {
            return [...this.urls];
        }

        // Return only selected URLs
        return Array.from(this.selectedUrls).map(index => this.urls[index]).filter(url => url);
    }

    async startProcessing() {
        if (this.isProcessing) return;
        
        // Get selected URLs for processing
        const urlsToProcess = this.getSelectedUrls();
        
        if (urlsToProcess.length === 0) {
            this.updateStatus('Please add at least one URL or select URLs to process');
            this.addLog('Cannot start: No URLs selected for processing', 'error');
            return;
        }
        
        // Validate date inputs
        const startDate = this.elements.startDateInput.value;
        const endDate = this.elements.endDateInput.value;
        
        if (!startDate || !endDate) {
            this.updateStatus('Please select both start and end dates');
            this.addLog('Cannot start: Date range not specified', 'error');
            return;
        }
        
        if (new Date(startDate) > new Date(endDate)) {
            this.updateStatus('Start date cannot be after end date');
            this.addLog('Cannot start: Invalid date range', 'error');
            return;
        }
        
        // Process URLs to add date ranges for Zomato URLs
        this.addLog('Processing URLs and adding date ranges...', 'info');
        const processedUrls = [];
        
        for (const url of urlsToProcess) {
            try {
                const processedUrl = await this.processZomatoUrl(url);
                processedUrls.push(processedUrl);
            } catch (error) {
                this.addLog(`Error processing URL ${url}: ${error.message}`, 'warning');
                processedUrls.push(url); // Use original URL if processing fails
            }
        }
        
        await this.saveData();
        this.clearLogs();
        
        // Log selection info
        if (this.selectedUrls.size > 0) {
            this.addLog(`🚀 Starting processing for ${processedUrls.length} selected URLs (out of ${this.urls.length} total)...`, 'info');
        } else {
            this.addLog(`🚀 Starting processing for all ${processedUrls.length} URLs...`, 'info');
        }
        this.addLog(`📅 Date range: ${startDate} to ${endDate}`, 'info');
        
        this.isProcessing = true;
        this.elements.startBtn.disabled = true;
        this.elements.stopBtn.disabled = false;
        this.elements.progressSection.style.display = 'block';
        this.elements.resultsSection.style.display = 'none';
        
        this.currentProgress = { current: 0, total: processedUrls.length };
        this.tabStatuses.clear();
        this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
        this.lastResultsTimestamp = null; // Clear previous results timestamp
        
        this.updateOverallProgress(0, processedUrls.length);
        this.elements.tabProgress.innerHTML = '';
        this.updateStatus('Starting processing...');
        
        try {
            await chrome.runtime.sendMessage({
                action: 'startProcessing',
                data: {
                    urls: processedUrls,
                    autoReply: this.elements.autoReplyToggle.checked,
                    autoClose: this.elements.autoCloseToggle.checked,
                }
            });
            this.addLog('Processing initiated successfully', 'success');
        } catch (error) {
            this.handleError('Failed to send start command: ' + error.message);
        }
    }

    async stopProcessing() {
        if (!this.isProcessing) return;
        
        try {
            await chrome.runtime.sendMessage({ action: 'stopProcessing' });
            this.resetUI();
            this.updateStatus('Processing stopped by user');
            this.addLog('🛑 Processing stopped by user', 'warning');
        } catch (error) {
            this.handleError('Error stopping processing: ' + error.message);
        }
    }

    updateOverallProgress(current, total) {
        this.currentProgress = { current, total };
        const percentage = total > 0 ? (current / total) * 100 : 0;
        this.elements.overallProgressFill.style.width = `${percentage}%`;
        this.elements.overallText.textContent = `${current} / ${total} URLs processed`;
    }

    updateTabStatus(tabId, url, status, data = {}) {
        this.tabStatuses.set(tabId, { url, status, data });
        
        let tabItem = document.querySelector(`[data-tab-id="${tabId}"]`);
        if (!tabItem) {
            tabItem = document.createElement('div');
            tabItem.className = 'tab-item';
            tabItem.setAttribute('data-tab-id', tabId);
            this.elements.tabProgress.appendChild(tabItem);
        }
        
        tabItem.className = `tab-item ${status}`;
        const urlDisplay = url.length > 50 ? url.substring(0, 47) + '...' : url;
        let statusText = '';
        
        switch (status) {
            case 'processing':
                statusText = 'Scraping & replying...';
                break;
            case 'completed':
                statusText = `✔ Completed: ${data.repliesCount || 0} replies`;
                this.results.totalReviews += data.reviewCount || 0;
                this.results.successfulReplies += data.repliesCount || 0;
                break;
            case 'error':
                statusText = `✖ Error: ${data.error || 'Unknown'}`;
                this.results.errors += 1;
                break;
        }
        
        tabItem.innerHTML = `
            <div class="tab-item-url">${urlDisplay}</div>
            <div class="tab-item-status">${statusText}</div>
        `;
    }

    handleProcessingComplete(results) {
        this.resetUI();
        this.elements.resultsSection.style.display = 'block';
        
        this.elements.totalReviews.textContent = this.results.totalReviews;
        this.elements.successfulReplies.textContent = this.results.successfulReplies;
        this.elements.errorCount.textContent = this.results.errors;
        
        // Hide timestamp for fresh results (only shown for previous results)
        this.elements.resultsTimestamp.style.display = 'none';
        
        // Save timestamp for when results were generated
        this.lastResultsTimestamp = new Date().toISOString();
        this.saveData(); // Save results and timestamp
        
        const completionMessage = `🎉 Processing complete. Found ${this.results.totalReviews} reviews, replied to ${this.results.successfulReplies}.`;
        this.updateStatus('Processing complete!');
        this.addLog(completionMessage, 'success');
        this.addLog('📊 Click "Download Excel Report" to get detailed results with review data and replies', 'info');
        
        // Show alert based on processing results
        this.showCompletionAlert();
    }

    showCompletionAlert() {
        const totalReviews = this.results.totalReviews;
        const successfulReplies = this.results.successfulReplies;
        const unansweredReviews = totalReviews - successfulReplies;
        
        let alertMessage = '';
        let alertType = 'success';
        
        if (unansweredReviews === 0 && totalReviews > 0) {
            // All reviews are replied to
            alertMessage = `✅ Page Status: RESOLVED\n\nAll ${totalReviews} reviews have been replied to successfully!`;
            alertType = 'success';
        } else if (unansweredReviews > 0) {
            // Some reviews remain unanswered
            alertMessage = `⚠️ Page Status: UNANSWERED\n\n${unansweredReviews} out of ${totalReviews} reviews still need replies.`;
            alertType = 'warning';
        } else if (totalReviews === 0) {
            // No reviews found
            alertMessage = `ℹ️ Page Status: NO REVIEWS\n\nNo reviews found in the selected date range.`;
            alertType = 'info';
        }
        
        // Show browser alert
        alert(alertMessage);
        
        // Also show notification if supported
        if ('Notification' in window && Notification.permission === 'granted') {
            const notificationTitle = totalReviews === 0 ? 'No Reviews Found' : 
                                    unansweredReviews === 0 ? 'All Reviews Resolved' : 
                                    'Reviews Still Pending';
            
            new Notification(notificationTitle, {
                body: alertMessage.replace(/[✅⚠️ℹ️]/g, '').trim(),
                icon: chrome.runtime.getURL('icons/icon48.png'),
                tag: 'autozomato-completion'
            });
        }
        
        // Log the completion status
        const logMessage = totalReviews === 0 ? '📋 No reviews found in the selected date range' :
                          unansweredReviews === 0 ? '✅ All reviews have been replied to - page is fully resolved!' :
                          `⚠️ ${unansweredReviews} reviews still need replies - page has unanswered reviews`;
        
        this.addLog(logMessage, alertType === 'success' ? 'success' : alertType === 'warning' ? 'error' : 'info');
    }
    
    // Request notification permission when popup loads
    requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    this.addLog('📢 Notifications enabled for completion alerts', 'info');
                }
            });
        }
    }

    handleError(error) {
        this.resetUI();
        this.updateStatus(`Error: ${error}`);
        this.addLog(`Critical error: ${error}`, 'error');
        console.error('Processing error:', error);
    }

    resetUI() {
        this.isProcessing = false;
        this.elements.startBtn.disabled = false;
        this.elements.stopBtn.disabled = true;
    }

    updateStatus(message) {
        this.elements.status.textContent = message;
    }

    // URL Management Methods
    extractRestaurantId(url) {
        // Extract restaurant ID from Zomato URLs
        const patterns = [
            /entity_id=(\d+)/,
            /\/restaurant\/[^\/]+\/(\d+)/,
            /\/(\d+)(?:\?|$)/
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                return match[1];
            }
        }
        return null;
    }

    buildReviewsUrl(restaurantId, startDate, endDate) {
        return `https://www.zomato.com/clients/reviews_new.php?entity_type=restaurant&entity_id=${restaurantId}&start_date=${startDate}&end_date=${endDate}`;
    }

    async processZomatoUrl(url) {
        const restaurantId = this.extractRestaurantId(url);
        if (!restaurantId) {
            return url; // Return original URL if no ID found
        }

        // Check if we already have the restaurant name
        if (this.restaurantNameMap.has(restaurantId)) {
            const startDate = this.elements.startDateInput.value;
            const endDate = this.elements.endDateInput.value;
            return this.buildReviewsUrl(restaurantId, startDate, endDate);
        }

        // If it's a reviews_new.php URL, we can use it directly
        if (url.includes('reviews_new.php')) {
            const startDate = this.elements.startDateInput.value;
            const endDate = this.elements.endDateInput.value;
            return this.buildReviewsUrl(restaurantId, startDate, endDate);
        }

        // For other URLs, we need to fetch the restaurant name first
        try {
            const restaurantName = await this.fetchRestaurantName(url);
            if (restaurantName) {
                this.restaurantNameMap.set(restaurantId, restaurantName);
                this.addLog(`Mapped restaurant "${restaurantName}" to ID ${restaurantId}`, 'info');
                await this.saveData();
            }
            
            const startDate = this.elements.startDateInput.value;
            const endDate = this.elements.endDateInput.value;
            return this.buildReviewsUrl(restaurantId, startDate, endDate);
        } catch (error) {
            this.addLog(`Failed to fetch restaurant name for ${url}: ${error.message}`, 'warning');
            return url; // Return original URL if fetching fails
        }
    }

    async fetchRestaurantName(url) {
        // This will be handled by the background script
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'fetchRestaurantName',
                url: url
            }, (response) => {
                if (response && response.success) {
                    resolve(response.name);
                } else {
                    resolve(null);
                }
            });
        });
    }

    addUrl() {
        const newUrl = this.elements.newUrlInput.value.trim();
        if (newUrl && this.isValidUrl(newUrl)) {
            if (!this.urls.includes(newUrl)) {
                this.urls.push(newUrl);
                this.renderUrlList();
                this.saveData();
                this.elements.newUrlInput.value = '';
            } else {
                this.addLog('URL already exists', 'warning');
            }
        } else {
            this.addLog('Invalid URL format', 'error');
        }
    }

    removeUrl(urlToRemove) {
        this.urls = this.urls.filter(url => url !== urlToRemove);
        this.renderUrlList();
        this.saveData();
    }

    clearAllUrls() {
        this.urls = [];
        this.renderUrlList();
        this.saveData();
        this.addLog('All URLs cleared', 'info');
    }

    renderUrlList() {
        this.elements.urlList.innerHTML = '';
        
        // Determine which URLs to display
        let urlsToDisplay = [];
        if (this.currentGroupId) {
            const group = this.groups.find(g => g.id === this.currentGroupId);
            urlsToDisplay = group ? group.urls : [];
        } else {
            urlsToDisplay = this.urls;
        }
        
        if (urlsToDisplay.length === 0) {
            const emptyMessage = this.currentGroupId 
                ? 'No URLs in this group yet. Add URLs from the main list below.'
                : 'No URLs added yet.';
            this.elements.urlList.innerHTML = `<div class="empty-urls">${emptyMessage}</div>`;
            return;
        }
        
        urlsToDisplay.forEach((url, localIndex) => {
            // Calculate the global index in this.urls array
            const globalIndex = this.currentGroupId ? 
                this.urls.findIndex(u => u === url) : 
                localIndex;
                
            const item = document.createElement('div');
            item.className = `url-item ${this.selectedUrls.has(globalIndex) ? 'selected' : ''}`;
            
            // Add checkbox for selection
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'url-checkbox';
            checkbox.checked = this.selectedUrls.has(globalIndex);
            checkbox.addEventListener('change', () => this.toggleUrlSelection(globalIndex));
            item.appendChild(checkbox);
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'url-content';
            
            const text = document.createElement('div');
            text.className = 'url-text';
            
            // Check if this is a Zomato URL and we have a restaurant name
            const restaurantId = this.extractRestaurantId(url);
            let displayText = url;
            
            if (restaurantId && this.restaurantNameMap.has(restaurantId)) {
                const restaurantName = this.restaurantNameMap.get(restaurantId);
                displayText = `${restaurantName} (ID: ${restaurantId})`;
                text.innerHTML = `
                    <div class="restaurant-name">${restaurantName}</div>
                    <div class="restaurant-id">ID: ${restaurantId}</div>
                `;
            } else {
                text.textContent = url.length > 60 ? url.substring(0, 57) + '...' : url;
            }
            
            if (!restaurantId || !this.restaurantNameMap.has(restaurantId)) {
                text.textContent = url.length > 60 ? url.substring(0, 57) + '...' : url;
            }
            
            contentDiv.appendChild(text);
            
            // Action buttons container
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'url-actions-inline';
            
            // Group assignment dropdown (only show if not in a group view)
            if (!this.currentGroupId && this.groups.length > 0) {
                const groupSelect = document.createElement('select');
                groupSelect.className = 'url-group-select';
                groupSelect.innerHTML = '<option value="">Add to group...</option>';
                
                this.groups.forEach(group => {
                    if (!group.urls.includes(url)) {
                        const option = document.createElement('option');
                        option.value = group.id;
                        option.textContent = group.name;
                        groupSelect.appendChild(option);
                    }
                });
                
                groupSelect.addEventListener('change', (e) => {
                    if (e.target.value) {
                        this.addUrlToGroup(url, e.target.value);
                        e.target.value = '';
                    }
                });
                
                if (groupSelect.children.length > 1) {
                    actionsDiv.appendChild(groupSelect);
                }
            }
            
            // Remove button
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.textContent = '×';
            removeBtn.title = this.currentGroupId ? 'Remove from group' : 'Remove URL';
            removeBtn.onclick = () => {
                if (this.currentGroupId) {
                    this.removeUrlFromGroup(url, this.currentGroupId);
                } else {
                    this.removeUrl(url);
                }
            };
            actionsDiv.appendChild(removeBtn);
            
            contentDiv.appendChild(actionsDiv);
            item.appendChild(contentDiv);
            
            this.elements.urlList.appendChild(item);
        });
    }

    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    // Logging Methods
    addLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        this.addLogEntry(message, type, timestamp);
        
        // Persist logs for restoration
        chrome.runtime.sendMessage({ action: 'log', message, type, timestamp });
    }

    addLogEntry(message, type, timestamp) {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        
        const tsSpan = document.createElement('span');
        tsSpan.className = 'log-timestamp';
        tsSpan.textContent = timestamp;

        const msgSpan = document.createElement('span');
        msgSpan.className = 'log-message';
        msgSpan.textContent = message;

        logEntry.appendChild(tsSpan);
        logEntry.appendChild(msgSpan);
        
        this.elements.logsContainer.appendChild(logEntry);
        this.elements.logsContainer.scrollTop = this.elements.logsContainer.scrollHeight;
    }

    clearLogs() {
        this.elements.logsContainer.innerHTML = '';
        chrome.runtime.sendMessage({ action: 'clearLogs' });
    }

    // Results Methods
    downloadResults() {
        chrome.runtime.sendMessage({ action: 'downloadResults' });
        this.addLog('Excel report download requested - check Downloads folder', 'info');
    }

    // Date Handling Methods
    validateDateRange(startDate, endDate) {
        if (!startDate || !endDate) return false;
        
        const start = new Date(startDate);
        const end = new Date(endDate);
        const now = new Date();
        
        // Check if dates are valid
        if (isNaN(start) || isNaN(end)) return false;
        
        // Check if start date is not in the future
        if (start > now) return false;
        
        // Check if end date is not before start date
        if (end < start) return false;
        
        return true;
    }

    showPreviousResults() {
        if (!this.results || !this.lastResultsTimestamp) return;
        
        // Only show if not currently processing
        if (!this.isProcessing) {
            this.elements.resultsSection.style.display = 'block';
            
            this.elements.totalReviews.textContent = this.results.totalReviews || 0;
            this.elements.successfulReplies.textContent = this.results.successfulReplies || 0;
            this.elements.errorCount.textContent = this.results.errors || 0;
            
            // Show timestamp for previous results
            const resultDate = new Date(this.lastResultsTimestamp).toLocaleString();
            this.elements.resultsTimestamp.textContent = `Results from: ${resultDate}`;
            this.elements.resultsTimestamp.style.display = 'block';
            
            this.addLog(`📊 Previous results available from ${resultDate} - Click "Download Excel Report" to get detailed data`, 'info');
        }
    }
    
    // Group Management Methods
    showCreateGroupInput() {
        this.elements.groupInputContainer.style.display = 'flex';
        this.elements.newGroupName.focus();
        this.elements.createGroupBtn.disabled = true;
    }

    hideCreateGroupInput() {
        this.elements.groupInputContainer.style.display = 'none';
        this.elements.newGroupName.value = '';
        this.elements.createGroupBtn.disabled = false;
    }

    saveNewGroup() {
        const groupName = this.elements.newGroupName.value.trim();
        if (!groupName) {
            this.addLog('Please enter a group name', 'error');
            return;
        }

        // Check if group name already exists
        if (this.groups.some(group => group.name.toLowerCase() === groupName.toLowerCase())) {
            this.addLog('Group name already exists', 'error');
            return;
        }

        const newGroup = {
            id: Date.now().toString(),
            name: groupName,
            urls: []
        };

        this.groups.push(newGroup);
        this.hideCreateGroupInput();
        this.renderGroupList();
        this.updateGroupSelector();
        this.saveData();
        this.addLog(`Group "${groupName}" created successfully`, 'success');
    }

    editGroup(groupId) {
        const group = this.groups.find(g => g.id === groupId);
        if (!group) return;

        const newName = prompt('Enter new group name:', group.name);
        if (newName && newName.trim() && newName.trim() !== group.name) {
            const trimmedName = newName.trim();
            
            // Check if new name already exists
            if (this.groups.some(g => g.id !== groupId && g.name.toLowerCase() === trimmedName.toLowerCase())) {
                this.addLog('Group name already exists', 'error');
                return;
            }

            group.name = trimmedName;
            this.renderGroupList();
            this.updateGroupSelector();
            this.saveData();
            this.addLog(`Group renamed to "${trimmedName}"`, 'success');
        }
    }

    deleteGroup(groupId) {
        const group = this.groups.find(g => g.id === groupId);
        if (!group) return;

        if (confirm(`Are you sure you want to delete the group "${group.name}"?\n\nThis will remove ${group.urls.length} URLs from the group.`)) {
            // Add group URLs back to main URL list
            group.urls.forEach(url => {
                if (!this.urls.includes(url)) {
                    this.urls.push(url);
                }
            });

            this.groups = this.groups.filter(g => g.id !== groupId);
            
            // If this was the selected group, clear selection
            if (this.currentGroupId === groupId) {
                this.currentGroupId = null;
                this.elements.groupSelector.value = '';
            }

            this.renderGroupList();
            this.updateGroupSelector();
            this.renderUrlList();
            this.saveData();
            this.addLog(`Group "${group.name}" deleted`, 'success');
        }
    }

    selectGroup(groupId) {
        if (this.currentGroupId === groupId) {
            // Deselect if already selected
            this.currentGroupId = null;
            this.renderGroupList();
            this.renderUrlList();
        } else {
            this.currentGroupId = groupId;
            this.renderGroupList();
            this.renderUrlList();
            this.elements.groupSelector.value = groupId || '';
        }
        this.updateProcessSelectedButton();
    }

    onGroupSelectorChange() {
        const selectedGroupId = this.elements.groupSelector.value;
        this.currentGroupId = selectedGroupId || null;
        this.renderGroupList();
        this.renderUrlList();
        this.updateProcessSelectedButton();
    }

    addUrlToGroup(url, groupId) {
        const group = this.groups.find(g => g.id === groupId);
        if (!group || group.urls.includes(url)) return;

        group.urls.push(url);
        this.urls = this.urls.filter(u => u !== url);
        this.renderGroupList();
        this.renderUrlList();
        this.updateGroupSelector();
        this.saveData();
    }

    removeUrlFromGroup(url, groupId) {
        const group = this.groups.find(g => g.id === groupId);
        if (!group) return;

        group.urls = group.urls.filter(u => u !== url);
        if (!this.urls.includes(url)) {
            this.urls.push(url);
        }
        this.renderGroupList();
        this.renderUrlList();
        this.updateGroupSelector();
        this.saveData();
    }

    renderGroupList() {
        this.elements.groupList.innerHTML = '';
        
        if (this.groups.length === 0) {
            this.elements.groupList.innerHTML = '<div class="empty-groups">No groups created yet. Click "+ Group" to create one.</div>';
            return;
        }

        this.groups.forEach(group => {
            const item = document.createElement('div');
            item.className = `group-item ${this.currentGroupId === group.id ? 'selected' : ''}`;
            
            item.innerHTML = `
                <input type="checkbox" class="group-checkbox" ${this.selectedGroups.has(group.id) ? 'checked' : ''} 
                       onchange="controller.toggleGroupSelection('${group.id}')" title="Select group for processing">
                <div class="group-info" onclick="controller.selectGroup('${group.id}')">
                    <div class="group-name">${group.name}</div>
                    <div class="group-url-count">${group.urls.length} URLs</div>
                </div>
                <div class="group-actions">
                    <button class="group-edit-btn" onclick="controller.editGroup('${group.id}')" title="Edit Group">✏️</button>
                    <button class="group-delete-btn" onclick="controller.deleteGroup('${group.id}')" title="Delete Group">🗑️</button>
                </div>
            `;
            
            this.elements.groupList.appendChild(item);
        });
    }

    updateGroupSelector() {
        // Clear existing options except "No Group"
        this.elements.groupSelector.innerHTML = '<option value="">No Group</option>';
        
        // Add group options
        this.groups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = `${group.name} (${group.urls.length} URLs)`;
            this.elements.groupSelector.appendChild(option);
        });

        // Set current selection
        this.elements.groupSelector.value = this.currentGroupId || '';
    }

    // URL Selection Methods
    selectAllUrls() {
        // Determine which URLs to select based on current view
        let urlsToDisplay = [];
        if (this.currentGroupId) {
            const group = this.groups.find(g => g.id === this.currentGroupId);
            urlsToDisplay = group ? group.urls : [];
        } else {
            urlsToDisplay = this.urls;
        }
        
        urlsToDisplay.forEach((url) => {
            const globalIndex = this.urls.findIndex(u => u === url);
            if (globalIndex !== -1) {
                this.selectedUrls.add(globalIndex);
            }
        });
        
        this.updateGroupSelectionFromUrls();
        this.updateProcessSelectedButton();
        this.updateStartButtonText();
        this.renderUrlList();
        this.renderGroupList();
    }

    deselectAllUrls() {
        // Determine which URLs to deselect based on current view
        let urlsToDisplay = [];
        if (this.currentGroupId) {
            const group = this.groups.find(g => g.id === this.currentGroupId);
            urlsToDisplay = group ? group.urls : [];
        } else {
            urlsToDisplay = this.urls;
        }
        
        urlsToDisplay.forEach((url) => {
            const globalIndex = this.urls.findIndex(u => u === url);
            if (globalIndex !== -1) {
                this.selectedUrls.delete(globalIndex);
            }
        });
        
        this.updateGroupSelectionFromUrls();
        this.updateProcessSelectedButton();
        this.updateStartButtonText();
        this.renderUrlList();
        this.renderGroupList();
    }

    toggleUrlSelection(globalIndex) {
        if (this.selectedUrls.has(globalIndex)) {
            this.selectedUrls.delete(globalIndex);
        } else {
            this.selectedUrls.add(globalIndex);
        }
        
        // Update group selection status based on URL selections
        this.updateGroupSelectionFromUrls();
        this.updateProcessSelectedButton();
        this.updateStartButtonText();
        this.renderUrlList(); // Re-render to show updated selections
        this.renderGroupList(); // Re-render to show updated group selections
    }

    updateGroupSelectionFromUrls() {
        // Check each group to see if all its URLs are selected
        this.groups.forEach(group => {
            const groupUrls = group.urls;
            const selectedGroupUrls = groupUrls.filter(url => {
                const urlIndex = this.urls.findIndex(u => u === url);
                return urlIndex !== -1 && this.selectedUrls.has(urlIndex);
            });

            // If all URLs in the group are selected, select the group
            // If none or only some URLs are selected, deselect the group
            if (groupUrls.length > 0 && selectedGroupUrls.length === groupUrls.length) {
                this.selectedGroups.add(group.id);
            } else {
                this.selectedGroups.delete(group.id);
            }
        });
        
        this.updateProcessSelectedGroupsButton();
        this.saveData();
    }

    updateStartButtonText() {
        const selectedCount = this.selectedUrls.size;
        const totalCount = this.urls.length;
        
        if (selectedCount === 0) {
            this.elements.startBtn.textContent = `Start Processing (All ${totalCount} URLs)`;
        } else {
            this.elements.startBtn.textContent = `Start Processing (${selectedCount} of ${totalCount} URLs)`;
        }
    }

    updateProcessSelectedButton() {
        const hasSelection = this.selectedUrls.size > 0;
        this.elements.processSelectedBtn.disabled = !hasSelection;
        this.elements.processSelectedBtn.textContent = hasSelection 
            ? `Process Selected (${this.selectedUrls.size})` 
            : 'Process Selected';
    }

    processSelectedUrls() {
        const selectedUrlsList = Array.from(this.selectedUrls).map(index => {
            if (this.currentGroupId) {
                const group = this.groups.find(g => g.id === this.currentGroupId);
                return group ? group.urls[index] : null;
            } else {
                return this.urls[index];
            }
        }).filter(url => url);

        if (selectedUrlsList.length === 0) {
            this.addLog('No URLs selected for processing', 'error');
            return;
        }

        // Temporarily replace this.urls with selected URLs for processing
        const originalUrls = [...this.urls];
        const originalGroupUrls = this.currentGroupId ? 
            [...this.groups.find(g => g.id === this.currentGroupId).urls] : [];

        this.urls = selectedUrlsList;
        this.addLog(`Processing ${selectedUrlsList.length} selected URLs`, 'info');
        
        // Start processing with selected URLs
        this.startProcessing().then(() => {
            // Restore original URLs after processing starts
            this.urls = originalUrls;
            if (this.currentGroupId) {
                const group = this.groups.find(g => g.id === this.currentGroupId);
                if (group) group.urls = originalGroupUrls;
            }
        });
    }

    // Group Selection Methods
    toggleGroupSelection(groupId) {
        const group = this.groups.find(g => g.id === groupId);
        if (!group) return;

        if (this.selectedGroups.has(groupId)) {
            // Deselecting group - also deselect all its URLs
            this.selectedGroups.delete(groupId);
            this.deselectGroupUrls(group);
        } else {
            // Selecting group - also select all its URLs
            this.selectedGroups.add(groupId);
            this.selectGroupUrls(group);
        }
        this.updateProcessSelectedGroupsButton();
        this.updateProcessSelectedButton();
        this.updateStartButtonText();
        this.renderUrlList(); // Re-render to show updated selections
        this.saveData(); // Save selection state
    }

    selectGroupUrls(group) {
        // Add all URLs from this group to selectedUrls
        group.urls.forEach(url => {
            const urlIndex = this.urls.findIndex(u => u === url);
            if (urlIndex !== -1) {
                this.selectedUrls.add(urlIndex);
            }
        });
    }

    deselectGroupUrls(group) {
        // Remove all URLs from this group from selectedUrls
        group.urls.forEach(url => {
            const urlIndex = this.urls.findIndex(u => u === url);
            if (urlIndex !== -1) {
                this.selectedUrls.delete(urlIndex);
            }
        });
    }

    selectAllGroups() {
        this.groups.forEach(group => {
            this.selectedGroups.add(group.id);
            this.selectGroupUrls(group);
        });
        this.renderGroupList();
        this.renderUrlList(); // Update URL list to show selections
        this.updateProcessSelectedGroupsButton();
        this.updateProcessSelectedButton();
        this.updateStartButtonText();
        this.saveData();
    }

    deselectAllGroups() {
        this.groups.forEach(group => {
            this.deselectGroupUrls(group);
        });
        this.selectedGroups.clear();
        this.renderGroupList();
        this.renderUrlList(); // Update URL list to show deselections
        this.updateProcessSelectedGroupsButton();
        this.updateProcessSelectedButton();
        this.updateStartButtonText();
        this.saveData();
    }

    updateProcessSelectedGroupsButton() {
        const hasGroupSelection = this.selectedGroups.size > 0;
        this.elements.processSelectedGroupsBtn.disabled = !hasGroupSelection;
        
        if (hasGroupSelection) {
            const totalUrls = Array.from(this.selectedGroups)
                .map(groupId => this.groups.find(g => g.id === groupId))
                .filter(group => group)
                .reduce((total, group) => total + group.urls.length, 0);
            
            this.elements.processSelectedGroupsBtn.textContent = 
                `Process Selected Groups (${this.selectedGroups.size} groups, ${totalUrls} URLs)`;
        } else {
            this.elements.processSelectedGroupsBtn.textContent = 'Process Selected Groups';
        }
    }

    processSelectedGroups() {
        const selectedGroupsList = Array.from(this.selectedGroups)
            .map(groupId => this.groups.find(g => g.id === groupId))
            .filter(group => group);

        if (selectedGroupsList.length === 0) {
            this.addLog('No groups selected for processing', 'error');
            return;
        }

        // Collect all URLs from selected groups
        const selectedUrlsList = [];
        selectedGroupsList.forEach(group => {
            selectedUrlsList.push(...group.urls);
        });

        if (selectedUrlsList.length === 0) {
            this.addLog('Selected groups contain no URLs', 'error');
            return;
        }

        // Temporarily replace this.urls with selected URLs for processing
        const originalUrls = [...this.urls];
        this.urls = selectedUrlsList;
        
        const groupNames = selectedGroupsList.map(g => g.name).join(', ');
        this.addLog(`Processing ${selectedGroupsList.length} selected groups (${groupNames}) with ${selectedUrlsList.length} URLs`, 'info');
        
        // Start processing with selected URLs
        this.startProcessing().then(() => {
            // Restore original URLs after processing starts
            this.urls = originalUrls;
        });
    }
}

// Initialize the popup controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.controller = new PopupController();
});
