document.addEventListener('DOMContentLoaded', () => {
    // --- Audio Context Setup ---
    let audioContext;
    const activeVoices = new Map(); // To track currently playing notes

    // --- DOM Elements ---
    const panicButton = document.getElementById('panic-button');
    const keyboardContainer = document.getElementById('piano-keys');
    const playPauseSequencerButton = document.getElementById('play-pause-sequencer');
    // ... other control elements will be defined here

    // --- Core Synthesizer State ---
    let isSequencerPlaying = false;
    let currentStep = 0;
    let bpm = 120;
    let transpose = 0;
    const sequence = [false, false, false, false, false, false, false, false];

    // Messiaen's Mode 2 (transposed) - one of the most characteristic
    // C, C#, D#, E, F#, G, A, A#
    const messiaenScale = [0, 1, 4, 5, 7, 8, 10, 11];
    const baseNote = 60; // Middle C

    // ==================================================================
    //                        AUDIO INITIALIZATION
    // ==================================================================

    function initAudio() {
        if (!audioContext) {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                console.log("AudioContext created successfully.");
            } catch (e) {
                alert('Web Audio API is not supported in this browser.');
                console.error(e);
            }
        }
    }


    // ==================================================================
    //                        SYNTH VOICE
    // ==================================================================

    function playVoice(note) {
        if (!audioContext) return;
        
        const frequency = midiToFreq(note);
        console.log(`Playing note: ${note}, Freq: ${frequency.toFixed(2)}Hz`);

        // --- Get Parameters from UI ---
        const carrierBaseFreq = frequency;
        const modulatorFreq = parseFloat(document.getElementById('modulator-freq').value);
        const modIndex = parseFloat(document.getElementById('mod-index').value);
        const lpfCutoff = parseFloat(document.getElementById('lpf-cutoff').value);
        const delayTime = parseFloat(document.getElementById('delay-time').value);
        const delayFeedback = parseFloat(document.getElementById('delay-feedback').value);

        // --- Create Nodes ---
        const carrier = audioContext.createOscillator();
        const modulator = audioContext.createOscillator();
        const modGain = audioContext.createGain();
        const masterGain = audioContext.createGain();
        const filter = audioContext.createBiquadFilter();
        const delay = audioContext.createDelay(1.0); // Max 1s delay
        const feedback = audioContext.createGain();

        // --- Connections ---
        // Modulator -> ModGain -> Carrier Frequency
        modulator.connect(modGain);
        modGain.connect(carrier.frequency);

        // Carrier -> Filter -> MasterGain -> Delay -> Destination
        carrier.connect(filter);
        filter.connect(masterGain);
        
        // Delay Loop
        masterGain.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        
        // Output
        masterGain.connect(audioContext.destination);
        delay.connect(audioContext.destination);


        // --- Configure Nodes ---
        carrier.frequency.value = carrierBaseFreq;
        carrier.type = 'sine';

        modulator.frequency.value = modulatorFreq;
        modulator.type = 'sine';
        
        modGain.gain.value = modIndex;

        filter.type = 'lowpass';
        filter.frequency.value = lpfCutoff;

        delay.delayTime.value = delayTime;
        feedback.gain.value = delayFeedback;

        masterGain.gain.setValueAtTime(0, audioContext.currentTime);
        masterGain.gain.linearRampToValueAtTime(0.5, audioContext.currentTime + 0.01); // Quick attack

        // --- Start and Store ---
        carrier.start();
        modulator.start();

        const voice = { carrier, modulator, masterGain, filter, delay, feedback };
        activeVoices.set(note, voice);
    }

    function stopVoice(note) {
        if (activeVoices.has(note)) {
            const { masterGain, carrier, modulator } = activeVoices.get(note);
            const now = audioContext.currentTime;
            
            // Simple release envelope
            masterGain.gain.cancelScheduledValues(now);
            masterGain.gain.setValueAtTime(masterGain.gain.value, now);
            masterGain.gain.linearRampToValueAtTime(0, now + 0.3);

            // Stop oscillators after release
            setTimeout(() => {
                carrier.stop();
                modulator.stop();
                activeVoices.delete(note);
                 console.log(`Stopped note: ${note}`);
            }, 350);
        }
    }

    // ==================================================================
    //                        PANIC BUTTON
    // ==================================================================

    panicButton.addEventListener('click', () => {
        console.warn("PANIC! Stopping all sounds.");
        if (audioContext) {
             activeVoices.forEach((voice, note) => {
                const { masterGain, carrier, modulator, feedback } = voice;
                const now = audioContext.currentTime;
                
                masterGain.gain.cancelScheduledValues(now);
                masterGain.gain.setValueAtTime(0, now);

                if(feedback) {
                    feedback.gain.cancelScheduledValues(now);
                    feedback.gain.setValueAtTime(0, now);
                }

                carrier.stop(now + 0.1);
                modulator.stop(now + 0.1);
            });
            activeVoices.clear();
        }
    });


    // ==================================================================
    //                        KEYBOARD
    // ==================================================================
    
    function createKeyboard() {
        keyboardContainer.innerHTML = ''; // Clear existing keys
        const keyCount = 25; // 2 octaves approx
        
        for (let i = 0; i < keyCount; i++) {
            const key = document.createElement('div');
            const note = baseNote + messiaenScale[i % messiaenScale.length] + (12 * Math.floor(i / messiaenScale.length));
            
            // Basic key styling (no black/white distinction for this scale)
            key.className = 'key white'; 
            key.dataset.note = note;
            
            key.addEventListener('mousedown', () => playKey(note));
            key.addEventListener('mouseup', () => stopKey(note));
            key.addEventListener('mouseleave', () => stopKey(note)); // Stop if mouse leaves key while pressed

            keyboardContainer.appendChild(key);
        }
    }

    function playKey(note) {
        initAudio(); // Ensure audio context is running
        const finalNote = note + parseInt(document.getElementById('transpose').value, 10);
        playVoice(finalNote);
        const keyElement = keyboardContainer.querySelector(`[data-note='${note}']`);
        if(keyElement) keyElement.classList.add('pressed');
    }

    function stopKey(note) {
        const finalNote = note + parseInt(document.getElementById('transpose').value, 10);
        stopVoice(finalNote);
        const keyElement = keyboardContainer.querySelector(`[data-note='${note}']`);
        if(keyElement) keyElement.classList.remove('pressed');
    }


    // ==================================================================
    //                        SEQUENCER
    // ==================================================================

    // --- Sequencer Logic ---
    let sequencerInterval;

    function toggleSequencer() {
        initAudio();
        isSequencerPlaying = !isSequencerPlaying;
        if (isSequencerPlaying) {
            currentStep = 0;
            const bpmValue = parseInt(document.getElementById('bpm').value, 10);
            const intervalTime = 60000 / bpmValue / 4; // 16th notes
            sequencerInterval = setInterval(step, intervalTime);
            playPauseSequencerButton.textContent = "Pause";
        } else {
            clearInterval(sequencerInterval);
            playPauseSequencerButton.textContent = "Play";
            // Turn off playing indicator
            document.querySelectorAll('.step.playing').forEach(el => el.classList.remove('playing'));
        }
    }

    function step() {
        // Update UI
        document.querySelectorAll('.step').forEach((el, index) => {
            el.classList.toggle('playing', index === currentStep);
        });

        // Play sound if step is active
        if (sequence[currentStep]) {
            // Use a fixed note for the sequencer for now
            const seqNote = baseNote + messiaenScale[currentStep % messiaenScale.length] + parseInt(document.getElementById('transpose').value, 10);
            playVoice(seqNote);
            // Play for a short duration
            setTimeout(() => stopVoice(seqNote), 100); 
        }

        currentStep = (currentStep + 1) % sequence.length;
    }

    // --- Sequencer UI Events ---
    playPauseSequencerButton.addEventListener('click', toggleSequencer);

    document.querySelectorAll('.step').forEach((stepEl, index) => {
        stepEl.addEventListener('click', () => {
            sequence[index] = !sequence[index];
            stepEl.classList.toggle('active', sequence[index]);
        });
    });
    
    document.getElementById('bpm').addEventListener('input', (e) => {
        if(isSequencerPlaying) {
            // restart interval with new bpm
            toggleSequencer(); // pause
            toggleSequencer(); // and play again
        }
    });


    // ==================================================================
    //                        INITIALIZATION
    // ==================================================================

    function init() {
        createKeyboard();
        // Add other initial setup here
    }

    // Utility
    function midiToFreq(midi) {
        return Math.pow(2, (midi - 69) / 12) * 440;
    }

    init();
});
