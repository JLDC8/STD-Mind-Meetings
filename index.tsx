/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const App = () => {
    // --- ESTADO GLOBAL ---
    let state = {
        isRecording: false,
        isListening: false,
        activeTab: 'dictation-tab',
        reunionTitle: '',
        screenStream: null as MediaStream | null,
        screenMediaRecorder: null as MediaRecorder | null,
        recordedScreenChunks: [] as Blob[],
        // Grabación de audio separada para pantalla
        screenAudioRecorder: null as MediaRecorder | null,
        recordedScreenAudioChunks: [] as Blob[],
        // Grabación de audio para la pestaña de dictado
        dictationAudioStream: null as MediaStream | null,
        dictationAudioRecorder: null as MediaRecorder | null,
        recordedDictationAudioChunks: [] as Blob[],
        markers: [] as { time: number; text: string; note: string }[],
        transcript: [] as { speaker: string, text: string, start: number, end: number }[],
        recordingStartTime: 0,
        lastFinalTranscriptTime: 0,
        speakerCounter: 1,
        manualStop: false, // Flag para controlar el reinicio del reconocimiento
    };

    // --- ELEMENTOS DEL DOM ---
    const DOM = {
        mainUI: document.getElementById('main-ui')!,
        recordingUI: document.getElementById('recording-ui')!,
        appContainer: document.getElementById('app-container')!,
        reunionTitleInput: document.getElementById('reunion-title') as HTMLInputElement,
        micBtn: document.getElementById('mic-btn') as HTMLButtonElement,
        statusEl: document.getElementById('status') as HTMLParagraphElement,
        startRecordBtn: document.getElementById('start-record-btn') as HTMLButtonElement,
        stopRecordBtn: document.getElementById('stop-record-btn') as HTMLButtonElement,
        liveVideoPreview: document.getElementById('live-video-preview') as HTMLVideoElement,
        recordingTitle: document.getElementById('recording-title')!,
        liveTranscriptDisplay: document.getElementById('live-transcript-display')!,
        liveNotes: document.getElementById('live-notes') as HTMLTextAreaElement,
        transcriptTextarea: document.getElementById('transcript-textarea') as HTMLTextAreaElement,
        markerTooltip: document.getElementById('marker-tooltip') as HTMLDivElement,
        addMarkerBtn: document.getElementById('add-marker-btn') as HTMLButtonElement,
        // Pestaña de revisión
        videoUpload: document.getElementById('video-upload') as HTMLInputElement,
        audioUpload: document.getElementById('audio-upload') as HTMLInputElement,
        jsonUpload: document.getElementById('json-upload') as HTMLInputElement,
        reviewPlayer: document.getElementById('review-player')!,
        reviewVideo: document.getElementById('review-video') as HTMLVideoElement,
        reviewVideoContainer: document.getElementById('review-video-container')!,
        reviewTranscriptContainer: document.getElementById('review-transcript-container')!,
        thumbnailContainer: document.getElementById('thumbnail-container')!,
        thumbnailPreview: document.getElementById('thumbnail-preview') as HTMLDivElement,
        thumbnailPreviewImg: document.getElementById('thumbnail-preview-img') as HTMLImageElement,
        thumbnailPreviewTime: document.getElementById('thumbnail-preview-time') as HTMLSpanElement,
    };

    // --- INICIALIZACIÓN ---
    const init = () => {
        setupTabs();
        setupEventListeners();
    };

    const setupTabs = () => {
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.getAttribute('data-tab')!;
                state.activeTab = tabId;
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(tabId)!.classList.add('active');
            });
        });
    };

    // --- LÓGICA DE RECONOCIMIENTO DE VOZ (SPEECH-TO-TEXT) ---
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert('Tu navegador no soporta la API de Reconocimiento de Voz. Funcionalidad limitada.');
        // @ts-ignore
        return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';
        const now = Date.now();

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                const transcriptText = event.results[i][0].transcript.trim();
                if(transcriptText) {
                    // Simulación de diarización: cambio de hablante tras 2s de silencio
                    if (state.lastFinalTranscriptTime > 0 && (now - state.lastFinalTranscriptTime) > 2000) {
                        state.speakerCounter++;
                    }
                    const speakerTag = `Hablante ${String.fromCharCode(64 + state.speakerCounter)}`;
                    finalTranscript += `${speakerTag}: ${transcriptText}\n`;

                    const startTime = state.lastFinalTranscriptTime > 0 ? (state.lastFinalTranscriptTime - state.recordingStartTime) / 1000 : 0;
                    state.transcript.push({
                        speaker: speakerTag,
                        text: transcriptText,
                        start: startTime,
                        end: (now - state.recordingStartTime) / 1000
                    });
                    state.lastFinalTranscriptTime = now;
                }
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        
        // Actualizar UI
        if (state.isRecording) {
            renderLiveTranscript(interimTranscript);
        } else {
            DOM.transcriptTextarea.value += finalTranscript;
            DOM.transcriptTextarea.value = DOM.transcriptTextarea.value.replace(interimTranscript, '') + interimTranscript;
        }
    };

    recognition.onstart = () => {
        state.isListening = true;
        DOM.micBtn.classList.add('listening');
        DOM.statusEl.textContent = 'Escuchando...';
    };

    recognition.onend = () => {
        state.isListening = false;
        DOM.micBtn.classList.remove('listening');
        DOM.statusEl.textContent = 'Haz clic para empezar';
        // Solo reiniciar si no fue una detención manual
        if (!state.manualStop && state.isRecording) {
             console.log('Reiniciando reconocimiento durante grabación...');
            try {
                recognition.start();
            } catch(e) {
                console.error("Error al reiniciar el reconocimiento:", e);
            }
        }
    };

    recognition.onerror = (event: any) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
            return; // Ignorar estos "errores" comunes que no son críticos.
        }
        console.error('Error de reconocimiento:', event.error);
    };

    
    // --- LÓGICA DE GRABACIÓN DE PANTALLA ---
    
    const startScreenRecording = async () => {
        state.manualStop = false;
        state.reunionTitle = DOM.reunionTitleInput.value.trim() || "Reunión Sin Título";
        DOM.recordingTitle.textContent = `Grabando: ${state.reunionTitle}`;

        try {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: { mediaSource: "screen" } as any, audio: true });
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Mezclar audios en un stream único de alta calidad
            const audioContext = new AudioContext();
            const destination = audioContext.createMediaStreamDestination();
            
            if (displayStream.getAudioTracks().length > 0) {
                 audioContext.createMediaStreamSource(displayStream).connect(destination);
            }
            if (micStream.getAudioTracks().length > 0) {
                audioContext.createMediaStreamSource(micStream).connect(destination);
            }

            const mixedAudioStream = destination.stream;
            
            // 1. Preparar grabador de VÍDEO (con audio mezclado)
            const combinedStream = new MediaStream([displayStream.getVideoTracks()[0], ...mixedAudioStream.getAudioTracks()]);
            DOM.liveVideoPreview.srcObject = combinedStream;
            state.screenStream = displayStream; // Guardar para detener las pistas
            
            state.recordedScreenChunks = [];
            state.screenMediaRecorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm' });
            state.screenMediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) state.recordedScreenChunks.push(event.data); };

            // 2. Preparar grabador de AUDIO SEPARADO
            state.recordedScreenAudioChunks = [];
            state.screenAudioRecorder = new MediaRecorder(mixedAudioStream, { mimeType: 'audio/webm' });
            state.screenAudioRecorder.ondataavailable = (event) => { if (event.data.size > 0) state.recordedScreenAudioChunks.push(event.data); };

            // Configurar el onstop principal
            state.screenMediaRecorder.onstop = () => {
                downloadAllFiles();
                resetState();
                DOM.mainUI.style.display = 'flex';
                DOM.recordingUI.style.display = 'none';
            };
            
            // Iniciar todo
            DOM.mainUI.style.display = 'none';
            DOM.recordingUI.style.display = 'flex';
            state.screenMediaRecorder.start();
            state.screenAudioRecorder.start();
            state.isRecording = true;
            state.recordingStartTime = Date.now();
            state.lastFinalTranscriptTime = state.recordingStartTime;
            recognition.start();

        } catch (err) {
            console.error("Error al iniciar grabación:", err);
            alert("No se pudo iniciar la grabación de pantalla. Asegúrate de dar los permisos necesarios.");
            resetState();
        }
    };

    const stopScreenRecording = () => {
        state.manualStop = true;
        if (state.screenMediaRecorder?.state === 'recording') state.screenMediaRecorder.stop();
        if (state.screenAudioRecorder?.state === 'recording') state.screenAudioRecorder.stop();
        if (recognition && state.isListening) recognition.stop();
        
        state.screenStream?.getTracks().forEach(track => track.stop());
    };

    const renderLiveTranscript = (interimTranscript: string) => {
        DOM.liveTranscriptDisplay.innerHTML = '';
        state.transcript.forEach(entry => {
            const p = document.createElement('p');
            p.innerHTML = `<span class="speaker">${entry.speaker}:</span> ${entry.text}`;
            DOM.liveTranscriptDisplay.appendChild(p);
        });
        if(interimTranscript) {
             const p = document.createElement('p');
             p.style.opacity = '0.6';
             p.textContent = interimTranscript;
             DOM.liveTranscriptDisplay.appendChild(p);
        }
        DOM.liveTranscriptDisplay.scrollTop = DOM.liveTranscriptDisplay.scrollHeight;
    };


    // --- LÓGICA DE GRABACIÓN DE AUDIO (SOLO) ---

    const startAudioOnlyRecording = async () => {
        try {
            state.manualStop = false;
            state.dictationAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            state.recordedDictationAudioChunks = [];
            state.dictationAudioRecorder = new MediaRecorder(state.dictationAudioStream, { mimeType: 'audio/webm' });
            state.dictationAudioRecorder.ondataavailable = (e) => { if (e.data.size > 0) state.recordedDictationAudioChunks.push(e.data); };
            state.dictationAudioRecorder.onstop = () => {
                const blob = new Blob(state.recordedDictationAudioChunks, { type: 'audio/webm' });
                downloadFile(blob, `${generateFilename()}.webm`);
                state.recordedDictationAudioChunks = [];
            };
            state.dictationAudioRecorder.start();
            recognition.start();
        } catch (err) { console.error('Error al iniciar grabación de audio:', err); }
    };
    
    const stopAudioOnlyRecording = () => {
        state.manualStop = true;
        if (state.dictationAudioRecorder?.state === 'recording') state.dictationAudioRecorder.stop();
        if (state.dictationAudioStream) state.dictationAudioStream.getTracks().forEach(track => track.stop());
        if (recognition?.state === 'listening') recognition.stop();
    };

    // --- MANEJO DE MARCADORES ---

    const handleSelection = (e: MouseEvent) => {
        const selection = window.getSelection();
        if (state.isRecording && selection && selection.toString().trim().length > 0) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            DOM.markerTooltip.style.left = `${rect.left + (rect.width / 2)}px`;
            DOM.markerTooltip.style.top = `${rect.top - 40}px`;
            DOM.markerTooltip.style.transform = 'translateX(-50%)';
            DOM.markerTooltip.style.display = 'block';
        } else {
            DOM.markerTooltip.style.display = 'none';
        }
    };
    
    const addMarker = () => {
        const selectedText = window.getSelection()?.toString().trim();
        if (!selectedText) return;
        const note = prompt('Añade una nota para este marcador:', '');
        if (note === null) return;
        
        const timestamp = (Date.now() - state.recordingStartTime);
        state.markers.push({ time: timestamp / 1000, text: selectedText, note });
        
        DOM.markerTooltip.style.display = 'none';
        window.getSelection()?.removeAllRanges();
        console.log("Marcador añadido:", state.markers[state.markers.length - 1]);
    };

    // --- PESTAÑA DE REVISIÓN DE REUNIONES ---
    const setupReviewTab = () => {
        let videoFile: File | null = null;
        let audioFile: File | null = null;
        let jsonFile: File | null = null;
        let reviewAudio: HTMLAudioElement | null = null;

        const loadAndPlay = () => {
            if (videoFile && audioFile && jsonFile) {
                // Sincronizar audio y video
                reviewAudio = new Audio(URL.createObjectURL(audioFile));
                DOM.reviewVideo.src = URL.createObjectURL(videoFile);
                DOM.reviewVideo.muted = true; // Silenciar el video para usar el audio externo

                const syncPlay = () => reviewAudio?.play();
                const syncPause = () => reviewAudio?.pause();
                const syncSeek = () => {
                    if (reviewAudio) reviewAudio.currentTime = DOM.reviewVideo.currentTime;
                };

                DOM.reviewVideo.removeEventListener('play', syncPlay);
                DOM.reviewVideo.removeEventListener('pause', syncPause);
                DOM.reviewVideo.removeEventListener('seeked', syncSeek);

                DOM.reviewVideo.addEventListener('play', syncPlay);
                DOM.reviewVideo.addEventListener('pause', syncPause);
                DOM.reviewVideo.addEventListener('seeked', syncSeek);

                DOM.reviewVideo.onloadedmetadata = () => {
                     generateThumbnails(DOM.reviewVideo);
                };

                // Cargar transcripción
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const data = JSON.parse(e.target!.result as string);
                        renderReviewTranscript(data.transcript);
                        setupReviewVideoSync(data.transcript);
                        DOM.reviewPlayer.style.display = 'grid';
                    } catch (err) {
                        alert("Error al leer el archivo JSON.");
                    }
                };
                reader.readAsText(jsonFile);
            }
        };

        DOM.videoUpload.addEventListener('change', (e) => { videoFile = (e.target as HTMLInputElement).files?.[0] || null; loadAndPlay(); });
        DOM.audioUpload.addEventListener('change', (e) => { audioFile = (e.target as HTMLInputElement).files?.[0] || null; loadAndPlay(); });
        DOM.jsonUpload.addEventListener('change', (e) => { jsonFile = (e.target as HTMLInputElement).files?.[0] || null; loadAndPlay(); });
    };
    
    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return h === '00' ? `${m}:${s}` : `${h}:${m}:${s}`;
    };

    const generateThumbnails = async (video: HTMLVideoElement) => {
        DOM.thumbnailContainer.innerHTML = '<p style="color:white; font-size:12px; padding: 5px; width: 100%; text-align: center;">Generando previsualizaciones...</p>';
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
            console.error("No se pudo obtener el contexto del canvas.");
            DOM.thumbnailContainer.innerHTML = '';
            return;
        }

        const interval = 15; // Aumentar intervalo para no generar demasiadas imágenes
        const duration = video.duration;
        let generatedThumbnailsData = [];

        // Guardar estado del vídeo
        const initialTime = video.currentTime;
        const wasMuted = video.muted;
        video.muted = true;
        
        DOM.thumbnailContainer.innerHTML = ''; // Limpiar antes de poblar

        for (let i = 0; i < duration; i += interval) {
            const dataUrl = await new Promise<string>(resolve => {
                const onSeeked = () => {
                    video.removeEventListener('seeked', onSeeked); // Limpiar listener
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
                    resolve(canvas.toDataURL('image/jpeg', 0.5));
                };
                video.addEventListener('seeked', onSeeked);
                video.currentTime = i;
            });
            generatedThumbnailsData.push({ time: i, src: dataUrl });
            
            // Crear y mostrar la miniatura en la barra
            const img = document.createElement('img');
            img.src = dataUrl;
            img.className = 'progress-thumbnail';
            DOM.thumbnailContainer.appendChild(img);
        }
        
        // Restaurar estado del vídeo
        video.currentTime = initialTime;
        video.muted = wasMuted;
        
        DOM.thumbnailContainer.dataset.thumbnails = JSON.stringify(generatedThumbnailsData);
        console.log("Previsualizaciones generadas y mostradas.");
    };
    
    const setupThumbnailHover = () => {
        DOM.reviewVideoContainer.addEventListener('mousemove', (e) => {
            const rect = DOM.reviewVideoContainer.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const progress = x / rect.width;
            const hoverTime = progress * DOM.reviewVideo.duration;
            
            if (isNaN(hoverTime)) return;

            const thumbnailsStr = DOM.thumbnailContainer.dataset.thumbnails;
            if (!thumbnailsStr) return;
            const thumbnails: { time: number; src: string }[] = JSON.parse(thumbnailsStr);

            const closestThumbnail = thumbnails.reduce((prev, curr) => {
                return (Math.abs(curr.time - hoverTime) < Math.abs(prev.time - hoverTime) ? curr : prev);
            });

            if (closestThumbnail) {
                DOM.thumbnailPreview.style.display = 'flex';
                DOM.thumbnailPreviewImg.src = closestThumbnail.src;
                DOM.thumbnailPreviewTime.textContent = formatTime(hoverTime);
                
                const previewWidth = DOM.thumbnailPreview.offsetWidth;
                const newLeft = Math.max(previewWidth / 2, Math.min(x, rect.width - previewWidth / 2));
                DOM.thumbnailPreview.style.left = `${newLeft}px`;
            }
        });

        DOM.reviewVideoContainer.addEventListener('mouseleave', () => {
            DOM.thumbnailPreview.style.display = 'none';
        });
    };

    const renderReviewTranscript = (transcript: { speaker: string, text: string, start: number }[]) => {
        DOM.reviewTranscriptContainer.innerHTML = '';
        transcript.forEach(entry => {
            const p = document.createElement('p');
            p.dataset.startTime = entry.start.toString();
            p.innerHTML = `<span class="speaker">${entry.speaker}:</span> ${entry.text}`;
            p.addEventListener('click', () => {
                DOM.reviewVideo.currentTime = entry.start;
            });
            DOM.reviewTranscriptContainer.appendChild(p);
        });
    };

    const setupReviewVideoSync = (transcript: { start: number }[]) => {
        DOM.reviewVideo.addEventListener('timeupdate', () => {
            const currentTime = DOM.reviewVideo.currentTime;
            const phrases = DOM.reviewTranscriptContainer.querySelectorAll('p[data-start-time]');
            let activePhrase: Element | null = null;
            
            phrases.forEach(p => {
                const startTime = parseFloat(p.getAttribute('data-start-time')!);
                if (currentTime >= startTime) {
                    activePhrase = p;
                }
                p.classList.remove('current-phrase');
            });

            if (activePhrase) {
                activePhrase.classList.add('current-phrase');
                activePhrase.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    };

    // --- UTILIDADES Y EVENTOS ---

    const generateFilename = () => {
        const title = (state.reunionTitle || "grabacion").replace(/\s+/g, '_');
        const date = new Date();
        const timestamp = `${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}`;
        return `${title}_${timestamp}`;
    };

    const downloadFile = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    };

    const downloadAllFiles = () => {
        const baseFilename = generateFilename();
        
        // 1. Descargar Video
        const videoBlob = new Blob(state.recordedScreenChunks, { type: 'video/webm' });
        downloadFile(videoBlob, `${baseFilename}.webm`);

        // 2. Descargar Audio
        const audioBlob = new Blob(state.recordedScreenAudioChunks, { type: 'audio/webm' });
        downloadFile(audioBlob, `${baseFilename}_audio.webm`);

        // 3. Descargar JSON (Transcripción + Marcadores)
        const jsonData = {
            title: state.reunionTitle,
            date: new Date().toISOString(),
            transcript: state.transcript,
            markers: state.markers,
        };
        const jsonBlob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
        downloadFile(jsonBlob, `${baseFilename}.json`);

        // 4. Descargar Notas
        const notes = DOM.liveNotes.value;
        if (notes.trim()) {
            const notesBlob = new Blob([notes], { type: 'text/plain;charset=utf-8' });
            downloadFile(notesBlob, `${baseFilename}_notas.txt`);
        }
    };
    
    const resetState = () => {
        state.isRecording = false;
        state.isListening = false;
        state.screenStream = null;
        state.screenMediaRecorder = null;
        state.screenAudioRecorder = null;
        state.recordedScreenChunks = [];
        state.recordedScreenAudioChunks = [];
        state.markers = [];
        state.transcript = [];
        state.recordingStartTime = 0;
        state.lastFinalTranscriptTime = 0;
        state.speakerCounter = 1;
        state.manualStop = false;
        DOM.liveTranscriptDisplay.innerHTML = '';
        DOM.liveNotes.value = '';
    };

    const setupEventListeners = () => {
        DOM.startRecordBtn.addEventListener('click', startScreenRecording);
        DOM.stopRecordBtn.addEventListener('click', stopScreenRecording);

        DOM.micBtn.addEventListener('click', () => {
            if(state.isListening) {
                stopAudioOnlyRecording();
            } else {
                DOM.transcriptTextarea.value = ''; // Limpiar para nueva transcripción de audio
                startAudioOnlyRecording();
            }
        });
        
        DOM.liveTranscriptDisplay.addEventListener('mouseup', handleSelection);
        DOM.addMarkerBtn.addEventListener('click', addMarker);
        
        document.addEventListener('mousedown', (e) => {
            if (!DOM.markerTooltip.contains(e.target as Node)) {
                DOM.markerTooltip.style.display = 'none';
            }
        });

        setupReviewTab();
        setupThumbnailHover();
    };

    // --- EJECUTAR ---
    init();
};

App();