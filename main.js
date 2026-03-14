const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, dialog, Tray, Menu, screen } = require('electron');
const path = require('path');
const WebSocket = require('ws');
const { exec } = require('child_process');

let mainWindow;           // 通常のサジェスト窓
let concentrationWindow;  // 集中モード用の蓄積窓
let selectorWindow;       // 範囲選択用のオーバーレイ
let tray;
let wsServer;
let learnedWords = [];
let isConcentrationMode = false;
let concentrationBuffer = ""; // 集中モードで蓄積されたテキスト
let selectionRect = null;     // 選択されたキャプチャ範囲
let ocrTimer = null;         // OCR実行用のタイマー

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    if (process.platform === 'win32') {
        mainWindow.setMenuBarVisibility(false);
    }
    mainWindow.loadFile('index.html');

    mainWindow.on('blur', () => {
        if (!isConcentrationMode) {
            if (process.platform === 'darwin') app.hide();
            else mainWindow.hide();
        }
    });
}

function createConcentrationWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    concentrationWindow = new BrowserWindow({
        width: 850,
        height: 250,
        x: Math.floor((width - 850) / 2),
        y: height - 260,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        focusable: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    concentrationWindow.loadFile('concentration.html');
}

function createSelectorWindow() {
    const { width, height } = screen.getPrimaryDisplay().bounds;
    selectorWindow = new BrowserWindow({
        width: width,
        height: height,
        x: 0,
        y: 0,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        enableLargerThanScreen: true,
        hasShadow: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    selectorWindow.loadFile('selector.html');
}

function createTray() {
    try {
        tray = new Tray(path.join(__dirname, 'index.html'));
    } catch (e) { }
    updateTrayMenu();
}

function updateTrayMenu() {
    if (!tray) return;
    const contextMenu = Menu.buildFromTemplate([
        { label: 'AutoComp', enabled: false },
        { type: 'separator' },
        {
            label: `集中モード: ${isConcentrationMode ? 'ON' : 'OFF'}`,
            type: 'checkbox',
            checked: isConcentrationMode,
            click: toggleConcentrationMode
        },
        { type: 'separator' },
        { label: '単語リストをリセット', click: () => { learnedWords = []; } },
        { label: 'アプリを終了', click: () => app.quit() }
    ]);
    tray.setContextMenu(contextMenu);
}

function toggleConcentrationMode() {
    isConcentrationMode = !isConcentrationMode;

    if (isConcentrationMode) {
        concentrationBuffer = "";
        selectionRect = null;
        if (concentrationWindow) {
            concentrationWindow.webContents.send('clear-text');
        }

        if (!selectorWindow) createSelectorWindow();
        selectorWindow.setIgnoreMouseEvents(false); // 選択時はマウスイベントを受け取る
        selectorWindow.webContents.send('reset-selector');
        selectorWindow.show();

        if (mainWindow) mainWindow.webContents.send('mode-change', true);
    } else {
        if (selectorWindow) {
            selectorWindow.setIgnoreMouseEvents(false);
            selectorWindow.hide();
        }
        if (concentrationWindow) concentrationWindow.hide();
        if (concentrationBuffer) {
            clipboard.writeText(concentrationBuffer);
        }
        if (mainWindow) mainWindow.webContents.send('mode-change', false);
    }
    updateTrayMenu();

    if (ocrTimer) clearTimeout(ocrTimer);
    runOCRScan();
}

ipcMain.on('set-selection-range', (event, rect) => {
    selectionRect = rect;

    // 範囲が決まったら「赤い枠」だけ残してマウスイベントを透過させる
    if (selectorWindow) {
        selectorWindow.setIgnoreMouseEvents(true, { forward: true });
        // selectorWindow.show() のまま、UI側が selected クラスで見た目を調整
    }

    if (concentrationWindow) {
        concentrationWindow.showInactive();
    }

    if (ocrTimer) clearTimeout(ocrTimer);
    runOCRScan();
});

ipcMain.on('cancel-selection', () => {
    isConcentrationMode = false;
    if (selectorWindow) selectorWindow.hide();
    updateTrayMenu();
});

function startWebSocketServer() {
    let port = 18080;
    const maxTries = 3;
    let tryCount = 0;

    const tryStart = (p) => {
        const server = new WebSocket.Server({ port: p }, () => {
            console.log(`WebSocket Server listening on port ${p}`);
        });

        wsServer = server;

        wsServer.on('connection', (ws) => {
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    if (data.type === 'LEARN_WORDS' && Array.isArray(data.words)) {
                        updateLearnedWords(data.words);
                    }
                } catch (e) { }
            });
        });

        // ポート衝突時の自動リトライ
        wsServer.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                if (tryCount < maxTries) {
                    tryCount++;
                    console.warn(`Port ${p} busy, trying ${p + 1}...`);
                    tryStart(p + 1);
                } else {
                    // 最終手段：ポート0（OSにお任せ）で起動してクラッシュを防ぐ
                    console.warn(`All preferred ports busy, using ephemeral port...`);
                    tryStart(0);
                }
            } else {
                console.error("WS Server Error:", err);
            }
        });
    };

    try {
        tryStart(port);
    } catch (e) {
        console.error("Initial WS start failed:", e);
    }
}

// 予期せぬエラーでアプリが落ちるのを防ぐ最終防衛線
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

function updateLearnedWords(newItems) {
    let updated = false;
    newItems.forEach(item => {
        const cleaned = item.trim();
        if (!learnedWords.includes(cleaned) && cleaned.length > 2) {
            learnedWords.push(cleaned);
            updated = true;
        }
    });
    if (updated) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-words', learnedWords);
        }
    }
}

function pasteText(text) {
    if (process.platform === 'darwin') app.hide();
    else mainWindow.hide();
    clipboard.writeText(text);
    setTimeout(() => {
        if (process.platform === 'darwin') {
            exec('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', (err) => {
                if (err) dialog.showErrorBox("Error", "アクセシビリティ権限を確認してください。");
            });
        } else if (process.platform === 'win32') {
            const powershellCommand = `powershell -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys('^v')"`;
            exec(powershellCommand);
        }
    }, 300);
}

function runOCRScan() {
    let ocrBinaryPath;
    let args = [];

    // --- 配布環境と開発環境でのパス解決 ---
    const isPackaged = app.isPackaged;
    const resourcesPath = isPackaged
        ? path.join(process.resourcesPath, process.platform === 'win32' ? '' : 'Resources') // macOSはResourcesフォルダが一段深い場合がある
        : __dirname;

    // もし resourcesPath 直下になければ、開発環境と同様に __dirname をフォールバック
    const getBinaryPath = (name) => {
        const prodPath = path.join(process.resourcesPath, name);
        const devPath = path.join(__dirname, name);
        return require('fs').existsSync(prodPath) ? prodPath : devPath;
    };

    if (process.platform === 'darwin') {
        ocrBinaryPath = getBinaryPath('ocr');
    } else if (process.platform === 'win32') {
        ocrBinaryPath = getBinaryPath('ocr.exe');
    }
    else {
        return;
    }

    if (isConcentrationMode) {
        if (selectionRect) {
            args.push('--concentration');
            args.push('--crop');
            args.push(`${selectionRect.x},${selectionRect.y},${selectionRect.width},${selectionRect.height}`);
        } else {
            ocrTimer = setTimeout(runOCRScan, 500); // 待機時は少し長めに
            return;
        }
    }

    const cmd = `"${ocrBinaryPath}" ${args.join(' ')}`;

    exec(cmd, (err, stdout) => {
        if (!err) {
            try {
                const data = JSON.parse(stdout);
                if (data.results && Array.isArray(data.results)) {
                    // --- 1. 内部座標マッチング（システム用） ---
                    // 以前はここで視覚的ハイライトを送っていましたが、ユーザー要望により非表示化。
                    // 内部的には data.results を活用して重複判定を行います。

                    // --- 2. 蓄積ロジック ---
                    if (isConcentrationMode) {
                        if (concentrationWindow && !concentrationWindow.isDestroyed()) {
                            // テキストだけでなく座標付きの結果を送る
                            concentrationWindow.webContents.send('add-text', data.results);
                        }
                    } else {
                        const items = data.results.map(r => r.text);
                        updateLearnedWords(items);
                    }
                }
            } catch (e) { }
        }

        // --- 安定スキャン設定 (300ms -> 500ms) ---
        // 精度低下を防ぐため、OSのキャプチャ安定を考慮して500ms（秒間2回）に設定
        const nextInterval = isConcentrationMode ? 500 : 3000;
        ocrTimer = setTimeout(runOCRScan, nextInterval);
    });
}

app.whenReady().then(() => {
    createWindow();
    createConcentrationWindow();
    createSelectorWindow();
    createTray();
    startWebSocketServer();
    runOCRScan();

    globalShortcut.register('CommandOrControl+Shift+Space', () => {
        if (mainWindow.isVisible()) {
            if (process.platform === 'darwin') app.hide();
            else mainWindow.hide();
        } else {
            if (process.platform === 'darwin') app.show();
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('focus-input');
        }
    });

    globalShortcut.register('CommandOrControl+Shift+L', toggleConcentrationMode);

    ipcMain.on('paste-word', (event, word) => {
        pasteText(word);
    });

    ipcMain.on('update-concentration-buffer', (event, text) => {
        concentrationBuffer = text;
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
