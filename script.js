const fromDate = document.getElementById("fromDate");
const toDate = document.getElementById("toDate");
const minOccurrences = document.getElementById("minOccurrences");
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const fileName = document.getElementById("fileName");
const analyzeBtn = document.getElementById("analyzeBtn");
const errorMessage = document.getElementById("errorMessage");
const resultsBody = document.getElementById("resultsBody");

// -----------------------------
// File selection
// -----------------------------


dropZone.addEventListener("click", () => {
    if (!fromDate.disabled) {
        fileInput.click();
    }
});

fileInput.addEventListener("change", () => {
    clearResults();
    clearError();

    if (fileInput.files.length > 0) {
        fileName.textContent = fileInput.files[0].name;
    } else {
        fileName.textContent = "";
    }

    updateAnalyzeButton();
});


// -----------------------------
// Input changes
// -----------------------------

fromDate.addEventListener("change", () => {
    clearResults();
    clearError();
    updateAnalyzeButton();
});

toDate.addEventListener("change", () => {
    clearResults();
    clearError();
    updateAnalyzeButton();
});

minOccurrences.addEventListener("change", () => {
    clearResults();
    clearError();
});


// -----------------------------
// Analyze button state
// -----------------------------

function updateAnalyzeButton() {
    analyzeBtn.disabled = !(
        fromDate.value &&
        toDate.value &&
        fileInput.files.length > 0
    );
}


// -----------------------------
// Analyze
// -----------------------------

analyzeBtn.addEventListener("click", async () => {

    clearError();

    if (!fromDate.value || !toDate.value || fileInput.files.length === 0) {
        return;
    }

    if (fromDate.value > toDate.value) {
        showError("The From date must be before or equal to the To date.");
        return;
    }

    const file = fileInput.files[0];

    const validExtensions = [".xlsx", ".xls"];

    const extension = file.name
        .substring(file.name.lastIndexOf("."))
        .toLowerCase();

    if (!validExtensions.includes(extension)) {
        showError("Please select a valid Excel file.");
        return;
    }

    startAnalysis();

    try {

        const result = await readExcelFile(file);

        console.log("Filtered actions:", result.actions);
        console.log("Actions found:", result.actions.length);
        console.log("Invalid or missing dates:", result.invalidDateCount);

        if (result.invalidDateCount > 0) {

            console.warn(
                `${result.invalidDateCount} records were excluded due to missing or invalid dates.`
            );

            console.warn(
                "Rows with invalid or missing dates:",
                result.invalidDateRows
            );

            showError(
                `${result.invalidDateCount} records were excluded due to missing or invalid dates. Press F12 and check the console for more details.`
            );
        }

        // --------------------------------
        // Give every raw occurrence an ID
        // --------------------------------

        const actionItems = result.actions.map((action, index) => ({
            id: index + 1,
            action
        }));

        console.log("Raw action occurrences:", actionItems.length);
        console.log("Actions sent to AI:", actionItems);

        // --------------------------------
        // AI grouping
        // --------------------------------

        console.log("Sending actions to LLM...");

        const groups = await analyzeActions(actionItems);

        console.log("AI groups:", groups);

        // --------------------------------
        // Validate AI grouping
        // --------------------------------

        validateGroups(groups, actionItems);

        // --------------------------------
        // Threshold
        // --------------------------------

        const threshold =
            minOccurrences.value === "20+"? 20: Number(minOccurrences.value);

        // --------------------------------
        // Build recurring issues
        // --------------------------------

        const issues = buildRecurringIssues(
            groups,
            actionItems,
            threshold
        );

        console.log("Recurring issues:", issues);

        // --------------------------------
        // Display results
        // --------------------------------

        displayResults(issues);

        finishAnalysis();

    }
    catch (error) {

        console.error(error);

        showError(error.message);

        finishAnalysis();
    }
});


// -----------------------------
// Read Excel
// -----------------------------

async function readExcelFile(file) {

    const buffer = await file.arrayBuffer();

    const workbook = XLSX.read(buffer, {
        type: "array",
        cellDates: true
    });

    if (!workbook.SheetNames.length) {
        throw new Error("The Excel file does not contain any sheets.");
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(sheet, {
        defval: ""
    });

    if (!rows.length) {
        throw new Error("The Excel file does not contain any data.");
    }

    // Check required columns
    const requiredColumns = ["Action", "Date"];
    const columns = Object.keys(rows[0]);

    for (const column of requiredColumns) {
        if (!columns.includes(column)) {
            throw new Error(`Required column "${column}" was not found.`);
        }
    }

    const startDate = new Date(`${fromDate.value}T00:00:00`);
    const endDate = new Date(`${toDate.value}T23:59:59`);

    let invalidDateCount = 0;
    const invalidDateRows = [];

    const filteredRows = rows.filter((row, index) => {

        const rowDate = parseExcelDate(row.Date);

        // Missing or unparseable date
        if (!rowDate) {

            invalidDateCount++;

            invalidDateRows.push({
                row: index + 2,
                date: row.Date
            });

            return false;
        }

        // Keep only dates within the selected range
        return rowDate >= startDate && rowDate <= endDate;
    });

    if (!filteredRows.length) {
        throw new Error("No records found for the selected date range.");
    }

    // Keep every usable Action occurrence
    const actions = filteredRows
        .map(row => String(row.Action).trim())
        .filter(action => action);

    if (!actions.length) {
        throw new Error("No usable records found for the selected date range.");
    }

    return {
        actions,
        invalidDateCount,
        invalidDateRows
    };
}


// -----------------------------
// Excel date handling
// -----------------------------

function parseExcelDate(value) {

    if (value instanceof Date && !isNaN(value)) {
        return value;
    }

    if (typeof value === "number") {

        const parsed = XLSX.SSF.parse_date_code(value);

        if (!parsed) {
            return null;
        }

        return new Date(
            parsed.y,
            parsed.m - 1,
            parsed.d,
            parsed.H || 0,
            parsed.M || 0,
            parsed.S || 0
        );
    }

    if (typeof value === "string" && value.trim()) {

        const parsed = new Date(value);

        if (!isNaN(parsed)) {
            return parsed;
        }
    }

    return null;
}


// -----------------------------
// Analysis state
// -----------------------------

function startAnalysis() {

    fromDate.disabled = true;
    toDate.disabled = true;
    minOccurrences.disabled = true;
    fileInput.disabled = true;

    dropZone.style.pointerEvents = "none";

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Analyzing...";

    clearResults();
}


function finishAnalysis() {

    fromDate.disabled = false;
    toDate.disabled = false;
    minOccurrences.disabled = false;
    fileInput.disabled = false;

    dropZone.style.pointerEvents = "";

    analyzeBtn.textContent = "Analyze";

    updateAnalyzeButton();
}


// -----------------------------
// Validate AI groups
// -----------------------------

function validateGroups(groups, actionItems) {

    if (!Array.isArray(groups)) {
        throw new Error("AI returned an invalid grouping.");
    }

    const validIds = new Set(
        actionItems.map(item => item.id)
    );

    const seenIds = new Set();

    for (const group of groups) {

        if (
            !group ||
            typeof group.label !== "string" ||
            !Array.isArray(group.items)
        ) {
            throw new Error("AI returned an invalid group.");
        }

        for (const id of group.items) {

            if (!validIds.has(id)) {
                throw new Error(
                    `AI returned an unknown action ID: ${id}`
                );
            }

            if (seenIds.has(id)) {
                throw new Error(
                    `AI assigned action ID ${id} to more than one group.`
                );
            }

            seenIds.add(id);
        }
    }

    // Every input action must appear exactly once.
    if (seenIds.size !== validIds.size) {

        const missingIds = [];

        for (const id of validIds) {

            if (!seenIds.has(id)) {
                missingIds.push(id);
            }
        }

        throw new Error(
            `AI did not assign all actions to groups. Missing IDs: ${missingIds.join(", ")}`
        );
    }
}


// -----------------------------
// Build recurring issues
// -----------------------------

function buildRecurringIssues(groups, actionItems, threshold) {

    const actionMap = new Map(
        actionItems.map(item => [item.id, item])
    );

    const issues = [];

    for (const group of groups) {

        if (!group || !Array.isArray(group.items)) {
            continue;
        }

        // Every item represents one actual historical occurrence.
        let count = 0;

        for (const id of group.items) {

            if (actionMap.has(id)) {
                count++;
            }
        }

        if (count >= threshold) {

            issues.push({
                issue: group.label,
                count
            });
        }
    }

    return issues.sort((a, b) => b.count - a.count);
}


// -----------------------------
// Results
// -----------------------------

function clearResults() {

    resultsBody.innerHTML = `
        <tr class="empty-row">
            <td colspan="2">
                Results will appear here after analysis.
            </td>
        </tr>
    `;
}


function displayResults(issues) {

    if (!issues.length) {

        resultsBody.innerHTML = `
            <tr class="empty-row">
                <td colspan="2">
                    No recurring issues found for the selected criteria.
                </td>
            </tr>
        `;

        return;
    }

    resultsBody.innerHTML = issues
        .map(issue => `
            <tr>
                <td>${escapeHtml(issue.issue)}</td>
                <td>${issue.count}</td>
            </tr>
        `)
        .join("");
}


function escapeHtml(value) {

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// -----------------------------
// Errors / warnings
// -----------------------------

function showError(message) {
    errorMessage.textContent = message;
}


function clearError() {
    errorMessage.textContent = "";
}


// Initial state
updateAnalyzeButton();