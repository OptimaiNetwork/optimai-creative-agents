import { clean3DModelName, validateAgentGLB, validateScene3DSettings } from './scene-3d.mjs';

/** Optional Three.js peer modules load only after the host opens a 3D workspace. */
export async function loadScene3DRuntime() {
    try {
        const [THREE, controls, loader, environment] = await Promise.all([
            import('three'), import('three/addons/controls/OrbitControls.js'),
            import('three/addons/loaders/GLTFLoader.js'), import('three/addons/environments/RoomEnvironment.js'),
        ]);
        return { THREE, OrbitControls: controls.OrbitControls, GLTFLoader: loader.GLTFLoader, RoomEnvironment: environment.RoomEnvironment };
    } catch (cause) { throw new Error('Install the optional three@0.186.1 peer, or provide a reviewed Three.js runtime.', { cause }); }
}
/** Create a browser stage with the optional peer or host-supplied runtime. No provider calls. */
export async function createScene3DStage(container, initial, { runtime, onError = () => {}, signal } = {}) {
    initial = validateScene3DSettings(initial);
    if (signal?.aborted) throw new DOMException('3D stage creation was cancelled.', 'AbortError');
    const resolved = runtime ?? await loadScene3DRuntime();
    if (signal?.aborted) throw new DOMException('3D stage creation was cancelled.', 'AbortError');
    const controller = createScene3DStageWithRuntime(container, initial, onError, resolved);
    if (signal) {
        const dispose = controller.dispose;
        const abort = () => controller.dispose();
        signal.addEventListener('abort', abort, { once: true });
        controller.dispose = () => { signal.removeEventListener('abort', abort); dispose(); };
        if (signal.aborted) { controller.dispose(); throw new DOMException('3D stage creation was cancelled.', 'AbortError'); }
    }
    return controller;
}
/** Release shared resources exactly once, including ImageBitmaps from GLTFLoader. */
export function disposeAgent3DObjects(objects) {
    const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set(), images = new Set();
    objects.forEach(object => object.traverse(child => {
        const mesh = child;
        if (mesh.geometry)
            geometries.add(mesh.geometry);
        if (mesh.material)
            (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => materials.add(material));
        if (child.skeleton)
            skeletons.add(child.skeleton);
    }));
    materials.forEach(material => Object.values(material).forEach(value => { if (value?.isTexture === true)
        textures.add(value); }));
    textures.forEach(texture => { if (texture.image && typeof texture.image === 'object')
        images.add(texture.image); texture.dispose(); });
    images.forEach(image => { if (typeof image.close === 'function')
        image.close(); });
    skeletons.forEach(skeleton => skeleton.dispose());
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
}
function proceduralDemo(kind, THREE) {
    const group = new THREE.Group();
    group.name = { sculpture: 'Orbit sculpture', product: 'Arc headphones', architecture: 'Courtyard pavilion' }[kind];
    function add(geometry, color, position, options = {}) {
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .28, metalness: .15, ...options }));
        mesh.position.set(...position);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
    }
    if (kind === 'sculpture') {
        const knot = add(new THREE.TorusKnotGeometry(.83, .24, 160, 24), '#c8ed91', [0, 1.5, 0], { metalness: .6, roughness: .22 });
        knot.rotation.x = .25;
        add(new THREE.CylinderGeometry(.75, .82, .24, 64), '#34383a', [0, .12, 0], { metalness: .6 });
        add(new THREE.CylinderGeometry(.36, .45, .65, 48), '#74787a', [0, .53, 0], { metalness: .8 });
        add(new THREE.SphereGeometry(.23, 32, 24), '#eaddb4', [1.35, .25, .5], { metalness: .8 });
    }
    else if (kind === 'product') {
        const arc = add(new THREE.TorusGeometry(.95, .14, 20, 80, Math.PI), '#b4c899', [0, 1.2, 0], { metalness: .6 });
        arc.rotation.z = 0;
        for (const x of [-.95, .95]) {
            const ear = add(new THREE.CylinderGeometry(.46, .46, .28, 48), '#2c3031', [x, 1.08, 0], { metalness: .35 });
            ear.rotation.z = Math.PI / 2;
            const plate = add(new THREE.CylinderGeometry(.35, .35, .04, 48), '#c8ed91', [x + Math.sign(x) * .16, 1.08, 0], { metalness: .7 });
            plate.rotation.z = Math.PI / 2;
            add(new THREE.BoxGeometry(.12, .65, .15), '#8c9690', [x, 1.48, 0], { metalness: .85 });
        }
        add(new THREE.CylinderGeometry(1.45, 1.5, .1, 64), '#323638', [0, .05, 0]);
    }
    else {
        add(new THREE.BoxGeometry(3.6, .18, 2.6), '#a8a398', [0, .09, 0], { roughness: .8, metalness: 0 });
        add(new THREE.BoxGeometry(3.8, .15, 2.8), '#dfddd4', [0, 2.05, 0], { roughness: .65, metalness: 0 });
        for (const x of [-1.5, 1.5])
            for (const z of [-1, 1])
                add(new THREE.BoxGeometry(.16, 1.8, .16), '#b0ad9f', [x, 1.05, z], { roughness: .7, metalness: 0 });
        add(new THREE.BoxGeometry(1.05, 1.35, .12), '#777361', [-.9, .85, -.95], { roughness: .7, metalness: 0 });
        add(new THREE.BoxGeometry(.75, .32, .65), '#303736', [.75, .32, .15], { roughness: .8, metalness: 0 });
        add(new THREE.SphereGeometry(.44, 32, 24), '#b6c88c', [.75, .78, .15], { roughness: .85, metalness: 0 });
        add(new THREE.BoxGeometry(1.25, .2, .55), '#b78756', [-.7, .38, .55], { roughness: .6, metalness: 0 });
    }
    return group;
}
export function createScene3DStageWithRuntime(container, initial, onError = () => {}, runtime) {
    initial = validateScene3DSettings(initial);
    if (!container || typeof container.appendChild !== 'function' || !Number.isFinite(container.clientWidth) || !Number.isFinite(container.clientHeight)) throw new Error('Provide a mounted HTML container for the 3D scene.');
    const { THREE, OrbitControls, GLTFLoader, RoomEnvironment } = runtime ?? {};
    if (!THREE?.WebGLRenderer || !OrbitControls || !GLTFLoader || !RoomEnvironment) throw new Error('Pass a reviewed Three.js runtime or call createScene3DStage().');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default', preserveDrawingBuffer: false });
    const initializationCleanup = [() => { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); }];
    try {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.domElement.tabIndex = 0;
        if (renderer.domElement.style) Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
        renderer.domElement.setAttribute('aria-label', 'Interactive 3D scene. Drag to orbit; use two fingers to zoom and pan. Camera presets and zoom buttons are available below.');
        container.appendChild(renderer.domElement);
        const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .05, 100), controls = new OrbitControls(camera, renderer.domElement);
        initializationCleanup.push(() => disposeAgent3DObjects([scene]), () => { controls.stopListenToKeyEvents(); controls.dispose(); });
        controls.enableDamping = false;
        controls.autoRotateSpeed = 1;
        controls.minDistance = 1.5;
        controls.maxDistance = 24;
        controls.maxPolarAngle = Math.PI * .93;
        controls.listenToKeyEvents(renderer.domElement);
        const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
        let environment;
        try {
            environment = pmrem.fromScene(room, .04);
        }
        finally {
            disposeAgent3DObjects([room]);
            pmrem.dispose();
        }
        initializationCleanup.push(() => environment.dispose());
        scene.environment = environment.texture;
        const ambient = new THREE.HemisphereLight('#f7f8f2', '#333b43', 1.8), key = new THREE.DirectionalLight('#ffffff', 4), fill = new THREE.DirectionalLight('#cddcff', 1.5), rim = new THREE.DirectionalLight('#dafbb7', 2);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.camera.left = -5;
        key.shadow.camera.right = 5;
        key.shadow.camera.top = 5;
        key.shadow.camera.bottom = -5;
        key.shadow.normalBias = .035;
        fill.position.set(-4, 3, 2);
        rim.position.set(2, 4, -4);
        scene.add(ambient, key, fill, rim);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: initial.background, roughness: .9, metalness: 0 }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -.015;
        floor.receiveShadow = true;
        scene.add(floor);
        const grid = new THREE.GridHelper(12, 24, '#666962', '#333735');
        grid.position.y = -.005;
        scene.add(grid);
        let object = proceduralDemo(initial.demo, THREE);
        scene.add(object);
        let settings = { ...initial }, disposed = false, importEpoch = 0, frame = 0, lastTime = 0, visible = !document.hidden, intersecting = true, lost = false, animating = false;
        let cameraPreset = 'isometric';
        const originalMaterials = new Map(), overrideMaterials = new Set();
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        const render = () => { if (!disposed && !lost && visible && intersecting)
            renderer.render(scene, camera); };
        function cancelFrame() { if (frame)
            cancelAnimationFrame(frame); frame = 0; lastTime = 0; }
        function animate(time) {
            frame = 0;
            if (disposed || lost || !visible || !intersecting || !settings.rotating || reduced.matches)
                return;
            const delta = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0;
            lastTime = time;
            animating = true;
            controls.autoRotate = true;
            controls.update(delta);
            animating = false;
            render();
            frame = requestAnimationFrame(animate);
        }
        function motion() { cancelFrame(); controls.autoRotate = false; if (!disposed && !lost && visible && intersecting && settings.rotating && !reduced.matches)
            frame = requestAnimationFrame(animate); render(); }
        function resize() { if (disposed)
            return; const sourceWidth = Math.max(1, container.clientWidth), sourceHeight = Math.max(1, container.clientHeight), scale = Math.min(1, 1600 / sourceWidth, 1200 / sourceHeight), width = Math.max(1, Math.round(sourceWidth * scale)), height = Math.max(1, Math.round(sourceHeight * scale)); renderer.setSize(width, height, false); camera.aspect = sourceWidth / sourceHeight; camera.updateProjectionMatrix(); render(); }
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
        observer?.observe(container);
        if (!observer)
            window.addEventListener('resize', resize);
        initializationCleanup.push(() => { observer?.disconnect(); if (!observer)
            window.removeEventListener('resize', resize); });
        const intersection = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => { intersecting = entries[0]?.isIntersecting ?? true; motion(); }) : null;
        intersection?.observe(container);
        initializationCleanup.push(() => intersection?.disconnect());
        const visibility = () => { visible = !document.hidden; motion(); };
        document.addEventListener('visibilitychange', visibility);
        reduced.addEventListener('change', motion);
        initializationCleanup.push(() => { document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', motion); });
        const contextLost = (event) => { event.preventDefault(); lost = true; cancelFrame(); onError('The 3D graphics context paused. Close and reopen this workspace to restore it.'); };
        const cameraChanged = () => { if (!animating)
            render(); };
        renderer.domElement.addEventListener('webglcontextlost', contextLost);
        controls.addEventListener('change', cameraChanged);
        initializationCleanup.push(() => { cancelFrame(); renderer.domElement.removeEventListener('webglcontextlost', contextLost); controls.removeEventListener('change', cameraChanged); });
        function restoreMaterials() { originalMaterials.forEach((material, mesh) => { mesh.material = material; }); originalMaterials.clear(); overrideMaterials.forEach(material => material.dispose()); overrideMaterials.clear(); }
        function applyMaterials() {
            restoreMaterials();
            if (settings.material === 'original')
                return;
            const material = new THREE.MeshStandardMaterial({ color: settings.color, metalness: settings.material === 'metal' ? .9 : 0, roughness: settings.material === 'metal' ? .22 : settings.material === 'clay' ? .88 : .3 });
            overrideMaterials.add(material);
            object.traverse(child => { const mesh = child; if (mesh.isMesh) {
                originalMaterials.set(mesh, mesh.material);
                mesh.material = material;
            } });
        }
        function applyLighting() {
            scene.background = new THREE.Color(settings.background);
            floor.material.color.set(settings.background);
            grid.visible = settings.grid;
            renderer.toneMappingExposure = settings.exposure;
            camera.setFocalLength(settings.focalLength);
            camera.updateProjectionMatrix();
            const angle = THREE.MathUtils.degToRad(settings.lightAngle);
            key.position.set(Math.sin(angle) * 5, 6, Math.cos(angle) * 5);
            key.color.set(settings.lighting === 'sunset' ? '#ffc486' : settings.lighting === 'neon' ? '#bd8dff' : '#fff5df');
            fill.color.set(settings.lighting === 'neon' ? '#63edfa' : '#cddcff');
            rim.color.set(settings.lighting === 'neon' ? '#ec9cfa' : '#dafbb7');
            ambient.intensity = settings.lighting === 'neon' ? .8 : 1.8;
            scene.environmentIntensity = settings.lighting === 'neon' ? .3 : .8;
        }
        function placeCamera(preset) {
            cameraPreset = preset;
            const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere()), radius = Math.max(sphere.radius, .3), aspect = Math.max(camera.aspect, .25);
            const distance = radius / Math.sin(Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(aspect, 1))) * 1.18;
            const direction = new THREE.Vector3(...{ isometric: [1.1, .65, 1.4], front: [0, .12, 1], side: [1, .12, 0], top: [0, 1, .001] }[preset]).normalize();
            camera.position.copy(sphere.center).addScaledVector(direction, distance);
            controls.target.copy(sphere.center);
            controls.minDistance = radius * 1.15;
            controls.maxDistance = distance * 5;
            camera.near = Math.max(.01, radius / 100);
            camera.far = distance * 15;
            camera.updateProjectionMatrix();
            controls.autoRotate = false;
            controls.update();
            controls.saveState();
            render();
        }
        function replace(next) {
            const box = new THREE.Box3().setFromObject(next), size = box.getSize(new THREE.Vector3()), longest = Math.max(size.x, size.y, size.z);
            if (!Number.isFinite(longest) || longest < 1e-6) {
                disposeAgent3DObjects([next]);
                throw new Error('This model has no usable visible geometry. Your previous scene is unchanged.');
            }
            restoreMaterials();
            scene.remove(object);
            disposeAgent3DObjects([object]);
            object = next;
            object.scale.multiplyScalar(3 / longest);
            const resized = new THREE.Box3().setFromObject(object), center = resized.getCenter(new THREE.Vector3());
            object.position.x -= center.x;
            object.position.z -= center.z;
            object.position.y -= resized.min.y;
            object.traverse(child => { const mesh = child; if (mesh.isMesh) {
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            } });
            scene.add(object);
            applyMaterials();
            placeCamera('isometric');
        }
        resize();
        applyLighting();
        placeCamera('isometric');
        motion();
        const controller = {
            update(next) { if (disposed)
                return; next = validateScene3DSettings(next); const materialChanged = next.material !== settings.material || next.color !== settings.color; settings = { ...next }; if (materialChanged)
                applyMaterials(); applyLighting(); motion(); },
            demo(kind) { if (disposed)
                return; if (!['sculpture', 'product', 'architecture'].includes(kind)) throw new Error('Choose a supported scene demo.'); importEpoch++; settings.demo = kind; replace(proceduralDemo(kind, THREE)); },
            camera(preset) { if (!disposed) {
                if (!['isometric', 'front', 'side', 'top'].includes(preset)) throw new Error('Choose a supported camera view.'); placeCamera(preset); } },
            fit() { if (!disposed)
                placeCamera(cameraPreset); },
            zoom(direction) { if (disposed)
                return; if (!['in', 'out'].includes(direction)) throw new Error('Choose zoom in or out.'); const vector = camera.position.clone().sub(controls.target), distance = THREE.MathUtils.clamp(vector.length() * (direction === 'in' ? .8 : 1.25), controls.minDistance, controls.maxDistance); camera.position.copy(controls.target).add(vector.setLength(distance)); controls.update(); render(); },
            async importGLB(bytes, filename) {
                if (disposed)
                    throw new Error('This 3D workspace is closed.');
                const inspected = validateAgentGLB(bytes), epoch = ++importEpoch, urls = new Set();
                const manager = new THREE.LoadingManager();
                manager.setURLModifier(url => { if (!url.startsWith('blob:'))
                    throw new Error('External model resources are not loaded.'); urls.add(url); return url; });
                try {
                    const imported = await new GLTFLoader(manager).parseAsync(inspected.bytes, '');
                    if (disposed || epoch !== importEpoch) {
                        disposeAgent3DObjects(imported.scenes);
                        throw new Error('This model import was cancelled.');
                    }
                    imported.scene.name = clean3DModelName(filename);
                    replace(imported.scene);
                    return { name: object.name, vertices: inspected.vertices };
                }
                finally {
                    urls.forEach(url => URL.revokeObjectURL(url));
                }
            },
            png() {
                if (disposed || lost)
                    return Promise.reject(new Error('The 3D preview is unavailable. Reopen this workspace and try again.'));
                // Explicit rendering immediately before readback avoids preserveDrawingBuffer and its continuous memory cost.
                renderer.render(scene, camera);
                return new Promise((resolve, reject) => renderer.domElement.toBlob(blob => { if (disposed)
                    reject(new Error('This export was cancelled.'));
                else if (blob)
                    resolve(blob);
                else
                    reject(new Error('This browser could not export the scene.')); }, 'image/png'));
            },
            configuration() { return { version: 1, kind: 'optimai-3d-scene', model: object.name, settings: { ...settings }, camera: { position: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov }, note: 'Imported model geometry is not included. Keep the original GLB alongside this scene recipe.' }; },
            dispose() {
                if (disposed)
                    return;
                disposed = true;
                importEpoch++;
                cancelFrame();
                observer?.disconnect();
                intersection?.disconnect();
                if (!observer)
                    window.removeEventListener('resize', resize);
                document.removeEventListener('visibilitychange', visibility);
                reduced.removeEventListener('change', motion);
                renderer.domElement.removeEventListener('webglcontextlost', contextLost);
                controls.removeEventListener('change', cameraChanged);
                controls.stopListenToKeyEvents();
                controls.dispose();
                restoreMaterials();
                disposeAgent3DObjects([scene]);
                environment.dispose();
                key.shadow.map?.dispose();
                renderer.dispose();
                renderer.forceContextLoss();
                renderer.domElement.remove();
            },
        };
        initializationCleanup.length = 0;
        return controller;
    }
    catch (cause) {
        initializationCleanup.reverse().forEach(dispose => { try {
            dispose();
        }
        catch { /* Complete cleanup even after a partially initialized graphics context. */ } });
        throw cause;
    }
}
