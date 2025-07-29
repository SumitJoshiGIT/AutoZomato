class AutoZomatoBackground {
    constructor() {
        this.isProcessing = false;
        this.processingTabs = new Map(); // Map of tabId -> processJob
        this.allResults = [];
        this.detailedReviewLogs = []; // Store detailed review logs for Excel export
        this.progress = { current: 0, total: 0 };
        this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
        this.logs = []; // Store logs for state restoration
        this.jobStatuses = new Map(); // Map of jobId -> status object (NEW: job-based status tracking)
        this.startTime = new Date('2025-07-30T00:00:00Z'); 
        this.started = false;
        
        // Queue-based processing system
        this.processQueue = []; // Array of process jobs
        this.processJobCounter = 0; // Counter for unique job IDs
        this.activeProcessJob = null; // Currently processing job
        this.tabToJobMap = new Map(); // Map of tabId -> jobId
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
                        replyWaitTime: message.replyWaitTime,
                        processingMode: message.processingMode,
                        dateRange: message.dateRange
                    });
                    this.startProcessing({
                        urls: message.urls || [],
                        autoReply: message.autoReply !== undefined ? message.autoReply : false,
                        autoClose: message.autoClose !== undefined ? message.autoClose : false,
                        replyWaitTime: message.replyWaitTime || 3,
                        processingMode: message.processingMode || 'ollama',
                        gptMode: message.gptMode || {},
                        ollamaMode: message.ollamaMode || {},
                        offlineMode: message.offlineMode || {},
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
                    const jobStatusesArray = Array.from(this.jobStatuses.values());
                    console.log(`[Background] getProcessingState - returning ${jobStatusesArray.length} job statuses:`, 
                        jobStatusesArray.map(js => ({ jobId: js.jobId, url: js.url, status: js.status })));
                    
                    sendResponse({
                        isProcessing: this.isProcessing,
                        progress: this.progress,
                        results: this.results,
                        logs: this.logs,
                        jobStatuses: jobStatusesArray, // Convert Map to Array for UI
                        started: this.started
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
                    if (message.jobId) {
                        this.handleJobCompleted(message.jobId, message.data);
                    } else {
                        console.warn('[Background] Received legacy tabCompleted message without jobId. Ignoring.');
                    }
                    break;
                case 'tabError':
                    if (message.jobId) {
                        this.handleJobError(message.jobId, message.error);
                    } else {
                        console.warn('[Background] Received legacy tabError message without jobId. Ignoring.');
                    }
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
                case 'autoReplyCompleted':
                    this.handleAutoReplyCompleted(sender.tab.id, message);
                    break;
            }
        });

        // Handle tab removal
        chrome.tabs.onRemoved.addListener((tabId) => {
            const jobId = this.tabToJobMap.get(tabId);
            if (jobId) {
                console.log(`[Background] Tab ${tabId} removed, job ${jobId} may be affected`);
                this.tabToJobMap.delete(tabId);
                this.processingTabs.delete(tabId);
                
                // If this was the active job and it's not completed, mark it as error
                if (this.activeProcessJob?.id === jobId && this.activeProcessJob.status === 'processing') {
                    this.handleJobError(jobId, 'Tab was closed unexpectedly');
                }
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
        const jobStatusesArray = Array.from(this.jobStatuses.values());
        console.log(`[Background] broadcastState - sending ${jobStatusesArray.length} job statuses:`, 
            jobStatusesArray.map(js => ({ jobId: js.jobId, url: js.url, status: js.status })));
        
        chrome.runtime.sendMessage({
            action: 'updateState',
            data: {
                isProcessing: this.isProcessing,
                progress: this.progress,
                results: this.results,
                logs: this.logs,
                jobStatuses: jobStatusesArray, // Convert Map to Array for UI
                started: this.started
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
        if (this.started) {
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
            replyWaitTime: data.replyWaitTime || 3,
            processingMode: data.processingMode || 'ollama',
            gptMode: data.gptMode || this.config.gptMode || { // Use passed gptMode or fallback to loaded
                enabled: false,
                apiKey: '',
                keyName: 'AutoZomato GPT Key',
                model: 'gpt-4o-mini'
            },
            ollamaMode: data.ollamaMode || {
                enabled: false,
                url: 'http://localhost:11434',
                model: 'llama3:8b'
            },
            offlineMode: data.offlineMode || {
                enabled: false
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
            urls: this.config.urls.length,
            processingMode: this.config.processingMode,
            gptMode: {
                enabled: this.config.gptMode.enabled,
                hasApiKey: !!this.config.gptMode.apiKey,
                apiKey: this.config.gptMode.apiKey ? '***masked***' : '',
                model: this.config.gptMode.model
            },
            ollamaMode: {
                enabled: this.config.ollamaMode.enabled,
                url: this.config.ollamaMode.url,
                model: this.config.ollamaMode.model
            },
            offlineMode: {
                enabled: this.config.offlineMode.enabled
            }
        });
        
        // Clear all data from previous runs to prevent duplicates
        this.allResults = [];
        this.detailedReviewLogs = [];
        this.jobStatuses.clear();
        this.processingTabs.clear();
        
        // Reset progress and results for the new run
        this.progress = { current: 0, total: this.config.urls.length };
        this.results = { totalReviews: 0, successfulReplies: 0, errors: 0 };
        this.logs = [];
        
        // Reset queue-based processing state for the new run
        this.processQueue = [];
        this.processJobCounter = 0;
        this.activeProcessJob = null;
        this.tabToJobMap.clear();
        
        // Create process jobs for each URL
        this.config.urls.forEach((url, index) => {
            const jobId = `job_${++this.processJobCounter}`;
            
            const processJob = {
                id: jobId,
                url: url,
                index: index,
                status: 'queued',
                tabId: null,
                restaurantName: null,
                startTime: null,
                endTime: null,
                data: null,
                error: null
            };
            
            this.processQueue.push(processJob);
            console.log(`[Background] Created job ${jobId} for URL: ${url}`);
            
            // Add to job statuses immediately so UI can show queued items
            this.jobStatuses.set(jobId, {
                jobId: jobId,
                tabId: null,
                url: url,
                status: 'queued',
                restaurantName: null,
                progress: null,
                startTime: null,
                endTime: null,
                data: {}
            });
        });
        
        // Debug: Check for duplicates after creation
        console.log(`[Background] Created ${this.processQueue.length} jobs and ${this.jobStatuses.size} status entries`);
        if (this.processQueue.length !== this.jobStatuses.size) {
            console.error(`[Background] MISMATCH: ${this.processQueue.length} jobs vs ${this.jobStatuses.size} status entries`);
        }
        
        // Log all job statuses for debugging
        console.log(`[Background] Job statuses created:`, Array.from(this.jobStatuses.entries()).map(([id, status]) => ({
            jobId: id,
            url: status.url,
            status: status.status
        })));
        
        // Display the actual processing mode being used
        let modeDisplay = 'Unknown';
        switch (this.config.processingMode) {
            case 'gpt':
                modeDisplay = `GPT-${this.config.gptMode.model}`;
                break;
            case 'ollama':
                modeDisplay = `Ollama-${this.config.ollamaMode.model}`;
                break;
            case 'offline':
                modeDisplay = 'Offline';
                break;
            default:
                modeDisplay = `${this.config.processingMode} (Unknown)`;
        }
        
        this.addLog(`🚀 Processing started: ${this.config.urls.length} URLs, Auto-Reply: ${this.config.autoReply}, Auto-Close: ${this.config.autoClose}, AI Mode: ${modeDisplay}`);
        
        try {
            // Start queue-based sequential processing
            this.processNextInQueue();
        } catch (error) {
            console.error('Error during processing:', error);
            this.addLog(`Processing error: ${error.message}`, 'error');
            this.sendMessageToPopup('error', error.message);
            this.isProcessing = false;
        }
    }

    async processNextInQueue() {
        if (!this.isProcessing) {
            this.addLog('Processing stopped by user.', 'warning');
            return;
        }
        
        // Find next queued job
        const nextJob = this.processQueue.find(job => job.status === 'queued');
        if (!nextJob) {
            // No more jobs in queue, processing complete
            this.addLog(`All ${this.processQueue.length} URLs processed, completing...`);
            this.completeProcessing();
            return;
        }
        
        // Set as active job
        this.activeProcessJob = nextJob;
        nextJob.status = 'processing';
        nextJob.startTime = Date.now();
        
        this.addLog(`Processing job ${nextJob.id} (${nextJob.index + 1}/${this.processQueue.length}): ${nextJob.url}`);
        console.log(`[Background] Processing job ${nextJob.id}: ${nextJob.url}`);
        
        // Update job status
        this.updateJobStatus(nextJob.id, 'processing');
        
        try {
            await this.openTabForJob(nextJob);
        } catch (error) {
            console.error(`[Background] Error processing job ${nextJob.id}:`, error);
            this.handleJobError(nextJob.id, error.message);
        }
    }

    async openTabForJob(job) {
        console.log(`[Background] Opening tab for job ${job.id}: ${job.url}`);
        
        try {
            const tab = await chrome.tabs.create({ url: job.url, active: false });
            console.log(`[Background] Tab ${tab.id} created for job ${job.id}`);
            
            // Link tab to job
            job.tabId = tab.id;
            this.tabToJobMap.set(tab.id, job.id);
            this.processingTabs.set(tab.id, job);
            
            // Update job status
            this.updateJobStatus(job.id, 'loading', { tabId: tab.id });
            
            this.addLog(`Opening tab for job ${job.id}: ${job.url}`);
            this.sendMessageToPopup('updateJobStatus', {
                jobId: job.id,
                tabId: tab.id,
                url: job.url,
                status: 'loading'
            });
            
            // Inject content script and start processing
            setTimeout(async () => {
                try {
                    // Check if job still exists and is active
                    if (this.activeProcessJob?.id !== job.id) {
                        console.log(`[Background] Job ${job.id} is no longer active, skipping injection`);
                        return;
                    }
                    
                    console.log(`[Background] Injecting content script into tab ${tab.id} for job ${job.id}`);
                    
                    // First, inject the content script
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['src/content/content.js'],
                    });

                    console.log(`[Background] Injecting config and triggering processing in tab ${tab.id} for job ${job.id}`);
                    
                    // Then, inject the config and job ID into the page, and trigger processing
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: (config, jobId) => {
                            window.autoZomatoConfig = config;
                            window.autoZomatoJobId = jobId;
                            console.log('[AutoZomato Background] Config and job ID injected:', { config, jobId });
                            
                            // Now, if startProcessing is available, call it.
                            if (typeof window.startProcessing === 'function') {
                                console.log('[AutoZomato Background] Triggering startProcessing from background injection.');
                                window.startProcessing(config.promptContext);
                            } else {
                                console.error('[AutoZomato Background] window.startProcessing is not defined on the page.');
                            }
                        },
                        args: [this.config, job.id] // Pass config and job ID
                    });
                    
                    console.log(`[Background] Script injected and triggered successfully into tab ${tab.id} for job ${job.id}`);
                    this.addLog(`Script injected successfully for job ${job.id}`);
                    
                    // Update status to processing
                    this.updateJobStatus(job.id, 'processing', { tabId: tab.id });
                    
                } catch (error) {
                    console.error(`[Background] Error injecting script into tab ${tab.id} for job ${job.id}:`, error);
                    this.handleJobError(job.id, `Failed to inject script: ${error.message}`);
                }
            }, 3000); // Wait 3 seconds for page to load
            
        } catch (error) {
            console.error(`[Background] Error opening tab for job ${job.id}:`, error);
            this.handleJobError(job.id, `Failed to open tab: ${error.message}`);
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
        
        // Broadcast final state to ensure UI shows completed job statuses
        this.broadcastState();
    }

    async processUrlsBatch() {
        // This function is no longer used - replaced by queue-based processing
        // Keeping for reference only
    }

    async openTabForProcessing(url, index, config) {
        // This function is no longer used - replaced by openTabForJob
        // Keeping for reference only
    }

    handleJobCompleted(jobId, data) {
        console.log(`[Background] handleJobCompleted called for job ${jobId}`);
        
        const job = this.processQueue.find(j => j.id === jobId);
        if (!job) {
            console.warn(`[Background] No job found with ID ${jobId}, ignoring completion message.`);
            return;
        }

        if (job.status === 'completed' || job.status === 'error' || job.status === 'cancelled') {
            console.warn(`[Background] Job ${jobId} already handled (status: ${job.status}), ignoring duplicate completion message.`);
            return;
        }
        
        const tabId = job.tabId;
        console.log(`[Background] Processing completion for job ${jobId}, tab ${tabId}`);
        console.log(`[Background] Job ${jobId} details:`, {
            id: job.id,
            url: job.url,
            tabId: job.tabId,
            status: job.status,
            restaurantName: job.restaurantName
        });
        
        // Determine completion status based on reviews processed vs expected
        const reviewCount = data.reviewCount || 0;
        const expectedReviews = data.expectedReviews || data.totalReviews || 0;
        
        console.log(`[Background] Job ${jobId} completion analysis:`, {
            reviewCount,
            expectedReviews,
            hasExpectedCount: expectedReviews > 0
        });
        
        // Determine final status
        let finalStatus = 'completed';
        if (expectedReviews > 0 && reviewCount !== expectedReviews) {
            // Job completed but processed different number of reviews than expected
            const completionRate = (reviewCount / expectedReviews) * 100;
            if (reviewCount < expectedReviews) {
                console.log(`[Background] Job ${jobId} partial completion: ${reviewCount}/${expectedReviews} reviews (${completionRate.toFixed(1)}%) - FEWER than expected`);
            } else {
                console.log(`[Background] Job ${jobId} partial completion: ${reviewCount}/${expectedReviews} reviews (${completionRate.toFixed(1)}%) - MORE than expected`);
            }
            finalStatus = 'partial';
        }
        
        job.status = finalStatus;
        job.endTime = Date.now();
        job.data = data;
        
        const restaurantName = data.restaurantName || job.restaurantName || this.extractRestaurantNameFromUrl(job.url);
        job.restaurantName = restaurantName;
        
        // Update log message based on completion type
        if (finalStatus === 'partial') {
            const completionRate = expectedReviews > 0 ? ((reviewCount / expectedReviews) * 100).toFixed(1) : 0;
            this.addLog(`${restaurantName} (Job ${jobId}) partially completed - ${reviewCount}/${expectedReviews} reviews (${completionRate}%), ${data.repliesCount} replies`, 'warning');
        } else {
            this.addLog(`${restaurantName} (Job ${jobId}) completed processing - ${reviewCount} reviews, ${data.repliesCount} replies`);
        }
        
        if (data.results && Array.isArray(data.results)) {
            // Add all results without filtering for duplicates (allow same URL to be processed multiple times)
            const enrichedResults = data.results.map(result => ({ ...result, url: job.url, jobId: jobId }));
            this.allResults.push(...enrichedResults);
            this.addLog(`Added ${enrichedResults.length} results from ${restaurantName} (Job ${jobId})`);
        }
        
        if (data.detailedReviewLog && Array.isArray(data.detailedReviewLog)) {
            // Add all detailed logs without filtering for duplicates
            const enrichedLogs = data.detailedReviewLog.map(log => ({ 
                ...log, 
                url: job.url, 
                jobId: jobId, 
                timestamp: new Date().toISOString(), 
                restaurantName: restaurantName 
            }));
            
            this.detailedReviewLogs.push(...enrichedLogs);
            this.addLog(`Added ${enrichedLogs.length} detailed review logs from ${restaurantName} (Job ${jobId})`);
        }
        
        this.results.totalReviews += data.reviewCount || 0;
        this.results.successfulReplies += data.repliesCount || 0;
        
        this.updateJobStatus(jobId, finalStatus, {
            tabId: tabId,
            reviewCount: data.reviewCount,
            repliesCount: data.repliesCount,
            restaurantName: restaurantName,
            endTime: Date.now(),
            expectedReviews: expectedReviews,
            completionRate: expectedReviews > 0 ? ((reviewCount / expectedReviews) * 100).toFixed(1) : 100
        });
        
        console.log(`[Background] Job ${jobId} marked as ${finalStatus} in jobStatuses Map`);
        console.log(`[Background] Current jobStatuses after completion:`, Array.from(this.jobStatuses.entries()).map(([id, status]) => ({
            jobId: id,
            url: status.url,
            status: status.status,
            restaurantName: status.restaurantName
        })));
        
        this.progress.current++;
        this.sendMessageToPopup('updateProgress', { current: this.progress.current, total: this.processQueue.length });
        
        if (this.config.autoClose && tabId) {
            this.addLog(`Auto-closing completed tab ${tabId} for job ${jobId}`);
            setTimeout(() => {
                chrome.tabs.remove(tabId).catch(e => console.log(`Error removing tab: ${e.message}`));
                this.tabToJobMap.delete(tabId);
                this.processingTabs.delete(tabId);
            }, 1000);
        }
        
        this.activeProcessJob = null;
        setTimeout(() => this.processNextInQueue(), 1000);
    }

    handleJobError(jobId, error) {
        console.log(`[Background] Handling job error for ${jobId}: ${error}`);
        
        const job = this.processQueue.find(j => j.id === jobId);
        if (!job) {
            console.warn(`[Background] No job found with ID ${jobId}, ignoring error message.`);
            return;
        }
        
        if (job.status === 'completed' || job.status === 'error' || job.status === 'cancelled') {
            console.warn(`[Background] Job ${jobId} already handled (status: ${job.status}), ignoring duplicate error message.`);
            return;
        }
        
        job.status = 'error';
        job.endTime = Date.now();
        job.error = error;
        
        this.addLog(`Job ${jobId} error: ${error}`, 'error');
        this.results.errors++;
        
        this.updateJobStatus(jobId, 'error', { 
            tabId: job.tabId,
            error: error,
            endTime: Date.now()
        });

        if (this.config.autoClose && job.tabId) {
            this.addLog(`Auto-closing error tab ${job.tabId} for job ${jobId}`, 'warning');
            setTimeout(() => {
                chrome.tabs.remove(job.tabId).catch(e => console.log(`Error removing tab: ${e.message}`));
                this.tabToJobMap.delete(job.tabId);
                this.processingTabs.delete(job.tabId);
            }, 1000);
        }
        
        this.activeProcessJob = null;
        setTimeout(() => this.processNextInQueue(), 1000);
    }

    async waitForTabCompletion() {
        // This function is no longer used - replaced by queue-based processing
        // Keeping for reference only
    }

    async waitForAllTabsComplete() {
        // This function is no longer used - replaced by queue-based processing
        // Keeping for reference only
    }

    checkProcessingComplete() {
        // This function is no longer used - replaced by queue-based processing
        // Keeping for reference only
    }

    stopProcessing() {
        this.addLog('Stopping processing...');
        this.isProcessing = false;
        
        // Mark all queued jobs as cancelled
        this.processQueue.forEach(job => {
            if (job.status === 'queued' || job.status === 'processing') {
                job.status = 'cancelled';
                job.endTime = Date.now();
                this.updateJobStatus(job.id, 'cancelled', { endTime: Date.now() });
            }
        });
        
        // Close all processing tabs
        for (const tabId of this.processingTabs.keys()) {
            try {
                chrome.tabs.remove(tabId);
            } catch (e) {
                // Ignore errors for tabs that might already be closed
            }
        }
        
        this.processingTabs.clear();
        this.tabToJobMap.clear();
        this.activeProcessJob = null;
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

    updateJobStatus(jobId, status, additionalData = {}) {
        console.log(`[Background] Updating job status for ${jobId}: ${status}`, additionalData);
        
        const job = this.processQueue.find(j => j.id === jobId);
        if (!job) {
            console.log(`[Background] No job found with ID ${jobId} for status update`);
            return;
        }
        
        // Get existing status or create new one
        const existingStatus = this.jobStatuses.get(jobId) || {
            jobId: jobId,
            tabId: null,
            url: job.url,
            status: 'queued',
            restaurantName: null,
            progress: null,
            startTime: null,
            endTime: null,
            data: {}
        };
        
        // Update the status
        const updatedStatus = {
            ...existingStatus,
            status: status,
            tabId: additionalData.tabId || existingStatus.tabId,
            restaurantName: additionalData.restaurantName || existingStatus.restaurantName,
            progress: additionalData.progress || existingStatus.progress,
            startTime: additionalData.startTime || existingStatus.startTime,
            endTime: additionalData.endTime || existingStatus.endTime,
            data: {
                ...existingStatus.data,
                ...additionalData
            }
        };
        
        // Store in Map
        this.jobStatuses.set(jobId, updatedStatus);
        
        console.log(`[Background] Updated job ${jobId} status: ${existingStatus.status} -> ${status}`);
        console.log(`[Background] Current jobStatuses count: ${this.jobStatuses.size}`);
        
        // Send update to UI with explicit job ID emphasis
        const messageData = {
            ...updatedStatus,
            jobId: jobId, // Ensure jobId is not overwritten by spreading updatedStatus
            status: status // Ensure status is not overwritten by spreading updatedStatus
        };
        
        console.log(`[Background] Sending job status update to UI:`, {
            jobId: messageData.jobId,
            status: messageData.status,
            url: messageData.url,
            tabId: messageData.tabId
        });
        
        this.sendMessageToPopup('updateJobStatus', messageData);
    }

    // Utility function to get job status as array for UI
    getJobStatusArray() {
        return Array.from(this.jobStatuses.values());
    }

    // Utility function to validate job status integrity
    validateJobStatuses() {
        const queueJobIds = this.processQueue.map(j => j.id);
        const statusJobIds = Array.from(this.jobStatuses.keys());
        
        console.log(`[Background] Validating job statuses...`);
        console.log(`[Background] Queue jobs: ${queueJobIds.length}, Status entries: ${statusJobIds.length}`);
        
        // Check for missing status entries
        const missingStatusIds = queueJobIds.filter(id => !this.jobStatuses.has(id));
        if (missingStatusIds.length > 0) {
            console.warn(`[Background] Missing status entries for jobs:`, missingStatusIds);
        }
        
        // Check for orphaned status entries
        const orphanedStatusIds = statusJobIds.filter(id => !queueJobIds.includes(id));
        if (orphanedStatusIds.length > 0) {
            console.warn(`[Background] Orphaned status entries for jobs:`, orphanedStatusIds);
        }
        
        if (missingStatusIds.length === 0 && orphanedStatusIds.length === 0) {
            console.log(`[Background] Job status integrity check passed`);
        }
        
        return {
            isValid: missingStatusIds.length === 0 && orphanedStatusIds.length === 0,
            missingStatusIds,
            orphanedStatusIds
        };
    }

    handleRestaurantNameUpdate(tabId, restaurantName, url) {
        // Find the job for this tab
        const jobId = this.tabToJobMap.get(tabId);
        if (!jobId) {
            console.log(`[Background] No job found for tab ${tabId} restaurant name update`);
            return;
        }
        
        const job = this.processQueue.find(j => j.id === jobId);
        if (!job) {
            console.log(`[Background] No job found with ID ${jobId} for restaurant name update`);
            return;
        }
        
        // Store restaurant name for this job
        job.restaurantName = restaurantName;
        
        // Update job status with restaurant name
        this.updateJobStatus(jobId, job.status, { 
            tabId: tabId,
            restaurantName: restaurantName 
        });
        
        this.addLog(`Restaurant name updated for job ${jobId}: ${restaurantName}`);
    }

    handleTabProgressUpdate(tabId, data) {
        console.log('[Background] Received tab progress update:', tabId, data);
        
        // Find the job for this tab
        const jobId = this.tabToJobMap.get(tabId);
        if (!jobId) {
            console.warn(`[Background] No job found for tab ${tabId} progress update`);
            return;
        }
        
        const job = this.processQueue.find(j => j.id === jobId);
        if (!job) {
            console.warn(`[Background] No job found with ID ${jobId} for progress update`);
            return;
        }
        
        // Update job with progress data
        job.progress = data.progress;
        job.restaurantName = data.restaurantName;
        
        // Update job status
        this.updateJobStatus(jobId, data.status, {
            tabId: tabId,
            restaurantName: data.restaurantName,
            progress: data.progress
        });
        
        console.log(`Job ${jobId} progress: ${data.progress.current}/${data.progress.total} - ${data.restaurantName}`);
    }

    handleAutoReplyCompleted(tabId, message) {
        console.log('[Background] Received autoReplyCompleted message:', tabId, message);
        
        // Find the job for this tab
        const jobId = this.tabToJobMap.get(tabId);
        if (!jobId) {
            console.warn(`[Background] No job found for tab ${tabId} auto-reply completion`);
            return;
        }
        
        const job = this.processQueue.find(j => j.id === jobId);
        if (!job) {
            console.warn(`[Background] No job found with ID ${jobId} for auto-reply completion`);
            return;
        }
        
        // Log auto-reply completion
        this.addLog(`🚀 Auto-reply completed for ${message.data.restaurantName}: ${message.data.publishedCount}/${message.data.totalToPublish} replies published (${message.data.successRate}% success rate)`);
        
        // Update job status to include auto-reply completion info
        this.updateJobStatus(jobId, 'completed', {
            tabId: tabId,
            restaurantName: message.data.restaurantName,
            progress: { current: message.data.publishedCount, total: message.data.totalToPublish },
            autoReplyCompleted: true,
            autoReplyStats: {
                publishedCount: message.data.publishedCount,
                totalToPublish: message.data.totalToPublish,
                successRate: message.data.successRate
            }
        });
        
        console.log(`[Background] Job ${jobId} auto-reply completed: ${message.data.publishedCount}/${message.data.totalToPublish} replies published`);
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
