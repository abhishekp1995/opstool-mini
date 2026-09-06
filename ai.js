const AI_URL = "http://127.0.0.1:1234/v1/chat/completions";
const MODEL = "nvidia/nemotron-3-nano-4b";

async function analyzeActions(actions) {

    const prompt = ANALYSIS_PROMPT.replace(
        "{{ACTIONS}}",
        JSON.stringify(actions, null, 2)
    );

    const response = await fetch(AI_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content:
                        "You are a precise data clustering assistant. Follow the requested JSON format exactly."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.1,
            //max_tokens: 4096
        })
    });

    if (!response.ok) {
        throw new Error(
            `AI request failed: ${response.status} ${response.statusText}`
        );
    }

    const data = await response.json();

    if (
        !data.choices ||
        !Array.isArray(data.choices) ||
        !data.choices[0]?.message?.content
    ) {
        throw new Error("AI returned an invalid response.");
    }

    let content = data.choices[0].message.content.trim();

    // Handle models that wrap JSON in ```json ... ```
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