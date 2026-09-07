const AI_URL = "http://localhost:6655/anthropic/v1/messages";
const MODEL = "anthropic--claude-haiku-latest";

async function analyzeActions(actions) {

    const apiKey = window.prompt("Enter your Claude API key:");

    if (!apiKey || !apiKey.trim()) {
        throw new Error("Claude API key is required.");
    }

    const prompt = ANALYSIS_PROMPT.replace(
        "{{ACTIONS}}",
        JSON.stringify(actions, null, 2)
    );

    const response = await fetch(AI_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey.trim()}`,
            "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 16384,
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ]
        })
    });

    if (!response.ok) {
        let errorMessage =
            `AI request failed: ${response.status} ${response.statusText}`;

        try {
            const errorData = await response.json();

            if (errorData?.error?.message) {
                errorMessage += ` - ${errorData.error.message}`;
            }
        } catch {
            // Keep the original HTTP error message.
        }

        throw new Error(errorMessage);
    }

    const data = await response.json();

    if (
        !data.content ||
        !Array.isArray(data.content) ||
        !data.content[0]?.text
    ) {
        throw new Error("AI returned an invalid response.");
    }

    let content = data.content[0].text.trim();

    // Remove Markdown code fences if Claude returns them.
    content = content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    try {
        return JSON.parse(content);
    } catch {
        throw new Error("AI returned invalid JSON.");
    }
}
