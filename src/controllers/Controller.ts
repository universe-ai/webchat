/**
 * Controllers work on Threads who are using CRDTs.
 * They provide a model to be used by the UI, either the CRDT view model (with added data) or its own model.
 *
 * A Controller always runs a streaming fetch request using a CRDT.
 *
 * The underlaying FetchRequest can be updated to allow for expanding/changing the scope of the model (for example for paging and expanding history).
 */

import {
    Service,
    Thread,
    ThreadDefaults,
    ThreadFetchParams,
    CRDTViewItem,
    CRDTVIEW_EVENT,
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

        // Note that when we set includeLicenses=3 the Storage will automatically add relevent licenses
        // to the response and also automatically request licenses to be extended for data matched.
        // This is a more fine grained approach in requesting licenses than using
        // query.embed and query.match on licenses.
        const threadFetchParams = {...params.threadFetchParams};
        threadFetchParams.query = threadFetchParams.query ?? {};
        threadFetchParams.query.includeLicenses = 3;
        this.service.addThreadSync(this.thread, threadFetchParams);

        this.threadStreamResponseAPI = this.thread.stream(params.threadFetchParams);

        this.threadStreamResponseAPI.onChange((...args) => this.handleOnChange(...args))
            .onCancel(() => this.close());
    }

    protected abstract handleOnChange(event: CRDTVIEW_EVENT): void;

    /**
     * Suger over this.threadStreamResponseAPI.getCRDTView().getItems().
     */
    public getItems(): CRDTViewItem[] {
        return this.threadStreamResponseAPI.getCRDTView().getItems();
    }

    /**
     * When streaming from the thread this function can be used to modify the underlying fetch request,
     * to change the scope of the data being fed to the CRDT view model.
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
        // TODO
        //this.threadStreamResponseAPI.getCRDTView.empty();

        this.triggerEvent("close");
    }

    protected update(obj?: any) {
        this.triggerEvent("update", obj);
    }

    public onUpdate(cb: (obj: any) => void): Controller {
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

    protected notify(message?: any) {
        this.triggerEvent("notification", message);
    }

    /**
     * Invoked when the controller wants to signal that something
     * worthy of attention just happened.
     */
    public onNotification(cb: (message?: any) => void): Controller {
        this.hookEvent("notification", cb);

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
