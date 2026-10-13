/** Copy the pinned dependency assets using the README before running this example. */
import * as vision from './vendor/mediapipe/1.1.0/vision_bundle.mjs';
import { installCameraWorker } from '../../src/camera-worker.mjs';
installCameraWorker(vision);
