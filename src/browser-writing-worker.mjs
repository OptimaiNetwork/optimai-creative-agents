/** MIT: attach this handler only inside the embedding app's locally bundled worker. */
export function attachBrowserWritingWorker(WebWorkerMLCEngineHandler) {
    if (typeof WebWorkerMLCEngineHandler !== 'function') throw new TypeError('Provide the bundled WebLLM worker handler.');
    const handler = new WebWorkerMLCEngineHandler();
    self.onmessage = event => handler.onmessage(event);
}
