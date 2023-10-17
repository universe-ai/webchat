import {
    NodeInterface,
    TRANSFORMER_EVENT,
} from "universeai";

import {
    Controller,
    ControllerParams,
} from "./Controller";

export type Presence = {
    publicKey: Buffer,
    pingTime: number,
    active: boolean,
    isSelf: boolean,
    node: NodeInterface,
};

export type PresenceState = {
    lastActive: number,
    list: Presence[],
    isBlurred: boolean,
};

export type PresenceNotification = {
    title: string,
};

export type PresenceControllerParams = ControllerParams & {
    /** The document title. */
    title: string,
};

// Users show as inactive after this threshold.
const INACTIVE_THRESHOLD = 5 * 6 * 1000;

export class PresenceController extends Controller {
    protected intervalHandles: ReturnType<typeof setInterval>[] = [];
    protected state: PresenceState;

    constructor(protected params: PresenceControllerParams) {

        params.threadName = params.threadName ?? "presence";

        super(params);

        this.state = {
            list: [],
            lastActive: 0,
            isBlurred: true,
        };

        this.init();
    }

    protected init() {
        const handle1 = setInterval(() => this.refreshPresence(), 5000);

        const handle2 = setInterval( () => {
            if (Date.now() - this.state.lastActive < INACTIVE_THRESHOLD) {
                this.thread.post("presence");
            }
        }, INACTIVE_THRESHOLD)

        this.intervalHandles.push(handle1, handle2);
    }

    public getPresence(): Presence[] {
        return this.state.list;
    }

    public activityDetected() {
        const ts = Date.now();

        if (ts - this.state.lastActive >= INACTIVE_THRESHOLD) {
            this.thread.post("presence");
        }

        this.state.lastActive = ts;

        this.focusDetected();
    }

    public blurDetected() {
        this.state.isBlurred = true;
    }

    public focusDetected() {
        if (this.state.isBlurred) {
            this.state.isBlurred = false;
            this.notify({title: this.params.title});
        }
    }

    /**
     * Parse global message to see if it is interesting for the PresenceController.
     */
    public handleMessage(message: any) {
        if (message?.action === "NEW_MESSAGE") {
            if (this.state.isBlurred) {
                this.notify({title: `⚡ ${this.params.title}`});
            }
        }
    }

    public onNotification(cb: (notification: PresenceNotification) => void): PresenceController {
        super.onNotification(cb);

        return this;
    }

    /**
     *
     */
    protected notify(notification: PresenceNotification) {
        super.notify(notification);
    }

    public close() {
        super.close();

        this.intervalHandles.forEach( handle => clearInterval(handle) );
        this.intervalHandles.length = 0;

        this.state.list = [];
    }

    protected handleOnChange(event: TRANSFORMER_EVENT) {
        event.added.forEach( id1 => {
            const node = this.threadStreamResponseAPI.getTransformer().getNode(id1);

            const publicKey = node?.getOwner();

            if (!node || !publicKey) {
                return;
            }

            const presenceListLength = this.state.list.length;

            let found = false;

            for (let i=0; i<presenceListLength; i++) {
                const presence = this.state.list[i];
                if (presence.publicKey.equals(publicKey)) {
                    if (node.getCreationTime()! > presence.node.getCreationTime()!) {
                        presence.pingTime = Date.now();
                        presence.node = node;
                    }
                    found = true;
                }
            }

            if (!found) {
                this.state.list.push({
                    publicKey,
                    pingTime: Date.now(),
                    isSelf: publicKey.equals(this.service.getPublicKey()),
                    active: false,
                    node,
                });
            }

        });

        event.deleted.forEach( id1 => {
            this.state.list = this.state.list.filter( presence => !presence.node.getId1()?.equals(id1) );
        });

        this.refreshPresence();

        this.update();
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
            this.update();
        }
    }
}
