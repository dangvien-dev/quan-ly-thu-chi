var SHEET_NAME = 'Transactions';

function doPost(e) {
    return handleData(e);
}

function doGet(e) {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = doc.getSheetByName(SHEET_NAME);

    // Nếu có param action=save từ GET (dùng để tránh lỗi CORS)
    if (e && e.parameter && e.parameter.action === 'save') {
        var rawData = decodeURIComponent(e.parameter.data);
        var rows = JSON.parse(rawData);

        sheet.clearContents();
        sheet.appendRow(['id', 'date', 'type', 'source', 'category', 'amount', 'note']);
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            sheet.appendRow([r.id, r.date, r.type, r.source, r.category, r.amount, r.note]);
        }
        return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(
            ContentService.MimeType.JSON,
        );
    }

    // Mặc định trả về danh sách giao dịch
    var rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) {
        return ContentService.createTextOutput(JSON.stringify([])).setMimeType(
            ContentService.MimeType.JSON,
        );
    }

    var headers = rows[0];
    var result = [];
    for (var i = 1; i < rows.length; i++) {
        var row = rows[i];
        var obj = {};
        for (var j = 0; j < headers.length; j++) {
            obj[headers[j]] = row[j];
        }
        result.push(obj);
    }

    // Hỗ trợ callback nếu gọi dạng JSONP
    var callback = e.parameter.callback;
    var jsonString = JSON.stringify(result);
    if (callback) {
        return ContentService.createTextOutput(callback + '(' + jsonString + ')').setMimeType(
            ContentService.MimeType.JAVASCRIPT,
        );
    }

    return ContentService.createTextOutput(jsonString).setMimeType(ContentService.MimeType.JSON);
}

function handleData(e) {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = doc.getSheetByName(SHEET_NAME);
    try {
        var data = JSON.parse(e.postData.contents);
        sheet.clearContents();
        sheet.appendRow(['id', 'date', 'type', 'source', 'category', 'amount', 'note']);
        var rows = data.transactions;
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            sheet.appendRow([r.id, r.date, r.type, r.source, r.category, r.amount, r.note]);
        }
        return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(
            ContentService.MimeType.JSON,
        );
    } catch (err) {
        return ContentService.createTextOutput(
            JSON.stringify({ status: 'error', message: err.toString() }),
        ).setMimeType(ContentService.MimeType.JSON);
    }
}
