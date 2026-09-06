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
        // Generate embeddings
        // --------------------------------

        console.log("Generating embeddings...");

        const embeddings = await getEmbeddings(
            result.actions
        );

        console.log(
            "Embeddings generated:",
            embeddings.length
        );

        // --------------------------------
        // Cluster recurring issues
        // --------------------------------

        console.log("Clustering actions...");

        const issues = clusterActions(
            result.actions,
            embeddings,
            minOccurrences.value
        );

        console.log(
            "Recurring issues:",
            issues
        );

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

    // Keep only what the AI needs
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