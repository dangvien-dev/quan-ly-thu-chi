// Import of a bank statement (CSV): choose the file and the money source, check how the columns are
// read, tick what to import, and write the transactions. Reading the file is in js/utils.js
// (parseCsvText, detectCsvLayout, buildImportItems, markImportDuplicates, buildCategoryGuesser).

const MAX_IMPORT_FILE_BYTES = 3 * 1024 * 1024;
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

// What the dialog is working on: { fileName, rows, layout, items, skipped, tooMany, source }.
let importDraft = null;
let importGuessCategory = null;
let importFileToken = 0;
let importSignTouched = false;

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

function importSourceNames() {
    return sourceNames().filter((name) => !isSavingsKind(findSource(name)));
}

function setImportMessage(text, isError = false) {
    const message = document.getElementById('importMessage');

    message.textContent = text;
    message.classList.toggle('import-error', Boolean(text) && isError);
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
    importSignTouched = false;
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
    closeDialog('importModal');
}

function importRowWidth(rows) {
    return Math.max(0, ...rows.slice(0, 30).map((row) => row.length));
}

/** Fill the column pickers from a layout, with the header text in each choice. */
function fillImportMapping(layout, positiveIsExpense) {
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

    const source = findSource(document.getElementById('importSource').value);

    document.getElementById('importSign').value = (
        positiveIsExpense === undefined
            ? Boolean(source && source.kind === 'credit')
            : positiveIsExpense
    )
        ? 'positive'
        : 'negative';

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

async function handleImportFile() {
    const file = document.getElementById('importFile').files[0];
    const token = ++importFileToken;

    importDraft = null;
    document.getElementById('import-mapping').hidden = true;
    setImportMessage('');

    if (!file) return;

    if (file.size > MAX_IMPORT_FILE_BYTES) {
        setImportMessage('File quá lớn (tối đa 3 MB). Hãy tải sao kê theo từng tháng.', true);
        return;
    }

    let rows;

    try {
        rows = parseCsvText(decodeCsvBuffer(await file.arrayBuffer()));
    } catch {
        setImportMessage('Không đọc được file này.', true);
        return;
    }

    // Another file was chosen, or the dialog closed, while this one was being read.
    if (token !== importFileToken) return;

    if (rows.length < 2) {
        setImportMessage('File trống hoặc không phải file CSV.', true);
        return;
    }

    importDraft = { fileName: file.name, rows };

    const detected = detectCsvLayout(rows);
    const saved = findSavedImportLayout(rows, detected.headerIndex);

    if (saved) {
        importSignTouched = true;
        fillImportMapping(
            { headerIndex: saved.headerIndex, columns: saved.columns },
            saved.positiveIsExpense,
        );
        setImportMessage(
            `Đã dùng lại các cột bạn chọn lần trước cho kiểu file này (${rows.length - 1} dòng).`,
        );
    } else {
        importSignTouched = false;
        fillImportMapping(detected);
        setImportMessage(
            detected.headerIndex >= 0
                ? `Đã nhận dòng tiêu đề ở dòng ${detected.headerIndex + 1} (${rows.length - 1 - detected.headerIndex} dòng dữ liệu). Kiểm tra các cột bên dưới.`
                : 'Không thấy dòng tiêu đề: hãy chọn các cột (và dòng tiêu đề nếu có).',
        );
    }
}

function handleImportHeaderRowChange() {
    if (!importDraft) return;

    fillImportMapping(
        readImportMapping(),
        document.getElementById('importSign').value === 'positive',
    );
}

function handleImportSourceChange() {
    if (!importDraft || importSignTouched) return;

    const source = findSource(document.getElementById('importSource').value);

    document.getElementById('importSign').value =
        source && source.kind === 'credit' ? 'positive' : 'negative';
}

// --- STEP 2: PREVIEW ---
function backToImportMapping() {
    showImportStep('file');
    document.getElementById('importFile').focus();
}

function importTypeOptions(selected) {
    return [
        ['expense', 'Chi'],
        ['income', 'Thu'],
    ]
        .map(
            ([value, label]) =>
                `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`,
        )
        .join('');
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

function renderImportRow(item, index) {
    const color = item.type === 'income' ? 'var(--success)' : 'var(--danger)';
    const sign = item.type === 'income' ? '+' : '-';
    const flag = importFlagText(item);
    const label = `dòng ${item.row} ngày ${formatDateDisplay(item.date)} ${formatMoney(item.amount)}`;

    return `<tr data-index="${index}" class="${item.include ? '' : 'import-row-off'}">
            <td data-label="Nhập"><input type="checkbox" data-field="include" aria-label="Nhập ${escapeHtml(label)}"${item.include ? ' checked' : ''}${item.status === 'imported' ? ' disabled' : ''} /></td>
            <td data-label="Ngày">${escapeHtml(formatDateDisplay(item.date))}</td>
            <td data-label="Nội dung"><span class="note-cell">${escapeHtml(item.note || '—')}</span>${flag ? `<div class="source-meta import-flag"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ${escapeHtml(flag)}</div>` : ''}</td>
            <td data-label="Loại"><select class="form-control import-select" data-field="type" aria-label="Loại của ${escapeHtml(label)}">${importTypeOptions(item.type)}</select></td>
            <td data-label="Số tiền" style="font-weight:700; color:${color};">${sign}${formatMoney(item.amount)}</td>
            <td data-label="Danh mục"><select class="form-control import-select" data-field="category" aria-label="Danh mục của ${escapeHtml(label)}">${importCategoryOptions(item)}</select></td>
        </tr>`;
}

function updateImportSummary() {
    const chosen = importDraft.items.filter((item) => item.include);
    const sum = (type) =>
        chosen.filter((item) => item.type === type).reduce((total, item) => total + item.amount, 0);
    const commit = document.getElementById('import-commit');

    document.getElementById('import-summary').innerHTML =
        importDraft.summary +
        `<br>Sẽ nhập <b>${chosen.length}</b> giao dịch vào <b>${escapeHtml(importDraft.source)}</b>: chi <b>${formatMoney(sum('expense'))}</b>, thu <b>${formatMoney(sum('income'))}</b>.`;
    commit.disabled = chosen.length === 0;
    commit.textContent = chosen.length
        ? `Nhập ${chosen.length} giao dịch`
        : 'Chưa chọn giao dịch nào';

    const all = document.getElementById('import-select-all');
    const choosable = importDraft.items.filter((item) => item.status !== 'imported');

    all.disabled = choosable.length === 0;
    all.checked = choosable.length > 0 && choosable.every((item) => item.include);
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
    importDraft.items = markImportDuplicates(built.items, transactions, source).map((item) => ({
        ...item,
        category: importGuessCategory(item.note, item.type),
    }));
    importDraft.skipped = built.skipped;
    importDraft.tooMany = built.tooMany;
    importDraft.layout = layout;
    importDraft.positiveIsExpense = positiveIsExpense;
    importDraft.source = source;

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
    } else if (control.dataset.field === 'type') {
        item.type = control.value;
        item.category = importGuessCategory(item.note, item.type);
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

    if (chosen.length === 0) return;

    const target = findSource(source);

    // A sync may have archived or removed the source while the dialog was open.
    if (!target || target.archived) {
        alert('Nguồn tiền này không còn dùng được. Hãy đóng hộp thoại và chọn lại.');
        return;
    }

    const stamp = new Date().toISOString();
    const taken = new Set(transactions.map((transaction) => transaction.id));
    const created = chosen
        .filter((item) => !taken.has(item.id))
        .map((item) => {
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

    transactions = [...created, ...transactions];
    saveDataLocally();
    queueUpsert(created.map((transaction) => transaction.id));

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
        localStorage.setItem(
            IMPORT_UNDO_KEY,
            JSON.stringify({
                ids: created.map((transaction) => transaction.id),
                source,
                file: fileName,
                at: stamp,
            }),
        );
    } catch {
        // Not being able to remember the choice or the undo is harmless.
    }

    closeImportModal();
    renderAll();
    syncToGoogleSheet();
    showTransactionsFor({ source });
    showToast(
        `Đã nhập ${created.length} giao dịch vào ${source}. Cài đặt có nút Hoàn tác nếu nhập nhầm.`,
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
    document.getElementById('importSource').addEventListener('change', handleImportSourceChange);
    document
        .getElementById('importHeaderRow')
        .addEventListener('change', handleImportHeaderRowChange);
    ['importColDebit', 'importColCredit', 'importColAmount'].forEach((id) => {
        document.getElementById(id).addEventListener('change', updateImportSignVisibility);
    });
    document.getElementById('importSign').addEventListener('change', () => {
        importSignTouched = true;
    });
    document.getElementById('import-table-body').addEventListener('change', handleImportRowChange);
    document.getElementById('import-select-all').addEventListener('change', handleImportSelectAll);
}
