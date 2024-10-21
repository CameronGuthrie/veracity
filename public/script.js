document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('inputSubmissionForm');
    const userInput = document.getElementById('userInput');
    const errorElement = document.getElementById('error');
    const responseContainer = document.getElementById('responseContainer');
    const scoreElement = document.getElementById('score');
    const evidenceElement = document.getElementById('evidence');
    const breakdownContainer = document.getElementById('breakdownContainer');

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        const input = userInput.value.trim();

        if (!input) {
            showError('Please provide an input statement.');
            return;
        }

        submitInput(input);
    });

    function showError(message) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }

    function hideError() {
        errorElement.style.display = 'none';
    }

    function clearPreviousResponse() {
        scoreElement.textContent = '';
        evidenceElement.textContent = '';
        breakdownContainer.innerHTML = '';
        responseContainer.style.display = 'none';
    }

    async function submitInput(input) {
        hideError();
        clearPreviousResponse();

        try {
            const response = await fetch('/api/evaluateInput', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ input }),
            });

            if (!response.ok) {
                throw new Error('Failed to get a valid response from the server.');
            }

            let responseText = await response.text();
            // Remove potential code block markers or extraneous backticks
            responseText = responseText.replace(/```json|```/g, '').trim();
            // Remove unexpected trailing commas or fix any malformed JSON
            responseText = responseText.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

            try {
                const data = JSON.parse(responseText);
                if (data.error) {
                    showError(data.error);
                } else {
                    responseContainer.style.display = 'block';
                    scoreElement.textContent = `Veracity Score: ${data.score}`;
                    evidenceElement.textContent = `Evidence: ${data.evidence}`;
                    displayBreakdown(data.breakdown);
                }
            } catch (parseError) {
                console.error('Error parsing JSON from response:', parseError);
                showError('There was an error processing the AI response. Please try again later.');
            }
        } catch (error) {
            console.error('Error:', error);
            showError('There was an error processing your request. Please try again later.');
        }
    }

    function displayBreakdown(breakdown) {
        if (!breakdown || breakdown.length === 0) {
            return;
        }

        const table = document.createElement('table');
        table.classList.add('breakdown-table');

        const headerRow = document.createElement('tr');
        headerRow.innerHTML = `
            <th>Source</th>
            <th>Descriptor</th>
            <th>Summary</th>
        `;
        // <th>Impact on Score</th>
        table.appendChild(headerRow);

        breakdown.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><a href="${item.link}" target="_blank">${item.source}</a></td>
                <td>${item.descriptor}</td>
                <td>${item.summary}</td>
            `;
            // <td style="text-align: center;">${item.impact}</td>
            table.appendChild(row);
        });

        breakdownContainer.appendChild(table);
    }
});