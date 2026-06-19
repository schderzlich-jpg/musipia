import * as Tone from 'tone';

export interface SynthParams {
  synthType: 'piano' | 'lead' | 'pad' | 'fm' | 'epiano';
  attack: number;     // 0.01 - 2.0
  decay: number;      // 0.1 - 2.0
  sustain: number;    // 0.0 - 1.0
  release: number;    // 0.1 - 5.0
  cutoff: number;     // 200 - 10000 Hz
  resonance: number;  // 0 - 20
  delayWet: number;   // 0.0 - 1.0
  reverbWet: number;  // 0.0 - 1.0
  masterVolume: number; // -40 to 0 dB
}

export const defaultParams: SynthParams = {
  synthType: 'piano',
  attack: 0.05,
  decay: 0.3,
  sustain: 0.7,
  release: 0.8,
  cutoff: 3500,
  resonance: 1.0,
  delayWet: 0.05,
  reverbWet: 0.15,
  masterVolume: -6,
};

class SoundEngine {
  private polySynth: Tone.PolySynth | null = null;
  private sampler: Tone.Sampler | null = null;
  private filter: Tone.Filter | null = null;
  private delay: Tone.FeedbackDelay | null = null;
  private reverb: Tone.Reverb | null = null;
  private analyser: Tone.Analyser | null = null;
  private currentParams: SynthParams = { ...defaultParams };
  private isInitialized = false;
  private isPianoLoaded = false;
  private onPianoLoadedCallback: (() => void) | null = null;

  public async init() {
    if (this.isInitialized) return;

    await Tone.start();
    
    // Master volume
    Tone.Destination.volume.value = this.currentParams.masterVolume;

    // Create FX chain
    this.filter = new Tone.Filter({
      type: 'lowpass',
      frequency: this.currentParams.cutoff,
      Q: this.currentParams.resonance,
    });

    this.delay = new Tone.FeedbackDelay({
      delayTime: '8n',
      feedback: 0.25,
      wet: this.currentParams.delayWet,
    });

    this.reverb = new Tone.Reverb({
      decay: 2.0,
      preDelay: 0.01,
      wet: this.currentParams.reverbWet,
    });

    // Analyser for oscilloscope
    this.analyser = new Tone.Analyser('waveform', 512);
    
    // Connect FX chain: filter → delay → reverb → analyser → destination
    this.filter.chain(this.delay, this.reverb, this.analyser, Tone.Destination);

    // Create realistic Grand Piano sampler
    this.sampler = new Tone.Sampler({
      urls: {
        "A0": "A0.mp3",
        "C1": "C1.mp3",
        "D#1": "Ds1.mp3",
        "F#1": "Fs1.mp3",
        "A1": "A1.mp3",
        "C2": "C2.mp3",
        "D#2": "Ds2.mp3",
        "F#2": "Fs2.mp3",
        "A2": "A2.mp3",
        "C3": "C3.mp3",
        "D#3": "Ds3.mp3",
        "F#3": "Fs3.mp3",
        "A3": "A3.mp3",
        "C4": "C4.mp3",
        "D#4": "Ds4.mp3",
        "F#4": "Fs4.mp3",
        "A4": "A4.mp3",
        "C5": "C5.mp3",
        "D#5": "Ds5.mp3",
        "F#5": "Fs5.mp3",
        "A5": "A5.mp3",
        "C6": "C6.mp3",
        "D#6": "Ds6.mp3",
        "F#6": "Fs6.mp3",
        "A6": "A6.mp3",
        "C7": "C7.mp3",
        "D#7": "Ds7.mp3",
        "F#7": "Fs7.mp3",
        "A7": "A7.mp3",
        "C8": "C8.mp3",
      },
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      onload: () => {
        this.isPianoLoaded = true;
        console.log('Piano sampler loaded successfully.');
        if (this.onPianoLoadedCallback) {
          this.onPianoLoadedCallback();
        }
      },
      onerror: (err) => {
        console.warn('Error loading piano samples from CDN:', err);
      }
    });
    this.sampler.connect(this.filter);

    this.updateSynthType(this.currentParams.synthType);
    this.isInitialized = true;
    console.log('Tone.js SoundEngine initialized successfully.');
  }

  public updateSynthType(type: 'piano' | 'lead' | 'pad' | 'fm' | 'epiano') {
    if (!this.filter) return;

    // Disconnect and dispose old synth
    if (this.polySynth) {
      this.polySynth.disconnect();
      this.polySynth.dispose();
      this.polySynth = null;
    }

    this.currentParams.synthType = type;

    if (type === 'piano') {
      // Handled by this.sampler
      return;
    }

    if (type === 'lead') {
      this.polySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: {
          attack: this.currentParams.attack,
          decay: this.currentParams.decay,
          sustain: this.currentParams.sustain,
          release: this.currentParams.release,
        }
      });
    } else if (type === 'pad') {
      this.polySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: {
          attack: Math.max(0.5, this.currentParams.attack),
          decay: 0.5,
          sustain: 0.8,
          release: Math.max(1.5, this.currentParams.release),
        }
      });
    } else if (type === 'fm') {
      this.polySynth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 10,
        envelope: {
          attack: this.currentParams.attack,
          decay: this.currentParams.decay,
          sustain: this.currentParams.sustain,
          release: this.currentParams.release,
        },
        modulationEnvelope: {
          attack: 0.1,
          decay: 0.2,
          sustain: 1.0,
          release: 0.5,
        }
      }) as any;
    } else {
      // Warm E-Piano
      this.polySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: {
          attack: 0.005,
          decay: 1.5,
          sustain: 0.1,
          release: 0.4,
        }
      });
    }

    if (this.polySynth) {
      this.polySynth.connect(this.filter);
    }
  }

  public updateParams(params: Partial<SynthParams>) {
    this.currentParams = { ...this.currentParams, ...params };
    
    // If synthType changed, rebuild synth
    if (params.synthType && params.synthType !== this.currentParams.synthType) {
      this.updateSynthType(params.synthType);
      return;
    }

    // If master volume changed
    if (params.masterVolume !== undefined) {
      Tone.Destination.volume.rampTo(params.masterVolume, 0.05);
    }

    // Filter params
    if (this.filter) {
      if (params.cutoff !== undefined) {
        this.filter.frequency.rampTo(params.cutoff, 0.05);
      }
      if (params.resonance !== undefined) {
        this.filter.Q.rampTo(params.resonance, 0.05);
      }
    }

    // FX wet levels
    if (this.delay && params.delayWet !== undefined) {
      this.delay.wet.rampTo(params.delayWet, 0.05);
    }
    if (this.reverb && params.reverbWet !== undefined) {
      this.reverb.wet.rampTo(params.reverbWet, 0.05);
    }

    // Synth Envelope (if synth type is active and has envelope)
    if (this.polySynth && this.currentParams.synthType !== 'fm') {
      try {
        this.polySynth.set({
          envelope: {
            attack: this.currentParams.attack,
            decay: this.currentParams.decay,
            sustain: this.currentParams.sustain,
            release: this.currentParams.release,
          }
        });
      } catch (e) {
        // Safe catch
      }
    }
  }

  // Convert MIDI note number to frequency (Hz)
  private midiToFreq(note: number): number {
    return Math.pow(2, (note - 69) / 12) * 440;
  }

  public triggerNoteOn(note: number, velocity: number = 80) {
    if (!this.isInitialized) {
      this.init();
      return;
    }
    
    const freq = this.midiToFreq(note);
    const vel = velocity / 127; // normalize to 0-1
    
    if (this.currentParams.synthType === 'piano') {
      if (this.sampler && this.isPianoLoaded) {
        try {
          const noteName = Tone.Frequency(note, "midi").toNote();
          this.sampler.triggerAttack(noteName, Tone.now(), vel);
        } catch (err) {
          console.warn('Error triggering piano note:', err);
        }
      } else {
        // Fallback: create temporary polySynth to play E-piano if not loaded yet
        if (!this.polySynth && this.filter) {
          this.polySynth = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'sine' },
            envelope: { attack: 0.005, decay: 1.5, sustain: 0.1, release: 0.4 }
          });
          this.polySynth.connect(this.filter);
        }
        if (this.polySynth) {
          try {
            this.polySynth.triggerAttack(freq, Tone.now(), vel);
          } catch (err) {
            console.warn('Error triggering fallback note:', err);
          }
        }
      }
    } else {
      if (this.polySynth) {
        try {
          this.polySynth.triggerAttack(freq, Tone.now(), vel);
        } catch (err) {
          console.warn('Error triggering Tone.js note on:', err);
        }
      }
    }
  }

  public triggerNoteOff(note: number) {
    if (this.currentParams.synthType === 'piano') {
      if (this.sampler && this.isPianoLoaded) {
        try {
          const noteName = Tone.Frequency(note, "midi").toNote();
          this.sampler.triggerRelease(noteName, Tone.now());
        } catch (err) {
          console.warn('Error releasing piano note:', err);
        }
      } else {
        if (this.polySynth) {
          const freq = this.midiToFreq(note);
          try {
            this.polySynth.triggerRelease(freq, Tone.now());
          } catch (err) {
            console.warn('Error releasing fallback note:', err);
          }
        }
      }
    } else {
      if (!this.polySynth) return;
      const freq = this.midiToFreq(note);
      try {
        this.polySynth.triggerRelease(freq, Tone.now());
      } catch (err) {
        console.warn('Error triggering Tone.js note off:', err);
      }
    }
  }

  public setMasterVolume(db: number) {
    if (Tone.Destination) {
      Tone.Destination.volume.rampTo(db, 0.05);
      this.currentParams.masterVolume = db;
    }
  }

  public stopAllNotes() {
    if (this.sampler) {
      this.sampler.releaseAll();
    }
    if (this.polySynth) {
      this.polySynth.releaseAll();
    }
  }

  public onPianoLoaded(cb: () => void) {
    this.onPianoLoadedCallback = cb;
    if (this.isPianoLoaded) {
      cb();
    }
  }

  public get pianoLoaded() {
    return this.isPianoLoaded;
  }

  // Returns Float32Array waveform data for oscilloscope rendering
  public getWaveformData(): Float32Array | null {
    if (!this.analyser) return null;
    return this.analyser.getValue() as Float32Array;
  }

  public get initialized() {
    return this.isInitialized;
  }
}

export const soundEngine = new SoundEngine();
export default soundEngine;
