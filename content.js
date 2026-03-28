// content.js
(function() {
  // グローバル変数の衝突を避けるため、即時関数で囲む
  let analyzerContainer = null;
  let audioContext = null;
  let animationId = null;
  let stream = null;
  let analyserL = null;
  let analyserR = null;

  // メッセージリスナー（重複登録を防ぐ）
  if (!window.audioAnalyzerListenerAdded) {
    window.audioAnalyzerListenerAdded = true;
    
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'ping') {
        sendResponse({ status: 'ok' });
        return;
      }
      
      if (request.action === 'toggleAnalyzer') {
        if (analyzerContainer) {
          stopAnalyzer();
        } else {
          startAnalyzer();
        }
        sendResponse({ success: true });
      }
    });
  }

  function startAnalyzer() {
    if (analyzerContainer) {
      stopAnalyzer();
    }
    
    // アナライザーコンテナを作成
    analyzerContainer = document.createElement('div');
    analyzerContainer.id = 'audio-analyzer-container';
    analyzerContainer.innerHTML = `
      <div id="analyzer-display">
        <canvas id="phase-analyzer" width="250" height="250"></canvas>
        <div id="meters-container">
          <div class="meter-wrapper">
            <canvas id="peak-meter-l" width="50" height="250"></canvas>
            <div class="meter-label">L</div>
          </div>
          <div class="meter-wrapper">
            <canvas id="peak-meter-r" width="50" height="250"></canvas>
            <div class="meter-label">R</div>
          </div>
          <div class="meter-wrapper">
            <canvas id="correlation-meter" width="50" height="250"></canvas>
            <div class="meter-label">CORR</div>
          </div>
        </div>
      </div>
    `;
    
    // スタイルを追加
    if (!document.getElementById('audio-analyzer-styles')) {
      const style = document.createElement('style');
      style.id = 'audio-analyzer-styles';
      style.textContent = `
        #audio-analyzer-container {
          position: fixed;
          top: 10px;
          right: 10px;
          width: 500px;
          height: 250px;
          background: #1a1a1a;
          border: 2px solid #333;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.8);
          z-index: 999999;
          display: flex;
          padding: 10px;
          font-family: monospace;
        }
        
        #analyzer-display {
          display: flex;
          gap: 10px;
          width: 100%;
        }
        
        #phase-analyzer {
          background: #000;
          border: 1px solid #444;
        }
        
        #meters-container {
          display: flex;
          gap: 10px;
          flex: 1;
        }
        
        .meter-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1;
        }
        
        .meter-label {
          color: #ccc;
          font-size: 12px;
          margin-top: 5px;
        }
        
        #peak-meter-l, #peak-meter-r, #correlation-meter {
          background: #111;
          border: 1px solid #444;
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(analyzerContainer);
    
    // オーディオキャプチャを開始
    startAudioCapture();
  }

  function stopAnalyzer() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close();
      audioContext = null;
    }
    
    if (analyzerContainer) {
      analyzerContainer.remove();
      analyzerContainer = null;
    }
    
    analyserL = null;
    analyserR = null;
  }

  async function startAudioCapture() {
    try {
      // メディア要素を探す（YouTube対応を含む）
      let mediaElements = [...document.querySelectorAll('audio, video')];
      
      // YouTubeの場合、再生中のビデオ要素を確実に取得
      if (window.location.hostname.includes('youtube.com')) {
        const ytVideo = document.querySelector('video.html5-main-video, video.video-stream');
        if (ytVideo) {
          mediaElements = [ytVideo];
        }
      }
      
      // 再生中のメディア要素をフィルタ
      const playingMedia = mediaElements.filter(el => !el.paused && el.readyState >= 2);
      
      if (playingMedia.length > 0) {
        // メディア要素から音声を取得
        console.log('Found media element:', playingMedia[0]);
        setupAudioAnalysisFromElement(playingMedia[0]);
      } else if (mediaElements.length > 0) {
        // 一時停止中でもメディア要素があれば使用
        console.log('Using paused media element:', mediaElements[0]);
        setupAudioAnalysisFromElement(mediaElements[0]);
      } else {
        // タブキャプチャを試す
        console.log('No media elements found, trying tab capture...');
        chrome.runtime.sendMessage({ action: 'getStreamId' }, async (response) => {
          if (response && response.streamId) {
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                  mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: response.streamId
                  }
                },
                video: false
              });
              setupAudioAnalysis(stream);
            } catch (error) {
              console.error('Failed to get user media:', error);
              // フォールバック: ダミーアナライザーを表示
              setupDummyAnalyzer();
            }
          } else {
            console.error('Failed to get stream ID:', response?.error);
            setupDummyAnalyzer();
          }
        });
      }
    } catch (error) {
      console.error('Audio capture error:', error);
      setupDummyAnalyzer();
    }
  }

  function setupDummyAnalyzer() {
    // 音声が取得できない場合のダミー表示
    const phaseCanvas = document.getElementById('phase-analyzer');
    const peakMeterLCanvas = document.getElementById('peak-meter-l');
    const peakMeterRCanvas = document.getElementById('peak-meter-r');
    const correlationCanvas = document.getElementById('correlation-meter');
    
    if (phaseCanvas) {
      const ctx = phaseCanvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 250, 250);
      ctx.fillStyle = '#333';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No audio source', 125, 125);
      ctx.font = '10px monospace';
      ctx.fillText('Try playing a video/audio', 125, 145);
    }
    
    // メーターも初期化
    [peakMeterLCanvas, peakMeterRCanvas, correlationCanvas].forEach(canvas => {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    });
  }

  function setupAudioAnalysisFromElement(mediaElement) {
    try {
      // メディア要素のクローンを作成して音声を取得する新しいアプローチ
      const useClone = false; // クローンアプローチは音声が聞こえなくなる問題があるため無効化
      
      // 既存のAudioContextがあれば再利用を試みる
      if (!audioContext || audioContext.state === 'closed') {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      let source;
      try {
        source = audioContext.createMediaElementSource(mediaElement);
      } catch (e) {
        console.warn('Media element may already be connected to another AudioContext');
        console.log('Switching to alternative visualization method...');
        
        // 代替案：captureStream APIを使用
        if (mediaElement.captureStream) {
          try {
            const stream = mediaElement.captureStream();
            setupAudioAnalysis(stream);
            return;
          } catch (captureError) {
            console.warn('captureStream failed:', captureError);
          }
        }
        
        // それでもダメな場合は、Web Audio APIを使わない簡易表示
        setupSimpleVisualizer(mediaElement);
        return;
      }
      
      // チャンネルスプリッターを作成
      const splitter = audioContext.createChannelSplitter(2);
      
      // 左右チャンネル用のアナライザー
      analyserL = audioContext.createAnalyser();
      analyserR = audioContext.createAnalyser();
      analyserL.fftSize = 2048;
      analyserR.fftSize = 2048;
      analyserL.smoothingTimeConstant = 0.8;
      analyserR.smoothingTimeConstant = 0.8;
      
      // モノラル音源の場合のフォールバック
      const merger = audioContext.createChannelMerger(2);
      
      // 接続
      source.connect(splitter);
      
      // スプリッターからアナライザーへ接続（エラーハンドリング付き）
      try {
        splitter.connect(analyserL, 0);
        splitter.connect(analyserR, 1);
      } catch (e) {
        // モノラル音源の場合
        console.log('Mono source detected, duplicating to both channels');
        source.connect(analyserL);
        source.connect(analyserR);
      }
      
      // 音声を出力に接続（ミュートされないように）
      source.connect(audioContext.destination);
      
      // AudioContextが一時停止している場合は再開
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      
      // アニメーションループを開始
      animate();
    } catch (error) {
      console.error('Failed to setup audio analysis:', error);
      setupDummyAnalyzer();
    }
  }
  
  // Web Audio APIが使えない場合の簡易ビジュアライザ
  function setupSimpleVisualizer(mediaElement) {
    console.log('Using simple visualizer for media element');
    const phaseCanvas = document.getElementById('phase-analyzer');
    const peakMeterLCanvas = document.getElementById('peak-meter-l');
    const peakMeterRCanvas = document.getElementById('peak-meter-r');
    const correlationCanvas = document.getElementById('correlation-meter');
    
    if (!phaseCanvas || !peakMeterLCanvas || !peakMeterRCanvas || !correlationCanvas) return;
    
    const phaseCtx = phaseCanvas.getContext('2d');
    const peakLCtx = peakMeterLCanvas.getContext('2d');
    const peakRCtx = peakMeterRCanvas.getContext('2d');
    const corrCtx = correlationCanvas.getContext('2d');
    
    // ピークホールド値
    let peakL = 0;
    let peakR = 0;
    let peakDecay = 0.95;
    
    // 音量に基づく簡易アニメーション
    function simpleAnimate() {
      animationId = requestAnimationFrame(simpleAnimate);
      
      const volume = mediaElement.volume;
      const playing = !mediaElement.paused;
      const currentTime = mediaElement.currentTime;
      
      // フェーズアナライザーの描画
      phaseCtx.fillStyle = 'rgba(0, 0, 0, 0.1)';
      phaseCtx.fillRect(0, 0, 250, 250);
      
      // グリッド
      phaseCtx.strokeStyle = '#333';
      phaseCtx.lineWidth = 1;
      phaseCtx.beginPath();
      phaseCtx.moveTo(125, 0);
      phaseCtx.lineTo(125, 250);
      phaseCtx.moveTo(0, 125);
      phaseCtx.lineTo(250, 125);
      phaseCtx.stroke();
      
      // 円
      phaseCtx.beginPath();
      phaseCtx.arc(125, 125, 100, 0, 2 * Math.PI);
      phaseCtx.stroke();
      
      if (playing) {
        // アニメーション波形（45度回転）
        phaseCtx.save();
        phaseCtx.translate(125, 125);
        phaseCtx.rotate(-Math.PI / 4); // 左側に45度回転
        phaseCtx.translate(-125, -125);
        
        phaseCtx.strokeStyle = '#00ff00';
        phaseCtx.lineWidth = 1.5;
        phaseCtx.beginPath();
        
        const points = 100;
        for (let i = 0; i < points; i++) {
          const angle = (i / points) * Math.PI * 2 + currentTime * 2;
          const radius = 40 + Math.sin(angle * 3 + currentTime * 5) * 30 * volume;
          const x = 125 + Math.cos(angle) * radius;
          const y = 125 + Math.sin(angle) * radius;
          
          if (i === 0) {
            phaseCtx.moveTo(x, y);
          } else {
            phaseCtx.lineTo(x, y);
          }
        }
        phaseCtx.closePath();
        phaseCtx.stroke();
        
        phaseCtx.restore();
      }
      
      // 簡易メーター表示（リアルな動きをシミュレート）
      if (playing) {
        const randomPeak = volume * (0.7 + Math.random() * 0.3);
        peakL = Math.max(peakL * peakDecay, randomPeak);
        peakR = Math.max(peakR * peakDecay, randomPeak * (0.9 + Math.random() * 0.2));
      } else {
        peakL *= 0.9;
        peakR *= 0.9;
      }
      
      drawPeakMeterSimple(peakLCtx, peakL);
      drawPeakMeterSimple(peakRCtx, peakR);
      drawSimpleCorrelation(corrCtx, playing ? 0.85 + Math.random() * 0.1 : 0);
    }
    
    simpleAnimate();
  }
  
  function drawPeakMeterSimple(ctx, level) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    
    // 背景
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, width, height);
    
    // レベルをdB風に変換
    const db = level > 0 ? 20 * Math.log10(level) : -Infinity;
    const clampedDb = Math.max(-96, Math.min(0, db));
    const meterHeight = ((clampedDb + 96) / 96) * height;
    
    // グラデーション
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#00ff00');
    gradient.addColorStop(0.5, '#ffff00');
    gradient.addColorStop(0.8, '#ff8800');
    gradient.addColorStop(1, '#ff0000');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(10, height - meterHeight, 30, meterHeight);
    
    // スケール
    ctx.strokeStyle = '#666';
    ctx.fillStyle = '#888';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    
    for (let dB = 0; dB >= -96; dB -= 3) {
      const y = height - ((dB + 96) / 96) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(5, y);
      ctx.stroke();
      
      if (dB % 6 === 0) {
        ctx.fillText(dB, 48, y + 3);
      }
    }
  }
  
  function drawSimpleCorrelation(ctx, correlation) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, width, height);
    
    const centerY = height / 2;
    const meterHeight = Math.abs(correlation) * (height / 2);
    
    ctx.fillStyle = correlation > 0.8 ? '#00ff00' : '#ffff00';
    ctx.fillRect(10, centerY - meterHeight, 30, meterHeight);
    
    ctx.strokeStyle = '#666';
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();
  }

  function setupAudioAnalysis(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    
    // チャンネルスプリッターを作成
    const splitter = audioContext.createChannelSplitter(2);
    
    // 左右チャンネル用のアナライザー
    analyserL = audioContext.createAnalyser();
    analyserR = audioContext.createAnalyser();
    analyserL.fftSize = 2048;
    analyserR.fftSize = 2048;
    analyserL.smoothingTimeConstant = 0.8;
    analyserR.smoothingTimeConstant = 0.8;
    
    // 接続
    source.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);
    
    // アニメーションループを開始
    animate();
  }

  function animate() {
    if (!analyserL || !analyserR) return;
    
    const phaseCanvas = document.getElementById('phase-analyzer');
    const peakMeterLCanvas = document.getElementById('peak-meter-l');
    const peakMeterRCanvas = document.getElementById('peak-meter-r');
    const correlationCanvas = document.getElementById('correlation-meter');
    
    if (!phaseCanvas || !peakMeterLCanvas || !peakMeterRCanvas || !correlationCanvas) return;
    
    const phaseCtx = phaseCanvas.getContext('2d');
    const peakLCtx = peakMeterLCanvas.getContext('2d');
    const peakRCtx = peakMeterRCanvas.getContext('2d');
    const corrCtx = correlationCanvas.getContext('2d');
    
    const bufferLength = analyserL.fftSize;
    const dataArrayL = new Float32Array(bufferLength);
    const dataArrayR = new Float32Array(bufferLength);
    
    function draw() {
      animationId = requestAnimationFrame(draw);
      
      // 時間領域データを取得
      analyserL.getFloatTimeDomainData(dataArrayL);
      analyserR.getFloatTimeDomainData(dataArrayR);
      
      // フェーズアナライザーを描画
      drawPhaseAnalyzer(phaseCtx, dataArrayL, dataArrayR);
      
      // ピークメーターを描画
      drawPeakMeter(peakLCtx, dataArrayL, 'L');
      drawPeakMeter(peakRCtx, dataArrayR, 'R');
      
      // ステレオ相関を描画
      drawCorrelationMeter(corrCtx, dataArrayL, dataArrayR);
    }
    
    draw();
  }

  function drawPhaseAnalyzer(ctx, dataL, dataR) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    
    // 背景をクリア
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, width, height);
    
    // 保存して回転を適用
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(-Math.PI / 4); // 左側に45度回転（-45度）
    ctx.translate(-centerX, -centerY);
    
    // グリッドを描画
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, height);
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();
    
    // 円を描画
    ctx.beginPath();
    ctx.arc(centerX, centerY, 100, 0, 2 * Math.PI);
    ctx.stroke();
    
    // リサジュー図形を描画
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    
    for (let i = 0; i < dataL.length; i += 2) {
      const y = centerX + dataL[i] * 100;
      const x = centerY - dataR[i] * 100;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    ctx.stroke();
    
    // 回転を元に戻す
    ctx.restore();
  }

  function drawPeakMeter(ctx, data, channel) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    
    // 背景をクリア
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, width, height);
    
    // ピーク値を計算
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
    }
    
    // dBに変換
    const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    const clampedDb = Math.max(-96, Math.min(0, db));
    
    // メーターの高さを計算（対数スケール）
    const meterHeight = ((clampedDb + 96) / 96) * height;
    
    // グラデーションを作成
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#00ff00');
    gradient.addColorStop(0.5, '#ffff00');
    gradient.addColorStop(0.8, '#ff8800');
    gradient.addColorStop(1, '#ff0000');
    
    // メーターを描画
    ctx.fillStyle = gradient;
    ctx.fillRect(10, height - meterHeight, 30, meterHeight);
    
    // スケールを描画（-3dB刻み）
    ctx.strokeStyle = '#666';
    ctx.fillStyle = '#888';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    
    for (let dB = 0; dB >= -96; dB -= 3) {
      const y = height - ((dB + 96) / 96) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(5, y);
      ctx.stroke();
      
      if (dB % 6 === 0) {
        ctx.fillText(dB, 48, y + 3);
      }
    }
  }

  function drawCorrelationMeter(ctx, dataL, dataR) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    
    // 背景をクリア
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, width, height);
    
    // 相関係数を計算
    let sumL = 0, sumR = 0, sumLR = 0, sumL2 = 0, sumR2 = 0;
    const n = Math.min(dataL.length, dataR.length);
    
    for (let i = 0; i < n; i++) {
      sumL += dataL[i];
      sumR += dataR[i];
      sumLR += dataL[i] * dataR[i];
      sumL2 += dataL[i] * dataL[i];
      sumR2 += dataR[i] * dataR[i];
    }
    
    const denominator = Math.sqrt(n * sumL2 - sumL * sumL) * Math.sqrt(n * sumR2 - sumR * sumR);
    const correlation = denominator > 0 ? (n * sumLR - sumL * sumR) / denominator : 0;
    
    // メーターを描画（-1から+1の範囲）
    const centerY = height / 2;
    const meterHeight = Math.abs(correlation) * (height / 2);
    
    // 色を決定
    let color;
    if (correlation > 0.8) {
      color = '#00ff00'; // 良好な相関
    } else if (correlation > 0.5) {
      color = '#ffff00'; // 中程度の相関
    } else if (correlation > 0) {
      color = '#ff8800'; // 低い相関
    } else {
      color = '#ff0000'; // 逆相関
    }
    
    ctx.fillStyle = color;
    
    if (correlation >= 0) {
      ctx.fillRect(10, centerY - meterHeight, 30, meterHeight);
    } else {
      ctx.fillRect(10, centerY, 30, meterHeight);
    }
    
    // センターラインを描画
    ctx.strokeStyle = '#666';
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();
    
    // スケールを描画
    ctx.fillStyle = '#888';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('+1', 48, 15);
    ctx.fillText('0', 48, centerY + 3);
    ctx.fillText('-1', 48, height - 5);
  }
})();
