# AutoZomato Complaint Detection & Rating Adjustment Fix

## Issues Addressed

### 1. **Over-Strict Complaint Detection**
**Problem:** The AI was not detecting ANY complaints because the validation rules were too restrictive.

**Solution:** Relaxed complaint detection rules while maintaining quality:

#### **Before (Too Strict):**
- Required review text length ≥ 10 characters
- Blocked complaints for 4+ star reviews entirely
- Only looked for explicit problem statements

#### **After (Balanced):**
- Reduced minimum text length to 5 characters
- Only blocks complaints for 5-star reviews (not 4+)
- Added more negative keywords for detection
- Considers negative sentiment as complaint indicator
- More flexible for 1-3 star reviews

### 2. **Rating-Sentiment Mismatch Handling**
**Problem:** When a review has 4+ stars but negative sentiment, it creates confusion in response selection.

**Solution:** Automatic rating adjustment logic:

```javascript
// Handle rating-sentiment mismatch: if rating is 4+ but sentiment is negative, reduce rating by 1
let adjustedRating = parseInt(review.rating) || 3;
if (adjustedRating >= 4 && classification.sentiment === 'Negative') {
    adjustedRating = adjustedRating - 1;
    console.log(`Rating-sentiment mismatch detected. Original: ${review.rating}, Adjusted: ${adjustedRating}`);
}
```

**Examples:**
- ⭐⭐⭐⭐⭐ + Negative sentiment → Use ⭐⭐⭐⭐ responses
- ⭐⭐⭐⭐ + Negative sentiment → Use ⭐⭐⭐ responses

## Updated Complaint Detection Rules

### **New Validation Logic:**
```javascript
// Relaxed validation - more permissive
if (!reviewText || reviewText.length < 5) {  // Was 10, now 5
    // Remove complaint
}
else if (rating >= 5 && !negativeKeywords) {  // Was 4+, now 5
    // Remove complaint 
}
```

### **Enhanced Negative Keywords:**
Added more detection patterns:
- Original: `bad|terrible|worst|poor|slow|cold|wrong|late|rude|dirty|awful|horrible`
- Enhanced: `bad|terrible|worst|poor|slow|cold|wrong|late|rude|dirty|awful|horrible|disappointed|worst|issue|problem`

### **New Prompt Guidelines:**
```
COMPLAINT ANALYSIS RULES - BE BALANCED:
- Return a complaintId if the review text mentions a specific problem that matches a category
- For 1-3 star reviews, look more carefully for complaint indicators even if not explicitly stated
- Consider negative sentiment as a potential indicator of complaints
- Examples of VALID complaints: "food was cold", "service was slow", "disappointing", "not fresh"
```

## Response Selection Improvements

### **Uses Adjusted Rating:**
```javascript
// Priority 2: Use adjusted rating instead of original
const rating = Math.floor(adjustedRating); // Was: Math.floor(review.rating)
const category = responseBank.categories.find(c => c.storyName.startsWith(String(rating)));
```

### **Enhanced Logging:**
- Logs original vs adjusted rating when mismatch occurs
- Tracks adjusted rating in Excel export for analysis
- Better debugging information

## Excel Export Enhancements

### **New Column Added:**
- **"Adjusted Rating"** - Shows when rating was adjusted due to sentiment mismatch
- Only populated when different from original rating
- Helps analyze rating-sentiment patterns

### **Updated Headers:**
```
Restaurant Name | Customer Name | Extracted Name | Review ID | Review Text | 
Rating | Adjusted Rating | Sentiment | Complaint ID | Name Confidence | 
Generated Reply | Replied Status | Included in Auto-Reply | URL | Timestamp
```

## Expected Behavior Changes

### ✅ **Better Complaint Detection:**
- **1-2 star reviews with negative sentiment** → More likely to detect complaints
- **3-4 star reviews with specific problems** → Will detect appropriate complaints
- **5 star reviews with minor issues** → May still detect complaints if explicit

### ✅ **Smart Rating Adjustment:**
- **4-star + negative sentiment** → Uses 3-star responses (more appropriate)
- **5-star + negative sentiment** → Uses 4-star responses (more appropriate)
- **Maintains original rating in logs** for transparency

### ✅ **Improved Response Matching:**
- Better alignment between review sentiment and response tone
- More appropriate response categories selected
- Reduces awkward mismatches (e.g., overly positive responses to negative reviews)

## Testing Scenarios

### **Should Detect Complaints Now:**
- ⭐⭐ "Food was okay but service slow" → Service complaint
- ⭐⭐⭐ "Disappointing experience" → General complaint
- ⭐⭐⭐⭐ "Good food but wrong order" → Order complaint

### **Should Use Adjusted Ratings:**
- ⭐⭐⭐⭐ + Negative sentiment → Use 3-star responses
- ⭐⭐⭐⭐⭐ + Negative sentiment → Use 4-star responses

### **Should Still Block:**
- ⭐⭐⭐⭐⭐ "Amazing food, great service" → No complaint (positive)
- "" (empty review) → No complaint
- ⭐⭐⭐⭐⭐ "👍" (too short) → No complaint

## Files Modified
- `/src/content/content.js` - Updated validation, rating adjustment, and complaint detection
- `/src/background/background.js` - Enhanced Excel export with adjusted rating column
- Added this documentation file

The system should now be much more effective at detecting legitimate complaints while handling rating-sentiment mismatches appropriately!
