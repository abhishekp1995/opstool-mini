/*
 * Recurring Issue Analyzer
 * Semantic clustering engine
 *
 * Input:
 *   clusterActions(actions, embeddings, minimumOccurrences)
 *
 * Output:
 *   [
 *      { issue: "representative action", count: 12 },
 *      ...
 *   ]
 *
 * The minimum occurrence threshold is NOT a similarity threshold.
 * It only determines which completed clusters are shown.
 */

function clusterActions(actions, embeddings, minimumOccurrences = 2) {

    validateInputs(actions, embeddings);

    const minCount = parseMinimumOccurrences(minimumOccurrences);

    if (!actions.length) {
        return [];
    }

    const items = prepareItems(actions, embeddings);

    if (!items.length) {
        return [];
    }

    /*
     * ---------------------------------------------------------
     * STEP 1
     * Exact / normalized duplicate collapsing
     * ---------------------------------------------------------
     */

    const uniqueItems = collapseDuplicates(items);

    console.log(
        "[Clustering] Input actions:",
        actions.length
    );

    console.log(
        "[Clustering] Unique actions after duplicate collapse:",
        uniqueItems.length
    );

    if (uniqueItems.length === 1) {
        return uniqueItems[0].count >= minCount
            ? [{
                issue: uniqueItems[0].text,
                count: uniqueItems[0].count
            }]
            : [];
    }

    /*
     * ---------------------------------------------------------
     * STEP 2
     * Build compact lexical signatures.
     *
     * This is NOT used as the primary semantic signal.
     * It simply helps recover obvious candidates that an
     * embedding neighbour search might miss.
     * ---------------------------------------------------------
     */

    for (const item of uniqueItems) {
        item.tokens = tokenize(item.text);
        item.tokenSet = new Set(item.tokens);
        item.signature = buildSignature(item.tokens);
    }

    /*
     * ---------------------------------------------------------
     * STEP 3
     * Build semantic candidate graph.
     *
     * We use random-hyperplane LSH to avoid comparing every
     * 4096-dimensional vector against every other vector.
     * ---------------------------------------------------------
     */

    const graph = buildCandidateGraph(uniqueItems);

    let candidateLinks = 0;

    for (const neighbours of graph) {
        candidateLinks += neighbours.size;
    }

    console.log(
        "[Clustering] Candidate links:",
        candidateLinks / 2
    );

    console.log(
        "[Clustering] Average candidates per action:",
        (candidateLinks / uniqueItems.length).toFixed(2)
    );

    /*
     * ---------------------------------------------------------
     * STEP 4
     * Score candidate relationships.
     *
     * Semantic similarity is primary.
     * Lexical overlap is only supporting evidence.
     * ---------------------------------------------------------
     */

    const edges = [];

    for (let i = 0; i < uniqueItems.length; i++) {

        const candidates = graph[i];

        for (const j of candidates) {

            if (j <= i) {
                continue;
            }

            const a = uniqueItems[i];
            const b = uniqueItems[j];

            const semantic = cosineSimilarity(a.embedding, b.embedding);

            const lexical = lexicalSimilarity(a, b);

            const score = combinedSimilarity(
                semantic,
                lexical
            );

            edges.push({
                a: i,
                b: j,
                semantic,
                lexical,
                score
            });
        }
    }

    /*
     * ---------------------------------------------------------
     * STEP 5
     * Determine adaptive similarity levels from the dataset.
     *
     * There is deliberately no universal "0.80" rule.
     * ---------------------------------------------------------
     */

    const thresholds = calculateAdaptiveThresholds(edges);

    /*
     * ---------------------------------------------------------
     * STEP 6
     * Construct strong semantic graph.
     * ---------------------------------------------------------
     */

    const strongEdges = selectStrongEdges(
        edges,
        thresholds
    );

    /*
     * ---------------------------------------------------------
     * STEP 7
     * Mutual-neighbour validation.
     *
     * Prevents long semantic chains such as:
     *
     * A ~ B
     * B ~ C
     * C ~ D
     *
     * accidentally becoming one giant cluster when A and D
     * are actually unrelated.
     * ---------------------------------------------------------
     */

    const validatedEdges = validateMutualRelationships(
        strongEdges,
        uniqueItems
    );

    /*
     * ---------------------------------------------------------
     * STEP 8
     * Initial connected components.
     * ---------------------------------------------------------
     */

    let clusters = connectedComponents(
        uniqueItems.length,
        validatedEdges
    );

    /*
     * ---------------------------------------------------------
     * STEP 9
     * Refine clusters.
     *
     * Weak internal relationships are removed and clusters
     * are split when cohesion is poor.
     * ---------------------------------------------------------
     */

    clusters = refineClusters(
        clusters,
        uniqueItems,
        thresholds
    );

    /*
     * ---------------------------------------------------------
     * STEP 10
     * Convert clusters into user-facing results.
     * ---------------------------------------------------------
     */

    const results = [];

    for (const cluster of clusters) {

        let totalCount = 0;

        for (const index of cluster) {
            totalCount += uniqueItems[index].count;
        }

        if (totalCount < minCount) {
            continue;
        }

        const representative = chooseRepresentative(
            cluster,
            uniqueItems
        );

        results.push({
            issue: representative,
            count: totalCount
        });
    }

    /*
     * Highest-frequency recurring issues first.
     */

    results.sort((a, b) => {

        if (b.count !== a.count) {
            return b.count - a.count;
        }

        return a.issue.localeCompare(b.issue);
    });

    return results;
}


/* ============================================================
   INPUT VALIDATION
   ============================================================ */

function validateInputs(actions, embeddings) {

    if (!Array.isArray(actions)) {
        throw new Error("Actions must be an array.");
    }

    if (!Array.isArray(embeddings)) {
        throw new Error("Embeddings must be an array.");
    }

    if (actions.length !== embeddings.length) {
        throw new Error(
            "The number of actions and embeddings does not match."
        );
    }

    if (!actions.length) {
        return;
    }

    const dimensions = embeddings[0].length;

    if (!dimensions) {
        throw new Error("Embeddings contain no dimensions.");
    }

    for (let i = 0; i < embeddings.length; i++) {

        if (!Array.isArray(embeddings[i])) {
            throw new Error(
                `Invalid embedding at index ${i}.`
            );
        }

        if (embeddings[i].length !== dimensions) {
            throw new Error(
                "Embedding dimensions do not match."
            );
        }
    }
}


function parseMinimumOccurrences(value) {

    if (value === "20+") {
        return 20;
    }

    const number = Number(value);

    if (!Number.isFinite(number) || number < 1) {
        return 2;
    }

    return Math.floor(number);
}


/* ============================================================
   ITEM PREPARATION
   ============================================================ */

function prepareItems(actions, embeddings) {

    const items = [];

    for (let i = 0; i < actions.length; i++) {

        const text = String(actions[i] ?? "").trim();

        if (!text) {
            continue;
        }

        const vector = embeddings[i];

        if (!vector || !vector.length) {
            continue;
        }

        items.push({
            text,
            embedding: vector,
            count: 1,
            originalIndexes: [i]
        });
    }

    return items;
}


/* ============================================================
   NORMALIZATION / DUPLICATES
   ============================================================ */

function normalizeText(text) {

    return String(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}


function collapseDuplicates(items) {

    const map = new Map();

    for (const item of items) {

        const key = normalizeText(item.text);

        if (!key) {
            continue;
        }

        if (!map.has(key)) {

            map.set(key, {
                text: item.text,
                embedding: Array.from(item.embedding),
                count: item.count,
                originalIndexes: [...item.originalIndexes]
            });

        } else {

            const existing = map.get(key);

            existing.count += item.count;

            existing.originalIndexes.push(
                ...item.originalIndexes
            );

            /*
             * Average duplicate embeddings.
             *
             * Usually identical text gives practically identical
             * embeddings, but averaging makes this robust.
             */

            for (
                let i = 0;
                i < existing.embedding.length;
                i++
            ) {
                existing.embedding[i] =
                    (
                        existing.embedding[i] *
                        (existing.count - item.count)
                        +
                        item.embedding[i] *
                        item.count
                    ) / existing.count;
            }
        }
    }

    return Array.from(map.values());
}


/* ============================================================
   TOKENIZATION
   ============================================================ */

function tokenize(text) {

    const normalized = normalizeText(text);

    if (!normalized) {
        return [];
    }

    const raw = normalized.split(" ");

    /*
     * Very common generic words don't help identify an issue.
     */

    const stopWords = new Set([
        "a",
        "an",
        "the",
        "and",
        "or",
        "to",
        "of",
        "in",
        "on",
        "for",
        "with",
        "from",
        "is",
        "was",
        "be",
        "as",
        "at",
        "by",
        "into",
        "this",
        "that",
        "item",
        "data",
        "value",
        "change",
        "changed",
        "update",
        "updated"
    ]);

    return raw.filter(
        token =>
            token.length >= 2 &&
            !stopWords.has(token)
    );
}


function buildSignature(tokens) {

    return tokens
        .slice()
        .sort()
        .join("|");
}


/* ============================================================
   LSH CANDIDATE DISCOVERY
   ============================================================ */

function buildCandidateGraph(items) {

    const n = items.length;

    const graph = Array.from(
        { length: n },
        () => new Set()
    );

    /*
     * More tables = better recall.
     * More bits = more selective buckets.
     *
     * These are candidate-generation parameters, NOT
     * semantic similarity thresholds.
     */

    const tableCount = 8;
    const bitsPerTable = 16;

    const planes = createRandomPlanes(
        items[0].embedding.length,
        tableCount,
        bitsPerTable
    );

    const buckets = [];

    for (let t = 0; t < tableCount; t++) {

        buckets.push(new Map());

        for (let i = 0; i < n; i++) {

            const hash = hyperplaneHash(
                items[i].embedding,
                planes[t]
            );

            if (!buckets[t].has(hash)) {
                buckets[t].set(hash, []);
            }

            buckets[t].get(hash).push(i);
        }
    }

    /*
     * Same-bucket candidates.
     */

    for (let t = 0; t < tableCount; t++) {

        const table = buckets[t];

        for (const bucket of table.values()) {

            /*
             * Avoid pathological giant buckets.
             * If a bucket is huge, lexical/semantic filtering
             * later will still protect us.
             */

            const limit = Math.min(
                bucket.length,
                250
            );

            for (let x = 0; x < limit; x++) {

                for (let y = x + 1; y < limit; y++) {

                    const a = bucket[x];
                    const b = bucket[y];

                    graph[a].add(b);
                    graph[b].add(a);
                }
            }
        }
    }

    /*
     * Multi-probe:
     *
     * Flip one bit at a time to recover nearby vectors that
     * landed in an adjacent LSH bucket.
     */

    for (let t = 0; t < tableCount; t++) {

        const table = buckets[t];

        for (let i = 0; i < n; i++) {

            const baseHash = hyperplaneHash(
                items[i].embedding,
                planes[t]
            );

            for (let bit = 0; bit < bitsPerTable; bit++) {

                const probeHash =
                    baseHash ^ (1 << bit);

                const bucket = table.get(probeHash);

                if (!bucket) {
                    continue;
                }

                const limit = Math.min(
                    bucket.length,
                    100
                );

                for (let k = 0; k < limit; k++) {

                    const j = bucket[k];

                    if (j !== i) {
                        graph[i].add(j);
                        graph[j].add(i);
                    }
                }
            }
        }
    }

    /*
     * Lexical recovery.
     *
     * If two actions share meaningful tokens, make them
     * candidates even if their LSH signatures differ.
     */

    const tokenIndex = new Map();

    for (let i = 0; i < n; i++) {

        for (const token of items[i].tokens) {

            if (!tokenIndex.has(token)) {
                tokenIndex.set(token, []);
            }

            tokenIndex.get(token).push(i);
        }
    }

    for (const indexes of tokenIndex.values()) {

        if (indexes.length > 150) {
            continue;
        }

        for (let x = 0; x < indexes.length; x++) {

            for (let y = x + 1; y < indexes.length; y++) {

                const a = indexes[x];
                const b = indexes[y];

                graph[a].add(b);
                graph[b].add(a);
            }
        }
    }

    return graph;
}


function createRandomPlanes(
    dimensions,
    tableCount,
    bitsPerTable
) {

    const allPlanes = [];

    /*
     * Deterministic pseudo-random generator.
     *
     * This means the same dataset produces the same LSH
     * structure on every run.
     */

    let seed = 918273645;

    function random() {

        seed =
            (seed * 1664525 + 1013904223) >>> 0;

        return seed / 4294967296;
    }

    for (let t = 0; t < tableCount; t++) {

        const table = [];

        for (let b = 0; b < bitsPerTable; b++) {

            const plane = new Float32Array(dimensions);

            for (let d = 0; d < dimensions; d++) {

                plane[d] =
                    random() * 2 - 1;
            }

            table.push(plane);
        }

        allPlanes.push(table);
    }

    return allPlanes;
}


function hyperplaneHash(vector, planes) {

    let hash = 0;

    for (let bit = 0; bit < planes.length; bit++) {

        const plane = planes[bit];

        let dot = 0;

        for (let i = 0; i < vector.length; i++) {
            dot += vector[i] * plane[i];
        }

        if (dot >= 0) {
            hash |= (1 << bit);
        }
    }

    return hash;
}


/* ============================================================
   SIMILARITY
   ============================================================ */

function lexicalSimilarity(a, b) {

    if (!a.tokens.length || !b.tokens.length) {
        return 0;
    }

    let intersection = 0;

    const smaller =
        a.tokenSet.size <= b.tokenSet.size
            ? a.tokenSet
            : b.tokenSet;

    const larger =
        a.tokenSet.size <= b.tokenSet.size
            ? b.tokenSet
            : a.tokenSet;

    for (const token of smaller) {

        if (larger.has(token)) {
            intersection++;
        }
    }

    const union =
        a.tokenSet.size +
        b.tokenSet.size -
        intersection;

    if (!union) {
        return 0;
    }

    return intersection / union;
}


function combinedSimilarity(
    semantic,
    lexical
) {

    /*
     * Embedding similarity is dominant.
     *
     * Lexical similarity can strengthen a relationship,
     * but cannot rescue a semantically unrelated pair.
     */

    if (semantic < 0.55) {
        return semantic;
    }

    if (lexical >= 0.75) {
        return Math.min(
            1,
            semantic * 0.75 + lexical * 0.25
        );
    }

    if (lexical >= 0.40) {
        return Math.min(
            1,
            semantic * 0.85 + lexical * 0.15
        );
    }

    return semantic;
}


function cosineSimilarity(a, b) {

    if (a.length !== b.length) {
        throw new Error(
            "Embedding dimensions do not match."
        );
    }

    let dot = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {

        const x = a[i];
        const y = b[i];

        dot += x * y;
        magnitudeA += x * x;
        magnitudeB += y * y;
    }

    if (
        magnitudeA === 0 ||
        magnitudeB === 0
    ) {
        return 0;
    }

    return dot /
        (
            Math.sqrt(magnitudeA) *
            Math.sqrt(magnitudeB)
        );
}


/* ============================================================
   ADAPTIVE THRESHOLDS
   ============================================================ */

function calculateAdaptiveThresholds(edges) {

    if (!edges.length) {

        return {
            strong: 1,
            medium: 1,
            weak: 1
        };
    }

    const scores = edges
        .map(edge => edge.score)
        .sort((a, b) => a - b);

    const q50 = percentile(scores, 0.50);
    const q75 = percentile(scores, 0.75);
    const q90 = percentile(scores, 0.90);
    const q95 = percentile(scores, 0.95);

    /*
     * The thresholds are dataset-relative.
     *
     * We still maintain sensible semantic floors so a dataset
     * with generally poor embeddings doesn't cause nonsense
     * mega-clusters.
     */

    const strong = Math.max(
        0.70,
        Math.min(
            0.94,
            q75
        )
    );

    const medium = Math.max(
        0.64,
        Math.min(
            strong - 0.025,
            q50
        )
    );

    const weak = Math.max(
        0.58,
        Math.min(
            medium - 0.025,
            q90
        )
    );

    return {
        strong,
        medium,
        weak,
        q90,
        q95
    };
}


function percentile(values, p) {

    if (!values.length) {
        return 0;
    }

    const index =
        (values.length - 1) * p;

    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
        return values[lower];
    }

    const weight = index - lower;

    return (
        values[lower] * (1 - weight) +
        values[upper] * weight
    );
}


/* ============================================================
   EDGE SELECTION
   ============================================================ */

function selectStrongEdges(edges, thresholds) {

    const selected = [];

    for (const edge of edges) {

        /*
         * Very strong semantic relationships are accepted.
         */

        if (edge.semantic >= thresholds.strong) {
            selected.push(edge);
            continue;
        }

        /*
         * Medium-strength relationships need lexical support.
         */

        if (
            edge.semantic >= thresholds.medium &&
            edge.lexical >= 0.20
        ) {
            selected.push(edge);
            continue;
        }

        /*
         * Very high semantic similarity can stand alone.
         */

        if (
            edge.semantic >= 0.88 &&
            edge.score >= thresholds.weak
        ) {
            selected.push(edge);
        }
    }

    return selected;
}


/* ============================================================
   MUTUAL RELATIONSHIP VALIDATION
   ============================================================ */

function validateMutualRelationships(
    edges,
    items
) {

    const adjacency = new Map();

    for (let i = 0; i < items.length; i++) {
        adjacency.set(i, []);
    }

    for (const edge of edges) {

        adjacency.get(edge.a).push(edge);
        adjacency.get(edge.b).push(edge);
    }

    /*
     * Calculate each item's local neighbourhood quality.
     */

    const localScores = new Map();

    for (const [index, list] of adjacency) {

        const scores = list
            .map(edge => edge.score)
            .sort((a, b) => b - a);

        /*
         * Keep the useful upper neighbourhood rather than
         * allowing one item with dozens of weak relationships
         * to dominate the graph.
         */

        const keep =
            scores.slice(
                0,
                Math.max(
                    3,
                    Math.min(12, scores.length)
                )
            );

        localScores.set(
            index,
            keep.length
                ? average(keep)
                : 0
        );
    }

    const result = [];

    for (const edge of edges) {

        const aLocal =
            localScores.get(edge.a) || 0;

        const bLocal =
            localScores.get(edge.b) || 0;

        /*
         * Strong semantic edges survive easily.
         */

        if (edge.semantic >= 0.88) {
            result.push(edge);
            continue;
        }

        /*
         * Otherwise require the relationship to be credible
         * from both sides.
         */

        const localQuality =
            Math.min(
                aLocal,
                bLocal
            );

        if (
            edge.score >= localQuality * 0.88 &&
            edge.score >= 0.67
        ) {
            result.push(edge);
        }
    }

    return result;
}


/* ============================================================
   CONNECTED COMPONENTS
   ============================================================ */

function connectedComponents(
    itemCount,
    edges
) {

    const parent = Array.from(
        { length: itemCount },
        (_, i) => i
    );

    const rank = new Array(itemCount).fill(0);

    function find(x) {

        while (parent[x] !== x) {

            parent[x] = parent[parent[x]];
            x = parent[x];
        }

        return x;
    }

    function union(a, b) {

        let rootA = find(a);
        let rootB = find(b);

        if (rootA === rootB) {
            return;
        }

        if (rank[rootA] < rank[rootB]) {
            [rootA, rootB] = [rootB, rootA];
        }

        parent[rootB] = rootA;

        if (rank[rootA] === rank[rootB]) {
            rank[rootA]++;
        }
    }

    for (const edge of edges) {
        union(edge.a, edge.b);
    }

    const groups = new Map();

    for (let i = 0; i < itemCount; i++) {

        const root = find(i);

        if (!groups.has(root)) {
            groups.set(root, []);
        }

        groups.get(root).push(i);
    }

    return Array.from(groups.values());
}


/* ============================================================
   CLUSTER REFINEMENT
   ============================================================ */

function refineClusters(
    clusters,
    items,
    thresholds
) {

    const refined = [];

    for (const cluster of clusters) {

        if (cluster.length <= 2) {

            refined.push(cluster);
            continue;
        }

        const result =
            splitWeakCluster(
                cluster,
                items,
                thresholds
            );

        for (const part of result) {
            refined.push(part);
        }
    }

    return refined;
}


function splitWeakCluster(
    cluster,
    items,
    thresholds
) {

    /*
     * Calculate centroid.
     */

    const centroid =
        calculateCentroid(
            cluster,
            items
        );

    const members = [];

    for (const index of cluster) {

        const similarity =
            cosineSimilarity(
                items[index].embedding,
                centroid
            );

        members.push({
            index,
            similarity
        });
    }

    /*
     * Very weak members become possible outliers.
     */

    const similarities =
        members
            .map(x => x.similarity)
            .sort((a, b) => a - b);

    const median =
        percentile(similarities, 0.50);

    const floor =
        Math.max(
            0.62,
            median - 0.10
        );

    const core = [];
    const outliers = [];

    for (const member of members) {

        if (member.similarity >= floor) {
            core.push(member.index);
        } else {
            outliers.push(member.index);
        }
    }

    /*
     * If nothing meaningful was removed, keep cluster.
     */

    if (
        outliers.length === 0 ||
        core.length < 2
    ) {
        return [cluster];
    }

    /*
     * Re-cluster the core recursively.
     */

    const coreEdges = [];

    for (let i = 0; i < core.length; i++) {

        for (let j = i + 1; j < core.length; j++) {

            const a = core[i];
            const b = core[j];

            const semantic =
                cosineSimilarity(
                    items[a].embedding,
                    items[b].embedding
                );

            const lexical =
                lexicalSimilarity(
                    items[a],
                    items[b]
                );

            const score =
                combinedSimilarity(
                    semantic,
                    lexical
                );

            if (
                semantic >= thresholds.strong ||
                (
                    semantic >= thresholds.medium &&
                    lexical >= 0.20
                )
            ) {
                coreEdges.push({
                    a,
                    b,
                    semantic,
                    lexical,
                    score
                });
            }
        }
    }

    /*
     * If the core is still coherent, attach outliers only
     * when they have a strong direct relationship.
     */

    const components =
        connectedComponents(
            items.length,
            coreEdges
        ).filter(
            component =>
                component.some(
                    index => core.includes(index)
                )
        );

    const usefulComponents =
        components.filter(
            component =>
                component.length > 0
        );

    if (usefulComponents.length <= 1) {

        const main =
            usefulComponents[0] || core;

        for (const outlier of outliers) {

            let best = 0;

            for (const member of main) {

                const score =
                    cosineSimilarity(
                        items[outlier].embedding,
                        items[member].embedding
                    );

                if (score > best) {
                    best = score;
                }
            }

            if (best >= 0.86) {
                main.push(outlier);
            }
        }

        return [main];
    }

    return usefulComponents;
}


/* ============================================================
   CENTROID
   ============================================================ */

function calculateCentroid(
    cluster,
    items
) {

    const dimensions =
        items[cluster[0]]
            .embedding.length;

    const centroid =
        new Float32Array(dimensions);

    let totalWeight = 0;

    for (const index of cluster) {

        const item = items[index];

        /*
         * Frequency gives repeated real-world actions slightly
         * more influence than one-off variants.
         */

        const weight =
            Math.sqrt(
                Math.max(
                    1,
                    item.count
                )
            );

        totalWeight += weight;

        for (let d = 0; d < dimensions; d++) {

            centroid[d] +=
                item.embedding[d] *
                weight;
        }
    }

    if (totalWeight > 0) {

        for (let d = 0; d < dimensions; d++) {

            centroid[d] /=
                totalWeight;
        }
    }

    return centroid;
}


/* ============================================================
   REPRESENTATIVE ISSUE
   ============================================================ */

function chooseRepresentative(
    cluster,
    items
) {

    const centroid =
        calculateCentroid(
            cluster,
            items
        );

    let bestIndex = cluster[0];
    let bestScore = -Infinity;

    for (const index of cluster) {

        const item = items[index];

        const semantic =
            cosineSimilarity(
                item.embedding,
                centroid
            );

        /*
         * Prefer a concise representative action.
         * Extremely long actions are less useful as labels.
         */

        const wordCount =
            normalizeText(item.text)
                .split(" ")
                .filter(Boolean)
                .length;

        const lengthPenalty =
            Math.max(
                0,
                wordCount - 8
            ) * 0.005;

        /*
         * Frequency matters, but not enough to blindly choose
         * the most common wording.
         */

        const frequencyBonus =
            Math.min(
                0.08,
                Math.log2(
                    item.count + 1
                ) * 0.012
            );

        const score =
            semantic +
            frequencyBonus -
            lengthPenalty;

        if (score > bestScore) {

            bestScore = score;
            bestIndex = index;
        }
    }

    return items[bestIndex].text;
}


/* ============================================================
   HELPERS
   ============================================================ */

function average(values) {

    if (!values.length) {
        return 0;
    }

    let total = 0;

    for (const value of values) {
        total += value;
    }

    return total / values.length;
}