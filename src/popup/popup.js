class PopupController {
    constructor() {
        this.isProcessing = false;
        this.currentProgress = { current: 0, total: 0 };
        this.tabStatuses = new Map();
        this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
        this.urls = [];
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

            // URL management
            urlList: document.getElementById('url-list'),
            newUrlInput: document.getElementById('new-url-input'),
            addUrlBtn: document.getElementById('add-url-btn'),
            clearAllUrlsBtn: document.getElementById('clear-all-urls'),
            
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
        
        // URL management events
        this.elements.addUrlBtn.addEventListener('click', () => this.addUrl());
        this.elements.newUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addUrl();
        });
        this.elements.clearAllUrlsBtn.addEventListener('click', () => this.clearAllUrls());
        
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
        this.renderUrlList();
        
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
            const data = await chrome.storage.local.get(['urls', 'autoReply', 'autoClose', 'restaurantNameMap', 'lastRunDate', 'lastResults', 'lastResultsTimestamp']);
            
            if (data.urls && Array.isArray(data.urls)) {
                this.urls = data.urls;
                this.addLog(`Loaded ${this.urls.length} URLs from previous session`, 'info');
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

    async startProcessing() {
        if (this.isProcessing) return;
        
        if (this.urls.length === 0) {
            this.updateStatus('Please add at least one URL');
            this.addLog('Cannot start: No URLs provided', 'error');
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
        
        for (const url of this.urls) {
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
        this.addLog(`🚀 Starting processing for ${processedUrls.length} URLs...`, 'info');
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
        if (this.urls.length === 0) {
            this.elements.urlList.innerHTML = '<div class="empty-urls">No URLs added yet.</div>';
            return;
        }
        this.urls.forEach(url => {
            const item = document.createElement('div');
            item.className = 'url-item';
            
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
            
            item.appendChild(text);
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove URL';
            removeBtn.onclick = () => this.removeUrl(url);
            item.appendChild(removeBtn);
            
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
}

document.addEventListener('DOMContentLoaded', () => {
    new PopupController();
});
