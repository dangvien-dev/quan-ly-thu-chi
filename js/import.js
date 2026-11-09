// Import of a bank statement (CSV or PDF): choose the file and the money source, check how the
// columns are read, tick what to import, and write the transactions. Reading the file is in
// js/utils.js (parseCsvText, detectCsvLayout, buildImportItems, markImportDuplicates,
// buildCategoryGuesser; for a PDF buildPdfStatementTable turns the text of the pages into the same
// rows a CSV gives, so everything after that is shared).

const MAX_IMPORT_FILE_BYTES = 3 * 1024 * 1024;
const MAX_IMPORT_PDF_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_PDF_PAGES = 30;
// pdf.js (1.4 MB) is not part of the app shell: it is loaded the first time a PDF is chosen.
const PDFJS_SCRIPT = 'vendor/pdfjs/pdf.min.js';
const PDFJS_WORKER = 'vendor/pdfjs/pdf.worker.min.js';
const IMPORT_UNDO_KEY = 'fm_last_import';
const IMPORT_SOURCE_KEY = 'fm_import_source';
const IMPORT_LAYOUTS_KEY = 'fm_import_layouts';
const MAX_SAVED_IMPORT_LAYOUTS = 20;
const IMPORT_FIELD_INPUTS = {
    date: 'importColDate',
    description: 'importColDescription',
    debit: 'importColDebit',
    credit: 'importColCredit',
    amount: 'importColAmount',
    reference: 'importColReference',
};

// What the dialog is working on: { fileName, rows, statement, layout, items, skipped, tooMany,
// source, reconcile, cardPlan }. `statement` is the summary read from a PDF (null for a CSV).
let importDraft = null;
let importGuessCategory = null;
let importFileToken = 0;
// A PDF that asked for a password: its bytes wait here until the person types it.
let importPdfPending = null;
let pdfJsLoading = null;

/** Bytes of a CSV → text: UTF-16 (BOM) and UTF-8 as exported by most banks, else Windows-1258. */
function decodeCsvBuffer(buffer) {
    const bytes = new Uint8Array(buffer);

    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);

    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);

    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        // Not UTF-8: an old export in the Vietnamese Windows code page.
    }

    try {
        return new TextDecoder('windows-1258').decode(bytes);
    } catch {
        return new TextDecoder().decode(bytes);
    }
}

/** True when the bytes are a PDF file (the signature sits at the start, allowing a little junk). */
function isPdfBuffer(buffer) {
    const head = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024));

    return String.fromCharCode(...head).includes('%PDF-');
}

/** Load pdf.js on first use. Rejects with Error('pdfjs') when it cannot be fetched (offline, first time). */
function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);

    if (!pdfJsLoading) {
        pdfJsLoading = new Promise((resolve, reject) => {
            const script = document.createElement('script');

            script.src = PDFJS_SCRIPT;
            script.onload = () => {
                if (window.pdfjsLib) {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
                    resolve(window.pdfjsLib);
                } else {
                    script.remove();
                    reject(new Error('pdfjs'));
                }
            };
            script.onerror = () => {
                script.remove();
                reject(new Error('pdfjs'));
            };
            document.head.appendChild(script);
        });
        // Fetching can be tried again later (e.g. once back online).
        pdfJsLoading.catch(() => {
            pdfJsLoading = null;
        });
    }

    return pdfJsLoading;
}

/**
 * The text of every page of a PDF as pieces { text, x, y, width, height }. Throws pdf.js'
 * PasswordException (code 1 = needs a password, 2 = wrong password) for a protected file.
 */
async function readPdfPages(buffer, password = '') {
    const pdfjs = await loadPdfJs();
    // pdf.js takes ownership of the bytes it is given, so every attempt gets its own copy.
    const task = pdfjs.getDocument({
        data: new Uint8Array(buffer.slice(0)),
        password: password || undefined,
    });
    const pdf = await task.promise;

    try {
        const pages = [];
        const count = Math.min(pdf.numPages, MAX_IMPORT_PDF_PAGES);

        for (let number = 1; number <= count; number++) {
            const page = await pdf.getPage(number);
            const content = await page.getTextContent();

            pages.push(
                content.items
                    .filter((item) => typeof item.str === 'string' && item.transform)
                    .map((item) => ({
                        text: item.str,
                        x: item.transform[4],
                        y: item.transform[5],
                        width: item.width,
                        height: item.height,
                    })),
            );
        }

        return pages;
    } finally {
        pdf.destroy();
    }
}

function importSourceNames() {
    return sourceNames().filter((name) => !isSavingsKind(findSource(name)));
}

function setImportMessage(text, isError = false) {
    const message = document.getElementById('importMessage');

    message.textContent = text;
    message.classList.toggle('import-error', Boolean(text) && isError);
}

function hideImportPassword() {
    importPdfPending = null;
    document.getElementById('import-password-group').hidden = true;
    document.getElementById('importPassword').value = '';
}

function showImportPassword() {
    document.getElementById('import-password-group').hidden = false;
    document.getElementById('importPassword').value = '';
    document.getElementById('importPassword').focus();
}

function showImportStep(step) {
    document.getElementById('import-step-file').hidden = step !== 'file';
    document.getElementById('import-step-preview').hidden = step !== 'preview';
    document.getElementById('importTitle').innerText =
        step === 'preview' ? 'Kiểm tra trước khi nhập' : 'Nhập sao kê ngân hàng';
}

// --- LAYOUTS REMEMBERED ON THIS DEVICE ---
// A statement from the same bank has the same header row every month, so the columns the person
// confirmed once are used again and the next import is "choose the file, check, save".
const importLayoutKey = (headerRow) => normalizeSearchText(headerRow.join('|'));

function readSavedImportLayouts() {
    const saved = readStoredJson(IMPORT_LAYOUTS_KEY, {});

    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}

function saveImportLayout(key, columns, positiveIsExpense) {
    const all = readSavedImportLayouts();

    delete all[key];
    all[key] = { columns, positiveIsExpense };

    Object.keys(all)
        .slice(0, -MAX_SAVED_IMPORT_LAYOUTS)
        .forEach((old) => delete all[old]);

    try {
        localStorage.setItem(IMPORT_LAYOUTS_KEY, JSON.stringify(all));
    } catch {
        // Not being able to remember the columns is harmless.
    }
}

/** The saved columns for this header row, only if every column is still inside the file. */
function savedImportColumns(headerRow, width) {
    const saved = readSavedImportLayouts()[importLayoutKey(headerRow)];

    if (!saved || !saved.columns) return null;

    const fields = Object.keys(IMPORT_FIELD_INPUTS);
    const usable = fields.every((field) => {
        const column = saved.columns[field];

        return Number.isInteger(column) && column >= -1 && column < width;
    });

    return usable ? saved : null;
}

/**
 * The layout saved for this kind of file, with the row it belongs to. The detected header row is
 * tried first; a header the detection does not know (odd column names the person had to map by
 * hand) is looked for among the first lines.
 */
function findSavedImportLayout(rows, detectedHeaderIndex) {
    const width = importRowWidth(rows);
    const candidates =
        detectedHeaderIndex >= 0
            ? [detectedHeaderIndex]
            : Array.from({ length: Math.min(rows.length, 30) }, (_, index) => index);

    for (const headerIndex of candidates) {
        const saved = savedImportColumns(rows[headerIndex], width);

        if (saved)
            return {
                headerIndex,
                columns: saved.columns,
                positiveIsExpense: saved.positiveIsExpense,
            };
    }

    return null;
}

// --- STEP 1: FILE AND COLUMNS ---
function openImportModal() {
    const select = document.getElementById('importSource');
    const names = importSourceNames();
    const remembered = readStoredText(IMPORT_SOURCE_KEY);

    importDraft = null;
    hideImportPassword();
    document.getElementById('importFile').value = '';
    select.innerHTML = names
        .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
        .join('');
    select.value = names.includes(remembered) ? remembered : (names[0] ?? '');
    setImportMessage('');
    document.getElementById('import-mapping').hidden = true;
    showImportStep('file');
    openDialog('importModal', 'importFile');
}

function closeImportModal() {
    importDraft = null;
    importGuessCategory = null;
    importFileToken++;
    hideImportPassword();
    closeDialog('importModal');
}

function importRowWidth(rows) {
    return Math.max(0, ...rows.slice(0, 30).map((row) => row.length));
}

/** Fill the column pickers from a layout, with the header text in each choice. */
function fillImportMapping(
    layout,
    positiveIsExpense = guessPositiveIsExpense(importDraft.rows, layout),
) {
    const rows = importDraft.rows;
    const header = layout.headerIndex >= 0 ? rows[layout.headerIndex] : [];
    const width = importRowWidth(rows);
    const choices =
        '<option value="-1">— Không dùng —</option>' +
        Array.from({ length: width }, (_, column) => {
            const text = header[column] ? `: ${escapeHtml(header[column].slice(0, 40))}` : '';

            return `<option value="${column}">Cột ${column + 1}${text}</option>`;
        }).join('');

    Object.entries(IMPORT_FIELD_INPUTS).forEach(([field, id]) => {
        const select = document.getElementById(id);

        select.innerHTML = choices;
        select.value = String(layout.columns[field] ?? -1);
    });

    document.getElementById('importHeaderRow').value = String(layout.headerIndex + 1);

    document.getElementById('importSign').value = positiveIsExpense ? 'positive' : 'negative';

    // The first lines of the file, so the person can see what each column holds.
    const first = Math.max(0, layout.headerIndex);

    document.getElementById('import-raw-body').innerHTML = rows
        .slice(first, first + 6)
        .map(
            (row, index) =>
                `<tr${index === 0 && layout.headerIndex >= 0 ? ' class="import-raw-header"' : ''}>${Array.from({ length: width }, (_, column) => `<td>${escapeHtml(row[column] ?? '')}</td>`).join('')}</tr>`,
        )
        .join('');

    updateImportSignVisibility();
    document.getElementById('import-mapping').hidden = false;
}

function readImportMapping() {
    const columns = {};

    Object.entries(IMPORT_FIELD_INPUTS).forEach(([field, id]) => {
        columns[field] = Number(document.getElementById(id).value);
    });
    columns.balance = -1;

    const header = Math.floor(Number(document.getElementById('importHeaderRow').value) || 0);

    return { headerIndex: Math.max(0, header) - 1, columns };
}

/** The sign choice only matters for a file with one amount column. */
function updateImportSignVisibility() {
    const split =
        Number(document.getElementById('importColDebit').value) >= 0 ||
        Number(document.getElementById('importColCredit').value) >= 0;

    document.getElementById('import-sign-group').hidden = split;
}

/** Text for the line under the file chooser once the rows are known. */
function describeImportRead(rows, layout, saved, statement) {
    if (saved) {
        return `Đã dùng lại các cột bạn chọn lần trước cho kiểu file này (${rows.length - 1} dòng).`;
    }

    if (statement) {
        const cycle =
            statement.cycleFrom && statement.cycleTo
                ? ` của kỳ sao kê ${formatDateDisplay(statement.cycleFrom)} – ${formatDateDisplay(statement.cycleTo)}`
                : '';

        return `Đã đọc bảng giao dịch trong file PDF: ${rows.length - 1} dòng${cycle}. Kiểm tra các cột bên dưới.`;
    }

    return layout.headerIndex >= 0
        ? `Đã nhận dòng tiêu đề ở dòng ${layout.headerIndex + 1} (${rows.length - 1 - layout.headerIndex} dòng dữ liệu). Kiểm tra các cột bên dưới.`
        : 'Không thấy dòng tiêu đề: hãy chọn các cột (và dòng tiêu đề nếu có).';
}

/** Rows of cells (from a CSV or a PDF table) → the column pickers. */
function useImportRows(fileName, rows, statement = null) {
    importDraft = { fileName, rows, statement };

    const detected = detectCsvLayout(rows);
    const saved = findSavedImportLayout(rows, detected.headerIndex);

    if (saved) {
        fillImportMapping(
            { headerIndex: saved.headerIndex, columns: saved.columns },
            saved.positiveIsExpense,
        );
    } else {
        fillImportMapping(detected);
    }

    setImportMessage(describeImportRead(rows, detected, saved, statement));
}

/** A PDF's bytes → rows. Asks for the password when the file is protected. */
async function readImportPdf(fileName, buffer, password, token) {
    setImportMessage(password ? 'Đang mở file PDF…' : 'Đang đọc file PDF…');

    let pages;

    try {
        pages = await readPdfPages(buffer, password);
    } catch (error) {
        if (token !== importFileToken) return;

        if (error && error.name === 'PasswordException') {
            const wrong = error.code === 2;

            importPdfPending = { fileName, buffer };
            showImportPassword();
            setImportMessage(
                wrong
                    ? 'Mật khẩu chưa đúng, hãy thử lại.'
                    : 'File PDF này có mật khẩu: nhập mật khẩu rồi bấm Mở file.',
                wrong,
            );
            return;
        }

        setImportMessage(
            error && error.message === 'pdfjs'
                ? 'Không tải được bộ đọc PDF. Lần đầu cần có mạng; hãy kiểm tra kết nối rồi chọn lại file.'
                : 'Không đọc được file PDF này (file hỏng hoặc không phải sao kê).',
            true,
        );
        return;
    }

    // Another file was chosen, or the dialog closed, while this one was being read.
    if (token !== importFileToken) return;

    hideImportPassword();

    if (pages.every((items) => items.length === 0)) {
        setImportMessage(
            'File PDF này không có chữ để đọc (có thể là ảnh chụp / bản scan). Hãy tải lại bản sao kê gốc từ ngân hàng.',
            true,
        );
        return;
    }

    const statement = buildPdfStatementTable(pages);

    if (!statement || statement.rows.length < 2) {
        setImportMessage(
            'Không thấy bảng giao dịch trong file PDF này. App đọc được sao kê có bảng với các cột ngày, nội dung và số tiền.',
            true,
        );
        return;
    }

    useImportRows(fileName, statement.rows, statement.summary);
}

async function handleImportFile() {
    const file = document.getElementById('importFile').files[0];
    const token = ++importFileToken;

    importDraft = null;
    hideImportPassword();
    document.getElementById('import-mapping').hidden = true;
    setImportMessage('');

    if (!file) return;

    if (file.size > MAX_IMPORT_PDF_BYTES) {
        setImportMessage('File quá lớn. Hãy tải sao kê theo từng tháng.', true);
        return;
    }

    let buffer;

    try {
        buffer = await file.arrayBuffer();
    } catch {
        setImportMessage('Không đọc được file này.', true);
        return;
    }

    // Another file was chosen, or the dialog closed, while this one was being read.
    if (token !== importFileToken) return;

    if (isPdfBuffer(buffer)) {
        await readImportPdf(file.name, buffer, '', token);
        return;
    }

    if (buffer.byteLength > MAX_IMPORT_FILE_BYTES) {
        setImportMessage('File quá lớn (tối đa 3 MB). Hãy tải sao kê theo từng tháng.', true);
        return;
    }

    let rows;

    try {
        rows = parseCsvText(decodeCsvBuffer(buffer));
    } catch {
        setImportMessage('Không đọc được file này.', true);
        return;
    }

    if (rows.length < 2) {
        setImportMessage('File trống hoặc không phải file CSV.', true);
        return;
    }

    useImportRows(file.name, rows);
}

async function unlockImportPdf() {
    if (!importPdfPending) return;

    const field = document.getElementById('importPassword');
    const button = document.getElementById('import-unlock');
    const password = field.value;

    if (!password) {
        setImportMessage('Hãy nhập mật khẩu của file PDF.', true);
        field.focus();
        return;
    }

    const { fileName, buffer } = importPdfPending;

    button.disabled = true;

    try {
        await readImportPdf(fileName, buffer, password, importFileToken);
    } finally {
        button.disabled = false;
    }
}

function handleImportHeaderRowChange() {
    if (!importDraft) return;

    fillImportMapping(
        readImportMapping(),
        document.getElementById('importSign').value === 'positive',
    );
}

// --- STEP 2: PREVIEW ---
function backToImportMapping() {
    showImportStep('file');
    document.getElementById('importFile').focus();
}

/** The names of the sources a row can be moved to or from: every one in use but the one imported into. */
function importCounterNames() {
    return importDraft ? sourceNames().filter((name) => name !== importDraft.source) : [];
}

/** The value of the type select: a transfer is told apart by its direction seen from the source. */
function importTypeValue(item) {
    if (!item.transfer) return item.type;

    return item.type === 'expense' ? 'transfer-out' : 'transfer-in';
}

function importTypeOptions(item) {
    const selected = importTypeValue(item);
    const options = [
        ['expense', 'Chi'],
        ['income', 'Thu'],
    ];

    // Moving money needs another source to move it to or from.
    if (item.transfer || importCounterNames().length) {
        options.push(['transfer-out', 'Chuyển ra'], ['transfer-in', 'Chuyển vào']);
    }

    return options
        .map(
            ([value, label]) =>
                `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`,
        )
        .join('');
}

/** The other source of a transfer row, as a select (a name that is gone stays in the list, marked). */
function importCounterSelect(item, label) {
    const names = importCounterNames();
    const all = names.includes(item.counter) ? names : [...names, item.counter];
    const options = all
        .map(
            (name) =>
                `<option value="${escapeHtml(name)}"${name === item.counter ? ' selected' : ''}>${escapeHtml(name)}${names.includes(name) ? '' : ' (không còn dùng)'}</option>`,
        )
        .join('');
    const out = item.type === 'expense';
    const caption = out ? 'Chuyển tới' : 'Nhận từ';
    const name = out ? 'Nguồn nhận tiền' : 'Nguồn chuyển tiền';

    return `<div class="import-counter"><span class="source-meta import-counter-label">${caption}</span><select class="form-control import-select" data-field="counter" aria-label="${name} của ${escapeHtml(label)}">${options}</select></div>`;
}

function importCategoryOptions(item) {
    const names = categories
        .filter((category) => category.type === item.type)
        .map((category) => category.name);
    const all = names.includes(item.category) ? names : [...names, item.category];

    return all
        .map(
            (name) =>
                `<option value="${escapeHtml(name)}"${name === item.category ? ' selected' : ''}>${escapeHtml(name)}${names.includes(name) ? '' : ' (mới)'}</option>`,
        )
        .join('');
}

function importFlagText(item) {
    if (item.status === 'imported') return 'Đã nhập từ lần trước, không nhập lại.';

    if (item.status !== 'duplicate') return '';

    const match = transactions.find((transaction) => transaction.id === item.match);

    return match
        ? `Có thể trùng với "${match.note || match.category}" ngày ${formatDateDisplay(match.date)}: chưa chọn.`
        : 'Có thể trùng với một giao dịch đã có: chưa chọn.';
}

const IMPORT_TRANSFER_REASONS = {
    name: 'Tên nguồn nằm trong nội dung',
    atm: 'Có vẻ là rút tiền mặt',
    deposit: 'Có vẻ là nộp tiền mặt',
    'card-payment': 'Có vẻ là trả sao kê thẻ',
    'card-payment-out': 'Có vẻ là trả sao kê thẻ',
};

/** Why a row was suggested as a transfer (only while it still is one): the person decides. */
function importTransferText(item) {
    if (!item.transfer || !item.transferReason) return '';

    return `${IMPORT_TRANSFER_REASONS[item.transferReason]}: đề xuất chuyển tiền giữa các nguồn của bạn (không tính là chi hay thu). Kiểm tra nguồn kia, hoặc đổi loại về Chi / Thu.`;
}

function renderImportRow(item, index) {
    const color = item.transfer
        ? 'var(--text-main)'
        : item.type === 'income'
          ? 'var(--success)'
          : 'var(--danger)';
    const sign = item.type === 'income' ? '+' : '-';
    const flag = importFlagText(item);
    const transferFlag = importTransferText(item);
    const label = `dòng ${item.row} ngày ${formatDateDisplay(item.date)} ${formatMoney(item.amount)}`;

    return `<tr data-index="${index}" class="${item.include ? '' : 'import-row-off'}">
            <td data-label="Nhập"><input type="checkbox" data-field="include" aria-label="Nhập ${escapeHtml(label)}"${item.include ? ' checked' : ''}${item.status === 'imported' ? ' disabled' : ''} /></td>
            <td data-label="Ngày">${escapeHtml(formatDateDisplay(item.date))}</td>
            <td data-label="Nội dung"><div class="import-content"><span class="note-cell">${escapeHtml(item.note || '—')}</span>${flag ? `<div class="source-meta import-flag"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ${escapeHtml(flag)}</div>` : ''}${transferFlag ? `<div class="source-meta import-flag"><i class="fa-solid fa-right-left" aria-hidden="true"></i> ${escapeHtml(transferFlag)}</div>` : ''}</div></td>
            <td data-label="Loại"><select class="form-control import-select" data-field="type" aria-label="Loại của ${escapeHtml(label)}">${importTypeOptions(item)}</select></td>
            <td data-label="Số tiền" style="font-weight:700; color:${color};">${sign}${formatMoney(item.amount)}</td>
            ${
                item.transfer
                    ? `<td data-label="Nguồn kia">${importCounterSelect(item, label)}</td>`
                    : `<td data-label="Danh mục"><select class="form-control import-select" data-field="category" aria-label="Danh mục của ${escapeHtml(label)}">${importCategoryOptions(item)}</select></td>`
            }
        </tr>`;
}

/** True when the statement's numbers are to be written to the card too. */
function importAppliesStatement() {
    const box = document.getElementById('import-apply-statement');

    return Boolean(importDraft && importDraft.cardPlan && box && box.checked);
}

function updateImportSummary() {
    const chosen = importDraft.items.filter((item) => item.include);
    // Money moved between the person's own sources is neither spending nor income.
    const sum = (list) => list.reduce((total, item) => total + item.amount, 0);
    const spending = (type) => chosen.filter((item) => !item.transfer && item.type === type);
    const moved = chosen.filter((item) => item.transfer);
    const commit = document.getElementById('import-commit');
    const apply = importAppliesStatement();
    const movedText = moved.length
        ? `, chuyển tiền giữa các nguồn <b>${moved.length}</b> giao dịch (${formatMoney(sum(moved))})`
        : '';

    document.getElementById('import-summary').innerHTML =
        importDraft.summary +
        `<br>Sẽ nhập <b>${chosen.length}</b> giao dịch vào <b>${escapeHtml(importDraft.source)}</b>: chi <b>${formatMoney(sum(spending('expense')))}</b>, thu <b>${formatMoney(sum(spending('income')))}</b>${movedText}.`;
    commit.disabled = chosen.length === 0 && !apply;

    if (chosen.length) {
        commit.textContent = `Nhập ${chosen.length} giao dịch${apply ? ' và cập nhật thẻ' : ''}`;
    } else {
        commit.textContent = apply ? 'Cập nhật thẻ theo sao kê' : 'Chưa chọn giao dịch nào';
    }

    const all = document.getElementById('import-select-all');
    const choosable = importDraft.items.filter((item) => item.status !== 'imported');

    all.disabled = choosable.length === 0;
    all.checked = choosable.length > 0 && choosable.every((item) => item.include);
}

/** The numbers a PDF statement prints, next to what was read from its table. */
function describeImportReconcile(reconcile) {
    if (!reconcile) return '';

    const owed = formatMoney(reconcile.expectedCharges);
    const paid = formatMoney(reconcile.expectedPayments);

    if (reconcile.chargesOk && reconcile.paymentsOk) {
        return `Khớp với sao kê: nợ phát sinh ${owed}, đã thanh toán ${paid}.`;
    }

    const wrong = [];

    if (!reconcile.chargesOk) {
        wrong.push(
            `nợ phát sinh trên sao kê là ${owed} nhưng đọc được ${formatMoney(reconcile.charges)}`,
        );
    }

    if (!reconcile.paymentsOk) {
        wrong.push(
            `đã thanh toán trên sao kê là ${paid} nhưng đọc được ${formatMoney(reconcile.payments)}`,
        );
    }

    return `Chưa khớp với sao kê: ${wrong.join('; ')}. Có thể sót hoặc đọc sai dòng, hãy so lại với file PDF.`;
}

/** What writing the statement to the card would change, in words. */
function describeCardPlan(plan) {
    const parts = [];

    if (plan.statementDay) parts.push(`ngày chốt sao kê ${plan.statementDay}`);

    if (plan.dueDay) parts.push(`hạn thanh toán ngày ${plan.dueDay}`);

    if (plan.lastStatement) {
        parts.push(
            `dư nợ cuối kỳ ${formatMoney(plan.lastStatement.balance)} (sao kê chốt ${formatDateDisplay(plan.lastStatement.date)})`,
        );
    }

    return parts.join(', ');
}

function renderImportStatement() {
    const { statement, reconcile, cardPlan, source } = importDraft;
    const box = document.getElementById('import-statement');
    const line = document.getElementById('import-reconcile');
    const apply = document.getElementById('import-apply-label');

    box.hidden = !statement;

    if (!statement) return;

    const text = describeImportReconcile(reconcile);
    const ok = Boolean(reconcile && reconcile.chargesOk && reconcile.paymentsOk);

    line.hidden = !text;
    line.className = `import-reconcile ${ok ? 'import-reconcile-ok' : 'import-reconcile-bad'}`;
    line.innerHTML = text
        ? `<i class="fa-solid ${ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}" aria-hidden="true"></i> ${escapeHtml(text)}`
        : '';

    apply.hidden = !cardPlan;
    document.getElementById('import-apply-statement').checked = Boolean(cardPlan);
    document.getElementById('import-apply-text').textContent = cardPlan
        ? `Cập nhật thẻ "${source}" theo sao kê: ${describeCardPlan(cardPlan)}.`
        : '';
}

function renderImportPreview() {
    const { items, skipped, tooMany } = importDraft;
    const duplicates = items.filter((item) => item.status === 'duplicate').length;
    const imported = items.filter((item) => item.status === 'imported').length;
    const dates = items.map((item) => item.date).sort();
    const parts = [
        `Đọc được <b>${items.length}</b> giao dịch từ ${escapeHtml(formatDateDisplay(dates[0]))} đến ${escapeHtml(formatDateDisplay(dates.at(-1)))}.`,
    ];

    if (duplicates) {
        parts.push(
            `<b>${duplicates}</b> dòng có thể trùng với giao dịch bạn đã nhập (cùng nguồn, số tiền, lệch tối đa ${IMPORT_DUPLICATE_DAYS} ngày): chưa chọn, hãy kiểm tra.`,
        );
    }

    if (imported) parts.push(`<b>${imported}</b> dòng đã nhập từ lần trước.`);

    const suggested = items.filter((item) => item.transfer && item.transferReason).length;

    if (suggested) {
        parts.push(
            `<b>${suggested}</b> dòng có vẻ là chuyển tiền giữa các nguồn của bạn (rút tiền mặt, trả thẻ…): đã đề xuất loại Chuyển tiền, hãy kiểm tra nguồn kia.`,
        );
    }

    if (tooMany) parts.push(`Chỉ đọc ${MAX_IMPORT_ROWS} dòng đầu; hãy tải sao kê theo từng tháng.`);

    importDraft.summary = parts.join(' ');

    const skippedBox = document.getElementById('import-skipped');

    skippedBox.hidden = skipped.length === 0;
    document.getElementById('import-skipped-summary').textContent =
        `${skipped.length} dòng bị bỏ qua (không phải giao dịch)`;
    document.getElementById('import-skipped-list').innerHTML = skipped
        .slice(0, 30)
        .map((entry) => `<li>Dòng ${entry.row}: ${escapeHtml(entry.reason)}</li>`)
        .join('');

    document.getElementById('import-table-body').innerHTML = items.map(renderImportRow).join('');
    renderImportStatement();
    updateImportSummary();
}

function buildImportPreview() {
    if (!importDraft) return;

    const layout = readImportMapping();
    const source = document.getElementById('importSource').value;
    const { columns } = layout;

    if (!source) {
        setImportMessage('Chưa có nguồn tiền để nhập vào.', true);
        return;
    }

    if (columns.date < 0) {
        setImportMessage('Hãy chọn cột Ngày.', true);
        return;
    }

    if (columns.debit < 0 && columns.credit < 0 && columns.amount < 0) {
        setImportMessage('Hãy chọn cột Số tiền (hoặc cột Ghi nợ / Ghi có).', true);
        return;
    }

    const positiveIsExpense = document.getElementById('importSign').value === 'positive';
    const built = buildImportItems(importDraft.rows, layout, { source, positiveIsExpense });

    if (built.items.length === 0) {
        const reason = built.skipped[0]
            ? ` (dòng ${built.skipped[0].row}: ${built.skipped[0].reason})`
            : '';

        setImportMessage(
            `Không đọc được giao dịch nào${reason}. Kiểm tra lại dòng tiêu đề và các cột.`,
            true,
        );
        return;
    }

    importGuessCategory = buildCategoryGuesser(transactions, categories);
    const payer = readStoredText(CARD_PAY_SOURCE_KEY);

    importDraft.items = markImportDuplicates(built.items, transactions, source).map((item) => {
        // Suggested here, not decided: the preview shows it and the person can undo it.
        const moved = guessImportTransfer(item.note, item.type, source, sources, { payer });

        return {
            ...item,
            category: importGuessCategory(item.note, item.type),
            transfer: Boolean(moved),
            counter: moved ? moved.counter : '',
            transferReason: moved ? moved.reason : '',
        };
    });
    importDraft.skipped = built.skipped;
    importDraft.tooMany = built.tooMany;
    importDraft.layout = layout;
    importDraft.positiveIsExpense = positiveIsExpense;
    importDraft.source = source;
    importDraft.reconcile = importDraft.statement
        ? reconcilePdfStatement(importDraft.rows, layout, importDraft.statement, positiveIsExpense)
        : null;
    importDraft.cardPlan = importDraft.statement
        ? planCardStatementUpdate(findSource(source), importDraft.statement)
        : null;

    setImportMessage('');
    renderImportPreview();
    showImportStep('preview');
    document.getElementById('import-select-all').focus();
}

function handleImportRowChange(event) {
    const control = event.target.closest('[data-field]');
    const row = event.target.closest('tr[data-index]');

    if (!control || !row || !importDraft) return;

    const item = importDraft.items[Number(row.dataset.index)];

    if (!item) return;

    if (control.dataset.field === 'include') {
        item.include = control.checked;
        row.classList.toggle('import-row-off', !item.include);
    } else if (control.dataset.field === 'category') {
        item.category = control.value;
    } else if (control.dataset.field === 'counter') {
        item.counter = control.value;
    } else if (control.dataset.field === 'type') {
        const moving = control.value === 'transfer-out' || control.value === 'transfer-in';

        item.transfer = moving;
        item.transferReason = '';

        if (moving) {
            item.type = control.value === 'transfer-out' ? 'expense' : 'income';

            if (!importCounterNames().includes(item.counter)) {
                item.counter = importCounterNames()[0] || '';
            }
        } else {
            item.type = control.value;
            item.category = importGuessCategory(item.note, item.type);
        }

        row.outerHTML = renderImportRow(item, Number(row.dataset.index));
        document
            .querySelector(
                `#import-table-body tr[data-index="${row.dataset.index}"] [data-field="type"]`,
            )
            .focus();
    }

    updateImportSummary();
}

function handleImportSelectAll(event) {
    if (!importDraft) return;

    importDraft.items.forEach((item) => {
        if (item.status !== 'imported') item.include = event.target.checked;
    });
    document.getElementById('import-table-body').innerHTML = importDraft.items
        .map(renderImportRow)
        .join('');
    updateImportSummary();
}

// --- WRITING THE TRANSACTIONS ---
function commitImport() {
    if (!importDraft || !importDraft.items) return;

    const { source, fileName } = importDraft;
    const chosen = importDraft.items.filter((item) => item.include && item.status !== 'imported');
    const apply = importAppliesStatement();

    if (chosen.length === 0 && !apply) return;

    const target = findSource(source);

    // A sync may have archived or removed the source while the dialog was open.
    if (!target || target.archived) {
        alert('Nguồn tiền này không còn dùng được. Hãy đóng hộp thoại và chọn lại.');
        return;
    }

    // A sync may also have archived or removed the other source of a transfer. Nothing is written
    // until the person has seen the rows again with a source that exists.
    const usable = importCounterNames();
    const stale = chosen.filter((item) => item.transfer && !usable.includes(item.counter));

    if (stale.length) {
        stale.forEach((item) => {
            item.counter = usable[0] || '';
            item.transfer = Boolean(item.counter);
            item.transferReason = '';

            if (!item.transfer) item.category = importGuessCategory(item.note, item.type);
        });
        renderImportPreview();
        alert(
            `Nguồn tiền kia của ${stale.length} dòng chuyển tiền không còn dùng được nên đã được chọn lại. Hãy kiểm tra rồi bấm Nhập lần nữa.`,
        );
        return;
    }

    const stamp = new Date().toISOString();
    const taken = new Set(transactions.map((transaction) => transaction.id));
    const created = chosen
        .filter((item) => !taken.has(item.id))
        .map((item) => {
            // Money going out of the imported source goes to the other one; money coming in, from it.
            if (item.transfer) {
                const out = item.type === 'expense';

                return {
                    id: item.id,
                    date: item.date,
                    type: 'transfer',
                    source: out ? source : item.counter,
                    targetSource: out ? item.counter : source,
                    category: TRANSFER_CATEGORY,
                    amount: item.amount,
                    note: item.note,
                    updatedAt: stamp,
                };
            }

            ensureCategory(item.category, item.type);

            return {
                id: item.id,
                date: item.date,
                type: item.type,
                source,
                targetSource: null,
                category: item.category,
                amount: item.amount,
                note: item.note,
                updatedAt: stamp,
            };
        });

    if (created.length) {
        transactions = [...created, ...transactions];
        saveDataLocally();
        queueUpsert(created.map((transaction) => transaction.id));
    }

    // The statement's numbers go to the card. The plan is made again from the card as it is now:
    // a sync may have changed it while the dialog was open.
    const plan = apply ? planCardStatementUpdate(target, importDraft.statement) : null;

    if (plan) {
        sources[sources.indexOf(target)] = normalizeSource({ ...target, ...plan });
        saveMeta('sources');
    }

    const header =
        importDraft.layout.headerIndex >= 0
            ? importDraft.rows[importDraft.layout.headerIndex]
            : null;

    if (header)
        saveImportLayout(
            importLayoutKey(header),
            importDraft.layout.columns,
            importDraft.positiveIsExpense,
        );

    try {
        localStorage.setItem(IMPORT_SOURCE_KEY, source);

        if (created.length) {
            localStorage.setItem(
                IMPORT_UNDO_KEY,
                JSON.stringify({
                    ids: created.map((transaction) => transaction.id),
                    source,
                    file: fileName,
                    at: stamp,
                }),
            );
        }
    } catch {
        // Not being able to remember the choice or the undo is harmless.
    }

    closeImportModal();
    renderAll();
    syncToGoogleSheet();

    if (created.length) {
        showTransactionsFor({ source });
    } else if (plan) {
        switchTab('sources');
    }

    const done = [];

    if (created.length) {
        const moved = created.filter((transaction) => transaction.type === 'transfer').length;

        done.push(
            `Đã nhập ${created.length} giao dịch vào ${source}${moved ? ` (${moved} chuyển tiền giữa các nguồn)` : ''}`,
        );
    }

    if (plan) done.push(`đã cập nhật thẻ ${source} theo sao kê (${describeCardPlan(plan)})`);

    const message = done.join(', ').replace(/^./, (letter) => letter.toUpperCase());

    showToast(
        created.length ? `${message}. Cài đặt có nút Hoàn tác nếu nhập nhầm.` : `${message}.`,
        'success',
        9000,
    );
}

// --- UNDO ---
function lastImportRecord() {
    const record = readStoredJson(IMPORT_UNDO_KEY, null);

    if (!record || !Array.isArray(record.ids)) return null;

    const present = new Set(transactions.map((transaction) => transaction.id));
    const ids = record.ids.filter((id) => present.has(id));

    return ids.length ? { ...record, ids } : null;
}

function renderImportUndo() {
    const button = document.getElementById('import-undo-btn');

    if (!button) return;

    const record = lastImportRecord();

    button.hidden = !record;

    if (record) {
        document.getElementById('import-undo-label').textContent =
            `Hoàn tác lần nhập vừa rồi (${record.ids.length} giao dịch)`;
    }
}

function undoLastImport() {
    const record = lastImportRecord();

    if (!record) return;

    const question = `Xóa ${record.ids.length} giao dịch đã nhập từ file "${record.file}" vào ${record.source}? Giao dịch đã sửa sau khi nhập cũng bị xóa.`;

    if (!confirm(question)) return;

    const doomed = new Set(record.ids);

    transactions = transactions.filter((transaction) => !doomed.has(transaction.id));
    queueDelete(record.ids);
    saveDataLocally();

    try {
        localStorage.removeItem(IMPORT_UNDO_KEY);
    } catch {
        // The button disappears anyway once the transactions are gone.
    }

    renderAll();
    syncToGoogleSheet();
    showToast(`Đã xóa ${record.ids.length} giao dịch của lần nhập trước.`, 'success');
}

function initImport() {
    document.getElementById('importFile').addEventListener('change', handleImportFile);
    document.getElementById('importPassword').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            unlockImportPdf();
        }
    });
    document
        .getElementById('importHeaderRow')
        .addEventListener('change', handleImportHeaderRowChange);
    ['importColDebit', 'importColCredit', 'importColAmount'].forEach((id) => {
        document.getElementById(id).addEventListener('change', updateImportSignVisibility);
    });
    document.getElementById('import-table-body').addEventListener('change', handleImportRowChange);
    document.getElementById('import-select-all').addEventListener('change', handleImportSelectAll);
    document.getElementById('import-apply-statement').addEventListener('change', () => {
        if (importDraft && importDraft.items) updateImportSummary();
    });
}
