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
    console.log('- window.location.href:', window.location.href);
    console.log('- indicator element:', document.getElementById('autozomato-indicator'));
    console.log('- popup element:', document.getElementById('autozomato-log-popup'));
};

// Listen for initialization message from background script
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'startProcessing') {
        console.log('[AutoZomato] Received startProcessing message');
        
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
    }
});

async function startProcessing(promptContext) {
    try {
        console.log('[AutoZomato] Starting review processing on:', window.location.href);

        // Check if this is a new URL/page
        const newUrl = window.location.href;
        if (currentSessionUrl !== newUrl) {
            console.log(`[AutoZomato] New page detected. Previous: ${currentSessionUrl}, Current: ${newUrl}`);
            currentSessionUrl = newUrl;
            
            // Clear previous session data for new page
            processedReviewsLog = [];
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

            const model = promptContext.model || 'mistral';

            let firstName = null;
            let confidence = 0;
            
            let nameExtractionPrompt = '';
            if (promptContext.systemPrompt) {
                nameExtractionPrompt = promptContext.systemPrompt + '\n\n';
            }
            
            nameExtractionPrompt += `You are a name extraction expert. Your task is to extract the first name from a given customer name and provide a confidence score.

Follow these rules precisely:
1.  **Extract First Name**:
    *   If the name is a clear real name (e.g., "Rahul Kumar"), extract the first part ("Rahul").
    *   If it's a username with an embedded name (e.g., "rahul123"), extract the name part ("Rahul").
    *   If it's a valid standalone name (e.g., "Zak"), use that.
    *   If the name is generic, nonsensical, or just initials (e.g., "FD", "User123", "FoodLover"), the value MUST be \`null\`.
    *   **CRITICAL**: NEVER invent, guess, or hallucinate a name. Only extract what is present.

2.  **Confidence Score**:
    *   **0.9-1.0**: For clear, real names (e.g., "Rahul Kumar").
    *   **0.7-0.8**: For names clearly extracted from usernames (e.g., "rahul123").
    *   **0.5-0.6**: For plausible standalone names (e.g., "Zak").
    *   **0.0-0.4**: For generic/unclear names where firstName is \`null\`.

**Customer Name to Analyze**: "${review.customerName}"

**Output Format**:
You MUST return ONLY a valid JSON object with two keys: "firstName" (string or null) and "confidence" (number). Do not include any other text, explanations, or markdown.

**Examples**:
*   Customer Name: "Jane Doe" -> \`{"firstName": "Jane", "confidence": 0.95}\`
*   Customer Name: "janes_eats" -> \`{"firstName": "Jane", "confidence": 0.75}\`
*   Customer Name: "S" -> \`{"firstName": null, "confidence": 0.1}\`
*   Customer Name: "Foodie123" -> \`{"firstName": null, "confidence": 0.0}\`

Now, analyze the customer name provided above and return the JSON object.`;

            const nameExtractionBody = {
                model: model,
                prompt: nameExtractionPrompt,
                stream: false,
                format: 'json',
                options: {
                    temperature: 0.1,
                    num_predict: 50
                }
            };

            // --- DEBUG: Log raw AI name extraction response ---
            let rawNameAIResponse = null;
            try {
                const nameResponse = await fetch('http://localhost:3000/ollama/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(nameExtractionBody)
                });

                if (nameResponse.ok) {
                    const nameResult = await nameResponse.json();
                    rawNameAIResponse = nameResult.response;
                    console.log('[AutoZomato][DEBUG] Raw AI Name Extraction Response:', rawNameAIResponse);
                    try {
                        const nameData = cleanAndParseJSON(nameResult.response);
                        firstName = nameData.firstName;
                        confidence = nameData.confidence || 0;
                        // If AI returns 0 for a clear real name, override with fallback
                        if (firstName && confidence === 0) {
                            const extracted = smartExtractFirstName(review.customerName);
                            if (extracted && extracted.name.toLowerCase() === firstName.toLowerCase()) {
                                confidence = extracted.confidence;
                                console.log('[AutoZomato][DEBUG] Overriding AI confidence with fallback:', confidence);
                            }
                        }
                        console.log(`[AutoZomato] AI Name Extraction:`, { firstName, confidence });
                    } catch (parseError) {
                        console.warn(`[AutoZomato] Failed to parse name extraction response:`, parseError);
                        const extracted = smartExtractFirstName(review.customerName);
                        if (extracted) {
                            firstName = extracted.name;
                            confidence = extracted.confidence;
                        }
                    }
                } else {
                    console.warn(`[AutoZomato] Name extraction API error:`, nameResponse.status);
                    const extracted = smartExtractFirstName(review.customerName);
                    if (extracted) {
                        firstName = extracted.name;
                        confidence = extracted.confidence;
                    }
                }
            } catch (nameError) {
                console.warn(`[AutoZomato] Name extraction failed:`, nameError);
                const extracted = smartExtractFirstName(review.customerName);
                if (extracted) {
                    firstName = extracted.name;
                    confidence = extracted.confidence;
                }
            }

            // Step 1b: Second AI Request - Review Analysis (Sentiment + Complaint)
            let reviewAnalysisPrompt = '';
            if (promptContext.systemPrompt) {
                reviewAnalysisPrompt = promptContext.systemPrompt + '\n\n';
            }
            
            reviewAnalysisPrompt += `TASK: Analyze this restaurant review and return JSON with complaint detection and sentiment.

**CRITICAL INSTRUCTION: You MUST be extremely conservative in detecting complaints. Only assign a complaint ID if you find EXACT matches to the specific phrases listed below. If there's ANY doubt, return null.**

REVIEW:
Text: "${review.reviewText || 'No written review provided'}"
Rating: ${review.rating}/5 stars

COMPLAINT CATEGORIES WITH EXACT TRIGGERS:
1. "Incorrect Orders Received" - ONLY if review contains: "wrong order", "different item", "ordered X got Y", "not what I ordered", "incorrect order"
2. "Delivery Delays by Zomato" - ONLY if review contains: "late delivery", "slow delivery", "took hours", "very slow", "delayed", "came late"
3. "Spill Packaging Issues" - ONLY if review contains: "spilled", "leaked", "broken container", "packaging broke", "container damaged"
4. "Cooking Instructions Not Followed" - ONLY if review contains: "too spicy", "not spicy", "asked for mild", "instructions ignored", "special request not followed"
5. "Zomato Delivery-Related Issues" - ONLY if review contains: "delivery person rude", "driver rude", "delivery guy", "courier rude"
6. "Missing Cutlery" - ONLY if review contains: "no spoon", "missing spoon", "no fork", "no cutlery", "no utensils"
7. "Rude Staff" - ONLY if review contains: "staff rude", "restaurant staff rude", "unprofessional staff", "rude behavior"
8. "Missing Item in Order" - ONLY if review contains: "missing item", "incomplete order", "forgot item", "didn't get", "where is my"
9. "Food Safety – Foreign Materials" - ONLY if review contains: "hair in food", "foreign object", "plastic in food", "dirty", "contaminated"

**STRICT RULES:**
- If review text is empty or just rating → complaintId: null
- If review mentions general dissatisfaction without specific issues → complaintId: null
- If review talks about taste, price, ambiance, quantity → complaintId: null
- Words like "average", "okay", "cold food", "expensive" are NOT complaints → complaintId: null
- Only return a complaint ID if you find EXACT phrase matches from the lists above

**DO NOT DETECT COMPLAINTS FOR:**
- General taste opinions: "food was average", "taste was okay", "not tasty"
- Price concerns: "expensive", "overpriced", "costly"
- Quality without specific issues: "cold food", "not fresh", "poor quality"
- Ambiance/atmosphere: "noisy", "crowded", "atmosphere not good"
- Portion size: "small quantity", "less food"
- General dissatisfaction: "disappointed", "not satisfied", "expected better"

SENTIMENT DETECTION:
- "Positive": 4-5 stars OR positive words like "excellent", "great", "amazing", "good"
- "Negative": 1-2 stars OR negative words like "bad", "terrible", "worst", "poor"
- "Neutral": 3 stars OR neutral/mixed words like "average", "okay", "fine"

EXAMPLES OF CORRECT ANALYSIS:
✅ "Ordered chicken but got mutton" → {"complaintId": "1", "sentiment": "Negative"}
✅ "Food took 3 hours to arrive" → {"complaintId": "2", "sentiment": "Negative"}
✅ "No spoon provided with curry" → {"complaintId": "6", "sentiment": "Negative"}
✅ "Found hair in my food" → {"complaintId": "9", "sentiment": "Negative"}

❌ "Food was cold and tasteless" → {"complaintId": null, "sentiment": "Negative"}
❌ "Expensive for the quantity" → {"complaintId": null, "sentiment": "Neutral"}
❌ "Average taste, nothing special" → {"complaintId": null, "sentiment": "Neutral"}
❌ "Restaurant was too noisy" → {"complaintId": null, "sentiment": "Neutral"}
❌ "Food quality was poor" → {"complaintId": null, "sentiment": "Negative"}

**FINAL CHECK:** Before returning any complaint ID, double-check that the review text contains one of the EXACT trigger phrases listed above. If not found, return null.

Return ONLY JSON: {"complaintId": "X", "sentiment": "Y"}`;

            // Add custom context if provided
            if (promptContext.customInstructions) {
                reviewAnalysisPrompt += `\n\nAdditional Context: ${promptContext.customInstructions}`;
            }
            
            if (promptContext.tone) {
                reviewAnalysisPrompt += `\nTone: ${promptContext.tone}`;
            }
            
            if (promptContext.language) {
                reviewAnalysisPrompt += `\nLanguage: ${promptContext.language}`;
            }

            reviewAnalysisPrompt += `\n\nReturn ONLY the JSON object with both fields.`;

            const reviewAnalysisBody = {
                model: model,
                prompt: reviewAnalysisPrompt,
                stream: false,
                format: 'json',
                options: {
                    temperature: 0.1,          // Very low for consistent results
                    top_p: 0.9,               // Focus on most probable tokens
                    top_k: 40,                // Limit vocabulary  
                    num_predict: 50,          // Short response for JSON only
                    repeat_penalty: 1.1,      // Prevent repetition
                    stop: ["\n", "```", "---", "EXAMPLES"] // Stop tokens
                }
            };

            // --- DEBUG: Log raw AI review analysis response ---
            let rawReviewAIResponse = null;
            try {
                const reviewResponse = await fetch('http://localhost:3000/ollama/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(reviewAnalysisBody)
                });

                if (reviewResponse.ok) {
                    const reviewResult = await reviewResponse.json();
                    rawReviewAIResponse = reviewResult.response;
                    console.log('[AutoZomato][DEBUG] Raw AI Review Analysis Response:', rawReviewAIResponse);
                    try {
                        const reviewData = cleanAndParseJSON(reviewResult.response);
                        sentiment = reviewData.sentiment || 'Neutral';
                        complaintId = reviewData.complaintId;
                        
                        // STRICT VALIDATION: Verify complaint detection against actual review text
                        if (complaintId && complaintId !== null) {
                            const reviewText = (review.reviewText || '').toLowerCase();
                            let isValidComplaint = false;
                            
                            // Define exact trigger phrases for each complaint category
                            const complaintTriggers = {
                                '1': ['wrong order', 'different item', 'ordered chicken got mutton', 'ordered veg got non-veg', 'not what i ordered', 'incorrect order'],
                                '2': ['late delivery', 'slow delivery', 'took hours', 'very slow', 'delayed delivery', 'came late', 'took 2 hours', 'took 3 hours'],
                                '3': ['spilled', 'leaked', 'broken container', 'container broke', 'packaging broke', 'food spilled', 'leaked packaging'],
                                '4': ['too spicy', 'not spicy', 'spice level', 'asked for mild', 'instructions ignored', 'special request'],
                                '5': ['delivery person rude', 'driver rude', 'delivery guy rude', 'courier rude', 'delivery boy rude'],
                                '6': ['no spoon', 'missing spoon', 'no fork', 'no cutlery', 'missing cutlery', 'no utensils'],
                                '7': ['staff rude', 'restaurant staff rude', 'unprofessional staff', 'rude behavior'],
                                '8': ['missing item', 'incomplete order', 'forgot item', 'didn\'t get', 'missing drink', 'where is my'],
                                '9': ['hair in food', 'foreign object', 'plastic in food', 'dirty food', 'contaminated', 'hair strand']
                            };
                            
                            // Check if any trigger phrase exists for the detected complaint
                            if (complaintTriggers[complaintId]) {
                                isValidComplaint = complaintTriggers[complaintId].some(trigger => 
                                    reviewText.includes(trigger)
                                );
                            }
                            
                            // Additional checks for false positives
                            if (isValidComplaint) {
                                // Check for non-complaint indicators that should override
                                const nonComplaintIndicators = [
                                    'food was average', 'taste was okay', 'cold food', 'not tasty',
                                    'expensive', 'overpriced', 'costly', 'price high',
                                    'small quantity', 'less food', 'portion size',
                                    'noisy', 'crowded', 'atmosphere', 'ambiance',
                                    'poor quality' // without specific complaint context
                                ];
                                
                                const hasNonComplaintIndicator = nonComplaintIndicators.some(indicator => 
                                    reviewText.includes(indicator)
                                );
                                
                                if (hasNonComplaintIndicator) {
                                    console.warn(`[AutoZomato] AI detected complaint "${complaintId}" but review contains general dissatisfaction indicators. Removing.`);
                                    isValidComplaint = false;
                                }
                            }
                            
                            if (!isValidComplaint) {
                                console.warn(`[AutoZomato] AI hallucinated complaint "${complaintId}" - no matching trigger phrases found in: "${reviewText}". Removing.`);
                                complaintId = null;
                            } else {
                                const matchedTrigger = complaintTriggers[complaintId].find(trigger => reviewText.includes(trigger));
                                console.log(`[AutoZomato] Validated complaint "${complaintId}" with trigger phrase: "${matchedTrigger}"`);
                            }
                        }
                        
                        console.log(`[AutoZomato] AI Review Analysis (validated):`, { sentiment, complaintId });
                    } catch (parseError) {
                        console.warn(`[AutoZomato] Failed to parse review analysis response:`, parseError);
                        // Only use fallback for sentiment, not complaints
                        const fallback = fallbackAnalysis(review);
                        sentiment = fallback.sentiment;
                        complaintId = null; // No fallback for complaints - AI only
                    }
                } else {
                    console.warn(`[AutoZomato] Review analysis API error:`, reviewResponse.status);
                    // Only use fallback for sentiment, not complaints
                    const fallback = fallbackAnalysis(review);
                    sentiment = fallback.sentiment;
                    complaintId = null; // No fallback for complaints - AI only
                }
            } catch (reviewError) {
                console.warn(`[AutoZomato] Review analysis failed:`, reviewError);
                // Only use fallback for sentiment, not complaints
                const fallback = fallbackAnalysis(review);
                sentiment = fallback.sentiment;
                complaintId = null; // No fallback for complaints - AI only
            }

            // Combine results from both requests
            let classification = {
                sentiment: sentiment,
                complaintId: complaintId,
                firstName: firstName,
                confidence: confidence
            };

            console.log(`[AutoZomato] Combined AI Analysis:`, {
                reviewText: review.reviewText || 'No text',
                rating: review.rating,
                classification: classification
            });
            
            // Validate that we have all required fields
            if (!classification || typeof classification.sentiment === 'undefined' || typeof classification.firstName === 'undefined') {
                console.warn(`[AutoZomato] Incomplete classification data, using fallback for sentiment/name only:`, classification);
                const fallback = fallbackAnalysis(review);
                // Only use fallback for sentiment and name, preserve AI complaint detection (or lack thereof)
                classification = {
                    sentiment: classification.sentiment || fallback.sentiment,
                    complaintId: classification.complaintId, // Keep AI result, don't use fallback
                    firstName: classification.firstName || fallback.firstName,
                    confidence: classification.confidence || fallback.confidence
                };
            }
            
            // Additional validation: Check if AI hallucinated a name that's not in the original customer name
            if (classification.firstName && classification.firstName.length > 0) {
                const customerNameLower = (review.customerName || '').toLowerCase();
                const extractedNameLower = classification.firstName.toLowerCase();
                
                // Check if the extracted name is actually present in the customer name
                if (!customerNameLower.includes(extractedNameLower)) {
                    console.warn(`[AutoZomato] AI hallucinated name "${classification.firstName}" not found in "${review.customerName}". Removing.`);
                    classification.firstName = null;
                    classification.confidence = 0;
                }
            }
            
            // Additional validation: Check for hallucinated complaint IDs
            if (classification.complaintId) {
                const reviewText = (review.reviewText || '').toLowerCase().trim();
                const rating = parseInt(review.rating) || 3;
                
                // If review text is empty or very short, likely no specific complaint
                if (!reviewText || reviewText.length < 3) {
                    console.warn(`[AutoZomato] AI detected complaint "${classification.complaintId}" but review text is too short: "${reviewText}". Removing.`);
                    classification.complaintId = null;
                }
                // Only remove complaints for 5-star reviews with explicitly positive language
                else if (rating >= 5 && reviewText.match(/(excellent|amazing|great|perfect|fantastic|wonderful|awesome|outstanding|superb|brilliant|love)/)) {
                    console.warn(`[AutoZomato] AI detected complaint "${classification.complaintId}" but review seems very positive (${rating} stars, positive keywords). Removing.`);
                    classification.complaintId = null;
                }
                // Additional check: ensure the complaint ID exists in our response bank
                else if (!responseBank.complaints.some(c => c.id === classification.complaintId)) {
                    console.warn(`[AutoZomato] AI returned invalid complaint ID "${classification.complaintId}". Removing.`);
                    classification.complaintId = null;
                }
            }
            
            // Handle rating-sentiment mismatch: if rating is 4+ but sentiment is negative, reduce rating by 1
            let adjustedRating = parseInt(review.rating) || 3;
            if (adjustedRating >= 4 && classification.sentiment === 'Negative') {
                adjustedRating = adjustedRating - 1;
                console.log(`[AutoZomato] Rating-sentiment mismatch detected. Original rating: ${review.rating}, Sentiment: ${classification.sentiment}. Adjusted rating to: ${adjustedRating}`);
            }
            
            console.log(`[AutoZomato] AI Analysis:`, classification);

            let replyTemplate = '';
            let selectedCategory = '';

            // Step 2: Enhanced response template selection logic
            if (classification.complaintId && responseBank.complaints.some(c => c.id === classification.complaintId)) {
                // Priority 1: Specific complaint detected
                const complaint = responseBank.complaints.find(c => c.id === classification.complaintId);
                const options = complaint.responses;
                replyTemplate = options[Math.floor(Math.random() * options.length)];
                selectedCategory = `Complaint: ${complaint.storyName}`;
                console.log(`[AutoZomato] Selected response from complaint: "${complaint.storyName}"`);
            } else {
                // Priority 2: Use star rating with enhanced subcategory logic
                const rating = Math.floor(adjustedRating); // Use adjusted rating instead of original
                const category = responseBank.categories.find(c => c.storyName.startsWith(String(rating)));
                
                console.log(`[AutoZomato] Using rating ${rating} (original: ${review.rating}, adjusted: ${adjustedRating}) for response selection`);
                
                if (category) {
                    // Enhanced subcategory selection
                    const hasReviewText = review.reviewText && review.reviewText.trim().length > 0;
                    let subCategoryKey;
                    
                    if (hasReviewText) {
                        // Use sentiment to choose appropriate subcategory
                        if (classification.sentiment === 'Positive') {
                            subCategoryKey = 'Written Review'; // Positive written reviews
                        } else if (classification.sentiment === 'Negative') {
                            subCategoryKey = 'Written Review'; // Negative written reviews - same responses but context aware
                        } else {
                            subCategoryKey = 'Written Review'; // Neutral written reviews
                        }
                    } else {
                        subCategoryKey = 'No Written Review';
                    }
                    
                    const options = category.responses[subCategoryKey];
                    if (options && options.length > 0) {
                        replyTemplate = options[Math.floor(Math.random() * options.length)];
                        selectedCategory = `${category.storyName} -> ${subCategoryKey}`;
                        console.log(`[AutoZomato] Selected response from category: "${selectedCategory}"`);
                    }
                }
            }

            if (!replyTemplate) {
                console.warn('[AutoZomato] Could not find a suitable reply template for review:', review.reviewId);
                continue; // Skip to the next review
            }

            // Step 3: Enhanced personalization with robust name handling
            let finalReply = replyTemplate;
            
            // Use firstName from AI analysis if available and confidence is sufficient
            if (classification.firstName && classification.confidence > 0.5) {
                // Use AI-detected first name with good confidence
                finalReply = finalReply.replace(/{CustomerName}/g, classification.firstName);
                console.log(`[AutoZomato] Using AI-detected first name: "${classification.firstName}" (confidence: ${classification.confidence})`);
            } else {
                // Try manual extraction as fallback
                const extractedName = extractFirstName(review.customerName);
                if (extractedName && extractedName.length > 1 && !extractedName.match(/\d/)) {
                    finalReply = finalReply.replace(/{CustomerName}/g, extractedName);
                    console.log(`[AutoZomato] Using fallback extraction: "${extractedName}"`);
                } else {
                    // Use neutral greeting
                    finalReply = finalReply.replace(/{CustomerName}/g, getRandomNeutralGreeting());
                    console.log(`[AutoZomato] Using neutral greeting for uncertain name`);
                }
            }
            
            // Remove any remaining name placeholders and clean up formatting
            finalReply = finalReply.replace(/,?\s?{CustomerName}/g, '');
            finalReply = finalReply.replace(/{LocationName}/g, review.locationName || '');
            
            // Clean up any double spaces or formatting issues
            finalReply = finalReply.replace(/\s+/g, ' ').trim();

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

            // Log the details for the popup with enhanced data
            processedReviewsLog.push({
                reviewId: review.reviewId,
                customerName: review.customerName,
                extractedName: (classification.firstName && classification.confidence > 0.5) ? classification.firstName : 
                             extractFirstName(review.customerName) || 'N/A',
                reviewText: review.reviewText || '',
                rating: review.rating || 'N/A',
                adjustedRating: adjustedRating !== (parseInt(review.rating) || 3) ? adjustedRating : null, // Only log if different
                sentiment: classification.sentiment || 'Unknown',
                complaintId: classification.complaintId || 'None',
                confidence: classification.confidence || 0,
                selectedCategory: selectedCategory || 'Unknown',
                reply: finalReply,
                replied: repliedStatus,
                includeInAutoReply: true
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

    // Check if this is a new page/URL
    const newUrl = window.location.href;
    if (currentSessionUrl !== newUrl) {
        console.log(`[AutoZomato] New page in initialize. Previous: ${currentSessionUrl}, Current: ${newUrl}`);
        currentSessionUrl = newUrl;
        
        // Clear any previous session data when initializing on a new page
        processedReviewsLog = [];
        
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
            padding: 5px 10px;
            border-radius: 5px;
            font-size: 12px;
            z-index: 10000;
            font-family: Arial, sans-serif;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            transition: background-color 0.5s ease;
            cursor: pointer; /* Add cursor pointer */
        `;
        
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
