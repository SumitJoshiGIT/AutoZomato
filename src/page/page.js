class PageController {
    constructor() {
        this.isProcessing = false;
        this.currentProgress = { current: 0, total: 0 };
        this.tabStatuses = new Map();
        this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
        this.tabResults = []; // Store individual tab results for real-time display
        this.reviewsMap = new Map(); // Map to store processed reviews by reviewId to prevent duplicates
        this.urls = [];
        this.groups = [];
        this.selectedUrls = new Set();
        this.selectedGroups = new Set();
        this.currentGroupId = null;
        this.restaurantNameMap = new Map();
        this.jobProcessingMap = new Map(); // New: Track job processing status by job ID (not URL)
        this.lastRunDate = null;
        this.csvData = null; // Store parsed CSV data for upload
        
        // Initialize the new ReviewResultsTable component
        this.reviewResultsTable = null;
        
        this.initializeElements();
        this.bindEvents();
        this.setupMessageListener();
        this.initializeBrandGroups();
        this.loadStateOnStartup();
    }

    initializeElements() {
        this.elements = {
            // Status
            status: document.getElementById('status'),
            
            // Settings
            autoReplyToggle: document.getElementById('autoReplyToggle'),
            autoCloseToggle: document.getElementById('autoCloseToggle'),
            replyWaitTime: document.getElementById('replyWaitTime'),
            startDate: document.getElementById('startDate'),
            endDate: document.getElementById('endDate'),
            
            // Processing Mode Selection
            ollamaMode: document.getElementById('ollamaMode'),
            gptMode: document.getElementById('gptMode'),
            offlineMode: document.getElementById('offlineMode'),
            ollamaStatus: document.getElementById('ollamaStatus'),
            gptStatus: document.getElementById('gptStatus'),
            
            // GPT Configuration
            gptConfigPanel: document.getElementById('gptConfigPanel'),
            gptKeyName: document.getElementById('gptKeyName'),
            gptApiKey: document.getElementById('gptApiKey'),
            gptModel: document.getElementById('gptModel'),
            testGptConnection: document.getElementById('testGptConnection'),
            
            // Ollama Configuration
            ollamaConfigPanel: document.getElementById('ollamaConfigPanel'),
            ollamaUrl: document.getElementById('ollamaUrl'),
            ollamaModel: document.getElementById('ollamaModel'),
            testOllamaConnection: document.getElementById('testOllamaConnection'),
            
            // Groups Management
            groupsList: document.getElementById('groupsList'),
            selectAllGroups: document.getElementById('selectAllGroups'),
            deselectAllGroups: document.getElementById('deselectAllGroups'),
            refreshGroupsBtn: document.getElementById('refreshGroupsBtn'),
            
            // URL Management
            urlsByGroupContainer: document.getElementById('urlsByGroupContainer'),
            groupSelect: document.getElementById('groupSelect'),
            addUrlBtn: document.getElementById('addUrlBtn'),
            uploadCsvBtn: document.getElementById('uploadCsvBtn'),
            selectAllUrlsBtn: document.getElementById('selectAllUrlsBtn'),
            deselectAllUrlsBtn: document.getElementById('deselectAllUrlsBtn'),
            
            // Processing
            selectedGroupsCount: document.getElementById('selectedGroupsCount'),
            selectedUrlsCount: document.getElementById('selectedUrlsCount'),
            totalUrlsCount: document.getElementById('totalUrlsCount'),
            lastRunDate: document.getElementById('lastRunDate'),
            currentAutoReply: document.getElementById('currentAutoReply'),
            currentAutoClose: document.getElementById('currentAutoClose'),
            startProcessing: document.getElementById('startProcessing'),
            stopProcessing: document.getElementById('stopProcessing'),
            processingStatus: document.getElementById('processingStatus'),
            progressFill: document.getElementById('progressFill'),
            statusText: document.getElementById('statusText'),
            
            // Results - using new component container
            reviewResultsContainer: document.getElementById('reviewResultsContainer'),
            
            // Modals
            addUrlModal: document.getElementById('addUrlModal'),
            uploadCsvModal: document.getElementById('uploadCsvModal'),
            urlInput: document.getElementById('urlInput'),
            urlGroup: document.getElementById('urlGroup'),
            csvFile: document.getElementById('csvFile'),
            csvBrandSelect: document.getElementById('csvBrandSelect'),
            csvPreview: document.getElementById('csvPreview'),
            csvPreviewContent: document.getElementById('csvPreviewContent'),
            saveUrlBtn: document.getElementById('saveUrlBtn'),
            cancelUrlBtn: document.getElementById('cancelUrlBtn'),
            uploadCsvConfirmBtn: document.getElementById('uploadCsvConfirmBtn'),
            cancelCsvBtn: document.getElementById('cancelCsvBtn')
        };
        
        // Check for missing elements
        const missingElements = [];
        for (const [key, element] of Object.entries(this.elements)) {
            if (!element) {
                missingElements.push(key);
            }
        }
        
        if (missingElements.length > 0) {
            console.error('Missing DOM elements:', missingElements);
        } else {
            console.log('All DOM elements found successfully');
        }
    }

    bindEvents() {
        // Settings
        this.elements.autoReplyToggle.addEventListener('change', () => this.saveSettings());
        this.elements.autoCloseToggle.addEventListener('change', () => this.saveSettings());
        this.elements.replyWaitTime.addEventListener('input', () => this.saveSettings());
        
        // Processing Mode Selection
        this.elements.ollamaMode.addEventListener('change', () => this.handleModeChange());
        this.elements.gptMode.addEventListener('change', () => this.handleModeChange());
        this.elements.offlineMode.addEventListener('change', () => this.handleModeChange());
        
        // GPT Configuration
        this.elements.gptKeyName.addEventListener('input', () => this.saveGptSettings());
        this.elements.gptApiKey.addEventListener('input', () => this.saveGptSettings());
        this.elements.gptModel.addEventListener('change', () => this.saveGptSettings());
        this.elements.testGptConnection.addEventListener('click', () => this.testGptConnection());
        
        // Ollama Configuration
        this.elements.ollamaUrl.addEventListener('input', () => this.saveOllamaSettings());
        this.elements.ollamaModel.addEventListener('change', () => this.saveOllamaSettings());
        this.elements.testOllamaConnection.addEventListener('click', () => this.testOllamaConnection());
        
        // Date Range
        this.elements.startDate.addEventListener('change', () => this.saveDateSettings());
        this.elements.endDate.addEventListener('change', () => this.saveDateSettings());
        
        // Group Management
        this.elements.refreshGroupsBtn.addEventListener('click', () => this.initializeBrandGroups());
        this.elements.selectAllGroups.addEventListener('click', () => this.selectAllGroups());
        this.elements.deselectAllGroups.addEventListener('click', () => this.deselectAllGroups());
        
        // URL Management
        this.elements.addUrlBtn.addEventListener('click', () => this.showAddUrlModal());
        this.elements.uploadCsvBtn.addEventListener('click', () => this.showUploadCsvModal());
        this.elements.selectAllUrlsBtn.addEventListener('click', () => this.selectAllUrls());
        this.elements.deselectAllUrlsBtn.addEventListener('click', () => this.deselectAllUrls());
        this.elements.saveUrlBtn.addEventListener('click', () => this.saveNewUrl());
        this.elements.cancelUrlBtn.addEventListener('click', () => this.hideAddUrlModal());
        
        // CSV Upload
        this.elements.csvFile.addEventListener('change', (e) => this.handleCsvFileSelection(e));
        this.elements.uploadCsvConfirmBtn.addEventListener('click', () => this.processCsvUpload());
        this.elements.cancelCsvBtn.addEventListener('click', () => this.hideUploadCsvModal());
        
        // Processing
        this.elements.startProcessing.addEventListener('click', () => this.startProcessing());
        this.elements.stopProcessing.addEventListener('click', () => this.stopProcessing());
        
        // Event delegation for dynamically created elements
        this.setupEventDelegation();
        
        // Modal close buttons
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.handleModalClose(modal);
                }
            });
        });
        
        // Click outside modal to close
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.handleModalClose(modal);
                }
            });
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal').forEach(modal => {
                    modal.style.display = 'none';
                });
            }
        });
    }

    // Handle real-time review processing updates
    handleReviewProcessed(reviewData) {
        console.log('[PageController] *** REVIEW PROCESSED MESSAGE RECEIVED ***', {
            reviewId: reviewData.reviewId,
            customerName: reviewData.customerName,
            restaurantName: reviewData.restaurantName,
            sentiment: reviewData.sentiment,
            replied: reviewData.replied,
            hasReply: !!reviewData.reply
        });
        
        // Add review to the new ReviewResultsTable component
        if (this.reviewResultsTable) {
            this.reviewResultsTable.addReview(reviewData);
            console.log('[PageController] Review added to ReviewResultsTable component');
        } else {
            console.error('[PageController] ReviewResultsTable component not initialized!');
        }
        
        // ALSO add to the real-time results panel (for live updates)
        if (this.addReviewToResultsPanel) {
            this.addReviewToResultsPanel(reviewData);
            console.log('[PageController] Review added to real-time results panel');
        }
        
        // Update overall statistics (keep this for other parts of the system)
        this.results.totalReviews++;
        if (reviewData.replied) {
            this.results.successfulReplies++;
        }
        
        console.log('[PageController] *** REVIEW PROCESSING COMPLETE - Stats Updated ***', {
            totalReviews: this.results.totalReviews,
            successfulReplies: this.results.successfulReplies,
            componentReviewCount: this.reviewResultsTable ? this.reviewResultsTable.getReviewCount() : 0
        });
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log('[Dashboard] Received message:', message.action, message);
            
            switch (message.action) {
                case 'updateState':
                    this.updateFullState(message.data);
                    break;
                case 'updateProgress':
                    this.updateProgress(message.current, message.total);
                    break;
                case 'updateJobStatus':
                    this.handleJobStatusUpdate(message);
                    break;
                case 'updateTabStatus':
                    this.updateTabStatus(message.tabId, message.url, message.status, message.data);
                    break;
                case 'updateRestaurantName':
                    this.updateRestaurantName(message.tabId, message.url, message.restaurantName);
                    break;
                case 'updateTabProgress':
                    this.updateTabProgress(message.tabId, message.url, message.restaurantName, message.progress, message.status);
                    break;
                case 'tabResultReady':
                    this.handleTabResultReady(message.tabResult);
                    break;
                case 'reviewProcessed':
                    // Handle real-time review processing updates
                    console.log('[PageController] Received reviewProcessed message:', message.reviewData);
                    this.handleReviewProcessed(message.reviewData);
                    break;
                case 'tabCompleted':
                    // Update the job status to completed when tabCompleted is received
                    if (message.jobId) {
                        const existingJob = this.jobProcessingMap.get(message.jobId) || {};
                        this.handleJobStatusUpdate({
                            ...existingJob,
                            jobId: message.jobId,
                            status: 'completed',
                            reviewCount: message.data?.reviewCount,
                            repliesCount: message.data?.repliesCount,
                            restaurantName: message.data?.restaurantName,
                            data: message.data
                        });
                    }
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
                default:
                    console.log('[Dashboard] Unhandled message action:', message.action);
            }
        });
    }

    async loadStateOnStartup() {
        try {
            const result = await chrome.storage.local.get([
                'groups', 'selectedGroups', 'selectedUrls', 'restaurantNameMap', 'lastRunDate',
                'autoReplyEnabled', 'autoCloseEnabled', 'replyWaitTime', 'startDate', 'endDate'
            ]);
            
            this.groups = result.groups || [];
            
            // Migrate existing groups to include brand ID if missing
            this.migrateGroupsForBrandSupport();
            
            this.selectedGroups = new Set(result.selectedGroups || []);
            this.selectedUrls = new Set(result.selectedUrls || []);
            
            // Load restaurant name map
            if (result.restaurantNameMap && Array.isArray(result.restaurantNameMap)) {
                this.restaurantNameMap = new Map(result.restaurantNameMap);
            }
            
            this.lastRunDate = result.lastRunDate;
            
            // Clean up orphaned selected URLs (URLs that no longer exist in groups)
            this.cleanupOrphanedSelectedUrls();
            
            // Load settings
            this.elements.autoReplyToggle.checked = result.autoReplyEnabled !== false; // Default to true
            this.elements.autoCloseToggle.checked = result.autoCloseEnabled === true; // Default to false
            this.elements.replyWaitTime.value = result.replyWaitTime || 3; // Default to 3 seconds
            
            // Load date settings with defaults
            this.loadDateSettings(result.startDate, result.endDate);
            
            // Initialize processing mode selection
            await this.initializeModeSelection();
            
            // Update settings display
            this.updateSettingsDisplay();
            
            this.render();
            
            // Get current processing state from background script
            this.requestProcessingState();
        } catch (error) {
            console.error('Error loading state:', error);
        }
    }

    async requestProcessingState() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getProcessingState' });
            if (response) {
                console.log('[PageController] Got processing state from background:', response);
                this.updateFullState(response);
            }
        } catch (error) {
            console.error('Error requesting processing state:', error);
        }
    }

    cleanupOrphanedSelectedUrls() {
        console.log('[PageController] Cleaning up orphaned selected URLs...');
        const validUrlKeys = new Set();
        
        // Build set of all valid URL keys from current groups
        this.groups.forEach(group => {
            if (group.urls) {
                group.urls.forEach(url => {
                    validUrlKeys.add(`${group.id}:${url}`);
                });
            }
        });
        
        // Remove any selected URLs that no longer exist
        const orphanedUrls = [];
        this.selectedUrls.forEach(urlKey => {
            if (!validUrlKeys.has(urlKey)) {
                orphanedUrls.push(urlKey);
                this.selectedUrls.delete(urlKey);
            }
        });
        
        if (orphanedUrls.length > 0) {
            console.log(`[PageController] Removed ${orphanedUrls.length} orphaned selected URLs:`, orphanedUrls);
        } else {
            console.log('[PageController] No orphaned selected URLs found');
        }
        
        // Also clean up restaurant name map
        const orphanedRestaurants = [];
        this.restaurantNameMap.forEach((name, url) => {
            const urlExists = this.groups.some(group => 
                group.urls && group.urls.includes(url)
            );
            if (!urlExists) {
                orphanedRestaurants.push(url);
                this.restaurantNameMap.delete(url);
            }
        });
        
        if (orphanedRestaurants.length > 0) {
            console.log(`[PageController] Removed ${orphanedRestaurants.length} orphaned restaurant names:`, orphanedRestaurants);
        }
    }

    render() {
        console.log('render() called');
        try {
            this.renderGroupsList();
            this.updateGroupSelectors();
            this.renderUrlsByGroup();
            this.updateCounts();
            this.updateProcessingState();
            console.log('render() completed successfully');
        } catch (error) {
            console.error('Error in render():', error);
        }
    }

    renderGroupsList() {
        if (!this.elements.groupsList) return;
        
        if (this.groups.length === 0) {
            this.elements.groupsList.innerHTML = `
                <div class="empty-state">
                    <p>No brand groups available. Click "Refresh Groups" to load brands from response bank.</p>
                </div>
            `;
            return;
        }
        
        this.elements.groupsList.innerHTML = this.groups.map(group => {
            const isSelected = this.selectedGroups.has(group.id);
            const urlCount = group.urls ? group.urls.length : 0;
            const isPermanent = group.isPermanent || false;
            
            return `
                <div class="group-item ${isSelected ? 'selected' : ''}">
                    <div class="group-header">
                        <label class="group-checkbox">
                            <input type="checkbox" ${isSelected ? 'checked' : ''} 
                                   data-group-id="${group.id}" class="group-checkbox-input">
                            <span>${group.name}</span>
                        </label>
                        <div class="group-actions">
                            ${!isPermanent ? `
                                <button class="btn btn-small btn-secondary edit-group-btn" data-group-id="${group.id}">
                                    Edit
                                </button>
                                <button class="btn btn-small btn-danger delete-group-btn" data-group-id="${group.id}">
                                    Delete
                                </button>
                            ` : `
                                <span class="brand-badge">Brand Group</span>
                            `}
                        </div>
                    </div>
                    <div class="group-urls">
                        ${urlCount} URL${urlCount !== 1 ? 's' : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // Method to get brand ID for a specific URL - used by content script
    getBrandIdForUrl(url) {
        for (const group of this.groups) {
            if (group.urls && group.urls.includes(url) && group.brandId) {
                return group.brandId;
            }
        }
        return null;
    }

    // Migration function to add brandId to existing groups
    migrateGroupsForBrandSupport() {
        let needsSave = false;
        
        this.groups.forEach(group => {
            if (!group.brandId) {
                group.brandId = '1'; // Default to brand 1 (first brand)
                needsSave = true;
                console.log(`[PageController] Migrated group "${group.name}" to use default brand ID: 1`);
            }
        });
        
        if (needsSave) {
            console.log('[PageController] Groups migrated for brand support, saving data...');
            this.saveData();
        }
    }

    renderUrlsByGroup() {
        if (!this.elements.urlsByGroupContainer) return;
        
        if (this.groups.length === 0) {
            this.elements.urlsByGroupContainer.innerHTML = `
                <div class="empty-state">
                    <p>No groups created yet. Create groups and add URLs to get started.</p>
                </div>
            `;
            return;
        }
        
        let globalUrlIndex = 1;
        
        this.elements.urlsByGroupContainer.innerHTML = this.groups.map(group => {
            const urls = group.urls || [];
            
            if (urls.length === 0) {
                return `
                    <div class="group-urls-section">
                        <div class="group-urls-header">
                            <div class="group-urls-title">${group.name}</div>
                        </div>
                        <div class="empty-state">
                            <p>No URLs in this group yet.</p>
                        </div>
                    </div>
                `;
            }
            
            const urlsHtml = urls.map(url => {
                const urlKey = `${group.id}:${url}`;
                const isSelected = this.selectedUrls.has(urlKey);
                const urlNumber = globalUrlIndex++;
                const domain = new URL(url).hostname;
                
                // Use restaurant name if available, otherwise use URL
                const restaurantName = this.restaurantNameMap.get(url);
                const displayName = restaurantName || url;
                const showUrl = restaurantName ? url : domain;
                
                return `
                    <div class="url-item ${isSelected ? 'selected' : ''}" data-group-id="${group.id}" data-url="${encodeURIComponent(url)}">
                        <div class="url-left">
                            <label class="url-checkbox">
                                <input type="checkbox" ${isSelected ? 'checked' : ''} 
                                       class="url-checkbox-input" 
                                       data-group-id="${group.id}" 
                                       data-url="${encodeURIComponent(url)}">
                            </label>
                            <div class="url-number">${urlNumber}</div>
                            <div class="url-info">
                                <div class="url-display" title="${url}">
                                    ${displayName}
                                </div>
                                <div class="url-domain">${showUrl}</div>
                            </div>
                        </div>
                        <div class="url-actions">
                            <button class="btn btn-small btn-danger url-delete-btn" 
                                    data-group-id="${group.id}" 
                                    data-url="${encodeURIComponent(url)}">
                                Delete
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
            
            return `
                <div class="group-urls-section">
                    <div class="group-urls-header">
                        <div class="group-urls-title">${group.name} (${urls.length} URLs)</div>
                        <div class="group-url-actions">
                            <button class="btn btn-small btn-secondary select-all-urls-btn" data-group-id="${group.id}">
                                Select All
                            </button>
                            <button class="btn btn-small btn-secondary deselect-all-urls-btn" data-group-id="${group.id}">
                                Deselect All
                            </button>
                        </div>
                    </div>
                    <div class="urls-list">
                        ${urlsHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    updateGroupSelectors() {
        const selectors = [this.elements.groupSelect, this.elements.urlGroup];
        const groupOptions = this.groups.map(group => 
            `<option value="${group.id}">${group.name}</option>`
        ).join('');
        
        selectors.forEach(selector => {
            if (selector) {
                const currentValue = selector.value;
                selector.innerHTML = `
                    <option value="">Select a group...</option>
                    ${groupOptions}
                `;
                if (currentValue && this.groups.find(g => g.id === currentValue)) {
                    selector.value = currentValue;
                }
            }
        });
    }

    updateCounts() {
        const selectedGroups = Array.from(this.selectedGroups);
        const totalUrls = this.groups.reduce((count, group) => {
            return count + (group.urls ? group.urls.length : 0);
        }, 0);
        const selectedUrlsCount = this.selectedUrls.size;
        
        console.log('updateCounts:', { selectedGroups: selectedGroups.length, selectedUrlsCount, totalUrls });
        
        this.elements.selectedGroupsCount.textContent = selectedGroups.length;
        this.elements.selectedUrlsCount.textContent = selectedUrlsCount;
        this.elements.totalUrlsCount.textContent = totalUrls;
        
        // Update last run date
        if (this.lastRunDate) {
            const date = new Date(this.lastRunDate);
            this.elements.lastRunDate.textContent = date.toLocaleString();
        } else {
            this.elements.lastRunDate.textContent = 'Never';
        }
    }

    updateProcessingState() {
        const hasSelectedUrls = this.selectedUrls.size > 0;
        console.log('[Dashboard] updateProcessingState called:', {
            isProcessing: this.isProcessing,
            hasSelectedUrls: hasSelectedUrls,
            startProcessingExists: !!this.elements.startProcessing,
            stopProcessingExists: !!this.elements.stopProcessing
        });
        
        this.elements.startProcessing.disabled = !hasSelectedUrls || this.isProcessing;
        
        if (this.isProcessing) {
            console.log('[Dashboard] Setting to processing state (hiding start, showing stop)');
            this.elements.startProcessing.style.display = 'none';
            this.elements.stopProcessing.style.display = 'inline-flex';
            this.elements.processingStatus.style.display = 'block';
        } else {
            console.log('[Dashboard] Setting to non-processing state (showing start, hiding stop)');
            this.elements.startProcessing.style.display = 'inline-flex';
            this.elements.stopProcessing.style.display = 'none';
            
            // Keep processingStatus visible if there are completed jobs to show
            const hasCompletedJobs = this.jobProcessingMap && this.jobProcessingMap.size > 0;
            if (hasCompletedJobs) {
                console.log('[Dashboard] Keeping processingStatus visible due to completed jobs');
                this.elements.processingStatus.style.display = 'block';
                // Also ensure the processing table is rendered and visible
                this.renderProcessingTable();
            } else {
                console.log('[Dashboard] Hiding processingStatus (no completed jobs)');
                this.elements.processingStatus.style.display = 'none';
            }
        }
        
        console.log('[Dashboard] Button states after update:', {
            startDisplay: this.elements.startProcessing.style.display,
            stopDisplay: this.elements.stopProcessing.style.display,
            startDisabled: this.elements.startProcessing.disabled
        });
    }

    // Brand and Group Management Methods
    async initializeBrandGroups() {
        try {
            const response = await fetch(chrome.runtime.getURL('response_bank.json'));
            const responseBank = await response.json();
            
            console.log('[PageController] Initializing brand groups from response bank:', Object.keys(responseBank));
            
            // Create groups for each brand
            const newGroups = [];
            Object.keys(responseBank).forEach(brandId => {
                const brand = responseBank[brandId];
                if (brand && brand.name) {
                    // Check if group already exists for this brand
                    let existingGroup = this.groups.find(g => g.brandId === brandId);
                    
                    if (!existingGroup) {
                        // Create new group for this brand
                        existingGroup = {
                            id: `brand_${brandId}`,
                            name: brand.name,
                            brandId: brandId,
                            urls: [],
                            isPermanent: true // Mark as permanent so it can't be deleted
                        };
                    } else {
                        // Update name if brand name changed
                        existingGroup.name = brand.name;
                        existingGroup.isPermanent = true;
                    }
                    
                    newGroups.push(existingGroup);
                }
            });
            
            // Remove any groups that don't have corresponding brands (cleanup)
            this.groups = this.groups.filter(group => {
                if (group.isPermanent) {
                    return responseBank[group.brandId] !== undefined;
                }
                return true; // Keep non-permanent groups for backward compatibility
            });
            
            // Add new brand groups
            newGroups.forEach(newGroup => {
                const existingIndex = this.groups.findIndex(g => g.id === newGroup.id);
                if (existingIndex >= 0) {
                    // Update existing group
                    this.groups[existingIndex] = { ...this.groups[existingIndex], ...newGroup };
                } else {
                    // Add new group
                    this.groups.push(newGroup);
                }
            });
            
            // Populate CSV brand selection dropdown
            this.populateCsvBrandSelect(responseBank);
            
            await this.saveData();
            this.render();
            
            console.log('[PageController] Brand groups initialized:', this.groups.map(g => ({ name: g.name, brandId: g.brandId, urlCount: g.urls?.length || 0 })));
            
        } catch (error) {
            console.error('[PageController] Failed to initialize brand groups:', error);
            // Show error message to user
            if (this.elements.groupsList) {
                this.elements.groupsList.innerHTML = `
                    <div class="error-state">
                        <p>Error loading brands: ${error.message}</p>
                        <button class="btn btn-primary" onclick="location.reload()">Reload Page</button>
                    </div>
                `;
            }
        }
    }

    async populateCsvBrandSelect(responseBank) {
        if (!this.elements.csvBrandSelect) return;
        
        // Clear existing options
        this.elements.csvBrandSelect.innerHTML = '<option value="">Select a brand...</option>';
        
        // Populate brand options
        Object.keys(responseBank).forEach(brandId => {
            const brand = responseBank[brandId];
            if (brand && brand.name) {
                const option = document.createElement('option');
                option.value = brandId;
                option.textContent = brand.name;
                this.elements.csvBrandSelect.appendChild(option);
            }
        });
    }

    async loadAvailableBrands() {
        try {
            const response = await fetch(chrome.runtime.getURL('response_bank.json'));
            const responseBank = await response.json();
            
            console.log('[PageController] Loaded brands for validation:', Object.keys(responseBank));
            return responseBank; // Return the response bank data
        } catch (error) {
            console.error('[PageController] Failed to load brands:', error);
            
            // Return a fallback response bank
            return {
                '1': { name: 'Default Brand', categories: {}, complaints: {} }
            };
        }
    }

    toggleGroupSelection(groupId) {
        console.log('[PageController] toggleGroupSelection called for groupId:', groupId);
        console.log('[PageController] Current selectedGroups:', Array.from(this.selectedGroups));
        console.log('[PageController] Current selectedUrls:', Array.from(this.selectedUrls));
        
        const group = this.groups.find(g => g.id === groupId);
        if (!group) {
            console.error('[PageController] Group not found:', groupId);
            return;
        }
        
        console.log('[PageController] Group found:', group.name, 'URLs:', group.urls?.length || 0);
        
        if (this.selectedGroups.has(groupId)) {
            // Group is currently selected, deselect it and all its URLs
            console.log('[PageController] Deselecting group and all URLs');
            this.selectedGroups.delete(groupId);
            this.deselectAllUrlsInGroup(groupId);
        } else {
            // Group is not selected, select it and all its URLs
            console.log('[PageController] Selecting group and all URLs');
            this.selectedGroups.add(groupId);
            this.selectAllUrlsInGroup(groupId);
        }
        
        console.log('[PageController] After toggle - selectedGroups:', Array.from(this.selectedGroups));
        console.log('[PageController] After toggle - selectedUrls:', Array.from(this.selectedUrls));
        
        this.saveData();
        this.render();
    }

    selectAllGroups() {
        this.selectedGroups = new Set(this.groups.map(g => g.id));
        this.saveData();
        this.render();
    }

    deselectAllGroups() {
        this.selectedGroups.clear();
        this.saveData();
        this.render();
    }

    async deleteGroup(groupId) {
        if (confirm('Are you sure you want to delete this group and all its URLs?')) {
            // Find the group to get its URLs before deletion
            const group = this.groups.find(g => g.id === groupId);
            
            if (group && group.urls) {
                // Remove all URLs from this group from selected URLs
                group.urls.forEach(url => {
                    const urlKey = `${groupId}:${url}`;
                    if (this.selectedUrls.has(urlKey)) {
                        this.selectedUrls.delete(urlKey);
                        console.log(`[PageController] Removed URL from selections due to group deletion: ${urlKey}`);
                    }
                    
                    // Also remove from restaurant name map
                    if (this.restaurantNameMap.has(url)) {
                        this.restaurantNameMap.delete(url);
                        console.log(`[PageController] Removed URL from restaurant map due to group deletion: ${url}`);
                    }
                });
            }
            
            // Remove the group itself
            this.groups = this.groups.filter(g => g.id !== groupId);
            this.selectedGroups.delete(groupId);
            
            await this.saveData();
            this.render();
        }
    }

    editGroup(groupId) {
        const group = this.groups.find(g => g.id === groupId);
        if (!group) {
            alert('Group not found');
            return;
        }
        
        const newName = prompt('Enter new group name:', group.name);
        if (newName === null) return; // User cancelled
        
        const trimmedName = newName.trim();
        if (!trimmedName) {
            alert('Group name cannot be empty');
            return;
        }
        
        // Check if name already exists (excluding current group)
        if (this.groups.some(g => g.id !== groupId && g.name === trimmedName)) {
            alert('A group with this name already exists');
            return;
        }
        
        group.name = trimmedName;
        this.saveData();
        this.render();
    }

    // URL Management Methods
    showAddUrlModal() {
        this.elements.addUrlModal.style.display = 'flex';
        this.elements.urlInput.focus();
    }

    hideAddUrlModal() {
        this.elements.addUrlModal.style.display = 'none';
        this.elements.urlInput.value = '';
        this.elements.urlGroup.value = '';
    }

    async saveNewUrl() {
        const url = this.elements.urlInput.value.trim();
        const groupId = this.elements.urlGroup.value;
        
        if (!url) {
            alert('Please enter a URL');
            return;
        }
        
        if (!groupId) {
            alert('Please select a group');
            return;
        }
        
        try {
            new URL(url); // Validate URL
        } catch (e) {
            alert('Please enter a valid URL');
            return;
        }
        
        const group = this.groups.find(g => g.id === groupId);
        if (!group) {
            alert('Selected group not found');
            return;
        }
        
        if (group.urls.includes(url)) {
            alert('This URL already exists in the selected group');
            return;
        }
        
        group.urls.push(url);
        await this.saveData();
        this.hideAddUrlModal();
        this.render();
    }

    async deleteUrl(groupId, url) {
        if (confirm('Are you sure you want to delete this URL?')) {
            const group = this.groups.find(g => g.id === groupId);
            if (group) {
                // Remove URL from the group
                group.urls = group.urls.filter(u => u !== url);
                
                // Remove URL from selected URLs (clean up selections)
                const urlKey = `${groupId}:${url}`;
                if (this.selectedUrls.has(urlKey)) {
                    this.selectedUrls.delete(urlKey);
                    console.log(`[PageController] Removed deleted URL from selections: ${urlKey}`);
                }
                
                // Also remove from restaurant name map
                if (this.restaurantNameMap.has(url)) {
                    this.restaurantNameMap.delete(url);
                    console.log(`[PageController] Removed deleted URL from restaurant map: ${url}`);
                }
                
                await this.saveData();
                this.render();
            }
        }
    }

    getAllUrls() {
        const allUrls = [];
        this.groups.forEach(group => {
            if (group.urls) {
                group.urls.forEach(url => {
                    allUrls.push({
                        url: url,
                        groupId: group.id,
                        groupName: group.name
                    });
                });
            }
        });
        return allUrls;
    }

    // CSV Upload Methods
    showUploadCsvModal() {
        this.elements.uploadCsvModal.style.display = 'flex';
        this.elements.csvFile.value = '';
        this.elements.csvBrandSelect.value = '';
        this.elements.csvPreview.style.display = 'none';
        this.elements.uploadCsvConfirmBtn.disabled = true;
        this.csvData = null;
    }

    hideUploadCsvModal() {
        this.elements.uploadCsvModal.style.display = 'none';
        this.elements.csvFile.value = '';
        this.elements.csvBrandSelect.value = '';
        this.elements.csvPreview.style.display = 'none';
        this.elements.uploadCsvConfirmBtn.disabled = true;
        this.csvData = null;
    }

    async handleCsvFileSelection(event) {
        const file = event.target.files[0];
        if (!file) {
            this.elements.csvPreview.style.display = 'none';
            this.elements.uploadCsvConfirmBtn.disabled = true;
            return;
        }

        if (!file.name.toLowerCase().endsWith('.csv')) {
            alert('Please select a CSV file');
            return;
        }

        try {
            const text = await this.readFileAsText(file);
            const parsedData = this.parseCsvData(text);
            this.validateCsvData(parsedData);
            this.displayCsvPreview(parsedData);
            this.elements.uploadCsvConfirmBtn.disabled = false;
        } catch (error) {
            console.error('Error processing CSV file:', error);
            alert(`Error processing CSV file: ${error.message}`);
            this.elements.csvPreview.style.display = 'none';
            this.elements.uploadCsvConfirmBtn.disabled = true;
        }
    }

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = e => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    parseCsvData(text) {
        const lines = text.trim().split('\n');
        if (lines.length === 0) {
            throw new Error('CSV file is empty');
        }

        // Parse CSV manually to handle potential commas in quoted fields
        const rows = [];
        for (let line of lines) {
            const row = this.parseCsvLine(line);
            if (row.length > 0 && row[0].trim()) {
                rows.push(row);
            }
        }

        if (rows.length === 0) {
            throw new Error('No valid data found in CSV file');
        }

        // Check if first row is a header (contains 'url' keyword)
        const firstRow = rows[0].map(cell => cell.toLowerCase());
        const hasHeader = firstRow.some(cell => 
            cell.includes('url') || cell.includes('link') || cell.includes('address')
        );

        const dataRows = hasHeader ? rows.slice(1) : rows;
        const processedData = [];

        dataRows.forEach((row, index) => {
            const rowNumber = hasHeader ? index + 2 : index + 1;
            
            // Take first column as URL
            const url = row[0] ? row[0].trim() : '';
            
            if (!url) {
                console.warn(`Row ${rowNumber}: Empty URL, skipping`);
                return;
            }

            processedData.push({
                rowNumber,
                url,
                status: 'valid'
            });
        });

        if (processedData.length === 0) {
            throw new Error('No valid URLs found in CSV file');
        }

        this.csvData = {
            hasHeader,
            totalRows: dataRows.length,
            data: processedData
        };

        return this.csvData;
    }

    parseCsvLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        
        result.push(current);
        return result.map(cell => cell.replace(/^"|"$/g, '').trim());
    }

    validateCsvData(parsedData) {
        // Simple validation for URLs only
        parsedData.data.forEach(row => {
            // Validate URL format
            try {
                new URL(row.url);
                row.status = 'valid';
                row.message = 'Valid URL';
            } catch (e) {
                row.status = 'error';
                row.message = 'Invalid URL format';
            }
        });

        this.csvData = parsedData;
    }

    displayCsvPreview(parsedData) {
        const validCount = parsedData.data.filter(row => row.status === 'valid').length;
        const errorCount = parsedData.data.filter(row => row.status === 'error').length;

        let html = `
            <table>
                <thead>
                    <tr>
                        <th>Row</th>
                        <th>URL</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // Show first 10 rows for preview
        const previewRows = parsedData.data.slice(0, 10);
        previewRows.forEach(row => {
            const rowClass = row.status === 'error' ? 'error-row' : '';
            
            html += `
                <tr class="${rowClass}">
                    <td>${row.rowNumber}</td>
                    <td>${row.url.length > 50 ? row.url.substring(0, 50) + '...' : row.url}</td>
                    <td title="${row.message}">${row.status}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';

        if (parsedData.data.length > 10) {
            html += `<p style="margin-top: 10px; font-size: 12px; color: #64748b;">Showing first 10 rows of ${parsedData.data.length} total rows</p>`;
        }

        html += `
            <div class="upload-stats">
                <div class="upload-stat success">
                    <span>Valid URLs:</span>
                    <span class="count">${validCount}</span>
                </div>
                <div class="upload-stat error">
                    <span>Errors:</span>
                    <span class="count">${errorCount}</span>
                </div>
            </div>
        `;

        this.elements.csvPreviewContent.innerHTML = html;
        this.elements.csvPreview.style.display = 'block';
    }

    async processCsvUpload() {
        if (!this.csvData) {
            alert('No CSV data to process');
            return;
        }

        const selectedBrandId = this.elements.csvBrandSelect.value;
        if (!selectedBrandId) {
            alert('Please select a brand for these URLs');
            return;
        }

        try {
            // Find the target group for the selected brand
            let targetGroup = this.groups.find(g => g.brandId === selectedBrandId);
            
            if (!targetGroup) {
                // This shouldn't happen if groups are properly initialized, but handle it just in case
                const response = await fetch(chrome.runtime.getURL('response_bank.json'));
                const responseBank = await response.json();
                const brandName = responseBank[selectedBrandId]?.name || 'Unknown Brand';
                
                targetGroup = {
                    id: `brand_${selectedBrandId}`,
                    name: brandName,
                    brandId: selectedBrandId,
                    urls: [],
                    isPermanent: true
                };
                this.groups.push(targetGroup);
            }

            let addedCount = 0;
            let skippedCount = 0;

            for (const row of this.csvData.data) {
                if (row.status === 'error') {
                    skippedCount++;
                    continue;
                }

                // Add URL if not already present
                if (!targetGroup.urls.includes(row.url)) {
                    targetGroup.urls.push(row.url);
                    addedCount++;
                } else {
                    skippedCount++;
                }
            }

            await this.saveData();
            this.hideUploadCsvModal();
            this.render();

            const message = `CSV upload completed!\n\nAdded: ${addedCount} URLs to ${targetGroup.name}`;
            if (skippedCount > 0) {
                alert(message + `\nSkipped: ${skippedCount} URLs (duplicates or errors)`);
            } else {
                alert(message);
            }

        } catch (error) {
            console.error('Error processing CSV upload:', error);
            alert(`Error processing CSV upload: ${error.message}`);
        }
    }

    // Processing Methods
    async startProcessing() {
        console.log('startProcessing called');
        console.log('selectedUrls:', Array.from(this.selectedUrls));
        
        if (this.selectedUrls.size === 0) {
            alert('Please select at least one URL to process');
            return;
        }
        
        // Convert selected URLs to array with brand information
        const selectedUrls = Array.from(this.selectedUrls).map(urlKey => {
            // Split only on the first colon to handle URLs with colons
            const colonIndex = urlKey.indexOf(':');
            if (colonIndex === -1) return { url: urlKey, brandId: null }; // fallback if no colon found
            const groupId = urlKey.substring(0, colonIndex);
            const url = urlKey.substring(colonIndex + 1);
            
            // Find the group and get its brand ID
            const group = this.groups.find(g => g.id === groupId);
            const brandId = group ? group.brandId : null;
            
            return { url: url, brandId: brandId };
        });
        
        console.log('Processing URLs with brand info:', selectedUrls);
        console.log('Settings:', {
            autoReply: this.elements.autoReplyToggle.checked,
            autoClose: this.elements.autoCloseToggle.checked
        });
        
        // Save the run date
        this.lastRunDate = new Date().toISOString();
        await this.saveData();
        
        this.isProcessing = true;
        
        // Update UI immediately to show processing state
        console.log('[Dashboard] Setting isProcessing = true, calling updateProcessingState()');
        this.updateProcessingState();
        this.updateStatus('Starting processing...', 'info');
        
        this.tabResults = []; // Clear previous results for new processing session
        
        console.log(`[AutoZomato] Clearing reviewsMap before processing (had ${this.reviewsMap.size} reviews)`);
        if (this.reviewsMap.size > 0) {
            console.log(`[AutoZomato] ReviewsMap contents before clearing:`, Array.from(this.reviewsMap.keys()));
        }
        this.reviewsMap.clear(); // Clear reviews map to prevent duplicates from previous sessions
        console.log(`[AutoZomato] ReviewsMap cleared, size now: ${this.reviewsMap.size}`);
        
        // Also clear the actual table rows to match the cleared map
        if (this.elements.resultsContainer) {
            const tableBody = this.elements.resultsContainer.querySelector('#realTimeResultsTableBody');
            if (tableBody) {
                console.log(`[AutoZomato] Clearing table body with ${tableBody.children.length} existing rows`);
                tableBody.innerHTML = '';
            }
        }
        
        // IMPORTANT: Initialize TWO SEPARATE TABLES with distinct purposes:
        
        // 1. PROCESSING STATUS TABLE: Shows job-level progress (how many reviews found/processed per job)
        this.initializeProcessingTable();
        
        // 2. INDIVIDUAL REVIEW RESULTS TABLE: Initialize the new component for individual reviews
        this.initializeReviewResultsComponent();
        
        // Note: Job statuses will be populated by the background script via updateJobStatus messages
        // No need to create placeholders here since each job will have its own unique ID
        
        // Render initial placeholder entries in processing table
        this.renderProcessingTable();
        
        // Initialize empty reviews table in Results section
        this.initializeReviewsTable();

        // Send to background script with current settings
        try {
            const selectedMode = this.getSelectedMode();
            
            // Get configuration for each mode
            const [gptResult, ollamaResult] = await Promise.all([
                chrome.storage.local.get(['gptApiKey', 'gptKeyName', 'gptModel']),
                chrome.storage.local.get(['ollamaUrl', 'ollamaModel'])
            ]);
            
            const settings = {
                autoReply: this.elements.autoReplyToggle.checked,
                autoClose: this.elements.autoCloseToggle.checked,
                replyWaitTime: parseInt(this.elements.replyWaitTime.value) || 3,
                processingMode: selectedMode,
                gptMode: {
                    enabled: selectedMode === 'gpt',
                    apiKey: gptResult.gptApiKey || '',
                    keyName: gptResult.gptKeyName || 'AutoZomato GPT Key',
                    model: gptResult.gptModel || 'gpt-4o-mini'
                },
                ollamaMode: {
                    enabled: selectedMode === 'ollama',
                    url: ollamaResult.ollamaUrl || 'http://localhost:11434',
                    model: ollamaResult.ollamaModel || 'llama3:8b'
                },
                offlineMode: {
                    enabled: selectedMode === 'offline'
                },
                dateRange: {
                    startDate: this.elements.startDate.value,
                    endDate: this.elements.endDate.value
                }
            };
            
            console.log('Sending processing request with settings:', { 
                ...settings, 
                gptMode: { ...settings.gptMode, apiKey: '***masked***' } 
            });
            
            // Check if selected mode is available
            if (selectedMode === 'ollama' && !this.ollamaAvailable) {
                throw new Error('Ollama is not available. Please check your Ollama installation or switch to GPT mode.');
            }
            
            if (selectedMode === 'gpt' && !settings.gptMode.apiKey) {
                throw new Error('GPT mode requires an API key. Please configure your OpenAI API key or switch to Ollama mode.');
            }
            
            this.updateStatus('Sending request to background script...', 'info');
            
            const response = await chrome.runtime.sendMessage({
                action: 'startProcessing',
                urls: selectedUrls,
                autoReply: settings.autoReply,
                autoClose: settings.autoClose,
                replyWaitTime: settings.replyWaitTime,
                processingMode: settings.processingMode,
                gptMode: settings.gptMode,
                ollamaMode: settings.ollamaMode,
                offlineMode: settings.offlineMode,
                dateRange: settings.dateRange
            });
            console.log('Message sent to background, response:', response);
            
            if (response && response.success) {
                this.updateStatus('Processing started successfully', 'success');
            } else {
                throw new Error('Background script did not confirm successful start');
            }
        } catch (error) {
            console.error('Error sending message to background:', error);
            this.updateStatus('Error starting processing: ' + error.message, 'error');
            // Reset processing state on error
            this.isProcessing = false;
            this.updateProcessingState();
        }
    }

    stopProcessing() {
        this.isProcessing = false;
        this.updateProcessingState();
        this.updateStatus('Stopping...');
        
        chrome.runtime.sendMessage({
            action: 'stopProcessing'
        });
    }

    pauseProcessing() {
        console.log('Pausing processing...');
        this.elements.pauseProcessing.style.display = 'none';
        this.elements.resumeProcessing.style.display = 'inline-flex';
        
        chrome.runtime.sendMessage({
            action: 'pauseProcessing'
        });
        
        this.updateStatus('Processing paused', 'warning');
    }

    resumeProcessing() {
        console.log('Resuming processing...');
        this.elements.pauseProcessing.style.display = 'inline-flex';
        this.elements.resumeProcessing.style.display = 'none';
        
        chrome.runtime.sendMessage({
            action: 'resumeProcessing'
        });
        
        this.updateStatus('Processing resumed', 'success');
    }

    // Message Handlers
    updateFullState(data) {
        console.log('[Dashboard] Updating full state:', data);
        
        if (data.processing !== undefined) {
            this.isProcessing = data.processing;
        }
        
        if (data.progress) {
            this.updateProgress(data.progress.current, data.progress.total);
        }
        
        if (data.tabStatuses) {
            this.tabStatuses = new Map(data.tabStatuses);
        }
        
        if (data.restaurantNames) {
            this.restaurantNameMap = new Map(data.restaurantNames);
        }
        
        // NEW: Handle job statuses from background script
        if (data.jobStatuses && Array.isArray(data.jobStatuses)) {
            console.log('[Dashboard] Updating job statuses:', data.jobStatuses);
            if (!this.jobProcessingMap) {
                this.jobProcessingMap = new Map();
            }
            
            // Ensure processing table exists before updating
            if (!this.elements.processingTable && data.jobStatuses.length > 0) {
                this.initializeProcessingTable(false); // Don't clear map when restoring state
            }
            console.log("JOB:",data.jobStatuses)
            // Update job processing map with data from background
            data.jobStatuses.forEach(job => {
                if (job.jobId) {
                    this.jobProcessingMap.set(job.jobId, {
                        jobId: job.jobId,
                        url: job.url,
                        tabId: job.tabId,
                        status: job.status,
                        restaurantName: job.restaurantName || 'Loading...',
                        progress: job.progress || { current: 0, total: 0 },
                        reviewCount: job.data?.reviewCount || 0,
                        repliesCount: job.data?.repliesCount || 0,
                        startTime: job.startTime,
                        endTime: job.endTime,
                        error: job.error,
                        completionRate: job.data?.completionRate || null,
                        expectedReviews: job.data?.expectedReviews || null,
                        lastUpdated: new Date().toISOString()
                    });
                }
            });
            
            // Re-render the processing table
            this.renderProcessingTable();
        }
        
        // Re-render to reflect updated state
        this.updateProcessingState();
        this.renderUrlsByGroup();
    }

    updateProgress(current, total) {
        console.log('[Dashboard] updateProgress called:', { current, total });
        this.currentProgress = { current, total };
        const percentage = total > 0 ? (current / total) * 100 : 0;
        
        console.log('[Dashboard] Setting progress bar to:', percentage + '%');
        this.elements.progressFill.style.width = `${percentage}%`;
        this.elements.statusText.textContent = `Processing ${current} of ${total} reviews...`;
    }

    updateTabStatus(tabId, url, status, data) {
        this.tabStatuses.set(tabId, { url, status, data });
        
        // Update restaurant name map if provided
        if (data && data.restaurantName) {
            this.restaurantNameMap.set(url, data.restaurantName);
        }
        
        // Update URL display with restaurant name
        this.updateUrlDisplayNames();
        
        // Update UI with tab-specific status if needed
        console.log(`Tab ${tabId} status updated: ${status}`, data);
    }

    updateRestaurantName(tabId, url, restaurantName) {
        // Store restaurant name for this URL
        this.restaurantNameMap.set(url, restaurantName);
        
        // Save to storage
        this.saveData();
        
        // Update the URL display to show restaurant name
        this.updateUrlDisplayNames();
        
        console.log(`Restaurant name updated for ${url}: ${restaurantName}`);
    }

    updateTabProgress(tabId, url, restaurantName, progress, status) {
        console.log('[Dashboard] updateTabProgress called:', { tabId, url, restaurantName, progress, status });
        
        // Store restaurant name and progress
        this.restaurantNameMap.set(url, restaurantName);
        
        // Update tab status with progress
        const existingStatus = this.tabStatuses.get(tabId) || {};
        this.tabStatuses.set(tabId, {
            ...existingStatus,
            url,
            status,
            data: {
                ...existingStatus.data,
                restaurantName,
                progress
            }
        });
        
        // Update URL display
        this.updateUrlDisplayNames();
        
        // Update progress in URL list if currently visible
        this.updateUrlProgressDisplay(url, progress, status);
        
        // Also update the overall progress if this is for current processing
        if (this.isProcessing && progress) {
            console.log('[Dashboard] Updating overall progress from tab progress:', progress);
            this.updateProgress(progress.current, progress.total);
        }
        
        console.log(`Tab ${tabId} progress: ${progress.current}/${progress.total} - ${restaurantName}`);
    }

    updateUrlDisplayNames() {
        // Update all URL displays to show restaurant names instead of URLs
        const urlItems = document.querySelectorAll('.url-item');
        urlItems.forEach(item => {
            const url = item.dataset.url;
            if (url && this.restaurantNameMap.has(url)) {
                const restaurantName = this.restaurantNameMap.get(url);
                const urlDisplay = item.querySelector('.url-display');
                if (urlDisplay) {
                    urlDisplay.textContent = restaurantName;
                    urlDisplay.title = url; // Keep original URL in tooltip
                }
            }
        });
    }

    updateUrlProgressDisplay(url, progress, status) {
        const urlItems = document.querySelectorAll('.url-item');
        urlItems.forEach(item => {
            if (item.dataset.url === url) {
                let progressDiv = item.querySelector('.url-progress');
                if (!progressDiv) {
                    progressDiv = document.createElement('div');
                    progressDiv.className = 'url-progress';
                    item.appendChild(progressDiv);
                }
                
                const percentage = progress.total > 0 ? (progress.current / progress.total * 100) : 0;
                const statusIcon = status === 'completed' ? '✅' : 
                                 status === 'partial' ? '🟡' : 
                                 status === 'processing' ? '🔄' : '⏳';
                
                progressDiv.innerHTML = `
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${percentage}%"></div>
                    </div>
                    <span class="progress-text">${statusIcon} ${progress.current}/${progress.total}</span>
                `;
            }
        });
    }

    handleProcessingComplete(results) {
        this.isProcessing = false;
        this.results = results;
        this.updateProcessingState();
        this.updateStatus('Processing complete');
        
        // Don't hide the processing table - let it show completed job statuses
        // The table will be managed by renderProcessingTable() and updateProcessingState()
        
        // Extract all individual reviews from the results and show in Results section
        const allReviews = (results && results.tabs)
            ? results.tabs.flatMap(tab => (tab.data && tab.data.detailedReviewLog) ? tab.data.detailedReviewLog.map(log => ({
                ...log,
                restaurantName: tab.data.restaurantName || tab.url,
                timestamp: log.timestamp || tab.timestamp
            })) : [])
            : [];
        
        // Store and render all reviews in the Results section
        this.allReviews = allReviews;
        this.renderReviewsTable(allReviews);
    }

    renderReviewsTable(reviews = []) {
        if (!this.elements.resultsContainer) return;
        if (!reviews || reviews.length === 0) {
            this.elements.resultsContainer.innerHTML = `
                <div class="empty-state">
                    <p>No reviews scraped yet. Start processing to see results here.</p>
                </div>
            `;
            return;
        }
        const tableHtml = `
            <div class="reviews-table-container">
                <div class="reviews-header">
                    <h3>Individual Reviews & Replies</h3>
                    <div class="reviews-summary">
                        <span>Total Reviews: ${reviews.length}</span>
                        <span>Replies Generated: ${reviews.filter(r => r.replied).length}</span>
                    </div>
                </div>
                <table class="reviews-table">
                    <thead>
                        <tr>
                            <th>Restaurant</th>
                            <th>Customer</th>
                            <th>Detected FirstName</th>
                            <th>Rating</th>
                            <th>Review</th>
                            <th>Reply</th>
                            <th>Sentiment</th>
                            <th>Complaint ID</th>
                            <th>Status</th>
                            <th>Timestamp</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${reviews.map(r => `
                            <tr>
                                <td>${r.restaurantName || ''}</td>
                                <td>${r.customerName || ''}</td>
                                <td>${r.extractedName || 'N/A'}</td>
                                <td>${typeof r.rating === 'number' ? r.rating : ''}</td>
                                <td class="review-text">${r.reviewText || ''}</td>
                                <td class="reply-text">${r.reply || ''}</td>
                                <td><span class="sentiment-${(r.sentiment || '').toLowerCase()}">${r.sentiment || ''}</span></td>
                                <td>${r.complaintId || ''}</td>
                                <td>${r.replied ? '✅ Sent' : '❌ Not Sent'}</td>
                                <td>${r.timestamp ? new Date(r.timestamp).toLocaleString() : ''}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div class="reviews-actions">
                    <button id="downloadReviews" class="btn btn-primary">📥 Download Reviews CSV</button>
                    <button id="clearReviews" class="btn btn-secondary">🗑️ Clear Reviews</button>
                </div>
            </div>
        `;
        this.elements.resultsContainer.innerHTML = tableHtml;
        
        // Add event listeners
        const downloadBtn = document.getElementById('downloadReviews');
        const clearBtn = document.getElementById('clearReviews');
        
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadReviews(reviews));
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearReviews());
        }
    }



    // Initialize the new ReviewResultsTable component
    initializeReviewResultsComponent() {
        console.log('[PageController] Initializing ReviewResultsTable component');
        
        if (!this.elements.reviewResultsContainer) {
            console.error('[PageController] reviewResultsContainer not found!');
            return;
        }
        
        // Create new ReviewResultsTable instance
        this.reviewResultsTable = new ReviewResultsTable('reviewResultsContainer');
        
        console.log('[PageController] ReviewResultsTable component initialized successfully');
    }

    // Callback for when complaints are manually corrected
    onComplaintCorrected(reviewId, reviewData) {
        console.log('[PageController] Complaint correction received:', {
            reviewId,
            originalComplaint: reviewData.originalComplaintId || reviewData.complaintId,
            correctedComplaint: reviewData.correctedComplaintId,
            customerName: reviewData.customerName
        });
        
        // You can add additional logic here, such as:
        // - Sending the correction to a backend API
        // - Updating analytics
        // - Triggering re-processing of the response
        // - Logging for audit trail
    }

    // Real-time Results Panel Methods (instead of modal)
    initializeRealTimeResultsPanel() {
        console.log('[PageController] Initializing real-time INDIVIDUAL REVIEW results panel');
        console.log('[PageController] resultsContainer element:', this.elements.resultsContainer);
        console.log('[PageController] resultsContainer exists:', !!this.elements.resultsContainer);
        
        if (!this.elements.resultsContainer) {
            console.error('[PageController] CRITICAL ERROR: resultsContainer element not found!');
            console.log('[PageController] Available elements:', Object.keys(this.elements));
            return;
        }
        
        // Clear any existing results (reviewsMap already cleared in startProcessing)
        this.tabResults = [];
        this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
        
        this.setupRealTimeResultsHTML();
    }

    setupRealTimeResultsHTML() {
        console.log('[PageController] Setting up real-time results HTML');
        console.log('[PageController] About to set innerHTML for resultsContainer');
        
        this.elements.resultsContainer.innerHTML = `
            <div class="real-time-results">
                <div class="results-header">
                    <h3>Individual Review Results (Live)</h3>
                </div>
                <div class="results-summary">
                    <div class="summary-stats">
                        <div class="stat-item">
                            <span class="stat-label">Total Reviews:</span>
                            <span id="realTimeTotalReviews">0</span>
                        </div>
                  
                    </div>
                </div>
                <div class="results-table-container">
                    <table class="results-table">
                        <thead>
                            <tr>
                                <th>Restaurant</th>
                                <th>Customer</th>
                                <th>Detected FirstName</th>
                                <th>Rating</th>
                                <th>Sentiment</th>
                                <th>Reply</th>
                                <th>Status</th>
                                <th>Timestamp</th>
                            </tr>
                        </thead>
                        <tbody id="realTimeResultsTableBody">
                            <!-- Real-time results will be populated here -->
                        </tbody>
                    </table>
                </div>
                <div class="results-actions">
                    <button id="downloadRealTimeResults" class="btn btn-primary">
                        📥 Download Results (CSV)
                    </button>
                    <button id="clearRealTimeResults" class="btn btn-secondary">
                        🗑️ Clear Results
                    </button>
                    <button id="pauseProcessing" class="btn btn-warning" style="display: none;">
                        ⏸️ Pause
                    </button>
                    <button id="resumeProcessing" class="btn btn-success" style="display: none;">
                        ▶️ Resume
                    </button>
                </div>
            </div>
        `;
        
        console.log('[PageController] Real-time results HTML has been set');
        console.log('[PageController] resultsContainer innerHTML length:', this.elements.resultsContainer.innerHTML.length);
        
        // Update element references
        this.elements.realTimeTotalReviews = document.getElementById('realTimeTotalReviews');
        this.elements.realTimeRepliesGenerated = document.getElementById('realTimeRepliesGenerated');
        this.elements.realTimeProgress = document.getElementById('realTimeProgress');
        this.elements.realTimeResultsTableBody = document.getElementById('realTimeResultsTableBody');
        this.elements.downloadRealTimeResults = document.getElementById('downloadRealTimeResults');
        this.elements.clearRealTimeResults = document.getElementById('clearRealTimeResults');
        this.elements.pauseProcessing = document.getElementById('pauseProcessing');
        this.elements.resumeProcessing = document.getElementById('resumeProcessing');
        
        console.log('[AutoZomato] Real-time results elements after setup:', {
            realTimeTotalReviews: !!this.elements.realTimeTotalReviews,
            realTimeRepliesGenerated: !!this.elements.realTimeRepliesGenerated,
            realTimeProgress: !!this.elements.realTimeProgress,
            realTimeResultsTableBody: !!this.elements.realTimeResultsTableBody,
            downloadRealTimeResults: !!this.elements.downloadRealTimeResults
        });
        console.log('[AutoZomato] Real-time results table body element:', this.elements.realTimeResultsTableBody);
        console.log('[AutoZomato] Real-time results table body exists:', !!this.elements.realTimeResultsTableBody);
        
        // DEBUG: Add a test row to see if the table is working
        if (this.elements.realTimeResultsTableBody) {
            console.log('[PageController] DEBUG: Adding test row to verify table is working');
            const testRow = document.createElement('tr');
            testRow.innerHTML = `
                <td>TEST Restaurant</td>
                <td>TEST Customer</td>
                <td>TEST Name</td>
                <td>5★★★★★ (5)</td>
                <td><span class="sentiment-positive">Positive</span></td>
                <td class="reply-cell">TEST Reply</td>
                <td>${new Date().toLocaleTimeString()}</td>
            `;
            this.elements.realTimeResultsTableBody.appendChild(testRow);
            console.log('[PageController] DEBUG: Test row added, table should now be visible');
        }
        
        // Add event listeners for new buttons
        if (this.elements.downloadRealTimeResults) {
            this.elements.downloadRealTimeResults.addEventListener('click', () => this.downloadRealTimeResults());
        }
        if (this.elements.clearRealTimeResults) {
            this.elements.clearRealTimeResults.addEventListener('click', () => this.clearRealTimeResults());
        }
        if (this.elements.pauseProcessing) {
            this.elements.pauseProcessing.addEventListener('click', () => this.pauseProcessing());
        }
        if (this.elements.resumeProcessing) {
            this.elements.resumeProcessing.addEventListener('click', () => this.resumeProcessing());
        }
        
        console.log('[PageController] Real-time results panel initialized with buttons:', {
            download: !!this.elements.downloadRealTimeResults,
            clear: !!this.elements.clearRealTimeResults
        });
    }

    addReviewToResultsPanel(reviewData) {
        // INDIVIDUAL REVIEW RESULTS TABLE: Adds each processed review to the detailed results table
        // This method handles individual review entries, NOT restaurant-level status
        // Use the scraped reviewId from DOM, only generate if absolutely missing
        const reviewId = reviewData.reviewId || this.generateReviewId(reviewData);
        
        console.log(`[AutoZomato] Processing review for results panel:`, {
            reviewId: reviewId,
            customerName: reviewData.customerName,
            restaurantName: reviewData.restaurantName,
            scrapedId: !!reviewData.reviewId, // Track if ID was scraped from DOM
            hasReviewInMap: this.reviewsMap.has(reviewId),
            mapSize: this.reviewsMap.size,
            mapContents: Array.from(this.reviewsMap.keys()).slice(0, 5) // Show first 5 review IDs in map
        });
        
        // DEBUG: Log stack trace to see where reviews are coming from
        console.log('[AutoZomato] Review processing call stack:', new Error().stack);
        
        // Since review IDs are scraped from DOM and should be unique,
        // duplicates should be rare and only occur if same review gets processed multiple times
        if (this.reviewsMap.has(reviewId)) {
            console.log(`[AutoZomato] Updating existing review (likely processing update): ${reviewId}`);
            console.log(`[AutoZomato] Existing review data:`, this.reviewsMap.get(reviewId));
            console.log(`[AutoZomato] New review data:`, reviewData);
            
            // Update existing review data
            const existingReview = this.reviewsMap.get(reviewId);
            const updatedReview = { ...existingReview, ...reviewData, reviewId };
            this.reviewsMap.set(reviewId, updatedReview);
            
            // Update the existing row in the table
            this.updateExistingReviewRow(reviewId, updatedReview);
            return;
        }
        
        // Add new review to map
        const fullReviewData = { ...reviewData, reviewId };
        this.reviewsMap.set(reviewId, fullReviewData);
        console.log(`[AutoZomato] Added new review to results: ${reviewId} (Map size now: ${this.reviewsMap.size})`);
        
        // Create new row
        this.createNewReviewRow(reviewId, fullReviewData);
    }

    createNewReviewRow(reviewId, reviewData) {
        console.log(`[AutoZomato] Creating new review row for: ${reviewId}`);
        
        // Check if table body element exists
        if (!this.elements.realTimeResultsTableBody) {
            console.error(`[AutoZomato] realTimeResultsTableBody element is null! Cannot create row for ${reviewId}`);
            console.log('[AutoZomato] Available elements:', Object.keys(this.elements));
            return;
        }
        
        const row = document.createElement('tr');
        row.className = 'new-row';
        row.setAttribute('data-review-id', reviewId);
        
        const sentiment = reviewData.sentiment || 'Neutral';
        const sentimentClass = typeof sentiment === 'string' ? sentiment.toLowerCase() : 'neutral';
        
        const statusBadge = reviewData.replied ? 
            `<span class="status-badge status-completed">Completed</span>` :
            `<span class="status-badge status-processing">Processing</span>`;
        
        const rating = reviewData.rating ? 
            `<span class="rating-stars">${'★'.repeat(Math.floor(reviewData.rating))}${'☆'.repeat(5 - Math.floor(reviewData.rating))}</span> (${reviewData.rating})` :
            'N/A';
        
        row.innerHTML = `
            <td>${reviewData.restaurantName || 'Unknown'}</td>
            <td>${reviewData.customerName || 'Unknown'}</td>
            <td>${reviewData.extractedName || 'N/A'}</td>
            <td>${rating}</td>
            <td><span class="sentiment-${sentimentClass}">${sentiment}</span></td>
            <td class="reply-cell">${reviewData.reply || ''}</td>
            
            <td>${new Date().toLocaleTimeString()}</td>
        `;
        
        this.elements.realTimeResultsTableBody.appendChild(row);
        console.log(`[AutoZomato] Row appended to table. Table now has ${this.elements.realTimeResultsTableBody.children.length} rows`);
        console.log(`[AutoZomato] New row HTML:`, row.outerHTML.substring(0, 200) + '...');
        console.log(`[AutoZomato] New row visibility:`, {
            display: window.getComputedStyle(row).display,
            visibility: window.getComputedStyle(row).visibility,
            opacity: window.getComputedStyle(row).opacity,
            height: window.getComputedStyle(row).height
        });
        
        // Keep row visible by ensuring it has a stable class
        setTimeout(() => {
            row.classList.remove('new-row');
            row.classList.add('review-row'); // Add a stable class for CSS styling
            console.log(`[AutoZomato] Updated row classes for ${reviewId}:`, row.className);
        }, 300);
        
        // Auto-scroll to bottom to show latest entry
        const container = this.elements.resultsContainer.querySelector('.results-table-container');
        if (container) {
            container.scrollTop = container.scrollHeight;
            console.log(`[AutoZomato] Scrolled container to show new row`);
        }
        
        this.updateRealTimeSummary();
    }

    generateReviewId(reviewData) {
        // Create a more robust review ID using multiple identifying fields
        const parts = [
            reviewData.customerName || 'unknown',
            reviewData.restaurantName || 'unknown',
            reviewData.reviewText ? reviewData.reviewText.substring(0, 100) : 'no-text',
            reviewData.rating || 'no-rating'
        ];
        
        // Create a simple hash of the combined parts
        const combined = parts.join('|').toLowerCase().replace(/\s+/g, '');
        let hash = 0;
        for (let i = 0; i < combined.length; i++) {
            const char = combined.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        
        return `review_${Math.abs(hash)}_${parts[0].substring(0, 10)}`;
    }

    updateExistingReviewRow(reviewId, reviewData) {
        console.log(`[AutoZomato] Attempting to update row for reviewId: ${reviewId}`);
        console.log(`[AutoZomato] Review data for update:`, {
            reviewId: reviewId,
            customerName: reviewData.customerName,
            replied: reviewData.replied,
            hasReply: !!reviewData.reply,
            timestamp: reviewData.timestamp
        });
        
        // Check if table body element exists
        if (!this.elements.realTimeResultsTableBody) {
            console.error(`[AutoZomato] realTimeResultsTableBody element is null! Cannot update or create row for ${reviewId}`);
            console.log('[AutoZomato] Available elements:', Object.keys(this.elements));
            return;
        }
        
        // FIXED: Define existingRow variable properly to prevent ReferenceError
        const existingRow = this.elements.realTimeResultsTableBody.querySelector(`tr[data-review-id="${reviewId}"]`);
        console.log(`[AutoZomato] Code version check: existingRow variable defined properly - ${!!existingRow ? 'FOUND' : 'NOT_FOUND'}`);
        
        if (!existingRow) {
            console.warn(`[AutoZomato] Could not find existing row for review: ${reviewId} - creating new row instead`);
            // Let's also log all existing rows to debug
            const allRows = this.elements.realTimeResultsTableBody.querySelectorAll('tr[data-review-id]');
            console.log(`[AutoZomato] Found ${allRows.length} existing rows:`, Array.from(allRows).map(row => row.getAttribute('data-review-id')));
            
            // Instead of just returning, create the row as if it's a new review
            console.log(`[AutoZomato] Creating new row for what was thought to be a duplicate: ${reviewId}`);
            this.createNewReviewRow(reviewId, reviewData);
            return;
        }
        
        console.log(`[AutoZomato] Found existing row, updating content for: ${reviewId}`);
        
        const sentiment = reviewData.sentiment || 'Neutral';
        const sentimentClass = typeof sentiment === 'string' ? sentiment.toLowerCase() : 'neutral';
        
        // STATUS UPDATE: This is the key part - ensure replied status is reflected
        const statusBadge = reviewData.replied ? 
            `<span class="status-badge status-completed">Completed</span>` :
            `<span class="status-badge status-processing">Processing</span>`;
        
        console.log(`[AutoZomato] Status badge for ${reviewId}: ${statusBadge} (replied: ${reviewData.replied})`);
        
        const rating = reviewData.rating ? 
            `<span class="rating-stars">${'★'.repeat(Math.floor(reviewData.rating))}${'☆'.repeat(5 - Math.floor(reviewData.rating))}</span> (${reviewData.rating})` :
            'N/A';
        
        existingRow.innerHTML = `
            <td>${reviewData.restaurantName || 'Unknown'}</td>
            <td>${reviewData.customerName || 'Unknown'}</td>
            <td>${reviewData.extractedName || 'N/A'}</td>
            <td>${rating}</td>
            <td><span class="sentiment-${sentimentClass}">${sentiment}</span></td>
            <td class="reply-cell">${reviewData.reply || ''}</td>
            
            
            <td>${new Date().toLocaleTimeString()}</td>
        `;
        
        // Add update animation
        existingRow.classList.add('updated-row');
        
        // Force a style recalculation to ensure the class is applied
        existingRow.offsetHeight; // Trigger reflow
        
        console.log(`[AutoZomato] Added 'updated-row' class to row: ${reviewId}`);
        console.log(`[AutoZomato] Row classes after adding 'updated-row':`, existingRow.className);
        console.log(`[AutoZomato] Row computed style:`, window.getComputedStyle(existingRow).backgroundColor);
        
        // Also try setting style directly as a fallback
        existingRow.style.backgroundColor = '#d1ecf1';
        existingRow.style.borderLeft = '3px solid #007bff';
        
        setTimeout(() => {
            // Only remove the 'updated-row' class, preserve other classes
            existingRow.classList.remove('updated-row');
            existingRow.style.backgroundColor = '';
            existingRow.style.borderLeft = '';
            console.log(`[AutoZomato] Removed 'updated-row' class from row: ${reviewId}`);
            console.log(`[AutoZomato] Row classes after removing 'updated-row':`, existingRow.className);
        }, 1500); // Extended timeout to make it more visible
        
        this.updateRealTimeSummary();
    }

    updateRealTimeSummary() {
        const totalReviews = this.tabResults.reduce((total, result) => {
            return total + (result.detailedReviewLog ? result.detailedReviewLog.length : 0);
        }, 0);
        
        const repliesGenerated = this.tabResults.reduce((total, result) => {
            return total + (result.repliesCount || 0);
        }, 0);
        
        const progress = this.currentProgress.total > 0 ? 
            Math.round((this.currentProgress.current / this.currentProgress.total) * 100) : 0;
        
        if (this.elements.realTimeTotalReviews) {
            this.elements.realTimeTotalReviews.textContent = totalReviews;
        }
        if (this.elements.realTimeRepliesGenerated) {
            this.elements.realTimeRepliesGenerated.textContent = repliesGenerated;
        }
        if (this.elements.realTimeProgress) {
            this.elements.realTimeProgress.textContent = `${progress}%`;
        }
    }

    downloadRealTimeResults() {
        // Use the reviews map instead of parsing table rows
        const reviews = Array.from(this.reviewsMap.values()).map(review => ({
            Restaurant: review.restaurantName || 'Unknown',
            Customer: review.customerName || 'Unknown',
            'Detected FirstName': review.extractedName || 'N/A',
            Rating: review.rating || '',
            Sentiment: review.sentiment || 'Neutral',
            Reply: review.reply || '',
            Status: review.replied ? 'Completed' : 'Processing',
            Timestamp: review.timestamp ? new Date(review.timestamp).toLocaleString() : new Date().toLocaleString()
        }));
        
        if (reviews.length === 0) {
            alert('No results to download');
            return;
        }
        
        // Convert to CSV
        const headers = Object.keys(reviews[0]);
        const csvContent = [
            headers.join(','),
            ...reviews.map(review => 
                headers.map(header => `"${review[header].replace(/"/g, '""')}"`).join(',')
            )
        ].join('\n');
        
        // Download file
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `autozomato-results-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    downloadResults() {
        if (!this.tabResults || this.tabResults.length === 0) {
            alert('No results to download');
            return;
        }
        
        // Convert results to CSV format
        const csvData = [
            ['Restaurant', 'URL', 'Status', 'Reviews', 'Replies', 'Success Rate', 'Started Time'],
            ...this.tabResults.map(result => [
                result.restaurantName || 'Unknown',
                result.url,
                result.status,
                result.reviewCount || 0,
                result.repliesCount || 0,
                result.reviewCount > 0 ? Math.round((result.repliesCount / result.reviewCount) * 100) + '%' : '0%',
                new Date(result.timestamp).toLocaleString()
            ])
        ];
        
        const csvContent = csvData.map(row => 
            row.map(cell => `"${cell.toString().replace(/"/g, '""')}"`).join(',')
        ).join('\n');
        
        // Download file
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `autozomato-results-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    clearResults() {
        if (confirm('Are you sure you want to clear all results?')) {
            this.tabResults = [];
            this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
            this.renderRealtimeResults();
        }
    }

    clearRealTimeResults() {
        if (confirm('Are you sure you want to clear all results?')) {
            this.elements.realTimeResultsTableBody.innerHTML = '';
            this.reviewsMap.clear(); // Clear the reviews map
            this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 }; // Reset counters
            this.updateRealTimeSummary();
            console.log('[AutoZomato] Cleared all results and reviews map');
        }
    }
    
    handleError(error) {
        this.isProcessing = false;
        this.updateProcessingState();
        this.updateStatus(`Error: ${error}`, 'error');
    }

    addLogEntry(message, type = 'info', timestamp = null) {
        // Add log entry to a logs array if we want to display them
        // For now, just console log them
        const logTime = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        console.log(`[${logTime}] [${type.toUpperCase()}] ${message}`);
        
        // Update status with latest log message
        this.updateStatus(message, type);
    }

    renderResults(results) {
        if (!results || !results.tabs) {
            this.elements.resultsContainer.innerHTML = `
                <div class="empty-state">
                    <p>No results available</p>
                </div>
            `;
            return;
        }
        
        const resultsHtml = `
            <div class="results-grid">
                ${results.tabs.map(tab => `
                    <div class="result-item">
                        <div class="result-header">
                            <a href="${tab.url}" target="_blank" class="result-url">
                                ${new URL(tab.url).hostname}
                            </a>
                            <span class="result-status ${tab.error ? 'error' : 'success'}">
                                ${tab.error ? 'Error' : 'Success'}
                            </span>
                        </div>
                        <div class="result-stats">
                            <div>Reviews: ${tab.data?.reviewCount || 0}</div>
                            <div>Replies: ${tab.data?.repliesCount || 0}</div>
                        </div>
                        ${tab.error ? `<div class="error-message">${tab.error}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
        
        this.elements.resultsContainer.innerHTML = resultsHtml;
    }

    updateStatus(message, type = 'info') {
        this.elements.status.textContent = message;
        this.elements.status.className = `status ${type}`;
    }

    // Data Management
    async saveData() {
        try {
            await chrome.storage.local.set({
                groups: this.groups,
                selectedGroups: Array.from(this.selectedGroups),
                selectedUrls: Array.from(this.selectedUrls),
                restaurantNameMap: Array.from(this.restaurantNameMap.entries()),
                lastRunDate: this.lastRunDate,
                autoReplyEnabled: this.elements.autoReplyToggle.checked,
                autoCloseEnabled: this.elements.autoCloseToggle.checked,
                replyWaitTime: parseInt(this.elements.replyWaitTime.value) || 3
            });
        } catch (error) {
            console.error('Error saving data:', error);
        }
    }

    async saveSettings() {
        try {
            await chrome.storage.local.set({
                autoReplyEnabled: this.elements.autoReplyToggle.checked,
                autoCloseEnabled: this.elements.autoCloseToggle.checked,
                replyWaitTime: parseInt(this.elements.replyWaitTime.value) || 3,
                processingMode: this.getSelectedMode()
            });
            
            // Update the display
            this.updateSettingsDisplay();
            
            // Update content scripts with new configuration
            await this.updateActiveContentScripts();
            
            console.log('Settings saved:', {
                autoReply: this.elements.autoReplyToggle.checked,
                autoClose: this.elements.autoCloseToggle.checked,
                replyWaitTime: parseInt(this.elements.replyWaitTime.value) || 3,
                processingMode: this.getSelectedMode()
            });
        } catch (error) {
            console.error('Error saving settings:', error);
        }
    }

    updateSettingsDisplay() {
        if (this.elements.currentAutoReply) {
            this.elements.currentAutoReply.textContent = this.elements.autoReplyToggle.checked ? 'ON' : 'OFF';
            this.elements.currentAutoReply.className = this.elements.autoReplyToggle.checked ? 'setting-status on' : 'setting-status off';
        }
        if (this.elements.currentAutoClose) {
            this.elements.currentAutoClose.textContent = this.elements.autoCloseToggle.checked ? 'ON' : 'OFF';
            this.elements.currentAutoClose.className = this.elements.autoCloseToggle.checked ? 'setting-status on' : 'setting-status off';
        }
    }

    // Date Range Methods
    loadDateSettings(startDate, endDate) {
        // Set default dates if not provided
        const today = new Date();
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(today.getFullYear() - 1);
        
        // Format dates for input fields (YYYY-MM-DD)
        const defaultStartDate = oneYearAgo.toISOString().split('T')[0];
        const defaultEndDate = today.toISOString().split('T')[0];
        
        // Set values with defaults
        this.elements.startDate.value = startDate || defaultStartDate;
        this.elements.endDate.value = endDate || defaultEndDate;
        
        console.log('Date settings loaded:', {
            startDate: this.elements.startDate.value,
            endDate: this.elements.endDate.value
        });
    }

    async saveDateSettings() {
        try {
            const startDate = this.elements.startDate.value;
            const endDate = this.elements.endDate.value;
            
            // Validate that start date is before end date
            if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
                alert('Start date must be before end date');
                // Reset to previous values
                const result = await chrome.storage.local.get(['startDate', 'endDate']);
                this.loadDateSettings(result.startDate, result.endDate);
                return;
            }
            
            await chrome.storage.local.set({
                startDate: startDate,
                endDate: endDate
            });
            
            console.log('Date settings saved:', {
                startDate: startDate,
                endDate: endDate
            });
        } catch (error) {
            console.error('Error saving date settings:', error);
        }
    }

    // Processing Mode Methods
    async handleModeChange() {
        const selectedMode = this.getSelectedMode();
        console.log('[PageController] Mode changed to:', selectedMode);
        
        // Hide all config panels first
        this.elements.gptConfigPanel.style.display = 'none';
        this.elements.ollamaConfigPanel.style.display = 'none';
        
        // Show appropriate config panel
        switch (selectedMode) {
            case 'ollama':
                this.elements.ollamaConfigPanel.style.display = 'block';
                await this.loadOllamaSettings();
                break;
            case 'gpt':
                this.elements.gptConfigPanel.style.display = 'block';
                await this.loadGptSettings();
                break;
            case 'offline':
                // No config panel for offline mode
                break;
        }
        
        // Save the selected mode
        await this.saveModeSettings();
        
        // Update all active content scripts with new configuration
        await this.updateActiveContentScripts();
    }

    getSelectedMode() {
        if (this.elements.ollamaMode.checked) return 'ollama';
        if (this.elements.gptMode.checked) return 'gpt';
        if (this.elements.offlineMode.checked) return 'offline';
        return 'ollama'; // default
    }

    async initializeModeSelection() {
        console.log('[PageController] Initializing mode selection...');
        
        // Load saved mode or default to ollama
        const result = await chrome.storage.local.get(['processingMode']);
        const savedMode = result.processingMode || 'ollama';
        
        // Set the appropriate radio button
        switch (savedMode) {
            case 'ollama':
                this.elements.ollamaMode.checked = true;
                break;
            case 'gpt':
                this.elements.gptMode.checked = true;
                break;
            case 'offline':
                this.elements.offlineMode.checked = true;
                break;
        }
        
        // Check Ollama availability
        await this.checkOllamaAvailability();
        
        // If Ollama is not available and we're in ollama mode, auto-switch to GPT
        if (savedMode === 'ollama' && !this.ollamaAvailable) {
            console.log('[PageController] Ollama unavailable, auto-switching to GPT mode');
            this.elements.gptMode.checked = true;
            await this.saveModeSettings();
        }
        
        // Handle initial mode setup
        await this.handleModeChange();
    }

    async checkOllamaAvailability() {
        try {
            const result = await chrome.storage.local.get(['ollamaUrl']);
            const ollamaUrl = result.ollamaUrl || 'http://localhost:11434';
            
            this.elements.ollamaStatus.textContent = 'Checking...';
            this.elements.ollamaStatus.className = 'mode-status checking';
            
            const response = await fetch(`${ollamaUrl}/api/tags`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                this.ollamaAvailable = true;
                this.elements.ollamaStatus.textContent = 'Available';
                this.elements.ollamaStatus.className = 'mode-status available';
                console.log('[PageController] Ollama is available');
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            this.ollamaAvailable = false;
            this.elements.ollamaStatus.textContent = 'Unavailable';
            this.elements.ollamaStatus.className = 'mode-status unavailable';
            console.log('[PageController] Ollama is unavailable:', error.message);
        }
    }

    async saveModeSettings() {
        try {
            const selectedMode = this.getSelectedMode();
            await chrome.storage.local.set({
                processingMode: selectedMode
            });
            console.log('[PageController] Mode saved:', selectedMode);
        } catch (error) {
            console.error('Error saving mode settings:', error);
        }
    }

    // Ollama Configuration Methods
    async loadOllamaSettings() {
        try {
            const result = await chrome.storage.local.get([
                'ollamaUrl', 'ollamaModel'
            ]);
            
            this.elements.ollamaUrl.value = result.ollamaUrl || 'http://localhost:11434';
            this.elements.ollamaModel.value = result.ollamaModel || 'llama3:8b';
            
            console.log('[PageController] Ollama settings loaded');
        } catch (error) {
            console.error('Error loading Ollama settings:', error);
        }
    }

    async saveOllamaSettings() {
        try {
            const settings = {
                ollamaUrl: this.elements.ollamaUrl.value,
                ollamaModel: this.elements.ollamaModel.value
            };
            
            await chrome.storage.local.set(settings);
            console.log('[PageController] Ollama settings saved');
            
            // Re-check availability after URL change
            await this.checkOllamaAvailability();
            
            // Update all active content scripts
            await this.updateActiveContentScripts();
        } catch (error) {
            console.error('Error saving Ollama settings:', error);
        }
    }

    async testOllamaConnection() {
        if (!this.elements.ollamaUrl.value.trim()) {
            this.elements.ollamaStatus.textContent = 'No URL provided';
            this.elements.ollamaStatus.className = 'mode-status not-configured';
            return;
        }

        // Disable button during test
        this.elements.testOllamaConnection.disabled = true;
        this.elements.testOllamaConnection.textContent = 'Testing...';
        this.elements.ollamaStatus.textContent = 'Testing connection...';
        this.elements.ollamaStatus.className = 'mode-status checking';

        try {
            const response = await fetch(`${this.elements.ollamaUrl.value}/api/tags`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const result = await response.json();
                this.elements.ollamaStatus.textContent = `✅ Connected (${result.models?.length || 0} models)`;
                this.elements.ollamaStatus.className = 'mode-status configured';
                console.log('[PageController] Ollama test successful:', result.models?.length || 0, 'models available');
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('[PageController] Ollama connection test failed:', error);
            this.elements.ollamaStatus.textContent = '❌ Connection failed';
            this.elements.ollamaStatus.className = 'mode-status unavailable';
        } finally {
            // Re-enable button
            this.elements.testOllamaConnection.disabled = false;
            this.elements.testOllamaConnection.textContent = 'Test Connection';
        }
    }

    async loadGptSettings() {
        try {
            const result = await chrome.storage.local.get([
                'gptApiKey', 'gptKeyName', 'gptModel'
            ]);
            
            this.elements.gptApiKey.value = result.gptApiKey || '';
            this.elements.gptKeyName.value = result.gptKeyName || 'AutoZomato GPT Key';
            this.elements.gptModel.value = result.gptModel || 'gpt-4o-mini';
            
            this.updateGptStatus();
        } catch (error) {
            console.error('Error loading GPT settings:', error);
        }
    }

    async saveGptSettings() {
        try {
            const settings = {
                gptApiKey: this.elements.gptApiKey.value,
                gptKeyName: this.elements.gptKeyName.value,
                gptModel: this.elements.gptModel.value
            };
            
            await chrome.storage.local.set(settings);
            this.updateGptStatus();
            
            console.log('GPT settings saved:', { ...settings, gptApiKey: '***masked***' });
            
            // Update all active content scripts with new GPT configuration
            await this.updateActiveContentScripts();
            
        } catch (error) {
            console.error('Error saving GPT settings:', error);
        }
    }

    async updateActiveContentScripts() {
        try {
            console.log('[Page] Updating all active content scripts with new configuration...');
            
            const selectedMode = this.getSelectedMode();
            
            // Get all configuration settings
            const [gptResult, ollamaResult] = await Promise.all([
                chrome.storage.local.get(['gptApiKey', 'gptKeyName', 'gptModel']),
                chrome.storage.local.get(['ollamaUrl', 'ollamaModel'])
            ]);
            
            // Build the complete configuration object that content scripts expect
            const fullConfig = {
                autoReply: this.elements.autoReplyToggle.checked,
                autoClose: this.elements.autoCloseToggle.checked,
                replyWaitTime: parseInt(this.elements.replyWaitTime.value) || 3,
                processingMode: selectedMode,
                gptMode: {
                    enabled: selectedMode === 'gpt',
                    apiKey: gptResult.gptApiKey || '',
                    keyName: gptResult.gptKeyName || 'AutoZomato GPT Key',
                    model: gptResult.gptModel || 'gpt-4o-mini'
                },
                ollamaMode: {
                    enabled: selectedMode === 'ollama',
                    url: ollamaResult.ollamaUrl || 'http://localhost:11434',
                    model: ollamaResult.ollamaModel || 'llama3:8b'
                },
                offlineMode: {
                    enabled: selectedMode === 'offline'
                },
                dateRange: {
                    startDate: this.elements.startDate.value,
                    endDate: this.elements.endDate.value
                }
            };
            
            // Get all tabs and update those with content scripts
            const tabs = await chrome.tabs.query({});
            const updatePromises = tabs.map(async (tab) => {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'updateConfiguration',
                        config: fullConfig
                    });
                } catch (tabError) {
                    // Ignore errors for tabs without content scripts
                }
            });
            
            await Promise.allSettled(updatePromises);
            console.log('[Page] ✓ Configuration update sent to all active tabs');
            
        } catch (error) {
            console.warn('[Page] Error updating content scripts with new config:', error);
        }
    }

    updateGptStatus() {
        const selectedMode = this.getSelectedMode();
        const hasApiKey = this.elements.gptApiKey.value.trim().length > 0;
        
        if (selectedMode !== 'gpt') {
            this.elements.gptStatus.textContent = 'Not selected';
            this.elements.gptStatus.className = 'mode-status';
        } else if (hasApiKey) {
            this.elements.gptStatus.textContent = `Configured: ${this.elements.gptModel.value}`;
            this.elements.gptStatus.className = 'mode-status configured';
        } else {
            this.elements.gptStatus.textContent = 'API Key required';
            this.elements.gptStatus.className = 'mode-status not-configured';
        }
    }

    async testGptConnection() {
        if (!this.elements.gptApiKey.value.trim()) {
            this.elements.gptStatus.textContent = 'No API key provided';
            this.elements.gptStatus.className = 'gpt-status not-configured';
            return;
        }

        // Disable button during test
        this.elements.testGptConnection.disabled = true;
        this.elements.testGptConnection.textContent = 'Testing...';
        this.elements.gptStatus.textContent = 'Testing connection...';
        this.elements.gptStatus.className = 'gpt-status testing';

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.elements.gptApiKey.value}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.elements.gptModel.value,
                    messages: [
                        {
                            role: 'user',
                            content: 'Hello! Just testing the API connection. Please respond with "Connected".'
                        }
                    ],
                    max_tokens: 10,
                    temperature: 0.1
                })
            });

            if (response.ok) {
                const result = await response.json();
                this.elements.gptStatus.textContent = `✅ Connected: ${this.elements.gptModel.value}`;
                this.elements.gptStatus.className = 'gpt-status configured';
                console.log('GPT test successful:', result.choices[0].message.content);
                       } else {
                const errorText = await response.text();
                console.error('GPT test failed:', response.status, errorText);
                if (response.status === 401) {
                    this.elements.gptStatus.textContent = '❌ Invalid API key';
                } else if (response.status === 429) {
                    this.elements.gptStatus.textContent = '❌ Rate limit exceeded';
                } else {
                    this.elements.gptStatus.textContent = `❌ Error: ${response.status}`;
                }
                this.elements.gptStatus.className = 'gpt-status not-configured';
            }
        } catch (error) {
            console.error('GPT connection test failed:', error);
            this.elements.gptStatus.textContent = '❌ Connection failed';
            this.elements.gptStatus.className = 'gpt-status not-configured';
        } finally {
            // Re-enable button
            this.elements.testGptConnection.disabled = false;
            this.elements.testGptConnection.textContent = 'Test Connection';
        }
    }

    // URL Selection Methods
    toggleUrlSelection(groupId, url) {
        console.log('toggleUrlSelection called:', { groupId, url });
        const urlKey = `${groupId}:${url}`;
        console.log('urlKey:', urlKey);
        console.log('selectedUrls before:', Array.from(this.selectedUrls));
        
        if (this.selectedUrls.has(urlKey)) {
            this.selectedUrls.delete(urlKey);
            console.log('Removed URL');
        } else {
            this.selectedUrls.add(urlKey);
            console.log('Added URL');
        }
        
        // Update group selection state based on whether all URLs in the group are selected
        this.updateGroupSelectionState(groupId);
        
        console.log('selectedUrls after:', Array.from(this.selectedUrls));
        this.saveData();
        this.render();
    }

    selectAllUrls() {
        this.selectedUrls.clear();
        this.groups.forEach(group => {
            if (group.urls) {
                group.urls.forEach(url => {
                    this.selectedUrls.add(`${group.id}:${url}`);
                });
            }
        });
        this.saveData();
        this.render();
    }

    deselectAllUrls() {
        this.selectedUrls.clear();
        this.saveData();
        this.render();
    }

    selectAllUrlsInGroup(groupId) {
        console.log('[PageController] selectAllUrlsInGroup called for groupId:', groupId);
        const group = this.groups.find(g => g.id === groupId);
        if (group && group.urls) {
            console.log('[PageController] Found group with', group.urls.length, 'URLs');
            group.urls.forEach(url => {
                const urlKey = `${groupId}:${url}`;
                this.selectedUrls.add(urlKey);
                console.log('[PageController] Added URL:', urlKey);
            });
        } else {
            console.log('[PageController] Group not found or has no URLs');
        }
        this.saveData();
        this.renderUrlsByGroup(); // Only re-render the URLs section
        this.updateCounts(); // Update count displays
        this.updateProcessingState(); // Update button states
    }

    deselectAllUrlsInGroup(groupId) {
        console.log('[PageController] deselectAllUrlsInGroup called for groupId:', groupId);
        const group = this.groups.find(g => g.id === groupId);
        if (group && group.urls) {
            console.log('[PageController] Found group with', group.urls.length, 'URLs');
            group.urls.forEach(url => {
                const urlKey = `${groupId}:${url}`;
                this.selectedUrls.delete(urlKey);
                console.log('[PageController] Removed URL:', urlKey);
            });
        } else {
            console.log('[PageController] Group not found or has no URLs');
        }
        this.saveData();
        this.renderUrlsByGroup(); // Only re-render the URLs section
        this.updateCounts(); // Update count displays
        this.updateProcessingState(); // Update button states
    }

    showTabDetails(tabId) {
        const tabResult = this.tabResults.find(result => result.tabId === tabId);
        if (!tabResult || !tabResult.detailedReviewLog) {
            alert('No detailed results available for this tab.');
            return;
        }

        // Create and show a modal with detailed review information
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        
        const detailsHtml = `
            <div class="modal-content" style="max-width: 800px; max-height: 80vh; overflow-y: auto;">
                <div class="modal-header">
                    <h3>Detailed Results - ${tabResult.restaurantName}</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="tab-summary">
                        <p><strong>URL:</strong> <a href="${tabResult.url}" target="_blank">${tabResult.url}</a></p>
                        <p><strong>Completed:</strong> ${new Date(tabResult.timestamp).toLocaleString()}</p>
                        <p><strong>Total Reviews:</strong> ${tabResult.reviewCount}</p>
                        <p><strong>Replies Generated:</strong> ${tabResult.repliesCount}</p>
                    </div>
                    <div class="reviews-details">
                        <h4>Review Details (${tabResult.detailedReviewLog.length} reviews)</h4>
                        <div class="reviews-table-container">
                            <table class="reviews-table">
                                <thead>
                                    <tr>
                                        <th>Customer</th>
                                        <th>Detected FirstName</th>
                                        <th>Sentiment</th>
                                        <th>Category</th>
                                        <th>Reply</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tabResult.detailedReviewLog.map(log => `
                                        <tr>
                                            <td>${log.customerName}</td>
                                            <td><strong>${log.extractedName || 'N/A'}</strong></td>
                                            <td>
                                                <span class="sentiment-badge ${log.sentiment ? log.sentiment.toLowerCase() : 'neutral'}">
                                                    ${log.sentiment || 'Unknown'}
                                                </span>
                                            </td>
                                            <td><small>${log.selectedCategory || 'Unknown'}</small></td>
                                            <td class="reply-cell">
                                                <div class="reply-text">${log.reply || 'No reply generated'}</div>
                                            </td>
                                         
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        modal.innerHTML = detailsHtml;
        document.body.appendChild(modal);
        
        // Add close event listeners
        const closeBtn = modal.querySelector('.modal-close');
        closeBtn.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    updateGroupSelectionState(groupId) {
        const group = this.groups.find(g => g.id === groupId);
        if (!group || !group.urls || group.urls.length === 0) return;
        
        // Check if all URLs in this group are selected
        const allUrlsSelected = group.urls.every(url => 
            this.selectedUrls.has(`${groupId}:${url}`)
        );
        
        // Check if at least one URL in this group is selected
        const someUrlsSelected = group.urls.some(url => 
            this.selectedUrls.has(`${groupId}:${url}`)
        );
        
        // Update group selection state
        if (allUrlsSelected) {
            this.selectedGroups.add(groupId);
        } else {
            this.selectedGroups.delete(groupId);
        }
    }

    setupEventDelegation() {
        // Event delegation for group checkboxes
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('group-checkbox-input')) {
                const groupId = e.target.getAttribute('data-group-id');
                console.log('[PageController] Group checkbox change event fired for groupId:', groupId);
                this.toggleGroupSelection(groupId);
            }
        });
        
        // Event delegation for group action buttons
        document.addEventListener('click', (e) => {
            // Edit group buttons
            if (e.target.classList.contains('edit-group-btn')) {
                const groupId = e.target.getAttribute('data-group-id');
                console.log('[PageController] Edit group button clicked for groupId:', groupId);
                this.editGroup(groupId);
            }
            
            // Delete group buttons
            if (e.target.classList.contains('delete-group-btn')) {
                const groupId = e.target.getAttribute('data-group-id');
                console.log('[PageController] Delete group button clicked for groupId:', groupId);
                this.deleteGroup(groupId);
            }
            
            // Select all URLs in group buttons
            if (e.target.classList.contains('select-all-urls-btn')) {
                const groupId = e.target.getAttribute('data-group-id');
                console.log('[PageController] Select all URLs button clicked for groupId:', groupId);
                this.selectAllUrlsInGroup(groupId);
            }
            
            // Deselect all URLs in group buttons
            if (e.target.classList.contains('deselect-all-urls-btn')) {
                const groupId = e.target.getAttribute('data-group-id');
                console.log('[PageController] Deselect all URLs button clicked for groupId:', groupId);
                this.deselectAllUrlsInGroup(groupId);
            }
            
            // Show tab details buttons
            if (e.target.classList.contains('show-tab-details-btn')) {
                const tabId = e.target.getAttribute('data-tab-id');
                console.log('[PageController] Show tab details button clicked for tabId:', tabId);
                this.showTabDetails(tabId);
            }
            
            // URL delete buttons
            if (e.target.classList.contains('url-delete-btn')) {
                const groupId = e.target.getAttribute('data-group-id');
                const url = decodeURIComponent(e.target.getAttribute('data-url'));
                console.log('[PageController] Delete URL button clicked for:', groupId, url);
                this.deleteUrl(groupId, url);
            }
        });
        
        // Event delegation for URL checkboxes
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('url-checkbox-input')) {
                const groupId = e.target.getAttribute('data-group-id');
                const url = decodeURIComponent(e.target.getAttribute('data-url'));
                console.log('[PageController] URL checkbox change event fired for:', groupId, url);
                this.toggleUrlSelection(groupId, url);
            }
        });
    }

    // Processing table methods (for Processing Control section)
    initializeProcessingTable(clearMap = true) {
        // JOB STATUS TABLE: Shows progress for each job being processed
        // This table shows: Job ID, Restaurant name, URL, Status, Progress bar, Total reviews found, Total replies generated
        
        // Only create HTML if it doesn't exist
        if (!this.elements.processingTable) {
            const processingSectionHtml = `
                <div id="processingTable" class="processing-table-container">
                    <div class="processing-header">
                        <h4>Job Processing Status</h4>
                    </div>
                    <table class="processing-table">
                        <thead>
                            <tr>
                                <th>Job ID</th>
                                <th>Restaurant</th>
                                <th>URL</th>
                                <th>Status</th>
                                <th>Progress</th>
                            </tr>
                        </thead>
                        <tbody id="processingTableBody">
                            <!-- Processing entries will be populated here -->
                        </tbody>
                    </table>
                </div>
            `;
            
            // Insert after the processing status element
            if (this.elements.processingStatus) {
                this.elements.processingStatus.insertAdjacentHTML('afterend', processingSectionHtml);
                this.elements.processingTable = document.getElementById('processingTable');
                this.elements.processingTableBody = document.getElementById('processingTableBody');
            }
        }
        
        // Initialize/clear job tracking map for new processing session (only if requested)
        if (clearMap) {
            this.jobProcessingMap = new Map(); // jobId -> processing data
        }
        
        // Show the processing table
        if (this.elements.processingTable) {
            this.elements.processingTable.style.display = 'block';
        }
        
        console.log('[PageController] Job processing table initialized with job ID tracking');
    }

    renderProcessingTable() {
        // JOB STATUS TABLE: Updates job-level progress, using job ID as primary key
        // This method populates the processing status table with job progress information
        console.log('[PageController] renderProcessingTable called:', {
            hasTableBody: !!this.elements.processingTableBody,
            hasMap: !!this.jobProcessingMap,
            mapSize: this.jobProcessingMap ? this.jobProcessingMap.size : 0,
            hasLastRunDate: !!this.lastRunDate,
            isProcessing: this.isProcessing
        });
        
        if (!this.elements.processingTableBody) return;
        
        // Only hide the table if map is empty AND processing hasn't started yet
        // Keep table visible when processing is complete to show final results
        if (!this.jobProcessingMap || this.jobProcessingMap.size === 0) {
            if (!this.lastRunDate) {
                // No previous run, hide table
                console.log('[PageController] Hiding table - no previous run');
                this.elements.processingTable.style.display = 'none';
                return;
            } else {
                // Previous run exists, show empty table with message
                console.log('[PageController] Showing empty table with message - previous run exists');
                this.elements.processingTable.style.display = 'block';
                this.elements.processingTableBody.innerHTML = `
                    <tr>
                        <td colspan="7" style="text-align: center; padding: 20px; color: #666;">
                            No active jobs. Click "Start Processing" to begin.
                        </td>
                    </tr>
                `;
                return;
            }
        }
        
        console.log('[PageController] Showing table with', this.jobProcessingMap.size, 'jobs');
        this.elements.processingTable.style.display = 'block';
        
        // Convert map to array for rendering, using job ID as unique identifier
        const processingEntries = Array.from(this.jobProcessingMap.values());
        
        this.elements.processingTableBody.innerHTML = processingEntries.map(job => {
            const statusIcon = job.status === 'completed' ? '✅' : 
                             job.status === 'partial' ? '🟡' : 
                             job.status === 'processing' ? '🔄' : 
                             job.status === 'auto-publishing' ? '🚀' : 
                             job.status === 'auto-reply-completed' ? '✅' : 
                             job.status === 'loading' ? '⏳' : 
                             job.status === 'queued' ? '⏸️' : 
                             job.status === 'error' ? '❌' : 
                             job.status === 'cancelled' ? '🚫' : '⏳';
            
            const progress = job.progress && job.progress.total > 0 ? 
                `${job.progress.current}/${job.progress.total}` : '0/0';
            const percentage = job.progress && job.progress.total > 0 ? 
                Math.round((job.progress.current / job.progress.total) * 100) : 0;
            
            // Truncate URL for display
            const displayUrl = job.url.length > 50 ? job.url.substring(0, 50) + '...' : job.url;
            
            return `
                <tr class="processing-row ${job.status}" data-job-id="${job.jobId}">
                    <td>
                        <span class="job-id-badge">${job.jobId}</span>
                    </td>
                    <td>${job.restaurantName || 'Loading...'}</td>
                    <td><a href="${job.url}" target="_blank" class="url-link" title="${job.url}">${displayUrl}</a></td>
                    <td>
                        <span class="status-badge status-${job.status}">
                            ${statusIcon} ${job.status.replace(/-/g, ' ')}
                            ${job.status === 'partial' && job.completionRate ? ` (${job.completionRate}%)` : ''}
                        </span>
                    </td>
                    <td>
                        <div class="progress-container">
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${percentage}%"></div>
                            </div>
                            <span class="progress-text">${progress} (${percentage}%)</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
        console.log(`[PageController] Rendered job processing table with ${processingEntries.length} jobs`);
    }

    // NEW: Handle job status updates from background script
    handleJobStatusUpdate(message) {
        console.log('[PageController] Handling job status update:', message);
        if (!message.jobId) {
            console.warn('[PageController] Job status update missing jobId:', message);
            return;
        }
        if (!this.jobProcessingMap) {
            this.jobProcessingMap = new Map();
        }
        const reviewCount = message.reviewCount || message.data?.reviewCount || 0;
        const expectedReviews = message.expectedReviews || message.data?.expectedReviews || null;
        const finalStatus = message.status;
        const completionRate = message.completionRate || message.data?.completionRate || null;
        console.log(`[PageController] Job ${message.jobId} status update: ${finalStatus} (${reviewCount}/${expectedReviews} reviews)`);
        const jobData = {
            jobId: message.jobId,
            url: message.url,
            tabId: message.tabId,
            status: finalStatus,
            restaurantName: message.restaurantName || 'Loading...',
            progress: message.progress || { current: 0, total: 0 },
            reviewCount: reviewCount,
            repliesCount: message.repliesCount || message.data?.repliesCount || 0,
            startTime: message.startTime,
            endTime: message.endTime,
            error: message.error,
            completionRate: completionRate,
            expectedReviews: expectedReviews,
            lastUpdated: new Date().toISOString()
        };
        this.jobProcessingMap.set(message.jobId, jobData);
        this.renderProcessingTable();
        console.log(`[PageController] Updated job ${message.jobId} status to ${finalStatus}`);
        // If the job is completed, try to start the next job
        if (finalStatus === 'completed' || finalStatus === 'partial' ||finalStatus=='auto-reply-completed' ) {
            this.maybeStartNextJob();
        }
    }

    maybeStartNextJob() {
        // Find the next job in the queue that is not completed, error, or cancelled
        const nextJob = Array.from(this.jobProcessingMap.values()).find(job =>
            job.status !== 'completed' && job.status !== 'partial' && job.status !== 'error' && job.status !== 'cancelled'&&job.status!=="auto-reply-completed" && job.status!=="auto-publishing"
        );
        if (nextJob) {
            // Logic to start the next job, if dashboard controls the queue
            // If background controls the queue, just log
            console.log(`[PageController] Next job to process: ${nextJob.jobId}`);
            // If you need to trigger, uncomment:
            chrome.runtime.sendMessage({ action: 'startProcessing', jobId: nextJob.jobId });
        } else {
            console.log('[PageController] All jobs completed.');
            this.isProcessing = false;
            this.updateProcessingState();
        }
    }

    initializeReviewsTable() {
        // Initialize empty reviews table in Results section
        this.renderReviewsTable([]);
    }

    // Storage for individual reviews
    addReviewToResults(reviewData) {
        if (!this.allReviews) {
            this.allReviews = [];
        }
        
        this.allReviews.push({
            ...reviewData,
            timestamp: reviewData.timestamp || new Date().toISOString()
        });
        
        // Re-render the reviews table with updated data
        this.renderReviewsTable(this.allReviews);
    }

    downloadReviews(reviews) {
        if (!reviews || reviews.length === 0) {
            alert('No reviews to download');
            return;
        }
        
        const csvData = [
            ['Restaurant', 'Customer', 'Detected FirstName', 'Rating', 'Review', 'Reply', 'Sentiment', 'Complaint ID', 'Timestamp'],
            ...reviews.map(r => [
                r.restaurantName || '',
                r.customerName || '',
                r.extractedName || 'N/A',
                r.rating || '',
                r.reviewText || '',
                r.reply || '',
                r.sentiment || '',
                r.complaintId || '',
                r.timestamp ? new Date(r.timestamp).toLocaleString() : ''
            ])
        ];
        
        const csvContent = csvData.map(row => 
            row.map(cell => `"${cell.toString().replace(/"/g, '""')}"`).join(',')
        ).join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `autozomato-reviews-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    clearReviews() {
        if (confirm('Are you sure you want to clear all review data?')) {
            this.allReviews = [];
            this.renderReviewsTable([]);
        }
    }

    // LEGACY METHODS REMOVED - These methods are no longer needed since we now track jobs by ID
    // Job status updates are now handled by handleJobStatusUpdate() method
    // - updateRealtimeProgressDisplay() 
    // - markRestaurantCompleted()
    // - markRestaurantError()
    
    // Clear the processing table (when starting new processing)
    clearProcessingTable() {
        if (this.jobProcessingMap) {
            this.jobProcessingMap.clear();
        }
        if (this.elements.processingTableBody) {
            this.elements.processingTableBody.innerHTML = '';
        }
        console.log('[Dashboard] Job processing table cleared');
    }

    // Utility: Generate unique ID
    generateId() {
        return 'group-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    // Utility: Handle modal close with specific cleanup
    handleModalClose(modal) {
        modal.style.display = 'none';
        
        // Call specific cleanup methods based on modal ID
        if (modal.id === 'addUrlModal') {
            this.hideAddUrlModal();
        } else if (modal.id === 'uploadCsvModal') {
            this.hideUploadCsvModal();
        }
    }

    // Utility: Normalize URL for deduplication (removes trailing slash, lowercases, strips query/hash)
    normalizeUrl(url) {
        try {
            const u = new URL(url);
            u.hash = '';
            u.search = '';
            let norm = u.toString();
            if (norm.endsWith('/')) norm = norm.slice(0, -1);
            return norm.toLowerCase();
        } catch (e) {
            return url ? url.trim().toLowerCase().replace(/\/$/, '') : '';
        }
    }

    // Debug functions for console access
    debugReviewsMap() {
        console.log('[AutoZomato] Reviews Map Debug:', {
            mapSize: this.reviewsMap.size,
            reviews: Array.from(this.reviewsMap.entries()).map(([id, review]) => ({
                reviewId: id,
                customerName: review.customerName,
                replied: review.replied,
                hasReply: !!review.reply,
                restaurant: review.restaurantName
            }))
        });
        return this.reviewsMap;
    }

    debugTableRows() {
        if (!this.elements.realTimeResultsTableBody) {
            console.log('[AutoZomato] No table body found');
            return [];
        }
        
        const rows = Array.from(this.elements.realTimeResultsTableBody.querySelectorAll('tr[data-review-id]'));
        console.log('[AutoZomato] Table Rows Debug:', {
            rowCount: rows.length,
            rows: rows.map(row => ({
                reviewId: row.getAttribute('data-review-id'),
                statusBadge: row.querySelector('.status-badge')?.textContent?.trim(),
                customerName: row.cells[1]?.textContent?.trim(),
                hasReply: !!row.querySelector('.reply-cell')?.textContent?.trim()
            }))
        });
        return rows;
    }
}

// Initialize the page controller when DOM is loaded
let pageController;

document.addEventListener('DOMContentLoaded', () => {
    console.log('[PageController] DOM Content Loaded - Initializing PageController');
    console.log('[PageController] Current URL:', window.location.href);
    console.log('[PageController] Document title:', document.title);
    
    // Test if resultsContainer exists before creating PageController
    const resultsContainer = document.getElementById('resultsContainer');
    console.log('[PageController] Initial resultsContainer check:', !!resultsContainer);
    console.log('[PageController] resultsContainer element:', resultsContainer);
    
    pageController = new PageController();
    
    // Make it globally accessible for onclick handlers immediately
    window.pageController = pageController;
    
    // Add debug functions to window for console access
    window.debugReviewsMap = () => pageController.debugReviewsMap();
    window.debugTableRows = () => pageController.debugTableRows();
    
    console.log('[PageController] PageController initialized and assigned to window');
    console.log('[PageController] window.pageController:', window.pageController);
    console.log('[PageController] Available methods:', Object.getOwnPropertyNames(window.pageController.__proto__));
    
    // Test the toggleGroupSelection method
    console.log('[PageController] toggleGroupSelection method available:', typeof window.pageController.toggleGroupSelection);
});
