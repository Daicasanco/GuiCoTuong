// js/audio.js
import { state } from './state.js';

const soundCache = {};
const soundFiles = {
    move: './sound/move.mp3',
    select: './sound/move.mp3',
    eat: './sound/eat.mp3',
    capture: './sound/eat.mp3',
    check: './sound/check.mp3',
    illegal: './sound/illegal.mp3'
};

function getAudio(name) {
    const key = soundFiles[name] ? name : 'move';
    if (!soundCache[key]) {
        const file = soundFiles[key];
        const audio = new Audio(file);
        audio.preload = 'auto';
        soundCache[key] = audio;
    }
    return soundCache[key];
}

export function playAudio(name) {
    if (state.appSettings && state.appSettings.sound === false) return;
    try {
        const audio = getAudio(name);
        if (audio) {
            audio.currentTime = 0;
            const promise = audio.play();
            if (promise !== undefined) {
                promise.catch(() => {
                    try {
                        const clone = audio.cloneNode();
                        clone.play().catch(() => {});
                    } catch (e) {}
                });
            }
        }
    } catch (e) {}
}

export function playMoveSound() {
    playAudio('move');
}

export function playCaptureSound() {
    playAudio('eat');
}

export function playCheckSound() {
    playAudio('check');
}

export function playSelectSound() {
    playAudio('select');
}

export function playIllegalSound() {
    playAudio('illegal');
}
