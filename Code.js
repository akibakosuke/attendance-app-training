/**
 * LINE Messaging API Config
 */
const LINE_ACCESS_TOKEN = 'YOZ7UftinQaO3OyBDaloYu4cXzhYtLzmqBzAGNvCIJRg7h+DoqsX0n6OX dfOFZ9vI7/+VIOKgdWLHJ6yBmeAi6kPqz4+FZ3vpHQTBEAQSHA81c9tQL H/8oP8UUyRpnHxvmJ0QlaAjZWiraJeO38tBgdB04t89/1O/w1cDnyilFU =';
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
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.message }))
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
    sheet.appendRow([now, userId, userName, timeStr, '', '']); 

    const dateStr = formatDate(now);
    sendLineMessage(`【出勤】\n${userName}\n${dateStr} ${timeStr}`);

    return { status: 'success', message: 'Clocked in successfully', time: timeStr };
}

/**
 * Handle Clock Out Action
 * 最終修正: NaNを防ぐため、DateオブジェクトのsetHours/setMinutesメソッドを使用して
 * 出勤時刻のDateオブジェクトを安全に構築するように変更。
 */
function handleClockOut(data) {
    const { userId, userName } = data;
    const now = new Date();
    const dateStr = formatDate(now); 
    const timeStr = formatTime(now);

    const sheet = getSheet('打刻記録');
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();

    // Find the last clock-in record for this user today that doesn't have a clock-out time
    let rowIndex = -1;
    let clockInTimeStr = '';
    let sheetDate = null; // ⭐️ 追加: シートから読み込んだ日付オブジェクトを保持

    // i >= 1: ヘッダー行 (i=0) はスキップし、最終行から上に向かってループ
    for (let i = values.length - 1; i >= 1; i--) {
        const row = values[i];

        let rowDateStr = '';
        if (row[0]) {
            try {
                const dateObj = (row[0] instanceof Date) ? row[0] : new Date(row[0]);
                rowDateStr = formatDate(dateObj);
                sheetDate = dateObj; // ⭐️ 成功した日付オブジェクトを保持
            } catch (e) {
                rowDateStr = String(row[0]);
            }
        }

        if (rowDateStr === dateStr && row[1] === userId && row[4] === '') {
            rowIndex = i + 1;
            clockInTimeStr = String(row[3]).trim(); 
            break;
        }
    }

    if (rowIndex === -1) {
        throw new Error('出勤記録が見つかりません。出勤打刻をしていませんか？');
    }
    
    // ⭐️ 勤務時間計算ロジックを安全な方法に変更 ⭐️
    
    // 1. sheetDateが有効か確認
    if (!sheetDate || isNaN(sheetDate.getTime())) {
        throw new Error('エラー: スプレッドシートの日付情報が無効です。');
    }

    // 2. 出勤時刻文字列を HH, mm に分解
    const timeParts = clockInTimeStr.split(':').map(Number);
    if (timeParts.length !== 2 || timeParts.some(isNaN)) {
        throw new Error('エラー: 出勤時刻の形式が不正です。');
    }
    const [inHours, inMinutes] = timeParts;

    // 3. sheetDate (日付) に出勤時刻をセットしてstartTimeを生成
    let startTime = new Date(sheetDate);
    startTime.setHours(inHours, inMinutes, 0, 0); // 時、分、秒、ミリ秒をセット
    
    // 4. 勤務時間を計算
    const durationMs = now.getTime() - startTime.getTime();
    
    if (isNaN(durationMs) || durationMs < 0) {
        // durationMsがマイナスになるのは通常、退勤が出勤より早い時刻になった場合（ありえない）
        throw new Error('エラー: 勤務時間の計算に失敗しました (時刻情報が不正)。');
    }
    
    const durationStr = formatDuration(durationMs);

    // Update row
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

    UrlFetchApp.fetch(url, {
        'method': 'post',
        'headers': headers,
        'payload': JSON.stringify(payload)
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