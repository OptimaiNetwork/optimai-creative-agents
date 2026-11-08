/** Vision worker for the playground. Copy the pinned MediaPipe assets with the interactive example's README first. */
import * as vision from '../interactive/vendor/mediapipe/1.1.0/vision_bundle.mjs';
import { installVisionWorker } from '../../src/vision-processor.mjs';
installVisionWorker(vision);
