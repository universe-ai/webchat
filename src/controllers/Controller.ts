/**
 * Controllers work on Threads who are using Transformers.
 * They provide a model to be used by the UI, either the transformer model (with added data) or its own model.
 *
 * A Controller always runs a streaming fetch request using a transformer.
 *
 * The underlaying FetchRequest can be updated to allow for expanding/changing the scope of the model (for example for paging and expanding history).
 */

import {
    Service,
    Thread,
    ThreadDefaults,
    ThreadFetchParams,
    TransformerItem,
    TRANSFORMER_EVENT,
    ThreadStreamResponseAPI,
    UpdateStreamParams,
} from "universeai";

import Globals from "../Globals";

export type ControllerParams = {
    threadName?: string,  // this is optional just so extending classes can set the default.

    service: Service,

    threadDefaults?: ThreadDefaults,

    threadFetchParams?: ThreadFetchParams,

    Globals?: typeof Globals,
};

export abstract class Controller {
    protected thread: Thread;
    protected service: Service;
    protected threadName: string;
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};
    protected Globals?: typeof Globals;
    protected isClosed: boolean = false;
    protected threadStreamResponseAPI: ThreadStreamResponseAPI;

    constructor(protected params: ControllerParams) {
        if (!params.threadName) {
            throw new Error("threadName must be provided to controller");
        }

        this.service    = params.service;
        this.threadName = params.threadName;
        this.Globals    = params.Globals;

        this.thread = this.service.makeThread(this.threadName, params.threadDefaults);

        this.service.addThreadSync(this.thread, params.threadFetchParams);

        this.threadStreamResponseAPI = this.thread.stream(params.threadFetchParams);

        this.threadStreamResponseAPI.onChange((...args) => this.handleOnChange(...args))
            .onCancel(() => this.close());
    }

    protected abstract handleOnChange(event: TRANSFORMER_EVENT): void;

    /**
     * Suger over this.threadStreamResponseAPI.getTransformer().getItems().
     */
    public getItems(): TransformerItem[] {
        return this.threadStreamResponseAPI.getTransformer().getItems();
    }

    /**
     * When streaming from the thread this function can be used to modify the underlying fetch request,
     * to change the scope of the data being fed to the transformer model.
     *
     * @throws if closed
     */
    public updateStream(updateStreamParams: UpdateStreamParams) {
        if (this.isClosed) {
            throw new Error("Controller is closed.");
        }

        this.threadStreamResponseAPI.updateStream(updateStreamParams);
    }

    public close() {
        if (this.isClosed) {
            return;
        }

        this.isClosed = true;

        this.threadStreamResponseAPI.stopStream();

        // Not sure that emptying the model is good idea.
        //this.threadStreamResponseAPI.getTransformer.empty();

        this.triggerEvent("close");
    }

    protected update() {
        this.triggerEvent("update");
    }

    public onUpdate(cb: () => void): Controller {
        this.hookEvent("update", cb);

        return this;
    }

    /**
     * Invoked when the underlying thread has been cancelled,
     * which happens when close() is called on the controller
     * or the underlying thread streamer is unsubscribed or fails.
     */
    public onClose(cb: () => void): Controller {
        this.hookEvent("close", cb);

        return this;
    }

    protected hookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = this.handlers[name] || [];
        this.handlers[name] = cbs;
        cbs.push(callback);
    }

    protected unhookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = (this.handlers[name] || []).filter( (cb: ( (...args: any) => void)) => callback !== cb );
        this.handlers[name] = cbs;
    }

    protected triggerEvent(name: string, ...args: any) {
        const cbs = this.handlers[name] || [];
        cbs.forEach( (callback: ( (...args: any) => void)) => {
            setImmediate( () => callback(...args) );
        });
    }
}
