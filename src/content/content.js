// --- AutoZomato Content Script Injection Check ---
console.log('[AutoZomato] Content script injected and running!');

// Use a set to track job IDs for which completion has been sent
if (typeof window.autoZomatoSentJobs === 'undefined') {
    window.autoZomatoSentJobs = new Set();
}

window.addEventListener('error', function(e) {
    try {
        // Only log errors from this script, not the page
        if (e && e.filename && e.filename.indexOf('content.js') !== -1) {
            console.error('[AutoZomato] Uncaught error:', e && e.message ? e.message : e);
        }
    } catch (err) {
        // fallback
        console.error('[AutoZomato] Error in error handler');
    }
});
window.addEventListener('unhandledrejection', function(e) {
    try {
        // Only log unhandled rejections from this script, not the page
        if (e && e.reason && e.reason.stack && e.reason.stack.indexOf('content.js') !== -1) {
            console.error('[AutoZomato] Unhandled promise rejection:', e && e.reason ? e.reason : e);
        }
    } catch (err) {
        // fallback
        console.error('[AutoZomato] Error in unhandledrejection handler');
    }
});

// AutoZomato Content Script for Review Processing
console.log('AutoZomato content script loaded');

// UNIFIED REVIEW STATE MANAGER - Single source of truth for all review processing
if (typeof window.AutoZomatoReviewManager === 'undefined') {
    window.AutoZomatoReviewManager = {
        // Core data structure - single array with all review states
        reviews: new Map(), // reviewId -> reviewData
        
        // Processing state
        processingState: {
            currentSessionUrl: '',
            currentRestaurantName: '',
            totalReviews: 0,
            processedCount: 0,
            autoReplyEnabled: false,
            autoReplyRunning: false,
            autoReplyStopped: false,
            autoReplyWaitTime: 3000
        },
        
        // Review states enum
        ReviewState: {
            SCRAPED: 'scraped',           // Review found and scraped from DOM
            PROCESSING: 'processing',     // AI/analysis in progress
            PROCESSED: 'processed',       // Analysis complete, reply generated
            QUEUED: 'queued',            // Queued for auto-reply
            PUBLISHING: 'publishing',     // Auto-reply in progress
            PUBLISHED: 'published',       // Reply successfully published
            FAILED: 'failed',            // Processing or publishing failed
            SKIPPED: 'skipped'           // Skipped for some reason
        },
        
        // Add or update a review
        addReview: function(reviewData) {
            const reviewId = reviewData.reviewId;
            if (!reviewId) {
                console.error('[ReviewManager] Cannot add review without reviewId');
                return null;
            }
            
            // Merge with existing data or create new
            const existingReview = this.reviews.get(reviewId);
            const updatedReview = {
                // Default values
                reviewId: reviewId,
                customerName: reviewData.customerName || 'Customer',
                extractedName: null,
                reviewText: reviewData.reviewText || '',
                rating: reviewData.rating || 'N/A',
                sentiment: null,
                complaintId: null,
                confidence: 0,
                selectedCategory: null,
                reply: null,
                state: this.ReviewState.SCRAPED,
                includeInAutoReply: false,
                restaurantName: reviewData.restaurantName || this.processingState.currentRestaurantName,
                timestamp: Date.now(),
                processingStartTime: null,
                processingEndTime: null,
                publishingStartTime: null,
                publishingEndTime: null,
                error: null,
                // DOM references
                element: reviewData.element || null,
                replyTextarea: reviewData.replyTextarea || null,
                publishBtn: reviewData.publishBtn || null,
                // Merge existing data
                ...(existingReview || {}),
                // Override with new data
                ...reviewData
            };
            
            this.reviews.set(reviewId, updatedReview);
            console.log(`[ReviewManager] ${existingReview ? 'Updated' : 'Added'} review ${reviewId} with state: ${updatedReview.state}`);
            return updatedReview;
        },
        
        // Update review state
        updateReview: function(reviewId, updates) {
            const review = this.reviews.get(reviewId);
            if (!review) {
                console.error(`[ReviewManager] Cannot update non-existent review ${reviewId}`);
                return null;
            }
            
            // Special handling for state changes
            if (updates.state && updates.state !== review.state) {
                console.log(`[ReviewManager] Review ${reviewId} state: ${review.state} -> ${updates.state}`);
                
                // Update timestamps based on state changes
                if (updates.state === this.ReviewState.PROCESSING) {
                    updates.processingStartTime = Date.now();
                }
                if (updates.state === this.ReviewState.PROCESSED) {
                    updates.processingEndTime = Date.now();
                }
                if (updates.state === this.ReviewState.PUBLISHING) {
                    updates.publishingStartTime = Date.now();
                }
                if (updates.state === this.ReviewState.PUBLISHED) {
                    updates.publishingEndTime = Date.now();
                }
            }
            
            // Merge updates
            const updatedReview = { ...review, ...updates };
            this.reviews.set(reviewId, updatedReview);
            
            return updatedReview;
        },
        
        // Get reviews by state
        getReviewsByState: function(state) {
            return Array.from(this.reviews.values()).filter(review => review.state === state);
        },
        
        // Get reviews ready for auto-reply
        getAutoReplyQueue: function() {
            const allReviews = Array.from(this.reviews.values());
            const queuedReviews = allReviews.filter(review => review.state === this.ReviewState.QUEUED);
            
            console.log(`[ReviewManager] getAutoReplyQueue - Found ${queuedReviews.length} QUEUED reviews`);
            
            // Debug each queued review
            queuedReviews.forEach(review => {
                console.log(`[ReviewManager] Queue Debug - Review ${review.reviewId}:`, {
                    state: review.state,
                    includeInAutoReply: review.includeInAutoReply,
                    hasReply: !!review.reply,
                    hasPublishBtn: !!review.publishBtn,
                    publishBtnValid: review.publishBtn && document.contains(review.publishBtn)
                });
            });
            
            return queuedReviews.filter(review => 
                review.includeInAutoReply &&
                review.reply &&
                review.publishBtn
            );
        },
        
        // Get statistics
        getStats: function() {
            const allReviews = Array.from(this.reviews.values());
            return {
                total: allReviews.length,
                scraped: allReviews.filter(r => r.state === this.ReviewState.SCRAPED).length,
                processing: allReviews.filter(r => r.state === this.ReviewState.PROCESSING).length,
                processed: allReviews.filter(r => r.state === this.ReviewState.PROCESSED).length,
                queued: allReviews.filter(r => r.state === this.ReviewState.QUEUED).length,
                publishing: allReviews.filter(r => r.state === this.ReviewState.PUBLISHING).length,
                published: allReviews.filter(r => r.state === this.ReviewState.PUBLISHED).length,
                failed: allReviews.filter(r => r.state === this.ReviewState.FAILED).length,
                skipped: allReviews.filter(r => r.state === this.ReviewState.SKIPPED).length,
                autoReplyEnabled: allReviews.filter(r => r.includeInAutoReply).length,
                autoReplyQueue: this.getAutoReplyQueue().length
            };
        },
        
        // Clear all data for new session
        clearSession: function() {
            this.reviews.clear();
            this.processingState.processedCount = 0;
            this.processingState.totalReviews = 0;
            this.processingState.autoReplyRunning = false;
            this.processingState.autoReplyStopped = false;
            console.log('[ReviewManager] Session cleared');
        },
        
        // Export data for compatibility with existing code
        exportLegacyFormat: function() {
            const allReviews = Array.from(this.reviews.values());
            return allReviews.map(review => ({
                reviewId: review.reviewId,
                customerName: review.customerName,
                extractedName: review.extractedName,
                reviewText: review.reviewText,
                rating: review.rating,
                sentiment: review.sentiment,
                complaintId: review.complaintId,
                confidence: review.confidence,
                selectedCategory: review.selectedCategory,
                reply: review.reply,
                replied: review.state === this.ReviewState.PUBLISHED,
                includeInAutoReply: review.includeInAutoReply,
                restaurantName: review.restaurantName
            }));
        }
    };
}

// Legacy compatibility aliases
if (typeof processedReviewsLog === 'undefined') {
    var processedReviewsLog = [];
}

if (typeof currentSessionUrl === 'undefined') {
    var currentSessionUrl = '';
}

if (typeof currentRestaurantName === 'undefined') {
    var currentRestaurantName = '';
}

if (typeof complaintMappings === 'undefined') {
    var complaintMappings = new Map();
}

// Legacy variables have been replaced by ReviewManager
// No need for global autoReplyQueue, autoReplyProcessorRunning, and autoReplyProcessorStopped variables

// Load complaint mappings from response bank for specific brand
async function loadComplaintMappings(brandId = null) {
    // Use brandId if provided, otherwise try to get it from global variable
    const targetBrandId = brandId || window.autoZomatoBrandId || '1'; // Default to brand 1
    
    console.log(`[AutoZomato] Loading complaint mappings for brand: ${targetBrandId}`);
    
    if (complaintMappings.size > 0) {
        console.log('[AutoZomato] Complaint mappings already loaded, skipping...');
        return; // Already loaded
    }
    
    try {
        const response = await fetch(chrome.runtime.getURL('response_bank.json'));
        const data = await response.json();
        
        // Get brand-specific data
        const brandData = data[targetBrandId];
        if (!brandData) {
            console.warn(`[AutoZomato] Brand ${targetBrandId} not found in response bank, using fallback`);
            throw new Error(`Brand ${targetBrandId} not found`);
        }
        
        console.log(`[AutoZomato] Found brand data for ${targetBrandId}:`, brandData.name);
        
        // Load categories (star-based responses) for this brand
        if (brandData.categories) {
            brandData.categories.forEach(category => {
                complaintMappings.set(category.id, {
                    name: category.storyName,
                    type: 'category',
                    responses: category.responses
                });
            });
        }
        
        // Load complaints (specific issues) for this brand
        if (brandData.complaints) {
            brandData.complaints.forEach(complaint => {
                complaintMappings.set(complaint.id, {
                    name: complaint.storyName,
                    type: 'complaint',
                    responses: complaint.responses
                });
            });
        }
        
        console.log(`[AutoZomato] Loaded complaint mappings for brand ${targetBrandId} (${brandData.name}):`, complaintMappings.size, 'entries');
    } catch (error) {
        console.error(`[AutoZomato] Failed to load complaint mappings for brand ${targetBrandId}:`, error);
        // Add fallback mappings
        complaintMappings.set('1', { name: '5 Star Comments', type: 'category' });
        complaintMappings.set('2', { name: '4 Star Comments', type: 'category' });
        complaintMappings.set('3', { name: '3 Star Comments', type: 'category' });
    }
}

// Debug function for testing popup functionality
window.autoZomatoTestPopup = function() {
    console.log('[AutoZomato] Manual popup test called');
    showLogPopup();
};

// Debug function to force send completion signal
window.autoZomatoForceComplete = function() {
    console.log('[AutoZomato] Force completion signal called');
    console.log('- Current job ID:', window.autoZomatoJobId);
    console.log('- Sent jobs:', window.autoZomatoSentJobs);
    console.log('- Auto-reply processor running:', reviewManager.processingState.processingRunning);
    console.log('- Auto-reply queue length:', reviewManager.getAutoReplyQueue().length);
    console.log('- Auto-reply queue items:', reviewManager.getAutoReplyQueue().map(item => item.reviewId));
    
    // Clear the sent jobs set to allow resending
    if (window.autoZomatoJobId && window.autoZomatoSentJobs.has(window.autoZomatoJobId)) {
        window.autoZomatoSentJobs.delete(window.autoZomatoJobId);
        console.log('- Removed job from sent jobs set');
    }
    
    // Force send completion signal
    sendProcessingCompletionSignal();
};

// Debug function to check auto-reply processor state
window.autoZomatoCheckAutoReply = function() {
    const reviewManager = window.AutoZomatoReviewManager;
    const queuedReviews = reviewManager.getAutoReplyQueue();
    
    console.log('[AutoZomato] Auto-reply processor state:');
    console.log('- ReviewManager autoReplyRunning:', reviewManager.processingState.autoReplyRunning);
    console.log('- ReviewManager autoReplyStopped:', reviewManager.processingState.autoReplyStopped);
    console.log('- ReviewManager processingRunning:', reviewManager.processingState.processingRunning);
    console.log('- ReviewManager processingState:', reviewManager.processingState);
    console.log('- Queued reviews count:', queuedReviews.length);
    console.log('- Queued reviews:', queuedReviews.map(review => ({
        reviewId: review.reviewId,
        hasReply: !!review.reply,
        hasPublishBtn: !!review.publishBtn,
        publishBtnValid: review.publishBtn && document.contains(review.publishBtn)
    })));
    console.log('- Config auto-reply enabled:', window.autoZomatoConfig?.autoReply);
    console.log('- ReviewManager stats:', reviewManager.getStats());
    
    // Check ALL queued reviews, not just those that pass getAutoReplyQueue filter
    const allQueuedReviews = reviewManager.getReviewsByState(reviewManager.ReviewState.QUEUED);
    console.log('- All QUEUED reviews (before filtering):', allQueuedReviews.length);
    allQueuedReviews.forEach(review => {
        console.log(`  - ${review.reviewId} (${review.customerName}):`, {
            includeInAutoReply: review.includeInAutoReply,
            hasReply: !!review.reply,
            hasPublishBtn: !!review.publishBtn,
            publishBtnValid: review.publishBtn && document.contains(review.publishBtn),
            replyLength: review.reply ? review.reply.length : 0
        });
    });
    
    // Check processed reviews state
    const processedReviews = reviewManager.getReviewsByState(reviewManager.ReviewState.PROCESSED);
    console.log('- Processed reviews (not queued):', processedReviews.length);
    processedReviews.forEach(review => {
        console.log(`  - ${review.reviewId} (${review.customerName}): ${review.reply ? 'has reply' : 'no reply'}`);
    });
};

// Debug function to check processing results and auto-reply decisions
window.autoZomatoDebugProcessing = function() {
    const reviewManager = window.AutoZomatoReviewManager;
    const allReviews = reviewManager.getAllReviews();
    const config = window.autoZomatoConfig || {};
    
    console.log(`[AutoZomato] === PROCESSING DEBUG ANALYSIS ===`);
    console.log(`[AutoZomato] Config auto-reply enabled: ${config.autoReply}`);
    console.log(`[AutoZomato] Total reviews: ${allReviews.length}`);
    
    const failedReviews = allReviews.filter(r => r.state === reviewManager.ReviewState.FAILED);
    const processedReviews = allReviews.filter(r => r.state === reviewManager.ReviewState.PROCESSED);
    const queuedReviews = allReviews.filter(r => r.state === reviewManager.ReviewState.QUEUED);
    
    console.log(`[AutoZomato] FAILED reviews: ${failedReviews.length}`);
    console.log(`[AutoZomato] PROCESSED reviews: ${processedReviews.length}`);
    console.log(`[AutoZomato] QUEUED reviews: ${queuedReviews.length}`);
    
    // Check each review's processing result
    allReviews.forEach(review => {
        console.log(`[AutoZomato] Review ${review.reviewId}:`);
        console.log(`  - State: ${review.state}`);
        console.log(`  - Has Reply: ${!!review.reply} (${review.reply ? review.reply.length : 0} chars)`);
        console.log(`  - Include in Auto-Reply: ${review.includeInAutoReply}`);
        console.log(`  - Has Publish Button: ${!!review.publishBtn}`);
        console.log(`  - Publish Button Valid: ${review.publishBtn && document.contains(review.publishBtn)}`);
        console.log(`  - Error: ${review.error || 'none'}`);
        console.log(`  - Customer: ${review.customerName}`);
        console.log(`  - Sentiment: ${review.sentiment || 'none'}`);
        console.log(`  - First Name: ${review.extractedName || 'none'}`);
        
        if (review.state === reviewManager.ReviewState.PROCESSED && !review.includeInAutoReply) {
            console.log(`  - ❌ NOT QUEUED because:`);
            if (!config.autoReply) console.log(`    - Auto-reply disabled in config`);
            if (!review.reply) console.log(`    - No reply generated`);
            if (!review.publishBtn) console.log(`    - No publish button found`);
            if (review.publishBtn && !document.contains(review.publishBtn)) console.log(`    - Publish button invalid/removed`);
        }
        
        console.log(`  ---`);
    });
    
    return {
        config: config,
        failed: failedReviews.length,
        processed: processedReviews.length,
        queued: queuedReviews.length,
        autoReplyQueue: reviewManager.getAutoReplyQueue().length
    };
};

// Enhanced debug function to check all review states and auto-reply eligibility
window.autoZomatoDebugReviews = function() {
    const reviewManager = window.AutoZomatoReviewManager;
    const allReviews = reviewManager.getAllReviews();
    
    console.log(`[AutoZomato] === DETAILED REVIEW DEBUG ANALYSIS ===`);
    console.log(`[AutoZomato] Total reviews in system: ${allReviews.length}`);
    
    let queuedCount = 0;
    let processedCount = 0;
    let eligibleCount = 0;
    let eligibleIssues = [];
    
    allReviews.forEach(review => {
        const state = review.state;
        const hasReply = !!review.reply;
        const includeInAutoReply = review.includeInAutoReply;
        const publishBtnExists = !!(review.publishBtn && document.contains(review.publishBtn));
        
        console.log(`[AutoZomato] Review ${review.reviewId} (${review.customerName || 'Unknown'}):`);
        console.log(`  - State: ${state}`);
        console.log(`  - Has Reply: ${hasReply} (${hasReply ? review.reply.length : 0} chars)`);
        console.log(`  - Include in Auto-Reply: ${includeInAutoReply}`);
        console.log(`  - Publish Button Valid: ${publishBtnExists}`);
        console.log(`  - Customer Name: ${review.customerName || 'N/A'}`);
        console.log(`  - Review Text: ${review.reviewText ? review.reviewText.substring(0, 50) + '...' : 'N/A'}`);
        console.log(`  - Reply: ${review.reply ? review.reply.substring(0, 50) + '...' : 'N/A'}`);
        
        if (state === reviewManager.ReviewState.QUEUED) {
            queuedCount++;
            
            // Check if this would be eligible for auto-reply
            if (includeInAutoReply && hasReply && publishBtnExists) {
                eligibleCount++;
                console.log(`  - ✅ ELIGIBLE for auto-reply`);
            } else {
                console.log(`  - ❌ NOT ELIGIBLE for auto-reply because:`);
                if (!includeInAutoReply) {
                    console.log(`    - includeInAutoReply is false`);
                    eligibleIssues.push('includeInAutoReply=false');
                }
                if (!hasReply) {
                    console.log(`    - No reply generated`);
                    eligibleIssues.push('no reply');
                }
                if (!publishBtnExists) {
                    console.log(`    - Publish button not found or invalid`);
                    eligibleIssues.push('no publish button');
                }
            }
        } else if (state === reviewManager.ReviewState.PROCESSED) {
            processedCount++;
            console.log(`  - PROCESSED (not queued for auto-reply)`);
        }
        
        console.log(`  ---`);
    });
    
    console.log(`[AutoZomato] === SUMMARY ===`);
    console.log(`[AutoZomato] QUEUED reviews: ${queuedCount}`);
    console.log(`[AutoZomato] PROCESSED reviews: ${processedCount}`);
    console.log(`[AutoZomato] Eligible for auto-reply: ${eligibleCount}`);
    console.log(`[AutoZomato] Auto-reply queue size: ${reviewManager.getAutoReplyQueue().length}`);
    console.log(`[AutoZomato] Common issues preventing auto-reply:`, [...new Set(eligibleIssues)]);
    
    return {
        total: allReviews.length,
        queued: queuedCount,
        processed: processedCount,
        eligible: eligibleCount,
        autoReplyQueue: reviewManager.getAutoReplyQueue().length,
        issues: [...new Set(eligibleIssues)]
    };
};

// Debug function to manually start auto-reply processor
window.autoZomatoStartAutoReply = function() {
    console.log('[AutoZomato] Manually starting auto-reply processor');
    const reviewManager = window.AutoZomatoReviewManager;
    
    if (reviewManager.processingState.autoReplyRunning) {
        console.log('- Processor already running');
        return;
    }
    
    const queuedReviews = reviewManager.getAutoReplyQueue();
    if (queuedReviews.length === 0) {
        console.log('- Queue is empty, nothing to process');
        return;
    }
    
    console.log('- Starting processor with queue length:', queuedReviews.length);
    startAutoReplyProcessor();
};

// Debug function to check current state
window.autoZomatoDebugState = function() {
    const reviewManager = window.AutoZomatoReviewManager;
    
    console.log('[AutoZomato] Debug State:');
    console.log('- ReviewManager stats:', reviewManager.getStats());
    console.log('- Legacy processedReviewsLog.length:', processedReviewsLog.length);
    console.log('- Processing state:', reviewManager.processingState);
    console.log('- window.location.href:', window.location.href);
    console.log('- indicator element:', document.getElementById('autozomato-indicator'));
    console.log('- popup element:', document.getElementById('autozomato-log-popup'));
    console.log('- autoZomatoJobId:', window.autoZomatoJobId);
    console.log('- autoZomatoSentJobs:', window.autoZomatoSentJobs);
    
    // Show all reviews with their states
    console.log('\n[AutoZomato] All Reviews from ReviewManager:');
    const allReviews = Array.from(reviewManager.reviews.values());
    allReviews.forEach((review, index) => {
        console.log(`  Review ${index + 1} (${review.reviewId}):`, {
            state: review.state,
            customerName: review.customerName,
            hasReply: !!review.reply,
            includeInAutoReply: review.includeInAutoReply,
            hasPublishBtn: !!review.publishBtn,
            publishBtnValid: review.publishBtn && document.contains(review.publishBtn)
        });
    });
    
    console.log('\n[AutoZomato] Auto-Reply Queue:', reviewManager.getAutoReplyQueue().map(r => r.reviewId));
    
    // Check for queue issues
    const queuedReviews = reviewManager.getReviewsByState(reviewManager.ReviewState.QUEUED);
    const validQueueItems = reviewManager.getAutoReplyQueue();
    
    console.log('\n[AutoZomato] Queue Analysis:');
    console.log(`- Total QUEUED reviews: ${queuedReviews.length}`);
    console.log(`- Valid queue items: ${validQueueItems.length}`);
    
    if (queuedReviews.length > validQueueItems.length) {
        console.log('\n[AutoZomato] ⚠️ Queue Issues Found:');
        queuedReviews.forEach(review => {
            const issues = [];
            if (!review.includeInAutoReply) issues.push('includeInAutoReply=false');
            if (!review.reply) issues.push('no reply');
            if (!review.publishBtn) issues.push('no publishBtn');
            if (review.publishBtn && !document.contains(review.publishBtn)) issues.push('stale publishBtn');
            
            if (issues.length > 0) {
                console.log(`  - Review ${review.reviewId}: ${issues.join(', ')}`);
            }
        });
    }
    
    // Legacy compatibility check
    console.log('\n[AutoZomato] Legacy Compatibility Check:');
    console.log('- processedReviewsLog entries:', processedReviewsLog.map(log => ({
        reviewId: log.reviewId,
        replied: log.replied,
        includeInAutoReply: log.includeInAutoReply
    })));
};

// Function to scrape restaurant name from the page
function scrapeRestaurantName() {
    try {
        // Try the primary selector: #res-main-name .header
        let nameElement = document.querySelector('#res-main-name');
        
        if (nameElement && nameElement.textContent.trim()) {
            const restaurantName = nameElement.textContent.trim();
            console.log('[AutoZomato] Restaurant name found:', restaurantName);
            return restaurantName;
        }
        
        // Fallback selectors in case the structure is different
        const fallbackSelectors = [
            '#res-main-name h1',
            '.res-main-name .header',
            '.restaurant-name',
            'h1[data-testid="restaurant-name"]',
            '.res-info h1'
        ];
        
        for (const selector of fallbackSelectors) {
            nameElement = document.querySelector(selector);
            if (nameElement && nameElement.textContent.trim()) {
                const restaurantName = nameElement.textContent.trim();
                console.log('[AutoZomato] Restaurant name found with fallback selector:', selector, ':', restaurantName);
                return restaurantName;
            }
        }
        
        console.warn('[AutoZomato] Could not find restaurant name on page');
        return 'Restaurant';
    } catch (error) {
        console.error('[AutoZomato] Error scraping restaurant name:', error);
        return 'Restaurant';
    }
}

// Listen for initialization message from background script
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'startProcessing') {
        console.log('[AutoZomato] Received startProcessing message with config:', message.config);
        
        // Set job ID if provided
        if (message.jobId) {
            window.autoZomatoJobId = message.jobId;
            console.log('[AutoZomato] Job ID set to:', message.jobId);
        } else {
            // Generate a unique job ID if not provided
            window.autoZomatoJobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            console.log('[AutoZomato] Generated job ID:', window.autoZomatoJobId);
        }
        
        // Set config from message if not already set
        if (!window.autoZomatoConfig && message.config) {
            window.autoZomatoConfig = message.config;
            console.log('[AutoZomato] Config set from message:', window.autoZomatoConfig);
        }
        
        // Clear any previous session data
        processedReviewsLog = [];
        
        // Clear sent jobs set for new processing session
        if (typeof window.autoZomatoSentJobs !== 'undefined') {
            window.autoZomatoSentJobs.clear();
            console.log('[AutoZomato] Cleared sent jobs set for new processing session');
        }
        
        // Close any existing log popup
        const existingPopup = document.getElementById('autozomato-log-popup');
        if (existingPopup) {
            existingPopup.remove();
            console.log('[AutoZomato] Cleared popup for new processing session');
        }
        
        const promptContext = message.promptContext || {};
        startProcessing(promptContext);
        sendResponse({ success: true });
    } else if (message.action === 'updateConfiguration') {
        console.log('[AutoZomato] Received configuration update:', message.config);
        
        // Update the global configuration
        window.autoZomatoConfig = message.config;
        
        // Log the complete processing mode configuration for debugging
        console.log('[AutoZomato] Processing Mode Configuration Update:', {
            processingMode: message.config?.processingMode,
            gptMode: {
                enabled: message.config?.gptMode?.enabled,
                hasApiKey: !!message.config?.gptMode?.apiKey,
                apiKeyLength: message.config?.gptMode?.apiKey?.length || 0,
                model: message.config?.gptMode?.model
            },
            ollamaMode: {
                enabled: message.config?.ollamaMode?.enabled,
                url: message.config?.ollamaMode?.url,
                model: message.config?.ollamaMode?.model
            },
            offlineMode: {
                enabled: message.config?.offlineMode?.enabled
            }
        });
        
        sendResponse({ success: true });
    }
});

async function startProcessing(promptContext) {
    try {
        console.log('[AutoZomato] Starting review processing on:', window.location.href);
        console.log('[AutoZomato] Received config:', window.autoZomatoConfig);
        
        // DEBUG: Show complete configuration for troubleshooting
        if (window.autoZomatoConfig) {
            console.log('[AutoZomato] COMPLETE CONFIG DEBUG:', {
                processingMode: window.autoZomatoConfig.processingMode,
                gptMode: {
                    enabled: window.autoZomatoConfig.gptMode?.enabled,
                    hasApiKey: !!window.autoZomatoConfig.gptMode?.apiKey,
                    apiKeyLength: window.autoZomatoConfig.gptMode?.apiKey?.length || 0,
                    model: window.autoZomatoConfig.gptMode?.model
                },
                ollamaMode: {
                    enabled: window.autoZomatoConfig.ollamaMode?.enabled,
                    url: window.autoZomatoConfig.ollamaMode?.url,
                    model: window.autoZomatoConfig.ollamaMode?.model
                },
                offlineMode: {
                    enabled: window.autoZomatoConfig.offlineMode?.enabled
                }
            });
        }
        
        // Ensure config exists
        if (!window.autoZomatoConfig) {
            console.warn('[AutoZomato] No config found, using defaults');
            window.autoZomatoConfig = {
                autoReply: false,
                autoClose: false,
                promptContext: {}
            };
        }

        // Initialize ReviewManager for new session
        const reviewManager = window.AutoZomatoReviewManager;
        const newUrl = window.location.href;
        
        // Check if this is a new URL/page
        if (reviewManager.processingState.currentSessionUrl !== newUrl) {
            console.log(`[AutoZomato] New page detected. Previous: ${reviewManager.processingState.currentSessionUrl}, Current: ${newUrl}`);
            reviewManager.clearSession();
            reviewManager.processingState.currentSessionUrl = newUrl;
            
            // Clear legacy data for compatibility
            processedReviewsLog = [];
            currentSessionUrl = newUrl;
            currentRestaurantName = '';
            
            // Clear ReviewManager state
            reviewManager.clearSession();
            
            // Close any existing log popup from previous session
            const existingPopup = document.getElementById('autozomato-log-popup');
            if (existingPopup) {
                existingPopup.remove();
                console.log('[AutoZomato] Closed previous session log popup');
            }
        } else {
            // Same page, but still clear data for fresh start
            reviewManager.clearSession();
            
            // Clear legacy data for compatibility
            processedReviewsLog = [];
            
            console.log('[AutoZomato] Cleared previous session data for fresh start');

            // Close any existing log popup
            const existingPopup = document.getElementById('autozomato-log-popup');
            if (existingPopup) {
                existingPopup.remove();
                console.log('[AutoZomato] Closed existing log popup for fresh start');
            }
        }

        // Set processing configuration
        reviewManager.processingState.autoReplyEnabled = window.autoZomatoConfig?.autoReply || false;
        reviewManager.processingState.autoReplyWaitTime = (window.autoZomatoConfig?.replyWaitTime || 3) * 1000;

        // Wait for page to fully load
        if (document.readyState !== 'complete') {
            console.log('[AutoZomato] Waiting for page to load...');
            await new Promise(function(resolve) {
                window.addEventListener('load', resolve, { once: true });
            });
            console.log('[AutoZomato] Page loaded.');
        }

        // Scrape restaurant name from the page
        console.log('[AutoZomato] Scraping restaurant name...');
        const restaurantName = scrapeRestaurantName();
        reviewManager.processingState.currentRestaurantName = restaurantName;
        currentRestaurantName = restaurantName; // Legacy compatibility
        console.log('[AutoZomato] Current restaurant name:', restaurantName);

        // Send restaurant name to background script for dashboard updates
        console.log('[AutoZomato] Sending restaurant name to background:', restaurantName);
        chrome.runtime.sendMessage({
            action: 'updateRestaurantName',
            restaurantName: restaurantName,
            url: window.location.href
        });

        // Send initial processing started message
        console.log('[AutoZomato] Sending processing started message to background');
        chrome.runtime.sendMessage({
            action: 'updateTabProgress',
            url: window.location.href,
            restaurantName: restaurantName,
            progress: { current: 0, total: 0 },
            status: 'starting'
        });

        // Click Unanswered tab and get counts
        console.log('[AutoZomato] About to click Unanswered tab and extract counts...');
        const counts = await clickUnansweredTabAndExtractCounts();
        const unansweredCount = counts.unansweredReviews;
        reviewManager.processingState.totalReviews = unansweredCount;
        
        console.log(`[AutoZomato] Final unanswered reviews count: ${unansweredCount}`);
        console.log(`[AutoZomato] Final total reviews count: ${counts.totalReviews}`);

        // Send initial progress to background script
        chrome.runtime.sendMessage({
            action: 'updateTabProgress',
            url: window.location.href,
            restaurantName: restaurantName,
            progress: { current: 0, total: unansweredCount },
            status: 'loading'
        });

        // PHASE 1: LOAD ALL REVIEWS FIRST
        console.log('[AutoZomato] 🚀 PHASE 1: Loading all reviews...');
        createOrUpdateIndicator(`📥 ${restaurantName} | Loading all reviews...`);
        
        // Load all reviews first
        await loadAllReviews();
        
        // Scrape all loaded reviews
        const allReviews = await scrapeReviews();
        console.log(`[AutoZomato] ✅ Loaded and scraped ${allReviews.length} reviews`);
        
        // Send progress update after loading
        chrome.runtime.sendMessage({
            action: 'updateTabProgress',
            url: window.location.href,
            restaurantName: restaurantName,
            progress: { current: 0, total: allReviews.length },
            status: 'processing'
        });

        // PHASE 2: PROCESS ALL REVIEWS
        console.log('[AutoZomato] 🚀 PHASE 2: Processing all reviews...');
        createOrUpdateIndicator(`🤖 ${restaurantName} | Processing ${allReviews.length} reviews...`);
        
        let repliesGenerated = 0;
        const onReplySuccess = () => {
            // Only count replies that are actually processed, not just analyzed
            const processedReviews = reviewManager.getReviewsByState(reviewManager.ReviewState.PROCESSED);
            const queuedReviews = reviewManager.getReviewsByState(reviewManager.ReviewState.QUEUED);
            const publishedReviews = reviewManager.getReviewsByState(reviewManager.ReviewState.PUBLISHED);
            
            repliesGenerated = processedReviews.length + queuedReviews.length + publishedReviews.length;
            reviewManager.processingState.processedCount = repliesGenerated;
            createOrUpdateIndicator(`🤖 ${restaurantName} | ${repliesGenerated} / ${allReviews.length} Processed`);
            
            // Send progress update to background script
            console.log(`[AutoZomato] Sending progress update: ${repliesGenerated}/${allReviews.length} for ${restaurantName}`);
            chrome.runtime.sendMessage({
                action: 'updateTabProgress',
                url: window.location.href,
                restaurantName: restaurantName,
                progress: { current: repliesGenerated, total: allReviews.length },
                status: 'processing'
            });
        };

        // Process all reviews
        await replyToReviews(allReviews, promptContext, onReplySuccess);

        // PHASE 3: HANDLE AUTO-REPLY OR LOGGING
        console.log('[AutoZomato] 🚀 PHASE 3: Handling auto-reply or logging...');
        
        if (reviewManager.processingState.autoReplyEnabled) {
            // Auto-reply is enabled - start the processor with interval
            console.log('[AutoZomato] Auto-reply enabled, starting processor with interval...');
            createOrUpdateIndicator(`📤 ${restaurantName} | Publishing replies...`);

            // Send progress update to background with status 'publishing'
            chrome.runtime.sendMessage({
                action: 'updateTabProgress',
                url: window.location.href,
                restaurantName: restaurantName,
                progress: { current: repliesGenerated, total: allReviews.length },
                status: 'publishing'
            });

            // Start auto-reply processor
            await startAutoReplyProcessor();

            // Update indicator on completion
            const finalStats = reviewManager.getStats();
            const publishedReviews = finalStats.published;
            createOrUpdateIndicator(`✅ ${restaurantName} | ${publishedReviews} Published`, '#48bb78');
        } else {
            // Auto-reply is disabled - just log the processed reviews
            console.log('[AutoZomato] Auto-reply disabled, logging processed reviews...');
            createOrUpdateIndicator(`📋 ${restaurantName} | Logging reviews...`);
            
            // Add all processed reviews to log
            const processedReviews = reviewManager.getReviewsByState(reviewManager.ReviewState.PROCESSED);
            const queuedReviews = reviewManager.getReviewsByState(reviewManager.ReviewState.QUEUED);
            
            [...processedReviews, ...queuedReviews].forEach(review => {
                processedReviewsLog.push({
                    reviewId: review.reviewId,
                    customerName: review.customerName,
                    extractedName: review.extractedName,
                    rating: review.rating,
                    reviewText: review.reviewText,
                    reply: review.reply,
                    sentiment: review.sentiment,
                    restaurantName: reviewManager.processingState.currentRestaurantName,
                    replied: false, // Not published since auto-reply is off
                    timestamp: new Date().toISOString()
                });
            });
            
            // Show log popup
            if (document.getElementById('autozomato-log-popup')) {
                renderLogPopupContent().catch(console.error);
            }
            
            // Update indicator
            const totalProcessed = processedReviews.length + queuedReviews.length;
            createOrUpdateIndicator(`✅ ${restaurantName} | ${totalProcessed} Processed (Log Only)`, '#48bb78');
        }

        // Only send 'completed' status if auto-reply is disabled
        if (!reviewManager.processingState.autoReplyEnabled) {
            const finalStats = reviewManager.getStats();
            const finalProcessedCount = finalStats.processed + finalStats.queued + finalStats.published;
            chrome.runtime.sendMessage({
                action: 'updateTabProgress',
                url: window.location.href,
                restaurantName: restaurantName,
                progress: { current: finalProcessedCount, total: allReviews.length },
                status: 'completed'
            });
        }

        console.log('[AutoZomato] Processing completed. Review generation summary:', {
            totalProcessed: reviewManager.reviews.size,
            readyForReply: reviewManager.getAutoReplyQueue().length,
            autoReplyEnabled: reviewManager.processingState.autoReplyEnabled,
            stats: reviewManager.getStats()
        });

        // Handle auto-reply processing
        const queuedReviews = reviewManager.getAutoReplyQueue();
        const allQueuedReviews = reviewManager.getReviewsByState(reviewManager.ReviewState.QUEUED);
        
        console.log('[AutoZomato] Auto-reply queue analysis:', {
            autoReplyEnabled: reviewManager.processingState.autoReplyEnabled,
            totalQueuedReviews: allQueuedReviews.length,
            validQueueItems: queuedReviews.length,
            queuedReviewIds: allQueuedReviews.map(r => r.reviewId),
            validQueueIds: queuedReviews.map(r => r.reviewId),
            queuedReviewStates: allQueuedReviews.map(r => ({
                reviewId: r.reviewId,
                includeInAutoReply: r.includeInAutoReply,
                hasReply: !!r.reply,
                hasPublishBtn: !!r.publishBtn,
                publishBtnValid: r.publishBtn && document.contains(r.publishBtn)
            }))
        });
        
        if (reviewManager.processingState.autoReplyEnabled) {
            if (queuedReviews.length > 0) {
                console.log('[AutoZomato] Auto-reply is enabled and queue has items. Starting auto-reply processor.');
                console.log('[AutoZomato] Queue items to process:', queuedReviews.map(item => item.reviewId));
                // Show publishing indicator before starting
                createOrUpdateIndicator(`📤 ${restaurantName} | Publishing replies...`);
                // Start the auto-reply processor with error handling
                try {
                    await startAutoReplyProcessor();
                } catch (error) {
                    console.error('[AutoZomato] Error in auto-reply processor:', error);
                    // Still send completion signal even if auto-reply fails
                    sendProcessingCompletionSignal();
                }
                // After publishing is done, show only published count
                const publishedReviews = reviewManager.getReviewsByState(reviewManager.ReviewState.PUBLISHED).length;
                createOrUpdateIndicator(`✅ ${restaurantName} | ${publishedReviews} Published`, '#48bb78');
            } else {
                console.log('[AutoZomato] Auto-reply is enabled but queue is empty. Checking for issues...');
                if (allQueuedReviews.length > 0) {
                    console.warn('[AutoZomato] ⚠️ Found QUEUED reviews but none are valid for auto-reply. Possible issues:');
                    allQueuedReviews.forEach(review => {
                        const issues = [];
                        if (!review.includeInAutoReply) issues.push('includeInAutoReply=false');
                        if (!review.reply) issues.push('no reply');
                        if (!review.publishBtn) issues.push('no publishBtn');
                        if (review.publishBtn && !document.contains(review.publishBtn)) issues.push('stale publishBtn');
                        console.warn(`[AutoZomato] Review ${review.reviewId} issues: ${issues.join(', ')}`);
                    });
                }
                console.log('[AutoZomato] Sending completion signal immediately.');
                sendProcessingCompletionSignal();
                // Show completed indicator with published count (should be 0)
                const publishedReviews = reviewManager.getReviewsByState(reviewManager.ReviewState.PUBLISHED).length;
                createOrUpdateIndicator(`✅ ${restaurantName} | ${publishedReviews} Published`, '#48bb78');
            }
        } else {
            console.log('[AutoZomato] Auto-reply is disabled. Sending completion signal immediately.');
            sendProcessingCompletionSignal();
            // Show completed indicator with processed count (log only)
            const processedReviews = reviewManager.getReviewsByState(reviewManager.ReviewState.PROCESSED).length;
            createOrUpdateIndicator(`✅ ${restaurantName} | ${processedReviews} Processed (Log Only)`, '#48bb78');
        }
        // Remove any earlier 'Completed' indicator updates that use processed + queued.
    } catch (error) {
        handleProcessingError(error);
    }
}

// Function to send processing completion signal
function sendProcessingCompletionSignal(force = false) {
    console.log('[AutoZomato] sendProcessingCompletionSignal called');
    const reviewManager = window.AutoZomatoReviewManager;
    const jobId = window.autoZomatoJobId;
    console.log('[AutoZomato] Current job ID:', jobId);
    console.log('[AutoZomato] Sent jobs set:', window.autoZomatoSentJobs);
    if (!jobId) {
        console.error('[AutoZomato] No job ID found! This will prevent proper job completion.');
        return;
    }
    if (!force && window.autoZomatoSentJobs.has(jobId)) {
        console.warn(`[AutoZomato] Completion message for job ${jobId} already sent. Skipping.`);
        return;
    }
    window.autoZomatoSentJobs.add(jobId);
    console.log('[AutoZomato] Added job ID to sent jobs set:', jobId);

    // Get all reviews from ReviewManager
    const allReviews = Array.from(reviewManager.reviews.values());
    const results = allReviews.map(review => ({
        url: window.location.href,
        reviewId: review.reviewId,
        reviewText: review.reviewText,
        reply: review.reply || '',
        success: review.state === reviewManager.ReviewState.PUBLISHED
    }));

    // Get statistics from ReviewManager
    const stats = reviewManager.getStats();
    console.log('[AutoZomato] Final ReviewManager statistics:', stats);

    // DEBUG: Log the final state of all reviews
    console.log('[AutoZomato] Final review states for completion signal:', allReviews.map(review => ({
        reviewId: review.reviewId,
        customerName: review.customerName,
        state: review.state,
        hasReply: !!review.reply,
        published: review.state === reviewManager.ReviewState.PUBLISHED
    })));

    // Send results back to background script
    console.log('[AutoZomato] Sending completion signal to background:', {
        results: results.length,
        published: results.filter(r => r.success).length,
        stats: stats
    });
    
    chrome.runtime.sendMessage({
        action: 'tabCompleted',
        data: {
            results: results,
            reviewCount: allReviews.length,
            repliesCount: results.filter(r => r.success).length,
            totalReviews: undefined,
            detailedReviewLog: reviewManager.exportLegacyFormat(), // Export in legacy format
            restaurantName: reviewManager.processingState.currentRestaurantName,
            stats: stats // Include comprehensive statistics
        },
        jobId: jobId
    });
}

// Function to handle processing errors
function handleProcessingError(error) {
    const jobId = window.autoZomatoJobId;
    if (!jobId || window.autoZomatoSentJobs.has(jobId)) {
        console.warn(`[AutoZomato] Error for job ${jobId} already sent or job ID is missing. Skipping duplicate error.`);
        return;
    }
    window.autoZomatoSentJobs.add(jobId);

    console.error('[AutoZomato] Error during processing:', error);
    showAutoZomatoError(error);
    chrome.runtime.sendMessage({
        action: 'tabError',
        error: error && error.stack ? error.stack : (error && error.message ? error.message : String(error)),
        jobId: jobId
    });
}

function showAutoZomatoError(error) {
    var existing = document.getElementById('autozomato-error-indicator');
    if (existing) return;
    var indicator = document.createElement('div');
    indicator.id = 'autozomato-error-indicator';
    indicator.innerHTML = '❌ AutoZomato Error: ' + (error && error.message ? error.message : String(error));
    indicator.style.cssText = `
        position: fixed;
        top: 40px;
        right: 10px;
        background: #e53e3e;
        color: white;
        padding: 8px 14px;
        border-radius: 5px;
        font-size: 13px;
        z-index: 10001;
        font-family: Arial, sans-serif;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        max-width: 350px;
        word-break: break-all;
    `;
    document.body.appendChild(indicator);
}

async function clickUnansweredTabAndExtractCounts() {
    console.log('[AutoZomato] Starting clickUnansweredTabAndExtractCounts...');
    
    // Find the #li_unanswered element
    const unansweredTab = document.getElementById('li_unanswered');
    console.log('[AutoZomato] Looking for #li_unanswered tab...');
    console.log('[AutoZomato] Unanswered tab element:', unansweredTab);
    
    if (unansweredTab) {
        console.log('[AutoZomato] Found #li_unanswered tab');
        console.log('[AutoZomato] Tab classes:', unansweredTab.className);
        console.log('[AutoZomato] Tab text content:', unansweredTab.textContent?.trim());
        
        // Check if the tab is visible
        const isVisible = unansweredTab.offsetParent !== null;
        console.log('[AutoZomato] Tab visible:', isVisible);
        
        if (isVisible) {
            console.log('[AutoZomato] Clicking #li_unanswered tab...');
            
            // Try multiple click approaches to ensure the tab switches
            let tabActivated = false;
            
            // Method 1: Click the tab itself
            console.log('[AutoZomato] Method 1: Clicking tab element directly');
            unansweredTab.click();
            
            // Wait a moment and check
            await new Promise(resolve => setTimeout(resolve, 1000));
            let isActive = unansweredTab.classList.contains('active') || 
                          unansweredTab.classList.contains('selected') || 
                          unansweredTab.getAttribute('aria-selected') === 'true';
            
            if (isActive) {
                tabActivated = true;
                console.log('[AutoZomato] ✅ Tab activated with direct click');
            } else {
                console.log('[AutoZomato] ⚠️ Direct click did not activate tab, trying nested elements...');
                
                // Method 2: Click any anchor or button inside the tab
                const clickableChild = unansweredTab.querySelector('a, button, span[role="button"]');
                if (clickableChild) {
                    console.log('[AutoZomato] Method 2: Clicking nested element:', clickableChild.tagName);
                    clickableChild.click();
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    isActive = unansweredTab.classList.contains('active') || 
                              unansweredTab.classList.contains('selected') || 
                              unansweredTab.getAttribute('aria-selected') === 'true';
                    
                    if (isActive) {
                        tabActivated = true;
                        console.log('[AutoZomato] ✅ Tab activated with nested element click');
                    }
                }
                
                // Method 3: Dispatch mouse events with bubbling
                if (!tabActivated) {
                    console.log('[AutoZomato] Method 3: Dispatching mouse events');
                    const mouseEvents = ['mousedown', 'mouseup', 'click'];
                    
                    for (const eventType of mouseEvents) {
                        const event = new MouseEvent(eventType, {
                            bubbles: true,
                            cancelable: true,
                            view: window
                        });
                        unansweredTab.dispatchEvent(event);
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    isActive = unansweredTab.classList.contains('active') || 
                              unansweredTab.classList.contains('selected') || 
                              unansweredTab.getAttribute('aria-selected') === 'true';
                    
                    if (isActive) {
                        tabActivated = true;
                        console.log('[AutoZomato] ✅ Tab activated with mouse events');
                    }
                }
                
                // Method 4: Try clicking parent or nearby elements
                if (!tabActivated) {
                    console.log('[AutoZomato] Method 4: Trying parent/sibling elements');
                    const parent = unansweredTab.parentElement;
                    if (parent) {
                        parent.click();
                        
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        isActive = unansweredTab.classList.contains('active') || 
                                  unansweredTab.classList.contains('selected') || 
                                  unansweredTab.getAttribute('aria-selected') === 'true';
                        
                        if (isActive) {
                            tabActivated = true;
                            console.log('[AutoZomato] ✅ Tab activated with parent click');
                        }
                    }
                }
            }
            
            // Final wait for content to load after successful activation
            if (tabActivated) {
                console.log('[AutoZomato] Tab successfully activated, waiting for content to load...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                console.log('[AutoZomato] ✅ Content loading wait completed');
            } else {
                console.warn('[AutoZomato] ❌ Failed to activate tab with all methods');
                // Still wait a bit in case the click had some effect
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } else {
            console.warn('[AutoZomato] ⚠️ #li_unanswered tab found but not visible');
        }
    } else {
        console.warn('[AutoZomato] ❌ #li_unanswered tab not found on page');
        
        // Debug: List all li elements with IDs for troubleshooting
        const allLiElements = document.querySelectorAll('li[id]');
        console.log('[AutoZomato] All li elements with IDs found on page:');
        Array.from(allLiElements).forEach((li, index) => {
            console.log(`  Li ${index + 1}:`, {
                id: li.id,
                className: li.className,
                textContent: li.textContent?.trim(),
                visible: li.offsetParent !== null
            });
        });
    }
    
    // Extract counts from overview
    console.log('[AutoZomato] Extracting review counts...');
    let totalReviews = null;
    let unansweredReviews = null;
    
    const totalNode = document.querySelector('.all-reviews-count');
    const unansweredNode = document.querySelector('.unanswered-reviews-count');
    
    console.log('[AutoZomato] Total reviews node:', totalNode);
    console.log('[AutoZomato] Unanswered reviews node:', unansweredNode);
    
    if (totalNode) {
        totalReviews = parseInt(totalNode.textContent.replace(/\D/g, ''));
        console.log('[AutoZomato] Extracted total reviews:', totalReviews, 'from text:', totalNode.textContent);
    } else {
        console.warn('[AutoZomato] Total reviews count element not found');
    }
    
    if (unansweredNode) {
        unansweredReviews = parseInt(unansweredNode.textContent.replace(/\D/g, ''));
        console.log('[AutoZomato] Extracted unanswered reviews:', unansweredReviews, 'from text:', unansweredNode.textContent);
    } else {
        console.warn('[AutoZomato] Unanswered reviews count element not found');
        
        // Look for alternative count selectors
        const alternativeCountSelectors = [
            '.unanswered-count',
            '[data-count="unanswered"]',
            '.review-count',
            '.count-unanswered'
        ];
        
        for (const selector of alternativeCountSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                console.log(`[AutoZomato] Found alternative count with selector: ${selector}`, element.textContent);
            }
        }
    }
    
    console.log('[AutoZomato] Final overview counts:', { totalReviews, unansweredReviews });
    return { totalReviews, unansweredReviews };
}

async function loadAllReviews() {
    console.log('[AutoZomato] loadAllReviews() started - attempting to load all reviews at once');
    
    let loadMoreBtn;
    let tries = 0;
    const maxTries = 20;
    let previousReviewCount = 0;
    let consecutiveNoChange = 0;
    const maxConsecutiveNoChange = 3;
    
    while (tries < maxTries) {
        // Enhanced load more button detection
        const selectors = [
            '.load-more',
            'section.load-more',
            'section.zs-load-more', 
            'section.btn.load-more',
            '[class*="load-more"]',
            '[class*="loadmore"]',
            'button[class*="load"]',
            'a[class*="load"]'
        ];
        
        loadMoreBtn = null;
        for (const selector of selectors) {
            loadMoreBtn = document.querySelector(selector);
            if (loadMoreBtn && loadMoreBtn.offsetParent !== null) {
                console.log(`[AutoZomato] Found visible load more button with selector: ${selector}`);
                break;
            }
        }
        
        if (!loadMoreBtn || loadMoreBtn.offsetParent === null) {
            console.log(`[AutoZomato] No more load more buttons found after ${tries} clicks`);
            break;
        }
        
        console.log(`[AutoZomato] Clicking Load more button (attempt ${tries + 1}/${maxTries})...`);
        console.log(`[AutoZomato] Button details:`, {
            tagName: loadMoreBtn.tagName,
            className: loadMoreBtn.className,
            textContent: loadMoreBtn.textContent?.trim(),
            disabled: loadMoreBtn.disabled
        });
        
        // Try multiple click approaches to ensure the load more actually works
        let loadMoreWorked = false;
        const initialReviewCount = document.querySelectorAll('.res-review').length;
        
        // Method 1: Direct click on the button
        console.log('[AutoZomato] Method 1: Direct click on load more button');
        loadMoreBtn.click();
        
        // Wait and check if new reviews loaded
        await new Promise(resolve => setTimeout(resolve, 1500));
        let newReviewCount = document.querySelectorAll('.res-review').length;
        
        if (newReviewCount > initialReviewCount) {
            loadMoreWorked = true;
            console.log('[AutoZomato] ✅ Load more worked with direct click');
        } else {
            console.log('[AutoZomato] ⚠️ Direct click did not load more reviews, trying nested elements...');
            
            // Method 2: Click any nested anchor or button
            const clickableChild = loadMoreBtn.querySelector('a, button, span[role="button"]');
            if (clickableChild) {
                console.log('[AutoZomato] Method 2: Clicking nested element:', clickableChild.tagName);
                clickableChild.click();
                
                await new Promise(resolve => setTimeout(resolve, 1500));
                newReviewCount = document.querySelectorAll('.res-review').length;
                
                if (newReviewCount > initialReviewCount) {
                    loadMoreWorked = true;
                    console.log('[AutoZomato] ✅ Load more worked with nested element click');
                }
            }
            
            // Method 3: Dispatch mouse events with bubbling
            if (!loadMoreWorked) {
                console.log('[AutoZomato] Method 3: Dispatching mouse events');
                const mouseEvents = ['mousedown', 'mouseup', 'click'];
                
                for (const eventType of mouseEvents) {
                    const event = new MouseEvent(eventType, {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    });
                    loadMoreBtn.dispatchEvent(event);
                }
                
                await new Promise(resolve => setTimeout(resolve, 1500));
                newReviewCount = document.querySelectorAll('.res-review').length;
                
                if (newReviewCount > initialReviewCount) {
                    loadMoreWorked = true;
                    console.log('[AutoZomato] ✅ Load more worked with mouse events');
                }
            }
            
            // Method 4: Try clicking parent element
            if (!loadMoreWorked) {
                console.log('[AutoZomato] Method 4: Trying parent element');
                const parent = loadMoreBtn.parentElement;
                if (parent) {
                    parent.click();
                    
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    newReviewCount = document.querySelectorAll('.res-review').length;
                    
                    if (newReviewCount > initialReviewCount) {
                        loadMoreWorked = true;
                        console.log('[AutoZomato] ✅ Load more worked with parent click');
                    }
                }
            }
        }
        
        tries++;
        
        // Check if review count changed
        if (newReviewCount === previousReviewCount) {
            consecutiveNoChange++;
            console.log(`[AutoZomato] No change in review count. Consecutive no-change: ${consecutiveNoChange}/${maxConsecutiveNoChange}`);
            
            if (consecutiveNoChange >= maxConsecutiveNoChange) {
                console.log(`[AutoZomato] 🛑 Stopping load more after ${maxConsecutiveNoChange} consecutive attempts with no change`);
                break;
            }
        } else {
            consecutiveNoChange = 0; // Reset counter
            console.log(`[AutoZomato] ✅ Review count increased: ${previousReviewCount} -> ${newReviewCount} (+${newReviewCount - previousReviewCount})`);
        }
        
        previousReviewCount = newReviewCount;
        
        // Log current review count after each click
        console.log(`[AutoZomato] Review count after click ${tries}: ${newReviewCount}`);
    }
    
    if (tries > 0) {
        console.log(`[AutoZomato] ✅ All reviews loaded after ${tries} load more clicks`);
    } else {
        console.log('[AutoZomato] ⚠️ No load more buttons found - all reviews may already be loaded');
    }
    
    const finalReviewCount = document.querySelectorAll('.res-review').length;
    console.log(`[AutoZomato] Final review count after loadAllReviews(): ${finalReviewCount}`);
    
    return finalReviewCount;
}

async function loadMoreAndCheck(prevCount) {
    console.log('[AutoZomato] loadMoreAndCheck called with prevCount:', prevCount);
    
    // Enhanced load more button detection
    const selectors = [
        'section.load-more',
        'section.zs-load-more', 
        'section.btn.load-more',
        '.load-more',
        '[class*="load-more"]',
        '[class*="loadmore"]',
        'button[class*="load"]',
        'a[class*="load"]'
    ];
    
    let loadMoreBtn = null;
    let usedSelector = '';
    
    for (const selector of selectors) {
        loadMoreBtn = document.querySelector(selector);
        if (loadMoreBtn) {
            usedSelector = selector;
            console.log(`[AutoZomato] Found load more button with selector: ${selector}`);
            break;
        }
    }
    
    if (!loadMoreBtn) {
        console.log('[AutoZomato] No load more button found with any selector');
        console.log('[AutoZomato] Available buttons on page:', 
            Array.from(document.querySelectorAll('button, .btn, section')).map(el => ({
                tagName: el.tagName,
                className: el.className,
                textContent: el.textContent?.trim()?.substring(0, 50),
                visible: el.offsetParent !== null
            })).slice(0, 10) // Show first 10 for debugging
        );
    } else {
        console.log('[AutoZomato] Load more button details:', {
            selector: usedSelector,
            tagName: loadMoreBtn.tagName,
            className: loadMoreBtn.className,
            textContent: loadMoreBtn.textContent?.trim(),
            visible: loadMoreBtn.offsetParent !== null,
            disabled: loadMoreBtn.disabled,
            style: loadMoreBtn.style.cssText
        });
    }
    
    if (loadMoreBtn && loadMoreBtn.offsetParent !== null) {
        console.log('[AutoZomato] Clicking load more button...');
        
        // Try multiple click approaches to ensure the load more actually works
        let loadMoreWorked = false;
        const initialReviewCount = document.querySelectorAll('.res-review').length;
        
        // Method 1: Direct click on the button
        console.log('[AutoZomato] Method 1: Direct click on load more button');
        loadMoreBtn.click();
        
        // Wait and check if new reviews loaded
        await new Promise(resolve => setTimeout(resolve, 1500));
        let newReviewCount = document.querySelectorAll('.res-review').length;
        
        if (newReviewCount > initialReviewCount) {
            loadMoreWorked = true;
            console.log('[AutoZomato] ✅ Load more worked with direct click');
        } else {
            console.log('[AutoZomato] ⚠️ Direct click did not load more reviews, trying nested elements...');
            
            // Method 2: Click any nested anchor or button
            const clickableChild = loadMoreBtn.querySelector('a, button, span[role="button"]');
            if (clickableChild) {
                console.log('[AutoZomato] Method 2: Clicking nested element:', clickableChild.tagName);
                clickableChild.click();
                
                await new Promise(resolve => setTimeout(resolve, 1500));
                newReviewCount = document.querySelectorAll('.res-review').length;
                
                if (newReviewCount > initialReviewCount) {
                    loadMoreWorked = true;
                    console.log('[AutoZomato] ✅ Load more worked with nested element click');
                }
            }
            
            // Method 3: Dispatch mouse events with bubbling
            if (!loadMoreWorked) {
                console.log('[AutoZomato] Method 3: Dispatching mouse events');
                const mouseEvents = ['mousedown', 'mouseup', 'click'];
                
                for (const eventType of mouseEvents) {
                    const event = new MouseEvent(eventType, {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    });
                    loadMoreBtn.dispatchEvent(event);
                }
                
                await new Promise(resolve => setTimeout(resolve, 1500));
                newReviewCount = document.querySelectorAll('.res-review').length;
                
                if (newReviewCount > initialReviewCount) {
                    loadMoreWorked = true;
                    console.log('[AutoZomato] ✅ Load more worked with mouse events');
                }
            }
            
            // Method 4: Try clicking parent element
            if (!loadMoreWorked) {
                console.log('[AutoZomato] Method 4: Trying parent element');
                const parent = loadMoreBtn.parentElement;
                if (parent) {
                    parent.click();
                    
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    newReviewCount = document.querySelectorAll('.res-review').length;
                    
                    if (newReviewCount > initialReviewCount) {
                        loadMoreWorked = true;
                        console.log('[AutoZomato] ✅ Load more worked with parent click');
                    }
                }
            }
        }
        
        if (loadMoreWorked) {
            console.log(`[AutoZomato] ✅ Load more successful: ${initialReviewCount} -> ${newReviewCount} reviews`);
        } else {
            console.warn('[AutoZomato] ❌ Failed to load more reviews with all methods');
        }
    } else {
        console.log('[AutoZomato] Load more button not clickable or not visible');
    }
    
    const reviewBlocks = document.querySelectorAll('.res-review');
    const newCount = reviewBlocks.length;
    
    console.log(`[AutoZomato] Review count after load more attempt: ${prevCount} -> ${newCount} (difference: ${newCount - prevCount})`);
    
    return newCount;
}

async function scrapeReviews() {
    console.log('[AutoZomato] Scraping reviews from the page...');
    const reviews = [];
    const reviewElements = document.querySelectorAll('.res-review');
    const reviewManager = window.AutoZomatoReviewManager;
    let skippedAlreadyReplied = 0;

    reviewElements.forEach((el) => {
        try {
            const reviewId = el.dataset.review_id; // Use the data-review_id attribute

            // Extract customer name
            const customerNameElement = el.querySelector('a[itemprop="name"]');
            const customerName = customerNameElement ? customerNameElement.innerText.trim() : 'Customer';

            // Extract rating
            const ratingElement = el.querySelector('.reviews-rating-text');
            const ratingMatch = ratingElement ? ratingElement.innerText.match(/\d+(\.\d+)?/) : null;
            const rating = ratingMatch ? parseFloat(ratingMatch[0]) : 'N/A';

            // Extract review text
            const reviewTextElement = el.querySelector('.rev-text');
            const reviewText = reviewTextElement ? reviewTextElement.innerText.trim() : '';

            // Extract review date
            const reviewDateElement = el.querySelector('.rev-details time, .rev-details .time, [data-testid="review-date"], .time');
            let reviewDate = null;
            let reviewDateStr = '';
            
            if (reviewDateElement) {
                // Try to get datetime attribute first, then innerText
                reviewDateStr = reviewDateElement.getAttribute('datetime') || 
                               reviewDateElement.getAttribute('title') || 
                               reviewDateElement.innerText.trim();
                
                // Parse the date string - Zomato might use various formats
                if (reviewDateStr) {
                    try {
                        // Try parsing as ISO date first
                        reviewDate = new Date(reviewDateStr);
                        
                        // If that fails, try common formats
                        if (isNaN(reviewDate.getTime())) {
                            // Handle formats like "2 days ago", "1 week ago", etc.
                            const now = new Date();
                            if (reviewDateStr.includes('day') && reviewDateStr.includes('ago')) {
                                const days = parseInt(reviewDateStr.match(/\d+/)?.[0] || '0');
                                reviewDate = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
                            } else if (reviewDateStr.includes('week') && reviewDateStr.includes('ago')) {
                                const weeks = parseInt(reviewDateStr.match(/\d+/)?.[0] || '0');
                                reviewDate = new Date(now.getTime() - (weeks * 7 * 24 * 60 * 60 * 1000));
                            } else if (reviewDateStr.includes('month') && reviewDateStr.includes('ago')) {
                                const months = parseInt(reviewDateStr.match(/\d+/)?.[0] || '0');
                                reviewDate = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
                            } else if (reviewDateStr.includes('year') && reviewDateStr.includes('ago')) {
                                const years = parseInt(reviewDateStr.match(/\d+/)?.[0] || '0');
                                reviewDate = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
                            } else {
                                // Try direct Date parsing as fallback
                                reviewDate = new Date(reviewDateStr);
                            }
                        }
                    } catch (dateError) {
                        console.warn(`[AutoZomato] Could not parse review date: "${reviewDateStr}"`, dateError);
                        reviewDate = null;
                    }
                }
            }

            // Find the reply textarea and submit button to confirm it's a review that can be replied to
            const replyTextarea = el.querySelector('textarea');
            
            // Enhanced publish button detection with multiple selectors
            const publishButtonSelectors = [
                '.zblack',
                'button[type="submit"]',
                'button.submit',
                'button[class*="submit"]',
                'button[class*="reply"]',
                'button[class*="publish"]',
                '.btn-submit',
                '.submit-btn',
                '.reply-btn',
                '.publish-btn'
            ];
            
            let submitButton = null;
            let usedSelector = '';
            
            for (const selector of publishButtonSelectors) {
                submitButton = el.querySelector(selector);
                if (submitButton) {
                    usedSelector = selector;
                    break;
                }
            }
            
            // Enhanced debugging for publish button detection
            console.log(`[AutoZomato] Publish button detection for review ${reviewId}:`);
            console.log(`  - hasTextarea: ${!!replyTextarea}`);
            console.log(`  - hasSubmitButton: ${!!submitButton}`);
            console.log(`  - usedSelector: ${usedSelector}`);
            console.log(`  - submitButtonTagName: ${submitButton ? submitButton.tagName : 'none'}`);
            console.log(`  - submitButtonText: ${submitButton ? submitButton.textContent.trim() : 'none'}`);
            console.log(`  - submitButtonClasses: ${submitButton ? submitButton.className : 'none'}`);
            
            // If still no button found, try looking for any button within the review element
            if (!submitButton) {
                const allButtons = el.querySelectorAll('button');
                console.log(`[AutoZomato] No publish button found with known selectors. Found ${allButtons.length} buttons in review:`, 
                    Array.from(allButtons).map(btn => ({
                        tagName: btn.tagName,
                        className: btn.className,
                        textContent: btn.textContent.trim(),
                        type: btn.type
                    }))
                );
                
                // Try to find a submit-like button
                for (const btn of allButtons) {
                    const text = btn.textContent.trim().toLowerCase();
                    const classes = btn.className.toLowerCase();
                    if (text.includes('submit') || text.includes('reply') || text.includes('publish') || 
                        classes.includes('submit') || classes.includes('reply') || classes.includes('publish') ||
                        btn.type === 'submit') {
                        submitButton = btn;
                        usedSelector = 'fallback-search';
                        console.log(`[AutoZomato] Found fallback publish button:`, {
                            tagName: btn.tagName,
                            className: btn.className,
                            textContent: btn.textContent.trim(),
                            type: btn.type
                        });
                        break;
                    }
                }
            }
            
            // Check if review already has a reply (skip if it does)
            const existingReply = el.querySelector('.review-reply-text');
            if (existingReply) {
                console.log(`[AutoZomato] Skipping review ${reviewId} - already has reply`);
                skippedAlreadyReplied++;
                return; // Skip this review
            }

            if (reviewId && replyTextarea) { // Check for reviewId and a textarea to reply
                console.log(`[AutoZomato Content] Scraped review with ID: ${reviewId}, customer: ${customerName}, date: ${reviewDate ? reviewDate.toISOString().split('T')[0] : 'unknown'}`);
                
                // Add to ReviewManager
                reviewManager.addReview({
                    reviewId: reviewId,
                    customerName: customerName,
                    rating: rating,
                    reviewText: reviewText,
                    reviewDate: reviewDate,
                    reviewDateStr: reviewDateStr,
                    state: reviewManager.ReviewState.SCRAPED,
                    element: el,
                    replyTextarea: replyTextarea,
                    publishBtn: submitButton
                });
                
                // Return traditional format for compatibility
                reviews.push({
                    reviewId,
                    customerName,
                    rating,
                    reviewText,
                    reviewDate,
                    reviewDateStr,
                    element: el,
                    replyTextarea: replyTextarea,
                    submitButton: submitButton
                });
            } else {
                const skipReason = !reviewId ? 'no reviewId' : 
                                  !replyTextarea ? 'no reply textarea' : 
                                  'unknown reason';
                console.log(`[AutoZomato Content] Skipped review - ${skipReason} (reviewId: ${reviewId || 'missing'}, hasTextarea: ${!!replyTextarea})`);
            }
        } catch (error) {
            console.error(`[AutoZomato] Error scraping a review:`, error);
        }
    });

    console.log(`[AutoZomato] Found ${reviews.length} reviews to reply to.`);
    if (skippedAlreadyReplied > 0) {
        console.log(`[AutoZomato] Skipped ${skippedAlreadyReplied} reviews that already have replies.`);
    }
    console.log(`[AutoZomato] ReviewManager stats:`, reviewManager.getStats());
    return reviews;
}

async function replyToReviews(reviews, promptContext, onReplySuccess) {
    // Get configuration from global window object
    const config = window.autoZomatoConfig || {};
    const reviewManager = window.AutoZomatoReviewManager;
    
    // Load the response bank from the extension's files
    const responseBankUrl = chrome.runtime.getURL('response_bank.json');
    const response = await fetch(responseBankUrl);
    const allResponseBank = await response.json();
    
    // Get brand-specific response bank
    const brandId = window.autoZomatoBrandId || '1'; // Default to brand 1
    const responseBank = allResponseBank[brandId];
    
    if (!responseBank) {
        console.warn(`[AutoZomato] Brand ${brandId} not found in response bank, using first available brand`);
        const firstBrandId = Object.keys(allResponseBank)[0];
        const fallbackResponseBank = allResponseBank[firstBrandId];
        console.log(`[AutoZomato] Using brand ${firstBrandId} (${fallbackResponseBank?.name}) as fallback`);
        // Use fallback but still call it responseBank for compatibility
        responseBank = fallbackResponseBank;
    } else {
        console.log(`[AutoZomato] Using response bank for brand ${brandId} (${responseBank.name})`);
    }

    // Filter out reviews that have already been processed using ReviewManager
    const processedReviewIds = Array.from(reviewManager.reviews.keys());
    const unprocessedReviews = reviews.filter(review => {
        const existingReview = reviewManager.reviews.get(review.reviewId);
        return !existingReview || existingReview.state === reviewManager.ReviewState.SCRAPED;
    });
    
    if (unprocessedReviews.length !== reviews.length) {
        const totalFiltered = reviews.length - unprocessedReviews.length;
        console.log(`[AutoZomato] Filtered out ${totalFiltered} already processed reviews out of ${reviews.length} total`);
        console.log(`[AutoZomato] Processing ${unprocessedReviews.length} new reviews`);
    } else {
        console.log(`[AutoZomato] Processing ${unprocessedReviews.length} reviews (all new)`);
    }

    for (const review of unprocessedReviews) {
        try {
            console.log(`[AutoZomato] Analyzing review:`, review);

            // Update review state to PROCESSING
            reviewManager.updateReview(review.reviewId, {
                state: reviewManager.ReviewState.PROCESSING
            });

            // Route to appropriate processing function based on mode
            const processingMode = config.processingMode || 'ollama';
            let processingResult = null;
            switch (processingMode) {
                case 'gpt':
                    if (config.gptMode && config.gptMode.enabled && config.gptMode.apiKey) {
                        processingResult = await processReviewWithGPTMode(review, config, onReplySuccess);
                    } else {
                        throw new Error('GPT mode is not properly configured. Please check your API key.');
                    }
                    break;
                case 'ollama':
                    if (config.ollamaMode && config.ollamaMode.enabled) {
                        processingResult = await processReviewWithOllamaMode(review, config, promptContext, responseBank, onReplySuccess);
                    } else {
                        throw new Error('Ollama mode is not available. Please check if Ollama is running.');
                    }
                    break;
                case 'offline':
                    processingResult = await processReviewWithOfflineMode(review, config, responseBank, onReplySuccess);
                    break;
                default:
                    processingResult = await processReviewWithOllamaMode(review, config, promptContext, responseBank, onReplySuccess);
                    break;
            }

            if (processingResult) {
                // Determine if review should be queued for auto-reply or just processed
                const autoReplyEnabled = reviewManager.processingState.autoReplyEnabled;
                let shouldQueue = false;
                let finalState = reviewManager.ReviewState.PROCESSED;
                
                if (autoReplyEnabled && processingResult.reply) {
                    shouldQueue = true;
                    finalState = reviewManager.ReviewState.QUEUED;
                }
                
                reviewManager.updateReview(review.reviewId, {
                    state: finalState,
                    extractedName: processingResult.firstName || 'N/A',
                    sentiment: processingResult.sentiment || 'Unknown',
                    complaintId: processingResult.complaintId || 'None',
                    confidence: processingResult.confidence || 1.0,
                    selectedCategory: processingResult.selectedCategory || 'Default',
                    reply: processingResult.reply || '',
                    includeInAutoReply: shouldQueue
                });
                
                // Log the processed review immediately if auto-reply is disabled
                if (!autoReplyEnabled && processingResult.reply) {
                    processedReviewsLog.push({
                        reviewId: review.reviewId,
                        customerName: review.customerName,
                        extractedName: processingResult.firstName || 'N/A',
                        rating: review.rating,
                        reviewText: review.reviewText,
                        reply: processingResult.reply,
                        sentiment: processingResult.sentiment || 'Unknown',
                        restaurantName: reviewManager.processingState.currentRestaurantName,
                        replied: false, // Not published since auto-reply is off
                        timestamp: new Date().toISOString()
                    });
                }
                
                console.log(`[AutoZomato] ✅ Review ${review.reviewId} processed and ${shouldQueue ? 'QUEUED' : 'PROCESSED'} (${autoReplyEnabled ? 'auto-reply enabled' : 'log only'})`);
                onReplySuccess();
                
                // Update log popup if present and auto-reply is disabled
                if (document.getElementById('autozomato-log-popup') && !autoReplyEnabled) {
                    renderLogPopupContent().catch(console.error);
                }
            } else {
                reviewManager.updateReview(review.reviewId, {
                    state: reviewManager.ReviewState.FAILED,
                    error: 'Processing returned null result'
                });
            }
        } catch (error) {
            reviewManager.updateReview(review.reviewId, {
                state: reviewManager.ReviewState.FAILED,
                error: error.message || 'Processing failed'
            });
        }
    }
}

function cleanAndParseJSON(jsonString) {
    try {
        // First, try direct parsing
        return JSON.parse(jsonString);
    } catch (e) {
        console.log(`[AutoZomato] Attempting to clean malformed JSON...`);
        
        try {
            // Remove any text before the first {
            let cleaned = jsonString.substring(jsonString.indexOf('{'));
            
            // Remove any text after the last }
            cleaned = cleaned.substring(0, cleaned.lastIndexOf('}') + 1);
            
            // Fix common JSON issues
            cleaned = cleaned
                .replace(/'/g, '"')  // Replace single quotes with double quotes
                .replace(/,\s*}/g, '}')  // Remove trailing commas
                .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
                .replace(/(\w+):/g, '"$1":')  // Quote unquoted keys
                .replace(/:\s*([^",\[\{][^,\]\}]*)/g, ': "$1"');  // Quote unquoted values
            
            return JSON.parse(cleaned);
        } catch (e2) {
            console.warn(`[AutoZomato] JSON cleaning failed:`, e2);
            throw e2;
        }
    }
}

function fallbackAnalysis(review) {
    console.log(`[AutoZomato] Using fallback analysis for review:`, review.reviewId);
    
    const reviewText = (review.reviewText || '').toLowerCase();
    const rating = parseInt(review.rating) || 3;
    
    // Enhanced fallback sentiment analysis only
    let sentiment = 'Neutral';
    if (rating >= 4 || reviewText.includes('good') || reviewText.includes('great') || reviewText.includes('excellent') || reviewText.includes('nice') || reviewText.includes('amazing')) {
        sentiment = 'Positive';
    } else if (rating <= 2 || reviewText.includes('bad') || reviewText.includes('terrible') || reviewText.includes('worst') || reviewText.includes('poor') || reviewText.includes('disappointing')) {
        sentiment = 'Negative';
    }
    
    // NO COMPLAINT DETECTION IN FALLBACK - AI MODEL ONLY
    // This ensures complaints are only detected by the AI model for consistency
    let complaintId = null;
    
    // Fallback name analysis with smart extraction
    const customerName = review.customerName || '';
    let firstName = null;
    let confidence = 0;
    
    if (customerName.length >= 2) {
        // Try to extract a usable name/identifier
        const extracted = smartExtractFirstName(customerName);
        if (extracted) {
            firstName = extracted.name;
            confidence = extracted.confidence;
        }
    }
    
    console.log(`[AutoZomato] Fallback result (sentiment & name only):`, { sentiment, complaintId, firstName, confidence });
    
    return {
        sentiment: sentiment,
        complaintId: complaintId, // Always null in fallback
        firstName: firstName,
        confidence: confidence
    };
}

function smartExtractFirstName(fullName) {
    if (!fullName || typeof fullName !== 'string') return null;
    
    const cleanName = fullName.trim();
    if (!cleanName || cleanName.length < 2) return null;
    
    // First, check if it's already a clean real name (space-separated)
    if (cleanName.includes(' ')) {
        const firstName = cleanName.split(' ')[0].trim();
        if (firstName.length >= 2 && firstName.match(/^[A-Za-z]+$/)) {
            return {
                name: firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase(),
                confidence: 0.9 // High confidence for space-separated names
            };
        }
    }
    
    // If it's a single word, check if it's a valid standalone name
    if (!cleanName.includes(' ') && cleanName.match(/^[A-Za-z]+$/)) {
        if (cleanName.length >= 3 && cleanName.length <= 15) {
            // Check if it's not a generic word
            const lowercaseName = cleanName.toLowerCase();
            const genericWords = ['user', 'customer', 'guest', 'admin', 'test', 'temp', 'food', 'lover', 'eater', 'hungry', 'reviewer', 'fan'];
            
            if (!genericWords.includes(lowercaseName)) {
                return {
                    name: cleanName.charAt(0).toUpperCase() + cleanName.slice(1).toLowerCase(),
                    confidence: 0.6 // Medium confidence for standalone names
                };
            }
        }
    }
    
    // Try to extract name parts from usernames (like "john123" or "mary_doe")
    const parts = cleanName.split(/[\d_\-\.]+/).filter(part => part.length > 0);
    
    for (const part of parts) {
        // Check if this part looks like a real name
        if (part.length >= 3 && 
            part.length <= 15 &&
            part.match(/^[A-Za-z]+$/)) { // Pure alphabetic only
            
            const lowercasePart = part.toLowerCase();
            const genericWords = ['user', 'customer', 'guest', 'admin', 'test', 'temp', 'food', 'lover', 'eater', 'hungry', 'reviewer', 'fan'];
            
            if (!genericWords.includes(lowercasePart)) {
                return {
                    name: part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
                    confidence: 0.7 // Good confidence for extracted names
                };
            }
        }
    }
    
    return null; // No valid name found
    
    return null;
}

function getRandomNeutralGreeting() {
    const greetings = ['Hi', 'Hello', 'Hi there'];
    return greetings[Math.floor(Math.random() * greetings.length)];
}

function extractFirstName(fullName) {
    if (!fullName || typeof fullName !== 'string') return '';
    
    const cleanName = fullName.trim();
    if (!cleanName) return '';
    
    // Split by spaces and get the first part
    const firstName = cleanName.split(' ')[0];
    
    // Additional validation for robustness
    if (firstName.length < 2) return ''; // Too short
    if (firstName.match(/\d/)) return ''; // Contains numbers
    if (firstName.match(/[!@#$%^&*(),.?":{}|<>]/)) return ''; // Contains special characters
    
    return firstName;
}

function handleReplyEdit(event) {
    const editableDiv = event.target;
    const row = editableDiv.closest('tr');
    if (!row) return;
    
    const reviewId = row.getAttribute('data-review-id');
    if (!reviewId) return;
    
    // Clear any existing timeout for this element
    if (editableDiv.updateTimeout) {
        clearTimeout(editableDiv.updateTimeout);
    }
    
    // Set a new timeout to debounce the updates
    editableDiv.updateTimeout = setTimeout(() => {
        const newReply = editableDiv.textContent.trim();
        
        // Update the ReviewManager
        const reviewManager = window.AutoZomatoReviewManager;
        reviewManager.updateReview(reviewId, {
            reply: newReply
        });
        
        // Find the corresponding textarea on the page and update it
        const reviewElement = document.querySelector(`.res-review[data-review_id="${reviewId}"]`);
        if (reviewElement) {
            const textarea = reviewElement.querySelector('textarea');
            if (textarea) {
                textarea.value = newReply;
                // Trigger input event to ensure the change is registered
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                
                // Add visual feedback to show the edit was synced
                editableDiv.style.backgroundColor = '#e8f5e8';
                setTimeout(() => {
                    editableDiv.style.backgroundColor = '';
                }, 1000);
                
                console.log(`[AutoZomato] Updated textarea for review ${reviewId} with new reply`);
            } else {
                console.warn(`[AutoZomato] Could not find textarea for review ${reviewId}`);
            }
        } else {
            console.warn(`[AutoZomato] Could not find review element for review ${reviewId}`);
        }
    }, 300); // Wait 300ms after user stops typing
}

function handleIncludeCheckboxChange(event) {
    const checkbox = event.target;
    const row = checkbox.closest('tr');
    if (!row) return;
    
    const reviewId = row.getAttribute('data-review-id');
    if (!reviewId) return;
    
    // Update the ReviewManager
    const reviewManager = window.AutoZomatoReviewManager;
    reviewManager.updateReview(reviewId, {
        includeInAutoReply: checkbox.checked
    });
    console.log(`[AutoZomato] Updated includeInAutoReply for review ${reviewId} to ${checkbox.checked}`);
    
    // Update the header summary
    updateLogPopupHeader();
}

// Create complaint selector dropdown
function createComplaintSelector(currentComplaintId, reviewId) {
    const select = document.createElement('select');
    select.className = 'complaint-dropdown';
    select.style.cssText = `
        width: 100%;
        padding: 4px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 11px;
        background-color: white;
        cursor: pointer;
    `;
    
    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select complaint type...';
    select.appendChild(defaultOption);
    
    // Add complaint options
    complaintMappings.forEach((mapping, id) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = mapping.name;
        if (id === currentComplaintId) {
            option.selected = true;
        }
        select.appendChild(option);
    });
    
    // Add event listener
    select.addEventListener('change', (event) => handleComplaintChange(event, reviewId));
    
    return select;
}

// Handle complaint type change
async function handleComplaintChange(event, reviewId) {
    const newComplaintId = event.target.value;
    const reviewManager = window.AutoZomatoReviewManager;
    const review = reviewManager.reviews.get(reviewId);
    
    if (!review) {
        console.warn('[AutoZomato] No review found for ID:', reviewId);
        return;
    }
    
    console.log(`[AutoZomato] Corrected complaint changed for review ${reviewId}: ${review.correctedComplaintId || review.complaintId} -> ${newComplaintId}`);
    
    // Save original AI detection if not already saved
    if (!review.originalComplaintId) {
        reviewManager.updateReview(reviewId, {
            originalComplaintId: review.complaintId
        });
    }
    
    // Update the corrected complaint ID (this is what the user is changing)
    reviewManager.updateReview(reviewId, {
        correctedComplaintId: newComplaintId,
        correctionTimestamp: new Date().toISOString()
    });
    
    // Regenerate reply if complaint type is selected
    if (newComplaintId && complaintMappings.has(newComplaintId)) {
        try {
            const newReply = await generateReplyFromComplaint(review, newComplaintId);
            if (newReply) {
                reviewManager.updateReview(reviewId, {
                    reply: newReply
                });
                
                // Update the popup display
                const row = event.target.closest('tr');
                const replyDiv = row.querySelector('.editable-reply');
                if (replyDiv) {
                    replyDiv.textContent = newReply;
                    // Add visual feedback
                    replyDiv.style.backgroundColor = '#fff3cd';
                    setTimeout(() => {
                        replyDiv.style.backgroundColor = '';
                    }, 2000);
                }
                
                // Update the textarea on the page
                const reviewElement = document.querySelector(`.res-review[data-review_id="${reviewId}"]`);
                if (reviewElement) {
                    const textarea = reviewElement.querySelector('textarea');
                    if (textarea) {
                        textarea.value = newReply;
                        textarea.dispatchEvent(new Event('input', { bubbles: true }));
                        console.log(`[AutoZomato] Updated textarea for review ${reviewId} with new complaint-based reply`);
                    }
                }
            }
        } catch (error) {
            console.error('[AutoZomato] Error regenerating reply:', error);
        }
    }
}

// Generate reply based on complaint type
async function generateReplyFromComplaint(review, complaintId) {
    try {
        // Load response bank if not already loaded
        if (complaintMappings.size === 0) {
            await loadComplaintMappings(window.autoZomatoBrandId);
        }
        
        const mapping = complaintMappings.get(complaintId);
        if (!mapping || !mapping.responses) {
            console.warn('[AutoZomato] No mapping found for complaint ID:', complaintId);
            return null;
        }
        
        let templates = [];
        
        // Handle different response structures
        if (mapping.type === 'category') {
            // Star-based categories have Written Review vs No Written Review
            const hasWrittenReview = review.reviewText && review.reviewText.trim().length > 0;
            const responseType = hasWrittenReview ? 'Written Review' : 'No Written Review';
            templates = mapping.responses[responseType] || [];
        } else if (mapping.type === 'complaint') {
            // Complaint responses are direct arrays
            templates = mapping.responses || [];
        }
        
        if (templates.length === 0) {
            console.warn('[AutoZomato] No templates found for complaint:', complaintId);
            return null;
        }
        
        // Select random template
        const template = templates[Math.floor(Math.random() * templates.length)];
        
        // Get restaurant name from ReviewManager
        const reviewManager = window.AutoZomatoReviewManager;
        const restaurantName = reviewManager.processingState.currentRestaurantName || 'our restaurant';
        
        // Replace placeholders
        let reply = template
            .replace(/{CustomerName}/g, review.extractedName || review.customerName || 'valued customer')
            .replace(/{LocationName}/g, restaurantName);
        
        console.log(`[AutoZomato] Generated reply from complaint ${complaintId}:`, reply);
        return reply;
        
    } catch (error) {
        console.error('[AutoZomato] Error generating reply from complaint:', error);
        return null;
    }
}

// Update correction indicator for a review
// Helper function to make GPT API request
async function makeGPTRequest(prompt, gptConfig) {
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${gptConfig.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: gptConfig.model || 'gpt-4o-mini',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 300,
                temperature: 0.1
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content.trim();
        
        console.log('[AutoZomato] GPT API response:', content);
        
        return {
            response: content,
            success: true
        };
        
    } catch (error) {
        console.error('[AutoZomato] GPT API request failed:', error);
        throw error;
    }
}

// Fallback function for extracting first name
function extractFirstNameFallback(customerName) {
    const extractedName = smartExtractFirstName(customerName);
    return extractedName ? extractedName.name : null;
}

// GPT API Request Function
async function processReviewWithGPT(review, config) {
    // Load response bank to get complaint descriptions
    let complaintDescriptions = '';
    try {
        const responseBankUrl = chrome.runtime.getURL('response_bank.json');
        const response = await fetch(responseBankUrl);
        const responseBank = await response.json();
        
        // Build complaint descriptions from response bank
        if (responseBank.complaints && responseBank.complaints.length > 0) {
            const complaintList = responseBank.complaints.map(complaint => 
                `   - "${complaint.id}" = ${complaint.storyName}`
            ).join('\n');
            complaintDescriptions = complaintList;
        } else {
            // Fallback to hardcoded list if response bank fails
            complaintDescriptions = `   - "1" = Incorrect Orders Received (wrong item delivered)
   - "2" = Delivery Delays by Zomato (late delivery)
   - "3" = Spill/Packaging Issues (food spilled, container broke)
   - "4" = Cooking Instructions Not Followed (spice level, special requests ignored)
   - "5" = Zomato Delivery-Related Issues (delivery person problems)
   - "6" = Missing Cutlery (no spoon, fork, utensils)
   - "7" = Rude Staff (restaurant staff behavior)
   - "8" = Missing Item in Order (incomplete order)
   - "9" = Food Safety – Foreign Materials (hair, plastic in food)`;
        }
    } catch (error) {
        console.warn('[AutoZomato] Failed to load response bank for GPT prompt, using fallback:', error);
        // Fallback to hardcoded list
        complaintDescriptions = `   - "1" = Incorrect Orders Received (wrong item delivered)
   - "2" = Delivery Delays by Zomato (late delivery)
   - "3" = Spill/Packaging Issues (food spilled, container broke)
   - "4" = Cooking Instructions Not Followed (spice level, special requests ignored)
   - "5" = Zomato Delivery-Related Issues (delivery person problems)
   - "6" = Missing Cutlery (no spoon, fork, utensils)
   - "7" = Rude Staff (restaurant staff behavior)
   - "8" = Missing Item in Order (incomplete order)
   - "9" = Food Safety – Foreign Materials (hair, plastic in food)`;
    }

    const gptPrompt = `You are an AI assistant for a deliveries only restaurant review management system. Analyze this customer review and extract the following information in a single response.


**RESTAURANT REVIEW ANALYSIS**

Customer Name: "${review.customerName}"
Review Text: "${review.reviewText}"
Rating: ${review.rating}/5 stars

**TASKS TO COMPLETE:**

1. **EXTRACT FIRST NAME:**
   - If the name is a clear real name (e.g., "Rahul Kumar"), extract the first part ("Rahul")
   - If it's a username with an embedded name (e.g., "rahul123"), extract the name part ("Rahul") 
   - If it's a valid standalone name (e.g., "Zak"), use that
   - If the name is generic, nonsensical, or just initials (e.g., "FD", "User123", "FoodLover"), return null
   - NEVER invent or guess a name - only extract what is clearly present

2. **ANALYZE SENTIMENT:**
   - Determine if the review is: Positive, Negative, or Neutral
   - Base this on the overall tone and rating

3. **DETECT SPECIFIC COMPLAINTS:**
   - Only assign a complaint ID if the review EXPLICITLY mentions one of these specific issues:
${complaintDescriptions}
   - Return null if no specific complaint is detected
   - Be MODERATE - general dissatisfaction like "food was bad" should NOT get a complaint ID
   
   

**OUTPUT FORMAT:**
Return ONLY a valid JSON object with these exact keys:
{
  "firstName": "string or null",
  "sentiment": "Positive|Negative|Neutral", 
  "complaintId": "string or null"
}

**EXAMPLES:**
Customer: "john_foodie", Review: "Ordered chicken got mutton instead", Rating: 1
→ {"firstName": "john", "sentiment": "Negative", "complaintId": "1"}

Customer: "FoodLover123", Review: "Great taste and fast delivery!", Rating: 5  
→ {"firstName": null, "sentiment": "Positive", "complaintId": null}

Customer: "Sarah123", Review: "Food was cold and missing spoon", Rating: 2
→ {"firstName": "Sarah", "sentiment": "Negative", "complaintId": "6"}

Now analyze the review above and return the JSON response:`;

    try {
        const gptResult = await makeGPTRequest(gptPrompt, config.gptMode);
        const parsedResult = cleanAndParseJSON(gptResult.response);
        
        console.log('[AutoZomato] GPT analysis result:', parsedResult);
        
        // Return only the analysis data - NO REPLY GENERATION
        const result = {
            firstName: parsedResult.firstName || null,
            sentiment: parsedResult.sentiment || 'Neutral',
            complaintId: parsedResult.complaintId || null
        };
        
        return result;
    } catch (error) {
        console.error('[AutoZomato] GPT analysis failed:', error);
        // Fallback to basic processing
        return {
            firstName: extractFirstNameFallback(review.customerName),
            sentiment: 'Neutral',
            complaintId: null
        };
    }
}

// GPT Mode Processing - Single-prompt analysis + Response bank reply generation
async function processReviewWithGPTMode(review, config, onReplySuccess) {
    try {
        // Step 1: Get GPT analysis (firstName, sentiment, complaintId only)
        const gptResult = await processReviewWithGPT(review, config);
        
        // Load the response bank from the extension's files for reply generation
        const responseBankUrl = chrome.runtime.getURL('response_bank.json');
        const response = await fetch(responseBankUrl);
        const allResponseBank = await response.json();
        
        // Get brand-specific response bank
        const brandId = window.autoZomatoBrandId || '1'; // Default to brand 1
        let responseBank = allResponseBank[brandId];
        
        if (!responseBank) {
            console.warn(`[AutoZomato] Brand ${brandId} not found in response bank, using first available brand`);
            const firstBrandId = Object.keys(allResponseBank)[0];
            responseBank = allResponseBank[firstBrandId];
            console.log(`[AutoZomato] Using brand ${firstBrandId} (${responseBank?.name}) as fallback`);
        } else {
            console.log(`[AutoZomato] Using response bank for brand ${brandId} (${responseBank.name})`);
        }
        
        // Step 2: Generate reply using response bank (same logic as Ollama mode)
        let replyTemplate = '';
        let selectedCategory = '';
        
        // Use GPT-detected sentiment and complaint for response bank selection
        const adjustedRating = parseInt(review.rating) || 3;

        if (gptResult.complaintId && responseBank.complaints.some(c => c.id === gptResult.complaintId)) {
            const complaint = responseBank.complaints.find(c => c.id === gptResult.complaintId);
            const options = complaint.responses;
            replyTemplate = options[Math.floor(Math.random() * options.length)];
            selectedCategory = `Complaint: ${complaint.storyName}`;
        } else {
            const rating = Math.floor(adjustedRating);
            const category = responseBank.categories.find(c => c.storyName.startsWith(String(rating)));
            
            if (category) {
                const hasReviewText = review.reviewText && review.reviewText.trim().length > 0;
                const subCategoryKey = hasReviewText ? 'Written Review' : 'No Written Review';
                const options = category.responses[subCategoryKey];
                
                if (options && options.length > 0) {
                    replyTemplate = options[Math.floor(Math.random() * options.length)];
                    selectedCategory = `${category.storyName} -> ${subCategoryKey}`;
                }
            }
        }

       

        // Step 3: Personalize reply using GPT-extracted name
        let finalReply = replyTemplate;
        
        if (gptResult.firstName) {
            finalReply = finalReply.replace(/{CustomerName}/g, gptResult.firstName);
        } else {
            const extractedName = extractFirstName(review.customerName);
            if (extractedName && extractedName.length > 1 && !extractedName.match(/\d/)) {
                finalReply = finalReply.replace(/{CustomerName}/g, extractedName);
            }
        }
        
        finalReply = finalReply.replace(/,?\s?{CustomerName}/g, '');
        
        // Get restaurant name from ReviewManager
        const reviewManager = window.AutoZomatoReviewManager;
        const restaurantName = reviewManager.processingState.currentRestaurantName || 'our restaurant';
        finalReply = finalReply.replace(/{LocationName}/g, restaurantName);
        
        finalReply = finalReply.replace(/\s+/g, ' ').trim();

        // Fill in the reply textarea
        const replyTextarea = review.replyTextarea;
        if (replyTextarea) {
            replyTextarea.value = finalReply;
            replyTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Send the processed review data to background
        const reviewDataToSend = {
            reviewId: review.reviewId,
            customerName: review.customerName,
            extractedName: gptResult.firstName,
            reviewText: review.reviewText,
            rating: review.rating,
            sentiment: gptResult.sentiment,
            complaintId: gptResult.complaintId,
            reply: finalReply,
            replied: false,
            restaurantName: reviewManager.processingState.currentRestaurantName
        };
        
        console.log('[AutoZomato Content] Sending GPT review data to background:', {
            reviewId: reviewDataToSend.reviewId,
            customerName: reviewDataToSend.customerName,
            restaurantName: reviewDataToSend.restaurantName,
            hasReply: !!reviewDataToSend.reply
        });
        
        chrome.runtime.sendMessage({
            action: 'reviewProcessed',
            reviewData: reviewDataToSend
        });
        
        // Return data for the main function to create the single log entry
        return {
            firstName: gptResult.firstName,
            sentiment: gptResult.sentiment,
            complaintId: gptResult.complaintId,
            selectedCategory: selectedCategory,
            reply: finalReply,
            confidence: 1.0,
            publishBtn: review.submitButton
        };
        
    } catch (error) {
        console.error('[AutoZomato] Error in GPT mode processing:', error);
        
        // Return fallback data to prevent processing from stopping
        return {
            firstName: extractFirstNameFallback(review.customerName),
            sentiment: 'Neutral',
            complaintId: null,
            selectedCategory: 'Error - Fallback',
            reply: 'Thank you for your review! We appreciate your feedback.',
            confidence: 0.1,
            publishBtn: review.submitButton
        };
    }
}

// Offline Mode Processing - Template-based responses without AI
// async function processReviewWithOfflineMode(review, config, responseBank, onReplySuccess) {
//     try {
//         console.log(`[AutoZomato] Processing review in offline mode: ${review.reviewId}`);
        
//         // Step 1: Basic name extraction using local logic
//         const extractedName = smartExtractFirstName(review.customerName);
//         const firstName = extractedName ? extractedName.name : 'Customer';
//         const confidence = extractedName ? extractedName.confidence : 0;
        
//         // Step 2: Simple sentiment analysis based on keywords
//         const sentiment = analyzeOfflineSentiment(review.reviewText || '');
        
//         // Step 3: Basic complaint detection
//         const complaintId = detectOfflineComplaint(review.reviewText || '');
        
//         // Step 4: Generate reply using response bank
//         let replyTemplate = '';
//         let selectedCategory = '';
        
//         if (complaintId && complaintId !== 'None') {
//             // Use complaint-specific template
//             const complaint = responseBank.complaints?.find(c => c.id === complaintId);
//             if (complaint && complaint.responses && complaint.responses.length > 0) {
//                 const randomTemplate = complaint.responses[Math.floor(Math.random() * complaint.responses.length)];
//                 replyTemplate = randomTemplate;
//                 selectedCategory = `Complaint: ${complaint.storyName}`;
//             }
//         } else {
//             // Use rating-based response from categories
//             const rating = review.rating ? Math.floor(review.rating) : 5; // Default to 5 stars if no rating
//             const category = responseBank.categories?.find(c => c.id === rating.toString());
            
//             if (category && category.responses) {
//                 // Choose between "Written Review" and "No Written Review" based on review text
//                 const hasReviewText = review.reviewText && review.reviewText.trim().length > 0;
//                 const responseType = hasReviewText ? "Written Review" : "No Written Review";
//                 const responses = category.responses[responseType];
                
//                 if (responses && responses.length > 0) {
//                     const randomTemplate = responses[Math.floor(Math.random() * responses.length)];
//                     replyTemplate = randomTemplate;
//                     selectedCategory = `${rating} Star: ${category.storyName}`;
//                 }
//             }
//         }
        
//         // Step 5: Personalize the reply with proper placeholders
//         let personalizedReply = replyTemplate || `Thank you for your feedback, ${firstName}! We appreciate your time and will continue to improve our service.`;
        
//         // Replace both {CustomerName} and {firstName} placeholders
//         personalizedReply = personalizedReply.replace(/\{CustomerName\}/g, firstName);
//         personalizedReply = personalizedReply.replace(/\{firstName\}/g, firstName);
        
//         // Replace {LocationName} with restaurant name
//         const restaurantName = window.AutoZomatoReviewManager.processingState.currentRestaurantName || 'our restaurant';
//         personalizedReply = personalizedReply.replace(/\{LocationName\}/g, restaurantName);
        
//         const finalReply = personalizedReply;
        
//         // Step 6: Fill in the reply field
//         const replyField = review.replyTextarea;
//         if (replyField) {
//             replyField.value = finalReply;
//             replyField.dispatchEvent(new Event('input', { bubbles: true }));
//         }
        
//         // Step 7: Send data to background script
//         const reviewDataToSend = {
//             reviewId: review.reviewId,
//             customerName: review.customerName,
//             extractedName: firstName,
//             rating: review.rating || 'N/A',
//             reviewText: review.reviewText || '',
//             reply: finalReply,
//             sentiment: sentiment,
//             complaintId: complaintId,
//             confidence: confidence,
//             selectedCategory: selectedCategory,
//             restaurantName: window.AutoZomatoReviewManager.processingState.currentRestaurantName,
//             replied: false,
//             timestamp: new Date().toISOString()
//         };
        
//         console.log('[AutoZomato Content] Sending offline review data to background:', {
//             reviewId: reviewDataToSend.reviewId,
//             customerName: reviewDataToSend.customerName,
//             restaurantName: reviewDataToSend.restaurantName,
//             hasReply: !!reviewDataToSend.reply
//         });
        
//         chrome.runtime.sendMessage({
//             action: 'reviewProcessed',
//             reviewData: reviewDataToSend
//         });
        
//         // Update counter
//         onReplySuccess();
        
//         // Return data for the main function to handle state management
//         return {
//             firstName: firstName,
//             sentiment: sentiment,
//             complaintId: complaintId,
//             selectedCategory: selectedCategory,
//             reply: finalReply,
//             confidence: confidence,
//             publishBtn: review.submitButton
//         };
        
//     } catch (error) {
//         console.error('[AutoZomato] Error in offline mode processing:', error);
        
//         // Return fallback data to prevent processing from stopping
//         return {
//             firstName: extractFirstNameFallback(review.customerName),
//             sentiment: 'Neutral',
//             complaintId: null,
//             selectedCategory: 'Error - Fallback',
//             reply: 'Thank you for your review! We appreciate your feedback.',
//             confidence: 0.1,
//             publishBtn: review.submitButton
//         };
//     }
// }

// // Offline sentiment analysis using keywords
// function analyzeOfflineSentiment(reviewText) {
//     const text = reviewText.toLowerCase();
    
//     const positiveKeywords = ['good', 'great', 'excellent', 'amazing', 'fantastic', 'love', 'perfect', 'wonderful', 'awesome', 'delicious', 'tasty', 'fresh', 'quick', 'fast', 'recommend', 'satisfied', 'happy', 'pleased', 'nice', 'best'];
//     const negativeKeywords = ['bad', 'terrible', 'awful', 'horrible', 'worst', 'hate', 'disgusting', 'cold', 'late', 'slow', 'rude', 'dirty', 'stale', 'expired', 'wrong', 'missing', 'disappointed', 'unsatisfied', 'poor', 'waste'];
    
//     let positiveCount = 0;
//     let negativeCount = 0;
    
//     positiveKeywords.forEach(keyword => {
//         if (text.includes(keyword)) positiveCount++;
//     });
    
//     negativeKeywords.forEach(keyword => {
//         if (text.includes(keyword)) negativeCount++;
//     });
    
//     if (positiveCount > negativeCount) return 'Positive';
//     if (negativeCount > positiveCount) return 'Negative';
//     return 'Neutral';
// }

// // Offline complaint detection using keywords
// function detectOfflineComplaint(reviewText) {
//     const text = reviewText.toLowerCase();
    
//     const complaintKeywords = {
//         'Food Quality': ['cold', 'stale', 'expired', 'taste', 'flavor', 'spoiled', 'bad taste', 'not fresh', 'undercooked', 'overcooked', 'burnt', 'tasteless'],
//         'Service': ['rude', 'slow', 'late', 'wait', 'staff', 'behavior', 'attitude', 'service', 'ignored', 'unprofessional'],
//         'Delivery': ['late delivery', 'delayed', 'never arrived', 'wrong address', 'delivery boy', 'damaged', 'spilled', 'missing items'],
//         'Packaging': ['leaking', 'broken', 'poor packaging', 'messy', 'presentation', 'container', 'spillage'],
//         'Hygiene': ['dirty', 'unclean', 'hair', 'hygiene', 'sanitize', 'contaminated', 'food poisoning'],
//         'Pricing': ['expensive', 'overpriced', 'costly', 'money', 'refund', 'value', 'price', 'charges']
//     };
    
//     for (const [category, keywords] of Object.entries(complaintKeywords)) {
//         for (const keyword of keywords) {
//             if (text.includes(keyword)) {
//                 return category;
//             }
//         }
//     }
    
//     return 'None';
// }

// Ollama Mode Processing - Multi-step approach  
async function processReviewWithOllamaMode(review, config, promptContext, responseBank, onReplySuccess) {
    try {
        const model = promptContext.model || 'tinyllama';

        let firstName = null;
        let confidence = 0;
        let sentiment = 'Neutral';
        let complaintId = null;
        
        // Step 1: Name Extraction
        let nameExtractionPrompt = '';
        if (promptContext.systemPrompt) {
            nameExtractionPrompt = promptContext.systemPrompt + '\n\n';
        }
        
        nameExtractionPrompt += `Extract first name from customer name and return JSON only.

CUSTOMER NAME: "${review.customerName}"

RULES:
- Clear real names (e.g., "Rahul Kumar") → extract first part ("Rahul")
- Usernames with embedded names (e.g., "rahul123") → extract name part ("Rahul") 
- Valid standalone names (e.g., "Zak") → use as-is
- Generic/nonsensical names (e.g., "FD", "User123", "FoodLover") → return null
- NEVER invent or guess names

CONFIDENCE SCORING:
- 0.9-1.0: Clear real names
- 0.7-0.8: Names from usernames  
- 0.5-0.6: Plausible standalone names
- 0.0-0.4: Generic/unclear names (firstName = null)

RESPOND WITH JSON ONLY - NO OTHER TEXT:
{"firstName": "string or null", "confidence": number}

EXAMPLES:
Customer: "Jane Doe" → {"firstName": "Jane", "confidence": 0.95}
Customer: "janes_eats" → {"firstName": "Jane", "confidence": 0.75}
Customer: "S" → {"firstName": null, "confidence": 0.1}
Customer: "Foodie123" → {"firstName": null, "confidence": 0.0}`;

        // Process name extraction
        try {
            const nameResult = await makeAIRequest(nameExtractionPrompt, config);
            console.log('[AutoZomato] Raw Ollama name extraction response:', nameResult.response);
            
            const nameData = cleanAndParseJSON(nameResult.response);
            firstName = nameData.firstName;
            confidence = nameData.confidence || 0;
            
            if (firstName && confidence === 0) {
                const extracted = smartExtractFirstName(review.customerName);
                if (extracted && extracted.name.toLowerCase() === firstName.toLowerCase()) {
                    confidence = extracted.confidence;
                }
            }
            console.log(`[AutoZomato] AI Name Extraction:`, { firstName, confidence });
        } catch (nameError) {
            console.warn(`[AutoZomato] Name extraction failed:`, nameError);
            const extracted = smartExtractFirstName(review.customerName);
            if (extracted) {
                firstName = extracted.name;
                confidence = extracted.confidence;
            }
        }

        // Step 2: Review Analysis (Sentiment + Complaint)
        let reviewAnalysisPrompt = '';
        if (promptContext.systemPrompt) {
            reviewAnalysisPrompt = promptContext.systemPrompt + '\n\n';
        }
        
        reviewAnalysisPrompt += `Analyze restaurant review for sentiment and complaints. Return JSON only.

REVIEW: "${review.reviewText || 'No text'}" (${review.rating}/5 stars)

COMPLAINT DETECTION (be VERY conservative - only exact matches):
1 = Wrong order ("wrong order", "different item", "not what I ordered")
2 = Late delivery ("late delivery", "slow delivery", "took hours", "delayed")  
3 = Spill/Packaging Issues ("spilled", "leaked", "broken container")
4 = Cooking Instructions Not Followed ("too spicy", "not spicy", "instructions ignored")
5 = Rude delivery person ("delivery person rude", "driver rude")
6 = Missing cutlery ("no spoon", "missing spoon", "no cutlery")
7 = Rude staff ("staff rude", "unprofessional staff")
8 = Missing items ("missing item", "incomplete order", "forgot item")
9 = Hair/foreign objects ("hair in food", "foreign object", "plastic in food")

Return null if no EXACT phrase match found.
General complaints like "bad food", "expensive", "cold" = null.

SENTIMENT:
- Positive: 4-5 stars OR words like "excellent", "great", "good"
- Negative: 1-2 stars OR words like "bad", "terrible", "worst" 
- Neutral: 3 stars OR words like "average", "okay", "fine"

RESPOND WITH JSON ONLY - NO OTHER TEXT:
{"complaintId": "string or null", "sentiment": "Positive|Negative|Neutral"}`;

        // Process review analysis
        try {
            const reviewResult = await makeAIRequest(reviewAnalysisPrompt, config);
            console.log('[AutoZomato] Raw Ollama review analysis response:', reviewResult.response);
            
            const reviewData = cleanAndParseJSON(reviewResult.response);
            sentiment = reviewData.sentiment || 'Neutral';
            complaintId = reviewData.complaintId;
            
            // Validate complaint detection
            if (complaintId && complaintId !== null) {
                const reviewText = (review.reviewText || '').toLowerCase();
                const complaintTriggers = {
                    '1': ['wrong order', 'different item', 'ordered chicken got mutton', 'not what i ordered', 'incorrect order'],
                    '2': ['late delivery', 'slow delivery', 'took hours', 'very slow', 'delayed delivery', 'came late'],
                    '3': ['spilled', 'leaked', 'broken container', 'container broke', 'packaging broke', 'food spilled'],
                    '4': ['too spicy', 'not spicy', 'spice level', 'asked for mild', 'instructions ignored'],
                    '5': ['delivery person rude', 'driver rude', 'delivery guy rude', 'courier rude'],
                    '6': ['no spoon', 'missing spoon', 'no fork', 'no cutlery', 'missing cutlery'],
                    '7': ['staff rude', 'restaurant staff rude', 'unprofessional staff', 'rude behavior'],
                    '8': ['missing item', 'incomplete order', 'forgot item', 'didn\'t get', 'where is my'],
                    '9': ['hair in food', 'foreign object', 'plastic in food', 'dirty food', 'contaminated']
                };
                
                const isValidComplaint = complaintTriggers[complaintId] && 
                    complaintTriggers[complaintId].some(trigger => reviewText.includes(trigger));
                
                if (!isValidComplaint) {
                    console.warn(`[AutoZomato] AI hallucinated complaint "${complaintId}" - removing.`);
                    complaintId = null;
                }
            }
        } catch (reviewError) {
            console.warn(`[AutoZomato] Review analysis failed:`, reviewError);
            const fallback = fallbackAnalysis(review);
            sentiment = fallback.sentiment;
            complaintId = null;
        }

        // Combine results
        let classification = {
            sentiment: sentiment,
            complaintId: complaintId,
            firstName: firstName,
            confidence: confidence
        };

        // Validate name extraction
        if (classification.firstName && classification.firstName.length > 0) {
            const customerNameLower = (review.customerName || '').toLowerCase();
            const extractedNameLower = classification.firstName.toLowerCase();
            
            if (!customerNameLower.includes(extractedNameLower)) {
                console.warn(`[AutoZomato] AI hallucinated name "${classification.firstName}" - removing.`);
                classification.firstName = null;
                classification.confidence = 0;
            }
        }

        // Rating adjustment for sentiment mismatch
        let adjustedRating = parseInt(review.rating) || 3;
        if (adjustedRating >= 4 && classification.sentiment === 'Negative') {
            adjustedRating = adjustedRating - 1;
            console.log(`[AutoZomato] Adjusted rating from ${review.rating} to ${adjustedRating} due to negative sentiment`);
        }

        // Step 3: Generate Reply using response bank
        let replyTemplate = '';
        let selectedCategory = '';

        if (classification.complaintId && responseBank.complaints.some(c => c.id === classification.complaintId)) {
            const complaint = responseBank.complaints.find(c => c.id === classification.complaintId);
            const options = complaint.responses;
            replyTemplate = options[Math.floor(Math.random() * options.length)];
            selectedCategory = `Complaint: ${complaint.storyName}`;
        } else {
            const rating = Math.floor(adjustedRating);
            const category = responseBank.categories.find(c => c.storyName.startsWith(String(rating)));
            
            if (category) {
                const hasReviewText = review.reviewText && review.reviewText.trim().length > 0;
                const subCategoryKey = hasReviewText ? 'Written Review' : 'No Written Review';
                const options = category.responses[subCategoryKey];
                
                if (options && options.length > 0) {
                    replyTemplate = options[Math.floor(Math.random() * options.length)];
                    selectedCategory = `${category.storyName} -> ${subCategoryKey}`;
                }
            }
        }

        if (!replyTemplate) {
            console.warn('[AutoZomato] Could not find suitable reply template');
            return;
        }

        // Step 4: Personalize reply
        let finalReply = replyTemplate;
        
        if (classification.firstName && classification.confidence > 0.5) {
            finalReply = finalReply.replace(/{CustomerName}/g, classification.firstName);
        } else {
            const extractedName = extractFirstName(review.customerName);
            if (extractedName && extractedName.length > 1 && !extractedName.match(/\d/)) {
                finalReply = finalReply.replace(/{CustomerName}/g, extractedName);
            } else {
                finalReply = finalReply.replace(/{CustomerName}/g, getRandomNeutralGreeting());
            }
        }
        
        finalReply = finalReply.replace(/,?\s?{CustomerName}/g, '');
        
        // Get restaurant name from ReviewManager
        const reviewManager = window.AutoZomatoReviewManager;
        const restaurantName = reviewManager.processingState.currentRestaurantName || 'our restaurant';
        finalReply = finalReply.replace(/{LocationName}/g, restaurantName);
        
        finalReply = finalReply.replace(/\s+/g, ' ').trim();

        // Step 5: Insert reply and prepare return data
        const textarea = review.replyTextarea;
        const publishBtn = review.submitButton;

        if (textarea) {
            textarea.value = finalReply;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            
            onReplySuccess();
        }

        // Send real-time review data to background
        const reviewDataToSend = {
            reviewId: review.reviewId,
            customerName: review.customerName,
            extractedName: (classification.firstName && classification.confidence > 0.5) ? 
                          classification.firstName : extractFirstName(review.customerName) || 'N/A',
            reviewText: review.reviewText || '',
            rating: review.rating || 'N/A',
            adjustedRating: adjustedRating !== (parseInt(review.rating) || 3) ? adjustedRating : null,
            sentiment: classification.sentiment || 'Unknown',
            complaintId: classification.complaintId || 'None',
            confidence: classification.confidence || 0,
            selectedCategory: selectedCategory || 'Unknown',
            reply: finalReply,
            replied: false,
            restaurantName: window.AutoZomatoReviewManager.processingState.currentRestaurantName
        };
        
        chrome.runtime.sendMessage({
            action: 'reviewProcessed',
            reviewData: reviewDataToSend
        });

        // Return data for the main function to handle state management
        return {
            firstName: (classification.firstName && classification.confidence > 0.5) ? 
                      classification.firstName : extractFirstName(review.customerName) || 'N/A',
            sentiment: classification.sentiment || 'Unknown',
            complaintId: classification.complaintId || 'None',
            selectedCategory: selectedCategory || 'Unknown',
            reply: finalReply,
            confidence: classification.confidence || 0,
            publishBtn: publishBtn
        };
        
    } catch (error) {
        console.error('[AutoZomato] Error in Ollama mode processing:', error);
    }
}

// Helper function to post replies
async function postReply(review, reply, config) {
    try {
        const textarea = review.replyTextarea;
        const publishBtn = review.submitButton;
        
        if (textarea && publishBtn) {
            textarea.value = reply;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Wait for the input event to process
            await new Promise(resolve => setTimeout(resolve, 300));
            
            publishBtn.click();
            console.log(`[AutoZomato] Posted reply for review ${review.reviewId}`);
        } else {
            console.warn(`[AutoZomato] Missing textarea or publish button for review ${review.reviewId}`);
        }
    } catch (error) {
        console.error('[AutoZomato] Error posting reply:', error);
    }
}

// Auto-detection of page type
function detectPageType() {
    const url = window.location.href;

    if (url.includes('/reviews') || document.querySelector('.res-review')) {
        return 'reviews';
    }

    if (url.includes('/restaurant/') || url.includes('/delivery/')) {
        return 'restaurant';
    }

    return 'unknown';
}

// Initialize when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        console.log('[AutoZomato] DOMContentLoaded event fired');
        initialize();
    });
} else {
    console.log('[AutoZomato] Document already loaded');
    initialize();
}

function initialize() {
    // Wait a bit for the config to be injected
    setTimeout(() => {
        const config = window.autoZomatoConfig || {};
        console.log('[AutoZomato] Initializing with config:', config);

        const pageType = detectPageType();
        console.log('[AutoZomato] initialize() called. Page type:', pageType, 'URL:', window.location.href);

        // Check if this is a new page/URL
        const newUrl = window.location.href;
        if (currentSessionUrl !== newUrl) {
            console.log(`[AutoZomato] New page in initialize. Previous: ${currentSessionUrl}, Current: ${newUrl}`);
            currentSessionUrl = newUrl;
            
            // Clear any previous session data when initializing on a new page
            processedReviewsLog = [];
            currentRestaurantName = ''; // Reset restaurant name for new page
            
            // Close any existing log popup from previous page
            const existingPopup = document.getElementById('autozomato-log-popup');
            if (existingPopup) {
                existingPopup.remove();
                console.log('[AutoZomato] Cleared previous page popup and data');
            }

            // Reset the started flag for new page
            window.__autozomatoStarted = undefined;
        }

        // Add visual indicator that extension is active
        if (pageType === 'reviews' || pageType === 'restaurant') {
            // Scrape restaurant name for display
            currentRestaurantName = scrapeRestaurantName();
            createOrUpdateIndicator(`🤖 ${currentRestaurantName} Initializing...`);
            // Auto-start review processing if not already started
            if (typeof window.__autozomatoStarted === 'undefined') {
                window.__autozomatoStarted = true;
                console.log('[AutoZomato] Auto-starting review processing from initialize()');
                // Pass the config to the processing function
                startProcessing(config.promptContext || {});
            }
        }
    }, 100); // Small delay to ensure config is set
}

function createOrUpdateIndicator(text, color = '#667eea') {
    let indicator = document.getElementById('autozomato-indicator');
    let isNewIndicator = false;
    
    if (!indicator) {
        isNewIndicator = true;
        indicator = document.createElement('div');
        indicator.id = 'autozomato-indicator';
        indicator.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: #667eea; /* default color */
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 13px;
            z-index: 10000;
            font-family: Arial, sans-serif;
            box-shadow: 0 3px 8px rgba(0,0,0,0.3);
            transition: all 0.3s ease;
            cursor: pointer;
            border: 2px solid rgba(255,255,255,0.2);
            max-width: 300px;
            word-wrap: break-word;
            font-weight: 500;
        `;
        
        // Add hover effect
        indicator.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px)';
            this.style.boxShadow = '0 5px 12px rgba(0,0,0,0.4)';
        });
        
        indicator.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = '0 3px 8px rgba(0,0,0,0.3)';
        });
        
        // Ensure DOM is ready before appending
        if (document.body) {
            document.body.appendChild(indicator);
        } else {
            // Wait for DOM to be ready
            document.addEventListener('DOMContentLoaded', () => {
                if (document.body) {
                    document.body.appendChild(indicator);
                }
            });
        }
        
        console.log('[AutoZomato] Created new indicator element');
    }
    
    // Always ensure the click event listener is attached (for both new and existing indicators)
    // First, try to remove any existing event listeners
    const oldHandler = indicator.onclick;
    if (oldHandler) {
        indicator.onclick = null;
    }
    
    // Remove any existing event listeners using a stored reference
    if (indicator._autoZomatoClickHandler) {
        indicator.removeEventListener('click', indicator._autoZomatoClickHandler);
    }
    
    // Create and store new click handler
    const clickHandler = function(e) {
        console.log('[AutoZomato] Indicator clicked! Target:', e.target);
        e.preventDefault();
        e.stopPropagation();
        showLogPopup();
    };
    
    indicator._autoZomatoClickHandler = clickHandler;
    indicator.addEventListener('click', clickHandler);
    
    console.log('[AutoZomato] Event listener attached to indicator for popup toggle (isNew:', isNewIndicator, ')');
    
    indicator.innerHTML = text;
    indicator.style.backgroundColor = color;
}

async function renderLogPopupContent() {
    const popup = document.getElementById('autozomato-log-popup');
    if (!popup) return;
    
    // Load complaint mappings before rendering
    await loadComplaintMappings(window.autoZomatoBrandId);

    // Clear existing table content to prevent duplication
    let table = popup.querySelector('table');
    if (table) {
        table.remove();
    }

    // Create table for logs
    table = document.createElement('table');
    table.style.cssText = `width: 100%; border-collapse: collapse;`;
    table.innerHTML = `
        <thead style="background: #fafafa;">
            <tr>
                <th style="padding: 6px; text-align: center; border-bottom: 1px solid #eee; width: 50px;">Include</th>
                <th style="padding: 6px; text-align: left; border-bottom: 1px solid #eee; width: 120px;">Customer</th>
                <th style="padding: 6px; text-align: center; border-bottom: 1px solid #eee; width: 50px;">Rating</th>
                <th style="padding: 6px; text-align: center; border-bottom: 1px solid #eee; width: 70px;">Sentiment</th>
                <th style="padding: 6px; text-align: center; border-bottom: 1px solid #eee; width: 60px;">Name Conf.</th>
                <th style="padding: 6px; text-align: left; border-bottom: 1px solid #eee; width: 100px;">AI Complaint</th>
                <th style="padding: 6px; text-align: left; border-bottom: 1px solid #eee; width: 120px;">Corrected Complaint</th>
                <th style="padding: 6px; text-align: left; border-bottom: 1px solid #eee;">Reply (Editable)</th>
                <th style="padding: 6px; text-align: center; border-bottom: 1px solid #eee; width: 60px;">Status</th>
            </tr>
        </thead>
    `;

    const tbody = document.createElement('tbody');
    
    // Get processed reviews from ReviewManager instead of legacy processedReviewsLog
    const reviewManager = window.AutoZomatoReviewManager;
    const allReviews = Array.from(reviewManager.reviews.values());
    
    if (allReviews.length === 0) {
        const pageType = detectPageType();
        const isReviewsPage = pageType === 'reviews' || pageType === 'restaurant';
        const emptyMessage = isReviewsPage 
            ? 'No reviews processed yet. Wait for AutoZomato to process reviews, or click the indicator to start processing.'
            : 'No reviews processed yet. Navigate to a restaurant review page to see processed reviews here.';
        
        tbody.innerHTML = `<tr><td colspan="9" style="padding: 20px; text-align: center; color: #888; line-height: 1.4;">${emptyMessage}</td></tr>`;
    } else {
        allReviews.forEach(review => {
            const row = document.createElement('tr');
            row.setAttribute('data-review-id', review.reviewId);

            const isEditable = review.state !== reviewManager.ReviewState.PUBLISHED;
            const replyCellContent = isEditable
                ? `<div class="editable-reply" contenteditable="true" style="padding: 4px; border-radius: 3px; border: 1px dashed #ccc; font-size: 11px;">${review.reply || ''}</div>`
                : `<div style="padding: 4px; font-size: 11px;">${review.reply || ''}</div>`;

            // Create checkbox - disabled if already replied
            const checkboxDisabled = review.state === reviewManager.ReviewState.PUBLISHED ? 'disabled' : '';
            const checkboxChecked = review.includeInAutoReply ? 'checked' : '';
            
            // Sentiment color coding
            const sentimentColor = review.sentiment === 'Positive' ? '#48bb78' : 
                                 review.sentiment === 'Negative' ? '#e53e3e' : '#4299e1';
            
            // Name confidence formatting
            const nameConfidence = Math.round((review.confidence || 0) * 100);
            const nameConfColor = nameConfidence > 70 ? '#48bb78' : 
                                 nameConfidence > 50 ? '#ed8936' : '#e53e3e';
            
            // Rating formatting
            const rating = (typeof review.rating === 'number' || (typeof review.rating === 'string' && review.rating !== 'N/A')) ? review.rating : 'N/A';
            const ratingColor = rating >= 4 ? '#48bb78' : rating <= 2 ? '#e53e3e' : '#ed8936';

            // Get original AI complaint name for display
            const originalComplaintId = review.originalComplaintId || review.complaintId;
            const originalComplaintName = originalComplaintId ? 
                (complaintMappings.get(originalComplaintId)?.name || originalComplaintId) : 'None';
            
            // Get corrected complaint ID for dropdown selection
            const correctedComplaintId = review.correctedComplaintId || review.complaintId;

            row.innerHTML = `
                <td style="padding: 6px; border-bottom: 1px solid #eee; text-align: center; vertical-align: top;">
                    <input type="checkbox" class="include-checkbox" ${checkboxChecked} ${checkboxDisabled} 
                           title="${review.state === reviewManager.ReviewState.PUBLISHED ? 'Already replied' : 'Include in auto-reply'}" 
                           style="transform: scale(1.1);">
                </td>
                <td style="padding: 6px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 11px;">
                    <strong>${review.extractedName || review.customerName}</strong><br>
                    <span style="color: #777; font-size: 10px;">${review.customerName}</span><br>
                    <span style="color: #666; font-size: 10px;">${review.selectedCategory || 'Unknown'}</span>
                </td>
                <td style="padding: 6px; border-bottom: 1px solid #eee; text-align: center; vertical-align: top; color: ${ratingColor}; font-weight: bold; font-size: 12px;">${rating}</td>
                <td style="padding: 6px; border-bottom: 1px solid #eee; text-align: center; vertical-align: top;">
                    <span style="color: ${sentimentColor}; font-weight: bold; font-size: 10px;">${review.sentiment || 'Unknown'}</span>
                </td>
                <td style="padding: 6px; border-bottom: 1px solid #eee; text-align: center; vertical-align: top;">
                    <span style="color: ${nameConfColor}; font-weight: bold; font-size: 10px;">${nameConfidence}%</span>
                </td>
                <td style="padding: 6px; border-bottom: 1px solid #eee; vertical-align: top; background-color: #f8f9fa;">
                    <div style="font-size: 11px; color: #666; padding: 4px; border-radius: 3px;">${originalComplaintName}</div>
                </td>
                <td class="complaint-cell" style="padding: 6px; border-bottom: 1px solid #eee; vertical-align: top;">
                    <!-- Corrected complaint dropdown will be inserted here -->
                </td>
                <td style="padding: 6px; border-bottom: 1px solid #eee; white-space: pre-wrap; word-break: break-word; vertical-align: top;">
                    ${replyCellContent}
                </td>
                <td class="reply-status" style="padding: 6px; border-bottom: 1px solid #eee; text-align: center; font-size: 14px; vertical-align: top;">${review.state === reviewManager.ReviewState.PUBLISHED ? '✅' : '❌'}</td>
            `;
            tbody.appendChild(row);
            
            // Add corrected complaint dropdown after row is added to DOM
            const complaintCell = row.querySelector('.complaint-cell');
            if (complaintCell) {
                const dropdown = createComplaintSelector(correctedComplaintId, review.reviewId);
                complaintCell.appendChild(dropdown);
            }
        });
    }

    table.appendChild(tbody);
    popup.appendChild(table);

    // Re-attach event listeners for any new editable divs
    popup.querySelectorAll('.editable-reply').forEach(div => {
        div.addEventListener('input', handleReplyEdit);
    });

    // Add event listeners for checkboxes
    popup.querySelectorAll('.include-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', handleIncludeCheckboxChange);
    });

    // Update the header with summary information
    updateLogPopupHeader();
}

function updateLogPopupHeader() {
    const popup = document.getElementById('autozomato-log-popup');
    if (!popup) return;

    const headerSpan = popup.querySelector('span');
    const replyAllBtn = popup.querySelector('button');
    const selectAllBtn = popup.querySelector('.select-all-btn');
    if (!headerSpan || !replyAllBtn) return;

    const reviewManager = window.AutoZomatoReviewManager;
    const allReviews = Array.from(reviewManager.reviews.values());
    const totalReviews = allReviews.length;
    const alreadyReplied = allReviews.filter(review => review.state === reviewManager.ReviewState.PUBLISHED).length;
    const selectedForReply = allReviews.filter(review => review.state !== reviewManager.ReviewState.PUBLISHED && review.includeInAutoReply).length;
    const unselectedReviews = allReviews.filter(review => review.state !== reviewManager.ReviewState.PUBLISHED && !review.includeInAutoReply).length;

    // Verify our counts add up correctly
    const calculatedTotal = alreadyReplied + selectedForReply + unselectedReviews;
    if (calculatedTotal !== totalReviews) {
        console.warn(`[AutoZomato] Count mismatch: ${calculatedTotal} calculated vs ${totalReviews} actual`);
    }

    headerSpan.innerHTML = `AutoZomato Reply Log (${totalReviews} reviews) - ${selectedForReply} selected for reply, ${alreadyReplied} already replied`;
    
    // Update the Reply to All button
    if (selectedForReply > 0) {
        replyAllBtn.innerHTML = `Reply to All (${selectedForReply})`;
        replyAllBtn.style.opacity = '1';
        replyAllBtn.disabled = false;
    } else {
        replyAllBtn.innerHTML = 'Reply to All (0)';
        replyAllBtn.style.opacity = '0.5';
        replyAllBtn.disabled = true;
    }

    // Update the Select All button
    if (selectAllBtn) {
        const availableToSelect = totalReviews - alreadyReplied;
        if (availableToSelect === 0) {
            selectAllBtn.style.display = 'none';
        } else {
            selectAllBtn.style.display = 'inline-block';
            if (selectedForReply === availableToSelect) {
                selectAllBtn.innerHTML = 'Deselect All';
                selectAllBtn.style.background = '#e53e3e';
            } else {
                selectAllBtn.innerHTML = 'Select All';
                selectAllBtn.style.background = '#48bb78';
            }
        }
    }
}

function showLogPopup() {
    console.log('[AutoZomato] showLogPopup() called');
    console.log('[AutoZomato] Current processedReviewsLog length:', processedReviewsLog.length);
    console.log('[AutoZomato] Current URL:', window.location.href);
    console.log('[AutoZomato] Current session URL:', currentSessionUrl);
    
    // Toggle behavior: remove if exists, otherwise create
    const existingPopup = document.getElementById('autozomato-log-popup');
    if (existingPopup) {
        console.log('[AutoZomato] Closing existing popup');
        existingPopup.remove();
        return;
    }

    console.log('[AutoZomato] Creating new log popup');
    
    // Create popup container
    const popup = document.createElement('div');
    popup.id = 'autozomato-log-popup';
    popup.style.cssText = `
        position: fixed;
        top: 35px;
        right: 10px;
        width: 600px;
        max-height: 500px;
        background: white;
        border: 1px solid #ccc;
        border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        z-index: 10001;
        font-family: Arial, sans-serif;
        font-size: 12px;
        color: #333;
        overflow-y: auto;
        display: flex; /* Use flexbox for layout */
        flex-direction: column; /* Stack header and table vertically */
    `;

    // Create header
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 10px;
        background: #f7f7f7;
        border-bottom: 1px solid #eee;
        font-weight: bold;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0; /* Prevent header from shrinking */
    `;
    header.innerHTML = '<span>AutoZomato Reply Log</span>';

    // Create Reply to All button
    const replyAllBtn = document.createElement('button');
    replyAllBtn.innerHTML = 'Reply to All';
    replyAllBtn.style.cssText = `
        background: #4299e1;
        color: white;
        border: none;
        font-size: 11px;
        font-weight: bold;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        margin-right: 10px;
    `;
    replyAllBtn.onclick = handleReplyToAll;

    // Create Select All/Deselect All button
    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'select-all-btn';
    selectAllBtn.innerHTML = 'Select All';
    selectAllBtn.style.cssText = `
        background: #48bb78;
        color: white;
        border: none;
        font-size: 11px;
        font-weight: bold;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        margin-right: 10px;
    `;
    selectAllBtn.addEventListener('click', handleSelectAll);

    header.insertBefore(selectAllBtn, header.firstChild);
    header.insertBefore(replyAllBtn, header.firstChild);

    // Create fullscreen button
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.innerHTML = '⛶';
    fullscreenBtn.title = 'Toggle Fullscreen';
    fullscreenBtn.style.cssText = `
        background: #6b46c1;
        color: white;
        border: none;
        font-size: 14px;
        font-weight: bold;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        margin-right: 10px;
    `;
    fullscreenBtn.onclick = () => toggleFullscreen(popup);

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = `
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
        padding: 0 5px;
    `;
    closeBtn.onclick = () => popup.remove();
    
    header.appendChild(fullscreenBtn);
    header.appendChild(closeBtn);

    popup.appendChild(header);
    document.body.appendChild(popup);

    // Add keyboard shortcuts for the popup
    const handleKeydown = (e) => {
        if (e.target.closest('#autozomato-log-popup')) {
            if (e.key === 'Escape') {
                if (popup.classList.contains('fullscreen')) {
                    toggleFullscreen(popup);
                } else {
                    popup.remove();
                    document.removeEventListener('keydown', handleKeydown);
                }
                e.preventDefault();
            } else if (e.key === 'F11' || (e.key === 'f' && e.ctrlKey)) {
                toggleFullscreen(popup);
                e.preventDefault();
            }
        }
    };
    
    document.addEventListener('keydown', handleKeydown);
    
    // Remove event listener when popup is removed
    const originalRemove = popup.remove;
    popup.remove = function() {
        document.removeEventListener('keydown', handleKeydown);
        originalRemove.call(this);
    };

    // Initial render of the content
    renderLogPopupContent().catch(console.error);
}

function handleSelectAll() {
    const popup = document.getElementById('autozomato-log-popup');
    if (!popup) return;

    const selectAllBtn = popup.querySelector('.select-all-btn');
    if (!selectAllBtn) return;

    const checkboxes = popup.querySelectorAll('.include-checkbox:not(:disabled)');
    const isSelectingAll = selectAllBtn.innerHTML === 'Select All';

    checkboxes.forEach(checkbox => {
        checkbox.checked = isSelectingAll;
        // Trigger the change event to update the log
        checkbox.dispatchEvent(new Event('change'));
    });

    // Update button text
    selectAllBtn.innerHTML = isSelectingAll ? 'Deselect All' : 'Select All';
    selectAllBtn.style.background = isSelectingAll ? '#e53e3e' : '#48bb78';
}

function toggleFullscreen(popup) {
    const isFullscreen = popup.classList.contains('fullscreen');
    
    if (isFullscreen) {
        // Exit fullscreen
        popup.classList.remove('fullscreen');
        popup.style.cssText = `
            position: fixed;
            top: 35px;
            right: 10px;
            width: 600px;
            max-height: 500px;
            background: white;
            border: 1px solid #ccc;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            z-index: 10001;
            font-family: Arial, sans-serif;
            font-size: 12px;
            color: #333;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        `;
        
        // Update button icon
        const fullscreenBtn = popup.querySelector('button[title="Toggle Fullscreen"]');
        if (fullscreenBtn) {
            fullscreenBtn.innerHTML = '⛶';
            fullscreenBtn.title = 'Toggle Fullscreen';
        }
    } else {
        // Enter fullscreen
        popup.classList.add('fullscreen');
        popup.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: white;
            border: none;
            border-radius: 0;
            box-shadow: none;
            z-index: 10001;
            font-family: Arial, sans-serif;
            font-size: 12px;
            color: #333;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        `;
        
        // Update button icon
        const fullscreenBtn = popup.querySelector('button[title="Toggle Fullscreen"]');
        if (fullscreenBtn) {
            fullscreenBtn.innerHTML = '⛶';
            fullscreenBtn.title = 'Exit Fullscreen';
        }
    }
    
    // Ensure table adjusts to new container size
    const table = popup.querySelector('table');
    if (table && isFullscreen) {
        // In normal mode, restore original table width
        table.style.width = '100%';
    } else if (table && !isFullscreen) {
        // In fullscreen mode, make table take full advantage of space
        table.style.width = '100%';
    }
}

async function handleReplyToAll() {
    console.log('[AutoZomato] Starting Reply to All...');
    const reviewManager = window.AutoZomatoReviewManager;
    // Get all reviews that are not published and are selected for auto-reply
    const logsToReply = Array.from(reviewManager.reviews.values()).filter(
        review => review.state !== reviewManager.ReviewState.PUBLISHED && review.includeInAutoReply
    );

    if (logsToReply.length === 0) {
        console.log('[AutoZomato] No reviews selected for auto-reply.');
        return;
    }

    console.log(`[AutoZomato] Found ${logsToReply.length} reviews to reply to.`);

    const waitTimeMs = (window.autoZomatoConfig?.replyWaitTime || 3) * 1000;
    console.log(`[AutoZomato] Using reply wait time: ${waitTimeMs}ms`);

    for (let i = 0; i < logsToReply.length; i++) {
        const log = logsToReply[i];
        const reviewElement = document.querySelector(`.res-review[data-review_id="${log.reviewId}"]`);
        let publishBtn = log.publishBtn;
        if (!publishBtn || !document.contains(publishBtn)) {
            if (reviewElement) {
                publishBtn = reviewElement.querySelector('.zblack');
            }
        }
        if (reviewElement && publishBtn) {
            console.log(`[AutoZomato] Clicking publish for review ${log.reviewId} (${i + 1}/${logsToReply.length})`);
            // Fill the reply textarea if needed
            const textarea = reviewElement.querySelector('textarea');
            if (textarea && textarea.value !== log.reply) {
                textarea.value = log.reply;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            publishBtn.click();
            // Update state in ReviewManager
            reviewManager.updateReview(log.reviewId, {
                state: reviewManager.ReviewState.PUBLISHED
            });
            // Update the status icon and disable editing in the popup in real-time
            const row = document.querySelector(`#autozomato-log-popup tr[data-review-id="${log.reviewId}"]`);
            if (row) {
                const statusCell = row.querySelector('.reply-status');
                if (statusCell) statusCell.innerHTML = '✅';
                const replyDiv = row.querySelector('.editable-reply');
                if (replyDiv) {
                    replyDiv.setAttribute('contenteditable', 'false');
                    replyDiv.style.border = 'none';
                    replyDiv.classList.remove('editable-reply');
                }
                const checkbox = row.querySelector('.include-checkbox');
                if (checkbox) {
                    checkbox.disabled = true;
                    checkbox.title = 'Already replied';
                }
            }
            updateLogPopupHeader();
            if (i < logsToReply.length - 1) {
                console.log(`[AutoZomato] Waiting ${waitTimeMs}ms before next reply...`);
                await new Promise(resolve => setTimeout(resolve, waitTimeMs));
            }
        } else {
            console.warn(`[AutoZomato] Could not find publish button for review ${log.reviewId} during Reply to All.`);
        }
    }
    console.log('[AutoZomato] Reply to All finished.');
}

// AUTO-REPLY QUEUE PROCESSOR - Processes queued reviews with configurable delays
// UNIFIED AUTO-REPLY PROCESSOR - Uses ReviewManager for state management
async function startAutoReplyProcessor() {
    const reviewManager = window.AutoZomatoReviewManager;
    if (reviewManager.processingState.autoReplyRunning) {
        console.log('[AutoZomato] Auto-reply already running');
        return;
    }
    reviewManager.processingState.autoReplyRunning = true;
    reviewManager.processingState.autoReplyStopped = false;

    // Get all reviews that have a reply and are not published
    const allReviews = Array.from(reviewManager.reviews.values());
    const reviewsToPublish = allReviews.filter(r => r.reply && r.state !== reviewManager.ReviewState.PUBLISHED);
    if (reviewsToPublish.length === 0) {
        // Nothing to do, just return (do NOT call sendProcessingCompletionSignal)
        reviewManager.processingState.autoReplyRunning = false;
        return;
    }
    const waitTime = reviewManager.processingState.autoReplyWaitTime || 3000;
    let processedCount = 0;
    let stoppedEarly = false;

    console.log(`[AutoZomato] Starting auto-reply processor: ${reviewsToPublish.length} reviews, interval ${waitTime}ms`);

    for (let i = 0; i < reviewsToPublish.length; i++) {
        if (reviewManager.processingState.autoReplyStopped) {
            console.log('[AutoZomato] Auto-reply stopped by user');
            stoppedEarly = true;
            break;
        }
        
        const review = reviewsToPublish[i];
        console.log(`[AutoZomato] Publishing review ${i + 1}/${reviewsToPublish.length}: ${review.reviewId}`);
        
        // Try to find the review element and publish button
        const reviewElement = document.querySelector(`.res-review[data-review_id="${review.reviewId}"]`);
        let publishBtn = review.publishBtn;
        if (!publishBtn || !document.contains(publishBtn)) {
            if (reviewElement) {
                publishBtn = reviewElement.querySelector('.zblack');
            }
        }
        
        if (publishBtn) {
            // Fill the reply textarea if needed
            const textarea = reviewElement ? reviewElement.querySelector('textarea') : null;
            if (textarea && textarea.value !== review.reply) {
                textarea.value = review.reply;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            
            // Publish the reply
            publishBtn.click();
            processedCount++;
            
            // Update review state to PUBLISHED
            reviewManager.updateReview(review.reviewId, {
                state: reviewManager.ReviewState.PUBLISHED
            });
            
            // Add to processed log
            processedReviewsLog.push({
                reviewId: review.reviewId,
                customerName: review.customerName,
                extractedName: review.extractedName,
                rating: review.rating,
                reviewText: review.reviewText,
                reply: review.reply,
                sentiment: review.sentiment,
                restaurantName: reviewManager.processingState.currentRestaurantName,
                replied: true,
                timestamp: new Date().toISOString()
            });
            
            // Update UI if present
            const row = document.querySelector(`#autozomato-log-popup tr[data-review-id="${review.reviewId}"]`);
            if (row) {
                const statusCell = row.querySelector('.reply-status');
                if (statusCell) statusCell.innerHTML = '✅';
                const replyDiv = row.querySelector('.editable-reply');
                if (replyDiv) {
                    replyDiv.setAttribute('contenteditable', 'false');
                    replyDiv.style.border = 'none';
                    replyDiv.classList.remove('editable-reply');
                }
                const checkbox = row.querySelector('.include-checkbox');
                if (checkbox) {
                    checkbox.disabled = true;
                    checkbox.title = 'Already replied';
                }
            }
            
            if (typeof updateLogPopupHeader === 'function') updateLogPopupHeader();
            
            console.log(`[AutoZomato] ✅ Published review ${review.reviewId} (${processedCount}/${reviewsToPublish.length})`);
        } else {
            console.warn(`[AutoZomato] Could not find publish button for review ${review.reviewId}`);
        }
        
        // Wait for the specified interval before processing the next review
        if (i < reviewsToPublish.length - 1) {
            console.log(`[AutoZomato] Waiting ${waitTime}ms before next review...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    
    reviewManager.processingState.autoReplyRunning = false;
    const publishedReviews = reviewManager.getReviewsByState(reviewManager.ReviewState.PUBLISHED).length;
    createOrUpdateIndicator(`✅ ${reviewManager.processingState.currentRestaurantName} | ${publishedReviews} Published`, '#48bb78');
    
    if (typeof renderLogPopupContent === 'function') {
        const popupElement = document.getElementById('autozomato-log-popup');
        if (popupElement) renderLogPopupContent().catch(console.error);
    }
    if (processedCount > 0 || stoppedEarly) {
        sendProcessingCompletionSignal(true);
    }
}

// Function to stop the auto-reply processor
function stopAutoReplyProcessor() {
    console.log('[AutoZomato] Stopping auto-reply processor');
    const reviewManager = window.AutoZomatoReviewManager;
    
    reviewManager.processingState.autoReplyStopped = true;
    
    // Mark all queued reviews as skipped
    const queuedReviews = reviewManager.getAutoReplyQueue();
    queuedReviews.forEach(review => {
        reviewManager.updateReview(review.reviewId, {
            state: reviewManager.ReviewState.SKIPPED,
            error: 'Auto-reply processor stopped'
        });
    });
    
    // Send completion signal if processing was stopped early
    if (reviewManager.processingState.autoReplyRunning) {
        console.log('[AutoZomato] Auto-reply processor stopped early. Sending completion signal.');
        sendProcessingCompletionSignal();
    }
}

// Function to get queue status - updated to use ReviewManager
function getAutoReplyQueueStatus() {
    const reviewManager = window.AutoZomatoReviewManager;
    const queuedReviews = reviewManager.getAutoReplyQueue();
    
    return {
        queueLength: queuedReviews.length,
        isRunning: reviewManager.processingState.autoReplyRunning,
        isStopped: reviewManager.processingState.autoReplyStopped
    };
}

// Debug functions for console access - Updated to use ReviewManager
window.autoZomatoDebug = {
    getQueueStatus: getAutoReplyQueueStatus,
    getQueue: () => {
        const reviewManager = window.AutoZomatoReviewManager;
        const queuedReviews = reviewManager.getAutoReplyQueue();
        return queuedReviews.map(review => ({
            reviewId: review.reviewId,
            state: review.state,
            hasReply: !!review.reply,
            hasPublishBtn: !!review.publishBtn,
            publishBtnValid: !!(review.publishBtn && document.contains(review.publishBtn))
        }));
    },
    getProcessorState: () => {
        const reviewManager = window.AutoZomatoReviewManager;
        return {
            running: reviewManager.processingState.autoReplyRunning,
            stopped: reviewManager.processingState.autoReplyStopped,
            processingRunning: reviewManager.processingState.processingRunning,
            autoReplyEnabled: reviewManager.processingState.autoReplyEnabled
        };
    },
    stopProcessor: stopAutoReplyProcessor,
    clearQueue: () => {
        const reviewManager = window.AutoZomatoReviewManager;
        const queuedReviews = reviewManager.getAutoReplyQueue();
        queuedReviews.forEach(review => {
            reviewManager.updateReview(review.reviewId, {
                state: reviewManager.ReviewState.PROCESSED,
                includeInAutoReply: false
            });
        });
        console.log('[AutoZomato] Queue cleared manually - reviews moved to PROCESSED state');
    },
    getProcessedLog: () => {
        const reviewManager = window.AutoZomatoReviewManager;
        return Array.from(reviewManager.reviews.values()).map(review => ({
            reviewId: review.reviewId,
            customerName: review.customerName,
            state: review.state,
            hasReply: !!review.reply
        }));
    },
    getStats: () => {
        const reviewManager = window.AutoZomatoReviewManager;
        return reviewManager.getStats();
    },
    getReviewsByState: (state) => {
        const reviewManager = window.AutoZomatoReviewManager;
        return reviewManager.getReviewsByState(state);
    },
    validateQueue: () => {
        const reviewManager = window.AutoZomatoReviewManager;
        const queuedReviews = reviewManager.getAutoReplyQueue();
        const validation = queuedReviews.map(review => {
            const reviewElement = document.querySelector(`.res-review[data-review_id="${review.reviewId}"]`);
            const publishBtn = reviewElement ? reviewElement.querySelector('.zblack') : null;
            return {
                reviewId: review.reviewId,
                elementExists: !!reviewElement,
                originalBtnValid: !!(review.publishBtn && document.contains(review.publishBtn)),
                canRefindBtn: !!publishBtn
            };
        });
        console.table(validation);
        return validation;
    }
};
