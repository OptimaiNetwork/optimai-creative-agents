/** Browser-local scene settings and bounded GLB validation. No requests or provider calls. */
export const AGENT_3D_LIMITS = Object.freeze({ bytes: 20 * 1048576, jsonBytes: 2 * 1048576, nodes: 256, primitives: 128, vertices: 300000, accessorElements: 1200000, images: 8, imageSide: 4096, imagePixels: 16000000 });
export const SCENE_3D_LIMITS = AGENT_3D_LIMITS;
export function defaultAgent3DSettings(agentId) {
    return { demo: agentId === 'scene-lighting' ? 'architecture' : 'sculpture', lighting: 'studio', material: 'original', color: '#c8ed91', background: '#151719', exposure: 1.2, lightAngle: 35, focalLength: 50, rotating: false, grid: false };
}
export const defaultScene3DSettings = defaultAgent3DSettings;
/** Validate public runtime inputs before any camera/material/GPU allocation. */
export function validateScene3DSettings(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Pass plain scene settings.');
    const choices = { demo: ['sculpture', 'product', 'architecture'], lighting: ['studio', 'sunset', 'neon'], material: ['original', 'ceramic', 'metal', 'clay'] };
    const keys = ['demo', 'lighting', 'material', 'color', 'background', 'exposure', 'lightAngle', 'focalLength', 'rotating', 'grid'];
    const clean = {};
    if (Reflect.ownKeys(value).length !== keys.length) throw new Error('Pass exactly the supported scene settings.');
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error('Scene settings cannot contain accessors or hidden values.');
        clean[key] = descriptor.value;
    }
    for (const [key, allowed] of Object.entries(choices)) if (!allowed.includes(clean[key])) throw new Error(`Choose a supported scene ${key}.`);
    for (const key of ['color', 'background']) if (typeof clean[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(clean[key])) throw new Error('Scene colors must use six-digit hex values.');
    for (const [key, min, max] of [['exposure', .25, 2.2], ['lightAngle', -180, 180], ['focalLength', 24, 100]]) if (typeof clean[key] !== 'number' || !Number.isFinite(clean[key]) || clean[key] < min || clean[key] > max) throw new Error(`Scene ${key} must be between ${min} and ${max}.`);
    for (const key of ['rotating', 'grid']) if (typeof clean[key] !== 'boolean') throw new Error(`Scene ${key} must be a boolean.`);
    return clean;
}
/** Map portable recipe fields to camera, lighting and material controls without host dependencies. */
export function scene3DRecipeSettings(agentId, values = {}) {
    if (!['model-turntable', 'scene-lighting'].includes(agentId)) throw new Error('Choose a reviewed 3D scene agent.');
    if (!values || typeof values !== 'object' || Array.isArray(values) || ![Object.prototype, null].includes(Object.getPrototypeOf(values))) throw new Error('Pass plain 3D recipe values.');
    const safe = {};
    for (const key of Reflect.ownKeys(values)) {
        if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsupported 3D recipe key.');
        const descriptor = Object.getOwnPropertyDescriptor(values, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || !['string', 'number'].includes(typeof descriptor.value)) throw new Error('3D recipes only accept plain strings and numbers.');
        safe[key] = descriptor.value;
    }
    const settings = defaultAgent3DSettings(agentId);
    if (safe.demo !== undefined) settings.demo = safe.demo;
    if (safe.lighting !== undefined) settings.lighting = safe.lighting;
    if (safe.finish !== undefined) settings.material = safe.finish;
    else if (['original', 'ceramic', 'metal', 'clay'].includes(safe.material)) settings.material = safe.material;
    if (safe.focalLength !== undefined) settings.focalLength = safe.focalLength;
    if (safe.exposure !== undefined) {
        if (typeof safe.exposure !== 'number' || !Number.isFinite(safe.exposure) || safe.exposure < 25 || safe.exposure > 200) throw new Error('Recipe exposure must be between 25 and 200 percent.');
        settings.exposure = safe.exposure / 100;
    }
    if (safe.color !== undefined) settings.color = safe.color;
    if (safe.background !== undefined) settings.background = safe.background;
    const camera = { iso: 'isometric', isometric: 'isometric', front: 'front', side: 'side', top: 'top' }[safe.view ?? 'iso'];
    if (!camera) throw new Error('Choose a supported 3D recipe camera view.');
    return { settings: validateScene3DSettings(settings), camera };
}
export function clean3DModelName(name) { return name.replace(/\.glb$/i, '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'Imported model'; }
export function scene3DPrompt(settings, modelName, direction, mode) {
    settings = validateScene3DSettings(settings);
    if (!['image', 'video'].includes(mode) || typeof modelName !== 'string' || typeof direction !== 'string') throw new Error('Pass a scene subject, creative direction and image or video mode.');
    const light = { studio: 'soft studio key light with a clean fill and subtle rim light', sunset: 'warm sunset key light with cool ambient shadows', neon: 'cinematic violet and cyan accent lighting' }[settings.lighting];
    return `${mode === 'video' ? 'Create a cinematic shot' : 'Create a polished image'} using the supplied 3D scene reference for composition, perspective and silhouette. Subject: ${clean3DModelName(modelName)}. Preserve its proportions. Lighting: ${light}. ${settings.material === 'original' ? 'Preserve the reference materials.' : `Use ${settings.material} material in ${settings.color}.`} Background: ${settings.background}. ${direction.trim().slice(0, 2000) || (mode === 'video' ? 'A slow, smooth camera orbit with a stable subject.' : 'Refine the surface details while preserving this framing.')}`;
}
function record(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid ${name} in this GLB.`); return value; }
function array(value, name, limit) { if (value === undefined)
    return []; if (!Array.isArray(value) || value.length > limit)
    throw new Error(`This GLB has too many or invalid ${name}.`); return value; }
function integer(value, name, max, min = 0) { if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Invalid or oversized ${name} in this GLB.`); return value; }
function reference(value, name, list) { return integer(value, name, list.length - 1); }
const ALLOWED_EXTENSIONS = new Set(['KHR_materials_unlit', 'KHR_materials_clearcoat', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_emissive_strength', 'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_dispersion', 'KHR_texture_transform', 'KHR_mesh_quantization']);
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
function inspectTree(value, depth = 0, budget = { nodes: 0 }) {
    if (depth > 24 || ++budget.nodes > 100000)
        throw new Error('This GLB contains excessively complex metadata.');
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e9))
        throw new Error('This GLB contains invalid numeric values.');
    if (!value || typeof value !== 'object')
        return;
    for (const [key, child] of Object.entries(value)) {
        if (/^(uri|url)$/i.test(key) && child !== undefined)
            throw new Error('Use a self-contained GLB with embedded textures. External and data URLs are not imported.');
        if (key === 'extensions' && child && typeof child === 'object')
            for (const extension of Object.keys(child))
                if (!ALLOWED_EXTENSIONS.has(extension))
                    throw new Error(`Export an uncompressed static GLB without ${extension}.`);
        inspectTree(child, depth + 1, budget);
    }
}
/** Read dimensions before a browser decoder allocates a texture. */
function imageDimensions(bytes, mime) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (mime === 'image/png' && bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452)
        return [view.getUint32(16), view.getUint32(20)];
    if (mime === 'image/jpeg' && bytes.length > 4 && view.getUint16(0) === 0xffd8) {
        let offset = 2;
        while (offset + 4 <= bytes.length) {
            if (bytes[offset] !== 0xff)
                break;
            while (bytes[offset] === 0xff)
                offset++;
            const marker = bytes[offset++];
            if (marker === 0xd9 || marker === 0xda)
                break;
            if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7)
                continue;
            if (offset + 2 > bytes.length)
                break;
            const length = view.getUint16(offset);
            if (length < 2 || offset + length > bytes.length)
                break;
            if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8)
                return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
            offset += length;
        }
    }
    throw new Error('This GLB has an unsupported or malformed texture. Embed PNG or JPEG textures.');
}
/** Validate the original container before GLTFLoader can allocate geometry or fetch resources. */
export function validateAgentGLB(bytes) {
    if (bytes.byteLength < 20 || bytes.byteLength > AGENT_3D_LIMITS.bytes)
        throw new Error('Choose a self-contained GLB up to 20 MB.');
    const view = new DataView(bytes);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength)
        throw new Error('Choose a valid glTF 2.0 binary (.glb) file.');
    let offset = 12, json, binary;
    while (offset < bytes.byteLength) {
        if (offset + 8 > bytes.byteLength)
            throw new Error('This GLB is truncated.');
        const length = view.getUint32(offset, true), kind = view.getUint32(offset + 4, true);
        offset += 8;
        if (length % 4 || offset + length > bytes.byteLength)
            throw new Error('This GLB has an invalid chunk length.');
        if (kind === 0x4e4f534a && !json && offset === 20 && length <= AGENT_3D_LIMITS.jsonBytes) {
            try {
                json = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes, offset, length))), 'document');
            }
            catch {
                throw new Error('This GLB has invalid or oversized scene metadata.');
            }
        }
        else if (kind === 0x004e4942 && json && !binary)
            binary = new Uint8Array(bytes, offset, length);
        else
            throw new Error('This GLB contains unsupported or repeated chunks.');
        offset += length;
    }
    if (!json || !binary)
        throw new Error('This GLB must include its scene and geometry in one file.');
    const asset = record(json.asset, 'asset');
    if (asset.version !== '2.0')
        throw new Error('Export the model as glTF 2.0 binary.');
    inspectTree(json);
    for (const key of ['extensionsRequired', 'extensionsUsed'])
        for (const extension of array(json[key], key, 20))
            if (typeof extension !== 'string' || !ALLOWED_EXTENSIONS.has(extension))
                throw new Error(`Export an uncompressed static GLB without ${String(extension)}.`);
    const buffers = array(json.buffers, 'buffers', 1);
    if (buffers.length !== 1)
        throw new Error('This GLB must contain one embedded geometry buffer.');
    const bufferLength = integer(record(buffers[0], 'buffer').byteLength, 'buffer length', binary.byteLength, 1);
    if (binary.byteLength - bufferLength > 3)
        throw new Error('This GLB has an invalid buffer size.');
    const views = array(json.bufferViews, 'buffer views', 1024).map(value => {
        const item = record(value, 'buffer view');
        if (item.buffer !== 0)
            throw new Error('This GLB has an invalid buffer reference.');
        const start = integer(item.byteOffset ?? 0, 'buffer offset', bufferLength), length = integer(item.byteLength, 'buffer view length', bufferLength, 1);
        if (start + length > bufferLength)
            throw new Error('This GLB references geometry outside its buffer.');
        const stride = item.byteStride === undefined ? undefined : integer(item.byteStride, 'vertex stride', 252, 4);
        if (stride && stride % 4)
            throw new Error('This GLB has an invalid vertex stride.');
        return { start, length, stride };
    });
    let elements = 0;
    const accessors = array(json.accessors, 'accessors', 1024).map(value => {
        const item = record(value, 'accessor');
        if (item.sparse !== undefined)
            throw new Error('Export this model with regular, non-sparse geometry.');
        const count = integer(item.count, 'geometry count', 900000, 1), component = COMPONENT_BYTES[Number(item.componentType)], width = TYPE_COMPONENTS[String(item.type)];
        if (!component || !width)
            throw new Error('This GLB has unsupported geometry attributes.');
        const source = views[reference(item.bufferView, 'accessor buffer', views)], start = integer(item.byteOffset ?? 0, 'accessor offset', source.length), stride = source.stride ?? component * width;
        // Matrix packing is intentionally not supported by this static preview importer.
        if (String(item.type).startsWith('MAT') || stride < component * width || start % component || start + (count - 1) * stride + component * width > source.length)
            throw new Error('This GLB has invalid or unsupported attribute storage.');
        elements += count;
        if (elements > AGENT_3D_LIMITS.accessorElements)
            throw new Error('Simplify this model before importing: its geometry exceeds the preview budget.');
        if (item.componentType === 5126)
            for (let element = 0; element < count; element++)
                for (let channel = 0; channel < width; channel++) {
                    const number = view.getFloat32(binary.byteOffset + source.start + start + element * stride + channel * component, true);
                    if (!Number.isFinite(number) || Math.abs(number) > 1e6)
                        throw new Error('This GLB contains invalid geometry values.');
                }
        return { count, type: item.type, componentType: item.componentType, source, start, stride };
    });
    let primitives = 0;
    const meshes = array(json.meshes, 'meshes', 128).map(value => {
        let vertices = 0;
        for (const entry of array(record(value, 'mesh').primitives, 'mesh primitives', AGENT_3D_LIMITS.primitives)) {
            if (++primitives > AGENT_3D_LIMITS.primitives)
                throw new Error('Simplify this model to 128 mesh parts or fewer.');
            const item = record(entry, 'primitive'), attributes = record(item.attributes, 'attributes');
            if (item.targets !== undefined)
                throw new Error('Export a static model without morph targets for this preview.');
            const positions = accessors[reference(attributes.POSITION, 'position attribute', accessors)];
            if (positions.type !== 'VEC3')
                throw new Error('This GLB has invalid vertex positions.');
            vertices += positions.count;
            for (const accessor of Object.values(attributes))
                if (accessors[reference(accessor, 'mesh attribute', accessors)].count !== positions.count)
                    throw new Error('This GLB has mismatched vertex attributes.');
            if (item.indices !== undefined) {
                const indices = accessors[reference(item.indices, 'mesh indices', accessors)];
                if (indices.type !== 'SCALAR' || ![5121, 5123, 5125].includes(Number(indices.componentType)))
                    throw new Error('This GLB has invalid mesh indices.');
                for (let index = 0; index < indices.count; index++) {
                    const location = binary.byteOffset + indices.source.start + indices.start + index * indices.stride, value = indices.componentType === 5121 ? view.getUint8(location) : indices.componentType === 5123 ? view.getUint16(location, true) : view.getUint32(location, true);
                    if (value >= positions.count)
                        throw new Error('This GLB references vertices outside its geometry.');
                }
            }
            if (item.material !== undefined)
                reference(item.material, 'mesh material', array(json.materials, 'materials', 128));
            integer(item.mode ?? 4, 'mesh mode', 6);
        }
        return vertices;
    });
    const nodes = array(json.nodes, 'nodes', AGENT_3D_LIMITS.nodes).map(value => record(value, 'node'));
    let vertices = 0;
    const parents = new Map(), visited = new Set(), visiting = new Set();
    function walk(index) {
        if (visiting.has(index))
            throw new Error('This GLB has a circular scene graph.');
        if (visited.has(index))
            return;
        visiting.add(index);
        const node = nodes[index];
        if (node.skin !== undefined)
            throw new Error('Export the current pose as a static GLB without a skin.');
        if (node.mesh !== undefined)
            vertices += meshes[reference(node.mesh, 'node mesh', meshes)];
        for (const key of ['matrix', 'translation', 'rotation', 'scale'])
            if (node[key] !== undefined) {
                const values = array(node[key], key, key === 'matrix' ? 16 : key === 'rotation' ? 4 : 3);
                if (values.length !== (key === 'matrix' ? 16 : key === 'rotation' ? 4 : 3) || values.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e6))
                    throw new Error('This GLB has an invalid scene transform.');
            }
        for (const child of array(node.children, 'node children', AGENT_3D_LIMITS.nodes)) {
            const childIndex = reference(child, 'child node', nodes);
            if (parents.has(childIndex))
                throw new Error('This GLB repeats a child node. Export a simple scene graph.');
            parents.set(childIndex, index);
            walk(childIndex);
        }
        visiting.delete(index);
        visited.add(index);
    }
    nodes.forEach((_, index) => walk(index));
    if (!vertices || vertices > AGENT_3D_LIMITS.vertices)
        throw new Error('Use a static model with 1 to 300,000 visible vertices.');
    const scenes = array(json.scenes, 'scenes', 1);
    if (!scenes.length)
        throw new Error('This GLB needs one visible scene.');
    let visibleVertices = 0;
    const roots = new Set();
    function visibleWalk(index) { const node = nodes[index]; if (node.mesh !== undefined)
        visibleVertices += meshes[reference(node.mesh, 'visible node mesh', meshes)]; array(node.children, 'node children', AGENT_3D_LIMITS.nodes).forEach(child => visibleWalk(reference(child, 'visible child', nodes))); }
    scenes.forEach(value => array(record(value, 'scene').nodes, 'scene roots', AGENT_3D_LIMITS.nodes).forEach(root => { const index = reference(root, 'scene root', nodes); if (parents.has(index) || roots.has(index))
        throw new Error('This GLB repeats or misuses a scene root.'); roots.add(index); visibleWalk(index); }));
    if (!visibleVertices)
        throw new Error('This GLB has no visible model in its scene.');
    if (json.scene !== undefined)
        reference(json.scene, 'default scene', scenes);
    let imagePixels = 0;
    const images = array(json.images, 'images', AGENT_3D_LIMITS.images);
    images.forEach(value => { const image = record(value, 'image'), source = views[reference(image.bufferView, 'embedded texture', views)], [width, height] = imageDimensions(binary.subarray(source.start, source.start + source.length), image.mimeType); if (!width || !height || width > AGENT_3D_LIMITS.imageSide || height > AGENT_3D_LIMITS.imageSide || (imagePixels += width * height) > AGENT_3D_LIMITS.imagePixels)
        throw new Error('Reduce embedded textures to 4096 pixels per side and 16 megapixels in total.'); });
    array(json.textures, 'textures', 32).forEach(value => { const texture = record(value, 'texture'); reference(texture.source, 'texture image', images); });
    array(json.materials, 'materials', 128);
    if (json.animations !== undefined && array(json.animations, 'animations', 64).length)
        throw new Error('Export a static scene without animations.');
    return { bytes, vertices: visibleVertices, primitives, nodes: nodes.length, images: images.length };
}
