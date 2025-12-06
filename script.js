/**
 * Configuration
 * REPLACE THIS URL with your deployed GAS Web App URL
 */
const GAS_WEB_APP_URL = 'YOUR_GAS_WEB_APP_URL_HERE'; // TODO: User needs to update this

// User Info (Simulation)
// In a real app, this might come from login or URL parameters
const USER_ID = 'user01';
const USER_NAME = '田中太郎';

// DOM Elements
const currentDateEl = document.getElementById('currentDate');
const currentTimeEl = document.getElementById('currentTime');
const clockInBtn = document.getElementById('clockInBtn');
const clockOutBtn = document.getElementById('clockOutBtn');
const statusValueEl = document.getElementById('statusValue');
const userIdDisplay = document.getElementById('userIdDisplay');
const userNameDisplay = document.getElementById('userNameDisplay');
const loadingOverlay = document.getElementById('loadingOverlay');

// Modal Elements
const showReportModalBtn = document.getElementById('showReportModalBtn');
const reportModal = document.getElementById('reportModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelReportBtn = document.getElementById('cancelReportBtn');
const submitReportBtn = document.getElementById('submitReportBtn');
const appUrlInput = document.getElementById('appUrlInput');

// State
let currentStatus = 'none'; // 'none', 'clocked_in', 'clocked_out'

// Initialize
function init() {
    updateDateTime();
    setInterval(updateDateTime, 1000);

    // Set User Info
    userIdDisplay.textContent = `ID: ${USER_ID}`;
    userNameDisplay.textContent = `Name: ${USER_NAME}`;

    // Load State from LocalStorage (Simulated persistence)
    loadState();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW registered!', reg))
            .catch(err => console.error('SW registration failed', err));
    }
}

// Clock Functions
function updateDateTime() {
    const now = new Date();
    const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' };
    currentDateEl.textContent = now.toLocaleDateString('ja-JP', dateOptions);

    const timeOptions = { hour: '2-digit', minute: '2-digit' };
    currentTimeEl.textContent = now.toLocaleTimeString('ja-JP', timeOptions);
}

function loadState() {
    const savedStatus = localStorage.getItem('attendance_status');
    if (savedStatus) {
        currentStatus = savedStatus;
    }
    updateUI();
}

function saveState(status) {
    currentStatus = status;
    localStorage.setItem('attendance_status', status);
    updateUI();
}

function updateUI() {
    // Reset Buttons
    clockInBtn.classList.add('hidden');
    clockOutBtn.classList.add('hidden');
    statusValueEl.className = 'status-value'; // Reset color classes if any

    if (currentStatus === 'clocked_in') {
        clockOutBtn.classList.remove('hidden');
        statusValueEl.textContent = '勤務中 (On Duty)';
        statusValueEl.style.color = 'var(--secondary-color)';
    } else {
        clockInBtn.classList.remove('hidden');
        statusValueEl.textContent = '出勤前 / 退勤済 (Off Duty)';
        statusValueEl.style.color = 'var(--text-sub)';
    }
}

// API Calls
async function callApi(action, payload = {}) {
    if (GAS_WEB_APP_URL === 'YOUR_GAS_WEB_APP_URL_HERE') {
        alert('エラー：GAS Web App URLが設定されていません。script.jsを確認してください。');
        return null;
    }

    loadingOverlay.classList.remove('hidden');

    const data = {
        action: action,
        userId: USER_ID,
        userName: USER_NAME,
        ...payload
    };

    try {
        // Use 'no-cors' mode if hosting on GitHub Pages and hitting GAS, 
        // BUT 'no-cors' treats response as opaque (cant read JSON). 
        // For GAS doPost to work with CORS from simple fetch, GAS script must return valid TextOutput.
        // Standard fetch:
        const response = await fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            mode: 'cors', // Important for GAS
            headers: {
                'Content-Type': 'text/plain;charset=utf-8', // Send as text/plain to avoid preflight OPTION request which GAS doesn't handle well
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        return result;

    } catch (error) {
        console.error('API Error:', error);
        alert('通信エラーが発生しました。');
        return null;
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

// Event Listeners
clockInBtn.addEventListener('click', async () => {
    if (!confirm('出勤しますか？')) return;

    const result = await callApi('clockIn');
    if (result && result.status === 'success') {
        alert(`出勤しました！ (${result.time})`);
        saveState('clocked_in');
    }
});

clockOutBtn.addEventListener('click', async () => {
    if (!confirm('退勤しますか？')) return;

    const result = await callApi('clockOut');
    if (result && result.status === 'success') {
        alert(`退勤しました！\n勤務時間: ${result.duration}`);
        saveState('clocked_out');
    }
});

// Modal Logic
showReportModalBtn.addEventListener('click', () => {
    reportModal.classList.remove('hidden');
});

const closeModal = () => {
    reportModal.classList.add('hidden');
    appUrlInput.value = '';
};

closeModalBtn.addEventListener('click', closeModal);
cancelReportBtn.addEventListener('click', closeModal);
reportModal.addEventListener('click', (e) => {
    if (e.target === reportModal) closeModal();
});

submitReportBtn.addEventListener('click', async () => {
    const url = appUrlInput.value;
    if (!url) {
        alert('URLを入力してください。');
        return;
    }

    const result = await callApi('reportTask', { appUrl: url });
    if (result && result.status === 'success') {
        alert('課題完了報告を送信しました！');
        closeModal();
    }
});

// Start
init();
