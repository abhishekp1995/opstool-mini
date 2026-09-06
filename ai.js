const AI_URL = "http://127.0.0.1:1234/v1/embeddings";
const MODEL = "text-embedding-qwen3-embedding-8b";


// -----------------------------
// Get embeddings
// -----------------------------

async function getEmbeddings(actions) {

    const response = await fetch(AI_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: MODEL,
            input: actions
        })
    });

    if (!response.ok) {
        throw new Error(
            `AI request failed: ${response.status} ${response.statusText}`
        );
    }

    const data = await response.json();

    if (!data.data || !Array.isArray(data.data)) {
        throw new Error("AI returned an invalid embedding response.");
    }

    return data.data
        .sort((a, b) => a.index - b.index)
        .map(item => item.embedding);
}


// -----------------------------
// Cosine similarity
// -----------------------------

function cosineSimilarity(a, b) {

    if (a.length !== b.length) {
        throw new Error("Embedding dimensions do not match.");
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        magnitudeA += a[i] * a[i];
        magnitudeB += b[i] * b[i];
    }

    if (magnitudeA === 0 || magnitudeB === 0) {
        return 0;
    }

    return dotProduct /
        (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}