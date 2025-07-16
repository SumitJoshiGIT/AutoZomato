// --- AutoZomato Content Script Injection Check ---
console.log('[AutoZomato] Content script injected and running!');

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

// Global store for processed review data
if (typeof processedReviewsLog === 'undefined') {
    var processedReviewsLog = [];
}

// Store the current session URL to detect page changes
if (typeof currentSessionUrl === 'undefined') {
    var currentSessionUrl = '';
}

// Store the restaurant name for the current page
if (typeof currentRestaurantName === 'undefined') {
    var currentRestaurantName = '';
}

// Debug function for testing popup functionality
window.autoZomatoTestPopup = function() {
    console.log('[AutoZomato] Manual popup test called');
    showLogPopup();
};

// Debug function to check current state
window.autoZomatoDebugState = function() {
    console.log('[AutoZomato] Debug State:');
    console.log('- processedReviewsLog.length:', processedReviewsLog.length);
    console.log('- currentSessionUrl:', currentSessionUrl);
    console.log('- currentRestaurantName:', currentRestaurantName);
    console.log('- window.location.href:', window.location.href);
    console.log('- indicator element:', document.getElementById('autozomato-indicator'));
    console.log('- popup element:', document.getElementById('autozomato-log-popup'));
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
        
        // Set config from message if not already set
        if (!window.autoZomatoConfig && message.config) {
            window.autoZomatoConfig = message.config;
            console.log('[AutoZomato] Config set from message:', window.autoZomatoConfig);
        }
        
        // Clear any previous session data
        processedReviewsLog = [];
        
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
        
        // Log the updated GPT mode settings for debugging
        if (message.config && message.config.gptMode) {
            const gptConfig = message.config.gptMode;
            console.log('[AutoZomato] Updated GPT Mode Configuration:', {
                enabled: gptConfig.enabled,
                hasApiKey: !!gptConfig.apiKey,
                apiKeyLength: gptConfig.apiKey?.length || 0,
                isPlaceholder: gptConfig.apiKey === 'YOUR_OPENAI_API_KEY_HERE',
                model: gptConfig.model
            });
        }
        
        sendResponse({ success: true });
    }
});

async function startProcessing(promptContext) {
    try {
        console.log('[AutoZomato] Starting review processing on:', window.location.href);
        console.log('[AutoZomato] Received config:', window.autoZomatoConfig);
        
        // Ensure config exists
        if (!window.autoZomatoConfig) {
            console.warn('[AutoZomato] No config found, using defaults');
            window.autoZomatoConfig = {
                autoReply: false,
                autoClose: false,
                promptContext: {}
            };
        }

        // Check if this is a new URL/page
        const newUrl = window.location.href;
        if (currentSessionUrl !== newUrl) {
            console.log(`[AutoZomato] New page detected. Previous: ${currentSessionUrl}, Current: ${newUrl}`);
            currentSessionUrl = newUrl;
            
            // Clear previous session data for new page
            processedReviewsLog = [];
            currentRestaurantName = ''; // Reset restaurant name for new page
            console.log('[AutoZomato] Cleared previous session data for new page');

            // Close any existing log popup from previous session
            const existingPopup = document.getElementById('autozomato-log-popup');
            if (existingPopup) {
                existingPopup.remove();
                console.log('[AutoZomato] Closed previous session log popup');
            }
        } else {
            // Same page, but still clear data for fresh start
            processedReviewsLog = [];
            console.log('[AutoZomato] Cleared previous session data for fresh start');

            // Close any existing log popup
            const existingPopup = document.getElementById('autozomato-log-popup');
            if (existingPopup) {
                existingPopup.remove();
                console.log('[AutoZomato] Closed existing log popup for fresh start');
            }
        }

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
        currentRestaurantName = scrapeRestaurantName();
        console.log('[AutoZomato] Current restaurant name:', currentRestaurantName);

        // Send restaurant name to background script for dashboard updates
        console.log('[AutoZomato] Sending restaurant name to background:', currentRestaurantName);
        chrome.runtime.sendMessage({
            action: 'updateRestaurantName',
            restaurantName: currentRestaurantName,
            url: window.location.href
        });

        // Send initial processing started message
        console.log('[AutoZomato] Sending processing started message to background');
        chrome.runtime.sendMessage({
            action: 'updateTabProgress',
            url: window.location.href,
            restaurantName: currentRestaurantName,
            progress: { current: 0, total: 0 },
            status: 'starting'
        });

        // Click Unanswered tab and get counts
        console.log('[AutoZomato] Clicking Unanswered tab and extracting counts...');
        const counts = await clickUnansweredTabAndExtractCounts();
        const unansweredCount = counts.unansweredReviews;
        console.log(`[AutoZomato] Unanswered reviews count: ${unansweredCount}`);

        // Send initial progress to background script
        chrome.runtime.sendMessage({
            action: 'updateTabProgress',
            url: window.location.href,
            restaurantName: currentRestaurantName,
            progress: { current: 0, total: unansweredCount },
            status: 'processing'
        });

        let repliesGenerated = 0;
        createOrUpdateIndicator(`🤖 ${currentRestaurantName} | ${repliesGenerated} / ${unansweredCount} Replies`);

        const onReplySuccess = () => {
            repliesGenerated++;
            createOrUpdateIndicator(`🤖 ${currentRestaurantName} | ${repliesGenerated} / ${unansweredCount} Replies`);
            
            // Send progress update to background script
            console.log(`[AutoZomato] Sending progress update: ${repliesGenerated}/${unansweredCount} for ${currentRestaurantName}`);
            chrome.runtime.sendMessage({
                action: 'updateTabProgress',
                url: window.location.href,
                restaurantName: currentRestaurantName,
                progress: { current: repliesGenerated, total: unansweredCount },
                status: 'processing'
            });
        };

        // Additional wait for dynamic content
        console.log('[AutoZomato] Waiting for dynamic content...');
        await new Promise(function(resolve) { setTimeout(resolve, 2000); });

        // First, scrape and reply to all currently visible reviews
        console.log('[AutoZomato] Processing initially visible reviews...');
        let reviews = await scrapeReviews();
        await replyToReviews(reviews, promptContext, onReplySuccess);

        let totalProcessedCount = reviews.length;
        let loadMoreFailures = 0;
        const MAX_LOAD_MORE_FAILURES = 3;

        // If there are still unanswered reviews, attempt to load more
        while (unansweredCount !== null && totalProcessedCount < unansweredCount && loadMoreFailures < MAX_LOAD_MORE_FAILURES) {
            console.log(`[AutoZomato] Processed ${totalProcessedCount}/${unansweredCount}. Attempting to load more...`);
            
            const currentReviewCount = (await scrapeReviews()).length;
            const newReviewCount = await loadMoreAndCheck(currentReviewCount);

            if (newReviewCount > currentReviewCount) {
                // Successfully loaded more reviews
                loadMoreFailures = 0; // Reset failure count
                const allReviews = await scrapeReviews();
                const newReviews = allReviews.slice(currentReviewCount); // Process only the new ones
                
                console.log(`[AutoZomato] Found ${newReviews.length} new reviews after loading more.`);
                await replyToReviews(newReviews, promptContext, onReplySuccess);
                totalProcessedCount += newReviews.length;
            } else {
                // Failed to load new reviews
                loadMoreFailures++;
                console.log(`[AutoZomato] Load more did not yield new reviews. Failure attempt ${loadMoreFailures}/${MAX_LOAD_MORE_FAILURES}.`);
            }
        }

        if (loadMoreFailures >= MAX_LOAD_MORE_FAILURES) {
            console.log('[AutoZomato] Stopping processing after 3 consecutive failed attempts to load more reviews.');
        }

        // Update indicator on completion
        createOrUpdateIndicator(`✅ ${currentRestaurantName} | ${repliesGenerated} / ${unansweredCount} Replies`, '#48bb78');

        // Send final progress update to background script
        chrome.runtime.sendMessage({
            action: 'updateTabProgress',
            url: window.location.href,
            restaurantName: currentRestaurantName,
            progress: { current: repliesGenerated, total: unansweredCount },
            status: 'completed'
        });

        // Prepare results only for reviews that were actually processed (have entries in processedReviewsLog)
        const results = [];
        for (const logEntry of processedReviewsLog) {
            results.push({
                url: window.location.href,
                reviewId: logEntry.reviewId,
                reviewText: logEntry.reviewText,
                reply: logEntry.reply || '',
                success: logEntry.replied || false
            });
        }

        // Send results back to background script
        console.log('[AutoZomato] Sending results to background (only processed reviews):', results);
        chrome.runtime.sendMessage({
            action: 'tabCompleted',
            data: {
                results: results,
                reviewCount: processedReviewsLog.length, // Count of actually processed reviews
                repliesCount: results.filter(function(r) { return r.success; }).length,
                totalReviews: undefined,
                detailedReviewLog: processedReviewsLog, // Send the detailed log data
                restaurantName: currentRestaurantName // Add restaurant name to completion data
            }
        });
    } catch (error) {
        console.error('[AutoZomato] Error during processing:', error);
        showAutoZomatoError(error);
        chrome.runtime.sendMessage({
            action: 'tabError',
            error: error && error.stack ? error.stack : (error && error.message ? error.message : String(error))
        });
    }
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
    // Click the 'Unanswered' tab if present
    const unansweredTab = document.getElementById('li_unanswered');
    if (unansweredTab) {
        unansweredTab.click();
        console.log('[AutoZomato] Clicked Unanswered tab');
        // Wait for content to update
        await new Promise(function(resolve) { setTimeout(resolve, 1500); });
    } else {
        console.warn('[AutoZomato] Unanswered tab not found');
    }
    // Extract counts from overview
    let totalReviews = null;
    let unansweredReviews = null;
    const totalNode = document.querySelector('.all-reviews-count');
    const unansweredNode = document.querySelector('.unanswered-reviews-count');
    if (totalNode) totalReviews = parseInt(totalNode.textContent.replace(/\D/g, ''));
    if (unansweredNode) unansweredReviews = parseInt(unansweredNode.textContent.replace(/\D/g, ''));
    console.log('[AutoZomato] Overview counts:', { totalReviews, unansweredReviews });
    return { totalReviews, unansweredReviews };
}

async function loadAllReviews() {
    let loadMoreBtn;
    let tries = 0;
    while ((loadMoreBtn = document.querySelector('section.load-more, section.zs-load-more, section.btn.load-more')) && loadMoreBtn.offsetParent !== null && tries < 20) {
        console.log('[AutoZomato] Clicking Load more...');
        loadMoreBtn.click();
        await new Promise(function(resolve) { setTimeout(resolve, 1500); });
        tries++;
    }
    if (tries > 0) {
        console.log('[AutoZomato] All reviews loaded after', tries, 'clicks');
    }
}

async function loadMoreAndCheck(prevCount) {
    const loadMoreBtn = document.querySelector('section.load-more, section.zs-load-more, section.btn.load-more');
    if (loadMoreBtn && loadMoreBtn.offsetParent !== null) {
        loadMoreBtn.click();
        await new Promise(function(resolve) { setTimeout(resolve, 1500); });
    }
    const reviewBlocks = document.querySelectorAll('.res-review');
    return reviewBlocks.length;
}

async function scrapeReviews() {
    console.log('[AutoZomato] Scraping reviews from the page...');
    const reviews = [];
    const reviewElements = document.querySelectorAll('.res-review');

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

            // Find the reply textarea and submit button to confirm it's a review that can be replied to
            const replyTextarea = el.querySelector('textarea');
            const submitButton = el.querySelector('.zblack');

            if (reviewId && replyTextarea) { // Check for reviewId and a textarea to reply
                console.log(`[AutoZomato Content] Scraped review with ID: ${reviewId}, customer: ${customerName}`);
                reviews.push({
                    reviewId,
                    customerName,
                    rating,
                    reviewText,
                    element: el,
                    replyTextarea: replyTextarea,
                    submitButton: submitButton
                });
            } else {
                console.log(`[AutoZomato Content] Skipped review - reviewId: ${reviewId}, hasTextarea: ${!!replyTextarea}`);
            }
        } catch (error) {
            console.error(`[AutoZomato] Error scraping a review:`, error);
        }
    });

    console.log(`[AutoZomato] Found ${reviews.length} reviews to reply to.`);
    return reviews;
}

async function replyToReviews(reviews, promptContext, onReplySuccess) {
    // Get configuration from global window object
    const config = window.autoZomatoConfig || {};
    
    // Load the response bank from the extension's files
    const responseBankUrl = chrome.runtime.getURL('response_bank.json');
    const response = await fetch(responseBankUrl);
    const responseBank = await response.json();

    // Filter out reviews that have already been processed
    const processedReviewIds = processedReviewsLog.map(log => log.reviewId);
    const unprocessedReviews = reviews.filter(review => !processedReviewIds.includes(review.reviewId));
    
    if (unprocessedReviews.length !== reviews.length) {
        console.log(`[AutoZomato] Skipping ${reviews.length - unprocessedReviews.length} already processed reviews out of ${reviews.length} total`);
        console.log(`[AutoZomato] Processing ${unprocessedReviews.length} new reviews`);
    } else {
        console.log(`[AutoZomato] Processing ${unprocessedReviews.length} reviews (all new)`);
    }

    for (const review of unprocessedReviews) {
        try {
            console.log(`[AutoZomato] Analyzing review:`, review);

            // Route to appropriate processing function based on mode
            console.log(`[AutoZomato] Checking GPT mode configuration:`, {
                config: config,
                hasGptMode: !!config.gptMode,
                gptModeEnabled: config.gptMode?.enabled,
                hasApiKey: !!config.gptMode?.apiKey,
                fullGptConfig: config.gptMode
            });
            
            if (config && config.gptMode && config.gptMode.enabled && config.gptMode.apiKey) {
                console.log(`[AutoZomato] Using GPT mode processing`);
                await processReviewWithGPTMode(review, config, onReplySuccess);
            } else {
                console.log(`[AutoZomato] Using Ollama mode processing - reasons:`, {
                    noConfig: !config,
                    noGptMode: !config?.gptMode,
                    notEnabled: !config?.gptMode?.enabled,
                    noApiKey: !config?.gptMode?.apiKey
                });
                await processReviewWithOllamaMode(review, config, promptContext, responseBank, onReplySuccess);
            }

        } catch (error) {
            console.error('[AutoZomato] Error processing review:', error);
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
        
        // Update the processedReviewsLog
        const logEntry = processedReviewsLog.find(log => log.reviewId === reviewId);
        if (logEntry) {
            logEntry.reply = newReply;
        }
        
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
    
    // Update the processedReviewsLog
    const logEntry = processedReviewsLog.find(log => log.reviewId === reviewId);
    if (logEntry) {
        logEntry.includeInAutoReply = checkbox.checked;
        console.log(`[AutoZomato] Updated includeInAutoReply for review ${reviewId} to ${checkbox.checked}`);
        
        // Update the header summary
        updateLogPopupHeader();
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
        const responseBank = await response.json();
        
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

        if (!replyTemplate) {
            replyTemplate = 'Thank you for your review! We appreciate your feedback.';
            selectedCategory = 'Default';
        }

        // Step 3: Personalize reply using GPT-extracted name
        let finalReply = replyTemplate;
        
        if (gptResult.firstName) {
            finalReply = finalReply.replace(/{CustomerName}/g, gptResult.firstName);
        } else {
            const extractedName = extractFirstName(review.customerName);
            if (extractedName && extractedName.length > 1 && !extractedName.match(/\d/)) {
                finalReply = finalReply.replace(/{CustomerName}/g, extractedName);
            } else {
                finalReply = finalReply.replace(/{CustomerName}/g, getRandomNeutralGreeting());
            }
        }
        
        finalReply = finalReply.replace(/,?\s?{CustomerName}/g, '');
        finalReply = finalReply.replace(/{LocationName}/g, review.locationName || '');
        finalReply = finalReply.replace(/\s+/g, ' ').trim();

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
            restaurantName: currentRestaurantName
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
        
        // Log the review for popup display
        const reviewLogEntry = {
            reviewId: review.reviewId,
            customerName: review.customerName,
            extractedName: gptResult.firstName || 'N/A',
            reviewText: review.reviewText || '',
            rating: review.rating || 'N/A',
            sentiment: gptResult.sentiment || 'Unknown',
            complaintId: gptResult.complaintId || 'None',
            confidence: 1.0, // GPT results are considered high confidence
            selectedCategory: selectedCategory,
            reply: finalReply,
            replied: false,
            includeInAutoReply: true,
            restaurantName: currentRestaurantName
        };
        
        processedReviewsLog.push(reviewLogEntry);
        
        // Update counter
        onReplySuccess();
        
        // Post reply if auto-reply is enabled
        if (config.autoReply && finalReply) {
            await postReply(review, finalReply, config);
            reviewLogEntry.replied = true;
        }
        
        // Update log popup if open
        if (document.getElementById('autozomato-log-popup')) {
            renderLogPopupContent();
        }
        
    } catch (error) {
        console.error('[AutoZomato] Error in GPT mode processing:', error);
    }
}

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
3 = Spilled food ("spilled", "leaked", "broken container")
4 = Wrong spice level ("too spicy", "not spicy", "instructions ignored")
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
        finalReply = finalReply.replace(/{LocationName}/g, review.locationName || '');
        finalReply = finalReply.replace(/\s+/g, ' ').trim();

        // Step 5: Insert reply and post if auto-reply enabled
        const textarea = review.replyTextarea;
        const publishBtn = review.submitButton;
        let repliedStatus = false;

        if (textarea) {
            textarea.value = finalReply;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            
            onReplySuccess();

            if (config.autoReply && publishBtn) {
                publishBtn.click();
                repliedStatus = true;
            }
        }

        // Step 6: Log the results
        const reviewLogEntry = {
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
            replied: repliedStatus,
            includeInAutoReply: true,
            restaurantName: currentRestaurantName
        };
        
        processedReviewsLog.push(reviewLogEntry);
        
        // Send real-time review data to background
        chrome.runtime.sendMessage({
            action: 'reviewProcessed',
            reviewData: reviewLogEntry
        });

        // Update log popup if open
        if (document.getElementById('autozomato-log-popup')) {
            renderLogPopupContent();
        }
        
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
            publishBtn.click();
            console.log(`[AutoZomato] Posted reply for review ${review.reviewId}`);
        }
    } catch (error) {
        console.error('[AutoZomato] Error posting reply:', error);
    }
}

// GPT Single-Prompt Review Processing - ANALYSIS ONLY, NO REPLY GENERATION
async function processReviewWithGPT(review, config) {
    const gptPrompt = `You are an AI assistant for a restaurant review management system. Analyze this customer review and extract the following information in a single response.

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
   - "1" = Incorrect Orders Received (wrong item delivered)
   - "2" = Delivery Delays by Zomato (late delivery)
   - "3" = Spill/Packaging Issues (food spilled, container broke)
   - "4" = Cooking Instructions Not Followed (spice level, special requests ignored)
   - "5" = Zomato Delivery-Related Issues (delivery person problems)
   - "6" = Missing Cutlery (no spoon, fork, utensils)
   - "7" = Rude Staff (restaurant staff behavior)
   - "8" = Missing Item in Order (incomplete order)
   - "9" = Food Safety – Foreign Materials (hair, plastic in food)
   - Return null if no specific complaint is detected
   - Be STRICT - general dissatisfaction like "food was bad" should NOT get a complaint ID

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

// Helper function for fallback name extraction
function extractFirstNameFallback(customerName) {
    if (!customerName || customerName.length < 2) return null;
    
    // Simple heuristics for name extraction
    const name = customerName.trim();
    
    // If it looks like a real name (contains space)
    if (name.includes(' ')) {
        return name.split(' ')[0];
    }
    
    // If it's a single word, check if it looks like a real name
    if (name.length >= 3 && /^[A-Za-z]+$/.test(name) && 
        !['user', 'customer', 'foodie', 'lover'].some(generic => 
            name.toLowerCase().includes(generic))) {
        return name;
    }
    
    return null;
}

// AI Request Handler - supports both Ollama and GPT modes
async function makeAIRequest(prompt, config) {
    console.log('[AutoZomato] Making AI request with detailed config analysis:', {
        configExists: !!config,
        gptModeExists: !!config?.gptMode,
        gptModeEnabled: config?.gptMode?.enabled,
        hasApiKey: !!config?.gptMode?.apiKey,
        apiKeyLength: config?.gptMode?.apiKey?.length || 0,
        apiKeyValue: config?.gptMode?.apiKey ? `${config.gptMode.apiKey.substring(0, 10)}...` : 'null',
        isPlaceholder: config?.gptMode?.apiKey === 'YOUR_OPENAI_API_KEY_HERE',
        fullConfig: config
    });
    
    // Check if GPT mode is enabled with valid API key
    const hasValidApiKey = config?.gptMode?.apiKey && 
                          config.gptMode.apiKey.trim() !== '' && 
                          config.gptMode.apiKey !== 'YOUR_OPENAI_API_KEY_HERE' &&
                          config.gptMode.apiKey.length > 10;
    
    if (config && config.gptMode && config.gptMode.enabled && hasValidApiKey) {
        console.log('[AutoZomato] ✓ Using GPT mode:', config.gptMode.model);
        return await makeGPTRequest(prompt, config.gptMode);
    } else {
        const failureReasons = [];
        if (!config) failureReasons.push('no config');
        if (!config?.gptMode) failureReasons.push('no GPT mode config');
        if (!config?.gptMode?.enabled) failureReasons.push('GPT mode disabled');
        if (!hasValidApiKey) failureReasons.push('invalid/missing API key');
        
        console.log('[AutoZomato] ✗ Using Ollama mode - GPT conditions failed:', failureReasons.join(', '));
        console.log('[AutoZomato] → Additional debug info:', {
            hasConfig: !!config,
            hasGptMode: !!config?.gptMode,
            isEnabled: config?.gptMode?.enabled,
            hasApiKey: !!config?.gptMode?.apiKey,
            hasValidApiKey: hasValidApiKey
        });
        return await makeOllamaRequest(prompt, config);
    }
}

// GPT API Request
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
                max_tokens: 300, // Increased for longer replies
                temperature: 0.7
            })
        });

        if (!response.ok) {
            throw new Error(`GPT API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        return {
            response: result.choices[0].message.content.trim(),
            success: true
        };
    } catch (error) {
        console.error('[AutoZomato] GPT request failed:', error);
        throw error;
    }
}

// Ollama API Request (existing functionality)
async function makeOllamaRequest(prompt, config) {
    const model = (config && config.promptContext && config.promptContext.model) || 'tinyllama';
    
    const requestBody = {
        model: model,
        prompt: prompt,
        stream: false,
        format: 'json',  // Force JSON output
        options: {
            temperature: 0.1,  // Lower temperature for more consistent JSON
            num_predict: 100,  // Use num_predict instead of max_tokens for Ollama
            top_p: 0.9,
            repeat_penalty: 1.1,
            stop: ["\n\n", "```", "---", "EXAMPLES", "**", "Now analyze"]  // Better stop tokens
        }
    };

    try {
        const response = await fetch('http://localhost:3000/ollama/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        return {
            response: result.response,
            success: true
        };
    } catch (error) {
        console.error('[AutoZomato] Ollama request failed:', error);
        throw error;
    }
}

// Auto-detection of page type
function detectPageType() {
    const url = window.location.href;

    if (url.includes('/reviews') || document.querySelector('.res-review, [data-testid="review-card"]')) {
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

function renderLogPopupContent() {
    const popup = document.getElementById('autozomato-log-popup');
    if (!popup) return;

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
                <th style="padding: 6px; text-align: center; border-bottom: 1px solid #eee; width: 70px;">Sentiment</th>
                <th style="padding: 6px; text-align: center; border-bottom: 1px solid #eee; width: 60px;">Name Conf.</th>
                <th style="padding: 6px; text-align: left; border-bottom: 1px solid #eee;">Reply (Editable)</th>
                <th style="padding: 6px; text-align: center; border-bottom: 1px solid #eee; width: 60px;">Status</th>
            </tr>
        </thead>
    `;

    const tbody = document.createElement('tbody');
    if (processedReviewsLog.length === 0) {
        const pageType = detectPageType();
        const isReviewsPage = pageType === 'reviews' || pageType === 'restaurant';
        const emptyMessage = isReviewsPage 
            ? 'No reviews processed yet. Wait for AutoZomato to process reviews, or click the indicator to start processing.'
            : 'No reviews processed yet. Navigate to a restaurant review page to see processed reviews here.';
        
        tbody.innerHTML = `<tr><td colspan="6" style="padding: 20px; text-align: center; color: #888; line-height: 1.4;">${emptyMessage}</td></tr>`;
    } else {
        processedReviewsLog.forEach(log => {
            const row = document.createElement('tr');
            row.setAttribute('data-review-id', log.reviewId);

            const isEditable = !log.replied;
            const replyCellContent = isEditable
                ? `<div class="editable-reply" contenteditable="true" style="padding: 4px; border-radius: 3px; border: 1px dashed #ccc; font-size: 11px;">${log.reply}</div>`
                : `<div style="padding: 4px; font-size: 11px;">${log.reply}</div>`;

            // Create checkbox - disabled if already replied
            const checkboxDisabled = log.replied ? 'disabled' : '';
            const checkboxChecked = log.includeInAutoReply ? 'checked' : '';
            
            // Sentiment color coding
            const sentimentColor = log.sentiment === 'Positive' ? '#48bb78' : 
                                 log.sentiment === 'Negative' ? '#e53e3e' : '#4299e1';
            
            // Name confidence formatting
            const nameConfidence = Math.round((log.confidence || 0) * 100);
            const nameConfColor = nameConfidence > 70 ? '#48bb78' : 
                                 nameConfidence > 50 ? '#ed8936' : '#e53e3e';

            row.innerHTML = `
                <td style="padding: 6px; border-bottom: 1px solid #eee; text-align: center; vertical-align: top;">
                    <input type="checkbox" class="include-checkbox" ${checkboxChecked} ${checkboxDisabled} 
                           title="${log.replied ? 'Already replied' : 'Include in auto-reply'}" 
                           style="transform: scale(1.1);">
                </td>
                <td style="padding: 6px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 11px;">
                    <strong>${log.extractedName}</strong><br>
                    <span style="color: #777; font-size: 10px;">${log.customerName}</span><br>
                    <span style="color: #666; font-size: 10px;">${log.selectedCategory || 'Unknown'}</span>
                </td>
                <td style="padding: 6px; border-bottom: 1px solid #eee; text-align: center; vertical-align: top;">
                    <span style="color: ${sentimentColor}; font-weight: bold; font-size: 10px;">${log.sentiment || 'Unknown'}</span>
                </td>
                <td style="padding: 6px; border-bottom: 1px solid #eee; text-align: center; vertical-align: top;">
                    <span style="color: ${nameConfColor}; font-weight: bold; font-size: 10px;">${nameConfidence}%</span>
                </td>
                <td style="padding: 6px; border-bottom: 1px solid #eee; white-space: pre-wrap; word-break: break-word; vertical-align: top;">
                    ${replyCellContent}
                </td>
                <td class="reply-status" style="padding: 6px; border-bottom: 1px solid #eee; text-align: center; font-size: 14px; vertical-align: top;">${log.replied ? '✅' : '❌'}</td>
            `;
            tbody.appendChild(row);
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

    const totalReviews = processedReviewsLog.length;
    const selectedForReply = processedReviewsLog.filter(log => !log.replied && log.includeInAutoReply).length;
    const alreadyReplied = processedReviewsLog.filter(log => log.replied).length;
    const unselectedReviews = processedReviewsLog.filter(log => !log.replied && !log.includeInAutoReply).length;

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
    header.appendChild(closeBtn);

    popup.appendChild(header);
    document.body.appendChild(popup);

    // Initial render of the content
    renderLogPopupContent();
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

async function handleReplyToAll() {
    console.log('[AutoZomato] Starting Reply to All...');
    const logsToReply = processedReviewsLog.filter(log => !log.replied && log.includeInAutoReply);

    if (logsToReply.length === 0) {
        console.log('[AutoZomato] No reviews selected for auto-reply.');
        return;
    }

    console.log(`[AutoZomato] Found ${logsToReply.length} reviews to reply to.`);

    for (const log of logsToReply) {
        const reviewElement = document.querySelector(`.res-review[data-review_id="${log.reviewId}"]`);
        if (reviewElement) {
            const publishBtn = reviewElement.querySelector('.zblack');
            if (publishBtn) {
                console.log(`[AutoZomato] Clicking publish for review ${log.reviewId}`);
                publishBtn.click();
                log.replied = true; // Update the log status

                // Update the status icon and disable editing in the popup in real-time
                const row = document.querySelector(`#autozomato-log-popup tr[data-review-id="${log.reviewId}"]`);
                if (row) {
                    const statusCell = row.querySelector('.reply-status');
                    if (statusCell) {
                        statusCell.innerHTML = '✅';
                    }
                    const replyDiv = row.querySelector('.editable-reply');
                    if (replyDiv) {
                        replyDiv.setAttribute('contenteditable', 'false');
                        replyDiv.style.border = 'none';
                        replyDiv.classList.remove('editable-reply');
                    }
                    // Disable the checkbox and update its title
                    const checkbox = row.querySelector('.include-checkbox');
                    if (checkbox) {
                        checkbox.disabled = true;
                        checkbox.title = 'Already replied';
                    }
                }

                // Update the header summary
                updateLogPopupHeader();

                await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms between clicks
            } else {
                console.warn(`[AutoZomato] Could not find publish button for review ${log.reviewId} during Reply to All.`);
            }
        } else {
            console.warn(`[AutoZomato] Could not find review element for review ${log.reviewId} during Reply to All.`);
        }
    }

    console.log('[AutoZomato] Reply to All finished.');
}
