/**
 * ReviewResultsTable Component
 * 
 * Handles displaying individual scraped reviews in real-time
 * This is separate from the restaurant processing status table
 */
class ReviewResultsTable {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.tableBody = null;
        this.reviewsMap = new Map(); // Track reviews to prevent duplicates
        this.totalReviews = 0;
        this.successfulReplies = 0;
        
        this.init();
        console.log('[ReviewResultsTable] Component initialized for container:', containerId);
    }

    init() {
        if (!this.container) {
            console.error('[ReviewResultsTable] Container not found:', this.containerId);
            return;
        }

        this.render();
        this.setupEventListeners();
        
        // Load complaint mappings from response bank
        this.loadComplaintMappings();
    }

    render() {
        const html = `
            <div class="review-results-component">
                <div class="review-results-header">
                    <h3>📊 Individual Review Results (Live)</h3>
                    <div class="review-stats">
                        <span class="stat-item">
                            <strong>Reviews:</strong> <span id="reviewCount">0</span>
                        </span>
                    </div>
                </div>
                
                <div class="review-results-table-container">
                    <table class="review-results-table">
                        <thead>
                            <tr>
                                <th>Restaurant</th>
                                <th>Customer</th>
                                <th>Extracted Name</th>
                                <th>Rating</th>
                                <th>Sentiment</th>
                                <th>AI Complaint</th>
                                <th>Corrected Complaint</th>
                                <th>Review Text</th>
                                <th>Reply</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody id="reviewResultsTableBody">
                            <!-- Reviews will be added here dynamically -->
                        </tbody>
                    </table>
                    
                    <div class="review-results-empty" id="reviewResultsEmpty">
                        <p>🔍 No reviews processed yet. Start processing to see individual review results here.</p>
                    </div>
                </div>
                
                <div class="review-results-actions">
                    <button id="downloadReviewResults" class="btn btn-primary">
                        📥 Download Reviews (CSV)
                    </button>
                    <button id="clearReviewResults" class="btn btn-secondary">
                        🗑️ Clear Results
                    </button>
                </div>
            </div>
        `;

        this.container.innerHTML = html;
        
        // Get references to elements
        this.tableBody = document.getElementById('reviewResultsTableBody');
        this.emptyState = document.getElementById('reviewResultsEmpty');
        this.reviewCount = document.getElementById('reviewCount');
        this.replyCount = document.getElementById('replyCount');
        this.successRate = document.getElementById('successRate');
        
        console.log('[ReviewResultsTable] Component rendered successfully');
        console.log('[ReviewResultsTable] Table body element:', !!this.tableBody);
    }

    setupEventListeners() {
        // Download results
        const downloadBtn = document.getElementById('downloadReviewResults');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadResults());
        }

        // Clear results
        const clearBtn = document.getElementById('clearReviewResults');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearResults());
        }

        // Event delegation for complaint dropdowns (CSP-compliant)
        this.container.addEventListener('change', (event) => {
            if (event.target.classList.contains('complaint-dropdown')) {
                const reviewId = event.target.getAttribute('data-review-id');
                const newComplaintId = event.target.value;
                this.handleComplaintChange(reviewId, newComplaintId);
            }
        });
    }

    /**
     * Add a new review to the table
     * @param {Object} reviewData - The review data from content script
     */
    addReview(reviewData) {
        const reviewId = reviewData.reviewId || this.generateReviewId(reviewData);
        
        console.log('[ReviewResultsTable] Adding review:', {
            reviewId,
            customerName: reviewData.customerName,
            restaurantName: reviewData.restaurantName,
            hasExistingReview: this.reviewsMap.has(reviewId)
        });

        // Check for duplicates
        if (this.reviewsMap.has(reviewId)) {
            console.log('[ReviewResultsTable] Updating existing review:', reviewId);
            this.updateReview(reviewId, reviewData);
            return;
        }

        // Add new review
        this.reviewsMap.set(reviewId, reviewData);
        this.createReviewRow(reviewId, reviewData);
        this.updateStats();
        this.showTable();

        console.log('[ReviewResultsTable] Review added successfully. Total reviews:', this.reviewsMap.size);
    }

    /**
     * Create a new row for a review
     */
    createReviewRow(reviewId, reviewData) {
        if (!this.tableBody) {
            console.error('[ReviewResultsTable] Table body not found!');
            return;
        }

        const row = document.createElement('tr');
        row.className = 'review-row new-review';
        row.setAttribute('data-review-id', reviewId);

        const sentiment = reviewData.sentiment || 'Neutral';
        const sentimentClass = typeof sentiment === 'string' ? sentiment.toLowerCase() : 'neutral';
        

        const rating = reviewData.rating ? 
            `<span class="rating-stars">${'★'.repeat(Math.floor(reviewData.rating))}${'☆'.repeat(5 - Math.floor(reviewData.rating))}</span> (${reviewData.rating})` :
            'N/A';

        const reviewText = reviewData.reviewText ? 
            `<div class="review-text" title="${reviewData.reviewText}">${this.truncateText(reviewData.reviewText, 50)}</div>` :
            'No text';

        const reply = reviewData.reply ? 
            `<div class="reply-text" title="${reviewData.reply}">${this.truncateText(reviewData.reply, 40)}</div>` :
            '';

        // Handle complaint information
        const complaintId = reviewData.complaintId || null;
        const correctedComplaintId = reviewData.correctedComplaintId || null;
        
        // AI detected complaint display
        const aiComplaintDisplay = complaintId ? 
            `<div class="ai-complaint">
                <span class="complaint-id ai-detected">${complaintId}</span>
                <span class="complaint-name" title="${this.getComplaintName(complaintId)}">${this.truncateText(this.getComplaintName(complaintId), 20)}</span>
            </div>` : 
            `<span class="no-complaint">None Detected</span>`;
            
        // Corrected complaint display (editable dropdown)
        const correctedComplaintDisplay = this.createComplaintSelector(reviewId, correctedComplaintId || complaintId);

        row.innerHTML = `
            <td>${reviewData.restaurantName || 'Unknown'}</td>
            <td>${reviewData.customerName || 'Unknown'}</td>
            <td>${reviewData.extractedName || 'N/A'}</td>
            <td>${rating}</td>
            <td><span class="sentiment-${sentimentClass}">${sentiment}</span></td>
            <td>${aiComplaintDisplay}</td>
            <td>${correctedComplaintDisplay}</td>
            <td>${reviewText}</td>
            <td class="reply-cell">${reply}</td>
            <td>${new Date().toLocaleTimeString()}</td>
        `;

        this.tableBody.appendChild(row);
        
        // Add animation class after a brief delay
        setTimeout(() => {
            row.classList.remove('new-review');
            row.classList.add('review-added');
        }, 100);

        console.log('[ReviewResultsTable] Row created for review:', reviewId);
    }

    /**
     * Update an existing review row
     */
    updateReview(reviewId, reviewData) {
        const existingRow = this.tableBody.querySelector(`tr[data-review-id="${reviewId}"]`);
        if (!existingRow) {
            console.warn('[ReviewResultsTable] Row not found for update:', reviewId);
            return;
        }

        // Update the review data
        this.reviewsMap.set(reviewId, { ...this.reviewsMap.get(reviewId), ...reviewData });
        
        // Add update animation
        existingRow.classList.add('review-updated');
        setTimeout(() => {
            existingRow.classList.remove('review-updated');
        }, 1000);

        // Update specific cells if needed
       
        if (reviewData.reply) {
            const replyCell = existingRow.querySelector('.reply-cell');
            if (replyCell) {
                replyCell.innerHTML = `<div class="reply-text" title="${reviewData.reply}">${this.truncateText(reviewData.reply, 40)}</div>`;
            }
        }

        this.updateStats();
        console.log('[ReviewResultsTable] Review updated:', reviewId);
    }

    /**
     * Update statistics display
     */
    updateStats() {
        this.totalReviews = this.reviewsMap.size;
        this.successfulReplies = Array.from(this.reviewsMap.values()).filter(r => r.replied).length;
        
        const successRate = this.totalReviews > 0 ? Math.round((this.successfulReplies / this.totalReviews) * 100) : 0;

        if (this.reviewCount) this.reviewCount.textContent = this.totalReviews;
        if (this.replyCount) this.replyCount.textContent = this.successfulReplies;
        if (this.successRate) this.successRate.textContent = `${successRate}%`;
    }

    /**
     * Show the table and hide empty state
     */
    showTable() {
        if (this.emptyState) {
            this.emptyState.style.display = 'none';
        }
    }

    /**
     * Clear all results
     */
    clearResults() {
        if (confirm('Are you sure you want to clear all review results?')) {
            this.reviewsMap.clear();
            if (this.tableBody) {
                this.tableBody.innerHTML = '';
            }
            this.updateStats();
            
            if (this.emptyState) {
                this.emptyState.style.display = 'block';
            }
            
            console.log('[ReviewResultsTable] Results cleared');
        }
    }

    /**
     * Download results as CSV
     */
    downloadResults() {
        if (this.reviewsMap.size === 0) {
            alert('No review results to download');
            return;
        }

        const headers = ['Restaurant', 'Customer', 'Extracted Name', 'Rating', 'Sentiment', 'AI Complaint ID', 'AI Complaint Type', 'Corrected Complaint ID', 'Corrected Complaint Type', 'Review Text', 'Reply', 'Status', 'Timestamp'];
        const rows = Array.from(this.reviewsMap.values()).map(review => [
            (review.restaurantName || '').replace(/\n/g, ' '),
            review.customerName || '',
            review.extractedName || '',
            review.rating || '',
            review.sentiment || '',
            review.originalComplaintId || review.complaintId || '',
            this.getComplaintName(review.originalComplaintId || review.complaintId) || '',
            review.correctedComplaintId || '',
            this.getComplaintName(review.correctedComplaintId) || '',
            review.reviewText || '',
            review.reply || '',
            new Date().toISOString()
        ]);

        const csvContent = [headers, ...rows]
            .map(row => row.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(','))
            .join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `review-results-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        console.log('[ReviewResultsTable] Results downloaded');
    }

    /**
     * Generate a unique review ID if none provided
     */
    generateReviewId(reviewData) {
        return `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Create an editable complaint selector dropdown
     * @param {string} reviewId - The review ID
     * @param {string|null} currentComplaintId - Currently selected complaint ID
     * @returns {string} - HTML for the complaint selector
     */
    createComplaintSelector(reviewId, currentComplaintId) {
        const complaints = this.getComplaintOptions();
        
        const options = complaints.map(complaint => 
            `<option value="${complaint.id}" ${currentComplaintId === complaint.id ? 'selected' : ''}>
                ${complaint.name}
            </option>`
        ).join('');
        
        return `
            <div class="complaint-selector">
                <select class="complaint-dropdown" data-review-id="${reviewId}">
                    <option value="">No Complaint</option>
                    ${options}
                </select>
                ${currentComplaintId && currentComplaintId !== (this.getReview(reviewId)?.complaintId || null) ? 
                    '<span class="correction-indicator" title="Manually corrected">✏️</span>' : ''
                }
            </div>
        `;
    }

    /**
     * Get complaint options for the dropdown
     * @returns {Array} - Array of complaint options
     */
    getComplaintOptions() {
        // Use loaded complaint mappings if available
        if (this.complaintMappings) {
            return Object.entries(this.complaintMappings).map(([id, name]) => ({
                id, 
                name: name // Just the name, not "ID: Name"
            }));
        }
        
        // Fallback complaint options matching response_bank.json structure
        return [
            { id: '1', name: 'Incorrect Orders Received' },
            { id: '2', name: 'Delivery Delays by Zomato' },
            { id: '3', name: 'Spill Packaging Issues' },
            { id: '4', name: 'Cooking Instructions Not Followed' },
            { id: '5', name: 'Zomato Delivery-Related Issues' },
            { id: '6', name: 'Missing Cutlery' },
            { id: '7', name: 'Rude Staff' },
            { id: '8', name: 'Missing Item in Order' },
            { id: '9', name: 'Food Safety – Foreign Materials' }
        ];
    }

    /**
     * Handle complaint change from dropdown
     * @param {string} reviewId - The review ID
     * @param {string} newComplaintId - The new complaint ID selected
     */
    handleComplaintChange(reviewId, newComplaintId) {
        console.log('[ReviewResultsTable] Complaint changed:', { reviewId, newComplaintId });
        
        const review = this.reviewsMap.get(reviewId);
        if (!review) {
            console.error('[ReviewResultsTable] Review not found for complaint change:', reviewId);
            return;
        }
        
        // Store the original AI-detected complaint if not already stored
        if (!review.originalComplaintId) {
            review.originalComplaintId = review.complaintId;
        }
        
        // Update the corrected complaint ID
        review.correctedComplaintId = newComplaintId || null;
        
        // Update the review in the map
        this.reviewsMap.set(reviewId, review);
        
        // Update the visual indicator
        this.updateComplaintCorrectionIndicator(reviewId);
        
        // Log the change for audit purposes
        console.log('[ReviewResultsTable] Complaint correction recorded:', {
            reviewId,
            originalComplaint: review.originalComplaintId,
            correctedComplaint: review.correctedComplaintId,
            customerName: review.customerName,
            restaurantName: review.restaurantName
        });
        
        // Optionally notify the main application about the change
        if (window.pageController && window.pageController.onComplaintCorrected) {
            window.pageController.onComplaintCorrected(reviewId, review);
        }
    }

    /**
     * Update the correction indicator for a review
     * @param {string} reviewId - The review ID
     */
    updateComplaintCorrectionIndicator(reviewId) {
        const row = this.tableBody.querySelector(`tr[data-review-id="${reviewId}"]`);
        if (!row) return;
        
        const selectorDiv = row.querySelector('.complaint-selector');
        if (!selectorDiv) return;
        
        const review = this.reviewsMap.get(reviewId);
        const hasCorrection = review && review.correctedComplaintId && 
                             review.correctedComplaintId !== (review.originalComplaintId || review.complaintId);
        
        // Remove existing indicator
        const existingIndicator = selectorDiv.querySelector('.correction-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
        
        // Add new indicator if there's a correction
        if (hasCorrection) {
            const indicator = document.createElement('span');
            indicator.className = 'correction-indicator';
            indicator.title = 'Manually corrected';
            indicator.textContent = '✏️';
            selectorDiv.appendChild(indicator);
        }
    }

    /**
     * Get complaint name from complaint ID
     * @param {string} complaintId - The complaint ID to look up
     * @returns {string|null} - The complaint name or null if not found
     */
    getComplaintName(complaintId) {
        if (!complaintId) return null;
        
        // Use loaded complaint mappings if available
        if (this.complaintMappings && this.complaintMappings[complaintId]) {
            return this.complaintMappings[complaintId];
        }
        
        // Fallback to basic mapping with user-friendly names
        const complaintMappings = {
            '1': 'Food Quality Issues',
            '2': 'Service Problems', 
            '3': 'Delivery Issues',
            '4': 'Order Accuracy Problems',
            '5': 'Cleanliness Concerns',
            '6': 'Pricing Complaints',
            '7': 'Wait Time Issues',
            '8': 'Staff Behavior Issues',
            '9': 'Facility Problems',
            '10': 'Other Issues'
        };
        
        return complaintMappings[complaintId] || `Complaint #${complaintId}`;
    }

    /**
     * Load complaint mappings from response bank (if available)
     * This method can be called to update complaint mappings from the actual response bank
     */
    async loadComplaintMappings() {
        try {
            // Use chrome.runtime.getURL for proper extension file access
            const response = await fetch(chrome.runtime.getURL('response_bank.json'));
            if (response.ok) {
                const responseBank = await response.json();
                if (responseBank.complaints && Array.isArray(responseBank.complaints)) {
                    this.complaintMappings = {};
                    responseBank.complaints.forEach(complaint => {
                        // Use storyName for user-friendly display
                        this.complaintMappings[complaint.id] = complaint.storyName;
                    });
                    console.log('[ReviewResultsTable] Complaint mappings loaded from response bank:', this.complaintMappings);
                }
            }
        } catch (error) {
            console.warn('[ReviewResultsTable] Could not load response bank for complaint mappings:', error);
            // Initialize with accurate fallback mappings based on response_bank.json
            this.complaintMappings = {
                '1': 'Incorrect Orders Received',
                '2': 'Delivery Delays by Zomato',
                '3': 'Spill Packaging Issues',
                '4': 'Cooking Instructions Not Followed',
                '5': 'Zomato Delivery-Related Issues',
                '6': 'Missing Cutlery',
                '7': 'Rude Staff',
                '8': 'Missing Item in Order',
                '9': 'Food Safety – Foreign Materials'
            };
        }
    }

    /**
     * Truncate text for display
     */
    truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    /**
     * Get current review count
     */
    getReviewCount() {
        return this.reviewsMap.size;
    }

    /**
     * Get review by ID
     */
    getReview(reviewId) {
        return this.reviewsMap.get(reviewId);
    }

    /**
     * Get all reviews
     */
    getAllReviews() {
        return Array.from(this.reviewsMap.values());
    }

    /**
     * Get correction statistics
     * @returns {Object} - Statistics about complaint corrections
     */
    getCorrectionStats() {
        const reviews = Array.from(this.reviewsMap.values());
        const totalReviews = reviews.length;
        const reviewsWithAIComplaints = reviews.filter(r => r.complaintId || r.originalComplaintId).length;
        const reviewsWithCorrections = reviews.filter(r => r.correctedComplaintId && 
            r.correctedComplaintId !== (r.originalComplaintId || r.complaintId)).length;
        const reviewsWithRemovedComplaints = reviews.filter(r => 
            (r.originalComplaintId || r.complaintId) && !r.correctedComplaintId).length;
        const reviewsWithAddedComplaints = reviews.filter(r => 
            !(r.originalComplaintId || r.complaintId) && r.correctedComplaintId).length;

        return {
            totalReviews,
            reviewsWithAIComplaints,
            reviewsWithCorrections,
            reviewsWithRemovedComplaints,
            reviewsWithAddedComplaints,
            correctionRate: totalReviews > 0 ? (reviewsWithCorrections / totalReviews * 100).toFixed(1) : 0
        };
    }
}

// Export for use in other files
window.ReviewResultsTable = ReviewResultsTable;
