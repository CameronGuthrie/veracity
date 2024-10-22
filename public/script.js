document.addEventListener('DOMContentLoaded', function() {

    var quill = new Quill('#editor', {
        theme: 'snow'
    });

    const form = document.getElementById('inputSubmissionForm');
    const userInput = document.getElementById('userInput');
    const errorElement = document.getElementById('error');
    const responseContainer = document.getElementById('responseContainer');
    // const scoreElement = document.getElementById('score');
    const evidenceElement = document.getElementById('evidence');
    const breakdownContainer = document.getElementById('breakdownContainer');

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        const input = quill.getText().trim();

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
        // scoreElement.textContent = '';
        evidenceElement.textContent = '';
        breakdownContainer.innerHTML = '';
        responseContainer.style.display = 'none';
    }

    function mapVeracityScore(score) {
        const scoreMapping = {
            "Very Low": { percentage: 0, colorClass: 'low-veracity' },
            "Low": { percentage: 25, colorClass: 'low-veracity' },
            "Medium": { percentage: 50, colorClass: 'medium-veracity' },
            "High": { percentage: 75, colorClass: 'high-veracity' },
            "Very High": { percentage: 100, colorClass: 'high-veracity' },
        };
        return scoreMapping[score] || { percentage: 0, colorClass: 'low-veracity' };
    }
    
    async function submitInput(input) {
        hideError();
        clearPreviousResponse();
        showLoadingIndicator(); // Show loading indicator
    
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
    
                    // Update the veracity bar
                    const veracityBarFill = document.getElementById('veracityBarFill');
                    const { percentage, colorClass } = mapVeracityScore(data.score);const veracityBarText = document.getElementById('veracityBarText');
                    veracityBarText.textContent = data.score;
    
                    veracityBarFill.style.width = `${percentage}%`;
    
                    // Remove existing color classes
                    veracityBarFill.classList.remove('low-veracity', 'medium-veracity', 'high-veracity');
                    // Add the new color class
                    veracityBarFill.classList.add(colorClass);
    
                    // Update the evidence text
                    evidenceElement.textContent = data.evidence;
                    displayBreakdown(data.breakdown);
                }
            } catch (parseError) {
                console.error('Error parsing JSON from response:', parseError);
                showError('There was an error processing the AI response. Please try again later.');
            }
        } catch (error) {
            console.error('Error:', error);
            showError('There was an error processing your request. Please try again later.');
        } finally {
            hideLoadingIndicator(); // Hide loading indicator
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
        table.appendChild(headerRow);
    
        breakdown.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.link ? `<a href="${item.link}" target="_blank">${item.source}</a>` : item.source}</td>
                <td style="padding: 1em 1em 0em 1em;">${item.descriptor}</td>
                <td>${item.summary}</td>
            `;
            table.appendChild(row);
        });
    
        breakdownContainer.appendChild(table);
    }
    
});

function showLoadingIndicator() {
    document.getElementById('loadingIndicator').style.display = 'block';
}

function hideLoadingIndicator() {
    document.getElementById('loadingIndicator').style.display = 'none';
}