/** Attach only in a local worker after importing the reviewed WebLLM handler. */
export declare function attachBrowserWritingWorker(Handler: new () => { onmessage(event: MessageEvent): void }): void;
