// The optional peers, stubbed for `npm run typecheck`. The gate checks the
// SDK's own declarations and must pass with no peer installed, so each stub
// names only what the declarations use, as `any`. A host that installs a peer
// gets that peer's real types instead of these.
declare module '@mlc-ai/web-llm' {
  export type AppConfig = any;
  export type MLCEngineConfig = any;
  export type MLCEngineInterface = any;
}
declare module '@mediapipe/tasks-vision' {
  export const FilesetResolver: any;
}
declare module 'three' {
  export type Object3D = any;
  export const Object3D: any;
  export const Scene: any;
}
declare module 'three/addons/controls/OrbitControls.js' { export const OrbitControls: any; }
declare module 'three/addons/loaders/GLTFLoader.js' { export const GLTFLoader: any; }
declare module 'three/addons/environments/RoomEnvironment.js' { export const RoomEnvironment: any; }
