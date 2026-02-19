// HW 2 - Hunter Doradea

document.addEventListener("DOMContentLoaded", () => {
  const startBtn = document.getElementById("startBtn");
  const waveformSelect = document.getElementById("waveform");
  const modeSelect = document.getElementById("mode");
  const masterVolSlider = document.getElementById("masterVol");
  const partialsSlider = document.getElementById("partials");
  const amModFreqSlider = document.getElementById("amModFreq");
  const amDepthSlider = document.getElementById("amDepth");
  const fmModFreqSlider = document.getElementById("fmModFreq");
  const fmIndexSlider = document.getElementById("fmIndex");
  const attackSlider = document.getElementById("attack");
  const decaySlider = document.getElementById("decay");
  const sustainSlider = document.getElementById("sustain");
  const releaseSlider = document.getElementById("release");
  const lfoRateSlider = document.getElementById("lfoRate");
  const lfoDepthSlider = document.getElementById("lfoDepth");
  const filterBaseSlider = document.getElementById("filterBase");

  // same keyboard that i used in the last assignment - hw 1 - nothing here is different tbh, just some layout stuff
  const keyboardFrequencyMap = {
    '90': 261.625565300598634,  '83': 277.182630976872096,  '88': 293.664767917407560,
    '68': 311.126983722080910,  '67': 329.627556912869929,  '86': 349.228231433003884,
    '71': 369.994422711634398,  '66': 391.995435981749294,  '72': 415.304697579945138,
    '78': 440.000000000000000,  '74': 466.163761518089916,  '77': 493.883301256124111,
    '81': 523.251130601197269,  '50': 554.365261953744192,  '87': 587.329535834815120,
    '51': 622.253967444161821,  '69': 659.255113825739859,  '82': 698.456462866007768,
    '53': 739.988845423268797,  '84': 783.990871963498588,  '54': 830.609395159890277,
    '89': 880.000000000000000,  '55': 932.327523036179832,  '85': 987.766602512248223,
  };

  // AGS
  let audioContext = null;
  let globalFilterNode = null;
  let masterVolumeGain = null;

  // LFO
  let lfoOscillator = null;
  let lfoDepthGain = null;

  // Polyphony map - this maps the keycode to the note
  const activeVoices = new Map();

  // okay this is me tweaking with this a bit to get the sound to sound a bit warmer - idk if this will sound any good tbh, but we will see
  const GAIN_FLOOR = 1e-4;
  const POLYPHONY_HEADROOM = 0.70;
  const MIX_SMOOTH_TIME_CONSTANT = 0.03;

  const PEAK_BY_MODE = {
    additive: 0.20,
    am: 0.24,
    fm: 0.19
  };

  const HARMONIC_ROLLOFF_EXPONENT = 1.30;

  // parameters from the UI
  function readUIState() {
    const adsr = {
      attack: Math.max(0.0005, parseFloat(attackSlider.value)),
      decay: Math.max(0.0005, parseFloat(decaySlider.value)),
      sustain: Math.min(1, Math.max(0, parseFloat(sustainSlider.value))),
      release: Math.max(0.005, parseFloat(releaseSlider.value)),
    };

    return {
      waveform: waveformSelect.value,
      mode: modeSelect.value,

      masterVol: Math.min(1, Math.max(0, parseFloat(masterVolSlider.value))),

      partials: Math.max(3, parseInt(partialsSlider.value, 10)),

      amModFreq: Math.max(0.01, parseFloat(amModFreqSlider.value)),
      amDepth: Math.min(1, Math.max(0, parseFloat(amDepthSlider.value))),

      fmModFreq: Math.max(0.01, parseFloat(fmModFreqSlider.value)),
      fmIndex: Math.min(3000, Math.max(0, parseFloat(fmIndexSlider.value))),

      adsr,

      lfoRate: Math.max(0.01, parseFloat(lfoRateSlider.value)),
      lfoDepth: Math.max(0, parseFloat(lfoDepthSlider.value)),
      filterBase: Math.max(40, parseFloat(filterBaseSlider.value)),
    };
  }

  // envelope
  function applyEnvelopeAttack(gainParam, now, adsr, peak) {
    gainParam.cancelScheduledValues(now);
    gainParam.setValueAtTime(GAIN_FLOOR, now);

    const aEnd = now + adsr.attack;
    gainParam.exponentialRampToValueAtTime(Math.max(GAIN_FLOOR, peak), aEnd);

    const sustainLevel = Math.max(GAIN_FLOOR, peak * adsr.sustain);
    const dEnd = aEnd + adsr.decay;
    gainParam.exponentialRampToValueAtTime(sustainLevel, dEnd);
  }

  function applyEnvelopeRelease(gainParam, now, adsr) {
    gainParam.cancelScheduledValues(now);

    const tc = Math.max(0.001, adsr.release / 3.5);
    gainParam.setTargetAtTime(GAIN_FLOOR, now, tc);
  }

  // this is for the clipping - will have to come back and adjust this part
  function updateVoiceMixForPolyphony() {
    if (!audioContext) return;

    const now = audioContext.currentTime;
    const n = Math.max(1, activeVoices.size);
    const perVoice = POLYPHONY_HEADROOM / n;

    for (const voice of activeVoices.values()) {
      voice.voiceGain.gain.setTargetAtTime(perVoice, now, MIX_SMOOTH_TIME_CONSTANT);
    }
  }

  // visual aesthetic - i still want it to change background color when a diff note is played based on the frequency - it was fun/cute
  function setBackground(freq) {
    const t = Date.now() / 1000;
    const hue = Math.floor((Math.log(freq) * 110 + t * 18) % 360);
    document.body.style.backgroundColor = `hsl(${hue} 55% 14%)`;
  }

  // LFO
  function updateLFOFromUI() {
    if (!audioContext) return;

    const p = readUIState();
    const now = audioContext.currentTime;

    // Base cutoff (smoothly)
    globalFilterNode.frequency.setTargetAtTime(p.filterBase, now, 0.08);

    if (!lfoOscillator) {
      lfoOscillator = audioContext.createOscillator();
      lfoOscillator.type = "sine"; // smoother than triangle for cinematic pads

      lfoDepthGain = audioContext.createGain();

      lfoOscillator.connect(lfoDepthGain);
      lfoDepthGain.connect(globalFilterNode.frequency);

      lfoOscillator.start();
    }

    lfoOscillator.frequency.setTargetAtTime(p.lfoRate, now, 0.08);
    lfoDepthGain.gain.setTargetAtTime(p.lfoDepth, now, 0.08);
  }

  // the voice builderssss

  // Additive and same envelope for all additives
  function createAdditiveVoice(freq, p) {
    const now = audioContext.currentTime;

    const envGain = audioContext.createGain();
    envGain.gain.setValueAtTime(GAIN_FLOOR, now);

    const voiceGain = audioContext.createGain();
    voiceGain.gain.setValueAtTime(0, now);

    const sum = audioContext.createGain();
    sum.gain.setValueAtTime(1, now);

    const sources = [];
    const cleanup = [sum];

    for (let n = 1; n <= p.partials; n++) {
      const osc = audioContext.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * n, now);

      const g = audioContext.createGain();
      g.gain.setValueAtTime(Math.pow(n, -HARMONIC_ROLLOFF_EXPONENT), now);

      osc.connect(g);
      g.connect(sum);

      osc.start(now);

      sources.push(osc);
      cleanup.push(g);
    }

    sum.connect(envGain);
    envGain.connect(voiceGain);
    voiceGain.connect(globalFilterNode);

    applyEnvelopeAttack(envGain.gain, now, p.adsr, PEAK_BY_MODE.additive);

    return { sources, envGain, voiceGain, cleanup };
  }

  // AM
  function createAMVoice(freq, p) {
    const now = audioContext.currentTime;

    const envGain = audioContext.createGain();
    envGain.gain.setValueAtTime(GAIN_FLOOR, now);

    const voiceGain = audioContext.createGain();
    voiceGain.gain.setValueAtTime(0, now);

    const carrier = audioContext.createOscillator();
    carrier.type = p.waveform;
    carrier.frequency.setValueAtTime(freq, now);

    const amp = audioContext.createGain();

    const mod = audioContext.createOscillator();
    mod.type = "sine";
    mod.frequency.setValueAtTime(p.amModFreq, now);

    const depthScale = (p.amDepth * 0.5);

    const modGain = audioContext.createGain();
    modGain.gain.setValueAtTime(depthScale, now);

    const offset = audioContext.createConstantSource();
    offset.offset.setValueAtTime(1 - depthScale, now);

    mod.connect(modGain);
    modGain.connect(amp.gain);
    offset.connect(amp.gain);

    carrier.connect(amp);
    amp.connect(envGain);
    envGain.connect(voiceGain);
    voiceGain.connect(globalFilterNode);

    carrier.start(now);
    mod.start(now);
    offset.start(now);

    applyEnvelopeAttack(envGain.gain, now, p.adsr, PEAK_BY_MODE.am);

    return { sources: [carrier, mod, offset], envGain, voiceGain, cleanup: [amp, modGain] };
  }

  // FM
  function createFMVoice(freq, p) {
    const now = audioContext.currentTime;

    const envGain = audioContext.createGain();
    envGain.gain.setValueAtTime(GAIN_FLOOR, now);

    const voiceGain = audioContext.createGain();
    voiceGain.gain.setValueAtTime(0, now);

    const carrier = audioContext.createOscillator();
    carrier.type = p.waveform;
    carrier.frequency.setValueAtTime(freq, now);

    const mod = audioContext.createOscillator();
    mod.type = "sine";
    mod.frequency.setValueAtTime(p.fmModFreq, now);

    const dev = audioContext.createGain();
    dev.gain.setValueAtTime(p.fmIndex, now);

    mod.connect(dev);
    dev.connect(carrier.frequency);

    carrier.connect(envGain);
    envGain.connect(voiceGain);
    voiceGain.connect(globalFilterNode);

    carrier.start(now);
    mod.start(now);

    applyEnvelopeAttack(envGain.gain, now, p.adsr, PEAK_BY_MODE.fm);

    return { sources: [carrier, mod], envGain, voiceGain, cleanup: [dev] };
  }

  function createVoiceForSelectedMode(freq) {
    const p = readUIState();
    if (p.mode === "additive") return createAdditiveVoice(freq, p);
    if (p.mode === "am") return createAMVoice(freq, p);
    return createFMVoice(freq, p);
  }

  // on and off functionality of notes - same as hw 1
  function startNote(keyCode) {
    if (!audioContext) return;

    const freq = keyboardFrequencyMap[keyCode];
    if (!freq) return;

    if (activeVoices.has(keyCode)) return;

    const voice = createVoiceForSelectedMode(freq);
    voice.freq = freq;

    activeVoices.set(keyCode, voice);

    updateVoiceMixForPolyphony();
    setBackground(freq);
  }

  function stopNote(keyCode) {
    if (!audioContext) return;

    const voice = activeVoices.get(keyCode);
    if (!voice) return;

    const p = readUIState();
    const now = audioContext.currentTime;

    applyEnvelopeRelease(voice.envGain.gain, now, p.adsr);

    const stopAt = now + (p.adsr.release * 1.15) + 0.08;

    let remaining = voice.sources.length;

    voice.sources.forEach((src) => {
      src.onended = () => {
        remaining -= 1;

        if (remaining <= 0) {
          try { voice.envGain.disconnect(); } catch (_) {}
          try { voice.voiceGain.disconnect(); } catch (_) {}

          voice.cleanup.forEach((n) => { try { n.disconnect(); } catch (_) {} });
          voice.sources.forEach((s) => { try { s.disconnect(); } catch (_) {} });

          activeVoices.delete(keyCode);
          updateVoiceMixForPolyphony();
        }
      };

      try { src.stop(stopAt); } catch (_) {}
    });
  }

  // starting the audio
  startBtn.addEventListener("click", async () => {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();

      globalFilterNode = audioContext.createBiquadFilter();
      globalFilterNode.type = "lowpass";

      // adjustment here for the warmer sound (maybe idk - test this out)
      globalFilterNode.Q.value = 0.7;

      masterVolumeGain = audioContext.createGain();
      masterVolumeGain.gain.setValueAtTime(readUIState().masterVol, audioContext.currentTime);

      globalFilterNode.connect(masterVolumeGain);
      masterVolumeGain.connect(audioContext.destination);

      updateLFOFromUI();

      // live updates!!!!!
      masterVolSlider.addEventListener("input", () => {
        if (!audioContext) return;
        masterVolumeGain.gain.setTargetAtTime(readUIState().masterVol, audioContext.currentTime, 0.05);
      });

      lfoRateSlider.addEventListener("input", updateLFOFromUI);
      lfoDepthSlider.addEventListener("input", updateLFOFromUI);
      filterBaseSlider.addEventListener("input", updateLFOFromUI);
    }

    await audioContext.resume();
  });

  // and then finally the actual keyboard listener
  window.addEventListener("keydown", (e) => {
    if (!audioContext) return;
    if (e.repeat) return;

    const keyCode = (e.keyCode || e.which).toString();
    startNote(keyCode);
  });

  window.addEventListener("keyup", (e) => {
    if (!audioContext) return;

    const keyCode = (e.keyCode || e.which).toString();
    stopNote(keyCode);
  });
});


