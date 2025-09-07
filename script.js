
document.addEventListener('DOMContentLoaded', () => {
  // ---------- CONFIG ----------
  const BASELINE_MS = 200;       // how long to sample ambient noise (ms)
  const REQUIRED_FRAMES = 7;      // frames above threshold required (~100-200ms)
  const MIN_THRESHOLD = 0.012;    // minimum RMS threshold (very quiet)
  const THRESH_STD_FACTOR = 3.0;  // threshold = mean + factor * std
  const TEST_MODE = false;        // set true to auto-show surprise (for debug)
  // ----------------------------

  // Helpful element selectors (flexible to match your HTML)
  const cakeEl = document.querySelector('.cake') || document.getElementById('cake') || document.querySelector('.cake-container');
  const flameEls = document.querySelectorAll('.fuego');
  const birthdayText = document.getElementById('birthdayMessage') || document.querySelector('.birthday-text') || document.querySelector('h1');
  let notesEl = document.getElementById('notesPage') || document.getElementById('notes') || document.getElementById('notes-page');

  // if notes element doesn't exist, create one (keeps your CSS untouched)
  if (!notesEl) {
    notesEl = document.createElement('div');
    notesEl.id = 'notesPage';
    notesEl.style.display = 'none';
    notesEl.style.textAlign = 'center';
    notesEl.innerHTML = `<h1>💌 From Me to You</h1><div class="notes"><p>(Replace this with your notes.)</p></div>`;
    document.body.appendChild(notesEl);
  }

  // debug overlay (visible when TEST_MODE or if needed)
  const debug = document.createElement('div');
  debug.style.position = 'fixed';
  debug.style.left = '10px';
  debug.style.top = '10px';
  debug.style.padding = '6px 10px';
  debug.style.background = 'rgba(0,0,0,0.6)';
  debug.style.color = '#0f0';
  debug.style.fontFamily = 'monospace';
  debug.style.fontSize = '13px';
  debug.style.zIndex = 999999;
  debug.style.display = TEST_MODE ? 'block' : 'none';
  document.body.appendChild(debug);

  // manual fallback button (if mic blocked)
  let manualBtn = null;
  function showManualButton() {
    if (manualBtn) return;
    manualBtn = document.createElement('button');
    manualBtn.textContent = "Can't use mic? Click to reveal";
    manualBtn.style.position = 'fixed';
    manualBtn.style.bottom = '20px';
    manualBtn.style.left = '50%';
    manualBtn.style.transform = 'translateX(-50%)';
    manualBtn.style.zIndex = 999999;
    manualBtn.style.padding = '10px 14px';
    document.body.appendChild(manualBtn);
    manualBtn.addEventListener('click', () => {
      if (!blownOut) {
        blownOut = true;
        handleBlowDetected();
        manualBtn.remove();
      }
    });
  }

  // ---------- audio vars ----------
  let audioCtx = null;
  let analyser = null;
  let dataArray = null;
  let micStream = null;
  let blownOut = false;

  // helper: compute RMS from byte time domain data (0..1)
  function computeRMS(buf) {
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      const n = (buf[i] - 128) / 128; // -1..1
      sumSq += n * n;
    }
    return Math.sqrt(sumSq / buf.length); // 0..1
  }

  // TEST_MODE quick open
  if (TEST_MODE) {
    setTimeout(() => {
      revealSurprise(); // show cake instantly for testing
    }, 600);
  }

  // Start mic & sampling baseline then detection
  async function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn('getUserMedia not supported');
      showManualButton();
      return;
    }

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn('Mic access denied:', err);
      showManualButton();
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(()=>{});
    }

    const source = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    dataArray = new Uint8Array(analyser.fftSize);

    // first show surprise (cake) if it isn't already shown
    revealSurprise();

    // gather baseline
    const baselineSamples = [];
    const startTime = performance.now();
    function baselineLoop() {
      analyser.getByteTimeDomainData(dataArray);
      const rms = computeRMS(dataArray);
      baselineSamples.push(rms);
      // show debug immediate during baseline
      debug.style.display = 'block';
      debug.textContent = `Sampling ambient... RMS: ${rms.toFixed(3)}`;
      if (performance.now() - startTime < BASELINE_MS) {
        requestAnimationFrame(baselineLoop);
      } else {
        // compute stats
        const mean = baselineSamples.reduce((a,b)=>a+b,0)/baselineSamples.length;
        const variance = baselineSamples.reduce((a,b)=>a + (b-mean)*(b-mean),0)/baselineSamples.length;
        const std = Math.sqrt(variance);
        const dynamicThreshold = Math.max(MIN_THRESHOLD, mean + THRESH_STD_FACTOR * std);
        debug.textContent = `baseline mean:${mean.toFixed(3)} std:${std.toFixed(3)} threshold:${dynamicThreshold.toFixed(3)}`;
        // start main detect loop
        detectLoop(dynamicThreshold);
      }
    }
    baselineLoop();
  }

  // reveal surprise (cake) helper
  function revealSurprise() {
    document.querySelectorAll('.fuego').forEach(f => f.style.display = 'block');
    const surpriseEl = document.getElementById('surprise');
    if (surpriseEl) surpriseEl.style.display = 'block';
  }

  // main detection loop using adaptive threshold
  function detectLoop(threshold) {
    let consecutive = 0;
    const buf = dataArray;

    function loop() {
      if (!analyser) return;
      analyser.getByteTimeDomainData(buf);
      const rms = computeRMS(buf);

      // debug UI
      debug.textContent = `RMS:${rms.toFixed(3)} thr:${threshold.toFixed(3)} frames:${consecutive}`;

      if (rms > threshold) {
        consecutive++;
      } else {
        consecutive = Math.max(0, consecutive - 1);
      }

      if (consecutive >= REQUIRED_FRAMES && !blownOut) {
        blownOut = true;
        handleBlowDetected();
        return;
      }
      requestAnimationFrame(loop);
    }
    loop();
  }

  function handleBlowDetected() {
    document.querySelectorAll('.fuego').forEach(f => f.style.display = 'none');
    if (cakeEl) cakeEl.style.display = 'none';
    if (birthdayText) birthdayText.style.display = 'none';

    const subtitle = document.getElementById('subtitle');
    if (subtitle) subtitle.style.display = 'none';

    try { if (micStream) micStream.getTracks().forEach(t => t.stop()); } catch(e){}
    try { if (audioCtx) audioCtx.close().catch(()=>{}); } catch(e){}
    launchConfetti();
    notesEl.style.display = 'flex';
    notesEl.style.flexDirection = 'column';
    notesEl.style.alignItems = 'center';
    notesEl.style.justifyContent = 'center';
    document.querySelectorAll('.song').forEach(song => {
    song.style.display = 'block';
  });
    debug.style.display = 'none';
    if (manualBtn) manualBtn.remove();
  }

  function launchConfetti(seconds = 2) {
    let canvas = document.getElementById('confetti');
    let created = false;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'confetti';
      canvas.style.position = 'fixed';
      canvas.style.left = 0;
      canvas.style.top = 0;
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = 99998;
      document.body.appendChild(canvas);
      created = true;
    }
    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;

    const pieces = new Array(120).fill(0).map(() => ({
      x: Math.random()*w,
      y: Math.random()*-h,
      s: Math.random()*6+4,
      vy: Math.random()*3+2,
      color: `hsl(${Math.random()*360},100%,50%)`,
      r: Math.random()*Math.PI
    }));

    let start = performance.now();
    function frame(now) {
      const t = (now - start)/1000;
      ctx.clearRect(0,0,w,h);
      for (const p of pieces) {
        p.y += p.vy;
        p.x += Math.sin(p.y/50) * 2;
        ctx.save();
        ctx.translate(p.x,p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.s/2, -p.s/2, p.s, p.s);
        ctx.restore();
      }
      if (t < seconds) requestAnimationFrame(frame);
      else {
        ctx.clearRect(0,0,w,h);
        if (created) canvas.remove();
      }
    }
    requestAnimationFrame(frame);
    window.addEventListener('resize', ()=>{ w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; });
  }

  window.simulateBlow = function() {
    if (!blownOut) {
      blownOut = true;
      handleBlowDetected();
    }
  };

const audio = document.getElementById("song");
const popup = document.getElementById("popup");
const popupMessage = document.getElementById("popupMessage");
const closeBtn = document.getElementById("closeBtn");

let currentBtn = null;   // currently active button
let currentSrc = "";     // currently loaded song

// Play/pause toggle
document.querySelectorAll(".play-btn").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation(); // prevent triggering popup
    const src = btn.dataset.src;

    if (currentSrc === src) {
      // Same song: toggle play/pause
      if (audio.paused) {
        audio.play();
        btn.textContent = "⏸";
      } else {
        audio.pause();
        btn.textContent = "▶";
      }
    } else {
      // Different song: load and play
      audio.src = src;
      audio.play();
      btn.textContent = "⏸";

      // reset previous button
      if (currentBtn && currentBtn !== btn) {
        currentBtn.textContent = "▶";
      }

      currentBtn = btn;
      currentSrc = src;
    }
  });
});

// Popup trigger (click on card/image/text)
document.querySelectorAll(".song-card").forEach(card => {
  card.addEventListener("click", () => {
    const message = card.dataset.message;
    popupMessage.textContent = message;
    popup.classList.add("active");
  });
});

// Close popup
closeBtn.addEventListener("click", () => {
  popup.classList.remove("active");
});





  console.log('Birthday blow script loaded — attempting mic access immediately. Manual fallback will appear if blocked.');

  // Attempt mic immediately on page load
  startMic();

  // fallback manual button if mic not started within 2s
  setTimeout(() => {
    if (!audioCtx) showManualButton();
  }, 2000);

});
