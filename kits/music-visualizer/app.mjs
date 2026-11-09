// Audio file → AnalyserNode → SDK features, beat pulse and frame. The SDK never opens audio itself.
import { MUSIC_REACTIVE_LOOKS, extractMusicReactiveFeatures, renderMusicReactiveFrame, smoothMusicReactiveFeatures } from '@optimai/creative-agents/music-reactive';
import { createBeatTracker } from '@optimai/creative-agents/beat-tracker';
import { createMotionPreference } from '@optimai/creative-agents/accessibility';

const $ = id => document.getElementById(id);
const canvas = $('stage'), ctx = canvas.getContext('2d'), player = $('player');
const motion = createMotionPreference(); // Follows the system setting; pass { preference: 'reduce' } for an in-app switch.
const TITLE = 'Your song', ARTIST = 'Made on this device';
let audio, analyser, bytes, tracker, features = null, last = 0, songUrl;

$('look').append(...MUSIC_REACTIVE_LOOKS.map(look => new Option(look.title, look.id)));
function connect() {
  if (audio) return;
  audio = new AudioContext();
  analyser = Object.assign(audio.createAnalyser(), { fftSize: 2048, smoothingTimeConstant: 0 }); // The SDK smooths over time itself.
  audio.createMediaElementSource(player).connect(analyser).connect(audio.destination);
  bytes = new Uint8Array(analyser.frequencyBinCount);
  tracker = createBeatTracker({ sampleRate: audio.sampleRate, fftSize: analyser.fftSize, reducedMotion: motion.matches });
}

function frame(now) {
  const playing = analyser && !player.paused;
  if (playing) {
    analyser.getByteFrequencyData(bytes);
    const target = extractMusicReactiveFeatures(bytes, { sampleRate: audio.sampleRate, fftSize: analyser.fftSize });
    features = smoothMusicReactiveFeatures(features, target, now - last);
  }
  const beat = playing ? tracker.push(bytes, player.currentTime * 1000) : null;
  last = now;
  renderMusicReactiveFrame(ctx, { width: canvas.width, height: canvas.height, look: $('look').value, intensity: .85, time: player.currentTime, ...(features ?? { energy: 0, bass: 0, treble: 0 }), pulse: beat?.pulse ?? 0, reducedMotion: motion.matches, title: TITLE, artist: ARTIST });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

$('song').addEventListener('change', () => {
  const file = $('song').files[0];
  if (!file) return;
  connect();
  if (songUrl) URL.revokeObjectURL(songUrl);
  songUrl = URL.createObjectURL(file); player.src = songUrl; features = null; tracker.reset();
  $('status').textContent = `${file.name} · press play`;
});
player.addEventListener('play', () => { void audio?.resume(); });
player.addEventListener('seeked', () => { features = null; tracker?.reset(); }); // The beat clock needs time that only moves forward.
motion.addEventListener('change', () => { if (tracker) tracker.reducedMotion = motion.matches; });
$('save').addEventListener('click', () => canvas.toBlob(blob => {
  if (!blob) return;
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'cover.png' });
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}, 'image/png'));
