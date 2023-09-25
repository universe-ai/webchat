import {
    Service,
    Thread,
    ThreadDefaults,
    ThreadFetchParams,
    TransformerItem,
} from "universeai";

import Globals from "../Globals";

export type ControllerParams = {
    threadName?: string,  // this is optional just so extending classes can the default.
    service: Service,
    threadDefaults?: ThreadDefaults,
    threadFetchParams?: ThreadFetchParams,
    stream?: boolean,
    Globals?: typeof Globals,
};

export abstract class Controller {
    protected thread: Thread;
    protected service: Service;
    protected threadName: string;
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};
    protected Globals?: typeof Globals;

    constructor(params: ControllerParams) {
        if (!params.threadName) {
            throw new Error("threadName must be provided to controller");
        }

        params.stream = params.stream ?? true;

        this.service    = params.service;
        this.threadName = params.threadName;
        this.Globals    = params.Globals;

        this.thread = this.service.makeThread(this.threadName, params.threadDefaults);

        this.service.addThreadSync(this.thread, params.threadFetchParams);

        if (params.stream) {
            this.thread.stream(params.threadFetchParams).onChange((...args) => this.handleOnChange(...args))
                .onClose(() => this.close());
        }
        else {
            this.thread.query(params.threadFetchParams).onChange((...args) => this.handleOnChange(...args))
                .onClose(() => this.close());
        }

        this.init();
    }

    protected init() {}

    protected abstract handleOnChange(item: TransformerItem, eventType: string): void;

    public close() {
        this.thread.close();
    }

    protected update() {
        this.triggerEvent("update");
    }

    public onUpdate(cb: () => void) {
        this.hookEvent("update", cb);
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
