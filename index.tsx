/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI } from "@google/genai";

// Estructura para la transcripción con metadatos
interface TranscriptSegment {
    speaker: string;
    text: string;
    startTime: number;
    endTime: number;
}
interface Marker {
    time: string;
    text: string;
    note: string;
}


const App = () => {
    // --- ELEMENTOS DEL DOM ---
    const transcriptEl = document.getElementById('transcript') as HTMLTextAreaElement;
    const micBtn = document.getElementById('mic-btn') as HTMLButtonElement;
    const statusEl = document.getElementById('status') as HTMLParagraphElement;
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
    const saveTranscriptBtn = document.getElementById('save-transcript-btn') as HTMLButtonElement;
    const markerTooltip = document.getElementById('marker-tooltip') as HTMLDivElement;
    const addMarkerBtn = document.getElementById('add-marker-btn') as HTMLButtonElement;
    const markersList = document.getElementById('markers-list') as HTMLUListElement;

    // Elementos de la grabación inmersiva
    const inRecordingView = document.getElementById('in-recording-view') as HTMLDivElement;
    const screenVideoPreviewEl = document.getElementById('screen-video-preview') as HTMLVideoElement;
    const stopRecordBtn = document.getElementById('stop-record-btn') as HTMLButtonElement;
    const liveTranscriptDisplayEl = document.getElementById('live-transcript-display') as HTMLDivElement;
    const notesTextarea = document.getElementById('notes-textarea') as HTMLTextAreaElement;
    
    // Elementos de la pestaña de reproducción
    const videoFileInput = document.getElementById('video-file-input') as HTMLInputElement;
    const transcriptFileInput = document.getElementById('transcript-file-input') as HTMLInputElement;
    const playbackArea = document.getElementById('playback-area') as HTMLDivElement;
    const playbackVideoEl = document.getElementById('playback-video') as HTMLVideoElement;
    const playbackTranscriptContainer = document.getElementById('playback-transcript-container') as HTMLDivElement;

    // --- ESTADO DE LA APLICACIÓN ---
    let ai: GoogleGenAI | null = null;
    try {
        ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    } catch (error) {
        statusEl.textContent = 'Error al inicializar la API de IA. Verifica la clave de API.';
        console.error(error);
    }
    
    let screenStream: MediaStream | null = null;
    let screenMediaRecorder: MediaRecorder | null = null;
    let recordedScreenChunks: Blob[] = [];
    
    let audioStream: MediaStream | null = null;
    let audioRecorder: MediaRecorder | null = null;
    let audioChunks: Blob[] = [];

    let markers: Marker[] = [];
    let fullTranscript: TranscriptSegment[] = [];
    let recordingStartTime: number | null = null;
    let isListening = false;
    let combinedStream: MediaStream | null = null;
    let chunkCounter = 0;
    
    // --- LÓGICA DE PESTAÑAS ---
    const switchTab = (tabId: string) => {
        tabBtns.forEach(innerBtn => innerBtn.classList.remove('active'));
        document.querySelector(`.tab-btn[data-tab="${tabId}"]`)?.classList.add('active');
        
        tabContents.forEach(content => {
            content.classList.remove('active');
            if (content.id === tabId) content.classList.add('active');
        });
    };

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            if (tabId) switchTab(tabId);
        });
    });

    // --- LÓGICA DE TRANSCRIPCIÓN CON IA (GEMINI) ---
    const blobToBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = (reader.result as string).split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    };
    
    const transcribeAudioChunk = async (audioBlob: Blob) => {
        if (!ai) return;
        statusEl.textContent = `Transcribiendo audio (parte ${chunkCounter})...`;
        try {
            const base64Audio = await blobToBase64(audioBlob);
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: "Transcribe el siguiente audio. Identifica los diferentes hablantes como 'Hablante A', 'Hablante B', etc. Proporciona la salida como un array JSON de objetos, donde cada objeto tiene las claves 'speaker', 'text', 'startTime' y 'endTime'. Los tiempos deben ser en segundos y relativos al inicio de este fragmento de audio." },
                            {
                                inlineData: {
                                    mimeType: 'audio/webm',
                                    data: base64Audio
                                }
                            }
                        ]
                    }
                ],
            });
            const jsonText = response.text.replace(/```json|```/g, '').trim();
            const segments: TranscriptSegment[] = JSON.parse(jsonText);
            
            const timeOffset = (chunkCounter - 1) * 10; // Asumiendo chunks de 10 segundos
            segments.forEach(seg => {
                const segmentWithOffset = {
                    ...seg,
                    startTime: seg.startTime + timeOffset,
                    endTime: seg.endTime + timeOffset,
                };
                fullTranscript.push(segmentWithOffset);
            });

            renderTranscript();
            statusEl.textContent = 'Escuchando...';
        } catch (error) {
            console.error("Error al transcribir con Gemini:", error);
            statusEl.textContent = 'Error en la transcripción con IA.';
        }
    };
    
    const renderTranscript = () => {
        // Para la vista principal (textarea)
        transcriptEl.value = fullTranscript
            .map(seg => `${seg.speaker}: ${seg.text}`)
            .join('\n');
        transcriptEl.scrollTop = transcriptEl.scrollHeight;

        // Para la vista de grabación en vivo (div)
        liveTranscriptDisplayEl.innerHTML = '';
        fullTranscript.forEach(seg => {
            const p = document.createElement('p');
            p.innerHTML = `<strong>${seg.speaker}:</strong> ${seg.text}`;
            liveTranscriptDisplayEl.appendChild(p);
        });
        liveTranscriptDisplayEl.scrollTop = liveTranscriptDisplayEl.scrollHeight;
    };

    // --- LÓGICA DE GRABACIÓN DE AUDIO Y PANTALLA ---
    const startRecording = async (recordScreen: boolean) => {
        try {
            let videoTrack: MediaStreamTrack | undefined;
            let audioTrack: MediaStreamTrack | undefined;

            // Reiniciar estado
            fullTranscript = [];
            markers = [];
            chunkCounter = 0;
            renderTranscript();
            renderMarkers();
            
            if (recordScreen) {
                document.body.classList.add('is-recording');
                liveTranscriptDisplayEl.innerHTML = '';
                notesTextarea.value = '';

                screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                videoTrack = screenStream.getVideoTracks()[0];
                audioTrack = screenStream.getAudioTracks()[0];
                
                if (!audioTrack) {
                    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    audioTrack = audioStream.getAudioTracks()[0];
                }
                
                screenVideoPreviewEl.srcObject = screenStream;
            } else {
                audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                audioTrack = audioStream.getAudioTracks()[0];
            }

            combinedStream = new MediaStream([videoTrack, audioTrack].filter(t => t));
            
            if(videoTrack) {
                recordedScreenChunks = [];
                screenMediaRecorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm' });
                screenMediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) recordedScreenChunks.push(event.data); };
                screenMediaRecorder.start();
            }

            if(audioTrack) {
                const audioOnlyStream = new MediaStream([audioTrack]);
                audioChunks = [];
                audioRecorder = new MediaRecorder(audioOnlyStream, { mimeType: 'audio/webm' });
                
                audioRecorder.ondataavailable = async (event) => {
                    if (event.data.size > 0) {
                        audioChunks.push(event.data);
                        chunkCounter++;
                        await transcribeAudioChunk(event.data);
                    }
                };
                
                audioRecorder.start(10000); // Enviar chunk cada 10 segundos
            }
            
            isListening = true;
            micBtn.classList.add('listening');
            statusEl.textContent = 'Grabando y escuchando...';
            recordingStartTime = Date.now();

        } catch (err) {
            console.error("Error al iniciar la grabación:", err);
            statusEl.textContent = 'No se pudo iniciar la grabación.';
            stopRecording();
        }
    };

    const stopRecording = () => {
        isListening = false;
        micBtn.classList.remove('listening');
        statusEl.textContent = 'Procesamiento finalizado. Haz clic para empezar de nuevo.';
        
        if (screenMediaRecorder?.state === 'recording') screenMediaRecorder.stop();
        if (audioRecorder?.state === 'recording') audioRecorder.stop();
        
        screenStream?.getTracks().forEach(track => track.stop());
        audioStream?.getTracks().forEach(track => track.stop());
        combinedStream?.getTracks().forEach(track => track.stop());
        
        screenStream = null;
        audioStream = null;
        combinedStream = null;
        recordingStartTime = null;
        
        document.body.classList.remove('is-recording');
        screenVideoPreviewEl.srcObject = null;
        
        const timestamp = new Date().toISOString();

        if (recordedScreenChunks.length > 0) {
            const videoBlob = new Blob(recordedScreenChunks, { type: 'video/webm' });
            downloadBlob(videoBlob, `grabacion_pantalla_${timestamp}.webm`);
            
            const transcriptBlob = downloadTranscription(timestamp);
            
            const notes = notesTextarea.value.trim();
            if(notes.length > 0) {
                const notesBlob = new Blob([notes], { type: 'text/plain;charset=utf-8' });
                downloadBlob(notesBlob, `notas_${timestamp}.txt`);
            }
            
            if(transcriptBlob) {
                setTimeout(() => { // Pequeño delay para asegurar que las descargas inicien
                    loadPlaybackFiles(videoBlob, transcriptBlob);
                    switchTab('playback-tab');
                }, 500);
            }
            recordedScreenChunks = [];

        } else if (audioChunks.length > 0) {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            downloadBlob(audioBlob, `grabacion_audio_${timestamp}.webm`);
            downloadTranscription(timestamp);
            audioChunks = [];
        }
    };

    micBtn.addEventListener('click', () => {
        if (isListening) {
            stopRecording();
        } else {
            startRecording(false);
        }
    });

    recordBtn.addEventListener('click', () => startRecording(true));
    stopRecordBtn.addEventListener('click', stopRecording);


    // --- LÓGICA DE GUARDADO Y DESCARGA ---
    const downloadBlob = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }
    
    const downloadTranscription = (timestamp?: string): Blob | null => {
        if (fullTranscript.length === 0 && markers.length === 0) {
            if(!timestamp) alert('No hay transcripción para guardar.'); // Solo mostrar alerta en guardado manual
            return null;
        }
        const dataToSave = {
            transcript: fullTranscript,
            markers: markers,
        };
        const transcriptString = JSON.stringify(dataToSave, null, 2);
        const blob = new Blob([transcriptString], { type: 'application/json;charset=utf-8' });
        const filename = `transcripcion_${timestamp || new Date().toISOString()}.json`;
        downloadBlob(blob, filename);
        return blob;
    };
    saveTranscriptBtn.addEventListener('click', () => downloadTranscription());

    // --- LÓGICA DE REPRODUCCIÓN SINCRONIZADA ---
    let loadedTranscript: TranscriptSegment[] = [];

    const loadPlaybackFiles = (videoFile: File | Blob, transcriptFile: File | Blob) => {
        const videoUrl = URL.createObjectURL(videoFile);
        playbackVideoEl.src = videoUrl;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);
                loadedTranscript = data.transcript || []; // Manejar JSON antiguos o sin transcripción
                markers = data.markers || []; // Cargar marcadores también
                renderPlaybackTranscript();
                renderMarkers(); // Mostrar marcadores cargados
                playbackArea.style.display = 'grid';
            } catch (err) {
                alert('Error al leer el archivo de transcripción. Asegúrate de que es un JSON válido.');
            }
        };
        reader.readAsText(transcriptFile);
    };

    const renderPlaybackTranscript = () => {
        playbackTranscriptContainer.innerHTML = '';
        loadedTranscript.forEach(seg => {
            const p = document.createElement('p');
            p.dataset.startTime = seg.startTime.toString();
            p.innerHTML = `<strong>${seg.speaker}</strong>: ${seg.text}`;
            p.addEventListener('click', () => {
                playbackVideoEl.currentTime = seg.startTime;
                playbackVideoEl.play();
            });
            playbackTranscriptContainer.appendChild(p);
        });
    };

    videoFileInput.addEventListener('change', () => {
        if (videoFileInput.files?.[0] && transcriptFileInput.files?.[0]) {
            loadPlaybackFiles(videoFileInput.files[0], transcriptFileInput.files[0]);
        }
    });
    transcriptFileInput.addEventListener('change', () => {
         if (videoFileInput.files?.[0] && transcriptFileInput.files?.[0]) {
            loadPlaybackFiles(videoFileInput.files[0], transcriptFileInput.files[0]);
        }
    });

    playbackVideoEl.addEventListener('timeupdate', () => {
        const currentTime = playbackVideoEl.currentTime;
        const allSegments = playbackTranscriptContainer.querySelectorAll('p');
        
        allSegments.forEach(p => p.classList.remove('highlight'));

        const currentSegment = loadedTranscript.find(seg => currentTime >= seg.startTime && currentTime <= seg.endTime);
        if (currentSegment) {
            const segmentEl = playbackTranscriptContainer.querySelector(`p[data-start-time="${currentSegment.startTime}"]`);
            segmentEl?.classList.add('highlight');
            segmentEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
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
    
    const handleSelection = (e: MouseEvent) => {
        const selection = window.getSelection();
        if (selection && selection.toString().trim().length > 0 && recordingStartTime) {
            markerTooltip.style.left = `${e.clientX}px`;
            markerTooltip.style.top = `${e.clientY - 45}px`;
            markerTooltip.style.display = 'block';
        } else {
            markerTooltip.style.display = 'none';
        }
    };
    
    transcriptEl.addEventListener('mouseup', handleSelection);
    liveTranscriptDisplayEl.addEventListener('mouseup', handleSelection);
      
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

    // --- INICIALIZACIÓN ---
    renderMarkers();
};

App();
