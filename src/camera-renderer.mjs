import { coverCrop } from './camera-runtime.mjs';
export function drawCameraSource(ctx, source, sourceWidth, sourceHeight, width, height, mirror) {
    const crop = coverCrop(sourceWidth, sourceHeight, width, height);
    ctx.save();
    if (mirror) {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
    }
    ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height);
    ctx.restore();
}
export function drawCameraEffect(ctx, source, effect, strength, mirror, seconds) {
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    const amount = Math.max(0, Math.min(1, strength));
    ctx.filter = effect === 'film' ? `sepia(${amount * .35}) contrast(${1 + amount * .1}) saturate(${1 - amount * .25})` : effect === 'neon' ? `saturate(${1 + amount * 1.4}) contrast(${1 + amount * .18})` : effect === 'duotone' ? `grayscale(${amount}) contrast(${1 + amount * .1})` : 'none';
    drawCameraSource(ctx, source, source.width, source.height, width, height, mirror);
    ctx.filter = 'none';
    if (effect === 'prism') {
        ctx.globalAlpha = amount * .2;
        ctx.globalCompositeOperation = 'screen';
        ctx.save();
        ctx.translate(amount * 14, 0);
        drawCameraSource(ctx, source, source.width, source.height, width, height, mirror);
        ctx.restore();
        ctx.fillStyle = '#832aff';
        ctx.fillRect(0, 0, width / 2, height);
        ctx.fillStyle = '#16dcec';
        ctx.fillRect(width / 2, 0, width / 2, height);
    }
    if (effect === 'neon' || effect === 'duotone') {
        const gradient = ctx.createLinearGradient(0, height, width, 0);
        gradient.addColorStop(0, effect === 'neon' ? '#a228ff' : '#37365b');
        gradient.addColorStop(1, effect === 'neon' ? '#15f9c6' : '#eefe73');
        ctx.globalCompositeOperation = effect === 'duotone' ? 'color' : 'soft-light';
        ctx.globalAlpha = effect === 'duotone' ? amount : amount * .65;
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (effect === 'film') {
        const vignette = ctx.createRadialGradient(width / 2, height / 2, height / 5, width / 2, height / 2, width / 1.5);
        vignette.addColorStop(0, 'transparent');
        vignette.addColorStop(1, `rgba(0,0,0,${amount * .65})`);
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = amount * .14;
        for (let i = 0; i < 180; i += 1) {
            const phase = i * 127.1 + Math.floor(seconds * 12) * 31.7;
            ctx.fillStyle = i % 2 ? '#fff' : '#000';
            ctx.fillRect((Math.sin(phase) * .5 + .5) * width, (Math.cos(phase * 1.7) * .5 + .5) * height, 2, 2);
        }
    }
    ctx.restore();
}
export function drawFaceHalo(ctx, frame, mirror, seconds, strength) {
    if (!frame?.found || frame.anchors.length < 2)
        return;
    const w = ctx.canvas.width, h = ctx.canvas.height, left = frame.anchors[0], right = frame.anchors[1];
    const x = ((left.x + right.x) / 2) * w, y = ((left.y + right.y) / 2) * h;
    const radius = Math.hypot((left.x - right.x) * w, (left.y - right.y) * h) * 1.8;
    ctx.save();
    ctx.translate(mirror ? w - x : x, y - radius * .8);
    ctx.globalAlpha = strength;
    ctx.strokeStyle = '#d3ff89';
    ctx.shadowColor = '#9cfcc1';
    ctx.shadowBlur = 15;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius, radius * .24, -.15, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i += 1) {
        const angle = i * Math.PI / 4 + seconds * .4;
        ctx.fillStyle = i % 2 ? '#d8c3ff' : '#e6ffb3';
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * radius * 1.15, Math.sin(angle) * radius * .38, i % 2 ? 2 : 3.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}
/** Original procedural characters, with no downloaded likeness or face texture. */
export function createCameraAvatar(canvas, look, { THREE }) {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(960, 540, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#101216');
    const camera = new THREE.PerspectiveCamera(32, 16 / 9, .1, 100);
    camera.position.set(0, .45, 6.5);
    camera.lookAt(0, .1, 0);
    scene.add(new THREE.HemisphereLight('#e7fff5', '#24202d', 2.5));
    const key = new THREE.DirectionalLight('#e9ffc2', 4);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#a299ff', 3);
    rim.position.set(4, 1, -2);
    scene.add(rim);
    const colors = look === 'luna' ? { skin: '#c9afe9', suit: '#55536d', detail: '#e9fca8' } : look === 'pixel' ? { skin: '#ffc381', suit: '#504141', detail: '#afeeff' } : { skin: '#bdf887', suit: '#31483e', detail: '#dacbff' };
    const material = (color, metalness = 0) => new THREE.MeshStandardMaterial({ color, metalness, roughness: .45 });
    const skin = material(colors.skin, .18), dark = material('#171a21'), suit = material(colors.suit), detail = material(colors.detail, .4), white = material('#f5f6ed');
    const head = new THREE.Group();
    head.position.y = .3;
    scene.add(head);
    const mesh = (geometry, mat, x = 0, y = 0, z = 0, parent = head) => { const item = new THREE.Mesh(geometry, mat); item.position.set(x, y, z); parent.add(item); return item; };
    const headMesh = mesh(look === 'pixel' ? new THREE.BoxGeometry(1.55, 1.65, 1.05) : new THREE.SphereGeometry(1, 48, 40), skin);
    if (look !== 'pixel')
        headMesh.scale.set(.87, 1, .75);
    const eyeGeometry = new THREE.SphereGeometry(.2, 24, 20);
    const leftEye = mesh(eyeGeometry, white, -.34, .17, .67), rightEye = mesh(eyeGeometry, white, .34, .17, .67);
    const leftPupil = mesh(new THREE.SphereGeometry(.095, 20, 16), dark, -.34, .17, .84), rightPupil = mesh(new THREE.SphereGeometry(.095, 20, 16), dark, .34, .17, .84);
    const mouth = mesh(new THREE.SphereGeometry(.24, 28, 20), dark, 0, -.4, .69);
    mouth.scale.set(1.4, .2, .2);
    const leftBrow = mesh(new THREE.BoxGeometry(.35, .065, .08), dark, -.34, .5, .76), rightBrow = mesh(new THREE.BoxGeometry(.35, .065, .08), dark, .34, .5, .76);
    mesh(new THREE.SphereGeometry(.11, 16, 12), skin, 0, -.05, .84);
    if (look === 'luna') {
        for (const side of [-1, 1]) {
            const ear = mesh(new THREE.ConeGeometry(.3, .65, 3), skin, side * .63, .96);
            ear.rotation.z = side * -.23;
            mesh(new THREE.SphereGeometry(.09, 16, 12), detail, side * .56, -.23, .58);
        }
    }
    else if (look === 'orbit') {
        for (const side of [-1, 1]) {
            const ear = mesh(new THREE.CylinderGeometry(.22, .22, .18, 32), detail, side * .9, .02);
            ear.rotation.z = Math.PI / 2;
        }
        mesh(new THREE.CylinderGeometry(.035, .035, .4, 12), dark, .43, 1.02);
        mesh(new THREE.SphereGeometry(.11, 20, 16), detail, .43, 1.24);
    }
    else {
        mesh(new THREE.BoxGeometry(.5, .13, .17), detail, 0, .98);
        for (const side of [-1, 1])
            mesh(new THREE.BoxGeometry(.22, .35, .25), detail, side * .88, .1);
    }
    const torso = mesh(new THREE.SphereGeometry(.9, 40, 32), suit, 0, -1.18, 0, scene);
    torso.scale.set(1.15, .75, .65);
    mesh(new THREE.TorusGeometry(.18, .03, 12, 32), detail, 0, -.85, .54, scene);
    const floor = mesh(new THREE.CircleGeometry(3.5, 64), material('#20262a'), 0, -1.77, 0, scene);
    floor.rotation.x = -Math.PI / 2;
    const ring = mesh(new THREE.TorusGeometry(1.65, .014, 8, 100), detail, 0, -1.75, 0, scene);
    ring.rotation.x = -Math.PI / 2;
    let disposed = false;
    return {
        render(rig) {
            if (disposed)
                return;
            head.rotation.set(rig.pitch, rig.yaw, rig.roll);
            for (const [eye, pupil, blink] of [[leftEye, leftPupil, rig.blinkLeft], [rightEye, rightPupil, rig.blinkRight]]) {
                eye.scale.y = Math.max(.08, 1 - blink);
                pupil.scale.y = Math.max(.04, 1 - blink);
            }
            mouth.scale.y = .16 + rig.jaw * 1.25;
            mouth.scale.x = 1.25 + rig.smile * .65;
            mouth.position.y = -.4 + rig.smile * .05;
            leftBrow.position.y = rightBrow.position.y = .5 + rig.brow * .16;
            leftBrow.rotation.z = rig.smile * -.15;
            rightBrow.rotation.z = rig.smile * .15;
            renderer.render(scene, camera);
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            const geometries = new Set(), materials = new Set();
            scene.traverse(object => { if (object instanceof THREE.Mesh) {
                geometries.add(object.geometry);
                for (const mat of Array.isArray(object.material) ? object.material : [object.material])
                    materials.add(mat);
            } });
            geometries.forEach(geometry => geometry.dispose());
            materials.forEach(mat => mat.dispose());
            renderer.dispose();
            renderer.forceContextLoss();
        },
    };
}
