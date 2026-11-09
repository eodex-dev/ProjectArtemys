/*
 * Núcleo da conversa por voz da Luna.
 * Sem dependência do DOM, para poder ser testado fora do navegador.
 *  - createVad: detecta quando o usuário começa e termina de falar e entrega UMA fala por vez.
 *  - encodeWav16k: converte o áudio capturado em WAV mono 16 kHz (aceito pelo Whisper em qualquer navegador).
 *  - text: utilitários de texto usados no chat e na voz.
 */
(function (root) {
  'use strict';

  function rmsOf(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / (buffer.length || 1));
  }

  function createVad(options) {
    const o = Object.assign({
      sampleRate: 48000,
      minThreshold: 0.012,   // volume mínimo para considerar fala
      noiseMultiplier: 3,    // fala precisa passar do ruído de fundo vezes este fator
      startFrames: 2,        // blocos seguidos acima do limite para começar uma fala
      preRollSec: 0.35,      // áudio guardado antes da fala, para não cortar o início
      endSilenceSec: 1.0,    // silêncio que encerra a fala
      minSpeechSec: 0.35,    // falas mais curtas que isso são descartadas (estalos, tosse)
      maxSec: 30,            // limite de uma fala
      onUtterance: function () {},
      onSpeechStart: function () {},
      onLevel: function () {}
    }, options || {});

    let active = true;
    let ignoreSec = 0;
    let noise = 0.004;
    let speaking = false;
    let voicedRun = 0;
    let silenceSec = 0;
    let voicedSec = 0;
    let totalSec = 0;
    let preRoll = [];
    let preRollSec = 0;
    let chunks = [];

    function reset() {
      speaking = false;
      voicedRun = 0;
      silenceSec = 0;
      voicedSec = 0;
      totalSec = 0;
      preRoll = [];
      preRollSec = 0;
      chunks = [];
    }

    function finish() {
      const keep = voicedSec >= o.minSpeechSec;
      const parts = chunks;
      reset();
      if (!keep) return;
      let length = 0;
      parts.forEach(function (part) { length += part.length; });
      const samples = new Float32Array(length);
      let offset = 0;
      parts.forEach(function (part) { samples.set(part, offset); offset += part.length; });
      o.onUtterance(samples, o.sampleRate);
    }

    function push(buffer) {
      if (!active) return;
      const dur = buffer.length / o.sampleRate;
      if (ignoreSec > 0) {
        ignoreSec -= dur;
        return;
      }
      const level = rmsOf(buffer);
      o.onLevel(level);
      const threshold = Math.max(o.minThreshold, noise * o.noiseMultiplier);
      const voiced = level > threshold;
      const copy = new Float32Array(buffer); // o navegador reaproveita o buffer original

      if (!speaking) {
        if (!voiced) noise = Math.min(0.03, noise * 0.97 + level * 0.03);
        preRoll.push(copy);
        preRollSec += dur;
        while (preRoll.length > 1 && preRollSec - preRoll[0].length / o.sampleRate >= o.preRollSec) {
          preRollSec -= preRoll[0].length / o.sampleRate;
          preRoll.shift();
        }
        voicedRun = voiced ? voicedRun + 1 : 0;
        if (voicedRun >= o.startFrames) {
          speaking = true;
          chunks = preRoll;
          totalSec = preRollSec;
          voicedSec = voicedRun * dur;
          silenceSec = 0;
          preRoll = [];
          preRollSec = 0;
          o.onSpeechStart();
        }
        return;
      }

      chunks.push(copy);
      totalSec += dur;
      if (voiced) {
        silenceSec = 0;
        voicedSec += dur;
      } else {
        silenceSec += dur;
      }
      if (silenceSec >= o.endSilenceSec || totalSec >= o.maxSec) finish();
    }

    return {
      push: push,
      // Pausa a escuta (enquanto a Luna pensa ou fala) e descarta qualquer fala em andamento.
      pause: function () { active = false; reset(); },
      // Retoma a escuta; cooldownSec ignora o começo para não captar o final da voz da Luna.
      resume: function (cooldownSec) { reset(); ignoreSec = cooldownSec || 0; active = true; },
      isSpeaking: function () { return speaking; },
      noiseFloor: function () { return noise; }
    };
  }

  function downsample(samples, inRate, outRate) {
    if (outRate >= inRate) return samples;
    const ratio = inRate / outRate;
    const outLength = Math.floor(samples.length / ratio);
    const out = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let j = start; j < end; j++) { sum += samples[j]; count++; }
      out[i] = count ? sum / count : 0;
    }
    return out;
  }

  function encodeWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    function text(offset, value) {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    }
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);            // PCM
    view.setUint16(22, 1, true);            // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const clipped = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
    }
    return buffer;
  }

  function encodeWav16k(samples, inRate) {
    const outRate = Math.min(16000, inRate);
    return encodeWav(downsample(samples, inRate, outRate), outRate);
  }

  // O modelo às vezes usa espaços "que não quebram" entre grupos de dígitos (1 200 600), e o texto
  // passa do balão. Trocamos por espaço comum para a linha poder quebrar.
  function normalizeNumbers(value) {
    return String(value).replace(/(\d)[\u00A0\u202F\u2007](?=\d)/g, '$1 ');
  }

  // Versão simples do texto para o sintetizador do navegador (reserva quando o Edge TTS falha).
  function plainForSpeech(value) {
    return String(value)
      .replace(/```[\s\S]*?```/g, ' trecho de código omitido ')
      .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[*#`_~>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const api = {
    createVad: createVad,
    encodeWav16k: encodeWav16k,
    downsample: downsample,
    rmsOf: rmsOf,
    text: { normalizeNumbers: normalizeNumbers, plainForSpeech: plainForSpeech }
  };
  root.LunaVoiceCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
