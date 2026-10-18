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
    if (!response.ok) throw new Error(data.detail || `Erro no servidor (HTTP ${response.status}).`);
    return data;
  }

  async function loadMemories() {
    memoriesList.textContent = 'Carregando…';
    try {
      const response = await fetchWithAuth('/api/memories');
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Não foi possível carregar as memórias.');
      memoriesList.replaceChildren();
      if (!data.memories.length) {
        const empty = document.createElement('p');
        empty.textContent = 'Ainda não há memórias salvas. Quando você mencionar uma preferência ou projeto importante, a Luna pode guardar um resumo.';
        memoriesList.appendChild(empty);
        return;
      }
      data.memories.forEach(memory => {
        const row = document.createElement('article');
        row.className = 'memory-item';
        const body = document.createElement('div');
        const category = document.createElement('small');
        category.textContent = memory.categoria;
        const content = document.createElement('p');
        content.textContent = memory.conteudo;
        body.append(category, content);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Apagar';
        remove.setAttribute('aria-label', `Apagar memória: ${memory.conteudo}`);
        remove.onclick = async () => {
          try {
            const deleted = await fetchWithAuth(`/api/memories/${encodeURIComponent(memory.chave)}`, { method: 'DELETE' });
            if (!deleted.ok) throw new Error('Não foi possível apagar esta memória.');
            await loadMemories();
          } catch (error) { alert(error.message); }
        };
        row.append(body, remove);
        memoriesList.appendChild(row);
      });
    } catch (error) { memoriesList.textContent = error.message; }
  }

  function openMemories() {
    if (!memoriesModal) return;
    memoriesModal.classList.remove('hidden');
    memoriesModal.style.display = 'grid';
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
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMemories(); });

  let selectedFile = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let isRealtimeMode = false;
  let currentAudio = null;
  let currentAudioControl = null;
  let playbackRequestId = 0;
  let speechRecognition = null;
  let speechPausedForAudio = false;

  // Variável para guardar o balão que está a ser editado
  let editingBubble = null;

  let audioCtx = null;
  let analyser = null;
  let animFrameId = null;

  function pauseRealtimeForAudio() {
    if (isRealtimeMode && speechRecognition && !speechPausedForAudio) {
      speechPausedForAudio = true;
      try { speechRecognition.stop(); } catch (_) {}
    }
  }

  function resumeRealtimeAfterAudio() {
    if (speechPausedForAudio) {
      speechPausedForAudio = false;
      if (isRealtimeMode && speechRecognition) {
        try { speechRecognition.start(); } catch (_) {}
      }
    }
  }

  function stopCurrentAudio(resumeSpeech = true) {
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
    if (resumeSpeech) resumeRealtimeAfterAudio();
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

  // Alternar Modo Conversa em Tempo Real
  if (realtimeBtn) {
    realtimeBtn.addEventListener('click', async () => {
      isRealtimeMode = !isRealtimeMode;
      if (isRealtimeMode) {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) {
          isRealtimeMode = false;
          alert('Conversa por voz contínua não é suportada neste navegador. Use o botão de gravação.');
          return;
        }
        speechRecognition = new Recognition();
        speechRecognition.lang = 'pt-BR';
        speechRecognition.continuous = true;
        speechRecognition.interimResults = false;
        speechRecognition.onresult = (event) => {
          const result = event.results[event.results.length - 1];
          if (result.isFinal && result[0].transcript.trim()) {
            userInput.value = result[0].transcript.trim();
            triggerSend();
          }
        };
        speechRecognition.onerror = (event) => console.warn('Reconhecimento de voz:', event.error);
        speechRecognition.onend = () => {
          if (isRealtimeMode && !speechPausedForAudio && speechRecognition) {
            try { speechRecognition.start(); } catch (_) {}
          }
        };
        realtimeBtn.classList.add('active');
        realtimeBtn.setAttribute('title', 'Conversa em tempo real ativa');
        if (currentAudio && !currentAudio.paused) pauseRealtimeForAudio();
        else try { speechRecognition.start(); } catch (error) { console.error(error); }
      } else {
        realtimeBtn.classList.remove('active');
        realtimeBtn.setAttribute('title', 'Ativar conversa em tempo real');
        speechPausedForAudio = false;
        if (speechRecognition) speechRecognition.stop();
        speechRecognition = null;
      }
    });
  }

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
      isRealtimeMode = false;
      if (realtimeBtn) realtimeBtn.classList.remove('active');
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
        if (isRealtimeMode && speechRecognition) speechRecognition.stop();
    }
  }

  if (sendBtn) sendBtn.addEventListener('click', triggerSend);

  function appendBubble(text, sender, audioUrl = null, rawText = "", fileAttachment = null) {
    if (!chatContainer) return;
    const bubble = document.createElement('div');
    bubble.classList.add('chat-bubble', sender);

    let textSpan = null;

    if (sender === 'bot') {
      if (typeof marked !== 'undefined') {
        const safeMarkdown = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        bubble.innerHTML = marked.parse(safeMarkdown);
        bubble.querySelectorAll('a').forEach(link => {
          try {
            const url = new URL(link.getAttribute('href'), window.location.origin);
            if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) link.removeAttribute('href');
            link.setAttribute('rel', 'noopener noreferrer');
            link.setAttribute('target', '_blank');
          } catch (_) { link.removeAttribute('href'); }
        });
      } else bubble.textContent = text;

      const readableText = (bubble.innerText || bubble.textContent || text).trim();
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
          if (currentAudio && currentAudio !== audio) {
            stopCurrentAudio(false);
          } else if (!currentAudio && currentAudioControl && currentAudioControl.playButton !== playBtn) {
            stopCurrentAudio(false);
          }
          currentAudioControl = { playButton: playBtn, stopButton: stopBtn };
          if (audio && !currentAudio) currentAudio = audio;

          pauseRealtimeForAudio();
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
              resumeRealtimeAfterAudio();
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
            resumeRealtimeAfterAudio();
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
    chatContainer.scrollTop = chatContainer.scrollHeight;

    return { bubble, textSpan };
  }
});
