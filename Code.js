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
 * 修正済み: A列にDateオブジェクト (now) を直接書き込み、日付記録の確実性を向上。
 */
function handleClockIn(data) {
    const { userId, userName } = data;
    const now = new Date();
    const timeStr = formatTime(now);

    const sheet = getSheet('打刻記録');
    // A列にDateオブジェクト、D列に出勤時刻文字列
    sheet.appendRow([now, userId, userName, timeStr, '', '']); 

    const dateStr = formatDate(now);
    sendLineMessage(`【出勤】\n${userName}\n${dateStr} ${timeStr}`);

    return { status: 'success', message: 'Clocked in successfully', time: timeStr };
}

/**
 * Handle Clock Out Action
 * 最終修正: 出勤時刻データ（D列）がどのような形式で読み込まれても、
 * formatTimeでHH:mm文字列に変換し、NaNを防ぐ最も堅牢なロジックを実装。
 */
function handleClockOut(data) {
    const { userId, userName } = data;
    const now = new Date();
    const dateStr = formatDate(now); 
    const timeStr = formatTime(now);

    const sheet = getSheet('打刻記録');
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();

    let rowIndex = -1;
    let clockInTimeStr = ''; 
    let sheetDate = null; 

    // 検索ループ
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
                rowDateStr = String(row[0]);
            }
        }

        if (rowDateStr === dateStr && row[1] === userId && row[4] === '') {
            rowIndex = i + 1; 
            
            let clockInValue = row[3];
            
            // ⭐️ 最終修正ロジック：D列の値をDateオブジェクトに強制変換してからHH:mm文字列を取得
            let timeValueForFormat = clockInValue;
            
            if (typeof clockInValue === 'number' && clockInValue < 1) {
                // シリアル値(数値)として読み込まれた場合: 基準日と結合してDateオブジェクト化
                const baseDate = new Date(1899, 11, 30, 0, 0, 0, 0);
                timeValueForFormat = new Date(baseDate.getTime() + clockInValue * 24 * 60 * 60 * 1000);
            } else if (typeof clockInValue === 'string') {
                // 文字列の場合: HH:mm形式か確認し、Dateオブジェクト化を試みる
                timeValueForFormat = new Date(`2000/01/01 ${clockInValue.trim()}`);
            }
            
            if (timeValueForFormat instanceof Date && !isNaN(timeValueForFormat.getTime())) {
                clockInTimeStr = formatTime(timeValueForFormat);
            } else {
                throw new Error(`エラー: 出勤時刻データが認識できません。スプレッドシートの値: ${clockInValue}`);
            }
            
            break;
        }
    }

    if (rowIndex === -1) {
        throw new Error('出勤記録が見つかりません。出勤打刻をしていませんか？');
    }
    
    // 勤務時間計算ロジック
    
    if (!sheetDate || isNaN(sheetDate.getTime())) {
        throw new Error('エラー: スプレッドシートの日付情報が無効です。');
    }

    // 出勤時刻文字列を HH, mm に分解
    const timeParts = clockInTimeStr.split(':').map(Number);
    
    // HH:mm形式であることを最終確認
    if (timeParts.length !== 2 || timeParts.some(isNaN)) {
        throw new Error(`エラー: 出勤時刻(${clockInTimeStr})の形式が不正です。`); 
    }
    const [inHours, inMinutes] = timeParts;

    // sheetDate (日付) に出勤時刻をセットしてstartTimeを生成
    let startTime = new Date(sheetDate);
    startTime.setHours(inHours, inMinutes, 0, 0); 
    
    // 勤務時間を計算
    const durationMs = now.getTime() - startTime.getTime();
    
    if (isNaN(durationMs) || durationMs < 0) {
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