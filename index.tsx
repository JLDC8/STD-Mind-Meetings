/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const App = () => {
  // Elementos comunes
  const transcriptEl = document.getElementById('transcript') as HTMLTextAreaElement;
  const micBtn = document.getElementById('mic-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('status') as HTMLParagraphElement;

  // Elementos de las pestañas
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  // Elementos de grabación de pantalla
  const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
  const videoEl = document.getElementById('screen-video') as HTMLVideoElement;
  const videoPlaceholder = document.getElementById('video-placeholder') as HTMLDivElement;

  let screenStream: MediaStream | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let recordedChunks: Blob[] = [];

  // --- Lógica de Pestañas ---
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      
      tabBtns.forEach(innerBtn => innerBtn.classList.remove('active'));
      btn.classList.add('active');
      
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === tabId) {
          content.classList.add('active');
        }
      });
    });
  });


  // --- Lógica de Grabación de Pantalla ---
  const downloadRecording = () => {
    if (recordedChunks.length === 0) return;

    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    document.body.appendChild(a);
    a.style.display = 'none';
    a.href = url;
    
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    a.download = `grabacion_${timestamp}.webm`;
    
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    recordedChunks = [];
  };

  const startRecording = async () => {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true // Capturar también el audio de la pestaña/pantalla
      });
      
      videoEl.srcObject = screenStream;
      videoEl.style.display = 'block';
      videoPlaceholder.style.display = 'none';
      recordBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
        <span>Detener Grabación</span>
      `;
      
      // Escuchar si el usuario detiene la grabación desde el control del navegador
      screenStream.getVideoTracks()[0].addEventListener('ended', stopRecording);

      // Iniciar MediaRecorder
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(screenStream, { mimeType: 'video/webm' });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = downloadRecording;
      mediaRecorder.start();

    } catch (err) {
      console.error("Error al iniciar la grabación de pantalla:", err);
      statusEl.textContent = 'No se pudo iniciar la grabación de pantalla.';
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
      videoEl.srcObject = null;
      videoEl.style.display = 'none';
      videoPlaceholder.style.display = 'block';
      recordBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
        <span>Iniciar Grabación de Pantalla</span>
      `;
    }
  };

  if (recordBtn) {
    recordBtn.addEventListener('click', () => {
      if (screenStream) {
        stopRecording();
      } else {
        startRecording();
      }
    });
  }


  // --- Lógica de Reconocimiento de Voz ---
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    statusEl.textContent = 'Lo sentimos, tu navegador no soporta la API de Reconocimiento de Voz.';
    micBtn.disabled = true;
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'es-ES';
  recognition.interimResults = true;
  recognition.continuous = true;

  let isListening = false;
  let finalTranscript = '';

  recognition.onresult = (event: any) => {
    let interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }
    // Añade un espacio después del texto final si no lo hay
    const transcriptWithSpace = finalTranscript.length > 0 && !/\s$/.test(finalTranscript) ? finalTranscript + ' ' : finalTranscript;
    transcriptEl.value = transcriptWithSpace + interimTranscript;
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

  micBtn.addEventListener('click', () => {
    if (isListening) {
      recognition.stop();
    } else {
      finalTranscript = transcriptEl.value;
      recognition.start();
    }
  });
};

// Iniciar la aplicación
App();
