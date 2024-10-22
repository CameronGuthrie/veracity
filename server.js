const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const compression = require('compression');

// Load environment variables from .env file
dotenv.config();

// If average token usage is around 1400
const MAX_TOKENS = 1500;

const app = express();

// Use compression middleware
app.use(compression());

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

const asyncPool = async (poolLimit, array, iteratorFn) => {
    const ret = [];
    const executing = [];
    for (const item of array) {
        const p = Promise.resolve().then(() => iteratorFn(item));
        ret.push(p);
    
        if (poolLimit <= array.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= poolLimit) {
            await Promise.race(executing);
            }
        }
    }
    return Promise.all(ret);
};
  

app.post('/api/evaluateInput', async (req, res) => {
    const userInput = req.body.input;

    if (containsInjectionPattern(userInput)) {
        return res.status(400).json({ error: 'Your submission was flagged for potential injection attacks.' });
    }

    // Check with the Moderation API
    const isDisallowed = await checkForDisallowedContent(userInput);
    if (isDisallowed) {
        return res.status(400).json({ error: 'Your submission contains disallowed content.' });
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
    return injectionPatterns.some(pattern => {
        try {
            const regex = new RegExp(pattern, 'i');
            return regex.test(input);
        } catch (e) {
            console.error(`Invalid regex pattern: ${pattern}`, e);
            return false;
        }
    });
};

const checkForDisallowedContent = async (input) => {
    const apiKey = process.env.OPENAI_API_KEY;

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/moderations',
            {
                input: input,
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const results = response.data.results[0];
        return results.flagged;
    } catch (error) {
        console.error('Error checking content with Moderation API:', error.message);
        // Decide how to handle errors (e.g., default to rejecting input)
        return true; // Reject input if Moderation API fails
    }
};


const evaluateInputWithAI = async (input) => {
    const startTime = Date.now();
    const apiKey = process.env.OPENAI_API_KEY;

    const evaluationPrompt = `
    Evaluate the truthfulness of the following statement. Provide:
    
    - A truthfulness score (Very Low to Very High).
    - A detailed explanation with references.
    - A breakdown of up to 10 high-quality sources, detailing each source's contribution to the score.
    
    Source selection criteria:
    
    - Use sources that are less likely to change over time, such as well-established publications, books, or scientific papers.
    - Prefer sources from reputable domains (e.g., .edu, .gov, .org).
    - Include sources with stable URLs, such as permanent digital object identifiers (DOIs) or archived web pages.
    - Do not include links if you're unsure about their current status; instead, provide sufficient information (e.g., title, author, publication date) to identify the source.
    
    Input: ${input}
    `;

    const functions = [
        {
            name: "evaluate_statement",
            description: "Evaluates the truthfulness of a statement with evidence and source breakdown.",
            parameters: {
                type: "object",
                properties: {
                    score: {
                        type: "string",
                        description: "The truthfulness score (e.g., Very Low to Very High).",
                    },
                    evidence: {
                        type: "string",
                        description: "Detailed explanation with references.",
                    },
                    breakdown: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                source: {
                                    type: "string",
                                    description: "Name of the source.",
                                },
                                link: {
                                    type: "string",
                                    description: "URL to the source (if available).",
                                },
                                descriptor: {
                                    type: "string",
                                    description: "Brief description of the source.",
                                },
                                summary: {
                                    type: "string",
                                    description: "Summary of how the source relates to the statement.",
                                },
                                impact: {
                                    type: "number",
                                    description: "Numerical value indicating the source's impact on the truthfulness score.",
                                },
                            },
                            required: ["source", "descriptor", "summary", "impact"],
                        },
                        description: "Breakdown of sources used.",
                    },
                },
                required: ["score", "evidence", "breakdown"],
            },
        },
    ];    

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: "gpt-4o-mini", // Ensure the model supports function calling
                messages: [{ role: "user", content: evaluationPrompt }],
                functions: functions,
                function_call: { "name": "evaluate_statement" },
                max_tokens: MAX_TOKENS, // Increased token limit
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                maxRedirects: 5,
            }
        );

        // Parsing the function call arguments
        let result;

        const aiResponseTime = Date.now();
        console.log(`AI response time: ${aiResponseTime - startTime}ms`);

        try {
            const functionCall = response.data.choices[0].message.function_call;
            if (!functionCall || !functionCall.arguments) {
                throw new Error('No function call arguments found in AI response');
            }

            let args = functionCall.arguments;

            // Log the raw arguments
            console.log('Raw function call arguments:', args);

            // Attempt to fix common JSON issues
            args = args.trim();
            args = args.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

            result = JSON.parse(args);
        } catch (parseError) {
            console.error('Error parsing function call arguments:', parseError.message);
            console.error('Function call arguments received:', functionCall.arguments);
            throw new Error('Invalid function call response from AI');
        }

        const poolLimit = 5; // Set your concurrency limit

        const verifiedBreakdown = await asyncPool(poolLimit, result.breakdown, async (item) => {
            if (item.link) {
                try {
                    const linkResponse = await axios.head(item.link, { timeout: 5000 });
                    if (linkResponse.status >= 200 && linkResponse.status < 400) {
                        return item;
                    } else {
                        console.warn(`Link verification failed for: ${item.link}`);
                        item.link = null; // Remove the invalid link
                        return item; // Still include the item without the link
                    }
                } catch (error) {
                    console.warn(`Link verification error for: ${item.link}`, error.message);
                    item.link = null; // Remove the invalid link
                    return item; // Include the item without the link
                }
            } else {
                // No link provided; include the item as is
                return item;
            }
        });
        

        const filteredBreakdown = verifiedBreakdown.filter(item => item !== null);
          
        const linkVerificationTime = Date.now();
        console.log(`Link verification time: ${linkVerificationTime - aiResponseTime}ms`);

        // Ensure we have at least 5 verified sources, aim for up to 10
        if (filteredBreakdown.length < 2) {
            throw new Error('Not enough valid sources found. Please try again with a different statement.');
        }

        // Sort by impact and return a minimum of 5 and up to the top 10 most impactful sources
        const sortedBreakdown = filteredBreakdown.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));


        const totalTime = Date.now() - startTime;
        console.log(`Total evaluation time: ${totalTime}ms`);

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
