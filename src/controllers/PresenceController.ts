import {
    TransformerItem,
} from "universeai";

import {
    Controller,
    ControllerParams,
} from "./Controller";

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

export class PresenceController extends Controller {
    protected intervalHandle?: ReturnType<typeof setInterval>;

    constructor(
        protected state: PresenceState,
        params: ControllerParams) {

        params.threadName = params.threadName ?? "presence";

        super(params);

        this.state.controller = this;
        this.state.list = [];
        this.state.lastActive = 0;
    }

    protected init() {
        super.init();

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
        super.close();

        this.intervalHandle && clearInterval(this.intervalHandle);

        this.state.list = [];
    }

    protected handleOnChange(item: TransformerItem, eventType: string) {
        // Mark parameter as unused
        <unknown>eventType;

        // TODO handle delete
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
