/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const App = () => {
  // --- ELEMENTOS DEL DOM ---
  const transcriptEl = document.getElementById('transcript') as HTMLTextAreaElement;
  const micBtn = document.getElementById('mic-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('status') as HTMLParagraphElement;
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
  const videoEl = document.getElementById('screen-video') as HTMLVideoElement;
  const videoPlaceholder = document.getElementById('video-placeholder') as HTMLDivElement;
  const markerTooltip = document.getElementById('marker-tooltip') as HTMLDivElement;
  const addMarkerBtn = document.getElementById('add-marker-btn') as HTMLButtonElement;
  const markersList = document.getElementById('markers-list') as HTMLUListElement;
  const saveTranscriptBtn = document.getElementById('save-transcript-btn') as HTMLButtonElement;

  // --- ESTADO DE LA APLICACIÓN ---
  let screenStream: MediaStream | null = null;
  let screenMediaRecorder: MediaRecorder | null = null;
  let recordedScreenChunks: Blob[] = [];
  let audioStream: MediaStream | null = null;
  let audioRecorder: MediaRecorder | null = null;
  let recordedAudioChunks: Blob[] = [];
  let markers: { time: string; text: string; note: string }[] = [];
  let recordingStartTime: number | null = null;
  let isListening = false;
  let finalTranscript = '';

  // --- LÓGICA DE PESTAÑAS ---
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      tabBtns.forEach(innerBtn => innerBtn.classList.remove('active'));
      btn.classList.add('active');
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === tabId) content.classList.add('active');
      });
    });
  });

  // --- LÓGICA DE MARCADORES ---
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  const renderMarkers = () => {
    markersList.innerHTML = '';
    if (markers.length === 0) {
      markersList.innerHTML = '<li>No hay marcadores todavía. Selecciona texto en la transcripción mientras grabas para añadir uno.</li>';
      return;
    }
    markers.forEach(marker => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="marker-time">${marker.time}</span>
        <blockquote class="marker-text">${marker.text}</blockquote>
        <p class="marker-note">${marker.note}</p>
      `;
      markersList.appendChild(li);
    });
  };

  transcriptEl.addEventListener('mouseup', (e) => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0 && recordingStartTime) {
      markerTooltip.style.left = `${e.clientX}px`;
      markerTooltip.style.top = `${e.clientY - 45}px`;
      markerTooltip.style.display = 'block';
    } else {
      markerTooltip.style.display = 'none';
    }
  });
  
  document.addEventListener('mousedown', (e) => {
    if (!markerTooltip.contains(e.target as Node)) {
      markerTooltip.style.display = 'none';
    }
  });

  addMarkerBtn.addEventListener('click', () => {
    const selectedText = window.getSelection()?.toString().trim();
    if (!selectedText) return;

    const note = prompt('Añade una nota para este marcador:', '');
    if (note === null) return;

    let timestamp = 'N/A';
    if (recordingStartTime) {
      const elapsedTime = Date.now() - recordingStartTime;
      timestamp = formatTime(elapsedTime);
    }
    
    markers.push({ time: timestamp, text: selectedText, note: note });
    renderMarkers();
    markerTooltip.style.display = 'none';
    window.getSelection()?.removeAllRanges();
  });

  // --- LÓGICA DE GUARDADO ---
  const saveTranscription = () => {
    const text = transcriptEl.value;
    if (!text.trim()) {
      alert('No hay transcripción para guardar.');
      return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcripcion_${new Date().toISOString()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  saveTranscriptBtn.addEventListener('click', saveTranscription);

  // --- LÓGICA DE GRABACIÓN DE PANTALLA ---
  const downloadVideoRecording = () => {
    if (recordedScreenChunks.length === 0) return;
    const blob = new Blob(recordedScreenChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `grabacion_pantalla_${new Date().toISOString()}.webm`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    recordedScreenChunks = [];
  };

  const startRecording = async () => {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      videoEl.srcObject = screenStream;
      videoEl.style.display = 'block';
      videoPlaceholder.style.display = 'none';
      recordBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg><span>Detener Grabación</span>`;
      
      screenStream.getVideoTracks()[0].addEventListener('ended', stopRecording);
      recordedScreenChunks = [];
      screenMediaRecorder = new MediaRecorder(screenStream, { mimeType: 'video/webm' });
      screenMediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) recordedScreenChunks.push(event.data); };
      screenMediaRecorder.onstop = downloadVideoRecording;
      screenMediaRecorder.start();
      recordingStartTime = Date.now();
    } catch (err) {
      console.error("Error al iniciar la grabación de pantalla:", err);
      statusEl.textContent = 'No se pudo iniciar la grabación.';
    }
  };

  const stopRecording = () => {
    if (screenMediaRecorder && screenMediaRecorder.state === 'recording') {
      screenMediaRecorder.stop();
    }
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
    }
    videoEl.srcObject = null;
    videoEl.style.display = 'none';
    videoPlaceholder.style.display = 'block';
    recordBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg><span>Iniciar Grabación de Pantalla</span>`;
    recordingStartTime = null;
  };

  if (recordBtn) {
    recordBtn.addEventListener('click', () => {
      if (screenStream) stopRecording();
      else startRecording();
    });
  }

  // --- LÓGICA DE RECONOCIMIENTO DE VOZ Y GRABACIÓN DE AUDIO ---
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    statusEl.textContent = 'Tu navegador no soporta la API de Reconocimiento de Voz.';
    micBtn.disabled = true;
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'es-ES';
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.onresult = (event: any) => {
    let interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript + ' ';
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }
    transcriptEl.value = finalTranscript + interimTranscript;
  };

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add('listening');
    micBtn.setAttribute('aria-label', 'Detener dictado');
    statusEl.textContent = 'Escuchando...';
  };
  
  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove('listening');
    micBtn.setAttribute('aria-label', 'Iniciar dictado');
    statusEl.textContent = 'Haz clic en el micrófono para empezar';
  };

  recognition.onerror = (event: any) => {
    console.error('Error en el reconocimiento de voz:', event.error);
    statusEl.textContent = `Error: ${event.error}`;
  };

  const startAudioRecordingAndTranscription = async () => {
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedAudioChunks = [];
      audioRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
      audioRecorder.ondataavailable = (event) => { if (event.data.size > 0) recordedAudioChunks.push(event.data); };
      audioRecorder.onstop = () => {
        const blob = new Blob(recordedAudioChunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `grabacion_audio_${new Date().toISOString()}.webm`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        recordedAudioChunks = [];
      };
      audioRecorder.start();
      recognition.start();
    } catch (err) {
      console.error('Error al iniciar la grabación de audio:', err);
      statusEl.textContent = 'No se pudo acceder al micrófono.';
    }
  };

  const stopAudioRecordingAndTranscription = () => {
    if (audioRecorder && audioRecorder.state === 'recording') audioRecorder.stop();
    if (audioStream) audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
    recognition.stop();
  };

  micBtn.addEventListener('click', () => {
    const isMeetingTabActive = document.getElementById('meeting-tab')?.classList.contains('active');
    if (isListening) {
      if (isMeetingTabActive) recognition.stop();
      else stopAudioRecordingAndTranscription();
    } else {
      finalTranscript = transcriptEl.value;
      if (isMeetingTabActive) recognition.start();
      else startAudioRecordingAndTranscription();
    }
  });
  
  // --- INICIALIZACIÓN ---
  renderMarkers();
};

App();