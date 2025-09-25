/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// --- TIPOS DE DATOS ---
type TranscriptEntry = {
    type: 'transcript';
    speaker: string;
    text: string;
    start: number;
    end: number;
    note?: string;
};
type TopicMarkerEntry = {
    type: 'topic';
    text: string;
    time: number;
};
type TranscriptItem = TranscriptEntry | TopicMarkerEntry;


const App = () => {
    // --- ESTADO GLOBAL ---
    let state = {
        isRecording: false,
        isListening: false,
        isInlineEditing: false,
        activeTab: 'dictation-tab',
        reunionTitle: '',
        screenStream: null as MediaStream | null,
        screenMediaRecorder: null as MediaRecorder | null,
        recordedScreenChunks: [] as Blob[],
        audioContext: null as AudioContext | null,
        pcmData: [] as Float32Array[],
        sampleRate: 44100,
        dictationAudioStream: null as MediaStream | null,
        dictationAudioContext: null as AudioContext | null,
        dictationPcmData: [] as Float32Array[],
        markers: [] as { time: number; text: string; note: string }[],
        transcript: [] as TranscriptItem[],
        screenshotCounter: 0,
        recordingStartTime: 0,
        lastFinalTranscriptTime: 0,
        speakerCounter: 1,
        manualStop: false,
        videoMimeType: 'video/webm' as string,
        videoExtension: 'webm' as string,
    };

    // --- ELEMENTOS DEL DOM ---
    const DOM = {
        mainUI: document.getElementById('main-ui')!,
        recordingUI: document.getElementById('recording-ui')!,
        reviewUI: document.getElementById('review-ui')!,
        reunionTitleInput: document.getElementById('reunion-title') as HTMLInputElement,
        micBtn: document.getElementById('mic-btn') as HTMLButtonElement,
        statusEl: document.getElementById('status') as HTMLParagraphElement,
        startRecordBtn: document.getElementById('start-record-btn') as HTMLButtonElement,
        videoFormatSelect: document.getElementById('video-format') as HTMLSelectElement,
        stopRecordBtn: document.getElementById('stop-record-btn') as HTMLButtonElement,
        screenshotBtn: document.getElementById('screenshot-btn') as HTMLButtonElement,
        liveVideoPreview: document.getElementById('live-video-preview') as HTMLVideoElement,
        recordingTitle: document.getElementById('recording-title')!,
        liveTranscriptDisplay: document.getElementById('live-transcript-display')!,
        liveNotes: document.getElementById('live-notes') as HTMLTextAreaElement,
        transcriptTextarea: document.getElementById('transcript-textarea') as HTMLTextAreaElement,
        // Pestaña de revisión
        reunionUploadInput: document.getElementById('reunion-upload-input') as HTMLInputElement,
        reviewTitle: document.getElementById('review-title')!,
        closeReviewBtn: document.getElementById('close-review-btn')!,
        reviewVideo: document.getElementById('review-video') as HTMLVideoElement,
        playButtonOverlay: document.getElementById('play-button-overlay')!,
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

    // --- LÓGICA DE RECONOCIMIENTO DE VOZ ---
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert('Tu navegador no soporta la API de Reconocimiento de Voz.');
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
        let newFinalEntry: TranscriptEntry | null = null;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                const transcriptText = event.results[i][0].transcript.trim();
                if(transcriptText) {
                    if (state.lastFinalTranscriptTime > 0 && (now - state.lastFinalTranscriptTime) > 2000) {
                        state.speakerCounter++;
                    }
                    const speakerTag = `Hablante ${String.fromCharCode(64 + state.speakerCounter)}`;
                    finalTranscript += `${speakerTag}: ${transcriptText}\n`;

                    let lastTranscriptEndTime = 0;
                    for (let j = state.transcript.length - 1; j >= 0; j--) {
                        const item = state.transcript[j];
                        if (item.type === 'transcript') {
                            lastTranscriptEndTime = item.end;
                            break;
                        }
                    }
                    const startTime = state.lastFinalTranscriptTime > 0 ? (state.lastFinalTranscriptTime - state.recordingStartTime) / 1000 : lastTranscriptEndTime;
                    newFinalEntry = {
                        type: 'transcript',
                        speaker: speakerTag,
                        text: transcriptText,
                        start: startTime,
                        end: (now - state.recordingStartTime) / 1000
                    };
                    state.transcript.push(newFinalEntry);
                    state.lastFinalTranscriptTime = now;
                }
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        
        if (state.isRecording) {
            renderLiveTranscript(interimTranscript);
        } else {
            DOM.transcriptTextarea.value += finalTranscript;
        }
    };
    
    recognition.onstart = () => { state.isListening = true; DOM.micBtn.classList.add('listening'); DOM.statusEl.textContent = 'Escuchando...'; };
    recognition.onend = () => {
        state.isListening = false;
        DOM.micBtn.classList.remove('listening');
        DOM.statusEl.textContent = 'Haz clic para empezar';
        if (!state.manualStop && state.isRecording) {
            try { recognition.start(); } catch(e) { console.error("Error al reiniciar reconocimiento:", e); }
        }
    };
    recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
            console.error('Error de reconocimiento:', event.error);
        }
    };

    // --- LÓGICA DE GRABACIÓN DE PANTALLA ---
    const startScreenRecording = async () => {
        state.manualStop = false;
        state.reunionTitle = DOM.reunionTitleInput.value.trim() || "Reunión Sin Título";
        DOM.recordingTitle.textContent = `Grabando: ${state.reunionTitle}`;

        const selectedMimeType = DOM.videoFormatSelect.value;
        if (!MediaRecorder.isTypeSupported(selectedMimeType)) {
            console.warn(`Formato ${selectedMimeType} no soportado. Usando video/webm como alternativa.`);
            state.videoMimeType = 'video/webm';
        } else {
            state.videoMimeType = selectedMimeType;
        }
        state.videoExtension = state.videoMimeType.includes('mp4') ? 'mp4' : 'webm';


        try {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: { mediaSource: "screen" } as any, audio: true });
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const audioContext = new AudioContext();
            state.audioContext = audioContext;
            state.sampleRate = audioContext.sampleRate;
            state.pcmData = [];
            const destination = audioContext.createMediaStreamDestination();
            if (displayStream.getAudioTracks().length > 0) audioContext.createMediaStreamSource(displayStream).connect(destination);
            if (micStream.getAudioTracks().length > 0) audioContext.createMediaStreamSource(micStream).connect(destination);
            const mixedAudioStream = destination.stream;

            const source = audioContext.createMediaStreamSource(mixedAudioStream);
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e: AudioProcessingEvent) => {
                if (!state.isRecording) return;
                state.pcmData.push(new Float32Array(e.inputBuffer.getChannelData(0)));
            };
            source.connect(processor);
            processor.connect(audioContext.destination);
            
            const combinedStream = new MediaStream([displayStream.getVideoTracks()[0], ...mixedAudioStream.getAudioTracks()]);
            DOM.liveVideoPreview.srcObject = combinedStream;
            state.screenStream = displayStream;
            
            state.recordedScreenChunks = [];
            state.screenMediaRecorder = new MediaRecorder(combinedStream, { mimeType: state.videoMimeType });
            state.screenMediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) state.recordedScreenChunks.push(event.data); };

            state.screenMediaRecorder.onstop = () => {
                downloadAllFiles();
                resetState();
                DOM.mainUI.style.display = 'flex';
                DOM.recordingUI.style.display = 'none';
            };
            
            DOM.mainUI.style.display = 'none';
            DOM.recordingUI.style.display = 'flex';
            state.screenMediaRecorder.start();
            state.isRecording = true;
            state.recordingStartTime = Date.now();
            state.lastFinalTranscriptTime = state.recordingStartTime;
            recognition.start();

        } catch (err) {
            console.error("Error al iniciar grabación:", err);
            alert("No se pudo iniciar la grabación de pantalla.");
            resetState();
        }
    };

    const stopScreenRecording = () => {
        state.manualStop = true;
        if (state.screenMediaRecorder?.state === 'recording') state.screenMediaRecorder.stop();
        if (recognition && state.isListening) recognition.stop();
        state.screenStream?.getTracks().forEach(track => track.stop());
        state.audioContext?.close().catch(e => console.error("Error closing AudioContext:", e));
    };

    const renderLiveTranscript = (interimTranscript: string) => {
        DOM.liveTranscriptDisplay.innerHTML = '';
        state.transcript.forEach((entry, index) => {
            let entryEl;
            if (entry.type === 'transcript') {
                entryEl = document.createElement('div');
                entryEl.className = 'transcript-entry';
                entryEl.dataset.index = index.toString();
                entryEl.innerHTML = `<p><span class="speaker">${entry.speaker}:</span> ${entry.text}</p>`;
                if (entry.note) {
                    const noteEl = document.createElement('div');
                    noteEl.className = 'transcript-note';
                    noteEl.textContent = entry.note;
                    entryEl.appendChild(noteEl);
                }
            } else { // topic marker
                entryEl = document.createElement('h3');
                entryEl.className = 'topic-marker';
                entryEl.textContent = entry.text;
            }
            DOM.liveTranscriptDisplay.appendChild(entryEl);
        });
        if (interimTranscript) {
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
            
            const audioContext = new AudioContext();
            state.dictationAudioContext = audioContext;
            state.dictationPcmData = [];
            state.sampleRate = audioContext.sampleRate;

            const source = audioContext.createMediaStreamSource(state.dictationAudioStream);
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e: AudioProcessingEvent) => {
                if (!state.isListening) return;
                state.dictationPcmData.push(new Float32Array(e.inputBuffer.getChannelData(0)));
            };
            source.connect(processor);
            processor.connect(audioContext.destination);

            recognition.start();
        } catch (err) { console.error('Error al iniciar grabación de audio:', err); }
    };

    const stopAudioOnlyRecording = () => {
        state.manualStop = true;
        if (recognition && state.isListening) recognition.stop();
        if (state.dictationAudioStream) state.dictationAudioStream.getTracks().forEach(track => track.stop());
        state.dictationAudioContext?.close().catch(e => console.error("Error closing dictation AudioContext:", e));

        if (state.dictationPcmData.length > 0) {
            const mergedPcm = new Float32Array(state.dictationPcmData.reduce((acc, val) => acc + val.length, 0));
            let offset = 0;
            for (const pcm of state.dictationPcmData) {
                mergedPcm.set(pcm, offset);
                offset += pcm.length;
            }
            const wavBlob = encodeWAV(mergedPcm, state.sampleRate);
            downloadFile(wavBlob, `${generateFilename()}_audio.wav`);
        }
        
        state.dictationPcmData = [];
        state.dictationAudioContext = null;
    };

    // --- FUNCIONALIDADES EN GRABACIÓN ---
    const takeScreenshot = async () => {
        const video = DOM.liveVideoPreview;
        if (video.readyState < 2) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
        if (!blob) return;

        state.screenshotCounter++;
        const baseFilename = generateFilename();
        const filename = `${baseFilename}_captura_${state.screenshotCounter}.jpg`;
        
        downloadFile(blob, filename);

        const timestamp = new Date().toLocaleTimeString('es-ES');
        DOM.liveNotes.value += `\n[Captura de pantalla-${state.screenshotCounter} tomada a las ${timestamp}]`;
        DOM.liveNotes.scrollTop = DOM.liveNotes.scrollHeight;
    };

    // --- PESTAÑA DE REVISIÓN DE REUNIONES ---
    const setupReviewTab = () => {
        DOM.reunionUploadInput.addEventListener('change', (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files || files.length === 0) return;

            let videoFile: File | null = null;
            let audioFile: File | null = null;
            let jsonFile: File | null = null;

            Array.from(files).forEach(file => {
                if (file.type.startsWith('video/')) videoFile = file;
                else if (file.type.startsWith('audio/')) audioFile = file;
                else if (file.name.endsWith('.json')) jsonFile = file;
            });

            if (!videoFile) {
                alert("No se ha seleccionado un archivo de vídeo (.mp4 o .webm).");
                return;
            }

            // Si faltan audio o json, intentamos encontrarlos por el nombre
            const baseName = videoFile.name.substring(0, videoFile.name.lastIndexOf('.'));
            if (!audioFile) {
                audioFile = Array.from(files).find(f => f.name.startsWith(baseName) && f.name.endsWith('.wav')) || null;
            }
            if (!jsonFile) {
                jsonFile = Array.from(files).find(f => f.name.startsWith(baseName) && f.name.endsWith('.json')) || null;
            }
            
            if (videoFile && audioFile && jsonFile) {
                processAndPlayReviewFiles(videoFile, audioFile, jsonFile);
            } else {
                alert(`No se pudieron encontrar todos los archivos necesarios. Asegúrate de que los archivos de vídeo, audio (.wav) y JSON (.json) comparten el mismo nombre base (Ej: 'MiReunion.mp4', 'MiReunion_audio.wav', 'MiReunion.json') y selecciónalos juntos.`);
            }
        });
    };

    const processAndPlayReviewFiles = (videoFile: File, audioFile: File, jsonFile: File) => {
        let reviewAudio: HTMLAudioElement | null = new Audio(URL.createObjectURL(audioFile));
        DOM.reviewVideo.src = URL.createObjectURL(videoFile);
        DOM.reviewVideo.muted = true;

        DOM.mainUI.style.display = 'none';
        DOM.reviewUI.style.display = 'flex';

        DOM.playButtonOverlay.classList.remove('hidden');
        DOM.reviewVideo.onplay = () => DOM.playButtonOverlay.classList.add('hidden');
        DOM.reviewVideo.onpause = () => DOM.playButtonOverlay.classList.remove('hidden');
        DOM.playButtonOverlay.onclick = () => DOM.reviewVideo.play();
        
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

        DOM.reviewVideo.onloadedmetadata = () => generateThumbnails(DOM.reviewVideo);

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target!.result as string);
                DOM.reviewTitle.textContent = `Revisando: ${data.title || 'Reunión'}`;
                renderReviewTranscript(data.transcript);
                setupReviewVideoSync(data.transcript);
            } catch (err) { alert("Error al leer el archivo JSON."); }
        };
        reader.readAsText(jsonFile);
        
        DOM.closeReviewBtn.onclick = () => {
            reviewAudio?.pause();
            DOM.reviewVideo.pause();
            reviewAudio = null;
            DOM.reviewVideo.src = '';
            DOM.reviewUI.style.display = 'none';
            DOM.mainUI.style.display = 'flex';
        };
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
        if (!context) return;

        const interval = Math.max(10, video.duration / 10); // Max 10 thumbnails
        const duration = video.duration;
        let generatedThumbnailsData = [];
        const initialTime = video.currentTime;
        const wasMuted = video.muted;
        video.muted = true;
        DOM.thumbnailContainer.innerHTML = '';

        for (let i = 0; i < duration; i += interval) {
            const dataUrl = await new Promise<string>(resolve => {
                const onSeeked = () => {
                    video.removeEventListener('seeked', onSeeked);
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
                    resolve(canvas.toDataURL('image/jpeg', 0.5));
                };
                video.addEventListener('seeked', onSeeked);
                video.currentTime = i;
            });
            generatedThumbnailsData.push({ time: i, src: dataUrl });
            const img = document.createElement('img');
            img.src = dataUrl;
            img.className = 'progress-thumbnail';
            DOM.thumbnailContainer.appendChild(img);
        }
        
        video.currentTime = initialTime;
        video.muted = wasMuted;
        DOM.thumbnailContainer.dataset.thumbnails = JSON.stringify(generatedThumbnailsData);
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
            const closestThumbnail = thumbnails.reduce((prev, curr) => (Math.abs(curr.time - hoverTime) < Math.abs(prev.time - hoverTime) ? curr : prev));

            if (closestThumbnail) {
                DOM.thumbnailPreview.style.display = 'flex';
                DOM.thumbnailPreviewImg.src = closestThumbnail.src;
                DOM.thumbnailPreviewTime.textContent = formatTime(hoverTime);
                const previewWidth = DOM.thumbnailPreview.offsetWidth;
                const newLeft = Math.max(previewWidth / 2, Math.min(x, rect.width - previewWidth / 2));
                DOM.thumbnailPreview.style.left = `${newLeft}px`;
            }
        });
        DOM.reviewVideoContainer.addEventListener('mouseleave', () => { DOM.thumbnailPreview.style.display = 'none'; });
    };

    const renderReviewTranscript = (transcript: TranscriptItem[]) => {
        DOM.reviewTranscriptContainer.innerHTML = '';
        transcript.forEach(entry => {
            let entryEl;
            if (entry.type === 'transcript') {
                entryEl = document.createElement('div');
                entryEl.className = 'transcript-entry';
                entryEl.dataset.startTime = entry.start.toString();
                entryEl.innerHTML = `<p><span class="speaker">${entry.speaker}:</span> ${entry.text}</p>`;
                if (entry.note) {
                    const noteEl = document.createElement('div');
                    noteEl.className = 'transcript-note';
                    noteEl.textContent = entry.note;
                    entryEl.appendChild(noteEl);
                }
                entryEl.addEventListener('click', () => {
                    DOM.reviewVideo.currentTime = entry.start;
                });
            } else { // topic marker
                entryEl = document.createElement('h3');
                entryEl.className = 'topic-marker';
                entryEl.textContent = entry.text;
            }
            DOM.reviewTranscriptContainer.appendChild(entryEl);
        });
    };

    const setupReviewVideoSync = (transcript: TranscriptItem[]) => {
        DOM.reviewVideo.addEventListener('timeupdate', () => {
            const currentTime = DOM.reviewVideo.currentTime;
            const phrases = DOM.reviewTranscriptContainer.querySelectorAll('.transcript-entry[data-start-time]');
            let activePhrase: Element | null = null;
            
            phrases.forEach(p => {
                const startTime = parseFloat(p.getAttribute('data-start-time')!);
                if (currentTime >= startTime) activePhrase = p;
                p.classList.remove('current-phrase');
            });

            if (activePhrase) {
                activePhrase.classList.add('current-phrase');
                if (activePhrase.getBoundingClientRect().top < 0 || activePhrase.getBoundingClientRect().bottom > DOM.reviewTranscriptContainer.clientHeight) {
                    activePhrase.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });
    };

    // --- UTILIDADES Y EVENTOS ---
    const generateFilename = () => {
        const title = (state.reunionTitle || DOM.reunionTitleInput.value.trim() || "grabacion").replace(/\s+/g, '_');
        const date = new Date();
        const timestamp = `${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}`;
        return `${title}_${timestamp}`;
    };

    const downloadFile = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    };

    const encodeWAV = (samples: Float32Array, sampleRate: number): Blob => {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);
        const writeString = (view: DataView, offset: number, str: string) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        };

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // Mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true); // byte rate
        view.setUint16(32, 2, true); // block align
        view.setUint16(34, 16, true); // bits per sample
        writeString(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);

        let offset = 44;
        for (let i = 0; i < samples.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return new Blob([view], { type: 'audio/wav' });
    };

    const downloadAllFiles = () => {
        const baseFilename = generateFilename();
        downloadFile(new Blob(state.recordedScreenChunks, { type: state.videoMimeType }), `${baseFilename}.${state.videoExtension}`);
        
        const mergedPcm = new Float32Array(state.pcmData.reduce((acc, val) => acc + val.length, 0));
        let offset = 0;
        for (const pcm of state.pcmData) {
            mergedPcm.set(pcm, offset);
            offset += pcm.length;
        }
        const wavBlob = encodeWAV(mergedPcm, state.sampleRate);
        downloadFile(wavBlob, `${baseFilename}_audio.wav`);
        
        const jsonData = { title: state.reunionTitle, date: new Date().toISOString(), transcript: state.transcript };
        downloadFile(new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' }), `${baseFilename}.json`);

        const notes = DOM.liveNotes.value;
        if (notes.trim()) downloadFile(new Blob([notes], { type: 'text/plain;charset=utf-8' }), `${baseFilename}_notas.txt`);
    };
    
    const resetState = () => {
        state = { 
            ...state, 
            isRecording: false, 
            isListening: false, 
            isInlineEditing: false,
            screenStream: null, 
            screenMediaRecorder: null, 
            recordedScreenChunks: [], 
            transcript: [], 
            recordingStartTime: 0, 
            lastFinalTranscriptTime: 0, 
            speakerCounter: 1, 
            manualStop: false,
            screenshotCounter: 0,
            audioContext: null,
            pcmData: [],
            dictationAudioContext: null,
            dictationPcmData: [],
            videoMimeType: 'video/webm',
            videoExtension: 'webm',
        };
        DOM.liveTranscriptDisplay.innerHTML = '';
        DOM.liveNotes.value = '';
    };

    const setupEventListeners = () => {
        DOM.startRecordBtn.addEventListener('click', startScreenRecording);
        DOM.stopRecordBtn.addEventListener('click', stopScreenRecording);
        DOM.screenshotBtn.addEventListener('click', takeScreenshot);

        DOM.micBtn.addEventListener('click', () => {
            if(state.isListening) stopAudioOnlyRecording();
            else {
                DOM.transcriptTextarea.value = '';
                startAudioOnlyRecording();
            }
        });

        const actionsEl = document.createElement('div');
        actionsEl.className = 'transcript-actions';
        actionsEl.innerHTML = `
            <button class="action-btn" data-action="add-topic" title="Añadir marcador de tema"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg></button>
            <button class="action-btn" data-action="add-note" title="Añadir nota"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg></button>
        `;
        let activeTranscriptIndex: number | null = null;
        
        DOM.liveTranscriptDisplay.addEventListener('mouseover', e => {
            if (state.isInlineEditing) return;
            const target = (e.target as HTMLElement).closest('.transcript-entry');
            if (target) {
                target.appendChild(actionsEl);
                activeTranscriptIndex = parseInt(target.getAttribute('data-index')!, 10);
            }
        });

        actionsEl.addEventListener('click', e => {
            if (state.isInlineEditing) return;
            const target = (e.target as HTMLElement).closest('[data-action]');
            if (!target || activeTranscriptIndex === null) return;
            const action = target.getAttribute('data-action');
            const entryIndex = activeTranscriptIndex;
            const transcriptEntry = state.transcript[entryIndex] as TranscriptEntry | undefined;

            if (action === 'add-topic') {
                state.isInlineEditing = true;
                const entryElement = DOM.liveTranscriptDisplay.querySelector(`[data-index="${entryIndex}"]`);
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'inline-topic-editor';
                input.placeholder = 'Introduce el título del tema y pulsa Enter';
                entryElement?.insertAdjacentElement('afterend', input);
                input.focus();

                const saveTopic = () => {
                    const topic = input.value.trim();
                    if (topic) {
                        const newTopic: TopicMarkerEntry = { type: 'topic', text: topic, time: (Date.now() - state.recordingStartTime) / 1000 };
                        state.transcript.splice(entryIndex + 1, 0, newTopic);
                    }
                    state.isInlineEditing = false;
                    renderLiveTranscript('');
                };
                input.addEventListener('blur', saveTopic);
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
            } else if (action === 'add-note' && transcriptEntry?.type === 'transcript') {
                state.isInlineEditing = true;
                const entryElement = DOM.liveTranscriptDisplay.querySelector(`[data-index="${entryIndex}"]`);
                const existingNote = entryElement?.querySelector('.transcript-note, .inline-note-editor');
                if(existingNote) existingNote.remove();

                const textarea = document.createElement('textarea');
                textarea.className = 'inline-note-editor';
                textarea.value = transcriptEntry.note || '';
                entryElement?.appendChild(textarea);
                textarea.focus();
                textarea.addEventListener('blur', () => {
                    transcriptEntry.note = textarea.value.trim();
                    state.isInlineEditing = false;
                    renderLiveTranscript('');
                });
            }
        });
        
        setupReviewTab();
        setupThumbnailHover();
    };

    // --- EJECUTAR ---
    init();
};

App();