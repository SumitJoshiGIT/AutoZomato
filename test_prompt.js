#!/usr/bin/env node

// Test script for AutoZomato AI Prompt Validation
// This script tests various review scenarios to validate complaint detection accuracy

const fs = require('fs');
const path = require('path');

// Test cases covering different scenarios
const testCases = [
    // TRUE POSITIVE CASES - Should detect complaints
    {
    id: 23,
    reviewText: "The food was not as hot as I expected, but it was still tasty",
    rating: 3,
    expectedComplaint: null,
    description: "Temperature expectation - should NOT detect complaint"
},
{
    id: 24,
    reviewText: "The delivery person forgot to greet me, felt a bit rude",
    rating: 3,
    expectedComplaint: null,
    description: "Perceived rudeness without explicit issue - should NOT detect complaint"
},
{
    id: 25,
    reviewText: "The food was slightly overcooked, but still edible",
    rating: 3,
    expectedComplaint: null,
    description: "Minor cooking issue - should NOT detect complaint"
},
{
    id: 26,
    reviewText: "The packaging was not very appealing, but it was intact",
    rating: 3,
    expectedComplaint: null,
    description: "Packaging aesthetics - should NOT detect complaint"
},
{
    id: 27,
    reviewText: "The restaurant forgot to include a thank-you note",
    rating: 4,
    expectedComplaint: null,
    description: "Missing non-essential item - should NOT detect complaint"
},
{
    id: 28,
    reviewText: "The food was good, but I expected it to be exceptional",
    rating: 4,
    expectedComplaint: null,
    description: "High expectations not met - should NOT detect complaint"
},
{
    id: 29,
    reviewText: "The delivery person was not smiling, seemed unenthusiastic",
    rating: 3,
    expectedComplaint: null,
    description: "Delivery person's demeanor - should NOT detect complaint"
},
{
    id: 30,
    reviewText: "The portion size was okay, but I was hoping for more",
    rating: 3,
    expectedComplaint: null,
    description: "Portion size expectation - should NOT detect complaint"
},
{
    id: 31,
    reviewText: "The food was slightly salty for my taste, but others might like it",
    rating: 3,
    expectedComplaint: null,
    description: "Personal taste preference - should NOT detect complaint"
},
{
    id: 32,
    reviewText: "The restaurant did not include a discount as I hoped",
    rating: 3,
    expectedComplaint: null,
    description: "Discount expectation - should NOT detect complaint"
}
,
    {
        id: 1,
        reviewText: "I ordered chicken biryani but got mutton biryani instead",
        rating: 2,
        expectedComplaint: "1",
        description: "Incorrect order - should detect complaint ID 1"
    },
    {
        id: 2,
        reviewText: "Food took 3 hours to arrive, very slow delivery",
        rating: 1,
        expectedComplaint: "2",
        description: "Delivery delay - should detect complaint ID 2"
    },
    {
        id: 3,
        reviewText: "The container was broken and food spilled everywhere",
        rating: 2,
        expectedComplaint: "3",
        description: "Packaging issue - should detect complaint ID 3"
    },
    {
        id: 4,
        reviewText: "I asked for mild spice but they made it too spicy",
        rating: 2,
        expectedComplaint: "4",
        description: "Cooking instructions - should detect complaint ID 4"
    },
    {
        id: 5,
        reviewText: "The delivery person was very rude to me",
        rating: 1,
        expectedComplaint: "5",
        description: "Delivery person behavior - should detect complaint ID 5"
    },
    {
        id: 6,
        reviewText: "No spoon provided with the curry, how am I supposed to eat?",
        rating: 2,
        expectedComplaint: "6",
        description: "Missing cutlery - should detect complaint ID 6"
    },
    {
        id: 7,
        reviewText: "Restaurant staff was very rude and unprofessional",
        rating: 1,
        expectedComplaint: "7",
        description: "Rude staff - should detect complaint ID 7"
    },
    {
        id: 8,
        reviewText: "My drink was missing from the order, incomplete order",
        rating: 2,
        expectedComplaint: "8",
        description: "Missing item - should detect complaint ID 8"
    },
    {
        id: 9,
        reviewText: "Found a hair strand in my food, very unhygienic",
        rating: 1,
        expectedComplaint: "9",
        description: "Food safety issue - should detect complaint ID 9"
    },

    // FALSE POSITIVE CASES - Should NOT detect complaints
    {
        id: 10,
        reviewText: "Food was average, nothing special",
        rating: 3,
        expectedComplaint: null,
        description: "General opinion - should NOT detect complaint"
    },
    {
        id: 11,
        reviewText: "Too expensive for the quantity provided",
        rating: 2,
        expectedComplaint: null,
        description: "Price concern - should NOT detect complaint"
    },
    {
        id: 12,
        reviewText: "Food was cold when it arrived",
        rating: 2,
        expectedComplaint: null,
        description: "Food temperature - should NOT detect complaint"
    },
    {
        id: 13,
        reviewText: "Restaurant was too noisy and crowded",
        rating: 3,
        expectedComplaint: null,
        description: "Ambiance issue - should NOT detect complaint"
    },
    {
        id: 14,
        reviewText: "Small portion size for the price",
        rating: 3,
        expectedComplaint: null,
        description: "Portion size - should NOT detect complaint"
    },
    {
        id: 15,
        reviewText: "Food quality was poor, not fresh",
        rating: 2,
        expectedComplaint: null,
        description: "General quality - should NOT detect complaint"
    },
    {
        id: 16,
        reviewText: "Taste was not good, disappointed",
        rating: 2,
        expectedComplaint: null,
        description: "Taste opinion - should NOT detect complaint"
    },
    {
        id: 17,
        reviewText: "Excellent food and great service!",
        rating: 5,
        expectedComplaint: null,
        description: "Positive review - should NOT detect complaint"
    },
    {
        id: 18,
        reviewText: "",
        rating: 3,
        expectedComplaint: null,
        description: "Empty review - should NOT detect complaint"
    },
    {
        id: 19,
        reviewText: "Food was okay, nothing extraordinary",
        rating: 3,
        expectedComplaint: null,
        description: "Neutral review - should NOT detect complaint"
    },

    // EDGE CASES
    {
        id: 20,
        reviewText: "Wrong order but the replacement was good",
        rating: 4,
        expectedComplaint: "1",
        description: "Mixed feedback with complaint - should detect complaint"
    },
    {
        id: 21,
        reviewText: "Delivery was late but food was amazing",
        rating: 4,
        expectedComplaint: "2",
        description: "Mixed feedback with delay - should detect complaint"
    },
    {
        id: 22,
        reviewText: "The food tasted like it was ordered yesterday",
        rating: 2,
        expectedComplaint: null,
        description: "Metaphorical language - should NOT detect complaint"
    }
];

// AI Prompt (same as in content.js)
function generateReviewAnalysisPrompt(reviewText, rating) {
    return `TASK: Analyze this restaurant review and return JSON with complaint detection and sentiment.

**CRITICAL INSTRUCTION: You MUST be extremely conservative in detecting complaints. Only assign a complaint ID if you find EXACT matches to the specific phrases listed below. If there's ANY doubt, return null.**

REVIEW:
Text: "${reviewText || 'No written review provided'}"
Rating: ${rating}/5 stars

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
}

// Function to test AI API
async function testAIPrompt(testCase) {
    const prompt = generateReviewAnalysisPrompt(testCase.reviewText, testCase.rating);
    
    const requestBody = {
        model: 'mistral',
        prompt: prompt,
        stream: false,
        format: 'json',
        options: {
            temperature: 0.1,
            top_p: 0.9,
            top_k: 40,
            num_predict: 50,
            repeat_penalty: 1.1,
            stop: ["\n", "```", "---", "EXAMPLES"]
        }
    };

    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch('http://localhost:3000/ollama/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        return {
            success: true,
            rawResponse: result.response,
            parsed: cleanAndParseJSON(result.response)
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// JSON cleaning function (same as in content.js)
function cleanAndParseJSON(jsonString) {
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.log(`Attempting to clean malformed JSON...`);
        
        try {
            let cleaned = jsonString.substring(jsonString.indexOf('{'));
            cleaned = cleaned.substring(0, cleaned.lastIndexOf('}') + 1);
            cleaned = cleaned
                .replace(/'/g, '"')
                .replace(/,\s*}/g, '}')
                .replace(/,\s*]/g, ']')
                .replace(/(\w+):/g, '"$1":')
                .replace(/:\s*([^",\[\{][^,\]\}]*)/g, ': "$1"');
            
            return JSON.parse(cleaned);
        } catch (e2) {
            console.warn(`JSON cleaning failed:`, e2);
            throw e2;
        }
    }
}

// Main test function
async function runTests() {
    console.log('🧪 AutoZomato AI Prompt Test Suite');
    console.log('==================================\n');
    
    const results = [];
    let correctPredictions = 0;
    let totalTests = 0;

    for (const testCase of testCases) {
        totalTests++;
        console.log(`Testing Case ${testCase.id}: ${testCase.description}`);
        console.log(`Review: "${testCase.reviewText}" (Rating: ${testCase.rating}/5)`);
        console.log(`Expected Complaint: ${testCase.expectedComplaint || 'None'}`);
        
        const aiResult = await testAIPrompt(testCase);
        
        let testResult = {
            testId: testCase.id,
            description: testCase.description,
            reviewText: testCase.reviewText,
            rating: testCase.rating,
            expectedComplaint: testCase.expectedComplaint,
            aiSuccess: aiResult.success,
            rawAIResponse: aiResult.rawResponse || null,
            aiError: aiResult.error || null
        };

        if (aiResult.success) {
            const aiPrediction = aiResult.parsed;
            testResult.aiComplaint = aiPrediction.complaintId || null;
            testResult.aiSentiment = aiPrediction.sentiment || 'Unknown';
            
            // Check if prediction matches expectation
            const isCorrect = (testResult.aiComplaint === testCase.expectedComplaint) || 
                             (testResult.aiComplaint === null && testCase.expectedComplaint === null);
            
            testResult.correct = isCorrect;
            
            if (isCorrect) {
                correctPredictions++;
                console.log(`✅ CORRECT: AI predicted ${testResult.aiComplaint || 'None'}`);
            } else {
                console.log(`❌ INCORRECT: AI predicted ${testResult.aiComplaint || 'None'}, expected ${testCase.expectedComplaint || 'None'}`);
            }
            
            console.log(`   Sentiment: ${testResult.aiSentiment}`);
        } else {
            testResult.correct = false;
            console.log(`❌ API ERROR: ${aiResult.error}`);
        }
        
        results.push(testResult);
        console.log('---\n');
        
        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Generate summary
    const accuracy = (correctPredictions / totalTests * 100).toFixed(1);
    const apiErrors = results.filter(r => !r.aiSuccess).length;
    
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('=======================');
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Correct Predictions: ${correctPredictions}`);
    console.log(`Accuracy: ${accuracy}%`);
    console.log(`API Errors: ${apiErrors}`);
    
    // Analyze false positives and false negatives
    const falsePositives = results.filter(r => 
        r.aiSuccess && r.expectedComplaint === null && r.aiComplaint !== null
    );
    
    const falseNegatives = results.filter(r => 
        r.aiSuccess && r.expectedComplaint !== null && r.aiComplaint === null
    );
    
    console.log(`False Positives: ${falsePositives.length}`);
    console.log(`False Negatives: ${falseNegatives.length}`);
    
    if (falsePositives.length > 0) {
        console.log('\n🚨 FALSE POSITIVES (AI detected complaint when none expected):');
        falsePositives.forEach(fp => {
            console.log(`  - Test ${fp.testId}: "${fp.reviewText}" → AI: ${fp.aiComplaint}`);
        });
    }
    
    if (falseNegatives.length > 0) {
        console.log('\n⚠️  FALSE NEGATIVES (AI missed expected complaint):');
        falseNegatives.forEach(fn => {
            console.log(`  - Test ${fn.testId}: "${fn.reviewText}" → Expected: ${fn.expectedComplaint}, AI: ${fn.aiComplaint || 'None'}`);
        });
    }

    // Save detailed results to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = `test_results_${timestamp}.json`;
    
    const fullReport = {
        timestamp: new Date().toISOString(),
        summary: {
            totalTests,
            correctPredictions,
            accuracy: parseFloat(accuracy),
            apiErrors,
            falsePositives: falsePositives.length,
            falseNegatives: falseNegatives.length
        },
        testResults: results,
        falsePositiveDetails: falsePositives,
        falseNegativeDetails: falseNegatives
    };
    
    try {
        fs.writeFileSync(outputFile, JSON.stringify(fullReport, null, 2));
        console.log(`\n💾 Detailed results saved to: ${outputFile}`);
    } catch (error) {
        console.error(`Failed to save results: ${error.message}`);
    }

    return fullReport;
}

// Check if node-fetch is available
async function checkDependencies() {
    try {
        await import('node-fetch');
        return true;
    } catch (error) {
        console.error('❌ node-fetch is required to run this test.');
        console.error('Please install it with: npm install node-fetch');
        return false;
    }
}

// Run the tests
async function main() {
    const hasDeps = await checkDependencies();
    if (!hasDeps) {
        process.exit(1);
    }
    
    try {
        await runTests();
    } catch (error) {
        console.error('❌ Test execution failed:', error.message);
        process.exit(1);
    }
}

// Execute if run directly
if (require.main === module) {
    main();
}

module.exports = { runTests, testCases, generateReviewAnalysisPrompt };
