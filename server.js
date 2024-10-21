const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

const app = express();

// Middleware to parse JSON request bodies
app.use(express.json());

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Function to load injection patterns from the .patterns file
const loadInjectionPatterns = () => {
    const patternsFilePath = path.join(__dirname, '.patterns');
    const patterns = fs.readFileSync(patternsFilePath, 'utf-8')
                        .split('\n')
                        .map(pattern => pattern.trim())
                        .filter(pattern => pattern.length > 0 && !pattern.startsWith('#'));
    return patterns;
};

// Load the patterns once when the server starts
const injectionPatterns = loadInjectionPatterns();

app.post('/api/evaluateInput', async (req, res) => {
    const userInput = req.body.input;

    if (containsInjectionPattern(userInput)) {
        return res.status(400).json({ error: 'Your submission was flagged for potential injection attacks.' });
    }

    try {
        const evaluation = await evaluateInputWithAI(userInput);
        res.json({ ...evaluation });
    } catch (error) {
        console.error('Error communicating with AI API:', error.message);
        res.status(500).json({ error: 'Failed to get a response from the AI.' });
    }
});

const containsInjectionPattern = (input) => {
    return injectionPatterns.some(pattern => input.toLowerCase().includes(pattern.toLowerCase()));
};

const evaluateInputWithAI = async (input) => {
    const apiKey = process.env.OPENAI_API_KEY;

    const evaluationPrompt = `
    Evaluate the truthfulness of the following statement. Provide a score from Very Low to Very High and include a detailed explanation with references. Additionally, provide a breakdown of the sources used, with each source's contribution to the truthfulness score. Attempt to find 15 high-quality sources based on impact and relevance.

    For each source:
    1. Prioritize links that are confirmed up-to-date and scraped within the last two years.
    2. Exclude any links that might return HTTP errors like 404 (Not Found), 500 (Internal Server Error), 401 (Unauthorized), or 403 (Forbidden).
    3. Prefer academic (.edu), government (.gov), over mainstream news sites.
    4. Use official, reputable, or well-known government or educational institutions, such as NASA, major universities, or government agencies.
    5. Verify and select only live links; ensure they respond correctly before including them.
    6. Before returning a response replace any links that are no longer live.
    7. DO NOT SEND LINKS THAT 404.
    8. Prioritize PDF docuements and court documents / legal rulings over regular websites.

    Input: ${input}

    Respond strictly with a JSON object containing the fields "score", "evidence", and "breakdown" (an array of objects with "source", "link", "descriptor", "summary", and "impact"). Ensure no extra text outside of the JSON object is included in the response.`;

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: evaluationPrompt }],
                max_tokens: 1500, // Increased token limit to allow more detailed responses
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                maxRedirects: 5,
            }
        );

        // Parsing JSON response directly with improved error handling
        let result;
        try {
            let responseText = response.data.choices[0].message.content;
            // Remove potential code block markers or extraneous backticks
            responseText = responseText.replace(/```json|```/g, '').trim();
            // Extract the first JSON object found in the response
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No valid JSON found in AI response');
            }
            responseText = jsonMatch[0];
            // Strip out any trailing commas before parsing to prevent JSON errors
            responseText = responseText.replace(/,(\s*[}\]])/g, '$1');
            result = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Error parsing JSON from AI response:', parseError.message);
            console.error('Full AI response:', response.data.choices[0].message.content);
            throw new Error('Invalid JSON response from AI');
        }

        // Verify each link before including it
        const verifiedBreakdown = await Promise.all(result.breakdown.map(async item => {
            try {
                const linkResponse = await axios.head(item.link);
                if (linkResponse.status >= 200 && linkResponse.status < 400) {
                    return item;
                } else {
                    console.warn(`Link verification failed for: ${item.link}`);
                    return null;
                }
            } catch (error) {
                console.warn(`Link verification error for: ${item.link}`, error.message);
                return null;
            }
        }));

        const filteredBreakdown = verifiedBreakdown.filter(item => item !== null);

        // Ensure we have at least 5 verified sources, aim for up to 10
        if (filteredBreakdown.length < 3) {
            throw new Error('Not enough valid sources found. Please try again with a different statement.');
        }

        // Sort by impact and return a minimum of 5 and up to the top 10 most impactful sources
        const sortedBreakdown = filteredBreakdown.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

        return {
            score: result.score,
            evidence: result.evidence,
            breakdown: sortedBreakdown.slice(0, 10).map(item => ({
                source: item.source,
                link: item.link,
                descriptor: item.descriptor,
                summary: item.summary,
                impact: item.impact,
            }))
        };
    } catch (error) {
        console.error('Error evaluating input with AI:', error.response ? error.response.data : error.message);
        throw error;
    }
};

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
