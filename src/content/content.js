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
let processedReviewsLog = [];

// Listen for initialization message from background script
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'startProcessing') {
        const promptContext = message.promptContext || {};
        startProcessing(promptContext);
        sendResponse({ success: true });
    }
});

async function startProcessing(promptContext) {
    try {
        console.log('[AutoZomato] Starting review processing on:', window.location.href);

        // Wait for page to fully load
        if (document.readyState !== 'complete') {
            console.log('[AutoZomato] Waiting for page to load...');
            await new Promise(function(resolve) {
                window.addEventListener('load', resolve, { once: true });
            });
            console.log('[AutoZomato] Page loaded.');
        }

        // Click Unanswered tab and get counts
        console.log('[AutoZomato] Clicking Unanswered tab and extracting counts...');
        const counts = await clickUnansweredTabAndExtractCounts();
        const unansweredCount = counts.unansweredReviews;
        console.log(`[AutoZomato] Unanswered reviews count: ${unansweredCount}`);

        let repliesGenerated = 0;
        createOrUpdateIndicator(`🤖 AutoZomato | ${repliesGenerated} / ${unansweredCount} Replies`);

        const onReplySuccess = () => {
            repliesGenerated++;
            createOrUpdateIndicator(`🤖 AutoZomato | ${repliesGenerated} / ${unansweredCount} Replies`);
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
        createOrUpdateIndicator(`✅ AutoZomato | ${repliesGenerated} / ${unansweredCount} Replies`, '#48bb78');

        // Collect all reviews again for final reporting
        const finalReviews = await scrapeReviews();
        // Prepare results for each review
        const results = [];
        for (const review of finalReviews) {
            results.push({
                url: window.location.href,
                reviewId: review.reviewId,
                reviewText: review.reviewText,
                reply: review.reply || '',
                success: true
            });
        }

        // Send results back to background script
        console.log('[AutoZomato] Sending results to background:', results);
        chrome.runtime.sendMessage({
            action: 'tabCompleted',
            data: {
                results: results,
                reviewCount: finalReviews.length,
                repliesCount: results.filter(function(r) { return r.success; }).length,
                totalReviews: undefined,
                detailedReviewLog: processedReviewsLog // Send the detailed log data
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
                reviews.push({
                    reviewId,
                    customerName,
                    rating,
                    reviewText,
                    element: el,
                    replyTextarea: replyTextarea,
                    submitButton: submitButton
                });
            }
        } catch (error) {
            console.error(`[AutoZomato] Error scraping a review:`, error);
        }
    });

    console.log(`[AutoZomato] Found ${reviews.length} reviews to reply to.`);
    return reviews;
}

async function replyToReviews(reviews, promptContext, onReplySuccess) {
    // Load the response bank from the extension's files
    const responseBankUrl = chrome.runtime.getURL('response_bank.json');
    const response = await fetch(responseBankUrl);
    const responseBank = await response.json();

    for (const review of reviews) {
        try {
            console.log(`[AutoZomato] Analyzing review:`, review);

            const model = promptContext.model || 'tinyllama';

            // Step 1: Use AI to classify the review and get a complaint ID and real name flag
            const analysisPrompt = `You are a review analysis expert. Your task is to analyze a customer review and return a JSON object with two fields: "isRealName" and "complaintId".

- "isRealName": A boolean. Set to true ONLY if the customer name is a plausible human name (e.g., "John Doe", "Priya S","Ramu"). Set to false if it is a generic, contains numbers, or is a initial (e.g.,"FD" "foodlover88", "A","678896").
- "complaintId": A string. If the review text clearly matches one of the complaint story names, return the corresponding complaint ID string (e.g., "1", "2"). If you are not confident, or if there is no specific complaint, return null.

Here are the complaints to look for:
${JSON.stringify(responseBank.complaints.map(c => ({ id: c.id, storyName: c.storyName })), null, 2)}

Analyze this review:
- Customer Name: "${review.customerName}"
- Review Text: "${review.reviewText}"

Return ONLY the JSON object.`;

            const analysisBody = {
                model: model,
                prompt: analysisPrompt,
                stream: false,
                format: 'json' // Request JSON output from Ollama
            };

            const analysisResponse = await fetch('http://localhost:3000/ollama/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(analysisBody)
            });

            if (!analysisResponse.ok) {
                throw new Error(`Ollama analysis API error: ${analysisResponse.status}`);
            }

            const analysisResult = await analysisResponse.json();
            // The actual JSON content is often in the 'response' field and needs to be parsed again
            const classification = JSON.parse(analysisResult.response);
            const { isRealName, complaintId } = classification;

            console.log(`[AutoZomato] AI Classification:`, classification);

            let replyTemplate = '';

            // Step 2: Select response template
            if (complaintId && responseBank.complaints.some(c => c.id === complaintId)) {
                // A valid complaint was detected
                const complaint = responseBank.complaints.find(c => c.id === complaintId);
                const options = complaint.responses;
                replyTemplate = options[Math.floor(Math.random() * options.length)];
                console.log(`[AutoZomato] Selected response from complaint: "${complaint.storyName}"`);
            } else {
                // No complaint detected, use star rating
                const rating = Math.floor(review.rating);
                const category = responseBank.categories.find(c => c.storyName.startsWith(String(rating)));
                
                if (category) {
                    const subCategoryKey = review.reviewText.trim() ? 'Written Review' : 'No Written Review';
                    const options = category.responses[subCategoryKey];
                    if (options) {
                        replyTemplate = options[Math.floor(Math.random() * options.length)];
                        console.log(`[AutoZomato] Selected response from category: "${category.storyName}" -> "${subCategoryKey}"`);
                    }
                }
            }

            if (!replyTemplate) {
                console.warn('[AutoZomato] Could not find a suitable reply template for review:', review.reviewId);
                continue; // Skip to the next review
            }

            // Step 3: Personalize the response
            let finalReply = replyTemplate;
            if (isRealName) {
                const firstName = extractFirstName(review.customerName);
                if (firstName) {
                    finalReply = finalReply.replace(/{CustomerName}/g, firstName);
                } else {
                    // Fallback if extraction fails even if name is real
                    finalReply = finalReply.replace(/,?\s?{CustomerName}/g, '');
                }
            } else {
                // If the name is not real, remove the placeholder.
                finalReply = finalReply.replace(/,?\s?{CustomerName}/g, '');
            }

            // Replace location placeholder
            finalReply = finalReply.replace(/{LocationName}/g, review.locationName);

            console.log(`[AutoZomato] Generated reply for ${review.reviewId}:`, finalReply);

            // Step 4: Insert the reply into the page
            const textarea = review.replyTextarea;
            const publishBtn = review.submitButton;

            let repliedStatus = false;
            if (textarea) {
                textarea.value = finalReply;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('[AutoZomato] Inserted reply for', review.reviewId);

                // Report success to update the counter
                onReplySuccess();

                // Check the config passed from the background script to see if we should auto-click
                if (window.autoZomatoConfig && window.autoZomatoConfig.autoReply) {
                    if (publishBtn) {
                        console.log(`[AutoZomato] Auto-reply enabled. Clicking publish for review ${review.reviewId}.`);
                        publishBtn.click();
                        repliedStatus = true;
                    } else {
                        console.warn(`[AutoZomato] Auto-reply enabled, but no publish button found for review ${review.reviewId}.`);
                    }
                }
            } else {
                console.warn('[AutoZomato] Could not find reply textarea for', review.reviewId);
            }

            // Log the details for the popup
            processedReviewsLog.push({
                reviewId: review.reviewId, // Add reviewId for later use
                customerName: review.customerName,
                extractedName: isRealName ? extractFirstName(review.customerName) : 'N/A',
                reviewText: review.reviewText || '', // Add the review text for export
                rating: review.rating || 'N/A', // Add the rating for export
                complaintId: complaintId || 'None', // Add the complaint ID for export
                reply: finalReply,
                replied: repliedStatus,
                includeInAutoReply: true // Default to true - user can uncheck to exclude
            });

            // If the log popup is open, refresh its content
            if (document.getElementById('autozomato-log-popup')) {
                renderLogPopupContent();
            }

        } catch (error) {
            console.error('[AutoZomato] Error generating reply:', error);
        }
    }
}

function extractFirstName(fullName) {
    const firstName = fullName.split(' ')[0];
    return firstName || fullName;
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
    // The config is now set on the window object by the background script before this script is executed.
    const config = window.autoZomatoConfig || {};
    console.log('[AutoZomato] Initializing with config:', config);

    const pageType = detectPageType();
    console.log('[AutoZomato] initialize() called. Page type:', pageType, 'URL:', window.location.href);

    // Add visual indicator that extension is active
    if (pageType === 'reviews' || pageType === 'restaurant') {
        createOrUpdateIndicator('🤖 AutoZomato Initializing...');
        // Auto-start review processing if not already started
        if (typeof window.__autozomatoStarted === 'undefined') {
            window.__autozomatoStarted = true;
            console.log('[AutoZomato] Auto-starting review processing from initialize()');
            // Pass the config to the processing function
            startProcessing(config);
        }
    }
}

function createOrUpdateIndicator(text, color = '#667eea') {
    let indicator = document.getElementById('autozomato-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'autozomato-indicator';
        indicator.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: #667eea; /* default color */
            color: white;
            padding: 5px 10px;
            border-radius: 5px;
            font-size: 12px;
            z-index: 10000;
            font-family: Arial, sans-serif;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            transition: background-color 0.5s ease;
            cursor: pointer; /* Add cursor pointer */
        `;
        document.body.appendChild(indicator);
        indicator.addEventListener('click', showLogPopup);
    }
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
                <th style="padding: 8px; text-align: center; border-bottom: 1px solid #eee; width: 60px;">Include</th>
                <th style="padding: 8px; text-align: left; border-bottom: 1px solid #eee;">Username</th>
                <th style="padding: 8px; text-align: left; border-bottom: 1px solid #eee;">Reply (Editable)</th>
                <th style="padding: 8px; text-align: center; border-bottom: 1px solid #eee;">Replied</th>
            </tr>
        </thead>
    `;

    const tbody = document.createElement('tbody');
    if (processedReviewsLog.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="padding: 15px; text-align: center; color: #888;">No reviews processed yet.</td></tr>';
    } else {
        processedReviewsLog.forEach(log => {
            const row = document.createElement('tr');
            row.setAttribute('data-review-id', log.reviewId);

            const isEditable = !log.replied;
            const replyCellContent = isEditable
                ? `<div class="editable-reply" contenteditable="true" style="padding: 5px; border-radius: 3px; border: 1px dashed #ccc;">${log.reply}</div>`
                : `<div style="padding: 5px;">${log.reply}</div>`;

            // Create checkbox - disabled if already replied
            const checkboxDisabled = log.replied ? 'disabled' : '';
            const checkboxChecked = log.includeInAutoReply ? 'checked' : '';

            row.innerHTML = `
                <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center; vertical-align: top;">
                    <input type="checkbox" class="include-checkbox" ${checkboxChecked} ${checkboxDisabled} 
                           title="${log.replied ? 'Already replied' : 'Include in auto-reply'}" 
                           style="transform: scale(1.2);">
                </td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; vertical-align: top;">
                    <strong>${log.extractedName}</strong><br>
                    <span style="color: #777;">(${log.customerName})</span>
                </td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; white-space: pre-wrap; word-break: break-word;">
                    ${replyCellContent}
                </td>
                <td class="reply-status" style="padding: 8px; border-bottom: 1px solid #eee; text-align: center; font-size: 16px; vertical-align: top;">${log.replied ? '✅' : '❌'}</td>
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
    // Toggle behavior: remove if exists, otherwise create
    const existingPopup = document.getElementById('autozomato-log-popup');
    if (existingPopup) {
        existingPopup.remove();
        return;
    }

    // Create popup container
    const popup = document.createElement('div');
    popup.id = 'autozomato-log-popup';
    popup.style.cssText = `
        position: fixed;
        top: 35px;
        right: 10px;
        width: 450px;
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
