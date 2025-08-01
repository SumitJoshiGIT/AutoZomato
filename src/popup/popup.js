class PopupController {
    constructor() {
        this.isProcessing = false;
        this.currentProgress = { current: 0, total: 0 };
        this.tabStatuses = new Map();
        this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
        this.urls = [];
        
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
        chrome.runtime.sendMessage({ action: 'getProcessingState' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Error getting processing state:", chrome.runtime.lastError.message);
                return;
            }
            this.updateFullState(response);
        });
    }

    async saveData() {
        const state = {
            urls: this.urls,
            autoReply: this.elements.autoReplyToggle.checked,
            autoClose: this.elements.autoCloseToggle.checked,
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
        
        await this.saveData();
        this.clearLogs();
        this.addLog(`🚀 Starting processing for ${this.urls.length} URLs...`, 'info');
        
        this.isProcessing = true;
        this.elements.startBtn.disabled = true;
        this.elements.stopBtn.disabled = false;
        this.elements.progressSection.style.display = 'block';
        this.elements.resultsSection.style.display = 'none';
        
        this.currentProgress = { current: 0, total: this.urls.length };
        this.tabStatuses.clear();
        this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
        
        this.updateOverallProgress(0, this.urls.length);
        this.elements.tabProgress.innerHTML = '';
        this.updateStatus('Starting processing...');
        
        try {
            await chrome.runtime.sendMessage({
                action: 'startProcessing',
                data: {
                    urls: this.urls,
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
        
        const completionMessage = `🎉 Processing complete. Found ${this.results.totalReviews} reviews, replied to ${this.results.successfulReplies}.`;
        this.updateStatus('Processing complete!');
        this.addLog(completionMessage, 'success');
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
            
            const text = document.createElement('span');
            text.className = 'url-text';
            text.textContent = url;
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
        this.addLog('Download requested', 'info');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PopupController();
});
