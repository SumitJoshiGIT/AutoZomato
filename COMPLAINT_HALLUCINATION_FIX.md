# AutoZomato Complaint Hallucination Fix

## Issue Description

The AI was hallucinating complaint IDs, frequently returning "1" for most reviews regardless of whether the review actually contained a specific complaint. This was causing inappropriate categorization and response selection.

## Root Cause

1. **Loose Prompt Logic**: The original prompt said "If the review matches ANY of the complaint categories" which was too broad
2. **Example Response**: The example JSON showed `"complaintId": "1"` which the AI was copying
3. **Low Temperature But Still Creative**: Even with reduced temperature, the AI was being too liberal with complaint detection
4. **No Validation**: No logic to verify that detected complaints actually made sense given the review content

## Solutions Implemented

### 1. Stricter Complaint Detection Prompt

**Before:**

```
1. "complaintId": String - If the review matches ANY of the complaint categories below, return the complaint ID
```

**After:**

```
1. "complaintId": String - ONLY return a complaint ID if the review text CLEARLY describes a specific problem that matches one of the complaint categories below. Rules:
   - Read the review text carefully for specific issues mentioned
   - If the review is just a rating with no specific complaint mentioned → return null
   - If the review is positive/neutral with no clear problems → return null
   - BE VERY CONSERVATIVE - most reviews should return null
   - DO NOT default to "1" or any ID without clear evidence
```

### 2. Enhanced Analysis Rules

**Added Specific Guidelines:**

```
COMPLAINT ANALYSIS RULES - BE VERY STRICT:
- ONLY return a complaintId if the review text explicitly mentions a specific problem
- Examples of VALID complaints: "food was cold", "service was slow", "wrong order delivered"
- Examples of NO complaint: just star ratings, "good food", "nice place", generic positive/neutral comments
- If the review has no written text, return null
- If the review is positive (4-5 stars) with no specific issues mentioned, return null
- DO NOT assume complaints based on low ratings alone - need actual problem description
```

### 3. Updated Example Response

**Before:** `"complaintId": "1"` (encouraging complaint detection)
**After:** `"complaintId": null` (encouraging null as default)

### 4. Added Complaint Validation Logic

```javascript
// Additional validation: Check for hallucinated complaint IDs
if (classification.complaintId) {
  const reviewText = (review.reviewText || "").toLowerCase().trim();
  const rating = parseInt(review.rating) || 3;

  // If review text is empty or very short, likely no specific complaint
  if (!reviewText || reviewText.length < 10) {
    console.warn(
      `AI detected complaint but review text is too short. Removing.`
    );
    classification.complaintId = null;
  }
  // If rating is 4-5 stars and no negative keywords, likely no complaint
  else if (
    rating >= 4 &&
    !reviewText.match(
      /(bad|terrible|worst|poor|slow|cold|wrong|late|rude|dirty|awful|horrible)/
    )
  ) {
    console.warn(`AI detected complaint but review seems positive. Removing.`);
    classification.complaintId = null;
  }
  // Additional check: ensure the complaint ID exists in our response bank
  else if (
    !responseBank.complaints.some((c) => c.id === classification.complaintId)
  ) {
    console.warn(`AI returned invalid complaint ID. Removing.`);
    classification.complaintId = null;
  }
}
```

### 5. Enhanced Context in Prompt

**Added Specific Review Details:**

```
CRITICAL ANALYSIS INSTRUCTIONS:
1. Customer Name: "${review.customerName}" - Only extract names actually present in this text
2. Review Text: "${review.reviewText || 'No written review provided'}" - Only detect complaints if specific problems are mentioned here
3. Rating: ${review.rating}/5 stars

COMPLAINT DETECTION RULES:
- If review text is empty/very short → complaintId: null
- If rating is 4-5 stars with no specific issues mentioned → complaintId: null
- Only return a complaintId if the review text explicitly describes a problem that matches a category
```

### 6. Added Debug Logging

```javascript
console.log(`[AutoZomato] AI Classification Before Validation:`, {
  reviewText: review.reviewText || "No text",
  rating: review.rating,
  classification: classification,
});
```

## Expected Behavior After Fix

### ✅ Correct Complaint Detection:

- **"Food was cold and service was slow"** → Appropriate complaint ID
- **"Terrible experience, wrong order delivered"** → Appropriate complaint ID
- **"Pizza was undercooked and staff was rude"** → Appropriate complaint ID

### ✅ Correct Rejection (Should Return null):

- **"5 stars, great food!"** → null (positive review)
- **"4/5"** (no text) → null (no specific complaint)
- **"Good place, nice ambiance"** → null (no specific problems mentioned)
- **"Average food"** → null (neutral, no specific complaint)

### ✅ Validation Catches Hallucinations:

- If AI returns complaint ID for 5-star review with no negative text → Removed
- If AI returns complaint ID for empty review text → Removed
- If AI returns invalid complaint ID → Removed

## Testing Recommendations

1. **Test with positive reviews** - Should return `complaintId: null`
2. **Test with rating-only reviews** - Should return `complaintId: null`
3. **Test with neutral reviews** - Should return `complaintId: null`
4. **Test with clear complaint reviews** - Should return appropriate complaint ID
5. **Monitor validation logs** - Check for hallucination warnings

## Impact on Response Selection

- **More reviews will use rating-based responses** (since fewer false complaints detected)
- **Complaint responses reserved for actual complaints** (better accuracy)
- **Improved customer satisfaction** (appropriate response matching)

## Files Modified

- `/src/content/content.js` - Enhanced prompt, validation, and complaint detection logic
- Added this documentation file

The system should now be much more conservative and accurate about complaint detection, preventing inappropriate complaint categorization for neutral or positive reviews.
