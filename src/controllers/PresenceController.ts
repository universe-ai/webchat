import {
    Service,
    Thread,
    TransformerItem,
} from "universeai";

type PresenceState = {
    controller: PresenceController,
    lastActive: number,
    list: Array<{
        publicKey: Buffer,
        pingTime: number,
        active: boolean,
        isSelf: boolean,
    }>,

};

// Users show as inactive after this threshold.
const INACTIVE_THRESHOLD = 5 * 60 * 1000;

export class PresenceController {
    protected thread: Thread;
    protected intervalHandle: ReturnType<typeof setInterval>;
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};

    constructor(
        protected state: PresenceState,
        protected service: Service,
        protected name: string = "presence",
        protected threadName: string = "presence") {

        this.state.controller = this;
        this.state.list = [];
        this.state.lastActive = 0;

        this.thread = this.service.makeThread(this.threadName);

        this.service.addThreadSync(this.thread);

        this.thread.stream().onChange(this.handleIncomingPresence)
            .onClose(() => this.close());

        setInterval(this.refreshPresence, 5000);

        this.intervalHandle = setInterval( () => {
            if (Date.now() - this.state.lastActive < INACTIVE_THRESHOLD) {
                this.thread.post();
            }
        }, INACTIVE_THRESHOLD)
    }

    public activityDetected() {
        const ts = Date.now();

        if (ts - this.state.lastActive >= INACTIVE_THRESHOLD) {
            this.thread.post();
        }

        this.state.lastActive = ts;
    }

    public close() {
        clearInterval(this.intervalHandle);
        this.thread.close();
        this.state.list = [];
    }

    protected handleIncomingPresence = (item: TransformerItem, eventType: string) => {
        const node = item.node;

        const publicKey = node.getOwner();

        if (!publicKey) {
            return;
        }

        const presenceListLength = this.state.list.length;
        let found = false;
        for (let i=0; i<presenceListLength; i++) {
            const presence = this.state.list[i];
            if (presence.publicKey.equals(publicKey)) {
                presence.pingTime = Date.now();
                found = true;
            }
        }

        if (!found) {
            this.state.list.push({
                publicKey,
                pingTime: Date.now(),
                isSelf: publicKey.equals(this.service.getPublicKey()),
                active: false,
            });
        }

        this.refreshPresence();

        this.triggerEvent("update");
    }

    protected refreshPresence = () => {
        const presenceListLength = this.state.list.length;

        let updated = false;
        for (let i=0; i<presenceListLength; i++) {
            const presence = this.state.list[i];

            const active = Date.now() - presence.pingTime < INACTIVE_THRESHOLD * 1.25;

            if (presence.active !== active) {
                presence.active = active;
                updated = true;
            }
        }

        if (updated) {
            this.triggerEvent("update");
        }
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
