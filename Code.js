/**
 * LINE Messaging API Config
 */
// 課題資料から取得したトークンを、改行・空白なしで設定
const LINE_ACCESS_TOKEN = 'YOZ7UftinQa030yBDaloYu4cXzhYtLzmqBzAGNvCIJRg7h+DoqsX0n60Xdf0FZ9vI7/+VI0KgdWLHJ6yBmeAi6kPqz4+FZ3vpHQTBEAQSHA81c9tQLH/80P8UUyRpnHxvmJ0Q1aAjZWiraJe038tBgdB04t89/10/w1cDnyilFU=';
// 課題資料から取得したグループID
const LINE_GROUP_ID = 'C5a5b36e27a78ed6cfbb74839a8a9d04e';

/**
 * Helper: Ensures all required sheets exist and have headers.
 */
function ensureAllSheetsExist() {
    getSheet('研修生マスタ');
    getSheet('打刻記録');
    getSheet('課題完了記録');
}

/**
 * Handle HTTP POST requests
 */
function doPost(e) {
    ensureAllSheetsExist();

    try {
        const data = JSON.parse(e.postData.contents);
        const action = data.action;
        let result = {};

        switch (action) {
            case 'clockIn':
                result = handleClockIn(data);
                break;
            case 'clockOut':
                result = handleClockOut(data);
                break;
            case 'reportTask':
                result = handleTaskReport(data);
                break;
            default:
                throw new Error('Invalid action');
        }

        return ContentService.createTextOutput(JSON.stringify(result))
            .setMimeType(ContentService.MimeType.JSON);

    } catch (error) {
        // ユーザーに具体的なエラーメッセージを返す
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: `GASエラー: ${error.message}` }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

/**
 * Handle Clock In Action
 */
function handleClockIn(data) {
    const { userId, userName } = data;
    const now = new Date();
    const timeStr = formatTime(now);

    const sheet = getSheet('打刻記録');
    // A列にフルタイムスタンプ (now)、D列に出勤時刻文字列 (timeStr) を記録
    sheet.appendRow([now, userId, userName, timeStr, '', '']); 

    const dateStr = formatDate(now);
    sendLineMessage(`【出勤】\n${userName}\n${dateStr} ${timeStr}`);

    return { status: 'success', message: 'Clocked in successfully', time: timeStr };
}

/**
 * Handle Clock Out Action
 * 最終修正: 勤務時間計算をA列のフルタイムスタンプ (sheetDate) に一本化。
 */
function handleClockOut(data) {
    const { userId, userName } = data;
    const now = new Date(); // 退勤時刻（フルタイムスタンプ）
    const dateStr = formatDate(now); 
    const timeStr = formatTime(now);

    const sheet = getSheet('打刻記録');
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();

    let rowIndex = -1;
    let clockInTimeStr = ''; // D列の値を保持 (通知用)
    let sheetDate = null;     // A列のDateオブジェクトを保持 (計算用)

    // 検索ループ (最終行から上へ)
    for (let i = values.length - 1; i >= 1; i--) {
        const row = values[i];

        let rowDateStr = '';
        if (row[0]) {
            try {
                // A列の値から日付オブジェクトを取得し、sheetDateに保存
                const dateObj = (row[0] instanceof Date) ? row[0] : new Date(row[0]);
                rowDateStr = formatDate(dateObj);
                sheetDate = dateObj; 
            } catch (e) {
                // 日付解析エラー
                rowDateStr = String(row[0]);
            }
        }

        // 検索条件: 同日、同一ユーザーID、かつ退勤時刻（E列）が空
        if (rowDateStr === dateStr && row[1] === userId && row[4] === '') {
            rowIndex = i + 1; 
            
            // D列の値（出勤時刻）は、通知用としてそのまま取得
            clockInTimeStr = String(row[3]).trim(); 
            
            break;
        }
    }

    if (rowIndex === -1) {
        throw new Error('出勤記録が見つかりません。出勤打刻をしていませんか？');
    }
    
    // 勤務時間計算ロジック
    
    if (!sheetDate || isNaN(sheetDate.getTime())) {
        throw new Error('エラー: 出勤日時の情報が無効です。');
    }

    // 勤務時間の計算: now (退勤時刻) と sheetDate (出勤時刻+日付) の差で直接計算
    const durationMs = now.getTime() - sheetDate.getTime();
    
    if (isNaN(durationMs) || durationMs <= 0) {
        throw new Error('エラー: 勤務時間の計算に失敗しました (計算結果がゼロ以下)。');
    }
    
    const durationStr = formatDuration(durationMs);

    // Update row (E列に退勤時刻、F列に勤務時間を記入)
    sheet.getRange(rowIndex, 5).setValue(timeStr); 
    sheet.getRange(rowIndex, 6).setValue(durationStr); 

    // Send LINE Notification
    sendLineMessage(`【退勤】\n${userName}\n出勤：${clockInTimeStr}\n退勤：${timeStr}\n勤務：${durationStr}`);

    return { status: 'success', message: 'Clocked out successfully', time: timeStr, duration: durationStr };
}

/**
 * Handle Task Completion Report
 */
function handleTaskReport(data) {
    const { userId, userName, appUrl } = data;
    const now = new Date();
    const dateTimeStr = formatDateTime(now);

    const sheet = getSheet('課題完了記録');
    sheet.appendRow([dateTimeStr, userId, userName, appUrl, '']);

    // LINE通知を送信
    sendLineMessage(`【🎉課題完了報告🎉】\n研修生：${userName} (${userId})\n完了：${dateTimeStr}\n\nアプリURL: ${appUrl}\n\n確認をお願いします！`);

    return { status: 'success', message: 'Reported successfully' };
}

/**
 * Helper: Send LINE Message
 */
function sendLineMessage(text) {
    const url = 'https://api.line.me/v2/bot/message/push';
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN
    };
    const payload = {
        'to': LINE_GROUP_ID,
        'messages': [{
            'type': 'text',
            'text': text
        }]
    };

    // トークンが有効であれば、ここでLINE通知が送信される
    UrlFetchApp.fetch(url, {
        'method': 'post',
        'headers': headers,
        'payload': JSON.stringify(payload),
        'muteHttpExceptions': false
    });
}

/**
 * Helper: Get Sheet by Name
 */
function getSheet(name) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        // Initialize headers if new
        if (name === '研修生マスタ') sheet.appendRow(['研修生ID', '氏名', 'ステータス']);
        if (name === '打刻記録') sheet.appendRow(['日付', '研修生ID', '氏名', '出勤時刻', '退勤時刻', '勤務時間']);
        if (name === '課題完了記録') sheet.appendRow(['完了日時', '研修生ID', '氏名', 'アプリURL', '判定']);
    }
    return sheet;
}

/**
 * Helper: Date Formatters
 */
function formatDate(date) {
    return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd');
}

function formatTime(date) {
    return Utilities.formatDate(date, 'Asia/Tokyo', 'HH:mm');
}

function formatDateTime(date) {
    return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

function formatDuration(ms) {
    const totalMinutes = Math.floor(ms / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}時間${minutes}分`;
}