document.addEventListener('DOMContentLoaded', () => {
  const userInput = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const chatContainer = document.getElementById('chat-container');
  const fileInput = document.getElementById('file-input');
  const attachBtn = document.getElementById('attach-btn');
  const micBtn = document.getElementById('mic-btn');
  const realtimeBtn = document.getElementById('realtime-btn');
  const previewContainer = document.getElementById('file-preview-container');
  const previewFilename = document.getElementById('preview-filename');
  const removeFileBtn = document.getElementById('remove-file-btn');
  const audioWave = document.getElementById('audio-wave');
  const memoriesBtn = document.getElementById('memories-btn');
  const memoriesModal = document.getElementById('memories-modal');
  const memoriesList = document.getElementById('memories-list');
  const memoriesSearch = document.getElementById('memories-search');
  const memoriesCount = document.getElementById('memories-count');
  const memoriesAddBtn = document.getElementById('memories-add-btn');
  const memoriesForm = document.getElementById('memories-form');
  const memoryCategory = document.getElementById('memory-category');
  const memoryText = document.getElementById('memory-text');
  const memorySave = document.getElementById('memory-save');
  const memoryCancel = document.getElementById('memory-cancel');
  const voiceOverlay = document.getElementById('voice-overlay');
  const voiceOrb = document.getElementById('voice-orb');
  const voiceStatus = document.getElementById('voice-status');
  const voiceUser = document.getElementById('voice-user');
  const voiceCaption = document.getElementById('voice-caption');
  const voiceMute = document.getElementById('voice-mute');
  const voiceEnd = document.getElementById('voice-end');

  const VoiceCore = window.LunaVoiceCore;
  const normalizeNumbers = VoiceCore ? VoiceCore.text.normalizeNumbers : (value) => String(value);
  const plainForSpeech = VoiceCore ? VoiceCore.text.plainForSpeech : (value) => String(value);

  async function fetchWithAuth(url, options = {}) {
    const user = await window.lunaAuthReady;
    if (!user) throw new Error('Entre novamente para continuar.');
    const headers = { ...(options.headers || {}), 'Authorization': `Bearer ${await user.getIdToken()}` };
    return fetch(url, { ...options, headers });
  }

  async function readApiResponse(response) {
    const body = await response.text();
    let data;
    try {
      data = body ? JSON.parse(body) : {};
    } catch {
      const plainMessage = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
      const detail = plainMessage ? `: ${plainMessage}` : '';
      throw new Error(`O servidor respondeu sem JSON (HTTP ${response.status})${detail}`);
    }
    if (!response.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : 'Dados inválidos.';
      throw new Error(detail || `Erro no servidor (HTTP ${response.status}).`);
    }
    return data;
  }

  function scrollChatToBottom() {
    if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  // ---------------------------------------------------------------- Markdown

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function decorateMarkdown(root) {
    root.querySelectorAll('a').forEach(link => {
      try {
        const url = new URL(link.getAttribute('href'), window.location.origin);
        if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) link.removeAttribute('href');
        link.setAttribute('rel', 'noopener noreferrer');
        link.setAttribute('target', '_blank');
      } catch (_) { link.removeAttribute('href'); }
    });
    root.querySelectorAll('img').forEach(image => image.remove());
    root.querySelectorAll('table').forEach(table => {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
    root.querySelectorAll('pre').forEach(pre => {
      const block = document.createElement('div');
      block.className = 'code-block';
      pre.parentNode.insertBefore(block, pre);
      block.appendChild(pre);
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'code-copy';
      copy.textContent = 'Copiar';
      copy.setAttribute('aria-label', 'Copiar código');
      copy.onclick = async () => {
        const code = (pre.querySelector('code') || pre).textContent;
        try {
          await navigator.clipboard.writeText(code);
          copy.textContent = 'Copiado!';
        } catch (_) { copy.textContent = 'Não copiou'; }
        setTimeout(() => { copy.textContent = 'Copiar'; }, 1600);
      };
      block.appendChild(copy);
    });
  }

  // Markdown completo (listas, tabelas, citações, código) passando sempre por sanitização.
  // Sem o DOMPurify, cai para o caminho antigo: escapa o HTML antes do Markdown.
  function renderMarkdownInto(element, text) {
    const source = normalizeNumbers(text);
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      try {
        const html = marked.parse(source, { gfm: true, breaks: true });
        element.innerHTML = DOMPurify.sanitize(html, {
          USE_PROFILES: { html: true },
          FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'button', 'select', 'iframe', 'img', 'svg', 'math'],
          FORBID_ATTR: ['style']
        });
        decorateMarkdown(element);
        return;
      } catch (error) { console.warn('[Luna] Markdown completo falhou, usando modo seguro:', error); }
    }
    if (typeof marked !== 'undefined') {
      element.innerHTML = marked.parse(escapeHtml(source));
      decorateMarkdown(element);
      return;
    }
    element.textContent = source;
  }

  // ---------------------------------------------------------------- Memórias

  let memoriesData = [];
  let editingMemoryKey = null;
  const MEMORY_CATEGORIES = ['preferência', 'interesse', 'projeto', 'objetivo'];

  function categorySelect(selected) {
    const select = document.createElement('select');
    select.className = 'memory-select';
    MEMORY_CATEGORIES.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      if (name === selected) option.selected = true;
      select.appendChild(option);
    });
    return select;
  }

  async function sendMemory(url, method, payload) {
    const response = await fetchWithAuth(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return readApiResponse(response);
  }

  function buildMemoryRow(memory) {
    const row = document.createElement('article');
    row.className = 'memory-item';
    const body = document.createElement('div');
    body.className = 'memory-body';
    const actions = document.createElement('div');
    actions.className = 'memory-actions';

    if (editingMemoryKey === memory.chave) {
      const select = categorySelect(memory.categoria);
      const area = document.createElement('textarea');
      area.className = 'memory-edit-text';
      area.rows = 3;
      area.maxLength = 400;
      area.value = memory.conteudo;
      body.append(select, area);
      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = 'Salvar';
      save.className = 'primary';
      save.onclick = async () => {
        const value = area.value.trim();
        if (!value) return;
        save.disabled = true;
        try {
          await sendMemory(`/api/memories/${encodeURIComponent(memory.chave)}`, 'PUT', { categoria: select.value, conteudo: value });
          editingMemoryKey = null;
          await loadMemories();
        } catch (error) { save.disabled = false; alert(error.message); }
      };
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancelar';
      cancel.onclick = () => { editingMemoryKey = null; renderMemories(); };
      actions.append(save, cancel);
    } else {
      const category = document.createElement('small');
      category.textContent = memory.categoria;
      const content = document.createElement('p');
      content.textContent = memory.conteudo;
      body.append(category, content);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Editar';
      edit.setAttribute('aria-label', `Editar memória: ${memory.conteudo}`);
      edit.onclick = () => { editingMemoryKey = memory.chave; renderMemories(); };
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Apagar';
      remove.setAttribute('aria-label', `Apagar memória: ${memory.conteudo}`);
      remove.onclick = async () => {
        if (!confirm('Apagar esta memória?')) return;
        try {
          const deleted = await fetchWithAuth(`/api/memories/${encodeURIComponent(memory.chave)}`, { method: 'DELETE' });
          if (!deleted.ok) throw new Error('Não foi possível apagar esta memória.');
          await loadMemories();
        } catch (error) { alert(error.message); }
      };
      actions.append(edit, remove);
    }
    row.append(body, actions);
    return row;
  }

  function renderMemories() {
    if (!memoriesList) return;
    const term = (memoriesSearch ? memoriesSearch.value : '').trim().toLowerCase();
    const items = memoriesData.filter(memory => !term
      || memory.conteudo.toLowerCase().includes(term)
      || memory.categoria.toLowerCase().includes(term));
    if (memoriesCount) {
      memoriesCount.textContent = !memoriesData.length ? ''
        : term ? `${items.length} de ${memoriesData.length} memórias`
          : `${memoriesData.length} ${memoriesData.length === 1 ? 'memória' : 'memórias'}`;
    }
    memoriesList.replaceChildren();
    if (!memoriesData.length || !items.length) {
      const empty = document.createElement('p');
      empty.className = 'memories-empty';
      empty.textContent = !memoriesData.length
        ? 'Ainda não há memórias salvas. Quando você mencionar uma preferência ou projeto importante, a Luna pode guardar um resumo, ou você pode criar uma em “Nova”.'
        : 'Nenhuma memória encontrada para essa busca.';
      memoriesList.appendChild(empty);
      return;
    }
    items.forEach(memory => memoriesList.appendChild(buildMemoryRow(memory)));
  }

  async function loadMemories() {
    if (!memoriesList) return;
    memoriesList.textContent = 'Carregando…';
    try {
      const response = await fetchWithAuth('/api/memories');
      const data = await readApiResponse(response);
      memoriesData = data.memories || [];
      renderMemories();
    } catch (error) { memoriesList.textContent = error.message; }
  }

  function toggleMemoryForm(show) {
    if (!memoriesForm) return;
    memoriesForm.classList.toggle('hidden', !show);
    if (show && memoryText) { memoryText.value = ''; memoryText.focus(); }
  }

  function openMemories() {
    if (!memoriesModal) return;
    memoriesModal.classList.remove('hidden');
    memoriesModal.style.display = 'grid';
    editingMemoryKey = null;
    toggleMemoryForm(false);
    if (memoriesSearch) memoriesSearch.value = '';
    loadMemories();
  }
  function closeMemories() {
    if (!memoriesModal) return;
    memoriesModal.classList.add('hidden');
    memoriesModal.style.display = 'none';
  }
  if (memoriesBtn) memoriesBtn.addEventListener('click', openMemories);
  document.getElementById('memories-close')?.addEventListener('click', closeMemories);
  memoriesModal?.addEventListener('click', event => { if (event.target === memoriesModal) closeMemories(); });
  memoriesSearch?.addEventListener('input', renderMemories);
  memoriesAddBtn?.addEventListener('click', () => toggleMemoryForm(memoriesForm.classList.contains('hidden')));
  memoryCancel?.addEventListener('click', () => toggleMemoryForm(false));
  memorySave?.addEventListener('click', async () => {
    const value = memoryText.value.trim();
    if (!value) { memoryText.focus(); return; }
    memorySave.disabled = true;
    try {
      await sendMemory('/api/memories', 'POST', { categoria: memoryCategory.value, conteudo: value });
      toggleMemoryForm(false);
      await loadMemories();
    } catch (error) { alert(error.message); }
    memorySave.disabled = false;
  });

  // ---------------------------------------------------------------- Estado do chat

  let selectedFile = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let currentAudio = null;
  let currentAudioControl = null;
  let playbackRequestId = 0;

  // Variável para guardar o balão que está a ser editado
  let editingBubble = null;

  let audioCtx = null;
  let analyser = null;
  let animFrameId = null;

  function stopCurrentAudio() {
    const audio = currentAudio;
    const controls = currentAudioControl;
    playbackRequestId += 1;
    currentAudio = null;
    currentAudioControl = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.currentTime = 0;
      if (audio.dataset.blobUrl) URL.revokeObjectURL(audio.dataset.blobUrl);
      delete audio.dataset.blobUrl;
      audio.removeAttribute('src');
      audio.load();
    }
    if (controls) {
      controls.playButton.disabled = false;
      controls.playButton.textContent = '🔊 Ler em voz alta';
      controls.stopButton.disabled = true;
    }
  }

  if (userInput) {
    userInput.addEventListener('input', () => {
      userInput.style.height = 'auto';
      userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';
    });

    userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        triggerSend();
      }
    });
  }

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        selectedFile = e.target.files[0];
        if (previewFilename) previewFilename.textContent = `📎 ${selectedFile.name}`;
        if (previewContainer) previewContainer.classList.remove('hidden');
      }
    });
  }

  if (removeFileBtn) {
    removeFileBtn.addEventListener('click', () => {
      selectedFile = null;
      if (fileInput) fileInput.value = '';
      if (previewContainer) previewContainer.classList.add('hidden');
    });
  }

  // ---------------------------------------------------------------- Conversa por voz em tempo real
  //
  // A voz é captada com o microfone aberto durante toda a sessão. Um detector de fala (voice-core.js)
  // entrega UMA fala por vez, já cortada no silêncio; ela vai para /api/voice (Whisper), a Luna responde
  // em modo falado e o áudio da resposta toca na hora. Enquanto a Luna pensa ou fala, a escuta fica
  // pausada, o que evita eco e mensagens duplicadas.

  const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  const VOICE_STATUS = {
    listening: 'Ouvindo…',
    hearing: 'Ouvindo você…',
    thinking: 'Pensando…',
    speaking: 'Falando…',
    muted: 'Microfone desativado',
    error: 'Algo deu errado'
  };
  const voice = {
    active: false,
    state: 'idle',
    muted: false,
    turnId: 0,
    stream: null,
    ctx: null,
    source: null,
    processor: null,
    sink: null,
    vad: null,
    audioEl: null,
    abort: null,
    playResolve: null,
    wake: null
  };

  function setVoiceState(state, text) {
    voice.state = state;
    if (voiceOverlay) voiceOverlay.dataset.state = state;
    if (voiceStatus) voiceStatus.textContent = text || VOICE_STATUS[state] || '';
  }

  function listenAgain(cooldownSec = 0.4) {
    if (!voice.active || !voice.vad) return;
    if (voice.ctx && voice.ctx.state === 'suspended') voice.ctx.resume().catch(() => {});
    if (voice.muted) {
      voice.vad.pause();
      setVoiceState('muted');
      return;
    }
    voice.vad.resume(cooldownSec);
    setVoiceState('listening');
    if (voiceOverlay) voiceOverlay.style.setProperty('--level', '0');
  }

  function stopVoicePlayback() {
    if (voice.audioEl) {
      try { voice.audioEl.pause(); } catch (_) {}
    }
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
    const resolve = voice.playResolve;
    voice.playResolve = null;
    if (resolve) resolve();
  }

  async function playVoiceAudio(url, turn) {
    const response = await fetchWithAuth(url);
    if (!response.ok) throw new Error('Não foi possível carregar o áudio da resposta.');
    const objectUrl = URL.createObjectURL(await response.blob());
    if (turn !== voice.turnId || !voice.active) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    const element = voice.audioEl;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        element.onended = null;
        element.onerror = null;
        voice.playResolve = null;
        URL.revokeObjectURL(objectUrl);
      };
      voice.playResolve = () => { cleanup(); resolve(); };
      element.onended = () => { cleanup(); resolve(); };
      element.onerror = () => { cleanup(); reject(new Error('Falha ao tocar o áudio.')); };
      element.src = objectUrl;
      element.play().catch(error => { cleanup(); reject(error); });
    });
  }

  function speakWithBrowser(text) {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window)) { resolve(); return; }
      const utterance = new SpeechSynthesisUtterance(plainForSpeech(text));
      utterance.lang = 'pt-BR';
      utterance.onend = () => { voice.playResolve = null; resolve(); };
      utterance.onerror = () => { voice.playResolve = null; resolve(); };
      voice.playResolve = resolve;
      window.speechSynthesis.speak(utterance);
    });
  }

  async function speakReply(data, turn) {
    setVoiceState('speaking');
    let played = false;
    if (data.audio_url) {
      try {
        await playVoiceAudio(data.audio_url, turn);
        played = true;
      } catch (error) { console.warn('[Luna voz] Áudio indisponível, usando a voz do navegador:', error); }
    }
    if (!played && turn === voice.turnId && voice.active) await speakWithBrowser(data.response);
    if (turn === voice.turnId && voice.active) listenAgain(0.4);
  }

  async function handleUtterance(samples, sampleRate) {
    if (!voice.active) return;
    voice.vad.pause();
    const turn = ++voice.turnId;
    setVoiceState('thinking');
    if (voiceCaption) voiceCaption.textContent = '';
    const form = new FormData();
    form.append('file', new File([VoiceCore.encodeWav16k(samples, sampleRate)], 'voz.wav', { type: 'audio/wav' }));
    voice.abort = new AbortController();
    try {
      const response = await fetchWithAuth('/api/voice', { method: 'POST', body: form, signal: voice.abort.signal });
      const data = await readApiResponse(response);
      if (turn !== voice.turnId || !voice.active) return;
      if (data.ignored || !data.response) { listenAgain(0.2); return; }
      document.getElementById('welcome-screen')?.remove();
      appendBubble(data.user_transcription, 'user');
      appendBubble(data.response, 'bot', data.audio_url);
      if (voiceUser) voiceUser.textContent = data.user_transcription;
      if (voiceCaption) voiceCaption.textContent = plainForSpeech(data.response);
      await speakReply(data, turn);
    } catch (error) {
      if (error.name === 'AbortError' || turn !== voice.turnId || !voice.active) return;
      console.error('[Luna voz]', error);
      setVoiceState('error', error.message);
      setTimeout(() => { if (voice.active && turn === voice.turnId) listenAgain(0.2); }, 3500);
    }
  }

  function cancelVoiceTurn() {
    voice.turnId += 1;
    if (voice.abort) voice.abort.abort();
    voice.abort = null;
  }

  function toggleVoiceMute() {
    voice.muted = !voice.muted;
    if (voiceMute) {
      voiceMute.classList.toggle('on', voice.muted);
      voiceMute.setAttribute('aria-pressed', String(voice.muted));
    }
    if (voice.state === 'listening' || voice.state === 'hearing' || voice.state === 'muted') listenAgain(0);
  }

  async function holdScreenAwake() {
    try {
      if ('wakeLock' in navigator) voice.wake = await navigator.wakeLock.request('screen');
    } catch (_) { /* opcional */ }
  }

  async function startVoice() {
    if (voice.active) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !VoiceCore) {
      alert('Este navegador não permite conversa por voz.');
      return;
    }
    // Tudo que precisa de "gesto do usuário" é criado antes de qualquer await.
    stopCurrentAudio();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    voice.ctx = new Ctx();
    voice.audioEl = new Audio();
    voice.audioEl.src = SILENT_WAV;
    voice.audioEl.play().catch(() => {});
    try {
      voice.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      if (voice.ctx.state === 'suspended') await voice.ctx.resume();
    } catch (error) {
      console.error(error);
      try { voice.ctx.close(); } catch (_) {}
      voice.ctx = null;
      alert('Permissão de microfone negada ou indisponível.');
      return;
    }
    voice.source = voice.ctx.createMediaStreamSource(voice.stream);
    voice.processor = voice.ctx.createScriptProcessor(2048, 1, 1);
    voice.vad = VoiceCore.createVad({
      sampleRate: voice.ctx.sampleRate,
      onLevel: (level) => {
        if (voice.state === 'listening' || voice.state === 'hearing') {
          voiceOverlay.style.setProperty('--level', Math.min(1, level * 9).toFixed(2));
        }
      },
      onSpeechStart: () => { if (voice.state === 'listening') setVoiceState('hearing'); },
      onUtterance: handleUtterance
    });
    voice.processor.onaudioprocess = (event) => voice.vad.push(event.inputBuffer.getChannelData(0));
    voice.sink = voice.ctx.createGain();
    voice.sink.gain.value = 0; // o processador só roda se estiver ligado à saída; sem som
    voice.source.connect(voice.processor);
    voice.processor.connect(voice.sink);
    voice.sink.connect(voice.ctx.destination);

    voice.active = true;
    voice.muted = false;
    voiceMute?.classList.remove('on');
    voiceMute?.setAttribute('aria-pressed', 'false');
    if (voiceUser) voiceUser.textContent = '';
    if (voiceCaption) voiceCaption.textContent = 'Pode falar. Toque na esfera para interromper a Luna.';
    voiceOverlay.classList.remove('hidden');
    holdScreenAwake();
    listenAgain(0);
  }

  function stopVoice() {
    if (!voice.active) return;
    voice.active = false;
    cancelVoiceTurn();
    stopVoicePlayback();
    try { voice.processor.onaudioprocess = null; voice.processor.disconnect(); } catch (_) {}
    try { voice.source.disconnect(); } catch (_) {}
    try { voice.sink.disconnect(); } catch (_) {}
    if (voice.stream) voice.stream.getTracks().forEach(track => track.stop());
    if (voice.ctx) { try { voice.ctx.close(); } catch (_) {} }
    if (voice.wake) { try { voice.wake.release(); } catch (_) {} }
    if (voice.audioEl) { voice.audioEl.removeAttribute('src'); }
    Object.assign(voice, { stream: null, ctx: null, source: null, processor: null, sink: null, vad: null, audioEl: null, wake: null });
    setVoiceState('idle', '');
    voiceOverlay.classList.add('hidden');
  }

  if (realtimeBtn) {
    realtimeBtn.setAttribute('title', 'Conversa por voz em tempo real');
    realtimeBtn.addEventListener('click', startVoice);
  }
  voiceEnd?.addEventListener('click', stopVoice);
  voiceMute?.addEventListener('click', toggleVoiceMute);
  voiceOrb?.addEventListener('click', () => {
    if (!voice.active) return;
    if (voice.state === 'speaking') stopVoicePlayback();           // a resposta segue para "ouvindo"
    else if (voice.state === 'thinking') { cancelVoiceTurn(); listenAgain(0.2); }
    else if (voice.state === 'error') listenAgain(0.2);
    else if (voice.muted) toggleVoiceMute();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (voice.active) stopVoice();
    else closeMemories();
  });
  document.addEventListener('visibilitychange', () => {
    if (voice.active && document.visibilityState === 'visible') holdScreenAwake();
  });
  window.addEventListener('pagehide', stopVoice);

  // ---------------------------------------------------------------- Gravação de áudio (anexo)

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 32;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const mime = mediaRecorder.mimeType || audioChunks[0]?.type || 'audio/webm';
        const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
        const audioBlob = new Blob(audioChunks, { type: mime });
        selectedFile = new File([audioBlob], `gravacao_voz.${extension}`, { type: mime });

        cancelAnimationFrame(animFrameId);
        if (audioCtx) audioCtx.close();
        stream.getTracks().forEach(track => track.stop());

        if (audioWave) audioWave.classList.add('hidden');
        if (userInput) userInput.style.display = 'block';

        if (previewFilename) previewFilename.textContent = `🎙️ Áudio gravado (pronto para enviar)`;
        if (previewContainer) previewContainer.classList.remove('hidden');
      };

      mediaRecorder.start();
      isRecording = true;
      if (micBtn) micBtn.classList.add('recording');

      if (userInput) userInput.style.display = 'none';
      if (audioWave) audioWave.classList.remove('hidden');

      const bars = document.querySelectorAll('.audio-wave .bar');
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      function animateWave() {
        analyser.getByteFrequencyData(dataArray);
        let volume = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

        bars.forEach((bar, idx) => {
          let height = Math.max(6, Math.min(28, (volume * (idx + 1) * 0.4)));
          bar.style.height = `${height}px`;
        });

        animFrameId = requestAnimationFrame(animateWave);
      }
      animateWave();

    } catch (err) {
      alert('Permissão de microfone negada ou indisponível.');
      console.error(err);
    }
  }

  function stopRecording() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      isRecording = false;
      if (micBtn) micBtn.classList.remove('recording');
    }
  }

  if (micBtn) {
    micBtn.addEventListener('click', () => {
      if (!isRecording) {
        startRecording();
      } else {
        stopRecording();
      }
    });
  }

  // ---------------------------------------------------------------- Envio de mensagens

  async function triggerSend() {
    if (isRecording) stopRecording();

    const text = userInput ? userInput.value.trim() : '';
    const currentFile = selectedFile;

    if (!text && !currentFile) return;

    const welcomeScreen = document.getElementById('welcome-screen');
    if (welcomeScreen) welcomeScreen.remove();

    let bubbleObj = null;

    // Se estiver a editar um balão existente
    if (editingBubble) {
      bubbleObj = editingBubble;
      if (bubbleObj.textSpan) {
        bubbleObj.textSpan.textContent = text;
      }
      editingBubble = null; // Limpa o estado de edição
    } else {
      // Caso contrário, cria um balão novo
      bubbleObj = appendBubble(text, 'user', null, text, currentFile);
    }

    const formData = new FormData();
    formData.append('prompt', text);
    if (currentFile) formData.append('file', currentFile);

    if (userInput) {
      userInput.value = '';
      userInput.style.height = 'auto';
    }
    selectedFile = null;
    if (fileInput) fileInput.value = '';
    if (previewContainer) previewContainer.classList.add('hidden');

    try {
      const response = await fetchWithAuth('/api/chat', {
        method: 'POST',
        body: formData
      });

      const data = await readApiResponse(response);

      if (currentFile && currentFile.type.startsWith('audio/') && data.user_transcription) {
        if (bubbleObj && bubbleObj.textSpan) {
          bubbleObj.textSpan.textContent = `🎙️ ${data.user_transcription}`;
        }
      }

      appendBubble(data.response, 'bot', data.audio_url);

    } catch (error) {
      appendBubble(`⚠️ Erro: ${error.message}`, 'bot');
    }
  }

  if (sendBtn) sendBtn.addEventListener('click', triggerSend);

  // ---------------------------------------------------------------- Balões

  function appendBubble(text, sender, audioUrl = null, rawText = "", fileAttachment = null) {
    if (!chatContainer) return;
    const bubble = document.createElement('div');
    bubble.classList.add('chat-bubble', sender);

    let textSpan = null;

    if (sender === 'bot') {
      renderMarkdownInto(bubble, text);

      // O servidor limpa Markdown, links e emojis antes de sintetizar; mandamos o texto original.
      const readableText = String(text).trim();
      {
        const audioControls = document.createElement('div');
        audioControls.className = 'audio-controls';
        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'audio-play-btn';
        playBtn.textContent = '🔊 Ler em voz alta';
        playBtn.setAttribute('aria-label', 'Ler resposta em voz alta');
        const stopBtn = document.createElement('button');
        stopBtn.type = 'button';
        stopBtn.className = 'audio-stop-btn';
        stopBtn.textContent = '⏹ Parar';
        stopBtn.disabled = true;
        let audio = null;

        const resetControls = () => {
          playBtn.textContent = '🔊 Ler em voz alta';
          stopBtn.disabled = true;
        };

        const configurarAudio = (url) => {
          const player = new Audio();
          player.dataset.authUrl = url;
          player.preload = 'none';
          player.loop = false;
          player.onended = () => { if (currentAudio === player) stopCurrentAudio(); };
          player.onerror = () => {
            if (currentAudio !== player) return;
            stopCurrentAudio();
            playBtn.textContent = '⚠️ Falha ao carregar o áudio';
          };
          return player;
        };

        if (audioUrl) audio = configurarAudio(audioUrl);

        playBtn.onclick = async () => {
          if (voice.active) return;
          if (currentAudio && currentAudio !== audio) {
            stopCurrentAudio();
          } else if (!currentAudio && currentAudioControl && currentAudioControl.playButton !== playBtn) {
            stopCurrentAudio();
          }
          currentAudioControl = { playButton: playBtn, stopButton: stopBtn };
          if (audio && !currentAudio) currentAudio = audio;

          if (!audio) {
            const requestId = ++playbackRequestId;
            playBtn.textContent = 'Gerando voz…';
            playBtn.disabled = true;
            stopBtn.disabled = false;
            try {
              const response = await fetchWithAuth('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: readableText })
              });
              const data = await response.json();
              if (!response.ok || !data.audio_url) throw new Error(data.detail || 'O Edge TTS não gerou o áudio.');
              if (requestId !== playbackRequestId) return;
              audio = configurarAudio(data.audio_url);
              currentAudio = audio;
            } catch (error) {
              if (requestId !== playbackRequestId) return;
              console.error('[Luna Edge TTS]', error);
              currentAudio = null;
              currentAudioControl = null;
              playBtn.disabled = false;
              playBtn.textContent = '⚠️ Edge TTS indisponível';
              return;
            }
          }

          if (audio.paused) {
            try {
              const player = audio;
              if (!player.src && player.dataset.authUrl) {
                const response = await fetchWithAuth(player.dataset.authUrl);
                if (!response.ok) throw new Error('Não foi possível carregar o áudio protegido.');
                const objectUrl = URL.createObjectURL(await response.blob());
                player.dataset.blobUrl = objectUrl;
                player.src = objectUrl;
              }
              await audio.play();
              if (currentAudio !== player) return;
              playBtn.disabled = false;
              playBtn.textContent = '⏸ Pausar';
              stopBtn.disabled = false;
            } catch (error) {
              console.error('[Luna Edge TTS]', error);
              stopCurrentAudio();
              playBtn.textContent = '⚠️ Não foi possível reproduzir';
            }
          } else {
            audio.pause();
            playBtn.textContent = '▶ Continuar';
          }
        };

        stopBtn.onclick = () => {
          if (currentAudio === audio && audio) stopCurrentAudio();
          else if (!currentAudio && currentAudioControl?.playButton === playBtn) stopCurrentAudio();
          else {
            if (audio) {
              audio.pause();
              audio.currentTime = 0;
            }
            resetControls();
          }
        };

        audioControls.append(playBtn, stopBtn);
        bubble.appendChild(audioControls);
      }
    } else if (sender === 'user') {
      if (fileAttachment) {
        const isImage = fileAttachment.type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileAttachment.name);
        const isAudio = fileAttachment.name === "gravacao_voz.wav" || fileAttachment.type.startsWith('audio/');

        if (isImage) {
          const imgContainer = document.createElement('div');
          imgContainer.className = 'user-image-preview';
          const img = document.createElement('img');
          img.src = URL.createObjectURL(fileAttachment);
          imgContainer.appendChild(img);
          bubble.appendChild(imgContainer);
        } else if (isAudio) {
          const audioBadge = document.createElement('div');
          audioBadge.className = 'user-audio-badge';
          audioBadge.textContent = '🎙️ Transcrevendo áudio...';
          bubble.appendChild(audioBadge);
          textSpan = audioBadge;
        } else {
          const fileBadge = document.createElement('div');
          fileBadge.className = 'user-file-badge';
          fileBadge.textContent = `📎 ${fileAttachment.name}`;
          bubble.appendChild(fileBadge);
        }
      }

      if (text && (!fileAttachment || fileAttachment.name !== "gravacao_voz.wav")) {
        textSpan = document.createElement('span');
        textSpan.textContent = text;
        bubble.appendChild(textSpan);
      }

      // Botão de Editar Mensagem do Usuário
      const editBtn = document.createElement('button');
      editBtn.className = 'edit-msg-btn';
      editBtn.title = 'Editar mensagem';
      editBtn.innerHTML = '✏️';

      const currentBubbleObj = { bubble, textSpan };

      const prepareEdit = () => {
        if (userInput) {
          userInput.value = textSpan ? textSpan.textContent : rawText;
          userInput.focus();
          userInput.style.height = 'auto';
          userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';

          // Marca este balão para ser atualizado ao enviar
          editingBubble = currentBubbleObj;
        }
      };

      editBtn.onclick = prepareEdit;
      bubble.ondblclick = prepareEdit;
      bubble.appendChild(editBtn);
    } else {
      bubble.textContent = text;
    }

    chatContainer.appendChild(bubble);
    scrollChatToBottom();

    return { bubble, textSpan };
  }
});
