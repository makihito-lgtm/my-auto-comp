const { ipcRenderer } = require('electron');

let currentWords = [];
let filteredWords = [];
let selectedIndex = -1;
let isComposing = false; // 日本語IMEで変換中かどうかのフラグ

const input = document.getElementById('searchInput');
const resultsDiv = document.getElementById('results');

// IMEの変換開始・終了を検知
input.addEventListener('compositionstart', () => {
    isComposing = true;
});
input.addEventListener('compositionend', () => {
    isComposing = false;
});

// メインプロセスから最新の単語リストを受け取る
ipcRenderer.on('update-words', (event, words) => {
    currentWords = words;
    renderResults();
});

// ウィンドウ表示時にフォーカスを当てる
ipcRenderer.on('focus-input', () => {
    input.value = '';
    input.focus();
    renderResults();
});

// モード変更の通知を受け取る
ipcRenderer.on('mode-change', (event, isConcentrationMode) => {
    const badge = document.getElementById('modeBadge');
    if (badge) {
        badge.style.display = isConcentrationMode ? 'inline-block' : 'none';
    }
});

input.addEventListener('input', () => {
    // 変換中であっても候補リストは更新させる
    renderResults();
});

function renderResults() {
    const query = input.value.toLowerCase().trim();
    resultsDiv.innerHTML = '';

    if (query.length === 0) {
        // 検索クエリが空の場合は、最新の学習単語を7件まで表示してあげる（逆順にして最新を上に）
        filteredWords = [...currentWords].reverse().slice(0, 7);
    } else {
        // クエリを含む単語を最大7件表示
        filteredWords = currentWords.filter(w => w.toLowerCase().includes(query)).slice(0, 7);
    }

    selectedIndex = filteredWords.length > 0 ? 0 : -1;

    filteredWords.forEach((w, index) => {
        const div = document.createElement('div');
        div.className = 'item';
        if (index === selectedIndex) {
            div.classList.add('selected');
        }
        div.textContent = w;

        // マウス操作（クリック）でもペーストを発火させる
        div.addEventListener('mousedown', (e) => {
            // テキストボックスのフォーカスが外れないようにデフォルトの動作をキャンセル
            e.preventDefault();
            ipcRenderer.send('paste-word', w);
        });

        resultsDiv.appendChild(div);
    });
}

input.addEventListener('keydown', (e) => {
    // IME変換中にEnterなどが押された場合は無視する
    if (isComposing) return;

    if (filteredWords.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % filteredWords.length;
        updateSelection();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + filteredWords.length) % filteredWords.length;
        updateSelection();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < filteredWords.length) {
            const selectedWord = filteredWords[selectedIndex];
            // メインプロセスへペースト命令を送る
            ipcRenderer.send('paste-word', selectedWord);
        }
    }
});

function updateSelection() {
    const items = resultsDiv.getElementsByClassName('item');
    for (let i = 0; i < items.length; i++) {
        if (i === selectedIndex) {
            items[i].classList.add('selected');
        } else {
            items[i].classList.remove('selected');
        }
    }
}
